/**
 * Correção de um lançamento já gravado (gasto, receita ou transferência): pelo ✎ na lista de lançamentos do Fale
 * comigo ou pela frase "corrigir a compra do mercado". Abre o mesmo Form da confirmação, com os valores atuais; o
 * Salvar corrige o mesmo lançamento (não cria outro) e o Desfazer volta aos valores de antes.
 *
 * Compra parcelada no cartão (lote sem título): conta e grupo mudam em todas as parcelas; valor, data e descrição só
 * na parcela corrigida. Lançamento de pagamento de título, de investimento ou em outra moeda não se corrige aqui.
 */
import type {
  FinComandoProposta,
  FinComandoTipo,
  FinCorrecaoCandidato,
  FinCorrecaoEscolha,
  FinCorrecaoValores,
} from "@mymemory/shared";
import { finDataValida } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { invokeLLM } from "../lib/invokeLlm.js";
import { obterFinConfig } from "./finConfigService.js";
import { esp, FinErro, hojeSaoPaulo, listarContasComSaldo, obterConta, type Espaco } from "./financeiroService.js";

const r2 = (v: number) => Math.round(v * 100) / 100;
const DINHEIRO = ["banco", "cartao", "corretora"];

interface LancRow {
  id: number;
  data: string;
  descricao: string;
  valor: number;
  origem: number;
  destino: number;
  oTipo: string;
  dTipo: string;
  oNome: string;
  dNome: string;
  lote: string | null;
  tituloId: number | null;
  moeda: string | null;
}

async function lerLancamento(e: Espaco, id: number): Promise<LancRow> {
  const f = esp(e, "l");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT l.id, to_char(l.data, 'YYYY-MM-DD') AS "data", l.descricao, l.valor, l.conta_origemid AS "origem",
       l.conta_destinoid AS "destino", o.tipo AS "oTipo", d.tipo AS "dTipo", o.nome AS "oNome", d.nome AS "dNome",
       l.lote, l.tituloid AS "tituloId", l.moeda
     FROM fin_lancamentos l
     JOIN fin_contas o ON o.id = l.conta_origemid
     JOIN fin_contas d ON d.id = l.conta_destinoid
     WHERE l.id = ? AND ${f.sql}`,
    [id, ...f.params]
  );
  const r = rows[0];
  if (!r) throw new FinErro("nao_encontrado", "Lançamento não encontrado neste espaço.");
  return {
    id: Number(r.id),
    data: String(r.data),
    descricao: String(r.descricao ?? ""),
    valor: Number(r.valor),
    origem: Number(r.origem),
    destino: Number(r.destino),
    oTipo: String(r.oTipo),
    dTipo: String(r.dTipo),
    oNome: String(r.oNome),
    dNome: String(r.dNome),
    lote: r.lote ?? null,
    tituloId: r.tituloId == null ? null : Number(r.tituloId),
    moeda: r.moeda ?? null,
  };
}

/** Gasto (conta → despesa), receita (receita → conta) ou transferência (conta → conta); o resto não se corrige aqui. */
function tipoDoLancamento(l: LancRow): "gasto" | "receita" | "transferencia" | null {
  if (DINHEIRO.includes(l.oTipo) && l.dTipo === "despesa") return "gasto";
  if (l.oTipo === "receita" && DINHEIRO.includes(l.dTipo)) return "receita";
  if (DINHEIRO.includes(l.oTipo) && DINHEIRO.includes(l.dTipo)) return "transferencia";
  return null;
}

async function exigirCorrigivel(e: Espaco, l: LancRow): Promise<{ tipo: "gasto" | "receita" | "transferencia"; parcelas: number }> {
  if (l.tituloId != null) {
    throw new FinErro("de_titulo", "Este lançamento é o pagamento de uma conta: desfaça o pagamento na agenda e pague de novo.");
  }
  if (l.moeda && l.moeda !== "BRL") throw new FinErro("moeda", "Lançamento em outra moeda (câmbio): exclua e lance de novo.");
  const tipo = tipoDoLancamento(l);
  if (!tipo) throw new FinErro("nao_corrigivel", "Só gasto, receita e transferência se corrigem aqui. Para os outros, exclua e lance de novo.");
  let parcelas = 1;
  if (l.lote) {
    const f = esp(e);
    const [t] = await pool.query<RowDataPacket[]>(`SELECT 1 FROM fin_titulos WHERE lote = ? LIMIT 1`, [l.lote]);
    if (t[0]) throw new FinErro("de_parcelado", "Este lançamento é de um parcelamento: corrija o parcelamento na agenda.");
    const [op] = await pool.query<RowDataPacket[]>(`SELECT 1 FROM fin_operacoes_inv WHERE lote = ? AND ${f.sql} LIMIT 1`, [l.lote, ...f.params]);
    if (op[0]) throw new FinErro("investimento", "Lançamento de investimento: exclua a operação e lance de novo.");
    const [c] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS "n" FROM fin_lancamentos WHERE lote = ? AND ${f.sql}`, [l.lote, ...f.params]);
    parcelas = Number(c[0]?.n ?? 1);
  }
  return { tipo, parcelas };
}

