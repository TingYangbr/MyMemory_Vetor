import { pool } from "../db.js";
import { config } from "../config.js";
import type { RowDataPacket } from "./dbTypes.js";
import { setLastLlmPromptTrace } from "../services/llmPromptTraceStore.js";

// ── Tipos públicos ─────────────────────────────────────────────────────────────

export type AiProviderName = "openai" | "google_gemini" | "anthropic" | "manus_proxy" | "microsoft_azure";

export interface AiConfigEntry {
  operation: string;
  displayName: string;
  provider: AiProviderName;
  model: string;
  isEnabled: boolean;
  maxTokens: number | null;
  temperature: number | null;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };
export type VisionMessage = { role: "system" | "user" | "assistant"; content: string | VisionContentPart[] };

// ── Cache DB (60 s TTL) ────────────────────────────────────────────────────────

const _cache = new Map<string, { entry: AiConfigEntry; ts: number }>();
const CACHE_TTL = 60_000;

export function invalidateAiConfigCache(operation?: string): void {
  if (operation) _cache.delete(operation);
  else _cache.clear();
}

export async function getAiConfig(operation: string): Promise<AiConfigEntry> {
  const now = Date.now();
  const hit = _cache.get(operation);
  if (hit && now - hit.ts < CACHE_TTL) return hit.entry;

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT operation, displayName, provider, model, isEnabled, maxTokens, temperature
       FROM ai_config WHERE operation = ? LIMIT 1`,
      [operation]
    );
    if (rows[0]) {
      const r = rows[0] as AiConfigEntry & { isEnabled: unknown };
      const entry: AiConfigEntry = {
        operation,
        displayName: String(r.displayName ?? operation),
        provider: (r.provider ?? "openai") as AiProviderName,
        model: String(r.model ?? config.openai.model),
        isEnabled: r.isEnabled === 1 || r.isEnabled === true,
        maxTokens: r.maxTokens != null ? Number(r.maxTokens) : null,
        temperature: r.temperature != null ? Number(r.temperature) : null,
      };
      _cache.set(operation, { entry, ts: now });
      return entry;
    }
  } catch { /* DB offline — usa fallback */ }

  return {
    operation,
    displayName: operation,
    provider: "openai",
    model: config.openai.model,
    isEnabled: true,
    maxTokens: null,
    temperature: null,
  };
}

// ── Estimativa de custo por modelo ─────────────────────────────────────────────

const MODEL_RATES: Record<string, [number, number]> = {
  "gpt-4o-mini":               [0.15,  0.60],
  "gpt-4o":                    [5.00, 15.00],
  "gpt-4-turbo":               [10.00, 30.00],
  "gemini-2.0-flash":          [0.10,  0.40],
  "gemini-2.0-flash-lite":     [0.075, 0.30],
  "gemini-1.5-flash":          [0.075, 0.30],
  "gemini-1.5-pro":            [1.25,  5.00],
  "claude-haiku-4-5-20251001": [0.80,  4.00],
  "claude-haiku-4-5":          [0.80,  4.00],
  "claude-sonnet-4-6":         [3.00, 15.00],
  "claude-opus-4-7":           [15.00, 75.00],
};

export function estimateTokenCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_RATES[model] ?? [0.15, 0.60];
  return Math.round(((inputTokens / 1_000_000) * rates[0] + (outputTokens / 1_000_000) * rates[1]) * 1e8) / 1e8;
}

// ── Helpers internos ───────────────────────────────────────────────────────────

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(url);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

function stripJsonFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

// ── Adapter OpenAI ─────────────────────────────────────────────────────────────

async function _openaiChat(
  entry: AiConfigEntry,
  messages: ChatMessage[],
  source: string
): Promise<{ content: string; costUsd: number }> {
  const key = config.openai.apiKey;
  if (!key) throw new Error("openai_not_configured");
  const model = entry.model || config.openai.model;
  const res = await fetch(`${config.openai.baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(40_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: entry.temperature ?? 0.25,
      response_format: { type: "json_object" },
      ...(entry.maxTokens ? { max_tokens: entry.maxTokens } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`openai_http_${res.status}`); (e as Error & { body?: string }).body = text.slice(0, 800); throw e; }
  const j = JSON.parse(text) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
  const content = j.choices?.[0]?.message?.content ?? "";
  setLastLlmPromptTrace({ provider: "openai", model, source, messages: [...messages, { role: "assistant", content }] });
  return { content, costUsd: estimateTokenCost(model, j.usage?.prompt_tokens ?? 0, j.usage?.completion_tokens ?? 0) };
}

async function _openaiVision(
  entry: AiConfigEntry,
  messages: VisionMessage[],
  source: string
): Promise<{ content: string; costUsd: number }> {
  const key = config.openai.apiKey;
  if (!key) throw new Error("openai_not_configured");
  const model = entry.model || config.openai.model;
  const res = await fetch(`${config.openai.baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(40_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: entry.temperature ?? 0.25,
      response_format: { type: "json_object" },
      ...(entry.maxTokens ? { max_tokens: entry.maxTokens } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`openai_vision_http_${res.status}`); (e as Error & { body?: string }).body = text.slice(0, 800); throw e; }
  const j = JSON.parse(text) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
  const content = j.choices?.[0]?.message?.content ?? "";
  setLastLlmPromptTrace({ provider: "openai", model, source, messages: messages.map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "[vision]" })) });
  return { content, costUsd: estimateTokenCost(model, j.usage?.prompt_tokens ?? 0, j.usage?.completion_tokens ?? 0) };
}

// ── Adapter Gemini ─────────────────────────────────────────────────────────────

async function _geminiChat(
  entry: AiConfigEntry,
  messages: ChatMessage[],
  source: string
): Promise<{ content: string; costUsd: number }> {
  const key = config.gemini.apiKey;
  if (!key) throw new Error("gemini_not_configured");
  const model = entry.model || "gemini-2.0-flash";
  const systemMsg = messages.find(m => m.role === "system");
  const userMsgs = messages.filter(m => m.role !== "system");
  const body: Record<string, unknown> = {
    contents: userMsgs.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: {
      temperature: entry.temperature ?? 0.25,
      responseMimeType: "application/json",
      ...(entry.maxTokens ? { maxOutputTokens: entry.maxTokens } : {}),
    },
  };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: "POST", signal: AbortSignal.timeout(40_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const text = await res.text();
  if (!res.ok) { const e = new Error(`gemini_http_${res.status}`); (e as Error & { body?: string }).body = text.slice(0, 800); throw e; }
  const j = JSON.parse(text) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  const content = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  setLastLlmPromptTrace({ provider: "google_gemini", model, source, messages: [...messages, { role: "assistant", content }] });
  return { content, costUsd: estimateTokenCost(model, j.usageMetadata?.promptTokenCount ?? 0, j.usageMetadata?.candidatesTokenCount ?? 0) };
}

async function _geminiVision(
  entry: AiConfigEntry,
  messages: VisionMessage[],
  source: string
): Promise<{ content: string; costUsd: number }> {
  const key = config.gemini.apiKey;
  if (!key) throw new Error("gemini_not_configured");
  const model = entry.model || "gemini-2.0-flash";
  const systemMsg = messages.find(m => m.role === "system");
  const userMsgs = messages.filter(m => m.role !== "system");
  const contents = userMsgs.map(m => {
    if (typeof m.content === "string") return { role: "user", parts: [{ text: m.content }] };
    const parts: unknown[] = [];
    for (const p of m.content as VisionContentPart[]) {
      if (p.type === "text") { parts.push({ text: p.text }); continue; }
      const url = p.image_url.url;
      const parsed = parseDataUrl(url);
      if (parsed) { parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } }); continue; }
      if (url.startsWith("http")) {
        const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
        const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        parts.push({ fileData: { mimeType: mime, fileUri: url } });
      }
    }
    return { role: "user", parts };
  });
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: entry.temperature ?? 0.25,
      responseMimeType: "application/json",
      ...(entry.maxTokens ? { maxOutputTokens: entry.maxTokens } : {}),
    },
  };
  if (systemMsg) body.systemInstruction = { parts: [{ text: typeof systemMsg.content === "string" ? systemMsg.content : "" }] };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: "POST", signal: AbortSignal.timeout(40_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const text = await res.text();
  if (!res.ok) { const e = new Error(`gemini_vision_http_${res.status}`); (e as Error & { body?: string }).body = text.slice(0, 800); throw e; }
  const j = JSON.parse(text) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  const content = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  setLastLlmPromptTrace({ provider: "google_gemini", model, source, messages: [] });
  return { content, costUsd: estimateTokenCost(model, j.usageMetadata?.promptTokenCount ?? 0, j.usageMetadata?.candidatesTokenCount ?? 0) };
}

// ── Adapter Anthropic (Claude) ─────────────────────────────────────────────────

async function _anthropicChat(
  entry: AiConfigEntry,
  messages: ChatMessage[],
  source: string
): Promise<{ content: string; costUsd: number }> {
  const key = config.anthropic.apiKey;
  if (!key) throw new Error("anthropic_not_configured");
  const model = entry.model || "claude-haiku-4-5-20251001";
  const maxTokens = entry.maxTokens ?? 4096;
  const systemMsg = messages.find(m => m.role === "system");
  const userMsgs = messages.filter(m => m.role !== "system").map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
  const body: Record<string, unknown> = { model, max_tokens: maxTokens, temperature: entry.temperature ?? 0.25, messages: userMsgs };
  if (systemMsg) body.system = systemMsg.content;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(40_000),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`anthropic_http_${res.status}`); (e as Error & { body?: string }).body = text.slice(0, 800); throw e; }
  const j = JSON.parse(text) as { content?: { text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const content = stripJsonFences(j.content?.[0]?.text ?? "");
  setLastLlmPromptTrace({ provider: "anthropic", model, source, messages: [...messages, { role: "assistant", content }] });
  return { content, costUsd: estimateTokenCost(model, j.usage?.input_tokens ?? 0, j.usage?.output_tokens ?? 0) };
}

async function _anthropicVision(
  entry: AiConfigEntry,
  messages: VisionMessage[],
  source: string
): Promise<{ content: string; costUsd: number }> {
  const key = config.anthropic.apiKey;
  if (!key) throw new Error("anthropic_not_configured");
  const model = entry.model || "claude-haiku-4-5-20251001";
  const maxTokens = entry.maxTokens ?? 4096;
  const systemMsg = messages.find(m => m.role === "system");
  const userMsgs = messages.filter(m => m.role !== "system").map(m => {
    if (typeof m.content === "string") return { role: m.role as "user" | "assistant", content: m.content };
    const content: unknown[] = [];
    for (const p of m.content as VisionContentPart[]) {
      if (p.type === "text") { content.push({ type: "text", text: p.text }); continue; }
      const url = p.image_url.url;
      const parsed = parseDataUrl(url);
      if (parsed) { content.push({ type: "image", source: { type: "base64", media_type: parsed.mimeType, data: parsed.data } }); continue; }
      if (url.startsWith("http")) content.push({ type: "image", source: { type: "url", url } });
    }
    return { role: "user" as const, content };
  });
  const body: Record<string, unknown> = { model, max_tokens: maxTokens, temperature: entry.temperature ?? 0.25, messages: userMsgs };
  if (systemMsg) body.system = typeof systemMsg.content === "string" ? systemMsg.content : "";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(40_000),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`anthropic_vision_http_${res.status}`); (e as Error & { body?: string }).body = text.slice(0, 800); throw e; }
  const j = JSON.parse(text) as { content?: { text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const content = stripJsonFences(j.content?.[0]?.text ?? "");
  setLastLlmPromptTrace({ provider: "anthropic", model, source, messages: [] });
  return { content, costUsd: estimateTokenCost(model, j.usage?.input_tokens ?? 0, j.usage?.output_tokens ?? 0) };
}

// ── Adapter Manus Proxy (OpenAI-compatible) ────────────────────────────────────

async function _manusProxyChat(
  entry: AiConfigEntry,
  messages: ChatMessage[],
  source: string
): Promise<{ content: string; costUsd: number }> {
  const forgeUrl = (process.env.BUILT_IN_FORGE_API_URL ?? "").trim();
  const forgeKey = (process.env.BUILT_IN_FORGE_API_KEY ?? "").trim();
  if (!forgeUrl || !forgeKey) throw new Error("manus_proxy_not_configured");
  const model = entry.model || (process.env.BUILT_IN_FORGE_MODEL ?? "gpt-4o-mini").trim();
  const res = await fetch(forgeUrl.replace(/\/$/, ""), {
    method: "POST",
    signal: AbortSignal.timeout(40_000),
    headers: { Authorization: `Bearer ${forgeKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: entry.temperature ?? 0.2, response_format: { type: "json_object" } }),
  });
  const raw = await res.text();
  if (!res.ok) { const e = new Error(`manus_proxy_http_${res.status}`); (e as Error & { body?: string }).body = raw.slice(0, 600); throw e; }
  let content = raw;
  try { const j = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] }; content = j.choices?.[0]?.message?.content ?? raw; } catch { /* texto bruto */ }
  setLastLlmPromptTrace({ provider: "forge", model, source, messages: [...messages, { role: "assistant", content }] });
  return { content, costUsd: 0 };
}

