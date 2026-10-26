/**
 * Alteração de memos de categoria "atualizável" (agenda, tarefas, pedidos) a partir da resposta do
 * Perguntar: o usuário muda campos ou a situação (Ativo, Concluído, Cancelado) e salva — sem
 * confirmação extra; a proteção é o "Desfazer". O campo é a fonte da verdade: depois de gravar os
 * campos, a IA reescreve o resumo a partir das mudanças, o histórico vai para memo_alteracoes e o
 * vetor é refeito (só se o memo já tinha vetor).
 *
 * Podem alterar: o dono (userid), quem catalogou (criado_por) e owners/editores do grupo (ou admin).
 */
import crypto from "node:crypto";
import type { MemoAlteracaoResponse, MemoAlteravelResponse } from "@mymemory/shared";
import { normalizarDataParaIso } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { config } from "../config.js";
import { openaiChatJson } from "../lib/openaiChat.js";
import { upsertMemoChunks } from "../lib/openaiEmbedding.js";
import { sincronizarDadosEspecificosDoMemo } from "./memoService.js";
import { podeGerirImportacao } from "./donoMemoService.js";

/** Linha de memo_alteracoes que guarda o resumo anterior/novo (não é campo da categoria). */
const CAMPO_RESUMO = "__resumo";

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "");
const norm = (s: string) => semAcento(s).toLowerCase().trim();

interface MemoBase {
  id: number;
  userId: number;
  criadoPor: number | null;
  groupId: number | null;
  category: string | null;
  mediaText: string;
  keywords: string | null;
  dados: Record<string, unknown>;
}

interface CategoriaAtualizavel {
  id: number;
  nome: string;
  campoSituacao: string;
  campos: { nome: string; tipo: string; descricao: string | null }[];
}

function lerDados(texto: unknown): Record<string, unknown> {
  if (typeof texto !== "string" || !texto.trim()) return {};
  try {
    const v = JSON.parse(texto);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function carregarMemo(memoId: number): Promise<MemoBase | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, userid, criado_por AS "criadoPor", groupid, category, mediatext, keywords, dadosespecificosjson
     FROM memos WHERE id = ? AND isactive = 1 LIMIT 1`,
    [memoId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    userId: Number(r.userId),
    criadoPor: r.criadoPor != null ? Number(r.criadoPor) : null,
    groupId: r.groupId != null ? Number(r.groupId) : null,
    category: (r.category as string | null) ?? null,
    mediaText: String(r.mediaText ?? ""),
    keywords: (r.keywords as string | null) ?? null,
    dados: lerDados(r.dadosEspecificosJson),
  };
}

/** Categoria do memo, se for atualizável (a do grupo tem prioridade sobre a global de mesmo nome). */
async function categoriaAtualizavel(memo: MemoBase): Promise<CategoriaAtualizavel | null> {
  if (!memo.category) return null;
  const [cRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, atualizavel, campo_situacao AS "campoSituacao" FROM categories
     WHERE name = ? AND (groupid IS NOT DISTINCT FROM ? OR groupid IS NULL) AND isactive = 1
     ORDER BY groupid NULLS LAST LIMIT 1`,
    [memo.category, memo.groupId]
  );
  const c = cRows[0];
  if (!c || Number(c.atualizavel ?? 0) !== 1 || !c.campoSituacao) return null;
  const [fRows] = await pool.query<RowDataPacket[]>(
    `SELECT name, tipo, description FROM categorycampos WHERE categoryid = ? AND isactive = 1 ORDER BY id ASC`,
    [c.id]
  );
  return {
    id: Number(c.id),
    nome: String(c.name),
    campoSituacao: String(c.campoSituacao),
    campos: fRows.map((f) => ({
      nome: String(f.name),
      tipo: String(f.tipo ?? "text"),
      descricao: (f.description as string | null) ?? null,
    })),
  };
}

export async function podeAlterarMemo(memo: MemoBase, userId: number, isAdmin: boolean): Promise<boolean> {
  if (isAdmin || memo.userId === userId || (memo.criadoPor ?? memo.userId) === userId) return true;
  return memo.groupId != null && (await podeGerirImportacao(userId, memo.groupId, false));
}

/** Valor do campo no JSON do memo, sem diferenciar acento/maiúsculas no nome. */
function chaveDoCampo(dados: Record<string, unknown>, campo: string): string | null {
  const alvo = norm(campo);
  return Object.keys(dados).find((k) => norm(k) === alvo) ?? null;
}

function valorDoCampo(dados: Record<string, unknown>, campo: string): string {
  const k = chaveDoCampo(dados, campo);
  const v = k != null ? dados[k] : null;
  return v == null ? "" : String(v);
}