/** Form de correção: a proposta com os valores atuais (e, se a frase disse, os novos já aplicados). */
export async function propostaDeCorrecao(
  e: Espaco,
  lancamentoId: number,
  novos?: Partial<{ contaId: number | null; grupoId: number | null; valor: number | null; data: string | null; descricao: string | null }>,
  mensagem?: string
): Promise<FinComandoProposta> {
  const l = await lerLancamento(e, lancamentoId);
  const { tipo, parcelas } = await exigirCorrigivel(e, l);
  const hoje = hojeSaoPaulo();
  const contasTodas = (await listarContasComSaldo(e, hoje, hoje)).filter((c) => c.ativo || c.id === l.origem || c.id === l.destino);
  const contas = contasTodas
    .filter((c) => DINHEIRO.includes(c.tipo))
    .map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, moeda: c.moeda }));
  const gruposDespesa = contasTodas.filter((c) => c.tipo === "despesa").map((c) => ({ id: c.id, nome: c.nome }));
  const gruposReceita = contasTodas.filter((c) => c.tipo === "receita").map((c) => ({ id: c.id, nome: c.nome }));
  const existe = (id: number | null | undefined, lista: { id: number }[]) => (id != null && lista.some((x) => x.id === id) ? id : null);

  let contaId = tipo === "receita" ? l.destino : l.origem;
  let grupoId: number | null = tipo === "gasto" ? l.destino : tipo === "receita" ? l.origem : null;
  let contaDestinoId: number | null = tipo === "transferencia" ? l.destino : null;
  let valor = l.valor;
  let data = l.data;
  let descricao = l.descricao;
  const mudou: string[] = [];
  if (novos) {
    const c = existe(novos.contaId, contas);
    if (c != null && c !== contaId) (contaId = c), mudou.push("conta");
    const g = existe(novos.grupoId, tipo === "gasto" ? gruposDespesa : gruposReceita);
    if (g != null && tipo !== "transferencia" && g !== grupoId) (grupoId = g), mudou.push("grupo");
    if (novos.valor != null && novos.valor > 0 && r2(novos.valor) !== valor) (valor = r2(novos.valor)), mudou.push("valor");
    if (novos.data && finDataValida(novos.data) && novos.data !== data) (data = novos.data), mudou.push("data");
    if (novos.descricao?.trim() && novos.descricao.trim() !== descricao) (descricao = novos.descricao.trim().slice(0, 200)), mudou.push("descrição");
  }
  const antes: FinCorrecaoValores = { descricao: l.descricao, valor: l.valor, data: l.data, contaOrigemId: l.origem, contaDestinoId: l.destino };
  const dataBr = `${l.data.slice(8, 10)}/${l.data.slice(5, 7)}/${l.data.slice(0, 4)}`;
  const brl = l.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const msg =
    mensagem ??
    `Corrigir "${l.descricao}" de ${brl} em ${dataBr}${mudou.length ? ` (já ajustei: ${mudou.join(", ")})` : ""}: confira e toque em Salvar.` +
      (parcelas > 1 ? ` Compra em ${parcelas} parcelas: conta e grupo mudam em todas; valor e data só nesta.` : "");
  return {
    tipo: tipo as FinComandoTipo,
    sentido: tipo === "receita" ? "receber" : "pagar",
    descricao,
    valor,
    data,
    parcelas: 1,
    periodicidade: "mensal",
    contaId,
    grupoId,
    contaDestinoId,
    alvoChave: null,
    mensagem: msg,
    config: await obterFinConfig(e),
    gravado: null,
    opcoes: { contas, gruposDespesa, gruposReceita, abertos: [], papeis: [] },
    correcao: { lancamentoId: l.id, parcelas, antes },
  };
}

