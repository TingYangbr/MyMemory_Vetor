import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";

async function getConfigValueRaw(configKey: string): Promise<string | null> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT configValue FROM system_config WHERE configKey = ? LIMIT 1`,
      [configKey]
    );
    const v = rows[0]?.configValue;
    if (v == null) return null;
    return String(v).trim();
  } catch {
    return null;
  }
}

/** Multiplicador USD → créditos (`fatorCredCost`). Padrão 100 se ausente ou inválido. */
export async function getUsdToCreditsMultiplier(): Promise<number> {
  const raw = await getConfigValueRaw("fatorCredCost");
  if (!raw) return 100;
  const n = Number.parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return 100;
  return n;
}

/** Exibir custo USD e créditos na UI (`showApiCost`: 1 = sim, 0 = não). Padrão: exibir. */
export async function showApiCostInUi(): Promise<boolean> {
  const raw = await getConfigValueRaw("showApiCost");
  if (raw == null || raw === "") return true;
  const s = raw.toLowerCase();
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return true;
}

/** Limiares de similaridade semântica para o Pipe 1. */
export async function getSemanticSearchThresholds(): Promise<{ initial: number; min: number }> {
  const [rawInitial, rawMin] = await Promise.all([
    getConfigValueRaw("semanticSearchInitialThreshold"),
    getConfigValueRaw("semanticSearchMinThreshold"),
  ]);
  const parse = (raw: string | null, def: number) => {
    if (!raw) return def;
    const n = Number.parseFloat(raw.replace(",", "."));
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : def;
  };
  return { initial: parse(rawInitial, 0.7), min: parse(rawMin, 0.3) };
}

/** Lista todos os itens de system_config. */
export async function listSystemConfig(): Promise<
  { configkey: string; configvalue: string; description: string | null; updatedat: string }[]
> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT configkey, configvalue, description, updatedat FROM system_config ORDER BY configkey`
  );
  return rows.map((r) => ({
    configkey: String(r.configkey),
    configvalue: String(r.configvalue),
    description: r.description != null ? String(r.description) : null,
    updatedat: r.updatedat instanceof Date ? r.updatedat.toISOString() : String(r.updatedat),
  }));
}

/** Upsert de um valor de config. */
export async function upsertSystemConfig(
  configkey: string,
  configvalue: string,
  updatedByUserId: number
): Promise<void> {
  await pool.query(
    `INSERT INTO system_config (configkey, configvalue, updatedat, updatedbyuserid)
     VALUES (?, ?, NOW(), ?)
     ON CONFLICT (configkey) DO UPDATE
       SET configvalue = EXCLUDED.configvalue,
           updatedat = NOW(),
           updatedbyuserid = EXCLUDED.updatedbyuserid`,
    [configkey, configvalue, updatedByUserId]
  );
}

export function creditsFromUsdCost(apiCostUsd: number, multiplier: number): number {
  const c = Number(apiCostUsd);
  const m = Number(multiplier);
  if (!Number.isFinite(c) || c <= 0) return 0;
  if (!Number.isFinite(m) || m <= 0) return 0;
  return Math.round(c * m * 1e8) / 1e8;
}
