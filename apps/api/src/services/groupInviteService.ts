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
  /** O e-mail convidado já tem conta (define qual versão do convite foi enviada). */
  temConta: boolean;
}

const VALIDADE_CONVITE_MS = 14 * 24 * 3600 * 1000;

async function emailTemConta(email: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1",
    [normEmail(email)]
  );
  return rows.length > 0;
}

/** Monta e envia o e-mail do convite (versão "já tem conta" ou "criar conta"). */
async function enviarEmailDoConvite(inviteId: number): Promise<{ temConta: boolean; erro?: string }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ei.email, ei.token, ei.expiresAt, g.name AS groupName, u.name AS "inviterName"
     FROM email_invites ei
     INNER JOIN groups g ON g.id = ei.groupId
     LEFT JOIN users u ON u.id = ei.invitedByUserId
     WHERE ei.id = ? LIMIT 1`,
    [inviteId]
  );
  const inv = rows[0];
  if (!inv) throw new Error("invite_not_found");
  const email = String(inv.email);
  const temConta = await emailTemConta(email);
  const acceptPath = `/convite/grupo?token=${encodeURIComponent(String(inv.token))}`;
  const actionUrl = temConta
    ? `${config.publicWebUrl}/login?next=${encodeURIComponent(acceptPath)}`
    : `${config.publicWebUrl}/select-plan?next=${encodeURIComponent(acceptPath)}`;
  try {
    await sendGroupInviteEmail(email, {
      groupName: String(inv.groupName),
      inviterName: inv.inviterName != null ? String(inv.inviterName) : null,
      temConta,
      actionUrl,
      resetUrl: `${config.publicWebUrl}/esqueci-senha`,
      expiresAt: new Date(String(inv.expiresAt)),
    });
    return { temConta };
  } catch (err) {
    return { temConta, erro: err instanceof Error ? err.message : String(err) };
  }
}

/** Reenvia um convite pendente ou expirado (formato atual), renovando a validade por 14 dias. */
export async function resendGroupInvite(input: {
  ownerUserId: number;
  groupId: number;
  inviteId: number;
  isAdmin: boolean;
}): Promise<CreateInviteResult> {
  await assertUserCanAccessGroup(input.ownerUserId, input.groupId, input.isAdmin);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, email, status FROM email_invites WHERE id = ? AND groupId = ? LIMIT 1",
    [input.inviteId, input.groupId]
  );
  const inv = rows[0];
  if (!inv) throw new Error("invite_not_found");
  if (String(inv.status) === "accepted") throw new Error("invite_used");
  // Outros convites pendentes do mesmo e-mail no grupo deixam de valer (um link ativo por pessoa)
  await pool.query(
    `UPDATE email_invites SET status = 'expired'
     WHERE groupId = ? AND LOWER(TRIM(email)) = ? AND status = 'pending' AND id <> ?`,
    [input.groupId, normEmail(String(inv.email)), input.inviteId]
  );
  await pool.query("UPDATE email_invites SET status = 'pending', expiresAt = ? WHERE id = ?", [
    new Date(Date.now() + VALIDADE_CONVITE_MS),
    input.inviteId,
  ]);
  const envio = await enviarEmailDoConvite(input.inviteId);
  return envio.erro
    ? { ok: true, inviteId: input.inviteId, temConta: envio.temConta, emailSendFailed: true,
        message: `Convite renovado, mas o envio do e-mail falhou: ${envio.erro}` }
    : { ok: true, inviteId: input.inviteId, temConta: envio.temConta };
}

export interface GroupInviteInfo {
  groupName: string;
  email: string;
  inviterName: string | null;
  temConta: boolean;
  status: "pending" | "accepted" | "expired";
  expiresAt: string;
}

/** Dados públicos do convite (quem tem o token): usados na tela do convite e no cadastro. */
export async function getGroupInviteInfo(tokenRaw: string): Promise<GroupInviteInfo> {
  const token = String(tokenRaw ?? "").trim();
  if (token.length < 16) throw new Error("invalid_token");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ei.email, ei.status, ei.expiresAt, g.name AS groupName, u.name AS "inviterName"
     FROM email_invites ei
     INNER JOIN groups g ON g.id = ei.groupId
     LEFT JOIN users u ON u.id = ei.invitedByUserId
     WHERE ei.token = ? LIMIT 1`,
    [token]
  );
  const inv = rows[0];
  if (!inv) throw new Error("invite_not_found");
  const exp = new Date(String(inv.expiresAt));
  const st = String(inv.status);
  const status: GroupInviteInfo["status"] =
    st === "accepted" ? "accepted" : st === "pending" && exp.getTime() >= Date.now() ? "pending" : "expired";
  return {
    groupName: String(inv.groupName),
    email: String(inv.email),
    inviterName: inv.inviterName != null ? String(inv.inviterName) : null,
    temConta: await emailTemConta(String(inv.email)),
    status,
    expiresAt: exp.toISOString(),
  };
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
  const expiresAt = new Date(Date.now() + VALIDADE_CONVITE_MS);

  const [insRows] = await pool.query<{ id: number }[]>(
    `INSERT INTO email_invites (groupid, email, invitedbyuserid, role, adminrole, token, status, expiresat)
     VALUES (?, ?, ?, ?, 'user', ?, 'pending', ?) RETURNING id`,
    [input.groupId, email, input.ownerUserId, input.role, token, expiresAt]
  );
  const insertId = Number(insRows[0]?.id);
  if (!Number.isFinite(insertId)) throw new Error("insert_failed");

  const envio = await enviarEmailDoConvite(insertId);
  if (envio.erro) {
    return {
      ok: true,
      inviteId: insertId,
      temConta: envio.temConta,
      emailSendFailed: true,
      message: `Convite registrado, mas o envio do e-mail falhou: ${envio.erro}`,
    };
  }
  return { ok: true, inviteId: insertId, temConta: envio.temConta };
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
      // Limite de membros do plano (subscription_plans.maxmembers, só o admin do sistema altera).
      // Só barra a ENTRADA de um membro novo; quem já está no grupo nunca é removido por isso.
      const [lim] = await conn.query<RowDataPacket[]>(
        `SELECT sp.maxmembers AS "maxMembers",
                (SELECT COUNT(*) FROM group_members gm WHERE gm.groupid = g.id) AS "total"
         FROM groups g
         LEFT JOIN subscriptions s ON s.id = g.subscriptionid
         LEFT JOIN subscription_plans sp ON sp.id = s.planid
         WHERE g.id = ?`,
        [groupId]
      );
      const max = lim[0]?.maxMembers == null ? null : Number(lim[0].maxMembers);
      if (max != null && Number(lim[0]?.total ?? 0) >= max) {
        await conn.rollback();
        throw new Error("group_member_limit");
      }
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
