import { AsyncLocalStorage } from "node:async_hooks";

export type LlmPromptRole = "system" | "user" | "assistant";

export interface LlmPromptTraceMessage {
  role: LlmPromptRole;
  content: string;
}

export interface LlmPromptTrace {
  createdAt: string;
  provider: "openai" | "forge" | "sql" | "google_gemini" | "anthropic";
  model: string;
  source: string;
  messages: LlmPromptTraceMessage[];
}

const traceStorage = new AsyncLocalStorage<LlmPromptTrace[]>();

// Último trace global — sobrevive entre requisições (perde-se ao reiniciar)
let globalLastTrace: LlmPromptTrace | null = null;

function normalizeContent(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function buildTrace(input: {
  provider: "openai" | "forge" | "sql" | "google_gemini" | "anthropic";
  model: string;
  source: string;
  system?: unknown;
  user?: unknown;
  assistant?: unknown;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: unknown }>;
}): LlmPromptTrace {
  const messages: LlmPromptTraceMessage[] = [];
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    for (const m of input.messages) {
      messages.push({ role: m.role, content: normalizeContent(m.content) });
    }
  } else {
    if (input.system !== undefined) {
      messages.push({ role: "system", content: normalizeContent(input.system) });
    }
    if (input.user !== undefined) {
      messages.push({ role: "user", content: normalizeContent(input.user) });
    }
    if (input.assistant !== undefined) {
      messages.push({ role: "assistant", content: normalizeContent(input.assistant) });
    }
  }
  return { createdAt: new Date().toISOString(), provider: input.provider, model: input.model, source: input.source, messages };
}

export async function runWithTraces<T>(fn: () => Promise<T>): Promise<{ value: T; traces: LlmPromptTrace[] }> {
  const traces: LlmPromptTrace[] = [];
  const value = await traceStorage.run(traces, fn);
  return { value, traces };
}

/** @deprecated Não é mais necessário — cada runWithTraces cria contexto isolado. Mantido por compatibilidade. */
export function resetLlmPromptTraces(): void {
  const store = traceStorage.getStore();
  if (store) store.length = 0;
}

export function setLastLlmPromptTrace(input: Parameters<typeof buildTrace>[0]): void {
  const trace = buildTrace(input);
  const store = traceStorage.getStore();
  if (store) store.push(trace);
  globalLastTrace = trace;
}

export function getAllLlmPromptTraces(): LlmPromptTrace[] {
  const store = traceStorage.getStore();
  return store ? [...store] : [];
}

export function getLastLlmPromptTrace(): LlmPromptTrace | null {
  const store = traceStorage.getStore();
  if (store && store.length > 0) return store[store.length - 1]!;
  return globalLastTrace;
}
