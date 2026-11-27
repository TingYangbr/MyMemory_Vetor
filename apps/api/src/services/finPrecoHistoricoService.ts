/**
 * Histórico de preços (fechamento diário) dos papéis da B3, pelo arquivo oficial gratuito "Séries Históricas"
 * (COTAHIST, layout de largura fixa, 245 posições por linha). Guarda só os papéis que alguém da base tem ou já teve
 * (contas de investimento em reais) e só o mercado à vista. Carga dos anos pelo Admin; fechamento de cada dia pelo robô.
 * Preços NÃO ajustados por desdobramento/grupamento/proventos.
 */
import { Inflate } from "fflate";
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

/**
 * Primeiro arquivo do zip pelo índice do fim (End of Central Directory → Central Directory): início dos dados
 * compactados, tamanho compactado e método (8 = deflate, 0 = sem compressão). Não depende dos tamanhos do cabeçalho
 * local, que vêm zerados quando o zip usa "data descriptor".
 */
export function localizarArquivoNoZip(zip: Uint8Array): { inicio: number; tamanho: number; metodo: number } {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Zip sem índice (End of Central Directory).");
  const cd = dv.getUint32(eocd + 16, true);
  if (dv.getUint32(cd, true) !== 0x02014b50) throw new Error("Índice do zip inválido.");
  const metodo = dv.getUint16(cd + 10, true);
  const tamanho = dv.getUint32(cd + 20, true);
  const local = dv.getUint32(cd + 42, true);
  if (dv.getUint32(local, true) !== 0x04034b50) throw new Error("Cabeçalho do arquivo no zip inválido.");
  const nome = dv.getUint16(local + 26, true);
  const extra = dv.getUint16(local + 28, true);
  return { inicio: local + 30 + nome + extra, tamanho, metodo };
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
  // Onde está o conteúdo do .TXT: pelo índice no fim do zip (central directory). Os arquivos de 2025 em diante vêm
  // sem o tamanho no cabeçalho local (bit 3, "data descriptor") e a leitura em fluxo do zip parava no meio.
  const { inicio, tamanho, metodo } = localizarArquivoNoZip(zip);
  const dados = zip.subarray(inicio, inicio + tamanho);
  let terminou = false;
  const fluxo = new Inflate((dado, final) => {
    processar(dec.decode(dado, { stream: !final }), final);
    if (final) terminou = true;
  });
  // Em pedaços de 1 MB, devolvendo a vez ao servidor entre eles (o anual tem ~90 MB compactado): a API não trava
  const PEDACO = 1024 * 1024;
  if (metodo === 0) {
    processar(dec.decode(dados), true);
    terminou = true;
  } else {
    for (let i = 0; i < dados.length; i += PEDACO) {
      fluxo.push(dados.subarray(i, i + PEDACO), i + PEDACO >= dados.length);
      await new Promise((r) => setImmediate(r));
    }
  }
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

// ── Papel novo: busca o passado sozinho ─────────────────────────────────────

/** Até quantos anos para trás a busca automática volta (a carga de anos mais antigos continua pelo Admin). */
const ANOS_MAX_BUSCA = 5;

/**
 * Papéis em carteira sem fechamento guardado desde a 1ª operação (papel cadastrado depois da carga dos anos, ex.:
 * SLCE3) e os anos que faltam a cada um. Cada (papel, ano) é tentado uma vez só (fin_precos_importacoes
 * "B:<papel>:<ano>"), para não baixar os mesmos ~90 MB toda noite quando a B3 não tem o papel.
 */
export async function papeisSemHistorico(): Promise<Map<number, Set<string>>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT t.ticker AS "ticker", to_char(t.primeira, 'YYYY-MM-DD') AS "primeira"
     FROM (
       SELECT UPPER(c.papel) AS ticker, MIN(l.data) AS primeira
       FROM fin_contas c
       JOIN fin_lancamentos l ON l.conta_destinoid = c.id OR l.conta_origemid = c.id
       WHERE c.tipo = 'investimento' AND c.papel IS NOT NULL AND c.moeda = 'BRL'
       GROUP BY 1
     ) t
     WHERE NOT EXISTS (
       SELECT 1 FROM fin_precos_historico h WHERE h.ticker = t.ticker AND h.data <= t.primeira + 7
     )`
  );
  const anoAtual = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(new Date()));
  const [feitos] = await pool.query<RowDataPacket[]>(
    `SELECT arquivo FROM fin_precos_importacoes WHERE arquivo LIKE 'B:%' AND situacao <> 'erro'`
  );
  const ja = new Set(feitos.map((f) => String(f.arquivo)));
  const porAno = new Map<number, Set<string>>();
  for (const r of rows) {
    const ticker = String(r.ticker);
    if (!ticker || ticker.length > 12) continue;
    const ini = Math.max(Number(String(r.primeira).slice(0, 4)), anoAtual - ANOS_MAX_BUSCA);
    for (let a = ini; a <= anoAtual; a++) {
      if (ja.has(`B:${ticker}:${a}`)) continue;
      if (!porAno.has(a)) porAno.set(a, new Set());
      porAno.get(a)!.add(ticker);
    }
  }
  return porAno;
}

/** Baixa os arquivos anuais que faltam e grava só os papéis novos (um arquivo por ano, para todos eles). */
export async function buscarHistoricoPapeisNovos(): Promise<number> {
  const porAno = await papeisSemHistorico();
  let total = 0;
  for (const [ano, tickers] of [...porAno].sort((a, b) => a[0] - b[0])) {
    let situacao = "ok";
    let n = 0;
    let msg: string | null = null;
    try {
      const zip = await baixar(`${BASE}/COTAHIST_A${ano}.ZIP`);
      if (!zip) situacao = "sem_arquivo";
      else n = await importarZip(zip, tickers);
    } catch (err) {
      situacao = "erro";
      msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    }
    // Erro (rede, B3 fora): fica como erro e tenta de novo na próxima noite. Arquivo lido (mesmo sem o papel): não repete.
    for (const t of tickers) {
      await registrar(`B:${t}:${ano}`, situacao, 0, situacao === "ok" ? `Papel novo: ano ${ano} buscado (${n} pregões para ${tickers.size} papel(is)).` : msg);
    }
    total += n;
  }
  return total;
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
  // Papel novo (cadastrado depois da carga dos anos): busca o passado dele, sem ninguém precisar lembrar
  try {
    await buscarHistoricoPapeisNovos();
  } catch (err) {
    console.warn("[precos] busca de papéis novos:", err instanceof Error ? err.message : err);
  }
}
