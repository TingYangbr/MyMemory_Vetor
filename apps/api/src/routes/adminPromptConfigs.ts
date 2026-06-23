import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { requireAdmin } from "../lib/adminContext.js";
import {
  listPromptConfigs,
  upsertPromptConfig,
  listCategoryOverrides,
  upsertCategoryOverride,
  deleteCategoryOverride,
} from "../services/llmPromptConfigService.js";

const patchBody = z.object({
  texto_padrao: z.string().nullable().optional(),
  texto_atual: z.string().nullable().optional(),
});

const catOverrideBody = z.object({
  texto: z.string().min(1),
});

const plugin: FastifyPluginAsync = async (app) => {
  // Lista todas as categorias ativas (para uso na UI de overrides)
  app.get("/api/admin/prompt-configs/categories", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.name, c.groupid AS "groupId", g.name AS "groupName"
       FROM categories c
       LEFT JOIN groups g ON g.id = c.groupid
       WHERE c.isactive = 1
       ORDER BY g.name ASC NULLS FIRST, c.name ASC`
    );
    return {
      categories: rows.map((r) => ({
        id: r.id as number,
        name: String(r.name),
        groupId: r.groupId != null ? (r.groupId as number) : null,
        groupName: r.groupName != null ? String(r.groupName) : null,
      })),
    };
  });

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

  // Lista overrides por categoria de um prompt
  app.get("/api/admin/prompt-configs/:chave/category-overrides", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const chave = (req.params as { chave: string }).chave;
    const overrides = await listCategoryOverrides(chave);
    return { overrides };
  });

  // Cria ou atualiza override de categoria
  app.put("/api/admin/prompt-configs/:chave/category-overrides/:categoryId", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const { chave, categoryId } = req.params as { chave: string; categoryId: string };
    const catId = parseInt(categoryId, 10);
    if (!Number.isFinite(catId) || catId <= 0) {
      return reply.code(400).send({ error: "invalid_category_id" });
    }
    const parsed = catOverrideBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    await upsertCategoryOverride(chave, catId, parsed.data.texto);
    return { ok: true };
  });

  // Remove override de categoria
  app.delete("/api/admin/prompt-configs/:chave/category-overrides/:categoryId", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const { chave, categoryId } = req.params as { chave: string; categoryId: string };
    const catId = parseInt(categoryId, 10);
    if (!Number.isFinite(catId) || catId <= 0) {
      return reply.code(400).send({ error: "invalid_category_id" });
    }
    await deleteCategoryOverride(chave, catId);
    return { ok: true };
  });
};

export default plugin;
