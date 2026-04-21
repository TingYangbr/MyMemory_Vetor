import type { RowDataPacket } from "../lib/dbTypes.js";
import type {
  AdminCostReportDetailApiRow,
  AdminCostReportDetailDownloadRow,
  AdminCostReportMediaFilter,
  AdminCostReportPlanRow,
  AdminCostReportResponse,
  AdminCostReportSegmentRow,
  AdminCostReportTotals,
  MemoMediaTypeDb,
} from "@mymemory/shared";
import { pool } from "../db.js";
import { creditsFromUsdCost, getUsdToCreditsMultiplier } from "./systemConfigService.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEDIA: readonly MemoMediaTypeDb[] = ["text", "audio", "image", "video", "document", "url"];

function isValidDateYmd(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T12:00:00`);
  return !Number.isNaN(d.getTime());
}

function toDownloadMsStart(dateYmd: string): number {
  return new Date(`${dateYmd}T00:00:00.000`).getTime();
}

function toDownloadMsEnd(dateYmd: string): number {
  return new Date(`${dateYmd}T23:59:59.999`).getTime();
}

function sqlRangeStart(dateYmd: string): string {
  return `${dateYmd} 00:00:00`;
}

function sqlRangeEnd(dateYmd: string): string {
  return `${dateYmd} 23:59:59`;
}

function parseMediaFilter(raw: string | undefined): AdminCostReportMediaFilter {
  const t = (raw ?? "all").trim().toLowerCase();
  if (t === "all") return "all";
  if ((MEDIA as readonly string[]).includes(t)) return t as MemoMediaTypeDb;
  return "all";
}

/** Plano individual ativo do usuario (Basico / Premium, etc.). Sem fallback para plano de grupo. */
async function loadIndividualPlanNameByUser(userIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!userIds.length) return map;
  const uniq = [...new Set(userIds)].filter((n) => Number.isFinite(n) && n > 0);
  if (!uniq.length) return map;
  const ph = uniq.map(() => "?").join(",");

  const [indRows] = await pool.query<RowDataPacket[]>(
    `SELECT s.userId, p.name AS planName, s.id AS sid
     FROM subscriptions s
     INNER JOIN subscription_plans p ON p.id = s.planId
     WHERE s.type = 'individual' AND s.userId = s.ownerId AND s.status = 'active' AND s.userId IN (${ph})
     ORDER BY s.id DESC`,
    uniq
  );
  for (const r of indRows) {
    const uid = Number(r.userId);
    if (!map.has(uid)) map.set(uid, String(r.planName ?? "Plano"));
  }

  for (const id of uniq) {
    if (!map.has(id)) map.set(id, "Sem plano individual");
  }
  return map;
}

/** Nome do plano ligado à subscrição do grupo (Familiar / Corporativo, etc.). */
/** Soma de `price` por `name` em `subscription_plans` (várias linhas com o mesmo nome, se existirem). */
async function loadSubscriptionPlanPriceSumByName(): Promise<Map<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT name, SUM(price) AS priceSum FROM subscription_plans GROUP BY name`
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(String(r.name), Number(r.priceSum) || 0);
  }
  return map;
}

async function loadGroupPlanNameByGroupId(groupIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!groupIds.length) return map;
  const uniq = [...new Set(groupIds)].filter((n) => Number.isFinite(n) && n > 0);
  if (!uniq.length) return map;
  const ph = uniq.map(() => "?").join(",");

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT g.id AS groupId, p.name AS planName
     FROM groups g
     INNER JOIN subscriptions s ON s.id = g.subscriptionId AND s.status = 'active' AND s.type = 'group'
     INNER JOIN subscription_plans p ON p.id = s.planId
     WHERE g.id IN (${ph})`,
    uniq
  );
  for (const r of rows) {
    map.set(Number(r.groupId), String(r.planName ?? "Plano grupo"));
  }
  for (const id of uniq) {
    if (!map.has(id)) map.set(id, "Sem plano de grupo");
  }
  return map;
}

function collectGroupIdsFromWsRows(rows: { ws: string }[]): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const ws = String(r.ws);
    if (!ws.startsWith("g:")) continue;
    const id = Number(ws.slice(2));
    if (Number.isFinite(id)) out.push(id);
  }
  return out;
}

/** 1ª coluna do relatório: memo com grupo → plano do grupo; senão → plano individual do usuario. */
function planNameForWorkspace(
  ws: string,
  userId: number,
  individualByUser: Map<number, string>,
  groupByGroupId: Map<number, string>
): string {
  if (ws.startsWith("g:")) {
    const gid = Number(ws.slice(2));
    if (!Number.isFinite(gid)) return "Sem plano de grupo";
    return groupByGroupId.get(gid) ?? "Sem plano de grupo";
  }
  return individualByUser.get(userId) ?? "Sem plano individual";
}

async function loadUserLabels(userIds: number[]): Promise<Map<number, { email: string | null; name: string | null }>> {
  const map = new Map<number, { email: string | null; name: string | null }>();
  if (!userIds.length) return map;
  const uniq = [...new Set(userIds)];
  const ph = uniq.map(() => "?").join(",");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, email, name FROM users WHERE id IN (${ph})`,
    uniq
  );
  for (const r of rows) {
    map.set(Number(r.id), {
      email: r.email != null ? String(r.email) : null,
      name: r.name != null ? String(r.name) : null,
    });
  }
  return map;
}

