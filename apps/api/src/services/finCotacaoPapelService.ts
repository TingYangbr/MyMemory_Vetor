/**
 * Preço atual dos papéis da B3 (ações, FIIs, ETFs, BDRs em reais) para o valor de mercado dos investimentos.
 * Fonte: brapi.dev com o token BRAPI_TOKEN do servidor (atraso de alguns minutos no plano gratuito). Sem token, ou se
 * a consulta falhar, vale o último preço guardado — inclusive o digitado pela pessoa ("PETR4 está a 38,50").
 * Cache em fin_cotacoes_papel (um preço por ticker, igual para todos): renova a cada 30 minutos.
 */
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { config } from "../config.js";

export interface PrecoPapel {
  preco: number;
  /** Momento do preço (AAAA-MM-DD HH:MM, horário de São Paulo). */
  em: string;
  fonte: "brapi" | "manual";
}

const RENOVA_MS = 30 * 60 * 1000;
const MAX_POR_VEZ = 30;

const tickerOk = (t: string) => /^[A-Z0-9]{4,6}[0-9]{0,2}F?$/.test(t);

async function lerCache(tickers: string[]): Promise<Map<string, PrecoPapel & { atualizado: number }>> {
  const out = new Map<string, PrecoPapel & { atualizado: number }>();
  if (!tickers.length) return out;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ticker, preco, fonte,
       to_char(momento AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS "em",
       EXTRACT(EPOCH FROM atualizado_em) * 1000 AS "atualizado"
     FROM fin_cotacoes_papel WHERE ticker = ANY(?::text[])`,
    [tickers]
  );
  for (const r of rows) {
    out.set(String(r.ticker), { preco: Number(r.preco), em: String(r.em), fonte: r.fonte === "manual" ? "manual" : "brapi", atualizado: Number(r.atualizado) });
  }
  return out;
}

async function gravar(ticker: string, preco: number, momento: Date, fonte: "brapi" | "manual"): Promise<void> {
  await pool.query(
    `INSERT INTO fin_cotacoes_papel (ticker, preco, momento, fonte, atualizado_em) VALUES (?, ?, ?, ?, NOW())
     ON CONFLICT (ticker) DO UPDATE SET preco = EXCLUDED.preco, momento = EXCLUDED.momento, fonte = EXCLUDED.fonte,
       atualizado_em = NOW()`,
    [ticker, preco, momento.toISOString(), fonte]
  );
}

/** Busca na brapi.dev um papel (o plano gratuito aceita um por consulta). */
async function buscarBrapi(ticker: string): Promise<{ preco: number; momento: Date } | null> {
  if (!config.brapiToken) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(ticker)}`, {
      headers: { Authorization: `Bearer ${config.brapiToken}` },
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { results?: { regularMarketPrice?: number; regularMarketTime?: string | number }[] };
    const q = j.results?.[0];
    if (!q || typeof q.regularMarketPrice !== "number" || !(q.regularMarketPrice > 0)) return null;
    const tm = q.regularMarketTime;
    const momento = tm == null ? new Date() : typeof tm === "number" ? new Date(tm * 1000) : new Date(tm);
    return { preco: q.regularMarketPrice, momento: Number.isNaN(momento.getTime()) ? new Date() : momento };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Preço atual de cada ticker (os vencidos são renovados na brapi; sem token ou com falha, fica o guardado). */
export async function precosPapeis(tickersBrutos: string[]): Promise<Map<string, PrecoPapel>> {
  const tickers = [...new Set(tickersBrutos.map((t) => t.trim().toUpperCase()).filter(tickerOk))];
  const cache = await lerCache(tickers);
  if (config.brapiToken) {
    const vencidos = tickers.filter((t) => {
      const c = cache.get(t);
      return !c || Date.now() - c.atualizado > RENOVA_MS;
    });
    for (const t of vencidos.slice(0, MAX_POR_VEZ)) {
      const q = await buscarBrapi(t);
      if (q) await gravar(t, q.preco, q.momento, "brapi");
    }
    if (vencidos.length) for (const [k, v] of await lerCache(vencidos)) cache.set(k, v);
  }
  const out = new Map<string, PrecoPapel>();
  for (const [k, v] of cache) out.set(k, { preco: v.preco, em: v.em, fonte: v.fonte });
  return out;
}

/** Preço digitado pela pessoa (vale até a próxima atualização da brapi, se houver token). */
export async function definirPrecoManual(tickerBruto: string, preco: number): Promise<PrecoPapel> {
  const ticker = tickerBruto.trim().toUpperCase();
  if (!tickerOk(ticker)) throw new Error("Ticker inválido.");
  if (!(preco > 0)) throw new Error("Informe o preço.");
  await gravar(ticker, preco, new Date(), "manual");
  return (await precosPapeis([ticker])).get(ticker)!;
}

/** Robô: renova os preços dos papéis em carteira (a cada 30 min, só com token). */
export async function atualizarCotacoesEmCarteira(): Promise<void> {
  if (!config.brapiToken) return;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT UPPER(c.papel) AS "t" FROM fin_contas c
     WHERE c.tipo = 'investimento' AND c.ativo = 1 AND c.papel IS NOT NULL AND c.moeda = 'BRL'`
  );
  await precosPapeis(rows.map((r) => String(r.t)));
}
