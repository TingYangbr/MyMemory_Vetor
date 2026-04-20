import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type {
  MeResponse,
  PatchMePreferencesResponse,
  PatchWorkspaceResponse,
  UserIaUseLevel,
  UserMemoPreferences,
  UserMediaLimitsResponse,
  UserUsageDashboardResponse,
  WorkspaceGroupsResponse,
} from "@mymemory/shared";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db.js";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import {
  assertUserWorkspaceGroupAccess,
  listWorkspaceGroupsForUser,
} from "../services/memoContextService.js";
import { getUserMediaLimits } from "../services/mediaLimitsService.js";
import { getUsdToCreditsMultiplier, showApiCostInUi } from "../services/systemConfigService.js";
import { getUserUsageDashboard } from "../services/userUsageService.js";

const patchWorkspaceBody = z.object({
  groupId: z.union([z.null(), z.number().int().positive()]),
});

const SQL_ME_MEMO_CTX = `(
          u.role = 'admin'
          OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.userId = u.id AND gm.role = 'owner')
          OR EXISTS (
            SELECT 1 FROM subscriptions s
            WHERE s.ownerId = u.id AND s.type = 'group' AND s.status = 'active'
          )
        ) AS memoContextAccess`;

const SQL_ME_PREFS_CORE = `u.soundEnabled, u.confirmEnabled,
        u.allowFreeSpecificFieldsWithoutCategoryMatch,
        u.iaUseTexto, u.iaUseImagem, u.iaUseVideo, u.iaUseAudio, u.iaUseDocumento, u.iaUseUrl`;
const SQL_ME_PREFS_CORE_NO024 = `u.soundEnabled, u.confirmEnabled,
        u.iaUseTexto, u.iaUseImagem, u.iaUseVideo, u.iaUseAudio, u.iaUseDocumento, u.iaUseUrl`;
const SQL_ME_PREFS = `${SQL_ME_PREFS_CORE},
        u.imageOcrVisionMinConfidence`;
const SQL_ME_PREFS_NO024 = `${SQL_ME_PREFS_CORE_NO024},
        u.imageOcrVisionMinConfidence`;

const iaUseEnum = z.enum(["semIA", "basico", "completo"]);

const patchMePreferencesBody = z
  .object({
    confirmEnabled: z.boolean().optional(),
    soundEnabled: z.boolean().optional(),
    allowFreeSpecificFieldsWithoutCategoryMatch: z.boolean().optional(),
    iaUseTexto: iaUseEnum.optional(),
    iaUseImagem: iaUseEnum.optional(),
    iaUseVideo: iaUseEnum.optional(),
    iaUseAudio: iaUseEnum.optional(),
    iaUseDocumento: iaUseEnum.optional(),
    iaUseUrl: iaUseEnum.optional(),
    imageOcrVisionMinConfidence: z.union([z.null(), z.number().int().min(1).max(100)]).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "Informe ao menos um campo." });

function normalizeIaUse(v: unknown): UserIaUseLevel {
  const s = String(v ?? "");
  if (s === "semIA" || s === "basico" || s === "completo") return s;
  return "basico";
}

function normalizeImageOcrVisionMinConfidence(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 100) return null;
  return Math.floor(n);
}

function rowToUserMemoPreferences(u: RowDataPacket): UserMemoPreferences {
  return {
    confirmEnabled: u.confirmEnabled === 1 || u.confirmEnabled === true,
    soundEnabled: u.soundEnabled === 1 || u.soundEnabled === true,
    allowFreeSpecificFieldsWithoutCategoryMatch:
      u.allowFreeSpecificFieldsWithoutCategoryMatch === 1 ||
      u.allowFreeSpecificFieldsWithoutCategoryMatch === true,
    iaUseTexto: normalizeIaUse(u.iaUseTexto),
    iaUseImagem: normalizeIaUse(u.iaUseImagem),
    iaUseVideo: normalizeIaUse(u.iaUseVideo),
    iaUseAudio: normalizeIaUse(u.iaUseAudio),
    iaUseDocumento: normalizeIaUse(u.iaUseDocumento),
    iaUseUrl: normalizeIaUse(u.iaUseUrl),
    imageOcrVisionMinConfidence: normalizeImageOcrVisionMinConfidence(u.imageOcrVisionMinConfidence),
  };
}

