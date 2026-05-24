import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { resolveUserId } from "../lib/userContext.js";
import { assertUserWorkspaceGroupAccess } from "../services/memoContextService.js";
import { getUserIsAdmin } from "../lib/userContext.js";

const createSchema = z.object({
  pergunta: z.string().min(1).max(4000),
  category: z.string().nullable().optional(),
  workspaceGroupId: z.number().int().positive().nullable().optional(),
  anotacoes: z.string().nullable().optional(),
});

const updateSchema = z.object({
  pergunta: z.string().min(1).max(4000).optional(),
  category: z.string().nullable().optional(),
  anotacoes: z.string().nullable().optional(),
  estrelas: z.number().int().min(1).max(5).nullable().optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  // GET /api/pergunta-modelos?workspaceGroupId=N
  app.get("/api/pergunta-modelos", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const query = req.query as Record<string, string>;
    const rawGid = query.workspaceGroupId;
    const groupId = rawGid && rawGid !== "null" ? parseInt(rawGid, 10) : null;

    if (groupId != null) {
      const isAdmin = await getUserIsAdmin(userId);
      try {
        await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
      } catch {
        return reply.code(403).send({ error: "forbidden_group" });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, userid, groupid, category, pergunta, anotacoes, estrelas, createdat, updatedat
         FROM pergunta_modelos WHERE groupid = ? ORDER BY createdat DESC`,
        [groupId]
      );
      return reply.send({ modelos: rows });
    } else {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, userid, groupid, category, pergunta, anotacoes, estrelas, createdat, updatedat
         FROM pergunta_modelos WHERE groupid IS NULL AND userid = ? ORDER BY createdat DESC`,
        [userId]
      );
      return reply.send({ modelos: rows });
    }
  });

  // POST /api/pergunta-modelos
  app.post("/api/pergunta-modelos", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const { pergunta, category, workspaceGroupId, anotacoes } = parsed.data;
    const groupId = workspaceGroupId ?? null;

    if (groupId != null) {
      const isAdmin = await getUserIsAdmin(userId);
      try {
        await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
      } catch {
        return reply.code(403).send({ error: "forbidden_group" });
      }
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `INSERT INTO pergunta_modelos (userid, groupid, category, pergunta, anotacoes)
       VALUES (?, ?, ?, ?, ?) RETURNING id, userid, groupid, category, pergunta, anotacoes, estrelas, createdat, updatedat`,
      [userId, groupId, category ?? null, pergunta, anotacoes ?? null]
    );
    return reply.code(201).send({ modelo: (rows as Record<string, unknown>[])[0] });
  });

  // PUT /api/pergunta-modelos/:id
  app.put("/api/pergunta-modelos/:id", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const id = parseInt((req.params as { id: string }).id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: "invalid_id" });

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    // Só o criador pode editar
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM pergunta_modelos WHERE id = ? AND userid = ?`,
      [id, userId]
    );
    if (!(existing as unknown[]).length) return reply.code(404).send({ error: "not_found" });

    const { pergunta, category, anotacoes, estrelas } = parsed.data;
    const sets: string[] = ["updatedat = NOW()"];
    const vals: unknown[] = [];
    if (pergunta !== undefined) { sets.push("pergunta = ?"); vals.push(pergunta); }
    if (category !== undefined) { sets.push("category = ?"); vals.push(category); }
    if (anotacoes !== undefined) { sets.push("anotacoes = ?"); vals.push(anotacoes); }
    if (estrelas !== undefined) { sets.push("estrelas = ?"); vals.push(estrelas); }
    vals.push(id, userId);

    const [rows] = await pool.query<RowDataPacket[]>(
      `UPDATE pergunta_modelos SET ${sets.join(", ")} WHERE id = ? AND userid = ?
       RETURNING id, userid, groupid, category, pergunta, anotacoes, estrelas, createdat, updatedat`,
      vals
    );
    return reply.send({ modelo: (rows as Record<string, unknown>[])[0] });
  });

  // DELETE /api/pergunta-modelos/:id
  app.delete("/api/pergunta-modelos/:id", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const id = parseInt((req.params as { id: string }).id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: "invalid_id" });

    await pool.query(
      `DELETE FROM pergunta_modelos WHERE id = ? AND userid = ?`,
      [id, userId]
    );
    return reply.send({ ok: true });
  });
};

export default plugin;
