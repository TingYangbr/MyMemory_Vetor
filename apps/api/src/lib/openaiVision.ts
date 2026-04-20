import { config } from "../config.js";
import type { OpenAiUsage } from "./openaiChat.js";
import { estimateCostUsd } from "./openaiChat.js";
import { setLastLlmPromptTrace } from "../services/llmPromptTraceStore.js";

export type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export async function openaiChatVisionJson(args: {
  messages: { role: "system" | "user"; content: string | VisionContentPart[] }[];
  temperature?: number;
}): Promise<{ content: string; usage: OpenAiUsage | null; costUsd: number }> {
  const key = config.openai.apiKey;
  if (!key) {
    throw new Error("openai_not_configured");
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
    source: "openaiChatVisionJson",
    messages: [
      ...args.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "assistant" as const, content },
    ],
  });
  const usage = j.usage ?? null;
  return { content, usage, costUsd: estimateCostUsd(usage) };
}