// ── API pública ────────────────────────────────────────────────────────────────

export const OPERATION_CHAT   = "chat_ia";
export const OPERATION_VISION = "vision_ia";

/**
 * Chamada de chat roteada pelo provedor configurado em ai_config para a operação dada.
 * Forge (BUILT_IN_FORGE_API_URL) tem prioridade para compatibilidade retroativa.
 */
export async function chatIa(
  messages: ChatMessage[],
  opts: { source?: string; operation?: string } = {}
): Promise<{ content: string; costUsd: number }> {
  const source = opts.source ?? "chatIa";
  // Forge tem prioridade global (retrocompat)
  const forgeUrl = (process.env.BUILT_IN_FORGE_API_URL ?? "").trim();
  const forgeKey = (process.env.BUILT_IN_FORGE_API_KEY ?? "").trim();
  if (forgeUrl && forgeKey) {
    return _manusProxyChat(
      { operation: opts.operation ?? OPERATION_CHAT, displayName: "", provider: "manus_proxy", model: (process.env.BUILT_IN_FORGE_MODEL ?? "gpt-4o-mini").trim(), isEnabled: true, maxTokens: null, temperature: 0.2 },
      messages, source
    );
  }
  const entry = await getAiConfig(opts.operation ?? OPERATION_CHAT);
  switch (entry.provider) {
    case "google_gemini": return _geminiChat(entry, messages, source);
    case "anthropic":     return _anthropicChat(entry, messages, source);
    case "manus_proxy":   return _manusProxyChat(entry, messages, source);
    default:              return _openaiChat(entry, messages, source);
  }
}

