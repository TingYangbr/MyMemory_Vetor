import type { GroupOwnerPanelInviteRow } from "@mymemory/shared";
import type { ResultSetHeader, RowDataPacket } from "../lib/dbTypes.js";
import crypto from "node:crypto";
import { pool } from "../db.js";
import { config } from "../config.js";
import { sendGroupInviteEmail } from "../lib/mail.js";
import { assertUserCanAccessGroup } from "./memoContextService.js";

export type GroupInviteMemberRole = "editor" | "viewer";

function normEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function hasActiveIndividualSubscription(userId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM subscriptions
     WHERE userId = ? AND type = 'individual' AND status = 'active'
     LIMIT 1`,
    [userId]
  );
  return Boolean(rows[0]);
}

export interface GroupOwnerPanelData {
  group: {
    id: number;
    name: string;
    description: string | null;
    allowFreeSpecificFieldsWithoutCategoryMatch: boolean;
  };
  invites: GroupOwnerPanelInviteRow[];
}

export async function getGroupOwnerPanelData(
  userId: number,
  groupId: number,
  isAdmin: boolean
): Promise<GroupOwnerPanelData> {
  await assertUserCanAccessGroup(userId, groupId, isAdmin);
  let gRows: RowDataPacket[];
  try {
    [gRows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, description, allowFreeSpecificFieldsWithoutCategoryMatch FROM groups WHERE id = ? LIMIT 1",
      [groupId]
    );
  } catch {
    [gRows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, description FROM groups WHERE id = ? LIMIT 1",
      [groupId]
    );
  }
  const g = gRows[0];
  if (!g) throw new Error("group_not_found");
  const [invRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, email, role, status, expiresAt, createdAt
     FROM email_invites
     WHERE groupId = ?
     ORDER BY createdAt DESC
     LIMIT 100`,
    [groupId]
  );
  const invites: GroupOwnerPanelInviteRow[] = invRows.map((r) => ({
    id: Number(r.id),
    email: String(r.email),
    role: String(r.role),
    status: String(r.status),
    expiresAt: String(r.expiresAt),
    createdAt: String(r.createdAt),
  }));
  return {
    group: {
      id: Number(g.id),
      name: String(g.name),
      description: g.description != null && String(g.description).trim() !== "" ? String(g.description) : null,
      allowFreeSpecificFieldsWithoutCategoryMatch:
        g.allowFreeSpecificFieldsWithoutCategoryMatch === 1 ||
        g.allowFreeSpecificFieldsWithoutCategoryMatch === true,
    },
    invites,
  };
}

export async function updateGroupOwnerSettings(input: {
  userId: number;
  groupId: number;
  isAdmin: boolean;
  allowFreeSpecificFieldsWithoutCategoryMatch: boolean;
}): Promise<GroupOwnerPanelData["group"]> {
  await assertUserCanAccessGroup(input.userId, input.groupId, input.isAdmin);
  try {
    await pool.query(
      `UPDATE groups SET allowfreespecificfieldswithoutcategorymatch = ? WHERE id = ?`,
      [input.allowFreeSpecificFieldsWithoutCategoryMatch ? 1 : 0, input.groupId]
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("allowfreespecificfieldswithoutcategorymatch")) {
      throw new Error("group_settings_schema_outdated");
    }
    throw e;
  }
  const data = await getGroupOwnerPanelData(input.userId, input.groupId, input.isAdmin);
  return data.group;
}

export interface CreateInviteResult {
  ok: true;
  inviteId: number;
  emailSendFailed?: boolean;
  message?: string;
}

