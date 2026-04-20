import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../db.js";

export type CreateGroupForOwnerInput = {
  userId: number;
  planId: number;
  name: string;
  description: string | null;
};

export type CreateGroupForOwnerResult = {
  groupId: number;
  subscriptionId: number;
};

/**
 * Cria assinatura tipo `group`, linha em `groups` e `group_members` como owner.
 * Sem Stripe: assinatura fica `active` imediatamente.
 */
export async function createGroupForOwner(input: CreateGroupForOwnerInput): Promise<CreateGroupForOwnerResult> {
  const [pRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, durationDays FROM subscription_plans
     WHERE id = ? AND planType = 'group' AND isActive = 1
     LIMIT 1`,
    [input.planId]
  );
  if (!pRows.length) {
    const err = new Error("invalid_group_plan");
    (err as Error & { code?: string }).code = "invalid_group_plan";
    throw err;
  }

  const durRaw = pRows[0].durationDays;
  const dur =
    durRaw === null || durRaw === undefined || durRaw === ""
      ? null
      : Number(durRaw);
  const endDate =
    dur != null && Number.isFinite(dur) && dur > 0
      ? new Date(Date.now() + dur * 86400 * 1000)
      : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const nameTrim = input.name.trim();
    const [dupRows] = await conn.query<RowDataPacket[]>(
      `SELECT g.id FROM \`groups\` g
       INNER JOIN subscriptions s ON s.id = g.subscriptionId
       WHERE s.ownerId = ?
         AND s.type = 'group'
         AND LOWER(TRIM(g.name)) = LOWER(?)
       LIMIT 1`,
      [input.userId, nameTrim]
    );
    if (dupRows.length) {
      await conn.rollback();
      const err = new Error("duplicate_group_name_owner");
      (err as Error & { code?: string }).code = "duplicate_group_name_owner";
      throw err;
    }

    const [subRes] = await conn.query<ResultSetHeader>(
      `INSERT INTO subscriptions (type, userId, ownerId, planId, status, endDate)
       VALUES ('group', ?, ?, ?, 'active', ?)`,
      [input.userId, input.userId, input.planId, endDate]
    );
    const subscriptionId = Number(subRes.insertId);
    if (!Number.isFinite(subscriptionId) || subscriptionId < 1) {
      throw new Error("subscription_insert_failed");
    }

    const [gRes] = await conn.query<ResultSetHeader>(
      `INSERT INTO \`groups\` (name, description, subscriptionId, accessCode, isPublic, maxSummaryLength, allowPersonalContext)
       VALUES (?, ?, ?, NULL, 0, 1000, 1)`,
      [nameTrim, input.description?.trim() || null, subscriptionId]
    );
    const groupId = Number(gRes.insertId);
    if (!Number.isFinite(groupId) || groupId < 1) {
      throw new Error("group_insert_failed");
    }

    await conn.query(
      `INSERT INTO group_members (groupId, userId, role) VALUES (?, ?, 'owner')`,
      [groupId, input.userId]
    );

    await conn.commit();
    return { groupId, subscriptionId };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
