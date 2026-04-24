import type { ResultSetHeader, RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";

const OPERATION = "cad_bim_pipeline";

export async function getCadPipelineEnabled(): Promise<boolean> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT isEnabled FROM ai_config WHERE operation = ? LIMIT 1`,
      [OPERATION]
    );
    const v = rows[0]?.isEnabled;
    return v === 1 || v === true;
  } catch {
    return false;
  }
}

export async function setCadPipelineEnabled(enabled: boolean): Promise<void> {
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE ai_config SET isEnabled = ? WHERE operation = ?`,
    [enabled ? 1 : 0, OPERATION]
  );
  if (res.affectedRows === 0) {
    await pool.query(
      `INSERT INTO ai_config (operation, displayName, provider, model, isEnabled)
       VALUES (?, 'CAD/BIM — Processamento IFC/DWG', 'openai', 'gpt-4o-mini', ?)`,
      [OPERATION, enabled ? 1 : 0]
    );
  }
}