function attachMemoPrefsToMe(body: MeResponse, u: RowDataPacket, includeExtendedPrefs: boolean): void {
  body.soundEnabled = u.soundEnabled === 1 || u.soundEnabled === true;
  if (!includeExtendedPrefs) return;
  body.confirmEnabled = u.confirmEnabled === 1 || u.confirmEnabled === true;
  body.allowFreeSpecificFieldsWithoutCategoryMatch =
    u.allowFreeSpecificFieldsWithoutCategoryMatch === 1 ||
    u.allowFreeSpecificFieldsWithoutCategoryMatch === true;
  body.iaUseTexto = normalizeIaUse(u.iaUseTexto);
  body.iaUseImagem = normalizeIaUse(u.iaUseImagem);
  body.iaUseVideo = normalizeIaUse(u.iaUseVideo);
  body.iaUseAudio = normalizeIaUse(u.iaUseAudio);
  body.iaUseDocumento = normalizeIaUse(u.iaUseDocumento);
  body.iaUseUrl = normalizeIaUse(u.iaUseUrl);
  body.imageOcrVisionMinConfidence = normalizeImageOcrVisionMinConfidence(u.imageOcrVisionMinConfidence);
}

/** Base sem `lastWorkspaceGroupId` (antes da migração 004). */
function isUnknownColumnErr(err: unknown, col: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; errno?: number; sqlMessage?: string };
  if (e.code !== "ER_BAD_FIELD_ERROR" && e.errno !== 1054) return false;
  return String(e.sqlMessage ?? "").includes(col);
}

async function resolveWorkspaceDisplay(
  userId: number,
  role: string,
  rawLastGroupId: unknown
): Promise<{ lastWorkspaceGroupId: number | null; groupLabel: string }> {
  const isAdmin = role === "admin";
  if (rawLastGroupId == null || rawLastGroupId === "") {
    return { lastWorkspaceGroupId: null, groupLabel: "Pessoal" };
  }
  const gid = Number(rawLastGroupId);
  if (!Number.isFinite(gid) || gid < 1) {
    await pool.query("UPDATE users SET lastWorkspaceGroupId = NULL WHERE id = ?", [userId]);
    return { lastWorkspaceGroupId: null, groupLabel: "Pessoal" };
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT g.name AS groupName FROM \`groups\` g WHERE g.id = ? LIMIT 1`,
    [gid]
  );
  if (!rows.length) {
    await pool.query("UPDATE users SET lastWorkspaceGroupId = NULL WHERE id = ?", [userId]);
    return { lastWorkspaceGroupId: null, groupLabel: "Pessoal" };
  }

  try {
    await assertUserWorkspaceGroupAccess(userId, gid, isAdmin);
  } catch {
    await pool.query("UPDATE users SET lastWorkspaceGroupId = NULL WHERE id = ?", [userId]);
    return { lastWorkspaceGroupId: null, groupLabel: "Pessoal" };
  }

  const name = String(rows[0].groupName ?? "").trim();
  return {
    lastWorkspaceGroupId: gid,
    groupLabel: name || `Grupo #${gid}`,
  };
}

/**
 * Quando o SELECT completo falha (ex.: tabela `subscriptions` ausente, SQL memoContext), devolve perfil mínimo
 * para não bloquear login / cabeçalho com HTTP 500.
 */