/** Dos ids informados, os memos atualizáveis que o usuário pode alterar. */
export async function filtrarMemosAlteraveis(ids: number[], userId: number, isAdmin: boolean): Promise<number[]> {
  const unicos = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
  if (!unicos.length) return [];
  const ph = unicos.map(() => "?").join(",");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.id FROM memos m
     WHERE m.id IN (${ph}) AND m.isactive = 1
       AND EXISTS (
         SELECT 1 FROM categories c
         WHERE c.name = m.category AND (c.groupid = m.groupid OR c.groupid IS NULL)
           AND c.isactive = 1 AND c.atualizavel = 1 AND c.campo_situacao IS NOT NULL
       )
       AND (? = 1 OR m.userid = ? OR COALESCE(m.criado_por, m.userid) = ?
            OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.groupid = m.groupid AND gm.userid = ?
                       AND gm.role IN ('owner', 'editor')))`,
    [...unicos, isAdmin ? 1 : 0, userId, userId, userId]
  );
  return rows.map((r) => Number(r.id));
}

async function carregarParaAlterar(memoId: number, userId: number, isAdmin: boolean) {
  const memo = await carregarMemo(memoId);
  if (!memo) throw new Error("not_found");
  const cat = await categoriaAtualizavel(memo);
  if (!cat) throw new Error("nao_atualizavel");
  if (!(await podeAlterarMemo(memo, userId, isAdmin))) throw new Error("forbidden");
  return { memo, cat };
}

export async function obterMemoAlteravel(memoId: number, userId: number, isAdmin: boolean): Promise<MemoAlteravelResponse> {
  const { memo, cat } = await carregarParaAlterar(memoId, userId, isAdmin);
  return {
    memoId: memo.id,
    categoria: cat.nome,
    resumo: memo.mediaText,
    campoSituacao: cat.campoSituacao,
    situacao: valorDoCampo(memo.dados, cat.campoSituacao) || "Ativo",
    campos: cat.campos
      .filter((c) => c.nome !== cat.campoSituacao)
      .map((c) => ({ nome: c.nome, tipo: c.tipo, descricao: c.descricao, valor: valorDoCampo(memo.dados, c.nome) })),
  };
}

/** Valor como será gravado: sem acento (padrão dos memos) e data em AAAA-MM-DD quando der. */
function valorParaGravar(valor: string, tipo: string): string {
  const v = valor.trim();
  if (!v) return "";
  if (tipo === "date") return normalizarDataParaIso(v) ?? semAcento(v);
  return semAcento(v);
}

/** IA reescreve o resumo refletindo as mudanças; sem IA (ou falha), acrescenta uma linha. */
async function reescreverResumo(
  resumo: string,
  mudancas: { campo: string; antes: string; depois: string }[]
): Promise<{ resumo: string; costUsd: number }> {
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const linhas = mudancas.map((m) => `${m.campo}: ${m.antes || "(vazio)"} → ${m.depois || "(vazio)"}`);
  const fallback = `${resumo.trim()}\nAtualizado em ${hoje}: ${linhas.join("; ")}.`;
  if (!config.openai.apiKey) return { resumo: fallback, costUsd: 0 };
  try {
    const { content, costUsd } = await openaiChatJson({
      source: "memo_alteracao_resumo",
      messages: [
        {
          role: "system",
          content:
            'Você atualiza o resumo de um memo depois que campos dele foram alterados. Responda APENAS JSON: {"resumo": string}. ' +
            "Reescreva o resumo refletindo os valores NOVOS, mantendo todo o resto (nomes, endereços, assuntos) exatamente como está e um tamanho semelhante. " +
            'Troque datas relativas ("amanhã", "sexta") pela data absoluta quando ela for conhecida pelos campos. ' +
            'Se a situação mudou para Cancelado ou Concluído, deixe isso claro no início (ex.: "CANCELADO — ..."). ' +
            'Pode citar o valor anterior entre parênteses quando ajudar (ex.: "às 15:00 (antes às 14:00)"). Escreva em português do Brasil.',
        },
        {
          role: "user",
          content: `Data de hoje: ${hoje}\n\nRESUMO ATUAL:\n${resumo}\n\nMUDANÇAS:\n${linhas.join("\n")}`,
        },
      ],
    });
    let novo = "";
    try {
      const j = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      novo = typeof j.resumo === "string" ? j.resumo.trim() : "";
    } catch {
      novo = "";
    }
    return { resumo: novo || fallback, costUsd };
  } catch (e) {
    console.warn("[memoAlteracao] resumo:", e instanceof Error ? e.message : e);
    return { resumo: fallback, costUsd: 0 };
  }
}

/** Grava campos + resumo, histórico, linhas de dadosespecificos e (em segundo plano) o vetor. */
async function gravar(input: {
  memo: MemoBase;
  catId: number | null;
  dados: Record<string, unknown>;
  resumo: string;
  historico: { campo: string; antes: string | null; depois: string | null }[];
  userId: number;
  origem: "edicao" | "situacao" | "desfazer";
  costUsd: number;
}): Promise<string> {
  const lote = crypto.randomUUID();
  const dadosJson = JSON.stringify(input.dados);
  await pool.query(`UPDATE memos SET dadosespecificosjson = ?, mediatext = ? WHERE id = ?`, [
    dadosJson,
    input.resumo,
    input.memo.id,
  ]);
  for (const h of input.historico) {
    await pool.query(
      `INSERT INTO memo_alteracoes (memoid, lote, userid, campo, antes, depois, origem) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.memo.id, lote, input.userId, h.campo, h.antes, h.depois, input.origem]
    );
  }
  await sincronizarDadosEspecificosDoMemo(input.memo.id, input.catId);
  if (input.costUsd > 0) {
    await pool
      .query(
        `INSERT INTO api_usage_logs (memoId, userId, operation, model, inputTokens, outputTokens, totalTokens, costUsd)
         VALUES (?, ?, 'memo_alteracao', 'aggregate', 0, 0, 0, ?)`,
        [input.memo.id, input.userId, input.costUsd]
      )
      .catch(() => {});
  }
  // Vetor só para memo que já tinha (respeita o nível de IA de quem catalogou)
  void (async () => {
    const [c] = await pool.query<RowDataPacket[]>(`SELECT 1 AS x FROM memo_chunks WHERE memo_id = ? LIMIT 1`, [input.memo.id]);
    if (!c.length) return;
    await upsertMemoChunks({
      memoId: input.memo.id,
      mediaText: input.resumo,
      keywords: input.memo.keywords,
      dadosEspecificosJson: dadosJson,
    });
  })().catch((e) => console.warn("[memoAlteracao] vetor:", e instanceof Error ? e.message : e));
  return lote;
}

