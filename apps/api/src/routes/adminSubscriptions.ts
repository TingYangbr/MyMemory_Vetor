import type { FastifyPluginAsync } from "fastify";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { requireAdmin } from "../lib/adminContext.js";
import { pool } from "../db.js";

export interface SubscriptionAdminRow {
  subscriptionId: number;
  type: "individual" | "group";
  status: "active" | "expired" | "canceled";
  planName: string;
  planPrice: number;
  startDate: string;
  endDate: string | null;
  /** Proprietário da assinatura */
  ownerId: number;
  ownerName: string | null;
  ownerEmail: string | null;
  /** Grupo (apenas quando type === "group") */
  groupId: number | null;
  groupName: string | null;
  groupAccessCode: string | null;
  memberCount: number;
  memoCount: number;
  /** Custo acumulado de API em USD (api_usage_logs) */
  apiCostUsd: number;
}

export interface SubscriptionsAdminResponse {
  rows: SubscriptionAdminRow[];
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/subscriptions", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;

    const q = req.query as Record<string, string | undefined>;
    const filterType = q.type === "individual" || q.type === "group" ? q.type : null;
    const filterStatus = ["active", "expired", "canceled"].includes(q.status ?? "") ? q.status! : null;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filterType) { conditions.push("s.type = ?"); params.push(filterType); }
    if (filterStatus) { conditions.push("s.status = ?"); params.push(filterStatus); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
         s.id                  AS subscriptionId,
         s.type,
         s.status,
         p.name                AS planName,
         p.price               AS planPrice,
         s.startdate           AS startDate,
         s.enddate             AS endDate,
         u.id                  AS ownerId,
         u.name                AS ownerName,
         u.email               AS ownerEmail,
         g.id                  AS groupId,
         g.name                AS groupName,
         g.accesscode          AS groupAccessCode,
         COALESCE(mc.cnt, 0)   AS memberCount,
         COALESCE(mm.cnt, 0)   AS memoCount,
         COALESCE(ac.total, 0) AS apiCostUsd
       FROM subscriptions s
       INNER JOIN subscription_plans p ON p.id = s.planid
       INNER JOIN users u ON u.id = s.ownerid
       LEFT JOIN groups g ON g.subscriptionid = s.id
       LEFT JOIN (
         SELECT groupid, COUNT(*) AS cnt FROM group_members GROUP BY groupid
       ) mc ON mc.groupid = g.id
       LEFT JOIN (
         SELECT groupid, COUNT(*) AS cnt FROM memos WHERE isactive = 1 GROUP BY groupid
       ) mm ON mm.groupid = g.id
       LEFT JOIN (
         SELECT l.userid, m.groupid, SUM(l.costusd) AS total
         FROM api_usage_logs l
         LEFT JOIN memos m ON m.id = l.memoid
         GROUP BY l.userid, m.groupid
       ) ac ON ac.userid = s.ownerid AND (
         (s.type = 'group'      AND ac.groupid = g.id) OR
         (s.type = 'individual' AND ac.groupid IS NULL)
       )
       ${where}
       ORDER BY s.status ASC, s.startdate DESC`,
      params
    );

    const result: SubscriptionAdminRow[] = rows.map((r) => ({
      subscriptionId: Number(r.subscriptionId),
      type: r.type as "individual" | "group",
      status: r.status as "active" | "expired" | "canceled",
      planName: String(r.planName ?? ""),
      planPrice: Number(r.planPrice) || 0,
      startDate: r.startDate instanceof Date ? r.startDate.toISOString() : String(r.startDate ?? ""),
      endDate: r.endDate ? (r.endDate instanceof Date ? r.endDate.toISOString() : String(r.endDate)) : null,
      ownerId: Number(r.ownerId),
      ownerName: r.ownerName != null ? String(r.ownerName) : null,
      ownerEmail: r.ownerEmail != null ? String(r.ownerEmail) : null,
      groupId: r.groupId != null ? Number(r.groupId) : null,
      groupName: r.groupName != null ? String(r.groupName) : null,
      groupAccessCode: r.groupAccessCode != null ? String(r.groupAccessCode) : null,
      memberCount: Number(r.memberCount) || 0,
      memoCount: Number(r.memoCount) || 0,
      apiCostUsd: Number(r.apiCostUsd) || 0,
    }));

    return { rows: result } satisfies SubscriptionsAdminResponse;
  });

  app.get("/api/admin/subscriptions/:subscriptionId/members", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;

    const subscriptionId = Number((req.params as { subscriptionId: string }).subscriptionId);
    if (!Number.isFinite(subscriptionId) || subscriptionId <= 0) {
      return reply.code(400).send({ error: "invalid_id" });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
         u.id                  AS ownerId,
         u.name                AS ownerName,
         u.email               AS ownerEmail,
         gm.joinedat,
         COALESCE(mm.cnt, 0)   AS memoCount,
         COALESCE(ac.total, 0) AS apiCostUsd
       FROM subscriptions s
       INNER JOIN groups g ON g.subscriptionid = s.id
       INNER JOIN group_members gm ON gm.groupid = g.id
       INNER JOIN users u ON u.id = gm.userid
       LEFT JOIN (
         SELECT userid, groupid, COUNT(*) AS cnt
         FROM memos
         WHERE isactive = 1
         GROUP BY userid, groupid
       ) mm ON mm.userid = u.id AND mm.groupid = g.id
       LEFT JOIN (
         SELECT l.userid, m.groupid, SUM(l.costusd) AS total
         FROM api_usage_logs l
         LEFT JOIN memos m ON m.id = l.memoid
         GROUP BY l.userid, m.groupid
       ) ac ON ac.userid = u.id AND ac.groupid = g.id
       WHERE s.id = ? AND s.type = 'group'
       ORDER BY u.name`,
      [subscriptionId]
    );

    const members = rows.map((r) => ({
      userId: Number(r.ownerId),
      userName: r.ownerName != null ? String(r.ownerName) : null,
      userEmail: r.ownerEmail != null ? String(r.ownerEmail) : null,
      joinedAt: r.joinedAt instanceof Date ? r.joinedAt.toISOString() : String(r.joinedAt ?? ""),
      memoCount: Number(r.memoCount) || 0,
      apiCostUsd: Number(r.apiCostUsd) || 0,
    }));

    return { members };
  });
};

export default plugin;
