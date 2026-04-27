import type {
  MemoContextCategory,
  PerguntaCardHistorico,
  PerguntaClassificacao,
  PerguntaFiltros,
  PerguntaMemoUsado,
  PerguntaResposta,
} from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { invokeLLM } from "../lib/invokeLlm.js";
import { searchMemosByEmbedding } from "../lib/openaiEmbedding.js";

// ── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_CLASSIFICACAO = `Você é um classificador de perguntas para o sistema MyMemory.

Sua função é decidir a melhor rota de processamento para uma pergunta do usuário.

Você deve analisar:
- a pergunta do usuário;
- o contexto da sessão;
- as categorias disponíveis;
- a capacidade estruturada genérica disponível.

Você NÃO deve responder à pergunta do usuário.
Você NÃO deve inventar categorias.
Você NÃO deve inventar capacidades.
Você deve retornar somente JSON válido.

Definições:
- semantica: quando a resposta depende de interpretar textos/memos.
- estruturada: quando a resposta depende de contagem, soma, percentual, listagem, agrupamento ou consulta estruturada.
- hibrida: quando precisa combinar dados estruturados com interpretação textual.

Regras:
- Se a pergunta pedir número, total, quantidade, percentual, soma, média, agrupamento ou comparação quantitativa, prefira estruturada.
- Se a pergunta pedir resumo, explicação, interpretação, relato ou conteúdo textual, prefira semantica.
- Se a pergunta pedir número e também interpretação textual, use hibrida.
- Se a pergunta se refere a "desses", "destes", "anterior", "acima", "os mesmos", trate como continuidade ou refinamento.
- Se houver dúvida entre estruturada e semantica, prefira hibrida.`;

const SYSTEM_RESPOSTA_SEMANTICA = `Você é um assistente de resposta do MyMemory.

Responda à pergunta do usuário usando somente os memos fornecidos.
Não invente informações.
Não use conhecimento externo.
Se os memos não forem suficientes, diga claramente que não há dados suficientes.

