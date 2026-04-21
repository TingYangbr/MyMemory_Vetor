import type {
  MemoContextCampo,
  MemoContextCategory,
  MemoContextEditorMetaResponse,
  MemoContextGroupOption,
  MemoContextMediaType,
  MemoContextStructureResponse,
  MemoContextSubcategory,
  WorkspaceGroupItem,
} from "@mymemory/shared";
import type { RowDataPacket, ResultSetHeader } from "../lib/dbTypes.js";
import { pool } from "../db.js";

function ts(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? "");
}

const MEMO_CONTEXT_MEDIA_SET = new Set<string>(["text", "audio", "image", "video", "document", "url"]);

function normalizeCategoryMediaType(v: unknown): MemoContextMediaType | null {
  if (v == null || v === "") return null;
  const s = String(v);
  return MEMO_CONTEXT_MEDIA_SET.has(s) ? (s as MemoContextMediaType) : null;
}

export async function userHasMemoContextAccess(userId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT (
        u.role = 'admin'
        OR EXISTS (
          SELECT 1 FROM group_members gm WHERE gm.userId = u.id AND gm.role = 'owner'
        )
        OR EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.ownerId = u.id AND s.type = 'group' AND s.status = 'active'
        )
      ) AS ok
     FROM users u WHERE u.id = ? LIMIT 1`,
    [userId]
  );
  const ok = rows[0]?.ok;
  return ok === 1 || ok === true;
}

export async function listGroupsForMemoContext(userId: number, isAdmin: boolean): Promise<MemoContextGroupOption[]> {
  if (isAdmin) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name FROM groups ORDER BY name ASC`
    );
    return rows.map((r) => ({ id: r.id as number, name: r.name as string }));
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT g.id, g.name
     FROM groups g
     WHERE EXISTS (
       SELECT 1 FROM subscriptions s
       WHERE s.id = g.subscriptionId AND s.ownerId = ? AND s.type = 'group' AND s.status = 'active'
     )
     OR EXISTS (
       SELECT 1 FROM group_members gm
       WHERE gm.groupId = g.id AND gm.userId = ? AND gm.role = 'owner'
     )
     ORDER BY g.name ASC`,
    [userId, userId]
  );
  return rows.map((r) => ({ id: r.id as number, name: r.name as string }));
}

/** Membros (qualquer papel) ou dono da assinatura de grupo — contexto de trabalho / memos compartilhados. */
export async function assertUserWorkspaceGroupAccess(
  userId: number,
  groupId: number,
  isAdmin: boolean
): Promise<void> {
  if (isAdmin) {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT 1 FROM groups WHERE id = ? LIMIT 1", [groupId]);
    if (!rows[0]) throw new Error("group_not_found");
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM groups g
     WHERE g.id = ?
     AND (
       EXISTS (SELECT 1 FROM group_members gm WHERE gm.groupId = g.id AND gm.userId = ?)
       OR EXISTS (
         SELECT 1 FROM subscriptions s
         WHERE s.id = g.subscriptionId AND s.ownerId = ? AND s.type = 'group' AND s.status = 'active'
       )
     )
     LIMIT 1`,
    [groupId, userId, userId]
  );
  if (!rows[0]) throw new Error("forbidden_group");
}

function mapWorkspaceGroupRow(r: RowDataPacket): WorkspaceGroupItem {
  const descRaw = r.description;
  const desc =
    descRaw != null && String(descRaw).trim() !== "" ? String(descRaw).trim() : null;
  const ownerMail = r.subscriptionOwnerEmail;
  const email =
    ownerMail != null && String(ownerMail).trim() !== "" ? String(ownerMail).trim() : null;
  return {
    id: Number(r.id),
    name: String(r.name),
    isOwner: r.isOwner === 1 || r.isOwner === true,
    description: desc,
    subscriptionOwnerEmail: email,
  };
}

export async function listWorkspaceGroupsForUser(userId: number, isAdmin: boolean): Promise<WorkspaceGroupItem[]> {
  if (isAdmin) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT g.id, g.name, g.description, 1 AS isOwner, u.email AS subscriptionOwnerEmail
       FROM groups g
       INNER JOIN subscriptions s ON s.id = g.subscriptionId
       LEFT JOIN users u ON u.id = s.ownerId
       ORDER BY g.name ASC`
    );
    return rows.map(mapWorkspaceGroupRow);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT g.id, g.name, g.description,
        (
          EXISTS (
            SELECT 1 FROM subscriptions sx
            WHERE sx.id = g.subscriptionId AND sx.ownerId = ? AND sx.type = 'group' AND sx.status = 'active'
          )
          OR EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.groupId = g.id AND gm.userId = ? AND gm.role = 'owner'
          )
        ) AS isOwner,
        ou.email AS subscriptionOwnerEmail
     FROM groups g
     INNER JOIN subscriptions s ON s.id = g.subscriptionId
     LEFT JOIN users ou ON ou.id = s.ownerId
     WHERE EXISTS (SELECT 1 FROM group_members gm2 WHERE gm2.groupId = g.id AND gm2.userId = ?)
        OR EXISTS (
          SELECT 1 FROM subscriptions s2
          WHERE s2.id = g.subscriptionId AND s2.ownerId = ? AND s2.type = 'group' AND s2.status = 'active'
        )
     ORDER BY g.name ASC`,
    [userId, userId, userId, userId]
  );
  return rows.map(mapWorkspaceGroupRow);
}

