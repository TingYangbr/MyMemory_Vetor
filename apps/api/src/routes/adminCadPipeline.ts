import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import { getCadPipelineEnabled, setCadPipelineEnabled } from "../services/cadPipelineService.js";

const putBody = z.object({
  enabled: z.boolean(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/cad-pipeline", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const enabled = await getCadPipelineEnabled();
    return { enabled };
  });

  app.put("/api/admin/cad-pipeline", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const parsed = putBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    await setCadPipelineEnabled(parsed.data.enabled);
    return reply.code(204).send();
  });
};

export default plugin;
