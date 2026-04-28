import { config } from "../config.js";
import { setLastLlmPromptTrace } from "../services/llmPromptTraceStore.js";

export type OpenAiUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

/** Estimativa USD para gpt-4o-mini (ajuste via custos OpenAI se mudar o modelo). */
export function estimateCostUsd(u: OpenAiUsage | null): number {
  if (!u) return 0;
  const inCost = (u.prompt_tokens / 1_000_000) * 0.15;
  const outCost = (u.completion_tokens / 1_000_000) * 0.6;
  return Math.round((inCost + outCost) * 1e8) / 1e8;
}

export async function openaiChatJson(args: {
  messages: { role: "system" | "user"; content: string }[];
  temperature?: number;
  source?: string;
}): Promise<{ content: string; usage: OpenAiUsage | null; costUsd: number }> {
  const key = config.openai.apiKey;
  if (!key) {
    const err = new Error("openai_not_configured");
    throw err;
  }
  const url = `${config.openai.baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openai.model,
      messages: args.messages,
      temperature: args.temperature ?? 0.25,
      response_format: { type: "json_object" },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`openai_http_${res.status}`);
    (err as Error & { body?: string }).body = text.slice(0, 800);
    throw err;
  }
  const j = JSON.parse(text) as {
    choices?: { message?: { content?: string } }[];
    usage?: OpenAiUsage;
  };
  const content = j.choices?.[0]?.message?.content ?? "";
  setLastLlmPromptTrace({
    provider: "openai",
    model: config.openai.model,
    source: args.source ?? "openaiChatJson",
    messages: [
      ...args.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "assistant" as const, content },
    ],
  });
  const usage = j.usage ?? null;
  return { content, usage, costUsd: estimateCostUsd(usage) };
}
