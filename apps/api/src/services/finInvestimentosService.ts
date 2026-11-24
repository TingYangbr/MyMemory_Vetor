/**
 * Investimentos — porta única das operações com papéis (compra e venda; depois proventos e eventos).
 * Fale comigo e tela chamam registrarOperacaoInvestimento com origem "falecomigo"/"tela"; a API da B3, quando vier,
 * chama a mesma função com origem "b3" e a chave externa do negócio: o que já foi relatado com os mesmos dados é
 * casado (fica "confirmada"), sem duplicar. Saldo, posição e custo médio continuam saindo do livro (lote).
 */
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { FinErro, contaSistemaId, criarConta, criarLancamento, venderInvestimento, type Espaco } from "./financeiroService.js";
import type { FinTipoProvento } from "@mymemory/shared";
import { precosPapeis } from "./finCotacaoPapelService.js";

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
  // Compra: busca o preço atual do papel já (brapi com token), sem esperar o robô — sem bloquear a resposta
  if (op.operacao === "compra" && papel.moeda === "BRL") void precosPapeis([papel.ticker]).catch(() => undefined);
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


// ── Proventos e eventos (parte 2) ───────────────────────────────────────────

const ROTULO_PROVENTO: Record<FinTipoProvento, string> = {
  dividendo: "Dividendos",
  jcp: "JCP",
  rendimento: "Rendimentos",
  juros: "Juros",
};

