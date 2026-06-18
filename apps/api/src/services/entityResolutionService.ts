import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { executeQueryMssql } from "./adminDbConnectionsService.js";

const NOME_VS_ABREV_VIEW = "ia_Nome_vs_Abrev";

async function getPrincipalConnectionId(groupId: number): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM db_connections WHERE groupid = ? AND isPrincipal = 1 AND isactive = 1 LIMIT 1`,
    [groupId]
  );
  if (rows[0]) return rows[0].id as number;
  // fallback: única conexão ativa do grupo
  const [fallback] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM db_connections WHERE groupid = ? AND isactive = 1 ORDER BY id ASC LIMIT 1`,
    [groupId]
  );
  return fallback[0] ? (fallback[0].id as number) : null;
}

/**
 * Dado um nome extraído do documento (razão social ou nome fantasia),
 * retorna o Nome_Fantasia canônico da view Nome_vs_Abrev do ERP.
 * Retorna null se não encontrar ou se não houver conexão configurada.
 */
export async function resolveNomeAbrev(
  groupId: number,
  extractedName: string
): Promise<string | null> {
  if (!extractedName?.trim()) return null;
  const conexaoId = await getPrincipalConnectionId(groupId);
  if (!conexaoId) {
    console.warn(`[entityResolution] Nenhuma conexão ERP ativa encontrada para groupId=${groupId}. Configure uma conexão no painel do grupo.`);
    return null;
  }
  try {
    const result = await executeQueryMssql(
      conexaoId,
      `SELECT TOP 1 Nome_Fantasia FROM ${NOME_VS_ABREV_VIEW}
       WHERE Razao_Social LIKE '%' + @nome + '%'
          OR Nome_Fantasia LIKE '%' + @nome + '%'
       ORDER BY CASE WHEN Nome_Fantasia = @nome THEN 0 ELSE 1 END`,
      { nome: extractedName.trim() }
    );
    const abrev = result.linhas[0]?.Nome_Fantasia;
    if (typeof abrev === "string" && abrev.trim()) {
      console.info(`[entityResolution] "${extractedName}" → "${abrev.trim()}" (conexão ${conexaoId})`);
      return abrev.trim();
    }
    console.warn(`[entityResolution] Nenhum resultado na view ${NOME_VS_ABREV_VIEW} para "${extractedName}" (conexão ${conexaoId})`);
    return null;
  } catch (err) {
    console.error(`[entityResolution] Erro ao resolver "${extractedName}" na conexão ${conexaoId}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}
