/**
 * Investimentos — porta única das operações com papéis (compra e venda; depois proventos e eventos).
 * Fale comigo e tela chamam registrarOperacaoInvestimento com origem "falecomigo"/"tela"; a API da B3, quando vier,
 * chama a mesma função com origem "b3" e a chave externa do negócio: o que já foi relatado com os mesmos dados é
 * casado (fica "confirmada"), sem duplicar. Saldo, posição e custo médio continuam saindo do livro (lote).
 */
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { FinErro, criarConta, criarLancamento, venderInvestimento, type Espaco } from "./financeiroService.js";

export type FinOrigemOperacao = "falecomigo" | "tela" | "b3" | "nota";

export interface FinOperacaoInvEntrada {
  operacao: "compra" | "venda";
  /** Conta do papel já conhecida; senão o ticker (resolvido/criado na corretora). */
  papelContaId?: number | null;
  ticker?: string | null;
  corretoraId: number;
  data: string;
  quantidade: number;
  /** Preço por unidade; sem ele, o valor total. */
  preco?: number | null;
  valorTotal?: number | null;
  /** Corretagem, emolumentos: somam ao custo na compra e saem do líquido na venda. */
  taxas?: number | null;
  origem: FinOrigemOperacao;
  /** Id do negócio na fonte (B3, nota). Sem ele, a fonte externa usa um hash dos dados. */
  chaveExterna?: string | null;
}

export interface FinOperacaoInvResultado {
  operacaoId: number;
  papelContaId: number;
  ticker: string;
  /** "nova" = gravou agora; "casada" = já existia relatada e foi confirmada; "repetida" = mesma chave externa. */
  como: "nova" | "casada" | "repetida";
  valorTotal: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function esp(e: Espaco, alias = ""): { sql: string; params: unknown[] } {
  const p = alias ? `${alias}.` : "";
  return e.groupId != null
    ? { sql: `${p}groupid = ?`, params: [e.groupId] }
    : { sql: `${p}groupid IS NULL AND ${p}userid = ?`, params: [e.userId] };
}

/** "PETR4 - PETROLEO BRASILEIRO S.A." / "petr4" / "PETR4F" → "PETR4". Outros formatos (AAPL, Tesouro…) ficam em maiúsculas. */
export function normalizarTicker(t: string): string {
  const s = t.trim().toUpperCase();
  const b3 = /^([A-Z]{4}\d{1,2})F?\b/.exec(s);
  if (b3) return b3[1]!;
  return s.split(/\s+-\s+/)[0]!.trim().slice(0, 30);
}

/** Acha a conta do papel nesta corretora; se não existir e `criar`, cadastra (moeda da corretora). */
export async function resolverPapel(
  e: Espaco,
  tickerBruto: string,
  corretoraId: number,
  criar: boolean
): Promise<{ id: number; ticker: string; moeda: string }> {
  const ticker = normalizarTicker(tickerBruto);
  if (!ticker) throw new FinErro("papel", "Informe o papel (ticker).");
  const f = esp(e);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, moeda FROM fin_contas
     WHERE tipo = 'investimento' AND UPPER(papel) = ? AND corretora_contaid = ? AND ${f.sql}
     ORDER BY ativo DESC, id LIMIT 1`,
    [ticker, corretoraId, ...f.params]
  );
  if (rows[0]) return { id: Number(rows[0].id), ticker, moeda: String(rows[0].moeda) };
  if (!criar) throw new FinErro("papel", `Não há ${ticker} nesta corretora para vender.`);
  const [cs] = await pool.query<RowDataPacket[]>(
    `SELECT moeda, mercado FROM fin_contas WHERE id = ? AND tipo IN ('corretora','banco') AND ${f.sql}`,
    [corretoraId, ...f.params]
  );
  if (!cs[0]) throw new FinErro("corretora", "Corretora não encontrada.");
  const c = await criarConta(e, {
    nome: ticker,
    tipo: "investimento",
    papel: ticker,
    corretoraContaId: corretoraId,
    moeda: String(cs[0].moeda),
    mercado: cs[0].mercado ?? null,
  });
  return { id: c.id, ticker, moeda: c.moeda };
}

/** Ticker e moeda de uma conta de papel do espaço. */
async function papelPorId(e: Espaco, id: number): Promise<{ id: number; ticker: string; moeda: string }> {
  const f = esp(e);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, papel, nome, moeda FROM fin_contas WHERE id = ? AND tipo = 'investimento' AND ${f.sql}`,
    [id, ...f.params]
  );
  if (!rows[0]) throw new FinErro("papel", "Papel não encontrado.");
  return { id, ticker: normalizarTicker(String(rows[0].papel ?? rows[0].nome)), moeda: String(rows[0].moeda) };
}

