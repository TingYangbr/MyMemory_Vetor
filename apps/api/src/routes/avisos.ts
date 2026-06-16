import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { resolveUserId } from "../lib/userContext.js";
import { calcularProximaExecucao, executarAviso, reexecutarSnapshot } from "../services/avisoService.js";

const criarSchema = z.object({
  descricao: z.string().min(1).max(500),
  perguntaOriginal: z.string().min(1).max(4000),
  pipe: z.enum(["semantica", "estruturada", "hibrida"]),
  execucaoSnapshot: z.record(z.unknown()),
  frequenciaTipo: z.enum(["horas", "diaria", "semanal", "mensal"]),
  frequenciaHoras: z.number().int().min(1).max(12).nullable().optional(),
  canalDestino: z.string().email(),
  workspaceGroupId: z.number().int().positive().nullable().optional(),
});

const patchSchema = z.object({
  status: z.enum(["ativo", "pausado"]).optional(),
  frequenciaTipo: z.enum(["horas", "diaria", "semanal", "mensal"]).optional(),
  frequenciaHoras: z.number().int().min(1).max(12).nullable().optional(),
  descricao: z.string().min(1).max(500).optional(),
  canalDestino: z.string().email().optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  // POST /api/avisos — criar
  app.post("/api/avisos", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const { descricao, perguntaOriginal, pipe, execucaoSnapshot, frequenciaTipo, frequenciaHoras, canalDestino, workspaceGroupId } = parsed.data;
    const groupId = workspaceGroupId ?? null;
    const proxima = calcularProximaExecucao(frequenciaTipo, frequenciaHoras);

    // Captura o estado atual como baseline antes de gravar, para que o primeiro
    // check do scheduler compare contra o momento da criação do aviso.
    let baselineJson: string | null = null;
    try {
      const baseline = await reexecutarSnapshot(
        execucaoSnapshot as unknown as import("@mymemory/shared").AvisoExecucaoSnapshot,
        perguntaOriginal,
        userId,
        groupId
      );
      baselineJson = JSON.stringify(baseline);
    } catch (err) {
      console.error("[avisos] erro ao capturar baseline:", err instanceof Error ? err.message : err);
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `INSERT INTO avisos
         (userid, groupid, descricao, perguntaoriginal, pipe, execucaosnapshotjson,
          frequenciatipo, frequenciahoras, canalenvio, canaldestino,
          ultimoresultadojson, ultimaexecucao, proximaexecucao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'email', ?, ?, NOW(), ?)
       RETURNING id, userid, groupid, descricao, perguntaoriginal, pipe, execucaosnapshotjson,
                 frequenciatipo, frequenciahoras, canalenvio, canaldestino,
                 ultimoresultadojson, ultimaexecucao, proximaexecucao, status, createdat`,
      [userId, groupId, descricao, perguntaOriginal, pipe, JSON.stringify(execucaoSnapshot),
       frequenciaTipo, frequenciaHoras ?? null, canalDestino, baselineJson, proxima.toISOString()]
    );

    return reply.code(201).send({ aviso: (rows as Record<string, unknown>[])[0] });
  });

  // GET /api/avisos — listar do usuário
  app.get("/api/avisos", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.userid, a.groupid, a.descricao, a.perguntaoriginal, a.pipe,
              a.frequenciatipo, a.frequenciahoras, a.canalenvio, a.canaldestino,
              a.ultimaexecucao, a.proximaexecucao, a.status, a.createdat,
              h.enviadoem AS ultimoaviso, h.texto AS ultimoavisotexto
       FROM avisos a
       LEFT JOIN LATERAL (
         SELECT enviadoem, texto FROM aviso_historico WHERE avisoid = a.id ORDER BY enviadoem DESC LIMIT 1
       ) h ON TRUE
       WHERE a.userid = ?
       ORDER BY a.createdat DESC`,
      [userId]
    );

    return reply.send({ avisos: rows });
  });

  // GET /api/avisos/:id — detalhe
  app.get("/api/avisos/:id", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const id = parseInt((req.params as { id: string }).id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: "invalid_id" });

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, userid, groupid, descricao, perguntaoriginal, pipe, execucaosnapshotjson,
              frequenciatipo, frequenciahoras, canalenvio, canaldestino,
              ultimoresultadojson, ultimaexecucao, proximaexecucao, status, createdat
       FROM avisos WHERE id = ? AND userid = ?`,
      [id, userId]
    );
    if (!(rows as unknown[]).length) return reply.code(404).send({ error: "not_found" });

    const [histRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, avisoid, enviadoem, texto, custousd
       FROM aviso_historico WHERE avisoid = ? ORDER BY enviadoem DESC LIMIT 3`,
      [id]
    );

    return reply.send({ aviso: { ...(rows as Record<string, unknown>[])[0], historico: histRows } });
  });

  // PATCH /api/avisos/:id — atualizar
  app.patch("/api/avisos/:id", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const id = parseInt((req.params as { id: string }).id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: "invalid_id" });

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT userid FROM avisos WHERE id = ?`, [id]
    );
    if (!(existing as unknown[]).length) return reply.code(404).send({ error: "not_found" });
    if ((existing as Record<string, unknown>[])[0].userId !== userId) return reply.code(403).send({ error: "forbidden" });

    const { status, frequenciaTipo, frequenciaHoras, descricao, canalDestino } = parsed.data;
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (status !== undefined) { sets.push("status = ?"); vals.push(status); }
    if (descricao !== undefined) { sets.push("descricao = ?"); vals.push(descricao); }
    if (canalDestino !== undefined) { sets.push("canaldestino = ?"); vals.push(canalDestino); }
    if (frequenciaTipo !== undefined) {
      sets.push("frequenciatipo = ?");
      vals.push(frequenciaTipo);
      const proxima = calcularProximaExecucao(frequenciaTipo, frequenciaHoras);
      sets.push("proximaexecucao = ?");
      vals.push(proxima.toISOString());
    }
    if (frequenciaHoras !== undefined) { sets.push("frequenciahoras = ?"); vals.push(frequenciaHoras); }
    if (!sets.length) return reply.send({ ok: true });

    vals.push(id);
    await pool.query(`UPDATE avisos SET ${sets.join(", ")} WHERE id = ?`, vals);
    return reply.send({ ok: true });
  });

  // DELETE /api/avisos/:id
  app.delete("/api/avisos/:id", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const id = parseInt((req.params as { id: string }).id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: "invalid_id" });

    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT userid FROM avisos WHERE id = ?`, [id]
    );
    if (!(existing as unknown[]).length) return reply.send({ ok: true });
    if ((existing as Record<string, unknown>[])[0].userId !== userId) return reply.code(403).send({ error: "forbidden" });

    await pool.query(`DELETE FROM avisos WHERE id = ?`, [id]);
    return reply.send({ ok: true });
  });

  // POST /api/avisos/:id/executar — execução manual
  app.post("/api/avisos/:id/executar", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const id = parseInt((req.params as { id: string }).id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: "invalid_id" });

    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT userid FROM avisos WHERE id = ?`, [id]
    );
    if (!(existing as unknown[]).length) return reply.code(404).send({ error: "not_found" });
    if ((existing as Record<string, unknown>[])[0].userId !== userId) return reply.code(403).send({ error: "forbidden" });

    const result = await executarAviso(id);
    return reply.send(result);
  });
};

export default plugin;