/** Grupo de receita pelo nome (Dividendos, JCP, Rendimentos, Bonificações…): usa o que existe ou cria. */
async function grupoReceita(e: Espaco, nome: string): Promise<number> {
  const f = esp(e);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM fin_contas WHERE tipo = 'receita' AND LOWER(nome) = LOWER(?) AND ${f.sql} ORDER BY ativo DESC, id LIMIT 1`,
    [nome, ...f.params]
  );
  if (rows[0]) return Number(rows[0].id);
  return (await criarConta(e, { nome, tipo: "receita" })).id;
}

/** Papel pelo id ou pelo ticker (na corretora informada; sem ela, a única que tem o papel). */
async function papelDoEvento(
  e: Espaco,
  inp: { papelContaId?: number | null; ticker?: string | null; corretoraId?: number | null }
): Promise<{ id: number; ticker: string; corretoraId: number }> {
  const f = esp(e);
  if (inp.papelContaId) {
    const [r] = await pool.query<RowDataPacket[]>(
      `SELECT id, papel, nome, corretora_contaid AS "cid" FROM fin_contas WHERE id = ? AND tipo = 'investimento' AND ${f.sql}`,
      [inp.papelContaId, ...f.params]
    );
    if (!r[0]) throw new FinErro("papel", "Papel não encontrado.");
    if (!r[0].cid) throw new FinErro("corretora", "Este papel não tem corretora cadastrada.");
    return { id: Number(r[0].id), ticker: normalizarTicker(String(r[0].papel ?? r[0].nome)), corretoraId: Number(r[0].cid) };
  }
  const ticker = normalizarTicker(inp.ticker ?? "");
  if (!ticker) throw new FinErro("papel", "Informe o papel (ticker).");
  const [rs] = await pool.query<RowDataPacket[]>(
    `SELECT id, corretora_contaid AS "cid" FROM fin_contas
     WHERE tipo = 'investimento' AND UPPER(papel) = ? AND ${f.sql} ${inp.corretoraId ? "AND corretora_contaid = ?" : ""}
     ORDER BY ativo DESC, id`,
    [ticker, ...f.params, ...(inp.corretoraId ? [inp.corretoraId] : [])]
  );
  if (!rs.length) throw new FinErro("papel", `Não há ${ticker} cadastrado${inp.corretoraId ? " nesta corretora" : ""}.`);
  if (rs.length > 1) throw new FinErro("papel", `${ticker} está em mais de uma corretora: escolha a corretora.`);
  return { id: Number(rs[0].id), ticker, corretoraId: Number(rs[0].cid) };
}

/**
 * Provento: dividendo, JCP, rendimento (FII) ou juros. O valor é o LÍQUIDO (o que caiu na corretora); no JCP, se vier o
 * bruto, a diferença fica como IR retido. Lançamento: grupo de receita (Dividendos, JCP…) → corretora. Não muda o custo.
 */
export async function registrarProvento(
  e: Espaco,
  inp: {
    papelContaId?: number | null; ticker?: string | null; corretoraId?: number | null;
    tipo: FinTipoProvento; data: string; valor: number; valorBruto?: number | null; origem: FinOrigemOperacao;
  }
): Promise<{ operacaoId: number; ticker: string }> {
  if (!(inp.valor > 0)) throw new FinErro("valor", "Informe o valor recebido.");
  const papel = await papelDoEvento(e, inp);
  const grupo = await grupoReceita(e, ROTULO_PROVENTO[inp.tipo]);
  const lote = randomUUID();
  const valor = r2(inp.valor);
  const bruto = inp.valorBruto && inp.valorBruto > valor ? r2(inp.valorBruto) : null;
  await criarLancamento(e, {
    data: inp.data,
    descricao: `${ROTULO_PROVENTO[inp.tipo]} ${papel.ticker}`,
    valor,
    contaOrigemId: grupo,
    contaDestinoId: papel.corretoraId,
    lote,
  });
  const [ins] = await pool.query<RowDataPacket[]>(
    `INSERT INTO fin_operacoes_inv (groupid, userid, data, operacao, subtipo, ticker, papel_contaid, corretora_contaid,
       valor_total, valor_bruto, ir_retido, origem, situacao, lote)
     VALUES (?, ?, ?, 'provento', ?, ?, ?, ?, ?, ?, ?, ?, 'relatada', ?) RETURNING id`,
    [e.groupId, e.userId, inp.data, inp.tipo, papel.ticker, papel.id, papel.corretoraId, valor, bruto, bruto ? r2(bruto - valor) : null, inp.origem, lote]
  );
  return { operacaoId: Number(ins[0].id), ticker: papel.ticker };
}

/**
 * Evento do papel. Desdobramento/grupamento "de:para" (1:2, 10:1): muda só a quantidade (o custo total fica, o preço
 * médio se ajusta). Bonificação percentual: entram floor(quantidade × %) ações; o custo atribuído pela empresa
 * (por ação) soma ao custo, contra o grupo de receita Bonificações.
 */
export async function registrarEvento(
  e: Espaco,
  inp: {
    papelContaId?: number | null; ticker?: string | null; corretoraId?: number | null;
    tipo: "desdobramento" | "grupamento" | "bonificacao"; data: string;
    de?: number | null; para?: number | null; percentual?: number | null; custoUnitario?: number | null; origem: FinOrigemOperacao;
  }
): Promise<{ operacaoId: number; ticker: string; quantidadeAntes: number; quantidadeDepois: number }> {
  const papel = await papelDoEvento(e, inp);
  const [p] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(quantidade), 0) AS "q" FROM fin_lancamentos WHERE (conta_origemid = ? OR conta_destinoid = ?) AND data <= ?`,
    [papel.id, papel.id, inp.data]
  );
  const q = Number(p[0]?.q ?? 0);
  if (!(q > 0)) throw new FinErro("posicao", `Sem posição de ${papel.ticker} em ${inp.data}.`);
  const lote = randomUUID();
  let delta: number;
  let fator: number;
  let custo = 0;
  if (inp.tipo === "bonificacao") {
    const pct = Number(inp.percentual ?? 0);
    if (!(pct > 0)) throw new FinErro("bonificacao", "Informe o percentual da bonificação (ex.: 10).");
    delta = Math.floor(q * pct / 100 + 1e-9);
    if (!(delta > 0)) throw new FinErro("bonificacao", "A bonificação não chega a uma ação com a posição atual.");
    fator = 1 + pct / 100;
    custo = r2(delta * Number(inp.custoUnitario ?? 0));
  } else {
    const de = Number(inp.de ?? 0);
    const para = Number(inp.para ?? 0);
    if (!(de > 0 && para > 0)) throw new FinErro("evento", "Informe a proporção (ex.: 1 para 2).");
    if (inp.tipo === "desdobramento" && para <= de) throw new FinErro("evento", "No desdobramento a quantidade aumenta (ex.: 1 para 2).");
    if (inp.tipo === "grupamento" && para >= de) throw new FinErro("evento", "No grupamento a quantidade diminui (ex.: 10 para 1).");
    fator = para / de;
    delta = Math.round((q * fator - q) * 1e6) / 1e6;
  }
  const desc =
    inp.tipo === "bonificacao" ? `Bonificação ${papel.ticker} (${inp.percentual}%)`
    : `${inp.tipo === "desdobramento" ? "Desdobramento" : "Grupamento"} ${papel.ticker} (${inp.de}:${inp.para})`;
  if (custo > 0) {
    const grupo = await grupoReceita(e, "Bonificações");
    await criarLancamento(e, { data: inp.data, descricao: desc, valor: custo, contaOrigemId: grupo, contaDestinoId: papel.id, quantidade: delta, lote });
  } else {
    // Só quantidade: lançamento do papel nele mesmo, valor 0
    await pool.query(
      `INSERT INTO fin_lancamentos (groupid, userid, data, descricao, valor, conta_origemid, conta_destinoid, quantidade, lote)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [e.groupId, e.userId, inp.data, desc, papel.id, papel.id, delta, lote]
    );
  }
  const [ins] = await pool.query<RowDataPacket[]>(
    `INSERT INTO fin_operacoes_inv (groupid, userid, data, operacao, subtipo, ticker, papel_contaid, corretora_contaid,
       quantidade, preco, valor_total, fator, origem, situacao, lote)
     VALUES (?, ?, ?, 'evento', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'relatada', ?) RETURNING id`,
    [e.groupId, e.userId, inp.data, inp.tipo, papel.ticker, papel.id, papel.corretoraId, delta, inp.custoUnitario ?? null,
      custo || null, fator, inp.origem, lote]
  );
  return { operacaoId: Number(ins[0].id), ticker: papel.ticker, quantidadeAntes: q, quantidadeDepois: Math.round((q + delta) * 1e6) / 1e6 };
}


// ── Posição inicial (quem já investia antes de começar a usar) ──────────────

export interface FinPosicaoInicialEntrada {
  papelContaId?: number | null;
  ticker?: string | null;
  corretoraId?: number | null;
  /** Data da posição (ex.: 31/12/2025): o acompanhamento começa depois dela. */
  data: string;
  quantidade: number;
  /** Preço médio por unidade (na moeda do papel); sem ele, o custo total. */
  precoMedio?: number | null;
  custoTotal?: number | null;
  /** Papel em outra moeda: quanto o custo vale em reais (sem ele, a cotação PTAX da data). */
  custoReais?: number | null;
  origem: FinOrigemOperacao;
}

/**
 * Posição inicial de um papel: quantidade e custo (preço médio) numa data, vindos do Saldo inicial (patrimônio) — sem
 * tirar dinheiro do caixa da corretora, como seria numa compra. Fica como operação "evento/posicao_inicial" (desfaz
 * pelo lote). Daí em diante, compras, vendas (ganho pelo preço médio informado), proventos e eventos seguem normais.
 */
export async function registrarPosicaoInicial(e: Espaco, inp: FinPosicaoInicialEntrada): Promise<{ operacaoId: number; ticker: string; custo: number }> {
  if (!(inp.quantidade > 0)) throw new FinErro("quantidade", "Informe a quantidade.");
  let papel: { id: number; ticker: string; moeda: string };
  let corretoraId: number;
  if (inp.papelContaId) {
    const p = await papelDoEvento(e, { papelContaId: inp.papelContaId });
    papel = { id: p.id, ticker: p.ticker, moeda: (await papelPorId(e, p.id)).moeda };
    corretoraId = p.corretoraId;
  } else {
    if (!inp.corretoraId) throw new FinErro("corretora", "Escolha a corretora.");
    papel = await resolverPapel(e, inp.ticker ?? "", inp.corretoraId, true);
    corretoraId = inp.corretoraId;
  }
  const custo = inp.custoTotal && inp.custoTotal > 0 ? inp.custoTotal : inp.precoMedio && inp.precoMedio > 0 ? inp.precoMedio * inp.quantidade : 0;
  if (!(custo > 0)) throw new FinErro("custo", "Informe o preço médio ou o custo total.");
  const moedaOutra = papel.moeda !== "BRL";
  const lote = randomUUID();
  const saldoInicial = await contaSistemaId(e, "saldo_inicial");
  await criarLancamento(e, {
    data: inp.data,
    descricao: `Posição inicial ${papel.ticker}`,
    valor: moedaOutra ? (inp.custoReais && inp.custoReais > 0 ? r2(inp.custoReais) : null) : r2(custo),
    valorMoeda: moedaOutra ? r2(custo) : null,
    contaOrigemId: saldoInicial,
    contaDestinoId: papel.id,
    quantidade: inp.quantidade,
    lote,
  });
  const [ins] = await pool.query<RowDataPacket[]>(
    `INSERT INTO fin_operacoes_inv (groupid, userid, data, operacao, subtipo, ticker, papel_contaid, corretora_contaid,
       quantidade, preco, valor_total, moeda, origem, situacao, lote)
     VALUES (?, ?, ?, 'evento', 'posicao_inicial', ?, ?, ?, ?, ?, ?, ?, ?, 'relatada', ?) RETURNING id`,
    [e.groupId, e.userId, inp.data, papel.ticker, papel.id, corretoraId, inp.quantidade,
      Math.round((custo / inp.quantidade) * 1e6) / 1e6, r2(custo), papel.moeda, inp.origem, lote]
  );
  return { operacaoId: Number(ins[0].id), ticker: papel.ticker, custo: r2(custo) };
}

/** Várias posições iniciais de uma corretora (lista colada ou CSV do relatório da corretora). */
export async function registrarPosicoesIniciais(
  e: Espaco,
  inp: { corretoraId: number; data: string; itens: { ticker: string; quantidade: number; precoMedio?: number | null; custoTotal?: number | null }[] }
): Promise<{ gravados: { ticker: string; operacaoId: number }[]; erros: string[] }> {
  const out = { gravados: [] as { ticker: string; operacaoId: number }[], erros: [] as string[] };
  for (const it of inp.itens) {
    try {
      const r = await registrarPosicaoInicial(e, {
        ticker: it.ticker, corretoraId: inp.corretoraId, data: inp.data, quantidade: it.quantidade,
        precoMedio: it.precoMedio ?? null, custoTotal: it.custoTotal ?? null, origem: "tela",
      });
      out.gravados.push({ ticker: r.ticker, operacaoId: r.operacaoId });
    } catch (err) {
      out.erros.push(`${it.ticker}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}