export async function registrarOperacaoInvestimento(e: Espaco, op: FinOperacaoInvEntrada): Promise<FinOperacaoInvResultado> {
  if (!(op.quantidade > 0)) throw new FinErro("quantidade", "Informe a quantidade.");
  const taxas = r2(Math.max(0, op.taxas ?? 0));
  const bruto = op.valorTotal != null && op.valorTotal > 0 ? r2(op.valorTotal) : op.preco != null && op.preco > 0 ? r2(op.preco * op.quantidade) : null;
  if (bruto == null) throw new FinErro("valor", "Informe o preço ou o valor total.");
  const preco = op.preco != null && op.preco > 0 ? op.preco : Math.round((bruto / op.quantidade) * 1e6) / 1e6;
  // Compra: o custo inclui as taxas. Venda: entra o líquido.
  const valorTotal = op.operacao === "compra" ? r2(bruto + taxas) : r2(bruto - taxas);
  if (!(valorTotal > 0)) throw new FinErro("valor", "As taxas são maiores que o valor da venda.");

  const papel = op.papelContaId
    ? await papelPorId(e, op.papelContaId)
    : await resolverPapel(e, op.ticker ?? "", op.corretoraId, op.operacao === "compra");
  const externa = op.origem === "b3" || op.origem === "nota";
  const chave =
    op.chaveExterna?.trim() ||
    (externa ? `${op.origem}:${op.data}:${papel.ticker}:${op.operacao}:${op.quantidade}:${preco}` : null);
  const f = esp(e);

  if (chave) {
    const [ja] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM fin_operacoes_inv WHERE chave_externa = ? AND ${f.sql} LIMIT 1`,
      [chave, ...f.params]
    );
    if (ja[0]) return { operacaoId: Number(ja[0].id), papelContaId: papel.id, ticker: papel.ticker, como: "repetida", valorTotal };
  }

  if (externa) {
    // Já foi relatada (Fale comigo, tela) com os mesmos dados, até 3 dias de diferença (liquidação D+2): confirma
    const [rel] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM fin_operacoes_inv
       WHERE situacao = 'relatada' AND operacao = ? AND ticker = ? AND ABS(quantidade - ?::numeric) < 0.000001
         AND ABS(COALESCE(preco, 0) - ?::numeric) <= GREATEST(0.01, ?::numeric * 0.001) AND ABS(data - ?::date) <= 3 AND ${f.sql}
       ORDER BY ABS(data - ?::date), id LIMIT 1`,
      [op.operacao, papel.ticker, op.quantidade, preco, preco, op.data, op.data, ...f.params]
    );
    if (rel[0]) {
      await pool.query(
        `UPDATE fin_operacoes_inv SET situacao = 'confirmada', chave_externa = ?, origem = ? WHERE id = ?`,
        [chave, op.origem, rel[0].id]
      );
      return { operacaoId: Number(rel[0].id), papelContaId: papel.id, ticker: papel.ticker, como: "casada", valorTotal };
    }
  }

  const lote = randomUUID();
  const [ins] = await pool.query<RowDataPacket[]>(
    `INSERT INTO fin_operacoes_inv (groupid, userid, data, operacao, ticker, papel_contaid, corretora_contaid, quantidade, preco,
       valor_total, taxas, moeda, origem, situacao, chave_externa, lote)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [e.groupId, e.userId, op.data, op.operacao, papel.ticker, papel.id, op.corretoraId, op.quantidade, preco,
      valorTotal, taxas, papel.moeda, op.origem, externa ? "confirmada" : "relatada", chave, lote]
  );
  const operacaoId = Number(ins[0].id);
  try {
    if (op.operacao === "compra") {
      const estrangeira = papel.moeda !== "BRL";
      await criarLancamento(e, {
        data: op.data,
        descricao: `Compra ${op.quantidade} ${papel.ticker}`,
        valor: estrangeira ? null : valorTotal,
        valorMoeda: estrangeira ? valorTotal : null,
        contaOrigemId: op.corretoraId,
        contaDestinoId: papel.id,
        quantidade: op.quantidade,
        preco,
        lote,
      });
    } else {
      await venderInvestimento(e, {
        contaPapelId: papel.id,
        contaDestinoId: op.corretoraId,
        data: op.data,
        quantidade: op.quantidade,
        valorTotal,
        lote,
      });
    }
  } catch (err) {
    await pool.query(`DELETE FROM fin_operacoes_inv WHERE id = ?`, [operacaoId]);
    throw err;
  }
  return { operacaoId, papelContaId: papel.id, ticker: papel.ticker, como: "nova", valorTotal };
}

/** Desfaz a operação: apaga os lançamentos do lote e o fato. */
export async function desfazerOperacaoInvestimento(e: Espaco, id: number): Promise<void> {
  const f = esp(e);
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT lote FROM fin_operacoes_inv WHERE id = ? AND ${f.sql}`, [id, ...f.params]);
  if (!rows[0]) throw new FinErro("nao_encontrado", "Operação não encontrada.");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (rows[0].lote) await conn.query(`DELETE FROM fin_lancamentos WHERE lote = ? AND ${f.sql}`, [rows[0].lote, ...f.params]);
    await conn.query(`DELETE FROM fin_operacoes_inv WHERE id = ?`, [id]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
