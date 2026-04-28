import type { FastifyPluginAsync } from "fastify";
import type { AdminSystemConfigResponse } from "@mymemory/shared";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import { listSystemConfig, upsertSystemConfig } from "../services/systemConfigService.js";

const ALLOWED_KEYS = new Set([
  "fatorCredCost",
  "showApiCost",
  "semanticSearchInitialThreshold",
  "semanticSearchMinThreshold",
  "showLlmTrace",
]);

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/system-config", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const items = await listSystemConfig();
    const body: AdminSystemConfigResponse = { items };
    return body;
  });

  app.put("/api/admin/system-config/:key", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;

    const key = (req.params as { key: string }).key;
    if (!ALLOWED_KEYS.has(key)) {
      return reply.code(400).send({ error: "invalid_key", message: "Chave não permitida." });
    }

    const parsed = z.object({ value: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: "Campo `value` obrigatório." });
    }

    await upsertSystemConfig(key, parsed.data.value, admin);
    return { ok: true };
  });
};

export default plugin;
