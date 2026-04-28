import type {
  PerguntaFiltros,
  PerguntaMemoUsado,
  PerguntaResposta,
} from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { invokeLLM } from "../lib/invokeLlm.js";
import { searchMemosByEmbedding } from "../lib/openaiEmbedding.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Pipe1Input {
  pergunta: string;
  userId: number;
  groupId: number | null;
  filtros: PerguntaFiltros;
  categoriaNames: string[];
  thresholdInitial: number;
  thresholdMin: number;
}

export interface Pipe1Result {
  resposta: PerguntaResposta;
  apiCost: number;
  limiarInicial: number;
  limiarUsado: number;
  limiarMinimo: number;
  memosEncontrados: number;
}

interface MemoHit {
  memoId: number;
  score: number;
  similarity: number;
  mediatext: string;
  keywords: string | null;
  dadosespecificosjson: string | null;
  createdat: string;
}

interface RawHit {
  memoId: number;
  similarity: number;
  mediatext: string;
  keywords: string | null;
  dadosespecificosjson: string | null;
  createdat: string;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_RESPOSTA_SEMANTICA = `Você é um assistente de resposta do MyMemory.

Responda à pergunta do usuário usando somente os memos fornecidos.
Não invente informações. Não use conhecimento externo.
Cada memo pode ter: texto (conteúdo principal), keywords (palavras-chave) e campos_estruturados (dados específicos como telefone, endereço, CPF, datas, etc.).
Sempre verifique campos_estruturados e keywords — eles podem conter a informação exata solicitada.
Mesmo que a correspondência seja parcial, elabore a melhor resposta possível com base no conteúdo disponível.
Nunca deixe dados_usados vazio quando memos foram fornecidos — cite sempre todos os memos relevantes.
Se a correspondência for fraca, reflita isso em confianca_estimada baixa e explique a limitação em limitacoes.

A resposta deve ser clara, objetiva e em português do Brasil.
Não use formatação markdown (sem asteriscos, negrito, itálico, títulos ou listas com marcadores).
Retorne somente JSON válido.`;

// ── Utilities ─────────────────────────────────────────────────────────────────

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    const t = raw.trim();
    const i = t.indexOf("{");
    const k = t.lastIndexOf("}");
    if (i >= 0 && k > i) return JSON.parse(t.slice(i, k + 1)) as T;
  } catch { /* */ }
  return fallback;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function fetchHitsWithMeta(input: {
  pergunta: string;
  userId: number;
  groupId: number | null;
  filtros: PerguntaFiltros;
  topN: number;
}): Promise<RawHit[]> {
  const hits = await searchMemosByEmbedding({
    query: input.pergunta,
    userId: input.userId,
    groupId: input.groupId,
    limit: input.topN,
  });
  if (!hits.length) return [];

  const ids = hits.map((h) => h.memoId);
  const ph = ids.map(() => "?").join(",");

  const extraWhere: string[] = [];
  const extraVals: unknown[] = [];
  if (input.filtros.autorId != null) {
    extraWhere.push("m.userid = ?");
    extraVals.push(input.filtros.autorId);
  }
  if (input.filtros.dataInicio) {
    extraWhere.push("m.createdat >= ?");
    extraVals.push(input.filtros.dataInicio);
  }
  if (input.filtros.dataFim) {
    extraWhere.push("m.createdat <= ?");
    extraVals.push(input.filtros.dataFim + " 23:59:59");
  }
  const whereExtra = extraWhere.length ? " AND " + extraWhere.join(" AND ") : "";

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.mediatext, m.keywords, m.dadosespecificosjson, m.createdat
     FROM memos m
     WHERE m.id IN (${ph}) AND m.isactive = 1${whereExtra}`,
    [...ids, ...extraVals]
  );

  const rowMap = new Map(rows.map((r) => [r.id as number, r]));
  return hits.flatMap((h) => {
    const row = rowMap.get(h.memoId);
    if (!row) return [];
    return [{
      memoId: h.memoId,
      similarity: h.similarity,
      mediatext: String(row.mediaText ?? ""),
      keywords: row.keywords as string | null,
      dadosespecificosjson: row.dadosEspecificosJson as string | null,
      createdat: String(row.createdAt ?? ""),
    }];
  });
}

function rankAndFilter(
  rawHits: RawHit[],
  opts: { minSimilarity: number; categoriaNames: string[]; topK: number }
): MemoHit[] {
  const catNamesLower = new Set(opts.categoriaNames.map((n) => n.toLowerCase()));
  const BOOST = 0.15;

  return rawHits
    .filter((h) => h.similarity >= opts.minSimilarity)
    .map((h) => {
      let score = h.similarity;
      if (catNamesLower.size > 0) {
        const kw = h.keywords?.toLowerCase() ?? "";
        const dados = h.dadosespecificosjson?.toLowerCase() ?? "";
        for (const cat of catNamesLower) {
          if (kw.includes(cat) || dados.includes(cat)) { score += BOOST; break; }
        }
      }
      return { ...h, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.topK);
}

async function gerarRespostaSemantica(input: {
  pergunta: string;
  memos: MemoHit[];
}): Promise<{ resposta: PerguntaResposta; costUsd: number }> {
  const memosPayload = input.memos.map((m) => {
    let camposEstruturados: Record<string, unknown> | null = null;
    if (m.dadosespecificosjson) {
      try { camposEstruturados = JSON.parse(m.dadosespecificosjson) as Record<string, unknown>; } catch { /* */ }
    }
    return {
      memo_id: m.memoId,
      texto: m.mediatext.slice(0, 4000),
      keywords: m.keywords ?? null,
      campos_estruturados: camposEstruturados,
      data: m.createdat,
      score: Math.round(m.score * 100) / 100,
    };
  });

  const userMsg = JSON.stringify(
    {
      pergunta: input.pergunta,
      memos_usados: memosPayload,
      metadados: {
        quantidade_memos: input.memos.length,
        scores: input.memos.map((m) => Math.round(m.score * 100) / 100),
      },
    },
    null,
    2
  );

  const user = `Elabore a resposta final.\n\nEntrada:\n${userMsg}\n\nRetorne somente JSON:\n{"resposta":"","tipo_resposta":"semantica","dados_usados":[{"memo_id":"","trecho_usado":""}],"limitacoes":[],"confianca_estimada":0.0}`;

  const { text, costUsd } = await invokeLLM({ system: SYSTEM_RESPOSTA_SEMANTICA, user, jsonObject: true, source: "resposta_semantica" });

  type RawResp = {
    resposta?: string;
    dados_usados?: { memo_id?: unknown; trecho_usado?: string }[];
    limitacoes?: string[];
    confianca_estimada?: number;
  };

  const parsed = safeParseJson<RawResp>(text, {});

  let dadosUsados: PerguntaMemoUsado[] = Array.isArray(parsed.dados_usados)
    ? parsed.dados_usados
        .map((d) => ({ memo_id: Number(d.memo_id ?? 0), trecho_usado: String(d.trecho_usado ?? "") }))
        .filter((d) => d.memo_id > 0)
    : [];

  if (dadosUsados.length === 0 && input.memos.length > 0) {
    dadosUsados = input.memos.map((m) => ({ memo_id: m.memoId, trecho_usado: "" }));
  }

  const usedIds = new Set(dadosUsados.map((d) => d.memo_id));
  const citados = input.memos.filter((m) => usedIds.has(m.memoId));
  const confiancaEstimada = citados.length > 0
    ? Math.min(Math.round(citados.reduce((mx, m) => Math.max(mx, m.similarity), 0) * 100) / 100, 1)
    : 0;

  const resposta: PerguntaResposta = {
    resposta: String(parsed.resposta ?? "Não foi possível gerar uma resposta."),
    tipo_resposta: "semantica",
    dados_usados: dadosUsados,
    limitacoes: Array.isArray(parsed.limitacoes) ? (parsed.limitacoes as string[]) : [],
    confianca_estimada: confiancaEstimada,
  };

  return { resposta, costUsd };
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function executarPipe1(input: Pipe1Input): Promise<Pipe1Result> {
  const rawHits = await fetchHitsWithMeta({
    pergunta: input.pergunta,
    userId: input.userId,
    groupId: input.groupId,
    filtros: input.filtros,
    topN: 50,
  });

  const memos = rankAndFilter(rawHits, {
    minSimilarity: input.thresholdInitial,
    categoriaNames: input.categoriaNames,
    topK: 10,
  });

  const { resposta, costUsd } = await gerarRespostaSemantica({
    pergunta: input.pergunta,
    memos,
  });

  return {
    resposta,
    apiCost: costUsd,
    limiarInicial: input.thresholdInitial,
    limiarUsado: input.thresholdInitial,
    limiarMinimo: input.thresholdMin,
    memosEncontrados: memos.length,
  };
}