function resposta(
  lote: string | null,
  mudancas: { campo: string; antes: string; depois: string }[],
  dados: Record<string, unknown>,
  resumo: string
): MemoAlteracaoResponse {
  const campos: Record<string, string> = {};
  for (const [k, v] of Object.entries(dados)) campos[k] = v == null ? "" : String(v);
  return { ok: true, lote, mudancas, campos, resumo };
}

/**
 * Altera campos e/ou situação. `campos` usa os nomes dos campos da categoria; nomes desconhecidos
 * são ignorados. Nada mudou → lote nulo, sem gravar.
 */
export async function alterarMemo(input: {
  memoId: number;
  userId: number;
  isAdmin: boolean;
  campos: Record<string, string>;
  origem: "edicao" | "situacao";
}): Promise<MemoAlteracaoResponse> {
  const { memo, cat } = await carregarParaAlterar(input.memoId, input.userId, input.isAdmin);
  const dados = { ...memo.dados };
  const mudancas: { campo: string; antes: string; depois: string }[] = [];
  for (const [nome, valorBruto] of Object.entries(input.campos)) {
    const def = cat.campos.find((c) => norm(c.nome) === norm(nome));
    if (!def) continue;
    const novo = valorParaGravar(String(valorBruto ?? ""), def.tipo);
    const chave = chaveDoCampo(dados, def.nome) ?? def.nome;
    const antes = dados[chave] == null ? "" : String(dados[chave]);
    if (antes.trim() === novo) continue;
    dados[chave] = novo;
    mudancas.push({ campo: def.nome, antes, depois: novo });
  }
  if (!mudancas.length) return resposta(null, [], dados, memo.mediaText);

  const { resumo, costUsd } = await reescreverResumo(memo.mediaText, mudancas);
  const lote = await gravar({
    memo,
    catId: cat.id,
    dados,
    resumo,
    historico: [
      ...mudancas.map((m) => ({ campo: m.campo, antes: m.antes, depois: m.depois })),
      { campo: CAMPO_RESUMO, antes: memo.mediaText, depois: resumo },
    ],
    userId: input.userId,
    origem: input.origem,
    costUsd,
  });
  return resposta(lote, mudancas, dados, resumo);
}

/** Desfaz um "Salvar": volta os campos e o resumo daquele lote (também fica no histórico). */
export async function desfazerAlteracao(lote: string, userId: number, isAdmin: boolean): Promise<MemoAlteracaoResponse> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT memoid, campo, antes, depois FROM memo_alteracoes WHERE lote = ? ORDER BY id ASC`,
    [lote]
  );
  if (!rows.length) throw new Error("not_found");
  const memoId = Number(rows[0].memoId ?? rows[0].memoid);
  const { memo, cat } = await carregarParaAlterar(memoId, userId, isAdmin);
  const dados = { ...memo.dados };
  let resumo = memo.mediaText;
  const mudancas: { campo: string; antes: string; depois: string }[] = [];
  const historico: { campo: string; antes: string | null; depois: string | null }[] = [];
  for (const r of rows) {
    const campo = String(r.campo);
    const antes = r.antes == null ? "" : String(r.antes);
    if (campo === CAMPO_RESUMO) {
      historico.push({ campo, antes: resumo, depois: antes });
      resumo = antes;
      continue;
    }
    const chave = chaveDoCampo(dados, campo) ?? campo;
    const atual = dados[chave] == null ? "" : String(dados[chave]);
    dados[chave] = antes;
    mudancas.push({ campo, antes: atual, depois: antes });
    historico.push({ campo, antes: atual, depois: antes });
  }
  const novoLote = await gravar({ memo, catId: cat.id, dados, resumo, historico, userId, origem: "desfazer", costUsd: 0 });
  return resposta(novoLote, mudancas, dados, resumo);
}
