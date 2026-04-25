import crypto from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, RouteHandlerMethod } from "fastify";
import bcrypt from "bcryptjs";
import type { ResultSetHeader, RowDataPacket } from "../lib/dbTypes.js";
import { z } from "zod";
import { config } from "../config.js";
import { pool } from "../db.js";
import { hashOpaqueToken, newOpaqueToken } from "../lib/authTokens.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../lib/mail.js";
import { listActiveIndividualPlansPublic } from "../services/subscriptionPlanAdminService.js";

const emailIn = z.string().trim().email();
const passwordIn = z.string().min(8, "Senha: no mínimo 8 caracteres.");

const registerBody = z.object({
  email: z.string(),
  password: z.string(),
  name: z.string().min(2, "Nome: mínimo 2 caracteres.").max(120),
  planId: z.coerce.number().int().positive(),
  next: z.string().max(512).optional(),
});

const loginBody = z.object({
  email: z.string(),
  password: z.string(),
});

const forgotBody = z.object({
  email: z.string(),
});

const resetBody = z.object({
  token: z.string().min(16),
  password: passwordIn,
});

const verifyBody = z.object({
  token: z.string().min(16),
});

function normEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** `next` pós-login/cadastro: só caminhos relativos na mesma origem. */
function safeAuthNextParam(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (!t.startsWith("/") || t.startsWith("//")) return undefined;
  if (t.length > 512) return undefined;
  return t;
}

function dbErrText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Resposta única para e-mail já existente (cadastro). */
const EMAIL_TAKEN_REGISTER_MSG =
  "Este e-mail já está cadastrado. Use Entrar se já tem conta; se esqueceu a senha, use Esqueci a senha.";

function isDuplicateKey(err: unknown): boolean {
  const e = err as { code?: string };
  return e.code === "23505";
}

/**
 * Regista também a rota sem o prefixo `/api` (ex.: `/auth/login`).
 * Alguns proxies na AWS reencaminham o pedido já sem `/api`, mas o Fastify só tinha `/api/auth/*`.
 */
function registerApiRouteMirrored(
  app: FastifyInstance,
  method: "get" | "post",
  pathWithApi: string,
  handler: RouteHandlerMethod
) {
  if (!pathWithApi.startsWith("/api/")) {
    throw new Error(`registerApiRouteMirrored: caminho deve começar por /api/: ${pathWithApi}`);
  }
  const withoutApi = pathWithApi.slice(4);
  app[method](pathWithApi, handler);
  app[method](withoutApi, handler);
}

