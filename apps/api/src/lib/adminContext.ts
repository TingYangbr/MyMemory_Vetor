import type { FastifyReply, FastifyRequest } from "fastify";
import type { RowDataPacket } from "./dbTypes.js";
import { pool } from "../db.js";
import { resolveUserId } from "./userContext.js";

/** Retorna `userId` se autenticado e `role = admin`; caso contrário envia 401/403 e devolve `null`. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<number | null> {
  const uid = await resolveUserId(req);
  if (uid === null) {
    void reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    return null;
  }
  const [rows] = await pool.query<RowDataPacket[]>("SELECT role FROM users WHERE id = ? LIMIT 1", [uid]);
  if (rows[0]?.role !== "admin") {
    void reply.code(403).send({ error: "forbidden", message: "Apenas administradores." });
    return null;
  }
  return uid;
}
