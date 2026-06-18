import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveUserId } from "../lib/userContext.js";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import {
  assertConnectionBelongsToGroup,
  createDbConnection,
  listDbConnections,
  softDeleteDbConnection,
  testDbConnection,
  updateDbConnection,
  syntaxCheckMssql,
} from "../services/adminDbConnectionsService.js";

const groupIdParam = z.coerce.number().int().positive();
const connIdParam  = z.coerce.number().int().positive();

const createBody = z.object({
  nome:                   z.string().min(1).max(255),
  descricao:              z.string().max(2000).nullable().optional(),
  host:                   z.string().min(1).max(255),
  port:                   z.number().int().min(1).max(65535).default(1433),
  database:               z.string().min(1).max(255),
  username:               z.string().min(1).max(255),
  password:               z.string().min(1).max(1000),
  encrypt:                z.number().int().min(0).max(1).default(0),
  trustServerCertificate: z.number().int().min(0).max(1).default(1),
  isPrincipal:            z.number().int().min(0).max(1).default(0),
});

const updateBody = z.object({
  nome:                   z.string().min(1).max(255).optional(),
  descricao:              z.string().max(2000).nullable().optional(),
  host:                   z.string().min(1).max(255).optional(),
  port:                   z.number().int().min(1).max(65535).optional(),
  database:               z.string().min(1).max(255).optional(),
  username:               z.string().min(1).max(255).optional(),
  password:               z.string().max(1000).optional(),
  encrypt:                z.number().int().min(0).max(1).optional(),
  trustServerCertificate: z.number().int().min(0).max(1).optional(),
  isPrincipal:            z.number().int().min(0).max(1).optional(),
});

/** Returns userId if the request is from an admin or an owner of the group; sends error otherwise. */
async function assertOwnerOrAdmin(req: FastifyRequest, reply: FastifyReply, groupId: number): Promise<number | null> {
  const userId = await resolveUserId(req);
  if (!userId) {
    void reply.code(401).send({ error: "unauthorized" });
    return null;
  }

  const [userRows] = await pool.query<RowDataPacket[]>("SELECT role FROM users WHERE id = ? LIMIT 1", [userId]);
  const isAdmin = userRows[0]?.role === "admin";
  if (isAdmin) return userId;

  const [ownerRows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM groups g
     WHERE g.id = ?
     AND (
       EXISTS (SELECT 1 FROM subscriptions s WHERE s.id = g.subscriptionid AND s.ownerid = ? AND s.type = 'group' AND s.status = 'active')
       OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.groupid = g.id AND gm.userid = ? AND gm.role = 'owner')
     )
     LIMIT 1`,
    [groupId, userId, userId]
  );
  if (!ownerRows[0]) {
    void reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return userId;
}

const plugin: FastifyPluginAsync = async (app) => {
  // GET /api/groups/:groupId/db-connections
  app.get("/api/groups/:groupId/db-connections", async (req, reply) => {
    const gid = groupIdParam.safeParse((req.params as { groupId: string }).groupId);
    if (!gid.success) return reply.code(400).send({ error: "invalid_group_id" });
    const uid = await assertOwnerOrAdmin(req, reply, gid.data);
    if (uid == null) return;
    const connections = await listDbConnections({ groupId: gid.data });
    return { connections };
  });

  // POST /api/groups/:groupId/db-connections
  app.post("/api/groups/:groupId/db-connections", async (req, reply) => {
    const gid = groupIdParam.safeParse((req.params as { groupId: string }).groupId);
    if (!gid.success) return reply.code(400).send({ error: "invalid_group_id" });
    const uid = await assertOwnerOrAdmin(req, reply, gid.data);
    if (uid == null) return;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const id = await createDbConnection({ ...parsed.data, groupId: gid.data });
    return reply.code(201).send({ id });
  });

  // PUT /api/groups/:groupId/db-connections/:id
  app.put("/api/groups/:groupId/db-connections/:id", async (req, reply) => {
    const params = req.params as { groupId: string; id: string };
    const gid = groupIdParam.safeParse(params.groupId);
    const cid = connIdParam.safeParse(params.id);
    if (!gid.success || !cid.success) return reply.code(400).send({ error: "invalid_params" });
    const uid = await assertOwnerOrAdmin(req, reply, gid.data);
    if (uid == null) return;
    try { await assertConnectionBelongsToGroup(cid.data, gid.data); }
    catch { return reply.code(404).send({ error: "not_found" }); }
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    await updateDbConnection(cid.data, parsed.data);
    return { ok: true };
  });

  // DELETE /api/groups/:groupId/db-connections/:id
  app.delete("/api/groups/:groupId/db-connections/:id", async (req, reply) => {
    const params = req.params as { groupId: string; id: string };
    const gid = groupIdParam.safeParse(params.groupId);
    const cid = connIdParam.safeParse(params.id);
    if (!gid.success || !cid.success) return reply.code(400).send({ error: "invalid_params" });
    const uid = await assertOwnerOrAdmin(req, reply, gid.data);
    if (uid == null) return;
    try { await assertConnectionBelongsToGroup(cid.data, gid.data); }
    catch { return reply.code(404).send({ error: "not_found" }); }
    await softDeleteDbConnection(cid.data);
    return { ok: true };
  });

  // POST /api/groups/:groupId/db-connections/:id/test
  app.post("/api/groups/:groupId/db-connections/:id/test", async (req, reply) => {
    const params = req.params as { groupId: string; id: string };
    const gid = groupIdParam.safeParse(params.groupId);
    const cid = connIdParam.safeParse(params.id);
    if (!gid.success || !cid.success) return reply.code(400).send({ error: "invalid_params" });
    const uid = await assertOwnerOrAdmin(req, reply, gid.data);
    if (uid == null) return;
    try { await assertConnectionBelongsToGroup(cid.data, gid.data); }
    catch { return reply.code(404).send({ error: "not_found" }); }
    return testDbConnection(cid.data);
  });

  // POST /api/groups/:groupId/db-connections/:id/syntax-check
  app.post("/api/groups/:groupId/db-connections/:id/syntax-check", async (req, reply) => {
    const params = req.params as { groupId: string; id: string };
    const gid = groupIdParam.safeParse(params.groupId);
    const cid = connIdParam.safeParse(params.id);
    if (!gid.success || !cid.success) return reply.code(400).send({ error: "invalid_params" });
    const uid = await assertOwnerOrAdmin(req, reply, gid.data);
    if (uid == null) return;
    try { await assertConnectionBelongsToGroup(cid.data, gid.data); }
    catch { return reply.code(404).send({ error: "not_found" }); }
    const body = z.object({ sentencaSql: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    return syntaxCheckMssql(cid.data, body.data.sentencaSql);
  });
};

export default plugin;