export async function createGroupEmailInvite(input: {
  ownerUserId: number;
  groupId: number;
  emailRaw: string;
  role: GroupInviteMemberRole;
  isAdmin: boolean;
}): Promise<CreateInviteResult> {
  await assertUserCanAccessGroup(input.ownerUserId, input.groupId, input.isAdmin);
  let email: string;
  try {
    email = normEmail(input.emailRaw);
    if (!email.includes("@") || email.length > 320) throw new Error("bad");
  } catch {
    throw new Error("invalid_email");
  }
  if (input.role !== "editor" && input.role !== "viewer") {
    throw new Error("invalid_role");
  }

  const [gRows] = await pool.query<RowDataPacket[]>(
    "SELECT name FROM groups WHERE id = ? LIMIT 1",
    [input.groupId]
  );
  if (!gRows[0]) throw new Error("group_not_found");
  const groupName = String(gRows[0].name);

  await pool.query(
    `UPDATE email_invites SET status = 'expired'
     WHERE groupId = ? AND LOWER(TRIM(email)) = ? AND status = 'pending'`,
    [input.groupId, email]
  );

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);

  const [insRows] = await pool.query<{ id: number }[]>(
    `INSERT INTO email_invites (groupid, email, invitedbyuserid, role, adminrole, token, status, expiresat)
     VALUES (?, ?, ?, ?, 'user', ?, 'pending', ?) RETURNING id`,
    [input.groupId, email, input.ownerUserId, input.role, token, expiresAt]
  );
  const insertId = Number(insRows[0]?.id);
  if (!Number.isFinite(insertId)) throw new Error("insert_failed");

  const acceptPath = `/convite/grupo?token=${encodeURIComponent(token)}`;
  const loginUrl = `${config.publicWebUrl}/login?next=${encodeURIComponent(acceptPath)}`;
  const registerStartUrl = `${config.publicWebUrl}/select-plan?next=${encodeURIComponent(acceptPath)}`;

  try {
    await sendGroupInviteEmail(email, { groupName, loginUrl, registerStartUrl });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: true,
      inviteId: insertId,
      emailSendFailed: true,
      message: `Convite registrado, mas o envio do e-mail falhou: ${detail}`,
    };
  }

  return { ok: true, inviteId: insertId };
}

export interface AcceptInviteResult {
  ok: true;
  groupId: number;
  groupName: string;
  alreadyMember?: boolean;
}

export async function acceptGroupInviteToken(input: {
  userId: number;
  userEmail: string;
  token: string;
  isAdmin: boolean;
}): Promise<AcceptInviteResult> {
  const token = String(input.token ?? "").trim();
  if (token.length < 16) throw new Error("invalid_token");

  const emailNorm = normEmail(input.userEmail);

  if (!input.isAdmin) {
    const okInd = await hasActiveIndividualSubscription(input.userId);
    if (!okInd) throw new Error("needs_individual_plan");
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ei.id, ei.groupId, ei.email, ei.role, ei.status, ei.expiresAt, g.name AS groupName
       FROM email_invites ei
       INNER JOIN groups g ON g.id = ei.groupId
       WHERE ei.token = ?
       LIMIT 1
       FOR UPDATE`,
      [token]
    );
    const inv = rows[0];
    if (!inv) {
      await conn.rollback();
      throw new Error("invite_not_found");
    }

    const groupId = Number(inv.groupId);
    const groupName = String(inv.groupName);
    const inviteEmail = normEmail(String(inv.email));
    const status = String(inv.status);
    const role = String(inv.role) as "owner" | "editor" | "viewer";

    if (emailNorm !== inviteEmail) {
      await conn.rollback();
      throw new Error("email_mismatch");
    }

    if (status === "accepted") {
      const [mem] = await conn.query<RowDataPacket[]>(
        "SELECT 1 FROM group_members WHERE groupId = ? AND userId = ? LIMIT 1",
        [groupId, input.userId]
      );
      if (mem[0]) {
        await conn.commit();
        return { ok: true, groupId, groupName, alreadyMember: true };
      }
      await conn.rollback();
      throw new Error("invite_used");
    }

    if (status !== "pending") {
      await conn.rollback();
      throw new Error("invite_used");
    }

    const exp = new Date(String(inv.expiresAt));
    if (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now()) {
      await conn.rollback();
      await pool.query("UPDATE email_invites SET status = 'expired' WHERE id = ?", [inv.id]);
      throw new Error("invite_expired");
    }

    const [memRows] = await conn.query<RowDataPacket[]>(
      "SELECT role FROM group_members WHERE groupId = ? AND userId = ? LIMIT 1",
      [groupId, input.userId]
    );
    const existing = memRows[0];
    if (existing) {
      const cur = String(existing.role);
      if (cur !== "owner" && (role === "editor" || role === "viewer")) {
        await conn.query("UPDATE group_members SET role = ? WHERE groupId = ? AND userId = ?", [
          role,
          groupId,
          input.userId,
        ]);
      }
    } else {
      await conn.query(`INSERT INTO group_members (groupId, userId, role) VALUES (?, ?, ?)`, [
        groupId,
        input.userId,
        role,
      ]);
    }

    await conn.query(
      `UPDATE email_invites SET status = 'accepted', acceptedAt = NOW() WHERE id = ? AND status = 'pending'`,
      [inv.id]
    );

    await conn.commit();
    return { ok: true, groupId, groupName };
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      /* transação já concluída ou inválida */
    }
    throw e;
  } finally {
    conn.release();
  }
}
