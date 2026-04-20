import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db.js";
import { resolveUserId } from "../lib/userContext.js";
import {
  createCampo,
  createCategory,
  createSubcategory,
  getMemoContextEditorMeta,
  listGroupsForMemoContext,
  loadMemoContextStructure,
  loadStructureForGroup,
  softDeleteCampo,
  softDeleteCategory,
  softDeleteSubcategory,
  updateCampo,
  updateCategory,
  updateSubcategory,
  userHasMemoContextAccess,
} from "../services/memoContextService.js";

const mediaTypeEnum = z.enum(["text", "audio", "image", "video", "document", "url"]);

async function isAdminUser(userId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT role FROM users WHERE id = ? LIMIT 1", [userId]);
  return rows[0]?.role === "admin";
}

function mapErr(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === "forbidden_group") return reply.code(403).send({ error: "forbidden_group" });
  if (msg === "forbidden_context_edit")
    return reply.code(403).send({ error: "forbidden_context_edit", message: "Sem permissão para editar este escopo." });
  if (msg === "group_not_found") return reply.code(404).send({ error: "group_not_found" });
  if (msg === "not_found") return reply.code(404).send({ error: "not_found" });
  if (msg === "migration_groupid_null")
    return reply.code(422).send({
      error: "migration_required",
      message:
        "A coluna categories.groupId ainda não aceita NULL. Execute no MySQL o arquivo docs/migrations/007_categories_null_group_context.sql e volte a tentar.",
    });
  return reply.code(500).send({ error: "internal", message: msg });
}

