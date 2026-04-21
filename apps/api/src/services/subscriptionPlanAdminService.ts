import type { ResultSetHeader, RowDataPacket } from "../lib/dbTypes.js";
import type {
  IndividualPlanOption,
  SubscriptionPlanAdmin,
  SubscriptionPlanTypeDb,
} from "@mymemory/shared";
import { pool } from "../db.js";

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function ts(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? "");
}

export function mapSubscriptionPlanRow(r: RowDataPacket): SubscriptionPlanAdmin {
  const pt = r.planType === "group" ? "group" : "individual";
  return {
    id: Number(r.id),
    name: String(r.name),
    planType: pt as SubscriptionPlanTypeDb,
    price: num(r.price),
    maxMemos: Number(r.maxMemos) || 0,
    maxStorageGB: num(r.maxStorageGB),
    maxMembers: intOrNull(r.maxMembers),
    durationDays: intOrNull(r.durationDays),
    isActive: r.isActive === 1 || r.isActive === true ? 1 : 0,
    monthlyApiCredits: numOrNull(r.monthlyApiCredits),
    monthlyDownloadLimitGB: numOrNull(r.monthlyDownloadLimitGB),
    supportLargeAudio: r.supportLargeAudio === 1 || r.supportLargeAudio === true ? 1 : 0,
    supportLargeVideo: r.supportLargeVideo === 1 || r.supportLargeVideo === true ? 1 : 0,
    createdAt: ts(r.createdAt),
    updatedAt: ts(r.updatedAt),
  };
}

/** Planos `individual` ativos — cadastro público. */
export async function listActiveIndividualPlansPublic(): Promise<IndividualPlanOption[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, price, maxMemos, maxStorageGB, maxMembers, durationDays
     FROM subscription_plans
     WHERE planType = 'individual' AND isActive = 1
     ORDER BY price ASC, id ASC`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    price: num(r.price),
    maxMemos: Number(r.maxMemos) || 0,
    maxStorageGB: num(r.maxStorageGB),
    maxMembers: intOrNull(r.maxMembers),
    durationDays: intOrNull(r.durationDays),
  }));
}

/** Planos `group` ativos — escolha antes de criar grupo (sem Stripe por enquanto). */
export async function listActiveGroupPlansPublic(): Promise<IndividualPlanOption[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, price, maxMemos, maxStorageGB, maxMembers, durationDays
     FROM subscription_plans
     WHERE planType = 'group' AND isActive = 1
     ORDER BY price ASC, id ASC`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    price: num(r.price),
    maxMemos: Number(r.maxMemos) || 0,
    maxStorageGB: num(r.maxStorageGB),
    maxMembers: intOrNull(r.maxMembers),
    durationDays: intOrNull(r.durationDays),
  }));
}

export async function listSubscriptionPlansAdmin(): Promise<SubscriptionPlanAdmin[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, planType, price, maxMemos, maxStorageGB, maxMembers, durationDays, isActive,
            monthlyApiCredits, monthlyDownloadLimitGB, supportLargeAudio, supportLargeVideo,
            createdAt, updatedAt
     FROM subscription_plans ORDER BY id ASC`
  );
  const plans = rows.map(mapSubscriptionPlanRow);
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT planId,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeCnt,
            COUNT(*) AS totalCnt
     FROM subscriptions
     GROUP BY planId`
  );
  const byPlan = new Map<number, { active: number; total: number }>();
  for (const r of countRows) {
    byPlan.set(Number(r.planId), {
      active: Number(r.activeCnt) || 0,
      total: Number(r.totalCnt) || 0,
    });
  }
  return plans.map((p) => {
    const c = byPlan.get(p.id);
    return {
      ...p,
      activeSubscriptionCount: c?.active ?? 0,
      totalSubscriptionCount: c?.total ?? 0,
    };
  });
}

