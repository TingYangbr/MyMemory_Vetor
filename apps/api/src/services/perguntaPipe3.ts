import type {
  PerguntaCardHistorico,
  PerguntaFiltros,
  PerguntaMemoUsado,
  PerguntaResposta,
} from "@mymemory/shared";
import { invokeLLM } from "../lib/invokeLlm.js";
import { executarPipe1, type Pipe1Input } from "./perguntaPipe1.js";
import { executarPipe2, type Pipe2Input } from "./perguntaPipe2.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Pipe3Input {
  pergunta: string;
  userId: number;
  groupId: number | null;
  filtros: PerguntaFiltros;
  historico: PerguntaCardHistorico[];
  categoriaNames: string[];
  thresholdInitial: number;
  thresholdMin: number;
}

export interface Pipe3Result {
  resposta: PerguntaResposta;
  apiCost: number;
  limiarInicial?: number;
  limiarUsado?: number;
  limiarMinimo?: number;
  memosEncontrados?: number;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_RESPOSTA_HIBRIDA = `Você é um assistente do MyMemory que combina dados estruturados e semânticos.

Você receberá:
1. dados_estruturados: resultado de uma consulta analítica ao banco (contagem, listagem, agrupamento) — preciso e determinístico.
2. memos_semanticos: memos relevantes encontrados por busca semântica — fornecem contexto textual e interpretativo.

Use os dados estruturados para responder partes quantitativas e analíticas da pergunta.
Use os memos semânticos para enriquecer a resposta com contexto, detalhes e interpretação.
Combine os dois de forma coesa em uma única resposta clara e objetiva.

Cite em dados_usados os memo_ids dos memos semânticos que efetivamente contribuíram para a resposta.
Responda em português do Brasil. Retorne somente JSON válido.`;

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

// ── Internal: síntese híbrida ─────────────────────────────────────────────────

async function gerarRespostaHibrida(input: {
  pergunta: string;
  pipe1: Awaited<ReturnType<typeof executarPipe1>>;
  pipe2: Awaited<ReturnType<typeof executarPipe2>>;
}): Promise<{ resposta: PerguntaResposta; costUsd: number }> {
  const { pipe1, pipe2 } = input;

  const userMsg = JSON.stringify({
    pergunta: input.pergunta,
    dados_estruturados: {
      colunas: pipe2.dadosEstruturados.colunas,
      linhas: pipe2.dadosEstruturados.linhas.slice(0, 20),
      total_linhas: pipe2.dadosEstruturados.totalLinhas,
      resumo_analitico: pipe2.resposta.resposta,
    },
    memos_semanticos: pipe1.resposta.dados_usados.map((d) => ({
      memo_id: d.memo_id,
      trecho_usado: d.trecho_usado,
    })),
    resumo_semantico: pipe1.resposta.resposta,
  }, null, 2);

  const user = `Elabore a resposta híbrida combinando dados estruturados e semânticos.\n\nEntrada:\n${userMsg}\n\nRetorne somente JSON:\n{"resposta":"","dados_usados":[{"memo_id":0,"trecho_usado":""}],"limitacoes":[],"confianca_estimada":0.0}`;

  const { text, costUsd } = await invokeLLM({ system: SYSTEM_RESPOSTA_HIBRIDA, user, jsonObject: true, source: "resposta_hibrida" });

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

  // Fallback: usa memos do Pipe 1 se o LLM não citou nenhum
  if (dadosUsados.length === 0 && pipe1.resposta.dados_usados.length > 0) {
    dadosUsados = pipe1.resposta.dados_usados;
  }

  const confianca =
    typeof parsed.confianca_estimada === "number"
      ? Math.min(Math.max(parsed.confianca_estimada, 0), 1)
      : pipe1.resposta.confianca_estimada;

  const resposta: PerguntaResposta = {
    resposta: String(parsed.resposta ?? "Não foi possível gerar uma resposta."),
    tipo_resposta: "hibrida",
    dados_usados: dadosUsados,
    limitacoes: Array.isArray(parsed.limitacoes) ? (parsed.limitacoes as string[]) : [],
    confianca_estimada: confianca,
    dados_estruturados: pipe2.dadosEstruturados,
  };

  return { resposta, costUsd };
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function executarPipe3(input: Pipe3Input): Promise<Pipe3Result> {
  const pipe1Input: Pipe1Input = {
    pergunta: input.pergunta,
    userId: input.userId,
    groupId: input.groupId,
    filtros: input.filtros,
    categoriaNames: input.categoriaNames,
    thresholdInitial: input.thresholdInitial,
    thresholdMin: input.thresholdMin,
  };

  const pipe2Input: Pipe2Input = {
    pergunta: input.pergunta,
    userId: input.userId,
    groupId: input.groupId,
    filtros: input.filtros,
    historico: input.historico,
  };

  // Pipe 1 e Pipe 2 correm em paralelo — cada um é independente
  const [pipe1, pipe2] = await Promise.all([
    executarPipe1(pipe1Input),
    executarPipe2(pipe2Input),
  ]);

  const { resposta, costUsd: c3 } = await gerarRespostaHibrida({
    pergunta: input.pergunta,
    pipe1,
    pipe2,
  });

  return {
    resposta,
    apiCost: pipe1.apiCost + pipe2.apiCost + c3,
    limiarInicial: pipe1.limiarInicial,
    limiarUsado: pipe1.limiarUsado,
    limiarMinimo: pipe1.limiarMinimo,
    memosEncontrados: pipe1.memosEncontrados,
  };
}
