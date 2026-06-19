import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";

const cloneBody = z.object({
  categoryIds: z.array(z.number().int().positive()).min(1).max(100),
  targetGroupId: z.number().int().positive(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.post("/api/admin/memo-context/clone-categories", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;

    const parsed = cloneBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      });
    }

    const { categoryIds, targetGroupId } = parsed.data;

    // Verifica que o grupo destino existe
    const [gRows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM groups WHERE id = ? LIMIT 1",
      [targetGroupId]
    );
    if (!gRows[0]) {
      return reply.code(404).send({ error: "group_not_found", message: "Grupo não encontrado." });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const cloned: { originalId: number; newId: number; name: string }[] = [];

      for (const catId of categoryIds) {
        // Busca categoria — deve ser global (groupId IS NULL)
        const [catRows] = await conn.query<RowDataPacket[]>(
          `SELECT id, groupid, mediatype, name, description FROM categories
           WHERE id = ? AND isactive = 1 AND groupid IS NULL
           LIMIT 1`,
          [catId]
        );
        const cat = catRows[0];
        if (!cat) continue; // pula se não for global ou não existir

        // Clona categoria com o grupo destino
        const [newCatRows] = await conn.query<{ id: number }[]>(
          `INSERT INTO categories (groupid, mediatype, name, description, isactive)
           VALUES (?, ?, ?, ?, 1) RETURNING id`,
          [targetGroupId, cat.mediaType ?? null, cat.name, cat.description ?? null]
        );
        const newCatId = Number(newCatRows[0]?.id);
        if (!Number.isFinite(newCatId)) throw new Error("Falha ao inserir categoria clonada.");

        // Clona subcategorias
        const [subRows] = await conn.query<RowDataPacket[]>(
          `SELECT name, description FROM subcategories WHERE categoryid = ? AND isactive = 1`,
          [catId]
        );
        for (const sub of subRows) {
          await conn.query(
            `INSERT INTO subcategories (categoryid, name, description, isactive) VALUES (?, ?, ?, 1)`,
            [newCatId, sub.name, sub.description ?? null]
          );
        }

        // Clona campos
        const [campoRows] = await conn.query<RowDataPacket[]>(
          `SELECT name, description, normalizedterms FROM categorycampos WHERE categoryid = ? AND isactive = 1`,
          [catId]
        );
        for (const campo of campoRows) {
          await conn.query(
            `INSERT INTO categorycampos (categoryid, name, description, normalizedterms, isactive) VALUES (?, ?, ?, ?, 1)`,
            [newCatId, campo.name, campo.description ?? null, campo.normalizedTerms ?? null]
          );
        }

        // Clona queries com conexaoid=NULL: cada grupo configura sua própria conexão ERP
        const [queryRows] = await conn.query<RowDataPacket[]>(
          `SELECT id, nome, descricao, sentencasql FROM queries_categoria WHERE categoryid = ? AND isactive = 1`,
          [catId]
        );
        for (const qRow of queryRows) {
          const [newQRows] = await conn.query<{ id: number }[]>(
            `INSERT INTO queries_categoria (categoryid, nome, descricao, sentencasql, conexaoid, isactive)
             VALUES (?, ?, ?, ?, NULL, 1) RETURNING id`,
            [newCatId, qRow.nome, qRow.descricao ?? null, qRow.sentencaSql]
          );
          const newQId = Number(newQRows[0]?.id);
          if (!Number.isFinite(newQId)) throw new Error("Falha ao inserir query clonada.");

          // Clona parâmetros da query
          const [paramRows] = await conn.query<RowDataPacket[]>(
            `SELECT campo, tipo, obrigatorio, operadorsql, normalizar, ordem
             FROM queries_categoria_params WHERE queryid = ? AND isactive = 1 ORDER BY ordem ASC`,
            [qRow.id]
          );
          for (const p of paramRows) {
            await conn.query(
              `INSERT INTO queries_categoria_params (queryid, campo, tipo, obrigatorio, operadorsql, normalizar, ordem, isactive)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
              [newQId, p.campo, p.tipo, p.obrigatorio ?? 0, p.operadorSql ?? null, p.normalizar ?? 0, p.ordem ?? 0]
            );
          }
        }

        // Clona overrides de prompt LLM (ON CONFLICT para segurança)
        const [overrideRows] = await conn.query<RowDataPacket[]>(
          `SELECT prompt_chave, texto FROM llm_prompt_category_overrides WHERE category_id = ?`,
          [catId]
        );
        for (const ov of overrideRows) {
          await conn.query(
            `INSERT INTO llm_prompt_category_overrides (prompt_chave, category_id, texto, updatedat)
             VALUES (?, ?, ?, NOW())
             ON CONFLICT (prompt_chave, category_id) DO NOTHING`,
            [ov.prompt_chave, newCatId, ov.texto]
          );
        }

        cloned.push({ originalId: catId, newId: newCatId, name: String(cat.name) });
      }

      await conn.commit();
      return reply.code(201).send({ ok: true, cloned });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  });
};

export default plugin;
