import { randomUUID } from "node:crypto";
import {
  FIN_CONTAS_SISTEMA,
  FIN_MOEDA_CODIGOS,
  FIN_TIPOS_CONTA,
  finContaEhDinheiro,
  finMercadoPadrao,
  type FinMercado,
  finDataValida,
  finGerarParcelas,
  finOcorrencias,
  finSomarDias,
  type FinAgendaResposta,
  type FinChaveSistema,
  type FinConferencia,
  type FinConta,
  type FinContaSaldo,
  type FinItemAgenda,
  type FinLancamento,
  type FinPeriodicidade,
  type FinRecorrencia,
  type FinTipoConta,
} from "@mymemory/shared";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { assertUserWorkspaceGroupAccess } from "./memoContextService.js";
import { obterCotacao } from "./finCotacaoService.js";

/**
 * Controle financeiro — núcleo (desenho, seção 13). Livro de dois lados, títulos e o motor de recorrência.
 * Regras:
 *  - parcelado (prazo determinado) grava todos os títulos + um lançamento de competência contra a receber/a pagar;
 *  - recorrente (prazo indeterminado) não grava nada adiantado: o título nasce no pagamento, já quitado;
 *  - a receber/a pagar só se movem por títulos — o saldo delas sempre confere com os títulos abertos.
 */

export interface Espaco {
  groupId: number | null;
  userId: number;
}

export class FinErro extends Error {
  constructor(public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

type Conn = Pick<typeof pool, "query">;
type Tx = Awaited<ReturnType<typeof pool.getConnection>>;

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const nOuNull = (v: unknown): number | null => (v == null ? null : Number(v));
const r2 = (v: number): number => Math.round(v * 100) / 100;

export function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function exigirData(s: string, campo: string): void {
  if (!finDataValida(s)) throw new FinErro("data_invalida", `Data inválida em ${campo}: ${s}`);
}

/** Espaço atual do usuário: o grupo em que está trabalhando, ou o pessoal. */
export async function resolverEspaco(userId: number): Promise<Espaco> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT role, lastworkspacegroupid AS "gid" FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const gid = rows[0]?.gid == null ? null : Number(rows[0].gid);
  if (gid == null) return { groupId: null, userId };
  try {
    await assertUserWorkspaceGroupAccess(userId, gid, rows[0]?.role === "admin");
    return { groupId: gid, userId };
  } catch {
    return { groupId: null, userId };
  }
}

/** Filtro SQL do espaço (alias opcional). */
function esp(e: Espaco, alias = ""): { sql: string; params: unknown[] } {
  const p = alias ? `${alias}.` : "";
  return e.groupId != null
    ? { sql: `${p}groupid = ?`, params: [e.groupId] }
    : { sql: `${p}groupid IS NULL AND ${p}userid = ?`, params: [e.userId] };
}

/** Id do lançamento que acabou de ser gravado com estes dados (para o Desfazer do Fale comigo). */
export async function ultimoLancamentoId(
  e: Espaco,
  l: { data: string; origem: number; destino: number }
): Promise<number | null> {
  const f = esp(e);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(id) AS "id" FROM fin_lancamentos WHERE data = ? AND conta_origemid = ? AND conta_destinoid = ? AND ${f.sql}`,
    [l.data, l.origem, l.destino, ...f.params]
  );
  return rows[0]?.id == null ? null : Number(rows[0].id);
}

/* ---------------- Contas ---------------- */

async function contaSistema(c: Conn, e: Espaco, chave: FinChaveSistema): Promise<number> {
  const f = esp(e);
  const sel = async () => {
    const [r] = await c.query<RowDataPacket[]>(`SELECT id FROM fin_contas WHERE ${f.sql} AND chave = ? LIMIT 1`, [...f.params, chave]);
    return r[0] ? Number(r[0].id) : null;
  };
  const existe = await sel();
  if (existe) return existe;
  const def = FIN_CONTAS_SISTEMA[chave];
  await c.query(
    `INSERT INTO fin_contas (groupid, userid, nome, tipo, chave) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    [e.groupId, e.userId, def.nome, def.tipo, chave]
  );
  const id = await sel();
  if (!id) throw new FinErro("conta_sistema", "Não foi possível criar a conta do sistema.");
  return id;
}

interface ContaRow {
  id: number;
  tipo: FinTipoConta;
  nome: string;
  chave: string | null;
  ativo: boolean;
  moeda: string;
}

async function obterConta(c: Conn, e: Espaco, id: number, tipos?: FinTipoConta[], campo = "conta"): Promise<ContaRow> {
  const f = esp(e);
  const [r] = await c.query<RowDataPacket[]>(
    `SELECT id, tipo, nome, chave, ativo, moeda FROM fin_contas WHERE id = ? AND ${f.sql} LIMIT 1`,
    [id, ...f.params]
  );
  if (!r[0]) throw new FinErro("conta_nao_encontrada", `A ${campo} não existe neste espaço.`);
  const conta: ContaRow = { id: Number(r[0].id), tipo: r[0].tipo, nome: r[0].nome, chave: r[0].chave, ativo: n(r[0].ativo) === 1, moeda: String(r[0].moeda).trim() };
  if (tipos && !tipos.includes(conta.tipo)) {
    const rot = tipos.map((t) => FIN_TIPOS_CONTA.find((x) => x.tipo === t)?.rotulo ?? t).join(", ");
    throw new FinErro("conta_tipo", `A ${campo} "${conta.nome}" não serve aqui (esperado: ${rot}).`);
  }
  return conta;
}

