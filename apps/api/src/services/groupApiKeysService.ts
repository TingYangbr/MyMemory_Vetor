import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { hashOpaqueToken, newOpaqueToken } from "../lib/authTokens.js";

export interface GroupApiKey {
  id: number;
  groupId: number;
  userId: number;
  nome: string;
  /** Sistema de origem fixado pela chave (ex.: "softing-erp"). */
  sistema: string;
  /** Banco do cliente fixado pela chave ("" = não se aplica). */
  banco: string;
  keyPrefix: string;
  isActive: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const KEY_PREFIX = "mmk_";

function generateApiKey(): { rawKey: string; hash: string; keyPrefix: string } {
  const { raw } = newOpaqueToken();
  const rawKey = `${KEY_PREFIX}${raw}`;
  return {
    rawKey,
    hash: hashOpaqueToken(rawKey),
    // primeiros caracteres pra identificar a key na UI sem expor o resto
    keyPrefix: rawKey.slice(0, 12),
  };
}

export async function listGroupApiKeys(groupId?: number): Promise<GroupApiKey[]> {
  const where = groupId != null ? "WHERE groupid = ?" : "";
  const params = groupId != null ? [groupId] : [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, groupid, userid, nome, sistema, banco, keyprefix, isactive, lastusedat, expiresat, createdat, updatedat
     FROM group_api_keys ${where} ORDER BY createdat DESC`,
    params
  );
  // db.ts camelCaseia algumas colunas via COL map (groupid→groupId, userid→userId,
  // isactive→isActive, keyprefix→keyPrefix, lastusedat→lastUsedAt, createdat/updatedat/
  // expiresat também) — só `nome` fica como veio, por não estar no mapa.
  // Colunas TIMESTAMP voltam do pg como Date, não string — toISOString() explícito
  // (mesmo padrão de memoService.ts `rowToCreated`) pra não cair no formato de
  // Date.prototype.toString() ao serializar.
  const iso = (v: unknown): string | null => {
    if (v == null) return null;
    return v instanceof Date ? v.toISOString() : String(v);
  };
  return rows.map((r) => ({
    id: Number(r.id),
    groupId: Number(r.groupId),
    userId: Number(r.userId),
    nome: String(r.nome),
    sistema: String(r.sistema ?? "softing-erp"),
    banco: String(r.banco ?? ""),
    keyPrefix: String(r.keyPrefix),
    isActive: Number(r.isActive),
    lastUsedAt: iso(r.lastUsedAt),
    expiresAt: iso(r.expiresAt),
    createdAt: iso(r.createdAt) as string,
    updatedAt: iso(r.updatedAt) as string,
  }));
}

/**
 * Cria uma key nova. O valor bruto (`rawKey`) só existe neste retorno — nunca é
 * recuperável depois, só o hash fica salvo.
 */
export async function createGroupApiKey(input: {
  groupId: number;
  userId: number;
  nome: string;
  sistema?: string;
  banco?: string;
  expiresAt?: string | null;
}): Promise<{ id: number; rawKey: string }> {
  const { rawKey, hash, keyPrefix } = generateApiKey();
  const [rows] = await pool.query<{ id: number }[]>(
    `INSERT INTO group_api_keys (groupid, userid, nome, sistema, banco, keyhash, keyprefix, expiresat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [input.groupId, input.userId, input.nome.trim(), (input.sistema ?? "softing-erp").trim().toLowerCase(), (input.banco ?? "").trim(), hash, keyPrefix, input.expiresAt ?? null]
  );
  return { id: rows[0].id, rawKey };
}

export async function revokeGroupApiKey(id: number): Promise<void> {
  await pool.query(`UPDATE group_api_keys SET isactive = 0, updatedat = NOW() WHERE id = ?`, [id]);
}

/**
 * Resolve uma API key válida (ativa, não expirada) para o `userId` "dono" e o `groupId` ao qual a
 * key está presa, ou `null`. Usado por `resolveIntegrationAuth` na autenticação servidor-a-servidor.
 *
 * O `groupId` devolvido é a ÚNICA fonte do grupo em requisições feitas por key: o corpo da
 * requisição nunca escolhe o grupo (senão a key de um cliente alcançaria dados de outro).
 */
export async function resolveApiKey(
  rawKey: string
): Promise<{ userId: number; groupId: number; sistema: string; banco: string } | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;
  const hash = hashOpaqueToken(rawKey);
  const [rows] = await pool.query<{ id: number; userId: number; groupId: number; sistema: string; banco: string }[]>(
    `SELECT id, userid, groupid, sistema, banco FROM group_api_keys
     WHERE keyhash = ? AND isactive = 1 AND (expiresat IS NULL OR expiresat > NOW())
     LIMIT 1`,
    [hash]
  );
  const row = rows[0];
  if (!row) return null;

  pool
    .query(`UPDATE group_api_keys SET lastusedat = NOW() WHERE id = ?`, [row.id])
    .catch(() => {
      /* best-effort */
    });

  return { userId: Number(row.userId), groupId: Number(row.groupId), sistema: String(row.sistema ?? "softing-erp"), banco: String(row.banco ?? "") };
}