/**
 * Chamada de visão (imagem/vídeo) roteada pelo provedor configurado em ai_config.
 * manus_proxy não suporta vision — cai para openai.
 */
export async function visionIa(
  messages: VisionMessage[],
  opts: { source?: string; operation?: string } = {}
): Promise<{ content: string; costUsd: number }> {
  const source = opts.source ?? "visionIa";
  const forgeUrl = (process.env.BUILT_IN_FORGE_API_URL ?? "").trim();
  const forgeKey = (process.env.BUILT_IN_FORGE_API_KEY ?? "").trim();
  if (forgeUrl && forgeKey) {
    // Forge é OpenAI-compatible: usa adapter OpenAI com URL do Forge via config
    return _openaiVision({ operation: OPERATION_VISION, displayName: "", provider: "openai", model: (process.env.BUILT_IN_FORGE_MODEL ?? "gpt-4o-mini").trim(), isEnabled: true, maxTokens: null, temperature: 0.2 }, messages, source);
  }
  const entry = await getAiConfig(opts.operation ?? OPERATION_VISION);
  switch (entry.provider) {
    case "google_gemini": return _geminiVision(entry, messages, source);
    case "anthropic":     return _anthropicVision(entry, messages, source);
    default:              return _openaiVision(entry, messages, source);
  }
}
