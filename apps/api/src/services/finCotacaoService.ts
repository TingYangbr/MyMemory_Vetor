import { finSomarDias } from "@mymemory/shared";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";

/**
 * Cotação PTAX do Banco Central (boletim de fechamento, venda), guardada em fin_cotacoes.
 * Para um dia sem cotação (fim de semana, feriado) vale a última anterior. Só envia moeda e datas ao BCB.
 */

const URL_PTAX =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)";

/** Evita consultar o BCB de novo para o mesmo dia/moeda dentro de 1 hora. */
const tentativas = new Map<string, number>();

function hojeSp(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
const mdy = (d: string) => `${d.slice(5, 7)}-${d.slice(8, 10)}-${d.slice(0, 4)}`;

async function buscarPtax(moeda: string, de: string, ate: string): Promise<number> {
  const qs =
    `?@moeda='${moeda}'&@dataInicial='${mdy(de)}'&@dataFinalCotacao='${mdy(ate)}'&$format=json` +
    `&$select=cotacaoVenda,dataHoraCotacao,tipoBoletim`;
  const r = await fetch(URL_PTAX + qs, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`PTAX HTTP ${r.status}`);
  const j = (await r.json()) as { value?: { cotacaoVenda: number; dataHoraCotacao: string; tipoBoletim: string }[] };
  // Só o boletim de fechamento de cada dia (o dia em andamento ainda não tem: vale o anterior)
  const porDia = new Map<string, number>();
  for (const v of j.value ?? []) {
    if (/fechamento/i.test(v.tipoBoletim) && Number(v.cotacaoVenda) > 0) porDia.set(v.dataHoraCotacao.slice(0, 10), Number(v.cotacaoVenda));
  }
  let n = 0;
  for (const [dia, valor] of porDia) {
    const c = { valor };
    await pool.query(
      `INSERT INTO fin_cotacoes (moeda, data, valor) VALUES (?, ?, ?)
       ON CONFLICT (moeda, data) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW()`,
      [moeda, dia, c.valor]
    );
    n++;
  }
  return n;
}

/** Cotação em reais de 1 unidade da moeda na data (ou a última anterior). null = indisponível. */
export async function obterCotacao(moeda: string, data: string): Promise<{ data: string; valor: number } | null> {
  if (moeda === "BRL") return { data, valor: 1 };
  const hoje = hojeSp();
  const alvo = data > hoje ? hoje : data;
  const local = async () => {
    const [r] = await pool.query<RowDataPacket[]>(
      `SELECT to_char(data, 'YYYY-MM-DD') AS "data", valor FROM fin_cotacoes WHERE moeda = ? AND data <= ? ORDER BY data DESC LIMIT 1`,
      [moeda, alvo]
    );
    return r[0] ? { data: String(r[0].data), valor: Number(r[0].valor) } : null;
  };
  let c = await local();
  if (c && c.data === alvo) return c;
  const chave = `${moeda}:${alvo}`;
  const ultima = tentativas.get(chave) ?? 0;
  if (Date.now() - ultima > 3_600_000) {
    tentativas.set(chave, Date.now());
    try {
      await buscarPtax(moeda, finSomarDias(alvo, -10), alvo);
      c = await local();
    } catch {
      /* BCB fora do ar: fica a última conhecida */
    }
  }
  // Muito antiga não serve (ex.: só existe cotação de meses atrás)
  if (c && c.data < finSomarDias(alvo, -10)) return null;
  return c;
}
