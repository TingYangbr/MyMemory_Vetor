import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import { createGroupApiKey, listGroupApiKeys, revokeGroupApiKey } from "../services/groupApiKeysService.js";

const createBody = z.object({
  groupId: z.number().int().positive(),
  userId: z.number().int().positive(),
  nome: z.string().min(1).max(255),
  expiresAt: z.string().datetime().nullable().optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/group-api-keys", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const rawGroupId = (req.query as { groupId?: string }).groupId;
    let groupId: number | undefined;
    if (rawGroupId !== undefined) {
      const parsed = z.coerce.number().int().positive().safeParse(rawGroupId);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_groupId" });
      groupId = parsed.data;
    }
    const keys = await listGroupApiKeys(groupId);
    return { keys };
  });

  app.post("/api/admin/group-api-keys", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const { id, rawKey } = await createGroupApiKey(parsed.data);
    // rawKey só existe nesta resposta — o admin precisa copiar agora, nunca mais é recuperável.
    return reply.code(201).send({ id, rawKey });
  });

  app.delete("/api/admin/group-api-keys/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const id = z.coerce.number().int().positive().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: "invalid_id" });
    await revokeGroupApiKey(id.data);
    return { ok: true };
  });
};

export default plugin;
