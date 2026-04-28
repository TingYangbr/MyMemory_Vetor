import { openaiChatJson } from "./openaiChat.js";
import { setLastLlmPromptTrace } from "../services/llmPromptTraceStore.js";
export { resetLlmPromptTraces, getAllLlmPromptTraces } from "../services/llmPromptTraceStore.js";

/**
 * Chamada LLM unificada: se existirem `BUILT_IN_FORGE_API_URL` e `BUILT_IN_FORGE_API_KEY`,
 * faz POST compatível com OpenAI (`/v1/chat/completions` na URL base) no endpoint indicado;
 * caso contrário usa `openaiChatJson` (OpenAI).
 */
export async function invokeLLM(input: {
  system: string;
  user: string;
  jsonObject?: boolean;
  /** Por defeito 0.2; busca expandida (sinónimos) usa 0 para maior estabilidade. */
  temperature?: number;
  /** Identificador da chamada para o trace de debug (ex.: "classificacao", "resposta_semantica"). */
  source?: string;
}): Promise<{ text: string; costUsd: number }> {
  const temperature = input.temperature ?? 0.2;
  const forgeUrl = (process.env.BUILT_IN_FORGE_API_URL ?? "").trim();
  const forgeKey = (process.env.BUILT_IN_FORGE_API_KEY ?? "").trim();

  if (forgeUrl && forgeKey) {
    const model = (process.env.BUILT_IN_FORGE_MODEL ?? "gpt-4o-mini").trim();
    const res = await fetch(forgeUrl.replace(/\/$/, ""), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${forgeKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        temperature,
        response_format: { type: "json_object" },
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      const err = new Error(`forge_http_${res.status}`);
      (err as Error & { body?: string }).body = raw.slice(0, 600);
      throw err;
    }
    let text = raw;
    try {
      const j = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] };
      text = j.choices?.[0]?.message?.content ?? raw;
    } catch {
      /* texto bruto */
    }
    setLastLlmPromptTrace({
      provider: "forge",
      model,
      source: input.source ?? "invokeLLM",
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
        { role: "assistant", content: text },
      ],
    });
    return { text, costUsd: 0 };
  }

  const { content, costUsd } = await openaiChatJson({
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    temperature,
    source: input.source,
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
    if (i >= 0 && k > i) {
      return parseSynonymsJson(t.slice(i, k + 1));
    }
    return [];
  }
}

export async function llmSynonymsForTerm(term: string): Promise<{ synonyms: string[]; costUsd: number }> {
  const clean = term.trim();
  if (!clean) return { synonyms: [], costUsd: 0 };

  const system =
    "És um assistente que só responde JSON válido. Nunca incluas markdown nem texto fora do objeto JSON.";
  const user = `Gere exatamente 2 sinónimos ou termos muito equivalentes em português para: '${clean.replace(/'/g, "′")}'
Responde apenas: {"synonyms":["termo1","termo2"]}`;

  const { text, costUsd } = await invokeLLM({ system, user, jsonObject: true, temperature: 0 });
  return { synonyms: parseSynonymsJson(text), costUsd };
}
