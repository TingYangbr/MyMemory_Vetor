import { chatIa } from "./aiProviderFactory.js";
import { setLastLlmPromptTrace } from "../services/llmPromptTraceStore.js";

export type OpenAiUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

/** @deprecated Mantido para compatibilidade — delegado ao aiProviderFactory (chatIa). */
export function estimateCostUsd(_u: OpenAiUsage | null): number { return 0; }

/**
 * Chamada de chat unificada: delega ao provedor configurado em ai_config (operação "chat_ia").
 * Retém a assinatura anterior para compatibilidade com todos os call sites.
 */
export async function openaiChatJson(args: {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  source?: string;
}): Promise<{ content: string; usage: OpenAiUsage | null; costUsd: number }> {
  const { content, costUsd } = await chatIa(args.messages, { source: args.source ?? "openaiChatJson" });
  // usage não está disponível de forma portável entre provedores
  return { content, usage: null, costUsd };
}

// Re-exporta setLastLlmPromptTrace para quem já importava daqui (retrocompat)
export { setLastLlmPromptTrace };
