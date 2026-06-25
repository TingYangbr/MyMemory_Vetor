import { createClient } from "webdav";
import type { RowDataPacket, ResultSetHeader } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { encryptCredential, decryptCredential } from "../lib/storageEncryption.js";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface GroupStorageConfigPublic {
  id: number;
  groupId: number | null;
  userId: number | null;
  label: string;
  tipo: string;
  url: string;
  pathPrefix: string | null;
  username: string | null;
  hasPassword: boolean;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface GroupStorageConfigWithCreds extends GroupStorageConfigPublic {
  password: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToPublic(r: RowDataPacket): GroupStorageConfigPublic {
  return {
    id: Number(r.id),
    groupId: r.group_id != null ? Number(r.group_id) : null,
    userId: r.user_id != null ? Number(r.user_id) : null,
    label: String(r.label),
    tipo: String(r.tipo),
    url: String(r.url),
    pathPrefix: r.path_prefix != null ? String(r.path_prefix) : null,
    username: r.username != null ? String(r.username) : null,
    hasPassword: Boolean(r.password_enc),
    isDefault: Boolean(r.is_default),
    isActive: Boolean(r.is_active),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowWithCreds(r: RowDataPacket): GroupStorageConfigWithCreds {
  return {
    ...rowToPublic(r),
    password: r.password_enc ? decryptCredential(String(r.password_enc)) : null,
  };
}

// ── Leitura ───────────────────────────────────────────────────────────────────

export async function listGroupStorageConfigs(params: {
  groupId?: number | null;
  userId?: number | null;
}): Promise<GroupStorageConfigPublic[]> {
  if (params.groupId != null) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM group_storage_configs
       WHERE group_id = ? AND is_active = TRUE
       ORDER BY is_default DESC, id ASC`,
      [params.groupId]
    );
    return rows.map(rowToPublic);
  }
  if (params.userId != null) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM group_storage_configs
       WHERE user_id = ? AND is_active = TRUE
       ORDER BY is_default DESC, id ASC`,
      [params.userId]
    );
    return rows.map(rowToPublic);
  }
  return [];
}

/** Retorna a config padrão com credenciais descriptografadas — uso interno apenas. */
export async function resolveGroupStorageDefault(
  groupId: number | null,
  userId: number | null
): Promise<GroupStorageConfigWithCreds | null> {
  let rows: RowDataPacket[];
  if (groupId != null) {
    [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM group_storage_configs
       WHERE group_id = ? AND is_default = TRUE AND is_active = TRUE LIMIT 1`,
      [groupId]
    );
  } else if (userId != null) {
    [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM group_storage_configs
       WHERE user_id = ? AND is_default = TRUE AND is_active = TRUE LIMIT 1`,
      [userId]
    );
  } else {
    return null;
  }
  if (!rows[0]) return null;
  return rowWithCreds(rows[0]);
}

// ── CRUD (admin) ──────────────────────────────────────────────────────────────

export async function createGroupStorageConfig(input: {
  groupId?: number | null;
  userId?: number | null;
  label: string;
  tipo?: string;
  url: string;
  pathPrefix?: string | null;
  username?: string | null;
  password?: string | null;
  isDefault?: boolean;
}): Promise<GroupStorageConfigPublic> {
  const passwordEnc = input.password ? encryptCredential(input.password) : null;
  const makeDefault = input.isDefault ?? false;

  if (makeDefault) {
    // Remove default anterior para este grupo/usuário
    if (input.groupId != null) {
      await pool.query(
        `UPDATE group_storage_configs SET is_default = FALSE WHERE group_id = ? AND is_active = TRUE`,
        [input.groupId]
      );
    } else if (input.userId != null) {
      await pool.query(
        `UPDATE group_storage_configs SET is_default = FALSE WHERE user_id = ? AND is_active = TRUE`,
        [input.userId]
      );
    }
  }

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO group_storage_configs
       (group_id, user_id, label, tipo, url, path_prefix, username, password_enc, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    [
      input.groupId ?? null,
      input.userId ?? null,
      input.label.trim(),
      (input.tipo ?? "WEBDAV").toUpperCase(),
      input.url.trim().replace(/\/$/, ""),
      input.pathPrefix?.trim() || null,
      input.username?.trim() || null,
      passwordEnc,
      makeDefault,
    ]
  );

  const rows = result as unknown as RowDataPacket[];
  return rowToPublic(rows[0]);
}

export async function updateGroupStorageConfig(
  id: number,
  input: {
    label?: string;
    url?: string;
    pathPrefix?: string | null;
    username?: string | null;
    password?: string | null;
    clearPassword?: boolean;
    isDefault?: boolean;
  }
): Promise<GroupStorageConfigPublic | null> {
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM group_storage_configs WHERE id = ? AND is_active = TRUE LIMIT 1`,
    [id]
  );
  if (!existing[0]) return null;

  const cfg = existing[0];
  const sets: string[] = ["updated_at = NOW()"];
  const vals: unknown[] = [];

  if (input.label !== undefined) { sets.push("label = ?"); vals.push(input.label.trim()); }
  if (input.url !== undefined)   { sets.push("url = ?"); vals.push(input.url.trim().replace(/\/$/, "")); }
  if ("pathPrefix" in input)     { sets.push("path_prefix = ?"); vals.push(input.pathPrefix?.trim() || null); }
  if ("username" in input)       { sets.push("username = ?"); vals.push(input.username?.trim() || null); }
  if (input.clearPassword)       { sets.push("password_enc = NULL"); }
  else if (input.password)       { sets.push("password_enc = ?"); vals.push(encryptCredential(input.password)); }

  if (input.isDefault === true) {
    if (cfg.group_id != null) {
      await pool.query(
        `UPDATE group_storage_configs SET is_default = FALSE WHERE group_id = ? AND is_active = TRUE AND id != ?`,
        [cfg.group_id, id]
      );
    } else if (cfg.user_id != null) {
      await pool.query(
        `UPDATE group_storage_configs SET is_default = FALSE WHERE user_id = ? AND is_active = TRUE AND id != ?`,
        [cfg.user_id, id]
      );
    }
    sets.push("is_default = TRUE");
  } else if (input.isDefault === false) {
    sets.push("is_default = FALSE");
  }

  vals.push(id);
  const [updated] = await pool.query<RowDataPacket[]>(
    `UPDATE group_storage_configs SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
    vals
  );
  const rows = updated as unknown as RowDataPacket[];
  return rows[0] ? rowToPublic(rows[0]) : null;
}

export async function deleteGroupStorageConfig(id: number): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE group_storage_configs SET is_active = FALSE, updated_at = NOW() WHERE id = ? AND is_active = TRUE`,
    [id]
  );
  return result.affectedRows > 0;
}

// ── WebDAV push ───────────────────────────────────────────────────────────────

/** Envia buffer para o servidor WebDAV da config; retorna URL pública do arquivo. */
export async function pushFileToWebDav(
  cfg: GroupStorageConfigWithCreds,
  buffer: Buffer,
  storedName: string
): Promise<string> {
  const clientOpts = cfg.username && cfg.password
    ? { username: cfg.username, password: cfg.password }
    : {};
  const client = createClient(cfg.url, clientOpts);

  const prefix = (cfg.pathPrefix ?? "").trim().replace(/\/$/, "");
  const remotePath = prefix ? `${prefix}/${storedName}` : `/${storedName}`;

  await client.putFileContents(remotePath, buffer, { overwrite: true });

  return `${cfg.url.replace(/\/$/, "")}${remotePath}`;
}

// ── Teste de conexão ──────────────────────────────────────────────────────────

export async function testWebDavConnection(input: {
  url: string;
  username?: string | null;
  password?: string | null;
  pathPrefix?: string | null;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const clientOpts = input.username && input.password
      ? { username: input.username, password: input.password }
      : {};
    const client = createClient(input.url, clientOpts);
    const prefix = (input.pathPrefix ?? "").trim() || "/";
    await client.getDirectoryContents(prefix);
    return { ok: true, message: "Conexão bem-sucedida." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  }
}