export async function listarContasComSaldo(e: Espaco, de: string, ate: string): Promise<FinContaSaldo[]> {
  exigirData(de, "de");
  exigirData(ate, "até");
  const f = esp(e, "c");
  // Despesa/receita: total do período. Demais: posição acumulada até "ate".
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.nome, c.tipo, c.chave, c.papel, c.corretora_contaid AS "corretoraContaId", c.ativo, c.moeda, c.mercado,
       COALESCE((SELECT SUM(l.valor_moeda) FROM fin_lancamentos l WHERE l.conta_destinoid = c.id AND l.data <= ?), 0) AS "entradasMoeda",
       COALESCE((SELECT SUM(l.valor_moeda) FROM fin_lancamentos l WHERE l.conta_origemid = c.id AND l.data <= ?), 0) AS "saidasMoeda",
       COALESCE((SELECT SUM(l.valor) FROM fin_lancamentos l WHERE l.conta_destinoid = c.id AND l.data <= ?
                 AND (c.tipo NOT IN ('despesa','receita') OR l.data >= ?)), 0) AS "entradas",
       COALESCE((SELECT SUM(l.valor) FROM fin_lancamentos l WHERE l.conta_origemid = c.id AND l.data <= ?
                 AND (c.tipo NOT IN ('despesa','receita') OR l.data >= ?)), 0) AS "saidas",
       CASE WHEN c.tipo = 'investimento' THEN
         (SELECT COALESCE(SUM(l.quantidade), 0) FROM fin_lancamentos l
          WHERE (l.conta_destinoid = c.id OR l.conta_origemid = c.id) AND l.data <= ?)
       END AS "qtd"
     FROM fin_contas c WHERE ${f.sql}
     ORDER BY c.tipo, c.nome`,
    [ate, ate, ate, de, ate, de, ate, ...f.params]
  );
  // Cotação de cada moeda estrangeira na data final (ou hoje, se o período ainda não acabou)
  const dataCot = ate < hojeSaoPaulo() ? ate : hojeSaoPaulo();
  const cotacoes = new Map<string, { data: string; valor: number } | null>();
  for (const m of new Set(rows.map((r) => String(r.moeda).trim()).filter((m) => m !== "BRL"))) {
    cotacoes.set(m, await obterCotacao(m, dataCot).catch(() => null));
  }
  return rows.map((r) => {
    const tipo = r.tipo as FinTipoConta;
    const ent = n(r.entradas);
    const sai = n(r.saidas);
    const ativoOuDespesa = ["banco", "corretora", "investimento", "a_receber", "despesa"].includes(tipo);
    const saldo = r2(ativoOuDespesa ? ent - sai : sai - ent);
    const qtd = tipo === "investimento" ? n(r.qtd) : null;
    const moeda = String(r.moeda).trim();
    const estrangeira = moeda !== "BRL";
    const saldoMoeda = estrangeira ? r2(tipo === "cartao" ? n(r.saidasMoeda) - n(r.entradasMoeda) : n(r.entradasMoeda) - n(r.saidasMoeda)) : null;
    const cot = estrangeira ? cotacoes.get(moeda) ?? null : null;
    return {
      id: Number(r.id),
      nome: r.nome,
      tipo,
      chave: r.chave,
      papel: r.papel,
      corretoraContaId: nOuNull(r.corretoraContaId),
      ativo: n(r.ativo) === 1,
      saldo,
      quantidade: qtd,
      custoMedio: qtd && qtd > 0 ? Math.round((saldo / qtd) * 1e6) / 1e6 : null,
      moeda,
      mercado: (r.mercado as FinMercado | null) ?? null,
      saldoMoeda,
      custoMedioMoeda: estrangeira && qtd && qtd > 0 && saldoMoeda != null ? Math.round((saldoMoeda / qtd) * 1e6) / 1e6 : null,
      cotacao: cot,
      // Valor de hoje só para dinheiro em moeda (o preço de um papel não temos)
      valorHoje: estrangeira && cot && saldoMoeda != null && tipo !== "investimento" ? r2(saldoMoeda * cot.valor) : null,
    };
  });
}

export async function criarConta(
  e: Espaco,
  inp: {
    nome: string; tipo: FinTipoConta; papel?: string | null; corretoraContaId?: number | null; moeda?: string | null;
    mercado?: FinMercado | null; saldoInicial?: number | null; saldoInicialReais?: number | null; dataSaldo?: string | null;
  }
): Promise<FinConta> {
  const def = FIN_TIPOS_CONTA.find((t) => t.tipo === inp.tipo);
  if (!def?.manual) throw new FinErro("tipo_invalido", "Este tipo de conta é criado pelo sistema.");
  const nome = inp.nome.trim();
  if (!nome) throw new FinErro("nome_vazio", "Informe o nome da conta.");
  const moeda = finContaEhDinheiro(inp.tipo) ? (inp.moeda || "BRL").toUpperCase() : "BRL";
  if (!FIN_MOEDA_CODIGOS.includes(moeda)) throw new FinErro("moeda", `Moeda não suportada: ${moeda}.`);
  const mercado = finContaEhDinheiro(inp.tipo) ? inp.mercado || finMercadoPadrao(moeda) : null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let corretora: number | null = null;
    if (inp.tipo === "investimento" && inp.corretoraContaId) {
      corretora = (await obterConta(conn, e, inp.corretoraContaId, ["corretora", "banco"], "corretora")).id;
    }
    const [ins] = await conn.query<RowDataPacket[]>(
      `INSERT INTO fin_contas (groupid, userid, nome, tipo, papel, corretora_contaid, moeda, mercado) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [e.groupId, e.userId, nome, inp.tipo, inp.tipo === "investimento" ? inp.papel?.trim().toUpperCase() || null : null, corretora, moeda, mercado]
    );
    const id = Number(ins[0].id);
    const si = inp.saldoInicial ?? 0;
    if (si && ["banco", "corretora", "cartao"].includes(inp.tipo)) {
      const data = inp.dataSaldo || hojeSaoPaulo();
      exigirData(data, "data do saldo");
      const pat = await contaSistema(conn, e, "saldo_inicial");
      // Banco/corretora: saldo inicial → conta. Cartão (dívida): conta → saldo inicial. Negativo inverte.
      const entra = inp.tipo === "cartao" ? si < 0 : si > 0;
      // Em outra moeda: o saldo vem na moeda; o custo em reais é o informado ou a cotação PTAX da data
      let reais = Math.abs(si);
      let cot: number | null = null;
      if (moeda !== "BRL") {
        if (inp.saldoInicialReais != null && inp.saldoInicialReais > 0) reais = r2(inp.saldoInicialReais);
        else {
          const c = await obterCotacao(moeda, data);
          if (!c) throw new FinErro("cotacao", `Sem cotação do ${moeda} em ${data}. Informe quanto o saldo custou em reais.`);
          reais = r2(Math.abs(si) * c.valor);
        }
        cot = Math.round((reais / Math.abs(si)) * 1e8) / 1e8;
      }
      await conn.query(
        `INSERT INTO fin_lancamentos (groupid, userid, data, descricao, valor, conta_origemid, conta_destinoid, valor_moeda, moeda, cotacao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.groupId, e.userId, data, `Saldo inicial — ${nome}`, reais, entra ? pat : id, entra ? id : pat,
          moeda !== "BRL" ? Math.abs(si) : null, moeda !== "BRL" ? moeda : null, cot]
      );
    }
    await conn.commit();
    return { id, nome, tipo: inp.tipo, chave: null, papel: inp.papel ?? null, corretoraContaId: corretora, moeda, mercado, ativo: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function atualizarConta(e: Espaco, id: number, inp: { nome?: string; ativo?: boolean; mercado?: FinMercado }): Promise<void> {
  const c = await obterConta(pool, e, id);
  if (c.chave) throw new FinErro("conta_sistema", "Contas do sistema não podem ser alteradas.");
  if (inp.nome !== undefined && inp.nome.trim()) await pool.query(`UPDATE fin_contas SET nome = ? WHERE id = ?`, [inp.nome.trim(), id]);
  if (inp.ativo !== undefined) await pool.query(`UPDATE fin_contas SET ativo = ? WHERE id = ?`, [inp.ativo ? 1 : 0, id]);
  if (inp.mercado !== undefined) {
    if (!finContaEhDinheiro(c.tipo)) throw new FinErro("mercado", "Só banco, corretora, cartão e investimento têm mercado.");
    await pool.query(`UPDATE fin_contas SET mercado = ? WHERE id = ?`, [inp.mercado, id]);
  }
}

/* ---------------- Recorrências ---------------- */

interface RegraRow {
  id: number;
  sentido: "pagar" | "receber";
  descricao: string;
  valor: number;
  periodicidade: FinPeriodicidade;
  inicio: string;
  fim: string | null;
  contaGrupoId: number;
  contaGrupoNome: string;
  contaPagamentoId: number | null;
  ativo: boolean;
  criadoEm: string;
}

async function listarRegras(c: Conn, e: Espaco, somenteAtivas: boolean, id?: number): Promise<RegraRow[]> {
  const f = esp(e, "r");
  const [rows] = await c.query<RowDataPacket[]>(
    `SELECT r.id, r.sentido, r.descricao, r.valor, r.periodicidade,
       to_char(r.inicio, 'YYYY-MM-DD') AS "inicio", to_char(r.fim, 'YYYY-MM-DD') AS "fim",
       r.conta_grupoid AS "contaGrupoId", g.nome AS "contaGrupoNome", r.conta_pagamentoid AS "contaPagamentoId",
       r.ativo, to_char(r.criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS "criadoEm"
     FROM fin_recorrencias r JOIN fin_contas g ON g.id = r.conta_grupoid
     WHERE ${f.sql} ${somenteAtivas ? "AND r.ativo = 1" : ""} ${id ? "AND r.id = ?" : ""}
     ORDER BY r.sentido, r.descricao`,
    [...f.params, ...(id ? [id] : [])]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    sentido: r.sentido,
    descricao: r.descricao,
    valor: n(r.valor),
    periodicidade: r.periodicidade,
    inicio: r.inicio,
    fim: r.fim,
    contaGrupoId: Number(r.contaGrupoId),
    contaGrupoNome: r.contaGrupoNome,
    contaPagamentoId: nOuNull(r.contaPagamentoId),
    ativo: n(r.ativo) === 1,
    criadoEm: r.criadoEm,
  }));
}

export async function listarRecorrencias(e: Espaco): Promise<(FinRecorrencia & { excecoes: { referencia: string; valor: number | null; pular: boolean }[] })[]> {
  const regras = await listarRegras(pool, e, false);
  const exc = await excecoesDe(pool, regras.map((r) => r.id));
  return regras.map(({ criadoEm: _c, ...r }) => ({
    ...r,
    excecoes: [...(exc.get(r.id)?.entries() ?? [])].map(([referencia, x]) => ({ referencia, ...x })),
  }));
}

function grupoDoSentido(sentido: "pagar" | "receber"): FinTipoConta[] {
  return sentido === "pagar" ? ["despesa"] : ["receita"];
}
function pagamentoDoSentido(sentido: "pagar" | "receber"): FinTipoConta[] {
  return sentido === "pagar" ? ["banco", "corretora", "cartao"] : ["banco", "corretora"];
}

/** Títulos e recorrências são em reais: pagar/receber só por conta em real (câmbio é lançamento à parte). */
function exigirReal(c: ContaRow): ContaRow {
  if (c.moeda !== "BRL") throw new FinErro("moeda", `A conta "${c.nome}" é em ${c.moeda}. Contas a pagar e receber usam conta em reais; o câmbio é um lançamento.`);
  return c;
}

export async function criarRecorrencia(
  e: Espaco,
  inp: { sentido: "pagar" | "receber"; descricao: string; valor: number; periodicidade: FinPeriodicidade; inicio: string; fim?: string | null; contaGrupoId: number; contaPagamentoId?: number | null }
): Promise<number> {
  exigirData(inp.inicio, "início");
  if (inp.fim) {
    exigirData(inp.fim, "fim");
    if (inp.fim < inp.inicio) throw new FinErro("fim_antes", "O fim é anterior ao início.");
  }
  await obterConta(pool, e, inp.contaGrupoId, grupoDoSentido(inp.sentido), "conta do grupo");
  if (inp.contaPagamentoId) exigirReal(await obterConta(pool, e, inp.contaPagamentoId, pagamentoDoSentido(inp.sentido), "conta de pagamento"));
  const [r] = await pool.query<RowDataPacket[]>(
    `INSERT INTO fin_recorrencias (groupid, userid, sentido, descricao, valor, periodicidade, inicio, fim, conta_grupoid, conta_pagamentoid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [e.groupId, e.userId, inp.sentido, inp.descricao.trim(), r2(inp.valor), inp.periodicidade, inp.inicio, inp.fim || null, inp.contaGrupoId, inp.contaPagamentoId || null]
  );
  return Number(r[0].id);
}

/** Reajuste/encerramento: vale para as ocorrências que ainda não viraram título. */
export async function atualizarRecorrencia(
  e: Espaco,
  id: number,
  inp: { descricao?: string; valor?: number; fim?: string | null; contaGrupoId?: number; contaPagamentoId?: number | null; ativo?: boolean }
): Promise<void> {
  const [regra] = await listarRegras(pool, e, false, id);
  if (!regra) throw new FinErro("nao_encontrado", "Recorrência não encontrada.");
  const sets: string[] = [];
  const params: unknown[] = [];
  if (inp.descricao !== undefined && inp.descricao.trim()) { sets.push("descricao = ?"); params.push(inp.descricao.trim()); }
  if (inp.valor !== undefined) { sets.push("valor = ?"); params.push(r2(inp.valor)); }
  if (inp.fim !== undefined) {
    if (inp.fim) {
      exigirData(inp.fim, "fim");
      if (inp.fim < regra.inicio) throw new FinErro("fim_antes", "O fim é anterior ao início.");
    }
    sets.push("fim = ?"); params.push(inp.fim || null);
  }
  if (inp.contaGrupoId !== undefined) {
    await obterConta(pool, e, inp.contaGrupoId, grupoDoSentido(regra.sentido), "conta do grupo");
    sets.push("conta_grupoid = ?"); params.push(inp.contaGrupoId);
  }
  if (inp.contaPagamentoId !== undefined) {
    if (inp.contaPagamentoId) exigirReal(await obterConta(pool, e, inp.contaPagamentoId, pagamentoDoSentido(regra.sentido), "conta de pagamento"));
    sets.push("conta_pagamentoid = ?"); params.push(inp.contaPagamentoId || null);
  }
  if (inp.ativo !== undefined) { sets.push("ativo = ?"); params.push(inp.ativo ? 1 : 0); }
  if (!sets.length) return;
  await pool.query(`UPDATE fin_recorrencias SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
}

async function excecoesDe(c: Conn, ids: number[]): Promise<Map<number, Map<string, { valor: number | null; pular: boolean }>>> {
  const out = new Map<number, Map<string, { valor: number | null; pular: boolean }>>();
  if (!ids.length) return out;
  const [rows] = await c.query<RowDataPacket[]>(
    `SELECT recorrenciaid AS "rid", to_char(referencia, 'YYYY-MM-DD') AS "ref", valor, pular
     FROM fin_recorrencia_excecoes WHERE recorrenciaid = ANY(?::int[]) ORDER BY referencia`,
    [ids]
  );
  for (const r of rows) {
    const rid = Number(r.rid);
    if (!out.has(rid)) out.set(rid, new Map());
    out.get(rid)!.set(r.ref, { valor: nOuNull(r.valor), pular: n(r.pular) === 1 });
  }
  return out;
}

function exigirOcorrencia(regra: RegraRow, referencia: string): void {
  exigirData(referencia, "referência");
  const ok = finOcorrencias(regra, referencia, referencia).includes(referencia);
  if (!ok) throw new FinErro("referencia_invalida", `${referencia} não é um vencimento de "${regra.descricao}".`);
}

/** Exceção de um mês: outro valor ou pular. Não é título (não é obrigação). */
export async function definirExcecao(
  e: Espaco,
  recorrenciaId: number,
  referencia: string,
  inp: { valor?: number | null; pular?: boolean } | null
): Promise<void> {
  const [regra] = await listarRegras(pool, e, false, recorrenciaId);
  if (!regra) throw new FinErro("nao_encontrado", "Recorrência não encontrada.");
  exigirOcorrencia(regra, referencia);
  if (inp == null) {
    await pool.query(`DELETE FROM fin_recorrencia_excecoes WHERE recorrenciaid = ? AND referencia = ?`, [recorrenciaId, referencia]);
    return;
  }
  const [t] = await pool.query<RowDataPacket[]>(`SELECT 1 FROM fin_titulos WHERE recorrenciaid = ? AND referencia = ?`, [recorrenciaId, referencia]);
  if (t[0]) throw new FinErro("ja_pago", "Este vencimento já foi pago. Desfaça o pagamento antes.");
  await pool.query(
    `INSERT INTO fin_recorrencia_excecoes (recorrenciaid, referencia, valor, pular) VALUES (?, ?, ?, ?)
     ON CONFLICT (recorrenciaid, referencia) DO UPDATE SET valor = EXCLUDED.valor, pular = EXCLUDED.pular`,
    [recorrenciaId, referencia, inp.pular ? null : inp.valor != null ? r2(inp.valor) : null, inp.pular ? 1 : 0]
  );
}

/* ---------------- Títulos (prazo determinado) ---------------- */

export async function criarParcelado(
  e: Espaco,
  inp: {
    sentido: "pagar" | "receber";
    descricao: string;
    valorTotal: number;
    parcelas: number;
    primeiroVencimento: string;
    periodicidade?: FinPeriodicidade;
    contaGrupoId: number;
    dataCompetencia?: string | null;
  }
): Promise<{ lote: string; titulos: number }> {
  exigirData(inp.primeiroVencimento, "primeiro vencimento");
  const competencia = inp.dataCompetencia || hojeSaoPaulo();
  exigirData(competencia, "data da compra/venda");
  if (inp.parcelas < 1 || inp.parcelas > 360) throw new FinErro("parcelas", "Parcelas entre 1 e 360.");
  if (!(inp.valorTotal > 0)) throw new FinErro("valor", "Informe o valor total.");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const grupo = await obterConta(conn, e, inp.contaGrupoId, grupoDoSentido(inp.sentido), "conta do grupo");
    const controle = await contaSistema(conn, e, inp.sentido === "pagar" ? "a_pagar" : "a_receber");
    const lote = randomUUID();
    const parcelas = finGerarParcelas(inp.valorTotal, inp.parcelas, inp.primeiroVencimento, inp.periodicidade ?? "mensal");
    const desc = inp.descricao.trim();
    for (const p of parcelas) {
      await conn.query(
        `INSERT INTO fin_titulos (groupid, userid, sentido, descricao, valor, vencimento, conta_grupoid, lote, parcela, parcelas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.groupId, e.userId, inp.sentido, desc, p.valor, p.vencimento, grupo.id, lote, p.parcela, parcelas.length]
      );
    }
    // Competência: a despesa/receita nasce na data da compra/venda, contra a pagar/a receber
    await conn.query(
      `INSERT INTO fin_lancamentos (groupid, userid, data, descricao, valor, conta_origemid, conta_destinoid, lote)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.groupId, e.userId, competencia,
        parcelas.length > 1 ? `${desc} (${parcelas.length}x)` : desc,
        r2(inp.valorTotal),
        inp.sentido === "pagar" ? controle : grupo.id,
        inp.sentido === "pagar" ? grupo.id : controle,
        lote,
      ]
    );
    await conn.commit();
    return { lote, titulos: parcelas.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function excluirLote(e: Espaco, lote: string): Promise<void> {
  const f = esp(e);
  const [ts] = await pool.query<RowDataPacket[]>(`SELECT situacao FROM fin_titulos WHERE lote = ? AND ${f.sql}`, [lote, ...f.params]);
  if (!ts.length) throw new FinErro("nao_encontrado", "Parcelamento não encontrado.");
  if (ts.some((t) => t.situacao === "quitado")) {
    throw new FinErro("tem_pagas", "Há parcelas pagas. Desfaça os pagamentos antes de excluir o parcelamento.");
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM fin_lancamentos WHERE lote = ? AND ${f.sql}`, [lote, ...f.params]);
    await conn.query(`DELETE FROM fin_titulos WHERE lote = ? AND ${f.sql}`, [lote, ...f.params]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ---------------- Baixa (pagar / receber) ---------------- */

async function lancar(
  c: Tx,
  e: Espaco,
  l: {
    data: string; descricao: string; valor: number; origem: number; destino: number; tituloId?: number | null; lote?: string | null;
    quantidade?: number | null; preco?: number | null; valorMoeda?: number | null; moeda?: string | null;
  }
): Promise<void> {
  if (l.valor === 0 && !l.quantidade && !l.valorMoeda) return;
  const vm = l.moeda && l.moeda !== "BRL" && l.valorMoeda != null ? r2(l.valorMoeda) : null;
  await c.query(
    `INSERT INTO fin_lancamentos (groupid, userid, data, descricao, valor, conta_origemid, conta_destinoid, quantidade, preco, tituloid, lote,
       valor_moeda, moeda, cotacao)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.groupId, e.userId, l.data, l.descricao, r2(l.valor), l.origem, l.destino, l.quantidade ?? null, l.preco ?? null, l.tituloId ?? null, l.lote ?? null,
      vm, vm != null ? l.moeda : null, vm ? Math.round((r2(l.valor) / vm) * 1e8) / 1e8 : null]
  );
}

/**
 * Paga ou recebe: um título aberto (parcelado) ou uma ocorrência de recorrência (o título nasce agora, quitado).
 * Tudo na mesma transação.
 */
export async function baixar(
  e: Espaco,
  inp: { tituloId?: number | null; recorrenciaId?: number | null; referencia?: string | null; data: string; valorPago?: number | null; contaPagamentoId: number }
): Promise<{ tituloId: number }> {
  exigirData(inp.data, "data do pagamento");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const f = esp(e);
    let tituloId: number;

    if (inp.tituloId) {
      const [ts] = await conn.query<RowDataPacket[]>(
        `SELECT id, sentido, descricao, valor, situacao FROM fin_titulos WHERE id = ? AND ${f.sql} FOR UPDATE`,
        [inp.tituloId, ...f.params]
      );
      const t = ts[0];
      if (!t) throw new FinErro("nao_encontrado", "Título não encontrado.");
      if (t.situacao !== "aberto") throw new FinErro("ja_pago", "Este título já foi pago.");
      const sentido = t.sentido as "pagar" | "receber";
      const conta = exigirReal(await obterConta(conn, e, inp.contaPagamentoId, pagamentoDoSentido(sentido), "conta de pagamento"));
      const valor = n(t.valor);
      const vp = inp.valorPago != null ? r2(inp.valorPago) : valor;
      if (!(vp > 0)) throw new FinErro("valor", "Informe o valor pago.");
      const desc = String(t.descricao);
      tituloId = Number(t.id);
      if (sentido === "pagar") {
        const ctl = await contaSistema(conn, e, "a_pagar");
        await lancar(conn, e, { data: inp.data, descricao: desc, valor: Math.min(vp, valor), origem: conta.id, destino: ctl, tituloId });
        if (vp > valor) await lancar(conn, e, { data: inp.data, descricao: `${desc} — juros/multa`, valor: vp - valor, origem: conta.id, destino: await contaSistema(conn, e, "juros_pagos"), tituloId });
        if (vp < valor) await lancar(conn, e, { data: inp.data, descricao: `${desc} — desconto`, valor: valor - vp, origem: await contaSistema(conn, e, "descontos_obtidos"), destino: ctl, tituloId });
      } else {
        const ctl = await contaSistema(conn, e, "a_receber");
        await lancar(conn, e, { data: inp.data, descricao: desc, valor: Math.min(vp, valor), origem: ctl, destino: conta.id, tituloId });
        if (vp > valor) await lancar(conn, e, { data: inp.data, descricao: `${desc} — juros/multa`, valor: vp - valor, origem: await contaSistema(conn, e, "juros_recebidos"), destino: conta.id, tituloId });
        if (vp < valor) await lancar(conn, e, { data: inp.data, descricao: `${desc} — desconto`, valor: valor - vp, origem: ctl, destino: await contaSistema(conn, e, "descontos_concedidos"), tituloId });
      }
      await conn.query(
        `UPDATE fin_titulos SET situacao = 'quitado', quitado_em = ?, valor_pago = ?, conta_pagamentoid = ? WHERE id = ?`,
        [inp.data, vp, conta.id, tituloId]
      );
    } else if (inp.recorrenciaId && inp.referencia) {
      const [regra] = await listarRegras(conn, e, false, inp.recorrenciaId);
      if (!regra) throw new FinErro("nao_encontrado", "Recorrência não encontrada.");
      exigirOcorrencia(regra, inp.referencia);
      const exc = (await excecoesDe(conn, [regra.id])).get(regra.id)?.get(inp.referencia);
      if (exc?.pular) throw new FinErro("pulado", "Este vencimento está marcado para pular. Desmarque antes de pagar.");
      const conta = exigirReal(await obterConta(conn, e, inp.contaPagamentoId, pagamentoDoSentido(regra.sentido), "conta de pagamento"));
      const previsto = exc?.valor ?? regra.valor;
      const vp = inp.valorPago != null ? r2(inp.valorPago) : previsto;
      if (!(vp > 0)) throw new FinErro("valor", "Informe o valor pago.");
      let ins: RowDataPacket[];
      try {
        [ins] = await conn.query<RowDataPacket[]>(
          `INSERT INTO fin_titulos (groupid, userid, sentido, descricao, valor, vencimento, situacao, conta_grupoid,
             recorrenciaid, referencia, quitado_em, valor_pago, conta_pagamentoid)
           VALUES (?, ?, ?, ?, ?, ?, 'quitado', ?, ?, ?, ?, ?, ?) RETURNING id`,
          [e.groupId, e.userId, regra.sentido, regra.descricao, previsto, inp.referencia, regra.contaGrupoId, regra.id, inp.referencia, inp.data, vp, conta.id]
        );
      } catch (err) {
        if ((err as { code?: string }).code === "23505") throw new FinErro("ja_pago", "Este vencimento já foi pago.");
        throw err;
      }
      tituloId = Number(ins[0].id);
      // Nasce no pagamento: direto entre a conta e o grupo, sem passar por a pagar/a receber
      await lancar(conn, e, {
        data: inp.data,
        descricao: regra.descricao,
        valor: vp,
        origem: regra.sentido === "pagar" ? conta.id : regra.contaGrupoId,
        destino: regra.sentido === "pagar" ? regra.contaGrupoId : conta.id,
        tituloId,
      });
    } else {
      throw new FinErro("alvo", "Informe o título ou a recorrência e o vencimento.");
    }
    await conn.commit();
    return { tituloId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function desfazerBaixa(e: Espaco, tituloId: number): Promise<void> {
  const f = esp(e);
  const [ts] = await pool.query<RowDataPacket[]>(
    `SELECT id, situacao, recorrenciaid AS "rid" FROM fin_titulos WHERE id = ? AND ${f.sql}`,
    [tituloId, ...f.params]
  );
  const t = ts[0];
  if (!t) throw new FinErro("nao_encontrado", "Título não encontrado.");
  if (t.situacao !== "quitado") throw new FinErro("nao_pago", "Este título não está pago.");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM fin_lancamentos WHERE tituloid = ?`, [tituloId]);
    if (t.rid != null) {
      // Título de recorrência só existia por causa do pagamento: volta a ser ocorrência prevista
      await conn.query(`DELETE FROM fin_titulos WHERE id = ?`, [tituloId]);
    } else {
      await conn.query(
        `UPDATE fin_titulos SET situacao = 'aberto', quitado_em = NULL, valor_pago = NULL, conta_pagamentoid = NULL WHERE id = ?`,
        [tituloId]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ---------------- Agenda: títulos + projeção do motor ---------------- */

export async function agenda(e: Espaco, de: string, ate: string): Promise<FinAgendaResposta> {
  exigirData(de, "de");
  exigirData(ate, "até");
  const hoje = hojeSaoPaulo();
  const f = esp(e, "t");
  const itens: FinItemAgenda[] = [];

  // Títulos: abertos até "ate" (inclui atrasados anteriores ao período) e quitados no período
  const [ts] = await pool.query<RowDataPacket[]>(
    `SELECT t.id, t.sentido, t.descricao, t.valor, to_char(t.vencimento, 'YYYY-MM-DD') AS "venc", t.situacao,
       g.nome AS "grupo", t.recorrenciaid AS "rid", to_char(t.referencia, 'YYYY-MM-DD') AS "ref",
       t.parcela, t.parcelas, t.lote, to_char(t.quitado_em, 'YYYY-MM-DD') AS "quitadoEm", t.valor_pago AS "valorPago",
       t.conta_pagamentoid AS "contaPag"
     FROM fin_titulos t JOIN fin_contas g ON g.id = t.conta_grupoid
     WHERE ${f.sql}
       AND ((t.situacao = 'aberto' AND t.vencimento <= ? AND (t.vencimento >= ? OR t.vencimento < ?))
         OR (t.situacao = 'quitado' AND t.quitado_em BETWEEN ? AND ?))`,
    [...f.params, ate, de, hoje, de, ate]
  );
  for (const t of ts) {
    const pago = t.situacao === "quitado";
    itens.push({
      chave: `t:${t.id}`,
      origem: "titulo",
      situacao: pago ? "pago" : t.venc < hoje ? "atraso" : "confirmado",
      sentido: t.sentido,
      descricao: t.descricao,
      vencimento: t.venc,
      valor: n(t.valor),
      contaGrupoNome: t.grupo,
      tituloId: Number(t.id),
      recorrenciaId: nOuNull(t.rid),
      referencia: t.ref,
      parcela: nOuNull(t.parcela),
      parcelas: nOuNull(t.parcelas),
      lote: t.lote,
      quitadoEm: t.quitadoEm,
      valorPago: nOuNull(t.valorPago),
      contaPagamentoId: nOuNull(t.contaPag),
    });
  }

  // Motor: ocorrências das regras ativas que ainda não viraram título
  const regras = await listarRegras(pool, e, true);
  if (regras.length) {
    const ids = regras.map((r) => r.id);
    const [feitos] = await pool.query<RowDataPacket[]>(
      `SELECT recorrenciaid AS "rid", to_char(referencia, 'YYYY-MM-DD') AS "ref" FROM fin_titulos WHERE recorrenciaid = ANY(?::int[])`,
      [ids]
    );
    const jaTem = new Set(feitos.map((x) => `${x.rid}:${x.ref}`));
    const exc = await excecoesDe(pool, ids);
    const umAnoAtras = finSomarDias(hoje, -366);
    for (const r of regras) {
      // Atraso conta a partir do mês em que a regra foi cadastrada (o anterior é histórico) e no máximo 1 ano
      const desdeCadastro = `${r.criadoEm.slice(0, 7)}-01`;
      const pisoAtraso = [r.inicio, desdeCadastro, umAnoAtras].sort().at(-1)!;
      const deCalc = de < pisoAtraso ? de : pisoAtraso;
      for (const ref of finOcorrencias(r, deCalc, ate)) {
        if (jaTem.has(`${r.id}:${ref}`)) continue;
        const x = exc.get(r.id)?.get(ref);
        if (x?.pular) continue;
        const atraso = ref < hoje;
        if (atraso && ref < pisoAtraso) continue;
        if (!atraso && ref < de) continue;
        itens.push({
          chave: `r:${r.id}:${ref}`,
          origem: "recorrencia",
          situacao: atraso ? "atraso" : "previsto",
          sentido: r.sentido,
          descricao: r.descricao,
          vencimento: ref,
          valor: x?.valor ?? r.valor,
          contaGrupoNome: r.contaGrupoNome,
          tituloId: null,
          recorrenciaId: r.id,
          referencia: ref,
          parcela: null,
          parcelas: null,
          lote: null,
          quitadoEm: null,
          valorPago: null,
          contaPagamentoId: r.contaPagamentoId,
        });
      }
    }
  }

  itens.sort((a, b) => (a.situacao === "pago" ? a.quitadoEm ?? "" : a.vencimento).localeCompare(b.situacao === "pago" ? b.quitadoEm ?? "" : b.vencimento));
  const soma = (fn: (i: FinItemAgenda) => boolean, campo: (i: FinItemAgenda) => number = (i) => i.valor) =>
    r2(itens.filter(fn).reduce((s, i) => s + campo(i), 0));
  const aberto = (i: FinItemAgenda) => i.situacao === "previsto" || i.situacao === "confirmado";
  return {
    de,
    ate,
    hoje,
    itens,
    totais: {
      pagarPrevisto: soma((i) => aberto(i) && i.sentido === "pagar"),
      receberPrevisto: soma((i) => aberto(i) && i.sentido === "receber"),
      pagarAtraso: soma((i) => i.situacao === "atraso" && i.sentido === "pagar"),
      receberAtraso: soma((i) => i.situacao === "atraso" && i.sentido === "receber"),
      pago: soma((i) => i.situacao === "pago" && i.sentido === "pagar", (i) => i.valorPago ?? i.valor),
      recebido: soma((i) => i.situacao === "pago" && i.sentido === "receber", (i) => i.valorPago ?? i.valor),
    },
  };
}

/* ---------------- Lançamentos manuais e investimentos ---------------- */

export async function listarLancamentos(e: Espaco, de: string, ate: string, contaId?: number | null): Promise<FinLancamento[]> {
  exigirData(de, "de");
  exigirData(ate, "até");
  const f = esp(e, "l");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT l.id, to_char(l.data, 'YYYY-MM-DD') AS "data", l.descricao, l.valor,
       l.conta_origemid AS "contaOrigemId", o.nome AS "contaOrigemNome",
       l.conta_destinoid AS "contaDestinoId", d.nome AS "contaDestinoNome",
       l.quantidade, l.preco, l.tituloid AS "tituloId", l.valor_moeda AS "valorMoeda", l.moeda, l.cotacao
     FROM fin_lancamentos l
     JOIN fin_contas o ON o.id = l.conta_origemid
     JOIN fin_contas d ON d.id = l.conta_destinoid
     WHERE ${f.sql} AND l.data BETWEEN ? AND ? ${contaId ? "AND (l.conta_origemid = ? OR l.conta_destinoid = ?)" : ""}
     ORDER BY l.data DESC, l.id DESC
     LIMIT 1000`,
    [...f.params, de, ate, ...(contaId ? [contaId, contaId] : [])]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    data: r.data,
    descricao: r.descricao,
    valor: n(r.valor),
    contaOrigemId: Number(r.contaOrigemId),
    contaOrigemNome: r.contaOrigemNome,
    contaDestinoId: Number(r.contaDestinoId),
    contaDestinoNome: r.contaDestinoNome,
    quantidade: nOuNull(r.quantidade),
    preco: nOuNull(r.preco),
    tituloId: nOuNull(r.tituloId),
    valorMoeda: nOuNull(r.valorMoeda),
    moeda: r.moeda ? String(r.moeda).trim() : null,
    cotacao: nOuNull(r.cotacao),
  }));
}

/** Posição de uma conta até a data: custo em reais, saldo na moeda (contas estrangeiras) e quantidade. */
async function posicao(c: Conn, contaId: number, data: string): Promise<{ reais: number; moeda: number; qtd: number }> {
  const [p] = await c.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN conta_destinoid = ? THEN valor ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN conta_origemid = ? THEN valor ELSE 0 END), 0) AS "reais",
       COALESCE(SUM(CASE WHEN conta_destinoid = ? THEN valor_moeda ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN conta_origemid = ? THEN valor_moeda ELSE 0 END), 0) AS "moeda",
       COALESCE(SUM(quantidade), 0) AS "qtd"
     FROM fin_lancamentos WHERE (conta_destinoid = ? OR conta_origemid = ?) AND data <= ?`,
    [contaId, contaId, contaId, contaId, contaId, contaId, data]
  );
  return { reais: n(p[0]?.reais), moeda: n(p[0]?.moeda), qtd: n(p[0]?.qtd) };
}

/**
 * Lançamento livre: débito, compra no cartão, fatura, transferência, aplicação, dividendo, desdobramento, câmbio.
 * A receber/a pagar ficam de fora — só se movem por títulos (senão deixam de conferir).
 * Quantidade (investimento): positiva entra no papel de destino; origem = destino = mesmo papel com valor 0
 * é desdobramento/grupamento/bonificação.
 * Moedas (13.10): o livro fecha em reais; o lado em outra moeda guarda também o valor na moeda.
 *  - real → moeda (dinheiro): câmbio — informar os dois valores; a cotação sai deles;
 *  - receita/saldo inicial → moeda: reais = informado ou PTAX da data;
 *  - moeda → moeda, ou moeda → despesa: sai pelo custo médio em reais da conta de origem;
 *  - moeda → real (dinheiro): câmbio de volta — sai pelo custo médio; a diferença é ganho ou perda cambial.
 */
export async function criarLancamento(
  e: Espaco,
  inp: {
    data: string; descricao: string; valor?: number | null; valorMoeda?: number | null;
    contaOrigemId: number; contaDestinoId: number; quantidade?: number | null; preco?: number | null;
  }
): Promise<{ valor: number; resultado: number | null }> {
  exigirData(inp.data, "data");
  const valorInf = inp.valor ?? null;
  const vmInf = inp.valorMoeda ?? null;
  if ((valorInf != null && valorInf < 0) || (vmInf != null && vmInf < 0)) throw new FinErro("valor", "O valor não pode ser negativo.");
  const proibidos = ["a_receber", "a_pagar"];
  const o = await obterConta(pool, e, inp.contaOrigemId, undefined, "conta de origem");
  const d = await obterConta(pool, e, inp.contaDestinoId, undefined, "conta de destino");
  if (proibidos.includes(o.tipo) || proibidos.includes(d.tipo)) {
    throw new FinErro("conta_controle", "Contas a receber e a pagar só se movem por títulos (parcelado ou pagamento).");
  }
  const desc = inp.descricao.trim() || "Lançamento";

  // Desdobramento / grupamento / bonificação: só quantidade
  if (o.id === d.id) {
    if (o.tipo !== "investimento" || !inp.quantidade) throw new FinErro("mesma_conta", "Origem e destino são a mesma conta.");
    if (valorInf || vmInf) throw new FinErro("valor", "Desdobramento/grupamento/bonificação vai com valor 0 (só muda a quantidade).");
    const conn = await pool.getConnection();
    try {
      await lancar(conn, e, { data: inp.data, descricao: desc, valor: 0, origem: o.id, destino: d.id, quantidade: inp.quantidade });
    } finally {
      conn.release();
    }
    return { valor: 0, resultado: null };
  }

  let qtd: number | null = null;
  if (inp.quantidade) {
    if (d.tipo === "investimento") qtd = Math.abs(inp.quantidade);
    else if (o.tipo === "investimento") throw new FinErro("venda", "Para vender um papel use Venda de investimento (calcula o custo médio e o ganho).");
    else throw new FinErro("conta_tipo", "Quantidade só vale quando uma das contas é um investimento.");
  } else if (o.tipo === "investimento" && d.tipo !== "investimento") {
    throw new FinErro("venda", "Para vender um papel use Venda de investimento (calcula o custo médio e o ganho).");
  }

  const mo = o.moeda;
  const md = d.moeda;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let valor: number;
    let vm: number | null = null;
    let moeda: string | null = null;
    let resultado: number | null = null;
    const lote = randomUUID();

    if (mo === "BRL" && md === "BRL") {
      if (!(valorInf != null && valorInf > 0)) throw new FinErro("valor", "Informe o valor.");
      valor = r2(valorInf);
      await lancar(conn, e, { data: inp.data, descricao: desc, valor, origem: o.id, destino: d.id, quantidade: qtd });
    } else {
      if (mo !== "BRL" && md !== "BRL" && mo !== md) {
        throw new FinErro("moeda", `De ${mo} para ${md} não é direto: converta passando por uma conta em reais.`);
      }
      moeda = mo !== "BRL" ? mo : md;
      if (!(vmInf != null && vmInf > 0)) throw new FinErro("valor", `Informe o valor em ${moeda}.`);
      vm = r2(vmInf);

      if (mo === "BRL") {
        // Entra dinheiro na conta em moeda
        if (finContaEhDinheiro(o.tipo)) {
          if (!(valorInf != null && valorInf > 0)) throw new FinErro("valor", "Câmbio: informe quanto saiu em reais.");
          valor = r2(valorInf);
        } else if (valorInf != null && valorInf > 0) {
          valor = r2(valorInf);
        } else {
          const c = await obterCotacao(moeda, inp.data);
          if (!c) throw new FinErro("cotacao", `Sem cotação do ${moeda} em ${inp.data}. Informe o valor em reais.`);
          valor = r2(vm * c.valor);
        }
        await lancar(conn, e, { data: inp.data, descricao: desc, valor, origem: o.id, destino: d.id, quantidade: qtd, valorMoeda: vm, moeda });
      } else {
        // Sai da conta em moeda: pelo custo médio em reais
        const pos = await posicao(conn, o.id, inp.data);
        if (pos.moeda + 1e-9 < vm) throw new FinErro("saldo_moeda", `Saldo de ${o.nome} em ${inp.data}: ${pos.moeda} ${moeda}. Não dá para tirar ${vm}.`);
        const custo = r2((pos.reais / pos.moeda) * vm);
        if (md !== "BRL" || !finContaEhDinheiro(d.tipo)) {
          valor = custo;
          await lancar(conn, e, { data: inp.data, descricao: desc, valor, origem: o.id, destino: d.id, quantidade: qtd, valorMoeda: vm, moeda });
        } else {
          // Câmbio de volta para reais: diferença para o custo = ganho/perda cambial
          if (!(valorInf != null && valorInf > 0)) throw new FinErro("valor", "Câmbio: informe quanto entrou em reais.");
          valor = r2(valorInf);
          resultado = r2(valor - custo);
          await lancar(conn, e, { data: inp.data, descricao: desc, valor: custo, origem: o.id, destino: d.id, valorMoeda: vm, moeda, lote });
          if (resultado > 0) await lancar(conn, e, { data: inp.data, descricao: `${desc} — ganho cambial`, valor: resultado, origem: await contaSistema(conn, e, "ganho_cambial"), destino: d.id, lote });
          if (resultado < 0) await lancar(conn, e, { data: inp.data, descricao: `${desc} — perda cambial`, valor: -resultado, origem: d.id, destino: await contaSistema(conn, e, "perda_cambial"), lote });
        }
      }
    }
    await conn.commit();
    return { valor, resultado };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function excluirLancamento(e: Espaco, id: number): Promise<void> {
  const f = esp(e);
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT tituloid AS "tid", lote FROM fin_lancamentos WHERE id = ? AND ${f.sql}`, [id, ...f.params]);
  const l = rows[0];
  if (!l) throw new FinErro("nao_encontrado", "Lançamento não encontrado.");
  if (l.tid != null) throw new FinErro("de_titulo", "Este lançamento é de um pagamento: use Desfazer pagamento na agenda.");
  if (l.lote) {
    const [t] = await pool.query<RowDataPacket[]>(`SELECT 1 FROM fin_titulos WHERE lote = ? LIMIT 1`, [l.lote]);
    if (t[0]) throw new FinErro("de_parcelado", "Este lançamento é de um parcelamento: exclua o parcelamento na agenda.");
    await pool.query(`DELETE FROM fin_lancamentos WHERE lote = ? AND ${f.sql}`, [l.lote, ...f.params]);
    return;
  }
  await pool.query(`DELETE FROM fin_lancamentos WHERE id = ?`, [id]);
}

/**
 * Venda: sai do papel pelo custo médio; a diferença vira ganho ou perda.
 * Papel em outra moeda: valor e resultado na moeda; o ganho/perda entra em reais pela cotação da data.
 */
export async function venderInvestimento(
  e: Espaco,
  inp: { contaPapelId: number; contaDestinoId: number; data: string; quantidade: number; valorTotal: number }
): Promise<{ custo: number; resultado: number; moeda: string }> {
  exigirData(inp.data, "data");
  if (!(inp.quantidade > 0) || !(inp.valorTotal > 0)) throw new FinErro("valor", "Informe quantidade e valor da venda.");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const papel = await obterConta(conn, e, inp.contaPapelId, ["investimento"], "conta do papel");
    const dest = await obterConta(conn, e, inp.contaDestinoId, ["corretora", "banco"], "conta que recebe");
    const moeda = papel.moeda;
    if (dest.moeda !== moeda) throw new FinErro("moeda", `O papel é em ${moeda}; a venda tem de entrar numa conta em ${moeda}.`);
    const pos = await posicao(conn, papel.id, inp.data);
    if (inp.quantidade > pos.qtd + 1e-9) throw new FinErro("posicao", `Posição em ${inp.data}: ${pos.qtd}. Não dá para vender ${inp.quantidade}.`);
    const custoReais = r2((pos.reais / pos.qtd) * inp.quantidade);
    const estrangeira = moeda !== "BRL";
    const custo = estrangeira ? r2((pos.moeda / pos.qtd) * inp.quantidade) : custoReais;
    const resultado = r2(inp.valorTotal - custo);
    let resultadoReais = resultado;
    if (estrangeira && resultado !== 0) {
      const c = await obterCotacao(moeda, inp.data);
      if (!c) throw new FinErro("cotacao", `Sem cotação do ${moeda} em ${inp.data}.`);
      resultadoReais = r2(resultado * c.valor);
    }
    const lote = randomUUID();
    const desc = `Venda ${inp.quantidade} ${papel.nome}`;
    const m = estrangeira ? moeda : null;
    await lancar(conn, e, {
      data: inp.data, descricao: desc, valor: custoReais, origem: papel.id, destino: dest.id, lote,
      quantidade: -inp.quantidade, preco: Math.round((inp.valorTotal / inp.quantidade) * 1e6) / 1e6,
      valorMoeda: estrangeira ? custo : null, moeda: m,
    });
    if (resultado > 0) {
      await lancar(conn, e, { data: inp.data, descricao: `${desc} — ganho`, valor: resultadoReais, origem: await contaSistema(conn, e, "ganho_capital"), destino: dest.id, lote, valorMoeda: estrangeira ? resultado : null, moeda: m });
    }
    if (resultado < 0) {
      await lancar(conn, e, { data: inp.data, descricao: `${desc} — perda`, valor: -resultadoReais, origem: dest.id, destino: await contaSistema(conn, e, "perda_capital"), lote, valorMoeda: estrangeira ? -resultado : null, moeda: m });
    }
    await conn.commit();
    return { custo, resultado, moeda };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ---------------- Conferência (13.8) ---------------- */

export async function conferencia(e: Espaco): Promise<FinConferencia> {
  const hoje = "9999-12-31";
  const contas = await listarContasComSaldo(e, "0001-01-01", hoje);
  const f = esp(e);
  const [ts] = await pool.query<RowDataPacket[]>(
    `SELECT sentido, COALESCE(SUM(valor), 0) AS "total" FROM fin_titulos WHERE ${f.sql} AND situacao = 'aberto' GROUP BY sentido`,
    f.params
  );
  const tit = (s: string) => r2(n(ts.find((x) => x.sentido === s)?.total));
  const saldo = (chave: string) => contas.find((c) => c.chave === chave)?.saldo ?? 0;
  const out = {
    aReceberSaldo: saldo("a_receber"),
    aReceberTitulos: tit("receber"),
    aPagarSaldo: saldo("a_pagar"),
    aPagarTitulos: tit("pagar"),
  };
  return { ...out, ok: out.aReceberSaldo === out.aReceberTitulos && out.aPagarSaldo === out.aPagarTitulos };
}
