/**
 * Histórico de preços (fechamento diário) dos papéis da B3, pelo arquivo oficial gratuito "Séries Históricas"
 * (COTAHIST, layout de largura fixa, 245 posições por linha). Guarda só os papéis que alguém da base tem ou já teve
 * (contas de investimento em reais) e só o mercado à vista. Carga dos anos pelo Admin; fechamento de cada dia pelo robô.
 * Preços NÃO ajustados por desdobramento/grupamento/proventos.
 */
import { Unzip, UnzipInflate } from "fflate";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";

const BASE = (process.env.B3_SERHIST_URL ?? "https://bvmf.bmfbovespa.com.br/InstDados/SerHist").replace(/\/$/, "");

export interface LinhaCotahist {
  data: string;
  ticker: string;
  abertura: number;
  maxima: number;
  minima: number;
  fechamento: number;
  volume: number;
}

const num = (s: string) => Number(s.trim() || "0");

/**
 * Uma linha do COTAHIST (registro 01, mercado à vista 010). Preços vêm em centavos e por lote de FATCOT unidades
 * (1 ou 1000): divide por 100 e pelo fator. Posições do layout oficial (1-based): data 3–10, ticker 13–24,
 * mercado 25–27, abertura 57–69, máxima 70–82, mínima 83–95, último (fechamento) 109–121, volume 171–188, fator 211–217.
 */
export function lerLinhaCotahist(l: string): LinhaCotahist | null {
  if (l.length < 217 || l.slice(0, 2) !== "01") return null;
  if (l.slice(24, 27) !== "010") return null;
  const d = l.slice(2, 10);
  const fator = num(l.slice(210, 217)) || 1;
  const preco = (a: number, b: number) => Math.round((num(l.slice(a - 1, b)) / 100 / fator) * 1e6) / 1e6;
  const fechamento = preco(109, 121);
  if (!(fechamento > 0)) return null;
  return {
    data: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
    ticker: l.slice(12, 24).trim().toUpperCase(),
    abertura: preco(57, 69),
    maxima: preco(70, 82),
    minima: preco(83, 95),
    fechamento,
    volume: Math.round(num(l.slice(170, 188))) / 100,
  };
}

/** Papéis da B3 em reais que alguém da base tem ou já teve. */
export async function tickersEmUso(): Promise<Set<string>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT UPPER(papel) AS "t" FROM fin_contas
     WHERE tipo = 'investimento' AND papel IS NOT NULL AND moeda = 'BRL'`
  );
  return new Set(rows.map((r) => String(r.t)).filter(Boolean));
}

async function gravarLote(linhas: LinhaCotahist[]): Promise<void> {
  if (!linhas.length) return;
  const valores: unknown[] = [];
  const marcas = linhas.map((r) => {
    valores.push(r.ticker, r.data, r.abertura, r.maxima, r.minima, r.fechamento, r.volume);
    return "(?, ?, ?, ?, ?, ?, ?)";
  });
  await pool.query(
    `INSERT INTO fin_precos_historico (ticker, data, abertura, maxima, minima, fechamento, volume)
     VALUES ${marcas.join(", ")}
     ON CONFLICT (ticker, data) DO UPDATE SET abertura = EXCLUDED.abertura, maxima = EXCLUDED.maxima,
       minima = EXCLUDED.minima, fechamento = EXCLUDED.fechamento, volume = EXCLUDED.volume`,
    valores
  );
}

/** Lê o .ZIP (um .TXT dentro) em partes, sem descompactar tudo na memória; grava só os tickers pedidos. */
async function importarZip(zip: Uint8Array, tickers: Set<string>): Promise<number> {
  let resto = "";
  let pendentes: LinhaCotahist[] = [];
  let total = 0;
  const gravacoes: Promise<void>[] = [];
  const dec = new TextDecoder("latin1");
  const processar = (texto: string, fim: boolean) => {
    const partes = (resto + texto).split(/\r?\n/);
    resto = fim ? "" : partes.pop() ?? "";
    for (const l of partes) {
      const r = lerLinhaCotahist(l);
      if (r && tickers.has(r.ticker)) {
        pendentes.push(r);
        total++;
        if (pendentes.length >= 500) {
          gravacoes.push(gravarLote(pendentes));
          pendentes = [];
        }
      }
    }
  };
  let erro: unknown = null;
  let terminou = false;
  const un = new Unzip((arq) => {
    arq.ondata = (err, dado, final) => {
      if (err) {
        erro = err;
        return;
      }
      processar(dec.decode(dado, { stream: !final }), final);
      if (final) terminou = true;
    };
    arq.start();
  });
  un.register(UnzipInflate);
  // Em pedaços de 1 MB, devolvendo a vez ao servidor entre eles (o anual tem ~90 MB compactado): a API não trava
  const PEDACO = 1024 * 1024;
  for (let i = 0; i < zip.length && !erro; i += PEDACO) {
    un.push(zip.subarray(i, i + PEDACO), i + PEDACO >= zip.length);
    await new Promise((r) => setImmediate(r));
  }
  if (erro) throw erro;
  if (!terminou) processar("", true);
  if (pendentes.length) gravacoes.push(gravarLote(pendentes));
  await Promise.all(gravacoes);
  return total;
}

async function baixar(url: string): Promise<Uint8Array | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10 * 60 * 1000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`B3 respondeu ${r.status} para ${url}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    // Sem pregão a B3 às vezes devolve uma página HTML em vez do .ZIP
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return null;
    return buf;
  } finally {
    clearTimeout(t);
  }
}

