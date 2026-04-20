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

let lastLlmPromptTrace: LlmPromptTrace | null = null;

function normalizeContent(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function setLastLlmPromptTrace(input: {
  provider: "openai" | "forge";
  model: string;
  source: string;
  system?: unknown;
  user?: unknown;
  assistant?: unknown;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: unknown }>;
}): void {
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

  lastLlmPromptTrace = {
    createdAt: new Date().toISOString(),
    provider: input.provider,
    model: input.model,
    source: input.source,
    messages,
  };
}

export function getLastLlmPromptTrace(): LlmPromptTrace | null {
  return lastLlmPromptTrace;
}
