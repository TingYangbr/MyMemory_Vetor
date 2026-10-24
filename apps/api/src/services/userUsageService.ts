import type { RowDataPacket } from "../lib/dbTypes.js";
import type { UserUsageDashboardResponse } from "@mymemory/shared";
import { pool } from "../db.js";
import { getUsdToCreditsMultiplier } from "./systemConfigService.js";

function toMysqlLocalStartOfDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00`;
}

function round(n: number, dec: number): number {
  const p = 10 ** dec;
  return Math.round(n * p) / p;
}

type PlanRow = {
  planName: string;
  maxMemos: number;
  maxStorageGB: number;
  monthlyApiCredits: number | null;
  monthlyDownloadLimitGB: number | null;
};

async function resolveUserPlanLimits(userId: number): Promise<PlanRow | null> {
  const [ind] = await pool.query<RowDataPacket[]>(
    `SELECT p.name AS planName, p.maxMemos, p.maxStorageGB, p.monthlyApiCredits, p.monthlyDownloadLimitGB
     FROM subscriptions s
     INNER JOIN subscription_plans p ON p.id = s.planId
     WHERE s.type = 'individual' AND s.userId = ? AND s.ownerId = ? AND s.status = 'active'
     ORDER BY s.id DESC
     LIMIT 1`,
    [userId, userId]
  );
  if (ind.length) {
    const r = ind[0];
    return {
      planName: String(r.planName ?? ""),
      maxMemos: Number(r.maxMemos) || 0,
      maxStorageGB: Number(r.maxStorageGB) || 0,
      monthlyApiCredits: r.monthlyApiCredits == null || r.monthlyApiCredits === "" ? null : Number(r.monthlyApiCredits),
      monthlyDownloadLimitGB:
        r.monthlyDownloadLimitGB == null || r.monthlyDownloadLimitGB === "" ? null : Number(r.monthlyDownloadLimitGB),
    };
  }
  const [grp] = await pool.query<RowDataPacket[]>(
    `SELECT p.name AS planName, p.maxMemos, p.maxStorageGB, p.monthlyApiCredits, p.monthlyDownloadLimitGB
     FROM subscriptions s
     INNER JOIN subscription_plans p ON p.id = s.planId
     WHERE s.type = 'group' AND s.ownerId = ? AND s.status = 'active'
     ORDER BY s.id DESC
     LIMIT 1`,
    [userId]
  );
  if (!grp.length) return null;
  const r = grp[0];
  return {
    planName: String(r.planName ?? ""),
    maxMemos: Number(r.maxMemos) || 0,
    maxStorageGB: Number(r.maxStorageGB) || 0,
    monthlyApiCredits: r.monthlyApiCredits == null || r.monthlyApiCredits === "" ? null : Number(r.monthlyApiCredits),
    monthlyDownloadLimitGB:
      r.monthlyDownloadLimitGB == null || r.monthlyDownloadLimitGB === "" ? null : Number(r.monthlyDownloadLimitGB),
  };
}

/**
 * Créditos de IA consumidos pelo usuário no mês corrente: custo real em US$ registrado em
 * api_usage_logs × multiplicador USD→créditos (Config. do Sistema, padrão 100).
 * (A tabela guarda só o custo em US$; não há coluna de créditos.)
 */
export async function getCreditosUsadosNoMes(userId: number, agora = new Date()): Promise<number> {
  const inicio = toMysqlLocalStartOfDay(new Date(agora.getFullYear(), agora.getMonth(), 1));
  const fim = toMysqlLocalStartOfDay(new Date(agora.getFullYear(), agora.getMonth() + 1, 1));
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(costusd), 0) AS s FROM api_usage_logs
     WHERE userid = ? AND createdat >= ? AND createdat < ?`,
    [userId, inicio, fim]
  );
  const usd = Number(rows[0]?.s ?? 0);
  return usd * (await getUsdToCreditsMultiplier());
}

/** Situação dos créditos de IA do mês (só aviso: o limite ainda não bloqueia o uso). */
export async function getCreditosStatus(userId: number): Promise<{ usados: number; limite: number | null; excedido: boolean }> {
  const plan = await resolveUserPlanLimits(userId);
  const limite = plan?.monthlyApiCredits ?? null;
  const usados = round(await getCreditosUsadosNoMes(userId), 2);
  return { usados, limite, excedido: limite != null && limite > 0 && usados > limite };
}

/**
 * Painel de utilização: limites do plano (individual ou grupo do qual o usuario é dono) e consumo do usuario.
 */
export async function getUserUsageDashboard(userId: number): Promise<UserUsageDashboardResponse> {
  const plan = await resolveUserPlanLimits(userId);
  const planName = plan?.planName ?? "Sem plano ativo";
  const maxMemos = plan?.maxMemos ?? null;
  const maxStorageGB = plan?.maxStorageGB ?? null;
  const monthlyApiCredits = plan?.monthlyApiCredits ?? null;
  const monthlyDownloadLimitGB = plan?.monthlyDownloadLimitGB ?? null;

  const [memoRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c, COALESCE(SUM(tamMediaUrl), 0) AS bytes FROM memos WHERE userId = ? AND isActive = 1`,
    [userId]
  );
  const memoCount = Number(memoRows[0]?.c ?? 0);
  const bytes = Number(memoRows[0]?.bytes ?? 0);
  const usedStorageGB = bytes / 1024 ** 3;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);

  let creditsUsed = 0;
  try {
    creditsUsed = await getCreditosUsadosNoMes(userId, now);
  } catch (err) {
    console.warn("[userUsage] falha ao somar créditos do mês:", err instanceof Error ? err.message : err);
  }

  let downloadMb = 0;
  try {
    const startMs = monthStart.getTime();
    const endMs = nextMonthStart.getTime();
    const [dlRows] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(fileSizeMb), 0) AS mb FROM download_logs
       WHERE userId = ? AND downloadedAt >= ? AND downloadedAt < ?`,
      [userId, startMs, endMs]
    );
    downloadMb = Number(dlRows[0]?.mb ?? 0);
  } catch {
    /* download_logs pode não existir */
  }
  const downloadGb = downloadMb / 1024;

  return {
    planName,
    memos: { used: memoCount, limit: maxMemos },
    storageGB: { used: round(usedStorageGB, 2), limit: maxStorageGB != null ? round(maxStorageGB, 2) : null },
    apiCreditsMonth: { used: round(creditsUsed, 2), limit: monthlyApiCredits != null ? round(monthlyApiCredits, 2) : null },
    downloadsMonthGB: { used: round(downloadGb, 2), limit: monthlyDownloadLimitGB != null ? round(monthlyDownloadLimitGB, 2) : null },
  };
}