async function registrar(arquivo: string, situacao: string, linhas: number, msg: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO fin_precos_importacoes (arquivo, situacao, linhas, mensagem, em) VALUES (?, ?, ?, ?, NOW())
     ON CONFLICT (arquivo) DO UPDATE SET situacao = EXCLUDED.situacao, linhas = EXCLUDED.linhas, mensagem = EXCLUDED.mensagem, em = NOW()`,
    [arquivo, situacao, linhas, msg]
  );
}

/** Importa um arquivo (anual "A2025" ou diário "D24112026"). */
async function importarArquivo(nome: string): Promise<{ situacao: string; linhas: number }> {
  const tickers = await tickersEmUso();
  if (!tickers.size) {
    await registrar(nome, "sem_papeis", 0, "Nenhum papel em carteira na base.");
    return { situacao: "sem_papeis", linhas: 0 };
  }
  try {
    const zip = await baixar(`${BASE}/COTAHIST_${nome}.ZIP`);
    if (!zip) {
      await registrar(nome, "sem_arquivo", 0, "A B3 não tem este arquivo (sem pregão ou ainda não publicado).");
      return { situacao: "sem_arquivo", linhas: 0 };
    }
    const n = await importarZip(zip, tickers);
    await registrar(nome, "ok", n, null);
    return { situacao: "ok", linhas: n };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await registrar(nome, "erro", 0, msg.slice(0, 500));
    return { situacao: "erro", linhas: 0 };
  }
}

// ── Carga pelo Admin (anos inteiros, em segundo plano) ─────────────────────

let cargaRodando: { anos: number[]; atual: number | null; iniciadoEm: string } | null = null;

export function cargaEmAndamento() {
  return cargaRodando;
}

export function iniciarCargaAnos(anos: number[]): void {
  if (cargaRodando) throw new Error("Já há uma carga em andamento.");
  const lista = [...new Set(anos)].filter((a) => a >= 1990 && a <= 2100).sort();
  cargaRodando = { anos: lista, atual: null, iniciadoEm: new Date().toISOString() };
  void (async () => {
    try {
      for (const a of lista) {
        cargaRodando!.atual = a;
        await importarArquivo(`A${a}`);
      }
    } finally {
      cargaRodando = null;
    }
  })();
}

export async function situacaoHistorico(): Promise<{
  papeis: number;
  linhas: number;
  primeiraData: string | null;
  ultimaData: string | null;
  importacoes: { arquivo: string; situacao: string; linhas: number; mensagem: string | null; em: string }[];
}> {
  const [[r], [imp]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT ticker)::int AS "papeis", COUNT(*)::int AS "linhas",
         to_char(MIN(data), 'YYYY-MM-DD') AS "ini", to_char(MAX(data), 'YYYY-MM-DD') AS "fim"
       FROM fin_precos_historico`
    ),
    pool.query<RowDataPacket[]>(
      `SELECT arquivo, situacao, linhas, mensagem, to_char(em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "em"
       FROM fin_precos_importacoes ORDER BY em DESC LIMIT 40`
    ),
  ]);
  return {
    papeis: Number(r[0]?.papeis ?? 0),
    linhas: Number(r[0]?.linhas ?? 0),
    primeiraData: r[0]?.ini ?? null,
    ultimaData: r[0]?.fim ?? null,
    importacoes: imp.map((i) => ({
      arquivo: String(i.arquivo), situacao: String(i.situacao), linhas: Number(i.linhas), mensagem: i.mensagem ?? null, em: String(i.em),
    })),
  };
}

// ── Robô: fechamento de cada dia ────────────────────────────────────────────

let ultimaVerificacao = 0;

/** A partir das 20h de São Paulo (de hora em hora): importa os dias úteis dos últimos 7 dias ainda sem arquivo ok. */
export async function executarHistoricoDiario(): Promise<void> {
  if (Date.now() - ultimaVerificacao < 60 * 60 * 1000) return;
  const agora = new Date();
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(agora));
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
  if (hora < 20) return;
  ultimaVerificacao = Date.now();
  if (cargaRodando) return;
  const [feitos] = await pool.query<RowDataPacket[]>(
    `SELECT arquivo FROM fin_precos_importacoes WHERE situacao IN ('ok', 'sem_papeis') OR (situacao = 'sem_arquivo' AND em < NOW() - INTERVAL '2 days')`
  );
  const ja = new Set(feitos.map((f) => String(f.arquivo)));
  for (let i = 7; i >= 0; i--) {
    const d = new Date(`${hoje}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    const nome = `D${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
    if (ja.has(nome)) continue;
    await importarArquivo(nome);
  }
}
