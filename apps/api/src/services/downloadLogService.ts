import type { ResultSetHeader } from "../lib/dbTypes.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import { creditsFromUsdCost, getUsdToCreditsMultiplier } from "./systemConfigService.js";

/** Estimativa simples de custo de egress S3 (USD por GiB transferido). Só quando `S3_EGRESS_USD_PER_GB` está definido. */
function estimateDownloadCostUsd(bytes: number): number | null {
  const rate = config.s3.egressUsdPerGb;
  if (rate == null || bytes <= 0) return null;
  const gib = bytes / (1024 * 1024 * 1024);
  const usd = gib * rate;
  return Math.round(usd * 1e8) / 1e8;
}

/**
 * Registra download servido pela API após leitura via S3 GetObject (memo anexo).
 * Falhas de INSERT não interrompem a resposta ao cliente.
 */
export async function insertMemoS3DownloadLog(input: {
  userId: number;
  groupId: number | null;
  memoId: number;
  s3Key: string;
  bytesDownloaded: number;
}): Promise<void> {
  const downloadedAt = Date.now();
  const fileSizeMb = input.bytesDownloaded / (1024 * 1024);
  const key = input.s3Key.slice(0, 1000);
  const costUsd = estimateDownloadCostUsd(input.bytesDownloaded);
  const fator = await getUsdToCreditsMultiplier();
  const usedCred =
    costUsd == null ? null : creditsFromUsdCost(costUsd, fator);

  const tryFull = async (): Promise<boolean> => {
    try {
      await pool.query<ResultSetHeader>(
        `INSERT INTO download_logs (
           userId, groupId, memoId, s3key, fileSizeMb, bytesDownloaded, costUsd, usedCred, downloadedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.userId,
          input.groupId,
          input.memoId,
          key,
          fileSizeMb,
          input.bytesDownloaded,
          costUsd,
          usedCred,
          downloadedAt,
        ]
      );
      return true;
    } catch {
      return false;
    }
  };

  const tryCostNoUsedCred = async (): Promise<boolean> => {
    try {
      await pool.query<ResultSetHeader>(
        `INSERT INTO download_logs (
           userId, groupId, memoId, s3key, fileSizeMb, bytesDownloaded, costUsd, downloadedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.userId,
          input.groupId,
          input.memoId,
          key,
          fileSizeMb,
          input.bytesDownloaded,
          costUsd,
          downloadedAt,
        ]
      );
      return true;
    } catch {
      return false;
    }
  };

  const tryBytesOnly = async (): Promise<boolean> => {
    try {
      await pool.query<ResultSetHeader>(
        `INSERT INTO download_logs (
           userId, groupId, memoId, s3key, fileSizeMb, bytesDownloaded, downloadedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.userId,
          input.groupId,
          input.memoId,
          key,
          fileSizeMb,
          input.bytesDownloaded,
          downloadedAt,
        ]
      );
      return true;
    } catch {
      return false;
    }
  };

  if (await tryFull()) return;
  if (await tryCostNoUsedCred()) return;
  if (await tryBytesOnly()) return;

  try {
    await pool.query<ResultSetHeader>(
      `INSERT INTO download_logs (userId, groupId, memoId, s3key, fileSizeMb, downloadedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.userId, input.groupId, input.memoId, key, fileSizeMb, downloadedAt]
    );
  } catch {
    /* tabela ou colunas em falta */
  }
}