const SEG_GROUP = "GROUP";
const SEG_USER = "USER";

/** Chave estável: `GROUP|USER` + plano + id (nome do plano não deve conter TAB). */
function segmentMapKey(planName: string, ws: string, userId: number): string {
  if (ws.startsWith("g:")) {
    const gid = Number(ws.slice(2));
    return `${SEG_GROUP}\t${planName}\t${Number.isFinite(gid) ? gid : 0}`;
  }
  return `${SEG_USER}\t${planName}\t${userId}`;
}

function parseSegmentMapKey(key: string): { planName: string; kind: "group" | "user"; entityId: number } {
  const lastTab = key.lastIndexOf("\t");
  const prevTab = key.lastIndexOf("\t", lastTab - 1);
  const kindMark = key.slice(0, prevTab);
  const planName = key.slice(prevTab + 1, lastTab);
  const entityId = Number(key.slice(lastTab + 1));
  return {
    kind: kindMark === SEG_GROUP ? "group" : "user",
    planName,
    entityId: Number.isFinite(entityId) ? entityId : 0,
  };
}

async function loadGroupMetaForCostReport(
  groupIds: number[]
): Promise<Map<number, { name: string; accessCode: string | null }>> {
  const map = new Map<number, { name: string; accessCode: string | null }>();
  if (!groupIds.length) return map;
  const uniq = [...new Set(groupIds)].filter((n) => Number.isFinite(n) && n > 0);
  if (!uniq.length) return map;
  const ph = uniq.map(() => "?").join(",");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, accessCode FROM groups WHERE id IN (${ph})`,
    uniq
  );
  for (const r of rows) {
    map.set(Number(r.id), {
      name: String(r.name ?? ""),
      accessCode: r.accessCode != null ? String(r.accessCode) : null,
    });
  }
  return map;
}

function buildGroupSegmentLabel(
  groupId: number,
  meta: { name: string; accessCode: string | null } | undefined
): string {
  const name = meta?.name?.trim() || "—";
  const parts: string[] = [`Grupo "${name}"`, `groupId ${groupId}`];
  const code = meta?.accessCode?.trim();
  if (code) parts.push(`código acesso ${code}`);
  return parts.join(" · ");
}

function buildUserSegmentLabel(
  userId: number,
  ul: { name: string | null; email: string | null } | undefined
): string {
  const parts: string[] = [];
  const nm = ul?.name?.trim();
  const em = ul?.email?.trim();
  if (nm) parts.push(nm);
  if (em) parts.push(em);
  parts.push(`userId ${userId}`);
  return parts.join(" · ");
}

interface ApiAggRow extends RowDataPacket {
  userId: number;
  ws: string;
  apiCostUsd: number;
}

interface DlAggRow extends RowDataPacket {
  userId: number;
  ws: string;
  dlCostUsd: number;
  dlCred: number;
}

type Bucket = { apiUsd: number; dlUsd: number; dlCred: number };

function addBucket(m: Map<string, Bucket>, key: string, part: Partial<Bucket>): void {
  const b = m.get(key) ?? { apiUsd: 0, dlUsd: 0, dlCred: 0 };
  if (part.apiUsd != null) b.apiUsd += part.apiUsd;
  if (part.dlUsd != null) b.dlUsd += part.dlUsd;
  if (part.dlCred != null) b.dlCred += part.dlCred;
  m.set(key, b);
}

export async function buildAdminCostReport(input: {
  dateFrom: string;
  dateTo: string;
  mediaType: string | undefined;
}): Promise<AdminCostReportResponse> {
  const df = input.dateFrom.trim();
  const dt = input.dateTo.trim();
  if (!isValidDateYmd(df) || !isValidDateYmd(dt)) {
    throw new Error("invalid_dates");
  }
  if (df > dt) {
    throw new Error("date_order");
  }

  const media = parseMediaFilter(input.mediaType);
  const [mult, priceSumByPlanName] = await Promise.all([
    getUsdToCreditsMultiplier(),
    loadSubscriptionPlanPriceSumByName(),
  ]);

  const sqlStart = sqlRangeStart(df);
  const sqlEnd = sqlRangeEnd(dt);
  const msStart = toDownloadMsStart(df);
  const msEnd = toDownloadMsEnd(dt);

  const apiMediaSql = media === "all" ? "1=1" : "(l.memoId IS NOT NULL AND m.mediaType = ?)";
  const dlMediaSql = media === "all" ? "1=1" : "(d.memoId IS NOT NULL AND m.mediaType = ?)";
  const apiMediaParams = media === "all" ? [] : [media];
  const dlMediaParams = media === "all" ? [] : [media];

  const [apiAgg] = await pool.query<ApiAggRow[]>(
    `SELECT l.userId,
            CASE
              WHEN l.memoId IS NULL THEN 'sem_memo'
              WHEN m.id IS NULL THEN 'memo_orf'
              WHEN m.groupId IS NULL THEN 'pessoal'
              ELSE CONCAT('g:', m.groupId)
            END AS ws,
            SUM(l.costUsd) AS apiCostUsd
     FROM api_usage_logs l
     LEFT JOIN memos m ON m.id = l.memoId
     WHERE l.createdAt >= ? AND l.createdAt <= ?
       AND (${apiMediaSql})
     GROUP BY l.userId, ws`,
    [sqlStart, sqlEnd, ...apiMediaParams]
  );

  /* Créditos de download: soma de usedCred gravado em cada linha (fator na data do download — ver downloadLogService + migração 022).
     Contexto de grupo: alinhar a api_usage_logs — usa memo.groupId quando download_logs.groupId veio NULL ou inconsistente. */
  const [dlAgg] = await pool.query<DlAggRow[]>(
    `SELECT d.userId,
            CASE
              WHEN d.memoId IS NULL THEN
                CASE WHEN d.groupId IS NULL THEN 'sem_memo' ELSE CONCAT('g:', d.groupId) END
              WHEN m.id IS NULL THEN
                CASE WHEN d.groupId IS NULL THEN 'memo_orf' ELSE CONCAT('g:', d.groupId) END
              WHEN COALESCE(d.groupId, m.groupId) IS NULL THEN 'pessoal'
              ELSE CONCAT('g:', COALESCE(d.groupId, m.groupId))
            END AS ws,
            SUM(COALESCE(d.costUsd, 0)) AS dlCostUsd,
            SUM(COALESCE(d.usedCred, 0)) AS dlCred
     FROM download_logs d
     LEFT JOIN memos m ON m.id = d.memoId
     WHERE d.downloadedAt >= ? AND d.downloadedAt <= ?
       AND (${dlMediaSql})
     GROUP BY d.userId, ws`,
    [msStart, msEnd, ...dlMediaParams]
  );

  const userSet = new Set<number>();
  for (const r of apiAgg) userSet.add(Number(r.userId));
  for (const r of dlAgg) userSet.add(Number(r.userId));
  const userIds = [...userSet];
  const groupIdsForPlans = [
    ...new Set([...collectGroupIdsFromWsRows(apiAgg), ...collectGroupIdsFromWsRows(dlAgg)]),
  ];

  const [individualPlanByUser, userLabels, groupPlanById] = await Promise.all([
    loadIndividualPlanNameByUser(userIds),
    loadUserLabels(userIds),
    loadGroupPlanNameByGroupId(groupIdsForPlans),
  ]);

  /** plan|ws|userId */
  const leaf = new Map<string, Bucket>();

  for (const r of apiAgg) {
    const uid = Number(r.userId);
    const ws = String(r.ws);
    const plan = planNameForWorkspace(ws, uid, individualPlanByUser, groupPlanById);
    const cost = Number(r.apiCostUsd) || 0;
    addBucket(leaf, `${plan}\t${ws}\t${uid}`, { apiUsd: cost });
  }
  for (const r of dlAgg) {
    const uid = Number(r.userId);
    const ws = String(r.ws);
    const plan = planNameForWorkspace(ws, uid, individualPlanByUser, groupPlanById);
    const c = Number(r.dlCostUsd) || 0;
    const cr = Number(r.dlCred) || 0;
    addBucket(leaf, `${plan}\t${ws}\t${uid}`, { dlUsd: c, dlCred: cr });
  }

  const segMap = new Map<string, Bucket>();
  for (const [key, b] of leaf) {
    const [planName, ws, uidStr] = key.split("\t");
    const uid = Number(uidStr);
    const sk = segmentMapKey(planName, ws, uid);
    addBucket(segMap, sk, { apiUsd: b.apiUsd, dlUsd: b.dlUsd, dlCred: b.dlCred });
  }

  const segmentGroupIds = [
    ...new Set(
      [...segMap.keys()]
        .map((k) => parseSegmentMapKey(k))
        .filter((p) => p.kind === "group")
        .map((p) => p.entityId)
    ),
  ];
  const groupMetaById = await loadGroupMetaForCostReport(segmentGroupIds);

  const plansMap = new Map<string, AdminCostReportPlanRow>();

  for (const [sk, b] of segMap) {
    const { planName, kind, entityId } = parseSegmentMapKey(sk);
    const apiCred = creditsFromUsdCost(b.apiUsd, mult);
    const credIa = apiCred + b.dlCred;

    let plan = plansMap.get(planName);
    if (!plan) {
      const rawPrice = priceSumByPlanName.get(planName);
      plan = {
        planName,
        apiCostUsd: 0,
        credIa: 0,
        downloadCostUsd: 0,
        planPriceSum: rawPrice !== undefined ? rawPrice : null,
        segments: [],
      };
      plansMap.set(planName, plan);
    }
    plan.apiCostUsd += b.apiUsd;
    plan.credIa += credIa;
    plan.downloadCostUsd += b.dlUsd;

    const label =
      kind === "group"
        ? buildGroupSegmentLabel(entityId, groupMetaById.get(entityId))
        : buildUserSegmentLabel(entityId, userLabels.get(entityId));

    const seg: AdminCostReportSegmentRow = {
      kind,
      entityId,
      label,
      apiCostUsd: b.apiUsd,
      credIa,
      downloadCostUsd: b.dlUsd,
      planPriceSum: plan.planPriceSum,
    };
    plan.segments.push(seg);
  }

  for (const p of plansMap.values()) {
    p.segments.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "group" ? -1 : 1;
      return a.label.localeCompare(b.label, "pt-BR");
    });
  }

  const plans = [...plansMap.values()].sort((a, b) => a.planName.localeCompare(b.planName, "pt-BR"));

  const totals: AdminCostReportTotals = plans.reduce(
    (acc, p) => ({
      apiCostUsd: acc.apiCostUsd + p.apiCostUsd,
      credIa: acc.credIa + p.credIa,
      downloadCostUsd: acc.downloadCostUsd + p.downloadCostUsd,
      planPriceSum: acc.planPriceSum + (p.planPriceSum ?? 0),
    }),
    { apiCostUsd: 0, credIa: 0, downloadCostUsd: 0, planPriceSum: 0 }
  );

  const detailLimit = 150;
  const [apiDetail] = await pool.query<RowDataPacket[]>(
    `SELECT l.id, l.createdAt, l.userId, l.memoId, l.operation, l.model, l.costUsd, m.mediaType, m.groupId
     FROM api_usage_logs l
     LEFT JOIN memos m ON m.id = l.memoId
     WHERE l.createdAt >= ? AND l.createdAt <= ?
       AND (${apiMediaSql})
     ORDER BY l.createdAt DESC
     LIMIT ${detailLimit}`,
    [sqlStart, sqlEnd, ...apiMediaParams]
  );

  const [dlDetail] = await pool.query<RowDataPacket[]>(
    `SELECT d.id, d.downloadedAt, d.userId, d.groupId, d.memoId, d.costUsd, d.usedCred, m.mediaType,
            COALESCE(d.groupId, m.groupId) AS contextGroupId
     FROM download_logs d
     LEFT JOIN memos m ON m.id = d.memoId
     WHERE d.downloadedAt >= ? AND d.downloadedAt <= ?
       AND (${dlMediaSql})
     ORDER BY d.downloadedAt DESC
     LIMIT ${detailLimit}`,
    [msStart, msEnd, ...dlMediaParams]
  );

  const detailApi: AdminCostReportDetailApiRow[] = apiDetail.map((r) => ({
    id: Number(r.id),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    userId: Number(r.userId),
    memoId: r.memoId != null ? Number(r.memoId) : null,
    operation: String(r.operation ?? ""),
    model: String(r.model ?? ""),
    costUsd: Number(r.costUsd) || 0,
    mediaType: r.mediaType != null ? String(r.mediaType) : null,
    groupId: r.groupId != null ? Number(r.groupId) : null,
  }));

  const detailDownloads: AdminCostReportDetailDownloadRow[] = dlDetail.map((r) => {
    const raw = r as Record<string, unknown>;
    const ctxG = raw.contextGroupId ?? raw.contextgroupid;
    return {
      id: Number(r.id),
      downloadedAt: new Date(Number(r.downloadedAt)).toISOString(),
      userId: Number(r.userId),
      groupId: ctxG != null && ctxG !== "" ? Number(ctxG) : null,
      memoId: r.memoId != null ? Number(r.memoId) : null,
      costUsd: r.costUsd != null ? Number(r.costUsd) : null,
      usedCred: r.usedCred != null ? Number(r.usedCred) : null,
      mediaType: r.mediaType != null ? String(r.mediaType) : null,
    };
  });

  return {
    ok: true,
    dateFrom: df,
    dateTo: dt,
    mediaType: media,
    credMultiplier: mult,
    plans,
    totals,
    detailApi,
    detailDownloads,
  };
}

export { isValidDateYmd, parseMediaFilter };
