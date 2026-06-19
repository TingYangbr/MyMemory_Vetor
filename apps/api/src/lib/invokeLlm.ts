import { chatIa } from "./aiProviderFactory.js";
import { setLastLlmPromptTrace } from "../services/llmPromptTraceStore.js";
export { resetLlmPromptTraces, getAllLlmPromptTraces, runWithTraces } from "../services/llmPromptTraceStore.js";

/**
 * Chamada LLM unificada para os pipes de perguntas e sinónimos.
 * O roteamento de provedor (OpenAI / Gemini / Anthropic / Forge) é feito
 * centralmente pelo aiProviderFactory — operação "chat_ia".
 */
export async function invokeLLM(input: {
  system: string;
  user: string;
  jsonObject?: boolean;
  temperature?: number;
  source?: string;
}): Promise<{ text: string; costUsd: number }> {
  const messages = [
    { role: "system" as const, content: input.system },
    { role: "user"   as const, content: input.user   },
  ];
  const { content, costUsd } = await chatIa(messages, {
    source: input.source ?? "invokeLLM",
  });
  return { text: content, costUsd };
}

export function parseSynonymsJson(raw: string): string[] {
  const t = raw.trim();
  try {
    const j = JSON.parse(t) as { synonyms?: unknown };
    const arr = j.synonyms;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((s) => s.length > 0 && s.length <= 80)
      .slice(0, 2);
  } catch {
    const i = t.indexOf("{");
    const k = t.lastIndexOf("}");
    if (i >= 0 && k > i) return parseSynonymsJson(t.slice(i, k + 1));
    return [];
  }
}

export async function llmSynonymsForTerm(term: string): Promise<{ synonyms: string[]; costUsd: number }> {
  const clean = term.trim();
  if (!clean) return { synonyms: [], costUsd: 0 };
  const system = "És um assistente que só responde JSON válido. Nunca incluas markdown nem texto fora do objeto JSON.";
  const user = `Gere exatamente 2 sinónimos ou termos muito equivalentes em português para: '${clean.replace(/'/g, "′")}'
Responde apenas: {"synonyms":["termo1","termo2"]}`;
  const { text, costUsd } = await invokeLLM({ system, user, jsonObject: true, temperature: 0, source: "synonyms" });
  return { synonyms: parseSynonymsJson(text), costUsd };
}

// Mantido para quem importa setLastLlmPromptTrace daqui
export { setLastLlmPromptTrace };
