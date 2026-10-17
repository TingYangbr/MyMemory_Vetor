import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveUserId } from "./userContext.js";
import { pool } from "../db.js";
import type { RowDataPacket } from "./dbTypes.js";

/**
 * Autoriza admin do sistema OU dono do grupo (dono da assinatura de grupo ativa, ou membro com
 * papel owner) — o mesmo critério das telas de Conexões BD. Responde 401/403 e devolve null se não passar.
 */
export async function assertOwnerOrAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
  groupId: number
): Promise<{ userId: number; isAdmin: boolean } | null> {
  const userId = await resolveUserId(req);
  if (!userId) {
    void reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  const [userRows] = await pool.query<RowDataPacket[]>("SELECT role FROM users WHERE id = ? LIMIT 1", [userId]);
  if (userRows[0]?.role === "admin") return { userId, isAdmin: true };

  const [ownerRows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM groups g
     WHERE g.id = ?
     AND (
       EXISTS (SELECT 1 FROM subscriptions s WHERE s.id = g.subscriptionid AND s.ownerid = ? AND s.type = 'group' AND s.status = 'active')
       OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.groupid = g.id AND gm.userid = ? AND gm.role = 'owner')
     )
     LIMIT 1`,
    [groupId, userId, userId]
  );
  if (!ownerRows[0]) {
    void reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return { userId, isAdmin: false };
}
