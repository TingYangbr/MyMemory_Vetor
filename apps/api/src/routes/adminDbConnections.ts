import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import {
  createDbConnection,
  listDbConnections,
  softDeleteDbConnection,
  syntaxCheckMssql,
  testDbConnection,
  updateDbConnection,
} from "../services/adminDbConnectionsService.js";

const createBody = z.object({
  nome:                  z.string().min(1).max(255),
  descricao:             z.string().max(2000).nullable().optional(),
  host:                  z.string().min(1).max(255),
  port:                  z.number().int().min(1).max(65535).default(1433),
  database:              z.string().min(1).max(255),
  username:              z.string().min(1).max(255),
  password:              z.string().min(1).max(1000),
  encrypt:               z.number().int().min(0).max(1).default(0),
  trustServerCertificate: z.number().int().min(0).max(1).default(1),
});

const updateBody = z.object({
  nome:                  z.string().min(1).max(255).optional(),
  descricao:             z.string().max(2000).nullable().optional(),
  host:                  z.string().min(1).max(255).optional(),
  port:                  z.number().int().min(1).max(65535).optional(),
  database:              z.string().min(1).max(255).optional(),
  username:              z.string().min(1).max(255).optional(),
  password:              z.string().max(1000).optional(),
  encrypt:               z.number().int().min(0).max(1).optional(),
  trustServerCertificate: z.number().int().min(0).max(1).optional(),
  isActive:              z.number().int().min(0).max(1).optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/db-connections", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const connections = await listDbConnections();
    return { connections };
  });

  app.post("/api/admin/db-connections", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const id = await createDbConnection(parsed.data);
    return reply.code(201).send({ id });
  });

  app.put("/api/admin/db-connections/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const id = z.coerce.number().int().positive().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: "invalid_id" });
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    await updateDbConnection(id.data, parsed.data);
    return { ok: true };
  });

  app.delete("/api/admin/db-connections/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const id = z.coerce.number().int().positive().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: "invalid_id" });
    await softDeleteDbConnection(id.data);
    return { ok: true };
  });

  app.post("/api/admin/db-connections/:id/test", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const id = z.coerce.number().int().positive().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: "invalid_id" });
    const result = await testDbConnection(id.data);
    return result;
  });

  app.post("/api/admin/db-connections/:id/syntax-check", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const id = z.coerce.number().int().positive().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: "invalid_id" });
    const body = z.object({ sentencaSql: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const result = await syntaxCheckMssql(id.data, body.data.sentencaSql);
    return result;
  });
};

export default plugin;
