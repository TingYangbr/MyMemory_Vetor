import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { config } from "../config.js";
import { sendUserInviteEmail } from "../lib/mail.js";

function normEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface UserInviteRow {
  id: number;
  email: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

export interface CreateUserInviteResult {
  ok: true;
  inviteId: number;
  emailSendFailed?: boolean;
  message?: string;
}

export async function listUserInvites(): Promise<UserInviteRow[]> {
  await expireStaleUserInvites();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, email, status, createdat, expiresat, acceptedat
     FROM user_invites
     ORDER BY createdat DESC
     LIMIT 200`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    email: String(r.email),
    status: String(r.status),
    createdAt: String(r.createdat),
    expiresAt: String(r.expiresat),
    acceptedAt: r.acceptedat != null ? String(r.acceptedat) : null,
  }));
}

export async function createUserInvite(input: {
  adminUserId: number;
  emailRaw: string;
}): Promise<CreateUserInviteResult> {
  const email = normEmail(input.emailRaw);
  if (!email.includes("@") || email.length > 320) {
    throw new Error("invalid_email");
  }

  await pool.query(
    `UPDATE user_invites SET status = 'expired'
     WHERE LOWER(email) = ? AND status = 'pending'`,
    [email]
  );

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);

  const [insRows] = await pool.query<{ id: number }[]>(
    `INSERT INTO user_invites (email, invitedbyuserid, token, status, expiresat)
     VALUES (?, ?, ?, 'pending', ?) RETURNING id`,
    [email, input.adminUserId, token, expiresAt]
  );
  const inviteId = Number(insRows[0]?.id);
  if (!Number.isFinite(inviteId)) throw new Error("insert_failed");

  const registerUrl = `${config.publicWebUrl}/select-plan?inviteToken=${encodeURIComponent(token)}`;

  try {
    await sendUserInviteEmail(email, { registerUrl });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: true,
      inviteId,
      emailSendFailed: true,
      message: `Convite registrado, mas o envio do e-mail falhou: ${detail}`,
    };
  }

  return { ok: true, inviteId };
}

export async function markUserInviteAccepted(
  token: string,
  emailNorm: string,
  userId: number
): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE user_invites
     SET status = 'accepted', acceptedat = NOW(), acceptedbyuserid = ?
     WHERE token = ? AND LOWER(email) = ? AND status = 'pending' AND expiresat > NOW()`,
    [userId, token, emailNorm]
  );
  return res.affectedRows ?? 0;
}

async function expireStaleUserInvites(): Promise<void> {
  await pool.query(
    `UPDATE user_invites SET status = 'expired'
     WHERE status = 'pending' AND expiresat < NOW()`
  );
}
