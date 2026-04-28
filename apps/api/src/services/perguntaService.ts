import type {
  MemoContextCategory,
  PerguntaCardHistorico,
  PerguntaClassificacao,
  PerguntaFiltros,
  PerguntaResposta,
} from "@mymemory/shared";
import { invokeLLM, resetLlmPromptTraces } from "../lib/invokeLlm.js";
import { executarPipe1 } from "./perguntaPipe1.js";
import { executarPipe2 } from "./perguntaPipe2.js";
import { executarPipe3 } from "./perguntaPipe3.js";

// ── Prompt de classificação ───────────────────────────────────────────────────

const SYSTEM_CLASSIFICACAO = `Você é um classificador de perguntas para o sistema MyMemory.

Sua função é decidir a melhor rota de processamento para uma pergunta do usuário.

Você deve analisar:
- a pergunta do usuário;
- o contexto da sessão;
- as categorias disponíveis;
- a capacidade estruturada genérica disponível.

Você NÃO deve responder à pergunta do usuário.
Você NÃO deve inventar capacidades.
Você deve retornar somente JSON válido.

Definições:
- semantica: quando a resposta depende de interpretar textos/memos.
- estruturada: quando a resposta depende de contagem, soma, percentual, listagem, agrupamento ou consulta estruturada.
- hibrida: quando precisa combinar dados estruturados com interpretação textual.

Regras de roteamento:
- Se a pergunta pedir número, total, quantidade, percentual, soma, média, agrupamento ou comparação quantitativa, prefira estruturada.
- Se a pergunta pedir resumo, explicação, interpretação, relato ou conteúdo textual, prefira semantica.
- Se a pergunta pedir número e também interpretação textual na mesma frase, use hibrida.
- Se a pergunta se refere a "desses", "destes", "anterior", "acima", "os mesmos", trate como continuidade ou refinamento.
- Se houver dúvida entre estruturada e semantica, prefira semantica.

Regras de categoria_principal (campo para tuning do catálogo):
- Identifique a categoria principal do conteúdo da pergunta.
- Procure a correspondência em categorias_disponiveis: considere equivalentes plural/singular (ex.: "Prontuário" ≡ "Prontuários"), variações de acento e grafias muito próximas.
- Se houver correspondência (mesmo aproximada), preencha "categorias" com o nome EXATO da lista e deixe categoria_principal null.
- Só preencha categoria_principal quando não houver nenhuma correspondência razoável na lista — é um campo exclusivo para tuning do catálogo.
- Nunca duplique: se preencheu categoria_principal, não coloque o mesmo valor em "categorias".`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCategoriasPayload(categories: MemoContextCategory[]): string[] {
  return categories
    .filter((c) => c.isActive === 1)
    .map((c) => c.name);
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

  const { text, costUsd } = await invokeLLM({ system: SYSTEM_CLASSIFICACAO, user, jsonObject: true, source: "classificacao" });

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

  const thInitial = input.thresholdInitial ?? 0.7;
  const thMin = input.thresholdMin ?? 0.3;

  // ── Pipe 1 — Semântica ────────────────────────────────────────────────────
  if (classificacao.pipe === "semantica") {
    const result = await executarPipe1({
      pergunta: input.pergunta,
      userId: input.userId,
      groupId: input.groupId,
      filtros: input.filtros,
      categoriaNames: classificacao.categorias,
      thresholdInitial: thInitial,
      thresholdMin: thMin,
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
    const result = await executarPipe2({
      pergunta: input.pergunta,
      userId: input.userId,
      groupId: input.groupId,
      filtros: input.filtros,
      historico: input.historico,
    });
    return {
      resposta: result.resposta,
      classificacao,
      apiCost: totalCost + result.apiCost,
    };
  }

  // ── Pipe 3 — Híbrida ──────────────────────────────────────────────────────
  const result = await executarPipe3({
    pergunta: input.pergunta,
    userId: input.userId,
    groupId: input.groupId,
    filtros: input.filtros,
    historico: input.historico,
    categoriaNames: classificacao.categorias,
    thresholdInitial: thInitial,
    thresholdMin: thMin,
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
