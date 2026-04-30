import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import { listPromptConfigs, upsertPromptConfig } from "../services/llmPromptConfigService.js";

const patchBody = z.object({
  texto_padrao: z.string().nullable().optional(),
  texto_atual: z.string().nullable().optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/prompt-configs", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const configs = await listPromptConfigs();
    return { configs };
  });

  app.patch("/api/admin/prompt-configs/:chave", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;

    const chave = (req.params as { chave: string }).chave;
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }

    const fields: { texto_padrao?: string | null; texto_atual?: string | null } = {};
    if ("texto_padrao" in parsed.data) fields.texto_padrao = parsed.data.texto_padrao ?? null;
    if ("texto_atual" in parsed.data) fields.texto_atual = parsed.data.texto_atual ?? null;

    await upsertPromptConfig(chave, fields);
    return { ok: true };
  });
};

export default plugin;
