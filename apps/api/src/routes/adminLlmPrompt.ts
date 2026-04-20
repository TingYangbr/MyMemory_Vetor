import type { FastifyPluginAsync } from "fastify";
import type { AdminLlmLastPromptResponse } from "@mymemory/shared";
import { requireAdmin } from "../lib/adminContext.js";
import { getLastLlmPromptTrace } from "../services/llmPromptTraceStore.js";

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/llm-last-prompt", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const trace = getLastLlmPromptTrace();
    const body: AdminLlmLastPromptResponse = {
      ok: true,
      trace,
    };
    return reply.send(body);
  });
};

export default plugin;
