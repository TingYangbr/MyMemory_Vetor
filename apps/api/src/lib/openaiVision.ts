import { visionIa } from "./aiProviderFactory.js";

export type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

import type { OpenAiUsage } from "./openaiChat.js";

/**
 * Chamada de visão unificada: delega ao provedor configurado em ai_config (operação "vision_ia").
 * Retém a assinatura anterior para compatibilidade com todos os call sites.
 */
export async function openaiChatVisionJson(args: {
  messages: { role: "system" | "user" | "assistant"; content: string | VisionContentPart[] }[];
  temperature?: number;
}): Promise<{ content: string; usage: OpenAiUsage | null; costUsd: number }> {
  const { content, costUsd } = await visionIa(args.messages, { source: "openaiChatVisionJson" });
  return { content, usage: null, costUsd };
}
