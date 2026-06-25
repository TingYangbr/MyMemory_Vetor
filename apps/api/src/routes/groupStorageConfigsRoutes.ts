import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import { assertUserWorkspaceGroupAccess } from "../services/memoContextService.js";
import {
  listGroupStorageConfigs,
  createGroupStorageConfig,
  updateGroupStorageConfig,
  deleteGroupStorageConfig,
  testWebDavConnection,
} from "../services/groupStorageService.js";

const createBody = z.object({
  label:      z.string().min(1).max(100),
  tipo:       z.enum(["WEBDAV"]).default("WEBDAV"),
  url:        z.string().url().max(500),
  pathPrefix: z.string().max(500).nullable().optional(),
  username:   z.string().max(255).nullable().optional(),
  password:   z.string().max(1000).nullable().optional(),
  isDefault:  z.boolean().optional(),
});

const updateBody = z.object({
  label:         z.string().min(1).max(100).optional(),
  url:           z.string().url().max(500).optional(),
  pathPrefix:    z.string().max(500).nullable().optional(),
  username:      z.string().max(255).nullable().optional(),
  password:      z.string().max(1000).nullable().optional(),
  clearPassword: z.boolean().optional(),
  isDefault:     z.boolean().optional(),
});

const testBody = z.object({
  url:        z.string().url().max(500),
  pathPrefix: z.string().max(500).nullable().optional(),
  username:   z.string().max(255).nullable().optional(),
  password:   z.string().max(1000).nullable().optional(),
});

const plugin: FastifyPluginAsync = async (app) => {

  // ── Leitura para qualquer membro do grupo ────────────────────────────────
  // Usado no Batch Import para popular o dropdown de configs WebDAV.

  app.get("/api/groups/:groupId/storage-configs", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const isAdmin = await getUserIsAdmin(userId);

    const groupId = Number((req.params as { groupId: string }).groupId);
    if (!Number.isFinite(groupId) || groupId <= 0) return reply.code(400).send({ error: "invalid_group_id" });

    try {
      await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
    } catch {
      return reply.code(403).send({ error: "forbidden" });
    }

    const configs = await listGroupStorageConfigs({ groupId });
    return { configs };
  });

  // ── Admin: listar configs de um grupo ────────────────────────────────────

  app.get("/api/admin/groups/:groupId/storage-configs", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    if (!await getUserIsAdmin(userId)) return reply.code(403).send({ error: "forbidden" });

    const groupId = Number((req.params as { groupId: string }).groupId);
    if (!Number.isFinite(groupId) || groupId <= 0) return reply.code(400).send({ error: "invalid_group_id" });

    const configs = await listGroupStorageConfigs({ groupId });
    return { configs };
  });

  // ── Admin: criar config para um grupo ────────────────────────────────────

  app.post("/api/admin/groups/:groupId/storage-configs", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    if (!await getUserIsAdmin(userId)) return reply.code(403).send({ error: "forbidden" });

    const groupId = Number((req.params as { groupId: string }).groupId);
    if (!Number.isFinite(groupId) || groupId <= 0) return reply.code(400).send({ error: "invalid_group_id" });

    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

    const cfg = await createGroupStorageConfig({ groupId, ...parsed.data });
    return reply.code(201).send({ config: cfg });
  });

  // ── Admin: atualizar config ───────────────────────────────────────────────

  app.patch("/api/admin/storage-configs/:id", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    if (!await getUserIsAdmin(userId)) return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id) || id <= 0) return reply.code(400).send({ error: "invalid_id" });

    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

    const cfg = await updateGroupStorageConfig(id, parsed.data);
    if (!cfg) return reply.code(404).send({ error: "not_found" });
    return { config: cfg };
  });

  // ── Admin: remover config (soft delete) ──────────────────────────────────

  app.delete("/api/admin/storage-configs/:id", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    if (!await getUserIsAdmin(userId)) return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id) || id <= 0) return reply.code(400).send({ error: "invalid_id" });

    const ok = await deleteGroupStorageConfig(id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  // ── Admin: testar conexão WebDAV ─────────────────────────────────────────

  app.post("/api/admin/storage-configs/test-connection", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    if (!await getUserIsAdmin(userId)) return reply.code(403).send({ error: "forbidden" });

    const parsed = testBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

    const result = await testWebDavConnection(parsed.data);
    return result;
  });
};

export default plugin;