export async function assertUserCanAccessGroup(userId: number, groupId: number, isAdmin: boolean): Promise<void> {
  if (isAdmin) {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT 1 FROM groups WHERE id = ? LIMIT 1", [groupId]);
    if (!rows[0]) throw new Error("group_not_found");
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM groups g
     WHERE g.id = ?
     AND (
       EXISTS (
         SELECT 1 FROM subscriptions s
         WHERE s.id = g.subscriptionId AND s.ownerId = ? AND s.type = 'group' AND s.status = 'active'
       )
       OR EXISTS (
         SELECT 1 FROM group_members gm
         WHERE gm.groupId = g.id AND gm.userId = ? AND gm.role = 'owner'
       )
     )
     LIMIT 1`,
    [groupId, userId, userId]
  );
  if (!rows[0]) throw new Error("forbidden_group");
}

/** Grupo vazio (`null`): só admin edita. Com `groupId`, admin ou dono do grupo. */
export async function assertMemoContextWriteForGroupScope(
  userId: number,
  scopeGroupId: number | null,
  isAdmin: boolean
): Promise<void> {
  if (scopeGroupId === null) {
    if (!isAdmin) throw new Error("forbidden_context_edit");
    return;
  }
  await assertUserCanAccessGroup(userId, scopeGroupId, isAdmin);
}

export async function assertMemoContextReadScope(
  userId: number,
  scopeGroupId: number | null,
  isAdmin: boolean
): Promise<void> {
  if (scopeGroupId === null) return;
  await assertUserCanAccessGroup(userId, scopeGroupId, isAdmin);
}

async function userOwnsGroupForMemoContext(userId: number, groupId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM groups g
     WHERE g.id = ?
     AND (
       EXISTS (
         SELECT 1 FROM subscriptions s
         WHERE s.id = g.subscriptionId AND s.ownerId = ? AND s.type = 'group' AND s.status = 'active'
       )
       OR EXISTS (
         SELECT 1 FROM group_members gm
         WHERE gm.groupId = g.id AND gm.userId = ? AND gm.role = 'owner'
       )
     )
     LIMIT 1`,
    [groupId, userId, userId]
  );
  return Boolean(rows[0]);
}

export async function computeMemoContextCanEditScope(
  userId: number,
  scopeGroupId: number | null,
  isAdmin: boolean
): Promise<boolean> {
  if (scopeGroupId === null) return isAdmin;
  if (isAdmin) return true;
  return userOwnsGroupForMemoContext(userId, scopeGroupId);
}

export async function getMemoContextEditorMeta(
  userId: number,
  isAdmin: boolean
): Promise<MemoContextEditorMetaResponse> {
  const owned = await listGroupsForMemoContext(userId, false);
  if (isAdmin) {
    const all = await listGroupsForMemoContext(userId, true);
    return { isAdmin: true, ownedGroups: owned, allGroups: all };
  }
  return { isAdmin: false, ownedGroups: owned, allGroups: null };
}

async function getUserAdminFlag(userId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT role FROM users WHERE id = ? LIMIT 1", [userId]);
  return rows[0]?.role === "admin";
}