/** Grava a correção. Devolve os valores de antes (para o Desfazer). */
export async function corrigirLancamento(e: Espaco, lancamentoId: number, novo: FinCorrecaoValores): Promise<{ antes: FinCorrecaoValores; mensagem: string }> {
  const l = await lerLancamento(e, lancamentoId);
  const { tipo } = await exigirCorrigivel(e, l);
  if (!finDataValida(novo.data)) throw new FinErro("data_invalida", "Data inválida.");
  if (!(novo.valor > 0)) throw new FinErro("valor", "Informe o valor.");
  const o = await obterConta(pool, e, novo.contaOrigemId, undefined, "conta de origem");
  const d = await obterConta(pool, e, novo.contaDestinoId, undefined, "conta de destino");
  if (o.id === d.id) throw new FinErro("mesma_conta", "Origem e destino são a mesma conta.");
  if (o.moeda !== "BRL" || d.moeda !== "BRL") throw new FinErro("moeda", "Conta em outra moeda: use câmbio.");
  // O tipo do lançamento não muda na correção (gasto continua gasto)
  const ok =
    tipo === "gasto"
      ? DINHEIRO.includes(o.tipo) && d.tipo === "despesa"
      : tipo === "receita"
        ? o.tipo === "receita" && DINHEIRO.includes(d.tipo)
        : DINHEIRO.includes(o.tipo) && DINHEIRO.includes(d.tipo);
  if (!ok) throw new FinErro("conta_tipo", "A correção não muda o tipo do lançamento: para trocar (ex.: gasto → transferência), exclua e lance de novo.");

  const antes: FinCorrecaoValores = { descricao: l.descricao, valor: l.valor, data: l.data, contaOrigemId: l.origem, contaDestinoId: l.destino };
  const f = esp(e);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE fin_lancamentos SET descricao = ?, valor = ?, data = ? WHERE id = ?`, [
      novo.descricao.trim().slice(0, 200) || l.descricao,
      r2(novo.valor),
      novo.data,
      l.id,
    ]);
    // Conta e grupo: no lote (compra parcelada), todas as parcelas
    if (l.lote) {
      await conn.query(`UPDATE fin_lancamentos SET conta_origemid = ?, conta_destinoid = ? WHERE lote = ? AND ${f.sql}`, [o.id, d.id, l.lote, ...f.params]);
    } else {
      await conn.query(`UPDATE fin_lancamentos SET conta_origemid = ?, conta_destinoid = ? WHERE id = ?`, [o.id, d.id, l.id]);
    }
    // Fatura do cartão recalculada (menos as movidas à mão): conta trocada ou data mudada mudam a fatura
    await conn.query(
      `UPDATE fin_lancamentos x SET fatura = CASE
          WHEN co.tipo = 'cartao' AND co.dia_fechamento IS NOT NULL AND co.dia_vencimento IS NOT NULL
            THEN public.fin_fatura_de(x.data, co.dia_fechamento, co.dia_vencimento)
          WHEN cd.tipo = 'cartao' AND cd.dia_fechamento IS NOT NULL AND cd.dia_vencimento IS NOT NULL
            THEN CASE WHEN co.tipo IN ('banco', 'corretora') THEN public.fin_fatura_pagamento(x.data, cd.dia_fechamento, cd.dia_vencimento)
                      ELSE public.fin_fatura_de(x.data, cd.dia_fechamento, cd.dia_vencimento) END
          ELSE NULL END
       FROM fin_contas co, fin_contas cd
       WHERE co.id = x.conta_origemid AND cd.id = x.conta_destinoid AND x.fatura_manual = 0
         AND ${l.lote ? `x.lote = ? AND ${esp(e, "x").sql}` : "x.id = ?"}`,
      l.lote ? [l.lote, ...esp(e, "x").params] : [l.id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { antes, mensagem: `Lançamento corrigido (${tipo === "gasto" ? "gasto" : tipo === "receita" ? "receita" : "transferência"} de ${r2(novo.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).` };
}

/** Frase de correção ("corrigir a compra do mercado", "corrige o gasto de ontem: foi no Itaú"). */
export function fraseDeCorrecao(frase: string): boolean {
  const t = frase.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return /^(por favor,? )?(corrig\w*|corrij\w*|editar|edita|edite|alterar o lancamento|altera o lancamento|ajustar o lancamento|ajusta o lancamento|consertar|conserta)\b/.test(t)
    // Palavra de dinheiro; lista de compras, agenda etc. são memos (seguem o comando de alteração)
    && /\b(lancamentos?|compras?|gastos?|despesas?|receitas?|transferencias?|pix|debito|valor|reais|r\$)/.test(t)
    && !/\b(lista|agenda|reuniao|tarefa|compromisso|medicao|peso)\b/.test(t);
}

/**
 * Acha o(s) lançamento(s) da frase entre os recentes (gasto, receita, transferência dos últimos 120 dias) e o que a
 * frase já diz para mudar. Um só → Form de correção; vários → lista para escolher; nenhum → mensagem.
 */
export async function correcaoPelaFrase(input: { texto: string; userId: number; groupId: number | null }): Promise<{
  proposta: FinComandoProposta | null;
  candidatos: FinCorrecaoCandidato[];
  mensagem: string;
  costUsd: number;
  novos?: FinCorrecaoEscolha["novos"];
}> {
  const e: Espaco = { groupId: input.groupId, userId: input.userId };
  const hoje = hojeSaoPaulo();
  const f = esp(e, "l");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT l.id, to_char(l.data, 'YYYY-MM-DD') AS "data", l.descricao, l.valor, o.nome AS "oNome", d.nome AS "dNome",
       o.tipo AS "oTipo", d.tipo AS "dTipo"
     FROM fin_lancamentos l
     JOIN fin_contas o ON o.id = l.conta_origemid
     JOIN fin_contas d ON d.id = l.conta_destinoid
     WHERE ${f.sql} AND l.tituloid IS NULL AND COALESCE(l.moeda, 'BRL') = 'BRL'
       AND l.data >= (?::date - 120)
       AND ((o.tipo IN ('banco','cartao','corretora') AND d.tipo IN ('despesa','banco','cartao','corretora'))
            OR (o.tipo = 'receita' AND d.tipo IN ('banco','cartao','corretora')))
       AND NOT EXISTS (SELECT 1 FROM fin_operacoes_inv op WHERE op.lote = l.lote)
     ORDER BY l.data DESC, l.id DESC
     LIMIT 150`,
    [...f.params, hoje]
  );
  const lista: FinCorrecaoCandidato[] = rows.map((r) => {
    const gasto = r.dTipo === "despesa";
    const receita = r.oTipo === "receita";
    return {
      lancamentoId: Number(r.id),
      data: String(r.data),
      descricao: String(r.descricao ?? ""),
      valor: Number(r.valor),
      conta: String(receita ? r.dNome : r.oNome) + (!gasto && !receita ? ` → ${r.dNome}` : ""),
      grupo: gasto ? String(r.dNome) : receita ? String(r.oNome) : null,
    };
  });
  if (!lista.length) {
    return { proposta: null, candidatos: [], mensagem: "Não há lançamentos recentes para corrigir.", costUsd: 0 };
  }
  const contas = (await listarContasComSaldo(e, hoje, hoje)).filter((c) => c.ativo);
  const system =
    "Você acha qual lançamento financeiro o usuário quer corrigir e o que mudar. Responda só JSON: " +
    '{"alvos":[ids],"novos":{"contaId":null,"grupoId":null,"valor":null,"data":null,"descricao":null}}. ' +
    "alvos: ids da lista que combinam com a frase (descrição, valor, data, conta, grupo; 'ontem', 'dia 10' a partir de hoje). " +
    "Se a frase não diz qual (ex.: 'corrigir a compra' com várias compras), devolva os mais prováveis (até 8, o mais recente primeiro). " +
    "Se diz 'o último'/'a última', só o mais recente que combina. novos: só o que a frase manda mudar ('foi no Itaú' → contaId da conta Itaú; " +
    "'foram 95' → valor 95; 'era alimentação' → grupoId); ids só das listas; o resto null.";
  const user = JSON.stringify({
    frase: input.texto,
    hoje,
    lancamentos: lista.map((c) => ({ id: c.lancamentoId, data: c.data, descricao: c.descricao, valor: c.valor, conta: c.conta, grupo: c.grupo })),
    contas: contas.filter((c) => DINHEIRO.includes(c.tipo)).map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo })),
    grupos: contas.filter((c) => c.tipo === "despesa" || c.tipo === "receita").map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo })),
  });
  const { text, costUsd } = await invokeLLM({ system, user, jsonObject: true, temperature: 0, source: "fin_correcao" });
  let j: { alvos?: unknown; novos?: Record<string, unknown> } = {};
  try {
    const t = text.trim();
    j = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  } catch {
    j = {};
  }
  const porId = new Map(lista.map((c) => [c.lancamentoId, c]));
  const alvos = (Array.isArray(j.alvos) ? j.alvos : [])
    .map((x) => Number(x))
    .filter((id, i, arr) => porId.has(id) && arr.indexOf(id) === i)
    .slice(0, 8);
  const nv = j.novos ?? {};
  const num = (x: unknown) => (x == null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);
  const novos = {
    contaId: num(nv.contaId),
    grupoId: num(nv.grupoId),
    valor: num(nv.valor),
    data: typeof nv.data === "string" ? nv.data : null,
    descricao: typeof nv.descricao === "string" ? nv.descricao : null,
  };
  if (!alvos.length) {
    return {
      proposta: null,
      candidatos: lista.slice(0, 8),
      mensagem: "Não achei qual lançamento corrigir. Escolha um dos mais recentes, ou diga mais detalhes (valor, data, onde).",
      costUsd,
      novos,
    };
  }
  if (alvos.length > 1) {
    return {
      proposta: null,
      candidatos: alvos.map((id) => porId.get(id)!),
      mensagem: `Achei ${alvos.length} lançamentos que podem ser o certo. Qual corrigir?`,
      costUsd,
      novos,
    };
  }
  try {
    const proposta = await propostaDeCorrecao(e, alvos[0]!, novos);
    return { proposta, candidatos: [], mensagem: proposta.mensagem, costUsd };
  } catch (err) {
    const msg = err instanceof FinErro ? err.message : "Não consegui abrir a correção.";
    return { proposta: null, candidatos: [], mensagem: msg, costUsd };
  }
}
