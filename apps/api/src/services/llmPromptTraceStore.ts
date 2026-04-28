export type LlmPromptRole = "system" | "user" | "assistant";

export interface LlmPromptTraceMessage {
  role: LlmPromptRole;
  content: string;
}

export interface LlmPromptTrace {
  createdAt: string;
  provider: "openai" | "forge";
  model: string;
  source: string;
  messages: LlmPromptTraceMessage[];
}

let traces: LlmPromptTrace[] = [];

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
  provider: "openai" | "forge";
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

export function resetLlmPromptTraces(): void {
  traces = [];
}

export function setLastLlmPromptTrace(input: Parameters<typeof buildTrace>[0]): void {
  traces.push(buildTrace(input));
}

export function getAllLlmPromptTraces(): LlmPromptTrace[] {
  return [...traces];
}

export function getLastLlmPromptTrace(): LlmPromptTrace | null {
  return traces.length > 0 ? traces[traces.length - 1]! : null;
}