export async function loadMemoContextStructure(
  userId: number,
  scopeGroupId: number | null,
  filterMediaType: MemoContextMediaType | null
): Promise<MemoContextStructureResponse> {
  const isAdmin = await getUserAdminFlag(userId);
  await assertMemoContextReadScope(userId, scopeGroupId, isAdmin);
  const canEditStructure = await computeMemoContextCanEditScope(userId, scopeGroupId, isAdmin);

  let sql = `SELECT id, groupId, mediaType, name, description, isActive, createdAt, updatedAt
     FROM categories WHERE groupId IS NOT DISTINCT FROM ? AND isActive = 1`;
  const params: unknown[] = [scopeGroupId];
  if (filterMediaType != null) {
    sql += ` AND mediaType IS NOT DISTINCT FROM ?`;
    params.push(filterMediaType);
  }
  sql += ` ORDER BY id ASC`;

  const [catRows] = await pool.query<RowDataPacket[]>(sql, params);
  if (catRows.length === 0) {
    return { categories: [], capabilities: { canEditStructure } };
  }

  const catIds = catRows.map((r) => r.id as number);
  const placeholders = catIds.map(() => "?").join(",");

  const [subRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, categoryId, name, description, isActive, createdAt, updatedAt
     FROM subcategories WHERE categoryId IN (${placeholders}) AND isActive = 1 ORDER BY id ASC`,
    catIds
  );
  let campoRows: RowDataPacket[] = [];
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, categoryId, name, description, normalizedTerms, isActive, createdAt, updatedAt
       FROM categorycampos WHERE categoryId IN (${placeholders}) AND isActive = 1 ORDER BY id ASC`,
      catIds
    );
    campoRows = rows;
  } catch {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, categoryId, name, description, isActive, createdAt, updatedAt
       FROM categorycampos WHERE categoryId IN (${placeholders}) AND isActive = 1 ORDER BY id ASC`,
      catIds
    );
    campoRows = rows;
  }

  const subsByCat = new Map<number, MemoContextSubcategory[]>();
  const camposByCat = new Map<number, MemoContextCampo[]>();
  for (const id of catIds) {
    subsByCat.set(id, []);
    camposByCat.set(id, []);
  }
  for (const r of subRows) {
    const cid = r.categoryId as number;
    const list = subsByCat.get(cid);
    if (list)
      list.push({
        id: r.id as number,
        categoryId: cid,
        name: r.name as string,
        description: (r.description as string) ?? null,
        isActive: r.isActive as number,
        createdAt: ts(r.createdAt),
        updatedAt: ts(r.updatedAt),
      });
  }
  for (const r of campoRows) {
    const cid = r.categoryId as number;
    const list = camposByCat.get(cid);
    if (list)
      list.push({
        id: r.id as number,
        categoryId: cid,
        name: r.name as string,
        description: (r.description as string) ?? null,
        normalizedTerms: (r.normalizedTerms as string) ?? null,
        isActive: r.isActive as number,
        createdAt: ts(r.createdAt),
        updatedAt: ts(r.updatedAt),
      });
  }

  const categories: MemoContextCategory[] = catRows.map((r) => ({
    id: r.id as number,
    groupId: r.groupId != null ? (r.groupId as number) : null,
    mediaType: normalizeCategoryMediaType(r.mediaType),
    name: r.name as string,
    description: (r.description as string) ?? null,
    isActive: r.isActive as number,
    createdAt: ts(r.createdAt),
    updatedAt: ts(r.updatedAt),
    subcategories: subsByCat.get(r.id as number) ?? [],
    campos: camposByCat.get(r.id as number) ?? [],
  }));

  return { categories, capabilities: { canEditStructure } };
}

export async function loadStructureForGroup(
  userId: number,
  groupId: number
): Promise<MemoContextStructureResponse> {
  return loadMemoContextStructure(userId, groupId, null);
}

export async function createCategory(
  userId: number,
  input: {
    groupId: number | null;
    name: string;
    description?: string | null;
    mediaType?: MemoContextMediaType | null;
  }
): Promise<number> {
  const isAdmin = await getUserAdminFlag(userId);
  await assertMemoContextWriteForGroupScope(userId, input.groupId, isAdmin);
  try {
    const [rows] = await pool.query<{ id: number }[]>(
      `INSERT INTO categories (groupid, mediatype, name, description, isactive)
       VALUES (?, ?, ?, ?, 1) RETURNING id`,
      [input.groupId, input.mediaType ?? null, input.name.trim(), input.description?.trim() ?? null]
    );
    return rows[0].id;
  } catch (e) {
    const err = e as { code?: string; constraint?: string; message?: string };
    if (err.code === "23502" && /groupId/i.test(err.constraint ?? err.message ?? "")) {
      throw new Error("migration_groupid_null");
    }
    throw e;
  }
}

export async function updateCategory(
  userId: number,
  categoryId: number,
  patch: {
    name?: string;
    description?: string | null;
    mediaType?: MemoContextMediaType | null;
    isActive?: number;
  }
): Promise<void> {
  const isAdmin = await getUserAdminFlag(userId);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT groupId FROM categories WHERE id = ? LIMIT 1",
    [categoryId]
  );
  const row = rows[0];
  if (!row) throw new Error("not_found");
  const gid = row.groupId != null ? (row.groupId as number) : null;
  await assertMemoContextWriteForGroupScope(userId, gid, isAdmin);

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name.trim());
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    vals.push(patch.description?.trim() ?? null);
  }
  if (patch.mediaType !== undefined) {
    sets.push("mediatype = ?");
    vals.push(patch.mediaType);
  }
  if (patch.isActive !== undefined) {
    sets.push("isactive = ?");
    vals.push(patch.isActive);
  }
  if (sets.length === 0) return;
  vals.push(categoryId);
  await pool.query(`UPDATE categories SET ${sets.join(", ")} WHERE id = ?`, vals);
}

async function assertCategoryInAccessibleGroup(userId: number, categoryId: number): Promise<void> {
  const isAdmin = await getUserAdminFlag(userId);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT groupId FROM categories WHERE id = ? LIMIT 1",
    [categoryId]
  );
  const row = rows[0];
  if (!row) throw new Error("not_found");
  const gid = row.groupId != null ? (row.groupId as number) : null;
  await assertMemoContextWriteForGroupScope(userId, gid, isAdmin);
}

export async function createSubcategory(
  userId: number,
  categoryId: number,
  input: { name: string; description?: string | null }
): Promise<number> {
  await assertCategoryInAccessibleGroup(userId, categoryId);
  const [rows] = await pool.query<{ id: number }[]>(
    `INSERT INTO subcategories (categoryid, name, description, isactive) VALUES (?, ?, ?, 1) RETURNING id`,
    [categoryId, input.name.trim(), input.description?.trim() ?? null]
  );
  return rows[0].id;
}

export async function updateSubcategory(
  userId: number,
  subCategoryId: number,
  patch: { name?: string; description?: string | null; isActive?: number }
): Promise<void> {
  const isAdmin = await getUserAdminFlag(userId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.groupId FROM subcategories sc
     INNER JOIN categories c ON c.id = sc.categoryId
     WHERE sc.id = ? LIMIT 1`,
    [subCategoryId]
  );
  const row = rows[0];
  if (!row) throw new Error("not_found");
  const gid = row.groupId != null ? (row.groupId as number) : null;
  await assertMemoContextWriteForGroupScope(userId, gid, isAdmin);

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name.trim());
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    vals.push(patch.description?.trim() ?? null);
  }
  if (patch.isActive !== undefined) {
    sets.push("isactive = ?");
    vals.push(patch.isActive);
  }
  if (sets.length === 0) return;
  vals.push(subCategoryId);
  await pool.query(`UPDATE subcategories SET ${sets.join(", ")} WHERE id = ?`, vals);
}