A resposta deve ser clara, objetiva e em português do Brasil.
Retorne somente JSON válido.`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildCategoriasPayload(categories: MemoContextCategory[]): object[] {
  return categories
    .filter((c) => c.isActive === 1)
    .map((c) => ({
      id: c.id,
      nome: c.name,
      descricao: c.description ?? null,
      tipoMidia: c.mediaType ?? "qualquer",
      subcategorias: c.subcategories
        .filter((s) => s.isActive === 1)
        .map((s) => s.name),
    }));
}

function buildContextoSessao(historico: PerguntaCardHistorico[]): object {
  if (!historico.length) return { mensagens: [] };
  return {
    mensagens: historico.slice(-3).map((h) => ({
      pergunta: h.pergunta,
      resposta: h.resposta,
      pipe: h.pipe,
    })),
  };
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    const t = raw.trim();
    const i = t.indexOf("{");
    const k = t.lastIndexOf("}");
    if (i >= 0 && k > i) return JSON.parse(t.slice(i, k + 1)) as T;
  } catch {
    /* */
  }
  return fallback;
}

// ── 1ª chamada LLM — Classificação ───────────────────────────────────────────

export async function classificarPergunta(input: {
  pergunta: string;
  categories: MemoContextCategory[];
  historico: PerguntaCardHistorico[];
}): Promise<{ classificacao: PerguntaClassificacao; costUsd: number }> {
  const userMsg = JSON.stringify(
    {
      pergunta: input.pergunta,
      contexto_sessao: buildContextoSessao(input.historico),
      categorias_disponiveis: buildCategoriasPayload(input.categories),
      modelo_estruturado_generico: {
        id: "consulta_analitica_generica",
        descricao:
          "Permite consultar dados estruturados com filtros, contagem, listagem, agrupamento, soma, média, mínimo, máximo, percentual e comparação quando possível.",
      },
    },
    null,
    2
  );

  const user = `Classifique a pergunta abaixo.\n\nEntrada:\n${userMsg}\n\nRetorne somente JSON neste formato:\n{"pipe":"semantica | estruturada | hibrida","categorias":[],"multi_categoria":true,"intencao":"contagem | percentual | listagem | resumo | explicacao | comparacao | agrupamento | soma | media | tendencia | outro","contexto":"nova | continuidade | refinamento","escopo_sugerido":"global | contexto_sessao | indefinido","justificativa":""}`;

  const { text, costUsd } = await invokeLLM({ system: SYSTEM_CLASSIFICACAO, user, jsonObject: true });

  const fallback: PerguntaClassificacao = {
    pipe: "semantica",
    categorias: [],
    multi_categoria: false,
    intencao: "outro",
    contexto: "nova",
    escopo_sugerido: "global",
    justificativa: "fallback",
  };
  const parsed = safeParseJson<Partial<PerguntaClassificacao>>(text, {});
  const classificacao: PerguntaClassificacao = {
    pipe: (["semantica", "estruturada", "hibrida"].includes(String(parsed.pipe ?? "")) ? parsed.pipe : "semantica") as PerguntaClassificacao["pipe"],
    categorias: Array.isArray(parsed.categorias) ? (parsed.categorias as string[]) : [],
    multi_categoria: Boolean(parsed.multi_categoria),
    intencao: (parsed.intencao ?? fallback.intencao) as PerguntaClassificacao["intencao"],
    contexto: (["nova", "continuidade", "refinamento"].includes(String(parsed.contexto ?? "")) ? parsed.contexto : "nova") as PerguntaClassificacao["contexto"],
    escopo_sugerido: (["global", "contexto_sessao", "indefinido"].includes(String(parsed.escopo_sugerido ?? "")) ? parsed.escopo_sugerido : "global") as PerguntaClassificacao["escopo_sugerido"],
    justificativa: String(parsed.justificativa ?? ""),
  };

  return { classificacao, costUsd };
}

// ── Pipe 1 — Busca semântica com boost por categoria ─────────────────────────

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

// Busca embedding + metadados do DB uma única vez (sem threshold)
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
      mediatext: String(row.mediatext ?? ""),
      keywords: row.keywords as string | null,
      dadosespecificosjson: row.dadosespecificosjson as string | null,
      createdat: String(row.createdat ?? ""),
    }];
  });
}

// Aplica threshold, boost por categoria e retorna top-K
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

// ── 4ª chamada LLM — Resposta semântica ──────────────────────────────────────

async function gerarRespostaSemantica(input: {
  pergunta: string;
  memos: MemoHit[];
}): Promise<{ resposta: PerguntaResposta; costUsd: number }> {
  const memosPayload = input.memos.map((m) => ({
    memo_id: m.memoId,
    texto: m.mediatext.slice(0, 2000),
    keywords: m.keywords ?? null,
    data: m.createdat,
    score: Math.round(m.score * 100) / 100,
  }));

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

  const { text, costUsd } = await invokeLLM({ system: SYSTEM_RESPOSTA_SEMANTICA, user, jsonObject: true });

  type RawResp = {
    resposta?: string;
    dados_usados?: { memo_id?: unknown; trecho_usado?: string }[];
    limitacoes?: string[];
    confianca_estimada?: number;
  };

  const parsed = safeParseJson<RawResp>(text, {});

  const dadosUsados: PerguntaMemoUsado[] = Array.isArray(parsed.dados_usados)
    ? parsed.dados_usados.map((d) => ({
        memo_id: Number(d.memo_id ?? 0),
        trecho_usado: String(d.trecho_usado ?? ""),
      }))
    : [];

  const resposta: PerguntaResposta = {
    resposta: String(parsed.resposta ?? "Não foi possível gerar uma resposta."),
    tipo_resposta: "semantica",
    dados_usados: dadosUsados,
    limitacoes: Array.isArray(parsed.limitacoes) ? (parsed.limitacoes as string[]) : [],
    confianca_estimada: typeof parsed.confianca_estimada === "number" ? parsed.confianca_estimada : 0,
  };

  return { resposta, costUsd };
}

// ── Orquestrador principal ────────────────────────────────────────────────────

export async function perguntarMemory(input: {
  userId: number;
  isAdmin: boolean;
  groupId: number | null;
  pergunta: string;
  filtros: PerguntaFiltros;
  historico: PerguntaCardHistorico[];
  categories: MemoContextCategory[];
  forcePipe?: import("@mymemory/shared").PerguntaPipe;
  thresholdInitial?: number;
  thresholdMin?: number;
}): Promise<{
  resposta: PerguntaResposta;
  classificacao: PerguntaClassificacao;
  apiCost: number;
  aguardaFase2: boolean;
  limiarInicial?: number;
  limiarUsado?: number;
  limiarMinimo?: number;
}> {
  let totalCost = 0;

  let classificacao: PerguntaClassificacao;
  if (input.forcePipe) {
    classificacao = {
      pipe: input.forcePipe,
      categorias: [],
      multi_categoria: false,
      intencao: "outro",
      contexto: "nova",
      escopo_sugerido: "global",
      justificativa: `pipe forçado pelo usuário: ${input.forcePipe}`,
    };
  } else {
    const r = await classificarPergunta({
      pergunta: input.pergunta,
      categories: input.categories,
      historico: input.historico,
    });
    classificacao = r.classificacao;
    totalCost += r.costUsd;
  }

  if (classificacao.pipe === "estruturada" || classificacao.pipe === "hibrida") {
    return {
      resposta: {
        resposta: "Esta consulta requer dados estruturados (Pipe 2/3) — funcionalidade em desenvolvimento.",
        tipo_resposta: classificacao.pipe,
        dados_usados: [],
        limitacoes: ["Pipe 2 e 3 ainda não implementados."],
        confianca_estimada: 0,
      },
      classificacao,
      apiCost: totalCost,
      aguardaFase2: true,
    };
  }

  // Pipe 1 — semântico com retry por threshold decrescente
  const thInitial = input.thresholdInitial ?? 0.7;
  const thMin = input.thresholdMin ?? 0.3;
  const STEP = 0.1;

  const rawHits = await fetchHitsWithMeta({
    pergunta: input.pergunta,
    userId: input.userId,
    groupId: input.groupId,
    filtros: input.filtros,
    topN: 50,
  });

  let memos: MemoHit[] = [];
  let limiarUsado = thInitial;

  // Tenta threshold decrescente até encontrar resultados ou atingir o mínimo
  let th = thInitial;
  while (true) {
    memos = rankAndFilter(rawHits, { minSimilarity: th, categoriaNames: classificacao.categorias, topK: 10 });
    limiarUsado = th;
    if (memos.length > 0) break;
    if (th <= thMin) break;
    th = Math.max(Math.round((th - STEP) * 100) / 100, thMin);
  }

  const { resposta, costUsd: c4 } = await gerarRespostaSemantica({
    pergunta: input.pergunta,
    memos,
  });
  totalCost += c4;

  return { resposta, classificacao, apiCost: totalCost, aguardaFase2: false, limiarInicial: thInitial, limiarUsado, limiarMinimo: thMin };
}