const plugin: FastifyPluginAsync = async (app) => {
  registerApiRouteMirrored(app, "get", "/api/auth/individual-plans", async () => {
    const plans = await listActiveIndividualPlansPublic();
    return { plans };
  });

  registerApiRouteMirrored(app, "post", "/api/auth/register", async (req, reply) => {
    const parsed = registerBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      });
    }

    let email: string;
    try {
      email = normEmail(emailIn.parse(parsed.data.email));
    } catch {
      return reply.code(400).send({ error: "invalid_email", message: "E-mail inválido." });
    }

    let password: string;
    try {
      password = passwordIn.parse(parsed.data.password);
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues[0]?.message : "Senha inválida.";
      return reply.code(400).send({ error: "invalid_password", message: msg });
    }

    const name = parsed.data.name.trim();

    const [existRows] = await pool.query<RowDataPacket[]>(
      "SELECT id, emailVerified FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1",
      [email]
    );
    if (existRows.length && existRows[0].emailVerified) {
      return reply.code(409).send({
        error: "email_taken",
        message: EMAIL_TAKEN_REGISTER_MSG,
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const openId = `pwd:${crypto.randomUUID()}`;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existsTx] = await conn.query<RowDataPacket[]>(
        "SELECT id, emailVerified FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1",
        [email]
      );
      if (existsTx.length && existsTx[0].emailVerified) {
        await conn.rollback();
        return reply.code(409).send({
          error: "email_taken",
          message: EMAIL_TAKEN_REGISTER_MSG,
        });
      }

      if (existsTx.length && !existsTx[0].emailVerified) {
        // Conta existente mas não verificada: atualiza credenciais e reenviar verificação
        const userId = Number(existsTx[0].id);
        await conn.query(
          "UPDATE users SET passwordhash = ?, name = ? WHERE id = ?",
          [passwordHash, name, userId]
        );
        await conn.query(
          "DELETE FROM user_auth_tokens WHERE userid = ? AND purpose = 'verify_email'",
          [userId]
        );
        const { raw, hash: tokenHash } = newOpaqueToken();
        const expiresAt = new Date(Date.now() + 48 * 3600 * 1000);
        await conn.query(
          "INSERT INTO user_auth_tokens (userid, tokenhash, purpose, expiresat) VALUES (?, ?, 'verify_email', ?)",
          [userId, tokenHash, expiresAt]
        );
        await conn.commit();
        const nextAfterVerify = safeAuthNextParam(parsed.data.next);
        let verifyUrl = `${config.publicWebUrl}/verificar-email?token=${encodeURIComponent(raw)}`;
        if (nextAfterVerify) verifyUrl += `&next=${encodeURIComponent(nextAfterVerify)}`;
        try {
          await sendVerificationEmail(email, verifyUrl);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          return reply.code(201).send({
            ok: true,
            message: `Conta criada. Mas o envio do e-mail falhou: ${detail}`,
            emailSendFailed: true,
          });
        }
        return reply.code(201).send({
          ok: true,
          message: "Conta criada. Verifique seu e-mail para ativar o acesso.",
        });
      }

      let userId: number;
      try {
        const [insRows] = await conn.query<{ id: number }[]>(
          `INSERT INTO users (openid, name, email, loginmethod, emailverified, passwordhash)
           VALUES (?, ?, ?, 'password', 0, ?) RETURNING id`,
          [openId, name, email, passwordHash]
        );
        userId = Number(insRows[0]?.id);
      } catch (insErr) {
        await conn.rollback();
        if (isDuplicateKey(insErr)) {
          return reply.code(409).send({
            error: "email_taken",
            message: EMAIL_TAKEN_REGISTER_MSG,
          });
        }
        throw insErr;
      }

      if (!Number.isFinite(userId) || userId < 1) {
        await conn.rollback();
        throw new Error("Falha ao obter ID do usuário.");
      }
      await conn.query(
        "DELETE FROM user_auth_tokens WHERE userId = ? AND purpose = 'verify_email'",
        [userId]
      );
      const { raw, hash } = newOpaqueToken();
      const expiresAt = new Date(Date.now() + 48 * 3600 * 1000);
      await conn.query(
        `INSERT INTO user_auth_tokens (userId, tokenHash, purpose, expiresAt) VALUES (?, ?, 'verify_email', ?)`,
        [userId, hash, expiresAt]
      );

      const [pRows] = await conn.query<RowDataPacket[]>(
        `SELECT id, durationDays FROM subscription_plans
         WHERE id = ? AND planType = 'individual' AND isActive = 1
         LIMIT 1`,
        [parsed.data.planId]
      );
      if (!pRows.length) {
        await conn.rollback();
        return reply.code(400).send({
          error: "invalid_plan",
          message: "Selecione um plano individual válido.",
        });
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

      await conn.query(
        `INSERT INTO subscriptions (type, userId, ownerId, planId, status, endDate)
         VALUES ('individual', ?, ?, ?, 'active', ?)`,
        [userId, userId, parsed.data.planId, endDate]
      );

      await conn.commit();

      const nextAfterVerify = safeAuthNextParam(parsed.data.next);
      let verifyUrl = `${config.publicWebUrl}/verificar-email?token=${encodeURIComponent(raw)}`;
      if (nextAfterVerify) {
        verifyUrl += `&next=${encodeURIComponent(nextAfterVerify)}`;
      }
      try {
        await sendVerificationEmail(email, verifyUrl);
      } catch (err) {
        app.log.error({ err }, "sendVerificationEmail");
        const detail = err instanceof Error ? err.message : String(err);
        return reply.code(201).send({
          ok: true,
          message: `Conta criada, mas o envio do e-mail falhou: ${detail}`,
          emailSendFailed: true,
        });
      }

      return reply.code(201).send({
        ok: true,
        message: "Conta criada. Verifique seu e-mail para ativar o acesso.",
      });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  });

  registerApiRouteMirrored(app, "post", "/api/auth/login", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      });
    }

    let email: string;
    try {
      email = normEmail(emailIn.parse(parsed.data.email));
    } catch {
      return reply.code(400).send({ error: "invalid_email", message: "E-mail inválido." });
    }

    const password = parsed.data.password;

    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, passwordHash, emailVerified, name, email
         FROM users
         WHERE LOWER(TRIM(email)) = ? AND passwordHash IS NOT NULL
         ORDER BY emailVerified DESC, id ASC
         LIMIT 1`,
        [email]
      );
      const row = rows[0];
      let passwordOk = false;
      const hash = row?.passwordHash != null ? String(row.passwordHash) : "";
      if (row && hash.length > 0) {
        try {
          passwordOk = await bcrypt.compare(password, hash);
        } catch (cmpErr) {
          app.log.warn({ cmpErr, userId: row.id }, "bcrypt.compare falhou (passwordHash corrompido na BD?)");
          passwordOk = false;
        }
      }
      if (!row || !passwordOk) {
        return reply.code(401).send({
          error: "invalid_credentials",
          message: "E-mail ou senha incorretos.",
        });
      }

      if (!row.emailVerified) {
        return reply.code(403).send({
          error: "email_not_verified",
          message: "Confirme seu e-mail antes de entrar.",
        });
      }

      const token = await reply.jwtSign(
        { sub: String(row.id) },
        { sign: { expiresIn: "7d" } }
      );

      reply.setCookie("mm_access", token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.cookieSecure,
        maxAge: 7 * 24 * 3600,
      });

      return {
        ok: true,
        user: {
          id: row.id as number,
          name: (row.name as string) ?? null,
          email: (row.email as string) ?? null,
        },
      };
    } catch (e) {
      app.log.error({ err: e }, "POST /api/auth/login");
      const isProd = process.env.NODE_ENV === "production";
      const msg = isProd
        ? "Erro no servidor ao entrar. Confirme que a API e o MySQL estão acessíveis."
        : dbErrText(e);
      return reply.code(500).send({ error: "server_error", message: msg });
    }
  });

  registerApiRouteMirrored(app, "post", "/api/auth/logout", async (_req, reply) => {
    reply.clearCookie("mm_access", { path: "/" });
    return { ok: true };
  });

  registerApiRouteMirrored(app, "post", "/api/auth/verify-email", async (req, reply) => {
    const parsed = verifyBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Token inválido.",
      });
    }

    const hash = hashOpaqueToken(parsed.data.token);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT userId FROM user_auth_tokens
       WHERE tokenHash = ? AND purpose = 'verify_email' AND expiresAt > NOW()
       LIMIT 1`,
      [hash]
    );
    if (!rows.length) {
      return reply.code(400).send({
        error: "invalid_token",
        message: "Link inválido ou expirado.",
      });
    }

    const userId = rows[0].userId as number;
    await pool.query("UPDATE users SET emailVerified = 1 WHERE id = ?", [userId]);
    await pool.query("DELETE FROM user_auth_tokens WHERE tokenHash = ?", [hash]);

    return { ok: true, message: "E-mail confirmado. Você já pode entrar." };
  });

  registerApiRouteMirrored(app, "post", "/api/auth/resend-verification", async (req, reply) => {
    const parsed = z.object({ email: z.string(), next: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: "Dados inválidos." });
    }
    let email: string;
    try {
      email = normEmail(emailIn.parse(parsed.data.email));
    } catch {
      return { ok: true, message: "Se o e-mail existir e não estiver verificado, enviaremos o link de confirmação." };
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, emailVerified FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1",
      [email]
    );
    const row = rows[0];
    if (!row || row.emailVerified) {
      return { ok: true, message: "Se o e-mail existir e não estiver verificado, enviaremos o link de confirmação." };
    }
    const userId = Number(row.id);
    await pool.query(
      "DELETE FROM user_auth_tokens WHERE userid = ? AND purpose = 'verify_email'",
      [userId]
    );
    const { raw, hash } = newOpaqueToken();
    const expiresAt = new Date(Date.now() + 48 * 3600 * 1000);
    await pool.query(
      "INSERT INTO user_auth_tokens (userid, tokenhash, purpose, expiresat) VALUES (?, ?, 'verify_email', ?)",
      [userId, hash, expiresAt]
    );
    const nextAfterVerify = safeAuthNextParam(parsed.data.next);
    let verifyUrl = `${config.publicWebUrl}/verificar-email?token=${encodeURIComponent(raw)}`;
    if (nextAfterVerify) verifyUrl += `&next=${encodeURIComponent(nextAfterVerify)}`;
    try {
      await sendVerificationEmail(email, verifyUrl);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: true, message: `Falha ao enviar e-mail: ${detail}`, emailSendFailed: true };
    }
    return { ok: true, message: "E-mail de confirmação reenviado. Verifique sua caixa de entrada." };
  });

  registerApiRouteMirrored(app, "post", "/api/auth/forgot-password", async (req, reply) => {
    try {
      const parsed = forgotBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_body",
          message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        });
      }

      let email: string;
      try {
        email = normEmail(emailIn.parse(parsed.data.email));
      } catch {
        return { ok: true, message: "Se o e-mail existir em nossa base, enviaremos instruções." };
      }

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, email FROM users
         WHERE LOWER(TRIM(email)) = ?
         ORDER BY emailVerified DESC, id ASC
         LIMIT 1`,
        [email]
      );

      const row = rows[0];
      if (!row) {
        app.log.info({ email }, "forgot-password: e-mail não encontrado no banco (resposta genérica ao cliente)");
        return { ok: true, message: "Se o e-mail existir em nossa base, enviaremos instruções." };
      }

      const userId = Number(row.id);
      if (!Number.isFinite(userId)) {
        throw new Error("ID de usuário inválido no banco.");
      }

      await pool.query(
        "DELETE FROM user_auth_tokens WHERE userId = ? AND purpose = 'reset_password'",
        [userId]
      );
      const { raw, hash } = newOpaqueToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO user_auth_tokens (userId, tokenHash, purpose, expiresAt) VALUES (?, ?, 'reset_password', ?)`,
        [userId, hash, expiresAt]
      );

      const resetUrl = `${config.publicWebUrl}/redefinir-senha?token=${encodeURIComponent(raw)}`;
      try {
        await sendPasswordResetEmail(String(row.email), resetUrl);
      } catch (err) {
        app.log.error({ err }, "sendPasswordResetEmail");
        const detail = err instanceof Error ? err.message : String(err);
        return {
          ok: true,
          message: `Encontramos a conta, mas o envio do e-mail falhou: ${detail}`,
          emailSendFailed: true,
        };
      }

      app.log.info({ to: row.email }, "forgot-password: e-mail de redefinição enviado");
      return { ok: true, message: "Se o e-mail existir em nossa base, enviaremos instruções." };
    } catch (err) {
      app.log.error({ err }, "forgot-password");
      return reply.code(500).send({
        error: "internal",
        message: dbErrText(err),
        hint:
          "Causa frequente: tabela user_auth_tokens em falta. Na base mymemory execute docs/migrations/003_user_auth_tokens.sql",
      });
    }
  });

  registerApiRouteMirrored(app, "post", "/api/auth/reset-password", async (req, reply) => {
    const parsed = resetBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      });
    }

    const hash = hashOpaqueToken(parsed.data.token);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT userId FROM user_auth_tokens
       WHERE tokenHash = ? AND purpose = 'reset_password' AND expiresAt > NOW()
       LIMIT 1`,
      [hash]
    );
    if (!rows.length) {
      return reply.code(400).send({
        error: "invalid_token",
        message: "Link inválido ou expirado.",
      });
    }

    const userId = rows[0].userId as number;
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    await pool.query("UPDATE users SET passwordHash = ?, emailVerified = 1 WHERE id = ?", [
      passwordHash,
      userId,
    ]);
    await pool.query("DELETE FROM user_auth_tokens WHERE tokenHash = ?", [hash]);

    return { ok: true, message: "Senha atualizada. Você já pode entrar." };
  });
};

export default plugin;