export async function createCampo(
  userId: number,
  categoryId: number,
  input: { name: string; description?: string | null; normalizedTerms?: string | null }
): Promise<number> {
  await assertCategoryInAccessibleGroup(userId, categoryId);
  const [rows] = await pool.query<{ id: number }[]>(
    `INSERT INTO categorycampos (categoryid, name, description, normalizedterms, isactive) VALUES (?, ?, ?, ?, 1) RETURNING id`,
    [categoryId, input.name.trim(), input.description?.trim() ?? null, input.normalizedTerms?.trim() ?? null]
  );
  return rows[0].id;
}

export async function updateCampo(
  userId: number,
  campoId: number,
  patch: { name?: string; description?: string | null; normalizedTerms?: string | null; isActive?: number }
): Promise<void> {
  const isAdmin = await getUserAdminFlag(userId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.groupId FROM categorycampos cc
     INNER JOIN categories c ON c.id = cc.categoryId
     WHERE cc.id = ? LIMIT 1`,
    [campoId]
  );
  const row = rows[0];
  if (!row) throw new Error("not_found");
  const gid = row.groupId != null ? (row.groupId as number) : null;
  await assertMemoContextWriteForGroupScope(userId, gid, isAdmin);

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name.trim());
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    vals.push(patch.description?.trim() ?? null);
  }
  if (patch.normalizedTerms !== undefined) {
    sets.push("normalizedterms = ?");
    vals.push(patch.normalizedTerms?.trim() ?? null);
  }
  if (patch.isActive !== undefined) {
    sets.push("isactive = ?");
    vals.push(patch.isActive);
  }
  if (sets.length === 0) return;
  vals.push(campoId);
  await pool.query(`UPDATE categorycampos SET ${sets.join(", ")} WHERE id = ?`, vals);
}

export async function softDeleteCategory(userId: number, categoryId: number): Promise<void> {
  await updateCategory(userId, categoryId, { isActive: 0 });
}

export async function softDeleteSubcategory(userId: number, subCategoryId: number): Promise<void> {
  await updateSubcategory(userId, subCategoryId, { isActive: 0 });
}

export async function softDeleteCampo(userId: number, campoId: number): Promise<void> {
  await updateCampo(userId, campoId, { isActive: 0 });
}
