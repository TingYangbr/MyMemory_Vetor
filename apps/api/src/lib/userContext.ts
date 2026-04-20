import "@fastify/jwt";
import type { FastifyRequest } from "fastify";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { pool } from "../db.js";

/**
 * Resolve o usuário da requisição: JWT (cookie mm_access), header X-User-Id (dev), ou fallback dev.
 * Retorna `null` quando não autenticado e sem fallback.
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

export async function getUserIsAdmin(userId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT role FROM users WHERE id = ? LIMIT 1", [userId]);
  return rows[0]?.role === "admin";
}
