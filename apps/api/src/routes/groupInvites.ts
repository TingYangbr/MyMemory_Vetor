import type { FastifyPluginAsync } from "fastify";
import type {
  AcceptGroupInviteResponse,
  CreateGroupInviteResponse,
  PatchGroupOwnerSettingsResponse,
  GroupOwnerPanelResponse,
} from "@mymemory/shared";
import { z } from "zod";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import {
  acceptGroupInviteToken,
  createGroupEmailInvite,
  getGroupOwnerPanelData,
  updateGroupOwnerSettings,
} from "../services/groupInviteService.js";

const groupIdParam = z.coerce.number().int().positive();

const postInviteBody = z.object({
  email: z.string().trim().email("E-mail inválido."),
  role: z.enum(["editor", "viewer"]),
});

const patchOwnerSettingsBody = z.object({
  allowFreeSpecificFieldsWithoutCategoryMatch: z.boolean(),
});

const acceptBody = z.object({
  token: z.string().trim().min(16, "Token inválido."),
});

function mapServiceError(
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  err: unknown
): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const map: Record<string, { status: number; error: string; message: string }> = {
    forbidden_group: {
      status: 403,
      error: "forbidden",
      message: "Sem permissão para gerenciar este grupo.",
    },
    group_not_found: { status: 404, error: "not_found", message: "Grupo não encontrado." },
    invalid_email: { status: 400, error: "invalid_email", message: "E-mail inválido." },
    invalid_role: { status: 400, error: "invalid_role", message: "Perfil inválido." },
    invite_not_found: { status: 404, error: "invite_not_found", message: "Convite não encontrado." },
    invite_expired: { status: 410, error: "invite_expired", message: "Este convite expirou." },
    invite_used: { status: 409, error: "invite_used", message: "Este convite já foi utilizado." },
    group_settings_schema_outdated: {
      status: 503,
      error: "schema_outdated",
      message: "Execute docs/migrations/024_free_specific_fields_without_match.sql no banco de dados.",
    },
    email_mismatch: {
      status: 403,
      error: "email_mismatch",
      message: "Entre com a conta do mesmo e-mail que recebeu o convite.",
    },
    needs_individual_plan: {
      status: 403,
      error: "needs_individual_plan",
      message: "É necessário um plano individual ativo. Escolha um plano e conclua o cadastro antes de aceitar o convite.",
    },
    invalid_token: { status: 400, error: "invalid_token", message: "Token inválido." },
  };
  const m = map[msg];
  if (!m) return false;
  void reply.code(m.status).send({ error: m.error, message: m.message });
  return true;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/groups/:groupId/owner-panel", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const parsed = groupIdParam.safeParse((req.params as { groupId: string }).groupId);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_group", message: "Grupo inválido." });
    }
    try {
      const data = await getGroupOwnerPanelData(userId, parsed.data, isAdmin);
      const body: GroupOwnerPanelResponse = { ok: true, ...data };
      return body;
    } catch (e) {
      if (mapServiceError(reply, e)) return;
      throw e;
    }
  });

  app.post("/api/groups/:groupId/invites", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const gidParsed = groupIdParam.safeParse((req.params as { groupId: string }).groupId);
    if (!gidParsed.success) {
      return reply.code(400).send({ error: "invalid_group", message: "Grupo inválido." });
    }
    const bodyParsed = postInviteBody.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: bodyParsed.error.issues[0]?.message ?? "Dados inválidos.",
      });
    }
    try {
      const result = await createGroupEmailInvite({
        ownerUserId: userId,
        groupId: gidParsed.data,
        emailRaw: bodyParsed.data.email,
        role: bodyParsed.data.role,
        isAdmin,
      });
      const resBody: CreateGroupInviteResponse = {
        ok: true,
        inviteId: result.inviteId,
        emailSendFailed: result.emailSendFailed,
        message: result.message,
      };
      return reply.code(201).send(resBody);
    } catch (e) {
      if (mapServiceError(reply, e)) return;
      throw e;
    }
  });

  app.patch("/api/groups/:groupId/owner-settings", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const gidParsed = groupIdParam.safeParse((req.params as { groupId: string }).groupId);
    if (!gidParsed.success) {
      return reply.code(400).send({ error: "invalid_group", message: "Grupo inválido." });
    }
    const bodyParsed = patchOwnerSettingsBody.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: bodyParsed.error.issues[0]?.message ?? "Dados inválidos.",
      });
    }
    try {
      const group = await updateGroupOwnerSettings({
        userId,
        groupId: gidParsed.data,
        isAdmin,
        allowFreeSpecificFieldsWithoutCategoryMatch:
          bodyParsed.data.allowFreeSpecificFieldsWithoutCategoryMatch,
      });
      const body: PatchGroupOwnerSettingsResponse = { ok: true, group };
      return body;
    } catch (e) {
      if (mapServiceError(reply, e)) return;
      throw e;
    }
  });

  app.post("/api/group-invites/accept", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login para aceitar o convite." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const parsed = acceptBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      });
    }
    const [uRows] = await pool.query<RowDataPacket[]>(
      "SELECT email FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    const email = uRows[0]?.email != null ? String(uRows[0].email) : "";
    if (!email) {
      return reply.code(400).send({ error: "no_email", message: "Conta sem e-mail." });
    }
    try {
      const out = await acceptGroupInviteToken({
        userId,
        userEmail: email,
        token: parsed.data.token,
        isAdmin,
      });
      const resBody: AcceptGroupInviteResponse = {
        ok: true,
        groupId: out.groupId,
        groupName: out.groupName,
        alreadyMember: out.alreadyMember,
      };
      return resBody;
    } catch (e) {
      if (mapServiceError(reply, e)) return;
      throw e;
    }
  });
};

export default plugin;
