import type {
  MemoContextCategory,
  PerguntaCardHistorico,
  PerguntaClassificacao,
  PerguntaFiltros,
  PerguntaResposta,
} from "@mymemory/shared";
import { invokeLLM, resetLlmPromptTraces } from "../lib/invokeLlm.js";
import { executarPipe1 } from "./perguntaPipe1.js";
import { executarPipe2, type QueryDisponivel } from "./perguntaPipe2.js";
import { executarPipe3 } from "./perguntaPipe3.js";
import { getActiveSystemPrompt } from "./llmPromptConfigService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCategoriasPayload(categories: MemoContextCategory[]): string[] {
  return categories
    .filter((c) => c.isActive === 1)
    .map((c) => c.name);
}

function normCat(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Procura a categoria ativa mais próxima do alvo por similaridade textual.
 * Retorna o nome EXATO da categoria no catálogo, ou null se não encontrar nenhuma.
 * Níveis: (1) normalizado exato, (2) uma contém a outra, (3) sobreposição de palavras ≥ 3 chars.
 */
function encontrarCategoriaProxima(
  alvo: string,
  categories: MemoContextCategory[]
): string | null {
  const normAlvo = normCat(alvo);
  const ativas = categories.filter((c) => c.isActive === 1);

  const exato = ativas.find((c) => normCat(c.name) === normAlvo);
  if (exato) return exato.name;

  const contem = ativas.find((c) => {
    const n = normCat(c.name);
    return n.includes(normAlvo) || normAlvo.includes(n);
  });
  if (contem) return contem.name;

  const palavrasAlvo = normAlvo.split(/\s+/).filter((w) => w.length >= 3);
  if (palavrasAlvo.length > 0) {
    let melhor: { name: string; score: number } | null = null;
    for (const c of ativas) {
      const palavrasCat = normCat(c.name).split(/\s+/).filter((w) => w.length >= 3);
      const overlap = palavrasAlvo.filter((w) => palavrasCat.includes(w)).length;
      if (overlap > 0 && (!melhor || overlap > melhor.score)) {
        melhor = { name: c.name, score: overlap };
      }
    }
    if (melhor) return melhor.name;
  }

  return null;
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

function toParamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function buildQueriesDisponiveis(
  categories: MemoContextCategory[],
  categoriaNames: string[]
): QueryDisponivel[] {
  return categories
    .filter((c) => c.isActive === 1 && categoriaNames.includes(c.name))
    .flatMap((c) => {
      // Índice campo normalizado → MemoContextCampo para cross-reference
      const campoByParamName = new Map(
        (c.campos ?? [])
          .filter((f) => f.isActive === 1)
          .map((f) => [toParamName(f.name), f])
      );

      return (c.queries ?? [])
        .filter((q) => q.isActive === 1)
        .map((q) => ({
          query_id: String(q.id),
          nome: q.nome,
          descricao: q.descricao,
          sentencaSql: q.sentencaSql,
          params: (q.params ?? [])
            .filter((p) => p.isActive === 1)
            .sort((a, b) => a.ordem - b.ordem)
            .map((p) => {
              const campo = campoByParamName.get(p.campo.toLowerCase());
              const exemplos = campo?.normalizedTerms
                ? campo.normalizedTerms.split(",").map((t) => t.trim()).filter(Boolean)
                : [];
              return {
                nome: p.campo,
                tipo: p.tipo,
                obrigatorio: p.obrigatorio === 1,
                operadorSql: p.operadorSql,
                normalizar: p.normalizar === 1,
                descricao_campo: campo?.description ?? null,
                ...(exemplos.length ? { exemplos_valores: exemplos } : {}),
              };
            }),
        }));
    });
}

/** Coleta todos os memo_ids citados nas respostas do histórico da sessão. */
function escopoMemoIdsDoHistorico(historico: PerguntaCardHistorico[]): number[] {
  const ids = new Set<number>();
  for (const h of historico) {
    for (const d of h.dados_usados ?? []) ids.add(d.memo_id);
  }
  return [...ids];
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    const t = raw.trim();
    const i = t.indexOf("{");
    const k = t.lastIndexOf("}");
    if (i >= 0 && k > i) return JSON.parse(t.slice(i, k + 1)) as T;
  } catch { /* */ }
  return fallback;
}

// ── Classificação ─────────────────────────────────────────────────────────────

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

  const user = `Classifique a pergunta abaixo.\n\nEntrada:\n${userMsg}\n\nRetorne somente JSON neste formato:\n{"pipe":"semantica | estruturada | hibrida","categorias":[],"multi_categoria":true,"intencao":"contagem | percentual | listagem | resumo | explicacao | comparacao | agrupamento | soma | media | tendencia | outro","contexto":"nova | continuidade | refinamento","escopo_sugerido":"global | contexto_sessao | indefinido","categoria_principal":null,"justificativa":""}`;

  const systemClassificacao = await getActiveSystemPrompt("perguntas_pipe1_classificacao_system");
  const { text, costUsd } = await invokeLLM({ system: systemClassificacao, user, jsonObject: true, source: "classificacao" });

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
  const categoriaPrincipal =
    typeof parsed.categoria_principal === "string" && parsed.categoria_principal.trim()
      ? parsed.categoria_principal.trim()
      : null;
  const classificacao: PerguntaClassificacao = {
    pipe: (["semantica", "estruturada", "hibrida"].includes(String(parsed.pipe ?? "")) ? parsed.pipe : "semantica") as PerguntaClassificacao["pipe"],
    categorias: Array.isArray(parsed.categorias) ? (parsed.categorias as string[]) : [],
    multi_categoria: Boolean(parsed.multi_categoria),
    intencao: (parsed.intencao ?? fallback.intencao) as PerguntaClassificacao["intencao"],
    contexto: (["nova", "continuidade", "refinamento"].includes(String(parsed.contexto ?? "")) ? parsed.contexto : "nova") as PerguntaClassificacao["contexto"],
    escopo_sugerido: (["global", "contexto_sessao", "indefinido"].includes(String(parsed.escopo_sugerido ?? "")) ? parsed.escopo_sugerido : "global") as PerguntaClassificacao["escopo_sugerido"],
    categoria_principal: categoriaPrincipal,
    justificativa: String(parsed.justificativa ?? ""),
  };

  return { classificacao, costUsd };
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
  forceCategories?: string[];
  thresholdInitial?: number;
  thresholdMin?: number;
}): Promise<{
  resposta: PerguntaResposta;
  classificacao: PerguntaClassificacao;
  apiCost: number;
  aguardaFase2?: boolean;
  limiarInicial?: number;
  limiarUsado?: number;
  limiarMinimo?: number;
  memosEncontrados?: number;
}> {
  resetLlmPromptTraces();
  let totalCost = 0;

  // Classificação (ou pipe forçado)
  let classificacao: PerguntaClassificacao;
  if (input.forcePipe) {
    classificacao = {
      pipe: input.forcePipe,
      categorias: input.forceCategories ?? [],
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

  // Fallback de categoria: se o LLM não mapeou nenhuma categoria mas identificou um tema
  // (categoria_principal preenchida), tenta localizar a categoria mais próxima no catálogo.
  if (
    classificacao.categorias.length === 0 &&
    classificacao.categoria_principal &&
    (classificacao.pipe === "estruturada" || classificacao.pipe === "hibrida")
  ) {
    const match = encontrarCategoriaProxima(classificacao.categoria_principal, input.categories);
    if (match) classificacao.categorias = [match];
  }

  const thInitial = input.thresholdInitial ?? 0.7;
  const thMin = input.thresholdMin ?? 0.3;

  // Resolve o ID da primeira categoria para lookup de override de prompt nas chamadas 2-5
  const firstCategoryName = classificacao.categorias[0] ?? null;
  const firstCategoryId = firstCategoryName
    ? (input.categories.find((c) => c.isActive === 1 && c.name === firstCategoryName)?.id ?? null)
    : null;

  // ── Pipe 1 — Semântica ────────────────────────────────────────────────────
  if (classificacao.pipe === "semantica") {
    const escopoIds = classificacao.escopo_sugerido === "contexto_sessao"
      ? escopoMemoIdsDoHistorico(input.historico)
      : undefined;
    const result = await executarPipe1({
      pergunta: input.pergunta,
      userId: input.userId,
      groupId: input.groupId,
      filtros: input.filtros,
      categoriaNames: classificacao.categorias,
      thresholdInitial: thInitial,
      thresholdMin: thMin,
      escopoMemoIds: escopoIds?.length ? escopoIds : undefined,
      categoryId: firstCategoryId,
    });
    return {
      resposta: result.resposta,
      classificacao,
      apiCost: totalCost + result.apiCost,
      limiarInicial: result.limiarInicial,
      limiarUsado: result.limiarUsado,
      limiarMinimo: result.limiarMinimo,
      memosEncontrados: result.memosEncontrados,
    };
  }

  // ── Pipe 2 — Estruturada ──────────────────────────────────────────────────
  if (classificacao.pipe === "estruturada") {
    const queriesDisponiveis = buildQueriesDisponiveis(input.categories, classificacao.categorias);
    const result = await executarPipe2({
      pergunta: input.pergunta,
      userId: input.userId,
      groupId: input.groupId,
      filtros: input.filtros,
      historico: input.historico,
      classificacao,
      queriesDisponiveis,
      categoryId: firstCategoryId,
    });
    return {
      resposta: result.resposta,
      classificacao,
      apiCost: totalCost + result.apiCost,
    };
  }

  // ── Pipe 3 — Híbrida ──────────────────────────────────────────────────────
  const queriesDisponiveis = buildQueriesDisponiveis(input.categories, classificacao.categorias);
  const escopoIds3 = classificacao.escopo_sugerido === "contexto_sessao"
    ? escopoMemoIdsDoHistorico(input.historico)
    : undefined;
  const result = await executarPipe3({
    pergunta: input.pergunta,
    userId: input.userId,
    groupId: input.groupId,
    filtros: input.filtros,
    historico: input.historico,
    classificacao,
    queriesDisponiveis,
    categoriaNames: classificacao.categorias,
    thresholdInitial: thInitial,
    thresholdMin: thMin,
    escopoMemoIds: escopoIds3?.length ? escopoIds3 : undefined,
    categoryId: firstCategoryId,
  });
  return {
    resposta: result.resposta,
    classificacao,
    apiCost: totalCost + result.apiCost,
    limiarInicial: result.limiarInicial,
    limiarUsado: result.limiarUsado,
    limiarMinimo: result.limiarMinimo,
    memosEncontrados: result.memosEncontrados,
  };
}
