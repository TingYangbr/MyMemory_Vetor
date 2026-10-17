import "@fastify/jwt";
import type { FastifyRequest } from "fastify";
import type { RowDataPacket } from "./dbTypes.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import { resolveApiKey } from "../services/groupApiKeysService.js";

/**
 * Resolve o usuário da requisição: JWT (cookie mm_access), header X-User-Id (dev), ou fallback dev.
 * Retorna `null` quando não autenticado e sem fallback.
 *
 * NÃO aceita autenticação por API key (group_api_keys) — de propósito. Isso é usado por
 * `requireAdmin` e por toda rota do app; uma key de integração nunca deve alcançar rotas de
 * admin só porque o userId por trás dela tem role admin. Rotas que precisam aceitar API key
 * (hoje: /api/perguntas) devem chamar `resolveUserIdForIntegration` em vez desta função.
 */
export async function resolveUserId(req: FastifyRequest): Promise<number | null> {
  try {
    await req.jwtVerify({ onlyCookie: true });
    const u = req.user as { sub?: string };
    const sub = u?.sub;
    if (typeof sub === "string" && /^\d+$/.test(sub)) return Number(sub);
  } catch {
    /* sem cookie JWT válido */
  }

  if (config.allowDevUserHeader) {
    const h = req.headers["x-user-id"];
    if (typeof h === "string" && /^\d+$/.test(h)) return Number(h);
  }

  if (config.useDevUserFallback) return config.devUserId;
  return null;
}

/** Resultado da autenticação de uma rota que aceita integração (API key) além do login normal. */
export interface IntegrationAuth {
  userId: number;
  /**
   * Grupo ao qual a API key está presa. Preenchido SÓ quando a requisição veio por key; `null` no
   * login normal (cookie/dev). Quando não é `null`, é a única fonte do grupo da requisição.
   */
  apiKeyGroupId: number | null;
}

/**
 * Como `resolveUserId`, mas também aceita o header `X-MyMemory-Key` (autenticação
 * servidor-a-servidor de integrações, ex.: Softing-erp). Uso restrito às rotas que
 * explicitamente precisam disso — NUNCA usar em `requireAdmin` ou em rotas administrativas.
 *
 * Devolve também o grupo da key, para a rota impedir que o corpo da requisição escolha outro.
 */
export async function resolveIntegrationAuth(req: FastifyRequest): Promise<IntegrationAuth | null> {
  const apiKeyHeader = req.headers["x-mymemory-key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) {
    // Header explícito de integração: resolve só por ele, nunca cai pro cookie/fallback dev —
    // uma key inválida não deve autenticar por acidente via outro caminho.
    const key = await resolveApiKey(apiKeyHeader.trim());
    return key ? { userId: key.userId, apiKeyGroupId: key.groupId } : null;
  }
  const userId = await resolveUserId(req);
  return userId === null ? null : { userId, apiKeyGroupId: null };
}

/** Versão que só devolve o usuário, para rotas que não dependem do grupo (ex.: transcrição de áudio). */
export async function resolveUserIdForIntegration(req: FastifyRequest): Promise<number | null> {
  return (await resolveIntegrationAuth(req))?.userId ?? null;
}

export async function getUserIsAdmin(userId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT role FROM users WHERE id = ? LIMIT 1", [userId]);
  return rows[0]?.role === "admin";
}