export async function deleteSubscriptionPlanAdmin(id: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeCnt,
       COUNT(*) AS totalCnt
     FROM subscriptions WHERE planId = ?`,
    [id]
  );
  const activeCnt = Number(rows[0]?.activeCnt) || 0;
  const totalCnt = Number(rows[0]?.totalCnt) || 0;
  if (activeCnt > 0) {
    throw new Error("plan_has_active_subscriptions");
  }
  if (totalCnt > 0) {
    throw new Error("plan_has_subscriptions");
  }
  const [res] = await pool.query<ResultSetHeader>("DELETE FROM subscription_plans WHERE id = ?", [id]);
  if (!res.affectedRows) {
    throw new Error("plan_not_found");
  }
}

export type SubscriptionPlanPatchInput = Partial<{
  name: string;
  planType: SubscriptionPlanTypeDb;
  price: number;
  maxMemos: number;
  maxStorageGB: number;
  maxMembers: number | null;
  durationDays: number | null;
  isActive: number;
  monthlyApiCredits: number | null;
  monthlyDownloadLimitGB: number | null;
  supportLargeAudio: number;
  supportLargeVideo: number;
}>;

export async function updateSubscriptionPlanAdmin(id: number, patch: SubscriptionPlanPatchInput): Promise<void> {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name);
  }
  if (patch.planType !== undefined) {
    sets.push("planType = ?");
    vals.push(patch.planType);
  }
  if (patch.price !== undefined) {
    sets.push("price = ?");
    vals.push(patch.price);
  }
  if (patch.maxMemos !== undefined) {
    sets.push("maxMemos = ?");
    vals.push(patch.maxMemos);
  }
  if (patch.maxStorageGB !== undefined) {
    sets.push("maxStorageGB = ?");
    vals.push(patch.maxStorageGB);
  }
  if (patch.maxMembers !== undefined) {
    sets.push("maxMembers = ?");
    vals.push(patch.maxMembers);
  }
  if (patch.durationDays !== undefined) {
    sets.push("durationDays = ?");
    vals.push(patch.durationDays);
  }
  if (patch.isActive !== undefined) {
    sets.push("isActive = ?");
    vals.push(patch.isActive);
  }
  if (patch.monthlyApiCredits !== undefined) {
    sets.push("monthlyApiCredits = ?");
    vals.push(patch.monthlyApiCredits);
  }
  if (patch.monthlyDownloadLimitGB !== undefined) {
    sets.push("monthlyDownloadLimitGB = ?");
    vals.push(patch.monthlyDownloadLimitGB);
  }
  if (patch.supportLargeAudio !== undefined) {
    sets.push("supportLargeAudio = ?");
    vals.push(patch.supportLargeAudio);
  }
  if (patch.supportLargeVideo !== undefined) {
    sets.push("supportLargeVideo = ?");
    vals.push(patch.supportLargeVideo);
  }

  if (!sets.length) return;

  vals.push(id);
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE subscription_plans SET ${sets.join(", ")} WHERE id = ?`,
    vals
  );
  if (!res.affectedRows) {
    throw new Error("plan_not_found");
  }
}

export type SubscriptionPlanCreateInput = {
  name: string;
  planType: SubscriptionPlanTypeDb;
  price: number;
  maxMemos: number;
  maxStorageGB: number;
  maxMembers: number | null;
  durationDays: number | null;
  isActive: number;
  monthlyApiCredits: number | null;
  monthlyDownloadLimitGB: number | null;
  supportLargeAudio: number;
  supportLargeVideo: number;
};

export async function createSubscriptionPlanAdmin(input: SubscriptionPlanCreateInput): Promise<number> {
  const [rows] = await pool.query<{ id: number }[]>(
    `INSERT INTO subscription_plans (
      name, plantype, price, maxmemos, maxstoragegb, maxmembers, durationdays, isactive,
      monthlyapicredits, monthlydownloadlimitgb, supportlargeaudio, supportlargevideo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      input.name,
      input.planType,
      input.price,
      input.maxMemos,
      input.maxStorageGB,
      input.maxMembers,
      input.durationDays,
      input.isActive,
      input.monthlyApiCredits,
      input.monthlyDownloadLimitGB,
      input.supportLargeAudio,
      input.supportLargeVideo,
    ]
  );
  return rows[0].id;
}
