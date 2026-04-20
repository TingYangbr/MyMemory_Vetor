import type { RowDataPacket } from "mysql2";
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

export function creditsFromUsdCost(apiCostUsd: number, multiplier: number): number {
  const c = Number(apiCostUsd);
  const m = Number(multiplier);
  if (!Number.isFinite(c) || c <= 0) return 0;
  if (!Number.isFinite(m) || m <= 0) return 0;
  return Math.round(c * m * 1e8) / 1e8;
}