async function buildMeResponseFallback(log: FastifyInstance["log"], userId: number): Promise<MeResponse | null> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, email, role, emailVerified, soundEnabled FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    const u = rows[0];
    if (!u) return null;
    const role = u.role === "admin" ? "admin" : "user";
    const body: MeResponse = {
      id: u.id as number,
      name: (u.name as string) ?? null,
      email: (u.email as string) ?? null,
      groupLabel: "Pessoal",
      lastWorkspaceGroupId: null,
      role,
      memoContextAccess: role === "admin",
      emailVerified: u.emailVerified === 1 || u.emailVerified === true,
    };
    attachMemoPrefsToMe(body, u, false);
    body.showApiCost = await showApiCostInUi();
    body.usdToCreditsMultiplier = await getUsdToCreditsMultiplier();
    return body;
  } catch (err) {
    log.error({ err }, "GET /api/me: fallback mínimo também falhou");
    return null;
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/me", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Faça login para continuar.",
      });
    }
    try {
    const sqlFullPrefs = `SELECT u.id, u.name, u.email, u.role, u.emailVerified, u.lastWorkspaceGroupId,
        ${SQL_ME_PREFS},
        ${SQL_ME_MEMO_CTX}
       FROM users u WHERE u.id = ? LIMIT 1`;
    const sqlFullPrefsNo024 = `SELECT u.id, u.name, u.email, u.role, u.emailVerified, u.lastWorkspaceGroupId,
        ${SQL_ME_PREFS_NO024},
        ${SQL_ME_MEMO_CTX}
       FROM users u WHERE u.id = ? LIMIT 1`;
    const sqlFullPrefsNo018 = `SELECT u.id, u.name, u.email, u.role, u.emailVerified, u.lastWorkspaceGroupId,
        ${SQL_ME_PREFS_CORE},
        ${SQL_ME_MEMO_CTX}
       FROM users u WHERE u.id = ? LIMIT 1`;
    const sqlFullPrefsNo018No024 = `SELECT u.id, u.name, u.email, u.role, u.emailVerified, u.lastWorkspaceGroupId,
        ${SQL_ME_PREFS_CORE_NO024},
        ${SQL_ME_MEMO_CTX}
       FROM users u WHERE u.id = ? LIMIT 1`;
    const sqlFullLegacyPrefs = `SELECT u.id, u.name, u.email, u.role, u.emailVerified, u.lastWorkspaceGroupId,
        u.soundEnabled,
        ${SQL_ME_MEMO_CTX}
       FROM users u WHERE u.id = ? LIMIT 1`;
    const sqlFallbackPrefs = `SELECT u.id, u.name, u.email, u.role, u.emailVerified,
        ${SQL_ME_PREFS},
        ${SQL_ME_MEMO_CTX}
       FROM users u WHERE u.id = ? LIMIT 1`;
    const sqlFallbackPrefsNo024 = `SELECT u.id, u.name, u.email, u.role, u.emailVerified,
        ${SQL_ME_PREFS_NO024},
        ${SQL_ME_MEMO_CTX}
       FROM users u WHERE u.id = ? LIMIT 1`;
    const sqlFallbackPrefsNo018 = `SELECT u.id, u.name, u.email, u.role, u.emailVerified,
        ${SQL_ME_PREFS_CORE},
        ${SQL_ME_MEMO_CTX}
       FROM users u WHERE u.id = ? LIMIT 1`;
    const sqlFallbackPrefsNo018No024 = `SELECT u.id, u.name, u.email, u.role, u.emailVerified,
        ${SQL_ME_PREFS_CORE_NO024},
        ${SQL_ME_MEMO_CTX}
       FROM users u WHERE u.id = ? LIMIT 1`;
    const sqlFallbackLegacyPrefs = `SELECT u.id, u.name, u.email, u.role, u.emailVerified,
        u.soundEnabled,
        ${SQL_ME_MEMO_CTX}
       FROM users u WHERE u.id = ? LIMIT 1`;

    let rows: RowDataPacket[];
    let hasLastWorkspaceCol = true;
    let hasExtendedMemoPrefs = true;
    let has024Prefs = true;
    try {
      [rows] = await pool.query<RowDataPacket[]>(sqlFullPrefs, [userId]);
    } catch (err) {
      if (isUnknownColumnErr(err, "allowFreeSpecificFieldsWithoutCategoryMatch")) {
        app.log.warn(
          { err },
          "Coluna allowFreeSpecificFieldsWithoutCategoryMatch em falta — execute docs/migrations/024_free_specific_fields_without_match.sql"
        );
        has024Prefs = false;
        try {
          [rows] = await pool.query<RowDataPacket[]>(sqlFullPrefsNo024, [userId]);
        } catch (err2) {
          if (isUnknownColumnErr(err2, "lastWorkspaceGroupId")) {
            [rows] = await pool.query<RowDataPacket[]>(sqlFallbackPrefsNo024, [userId]);
            hasLastWorkspaceCol = false;
          } else if (isUnknownColumnErr(err2, "imageOcrVisionMinConfidence")) {
            [rows] = await pool.query<RowDataPacket[]>(sqlFullPrefsNo018No024, [userId]);
          } else {
            throw err2;
          }
        }
      } else if (isUnknownColumnErr(err, "lastWorkspaceGroupId")) {
        app.log.warn(
          { err },
          "Coluna users.lastWorkspaceGroupId em falta — execute docs/migrations/004_user_last_workspace_group.sql"
        );
        try {
          [rows] = await pool.query<RowDataPacket[]>(sqlFallbackPrefs, [userId]);
        } catch (err2) {
          if (isUnknownColumnErr(err2, "allowFreeSpecificFieldsWithoutCategoryMatch")) {
            app.log.warn(
              { err: err2 },
              "Coluna allowFreeSpecificFieldsWithoutCategoryMatch em falta — execute docs/migrations/024_free_specific_fields_without_match.sql"
            );
            [rows] = await pool.query<RowDataPacket[]>(sqlFallbackPrefsNo024, [userId]);
            has024Prefs = false;
          } else
          if (
            isUnknownColumnErr(err2, "confirmEnabled") ||
            isUnknownColumnErr(err2, "iaUseTexto") ||
            isUnknownColumnErr(err2, "allowFreeSpecificFieldsWithoutCategoryMatch")
          ) {
            app.log.warn(
              { err: err2 },
              "Colunas de preferências de memo em falta — execute docs/migrations/008_user_memo_preferences.sql"
            );
            [rows] = await pool.query<RowDataPacket[]>(sqlFallbackLegacyPrefs, [userId]);
            hasExtendedMemoPrefs = false;
          } else if (isUnknownColumnErr(err2, "imageOcrVisionMinConfidence")) {
            app.log.warn(
              { err: err2 },
              "Coluna users.imageOcrVisionMinConfidence em falta — execute docs/migrations/018_user_image_ocr_vision_min_confidence.sql"
            );
            [rows] = await pool.query<RowDataPacket[]>(sqlFallbackPrefsNo018, [userId]);
          } else {
            throw err2;
          }
        }
        hasLastWorkspaceCol = false;
      } else if (
        isUnknownColumnErr(err, "confirmEnabled") ||
        isUnknownColumnErr(err, "iaUseTexto") ||
        isUnknownColumnErr(err, "allowFreeSpecificFieldsWithoutCategoryMatch")
      ) {
        app.log.warn(
          { err },
          "Colunas de preferências de memo em falta — execute docs/migrations/008_user_memo_preferences.sql"
        );
        try {
          [rows] = await pool.query<RowDataPacket[]>(sqlFullLegacyPrefs, [userId]);
        } catch (err2) {
          if (isUnknownColumnErr(err2, "lastWorkspaceGroupId")) {
            [rows] = await pool.query<RowDataPacket[]>(sqlFallbackLegacyPrefs, [userId]);
            hasLastWorkspaceCol = false;
          } else {
            throw err2;
          }
        }
        hasExtendedMemoPrefs = false;
      } else if (isUnknownColumnErr(err, "imageOcrVisionMinConfidence")) {
        app.log.warn(
          { err },
          "Coluna users.imageOcrVisionMinConfidence em falta — execute docs/migrations/018_user_image_ocr_vision_min_confidence.sql"
        );
        try {
          [rows] = await pool.query<RowDataPacket[]>(has024Prefs ? sqlFullPrefsNo018 : sqlFullPrefsNo018No024, [userId]);
        } catch (err2) {
          if (isUnknownColumnErr(err2, "lastWorkspaceGroupId")) {
            app.log.warn(
              { err: err2 },
              "Coluna users.lastWorkspaceGroupId em falta — execute docs/migrations/004_user_last_workspace_group.sql"
            );
            try {
              [rows] = await pool.query<RowDataPacket[]>(
                has024Prefs ? sqlFallbackPrefsNo018 : sqlFallbackPrefsNo018No024,
                [userId]
              );
            } catch (err3) {
              if (
                isUnknownColumnErr(err3, "confirmEnabled") ||
                isUnknownColumnErr(err3, "iaUseTexto") ||
                isUnknownColumnErr(err3, "allowFreeSpecificFieldsWithoutCategoryMatch")
              ) {
                app.log.warn(
                  { err: err3 },
                  "Colunas de preferências de memo em falta — execute docs/migrations/008_user_memo_preferences.sql"
                );
                [rows] = await pool.query<RowDataPacket[]>(sqlFallbackLegacyPrefs, [userId]);
                hasExtendedMemoPrefs = false;
              } else {
                throw err3;
              }
            }
            hasLastWorkspaceCol = false;
          } else {
            throw err2;
          }
        }
      } else {
        throw err;
      }
    }
    const u = rows[0];
    if (!u) {
      return reply.code(404).send({
        error: "user_not_found",
        message: "Execute docs/seed-dev.sql ou ajuste DEV_USER_ID.",
      });
    }
    const role = u.role === "admin" ? "admin" : "user";
    const mac = u.memoContextAccess === 1 || u.memoContextAccess === true;

    const workspace = hasLastWorkspaceCol
      ? await resolveWorkspaceDisplay(userId, String(u.role ?? "user"), u.lastWorkspaceGroupId)
      : { lastWorkspaceGroupId: null as number | null, groupLabel: "Pessoal" };

    const body: MeResponse = {
      id: u.id as number,
      name: (u.name as string) ?? null,
      email: (u.email as string) ?? null,
      groupLabel: workspace.groupLabel,
      lastWorkspaceGroupId: workspace.lastWorkspaceGroupId,
      role,
      memoContextAccess: mac,
      emailVerified: u.emailVerified === 1 || u.emailVerified === true,
    };
    attachMemoPrefsToMe(body, u, hasExtendedMemoPrefs);
    body.showApiCost = await showApiCostInUi();
    body.usdToCreditsMultiplier = await getUsdToCreditsMultiplier();
    return body;
    } catch (err) {
      app.log.error({ err }, "GET /api/me: erro no carregamento completo do perfil");
      const minimal = await buildMeResponseFallback(app.log, userId);
      if (minimal) {
        app.log.warn("GET /api/me: a responder com perfil mínimo (corrija schema ou migrações).");
        return minimal;
      }
      const isProd = process.env.NODE_ENV === "production";
      return reply.code(500).send({
        error: "server_error",
        message: isProd
          ? "Não foi possível carregar o perfil. Verifique a base de dados e as migrações em docs/migrations."
          : err instanceof Error
            ? err.message
            : String(err),
      });
    }
  });

  app.get("/api/me/usage", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    try {
      const body: UserUsageDashboardResponse = await getUserUsageDashboard(userId);
      return body;
    } catch (err) {
      app.log.error({ err }, "GET /api/me/usage");
      return reply.code(500).send({ error: "server_error", message: "Não foi possível carregar a utilização." });
    }
  });

  app.get("/api/me/media-limits", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const q = req.query as { groupId?: string };
    const gidParsed = z.coerce.number().int().positive().safeParse(q.groupId);
    const workspaceGroupId = gidParsed.success ? gidParsed.data : null;
    if (workspaceGroupId != null) {
      try {
        await assertUserWorkspaceGroupAccess(userId, workspaceGroupId, isAdmin);
      } catch {
        return reply.code(403).send({ error: "forbidden_group", message: "Sem acesso a este grupo." });
      }
    }
    const body: UserMediaLimitsResponse = await getUserMediaLimits(userId, workspaceGroupId, isAdmin);
    return body;
  });

  app.patch("/api/me/preferences", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const parsed = patchMePreferencesBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      });
    }
    const d = parsed.data;
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (d.confirmEnabled !== undefined) {
      sets.push("confirmEnabled = ?");
      vals.push(d.confirmEnabled ? 1 : 0);
    }
    if (d.soundEnabled !== undefined) {
      sets.push("soundEnabled = ?");
      vals.push(d.soundEnabled ? 1 : 0);
    }
    if (d.allowFreeSpecificFieldsWithoutCategoryMatch !== undefined) {
      sets.push("allowFreeSpecificFieldsWithoutCategoryMatch = ?");
      vals.push(d.allowFreeSpecificFieldsWithoutCategoryMatch ? 1 : 0);
    }
    if (d.iaUseTexto !== undefined) {
      sets.push("iaUseTexto = ?");
      vals.push(d.iaUseTexto);
    }
    if (d.iaUseImagem !== undefined) {
      sets.push("iaUseImagem = ?");
      vals.push(d.iaUseImagem);
    }
    if (d.iaUseVideo !== undefined) {
      sets.push("iaUseVideo = ?");
      vals.push(d.iaUseVideo);
    }
    if (d.iaUseAudio !== undefined) {
      sets.push("iaUseAudio = ?");
      vals.push(d.iaUseAudio);
    }
    if (d.iaUseDocumento !== undefined) {
      sets.push("iaUseDocumento = ?");
      vals.push(d.iaUseDocumento);
    }
    if (d.iaUseUrl !== undefined) {
      sets.push("iaUseUrl = ?");
      vals.push(d.iaUseUrl);
    }
    if (d.imageOcrVisionMinConfidence !== undefined) {
      sets.push("imageOcrVisionMinConfidence = ?");
      vals.push(d.imageOcrVisionMinConfidence);
    }
    vals.push(userId);
    try {
      await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, vals);
    } catch (err) {
      if (
        isUnknownColumnErr(err, "confirmEnabled") ||
        isUnknownColumnErr(err, "iaUseTexto") ||
        isUnknownColumnErr(err, "imageOcrVisionMinConfidence") ||
        isUnknownColumnErr(err, "allowFreeSpecificFieldsWithoutCategoryMatch")
      ) {
        return reply.code(503).send({
          error: "schema_outdated",
          message:
            "Execute docs/migrations/008_user_memo_preferences.sql, docs/migrations/018_user_image_ocr_vision_min_confidence.sql e docs/migrations/024_free_specific_fields_without_match.sql no banco de dados.",
        });
      }
      throw err;
    }
    try {
      const [prows] = await pool.query<RowDataPacket[]>(
        `SELECT soundEnabled, confirmEnabled, allowFreeSpecificFieldsWithoutCategoryMatch,
                iaUseTexto, iaUseImagem, iaUseVideo, iaUseAudio, iaUseDocumento, iaUseUrl,
                imageOcrVisionMinConfidence
         FROM users WHERE id = ? LIMIT 1`,
        [userId]
      );
      const pu = prows[0];
      if (!pu) {
        return reply.code(404).send({ error: "user_not_found", message: "Usuário não encontrado." });
      }
      const preferences = rowToUserMemoPreferences(pu);
      const body: PatchMePreferencesResponse = { ok: true, preferences };
      return body;
    } catch (err) {
      if (isUnknownColumnErr(err, "imageOcrVisionMinConfidence")) {
        const [prows2] = await pool.query<RowDataPacket[]>(
          `SELECT soundEnabled, confirmEnabled, allowFreeSpecificFieldsWithoutCategoryMatch,
                  iaUseTexto, iaUseImagem, iaUseVideo, iaUseAudio, iaUseDocumento, iaUseUrl
           FROM users WHERE id = ? LIMIT 1`,
          [userId]
        );
        const pu2 = prows2[0];
        if (!pu2) {
          return reply.code(404).send({ error: "user_not_found", message: "Usuário não encontrado." });
        }
        const preferences: UserMemoPreferences = {
          ...rowToUserMemoPreferences({ ...pu2, imageOcrVisionMinConfidence: null }),
        };
        const body: PatchMePreferencesResponse = { ok: true, preferences };
        return body;
      }
      if (isUnknownColumnErr(err, "confirmEnabled") || isUnknownColumnErr(err, "iaUseTexto")) {
        const [srows] = await pool.query<RowDataPacket[]>("SELECT soundEnabled FROM users WHERE id = ? LIMIT 1", [
          userId,
        ]);
        const su = srows[0];
        if (!su) {
          return reply.code(404).send({ error: "user_not_found", message: "Usuário não encontrado." });
        }
        const preferences: UserMemoPreferences = {
          soundEnabled: su.soundEnabled === 1 || su.soundEnabled === true,
          confirmEnabled: true,
          allowFreeSpecificFieldsWithoutCategoryMatch: false,
          iaUseTexto: "basico",
          iaUseImagem: "basico",
          iaUseVideo: "basico",
          iaUseAudio: "basico",
          iaUseDocumento: "basico",
          iaUseUrl: "basico",
          imageOcrVisionMinConfidence: null,
        };
        const body: PatchMePreferencesResponse = { ok: true, preferences };
        return body;
      }
      throw err;
    }
  });

  app.get("/api/me/workspace-groups", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const groups = await listWorkspaceGroupsForUser(userId, isAdmin);
    const body: WorkspaceGroupsResponse = { groups };
    return body;
  });

  app.patch("/api/me/workspace", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const parsed = patchWorkspaceBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const nextId = parsed.data.groupId;

    if (nextId != null) {
      try {
        await assertUserWorkspaceGroupAccess(userId, nextId, isAdmin);
      } catch {
        return reply.code(403).send({
          error: "forbidden_group",
          message: "Sem acesso a este grupo.",
        });
      }
    }

    try {
      await pool.query("UPDATE users SET lastWorkspaceGroupId = ? WHERE id = ?", [nextId, userId]);
    } catch (err) {
      app.log.warn({ err, userId }, "PATCH workspace: coluna lastWorkspaceGroupId em falta?");
      return reply.code(500).send({
        error: "schema_outdated",
        message: "Execute docs/migrations/004_user_last_workspace_group.sql no banco de dados.",
      });
    }

    const [urows] = await pool.query<RowDataPacket[]>(
      "SELECT role FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    const roleStr = String(urows[0]?.role ?? "user");
    const workspace = await resolveWorkspaceDisplay(userId, roleStr, nextId);

    const body: PatchWorkspaceResponse = {
      ok: true,
      groupLabel: workspace.groupLabel,
      lastWorkspaceGroupId: workspace.lastWorkspaceGroupId,
    };
    return body;
  });
};

export default plugin;