type ReqWithUser = FastifyRequest & { mymUid: number };

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    if (!(await userHasMemoContextAccess(userId))) {
      return reply.code(403).send({ error: "memo_context_forbidden" });
    }
    (req as ReqWithUser).mymUid = userId;
  });

  app.get("/api/memo-context/groups", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const admin = await isAdminUser(userId);
    const groups = await listGroupsForMemoContext(userId, admin);
    return { groups };
  });

  app.get("/api/memo-context/editor-meta", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const admin = await isAdminUser(userId);
    return getMemoContextEditorMeta(userId, admin);
  });

  app.get("/api/memo-context/structure", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const raw = req.query as { groupId?: string; mediaType?: string };
    let scopeGroupId: number | null = null;
    if (raw.groupId != null && raw.groupId !== "" && raw.groupId !== "null") {
      const n = Number(raw.groupId);
      if (!Number.isInteger(n) || n < 1) return reply.code(400).send({ error: "invalid_groupId" });
      scopeGroupId = n;
    }
    let filterMedia: z.infer<typeof mediaTypeEnum> | null = null;
    if (raw.mediaType != null && raw.mediaType !== "") {
      const p = mediaTypeEnum.safeParse(raw.mediaType);
      if (!p.success) return reply.code(400).send({ error: "invalid_mediaType" });
      filterMedia = p.data;
    }
    try {
      return await loadMemoContextStructure(userId, scopeGroupId, filterMedia);
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.get("/api/memo-context/groups/:groupId/structure", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const groupId = z.coerce.number().int().positive().safeParse((req.params as { groupId: string }).groupId);
    if (!groupId.success) return reply.code(400).send({ error: "invalid_group" });
    try {
      return await loadStructureForGroup(userId, groupId.data);
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  const createCategoryBody = z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(16_000).nullable().optional(),
    mediaType: mediaTypeEnum.nullable().optional(),
  });

  const createCategoryWithGroupBody = z.object({
    groupId: z.union([z.number().int().positive(), z.null()]),
    name: z.string().min(1).max(255),
    description: z.string().max(16_000).nullable().optional(),
    mediaType: mediaTypeEnum.nullable().optional(),
  });

  app.post("/api/memo-context/categories", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const parsed = createCategoryWithGroupBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      const id = await createCategory(userId, {
        groupId: parsed.data.groupId,
        name: parsed.data.name,
        description: parsed.data.description,
        mediaType: parsed.data.mediaType ?? null,
      });
      return reply.code(201).send({ id });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.post("/api/memo-context/groups/:groupId/categories", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const groupId = z.coerce.number().int().positive().safeParse((req.params as { groupId: string }).groupId);
    if (!groupId.success) return reply.code(400).send({ error: "invalid_group" });
    const parsed = createCategoryBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      const id = await createCategory(userId, {
        groupId: groupId.data,
        name: parsed.data.name,
        description: parsed.data.description,
        mediaType: parsed.data.mediaType ?? null,
      });
      return reply.code(201).send({ id });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.delete("/api/memo-context/categories/:categoryId", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const categoryId = z.coerce
      .number()
      .int()
      .positive()
      .safeParse((req.params as { categoryId: string }).categoryId);
    if (!categoryId.success) return reply.code(400).send({ error: "invalid_id" });
    try {
      await softDeleteCategory(userId, categoryId.data);
      return { ok: true };
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  const patchCategoryBody = z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(16_000).nullable().optional(),
    mediaType: mediaTypeEnum.nullable().optional(),
    isActive: z.number().int().min(0).max(1).optional(),
  });

  app.patch("/api/memo-context/categories/:categoryId", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const categoryId = z.coerce
      .number()
      .int()
      .positive()
      .safeParse((req.params as { categoryId: string }).categoryId);
    if (!categoryId.success) return reply.code(400).send({ error: "invalid_id" });
    const parsed = patchCategoryBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      await updateCategory(userId, categoryId.data, {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        ...(parsed.data.mediaType !== undefined ? { mediaType: parsed.data.mediaType } : {}),
      });
      return { ok: true };
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  const createSubBody = z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(16_000).nullable().optional(),
  });

  app.post("/api/memo-context/categories/:categoryId/subcategories", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const categoryId = z.coerce
      .number()
      .int()
      .positive()
      .safeParse((req.params as { categoryId: string }).categoryId);
    if (!categoryId.success) return reply.code(400).send({ error: "invalid_id" });
    const parsed = createSubBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      const id = await createSubcategory(userId, categoryId.data, parsed.data);
      return reply.code(201).send({ id });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  const patchSubBody = z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(16_000).nullable().optional(),
    isActive: z.number().int().min(0).max(1).optional(),
  });

  const createCampoBody = z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(16_000).nullable().optional(),
    normalizedTerms: z.string().max(4_000).nullable().optional(),
  });

  const patchCampoBody = z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(16_000).nullable().optional(),
    normalizedTerms: z.string().max(4_000).nullable().optional(),
    isActive: z.number().int().min(0).max(1).optional(),
  });

  app.patch("/api/memo-context/subcategories/:subCategoryId", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const subId = z.coerce
      .number()
      .int()
      .positive()
      .safeParse((req.params as { subCategoryId: string }).subCategoryId);
    if (!subId.success) return reply.code(400).send({ error: "invalid_id" });
    const parsed = patchSubBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      await updateSubcategory(userId, subId.data, parsed.data);
      return { ok: true };
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.delete("/api/memo-context/subcategories/:subCategoryId", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const subId = z.coerce
      .number()
      .int()
      .positive()
      .safeParse((req.params as { subCategoryId: string }).subCategoryId);
    if (!subId.success) return reply.code(400).send({ error: "invalid_id" });
    try {
      await softDeleteSubcategory(userId, subId.data);
      return { ok: true };
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.post("/api/memo-context/categories/:categoryId/campos", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const categoryId = z.coerce
      .number()
      .int()
      .positive()
      .safeParse((req.params as { categoryId: string }).categoryId);
    if (!categoryId.success) return reply.code(400).send({ error: "invalid_id" });
    const parsed = createCampoBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      const id = await createCampo(userId, categoryId.data, parsed.data);
      return reply.code(201).send({ id });
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.patch("/api/memo-context/campos/:campoId", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const campoId = z.coerce.number().int().positive().safeParse((req.params as { campoId: string }).campoId);
    if (!campoId.success) return reply.code(400).send({ error: "invalid_id" });
    const parsed = patchCampoBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      await updateCampo(userId, campoId.data, parsed.data);
      return { ok: true };
    } catch (e) {
      return mapErr(reply, e);
    }
  });

  app.delete("/api/memo-context/campos/:campoId", async (req, reply) => {
    const userId = (req as ReqWithUser).mymUid;
    const campoId = z.coerce.number().int().positive().safeParse((req.params as { campoId: string }).campoId);
    if (!campoId.success) return reply.code(400).send({ error: "invalid_id" });
    try {
      await softDeleteCampo(userId, campoId.data);
      return { ok: true };
    } catch (e) {
      return mapErr(reply, e);
    }
  });
};

export default plugin;
