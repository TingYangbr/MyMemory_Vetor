import fs from "node:fs/promises";
import path from "node:path";
import type { SoftDeletedMemosMonthlyRow } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import { uploadsAbsolutePath } from "../paths.js";
import { deleteMemoObjectFromS3, tryExtractMemoS3KeyFromPublicUrl } from "./s3MediaStorage.js";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidYearMonth(raw: string): boolean {
  return MONTH_RE.test(raw.trim());
}

interface InactiveMemoRow extends RowDataPacket {
  id: number;
  userId: number;
  mediaAudioUrl: string | null;
  mediaImageUrl: string | null;
  mediaVideoUrl: string | null;
  mediaDocumentUrl: string | null;
}

export async function listSoftDeletedMemosByMonth(): Promise<SoftDeletedMemosMonthlyRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TO_CHAR(updatedat, 'YYYY-MM') AS ym, COUNT(*) AS cnt
     FROM memos
     WHERE isactive = 0
     GROUP BY TO_CHAR(updatedat, 'YYYY-MM')
     ORDER BY ym DESC`
  );
  return rows.map((r) => {
    const month = String(r.ym);
    const memosCount = Number(r.cnt) || 0;
    const chatsCount = 0;
    return {
      month,
      memosCount,
      chatsCount,
      totalCount: memosCount + chatsCount,
    };
  });
}

function collectMemoMediaUrls(r: Pick<
  InactiveMemoRow,
  "mediaAudioUrl" | "mediaImageUrl" | "mediaVideoUrl" | "mediaDocumentUrl"
>): string[] {
  const out: string[] = [];
  for (const u of [r.mediaAudioUrl, r.mediaImageUrl, r.mediaVideoUrl, r.mediaDocumentUrl]) {
    if (typeof u === "string" && u.trim()) out.push(u.trim());
  }
  return out;
}

async function purgeMemoMediaUrls(
  urls: string[],
  s3KeysDone: Set<string>,
  localPathsDone: Set<string>
): Promise<{ s3Removed: number; localRemoved: number }> {
  let s3Removed = 0;
  let localRemoved = 0;

  for (const url of urls) {
    if (url.startsWith("/media/")) {
      const abs = localAbsolutePathForMediaUrl(url);
      if (abs && !localPathsDone.has(abs)) {
        localPathsDone.add(abs);
        if (await tryUnlink(abs)) localRemoved += 1;
      }
      continue;
    }
    if ((url.startsWith("http://") || url.startsWith("https://")) && config.mediaStorage === "s3" && config.s3.bucket.trim()) {
      const key = tryExtractMemoS3KeyFromPublicUrl(url);
      if (key && !s3KeysDone.has(key)) {
        s3KeysDone.add(key);
        await deleteMemoObjectFromS3(key);
        s3Removed += 1;
      }
    }
  }

  return { s3Removed, localRemoved };
}

function localAbsolutePathForMediaUrl(mediaUrl: string): string | null {
  const u = mediaUrl.trim();
  if (!u.startsWith("/media/")) return null;
  const m = u.match(/^\/media\/(\d+)\/([^/?#]+)$/);
  if (!m) return null;
  const uid = m[1];
  let name = m[2];
  try {
    name = decodeURIComponent(name);
  } catch {
    return null;
  }
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return null;
  const base = path.resolve(uploadsAbsolutePath(), uid);
  const abs = path.resolve(base, name);
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (abs !== base && !abs.startsWith(baseWithSep)) return null;
  return abs;
}

async function tryUnlink(abs: string): Promise<boolean> {
  try {
    await fs.unlink(abs);
    return true;
  } catch {
    return false;
  }
}

export interface HardDeleteMonthResult {
  month: string;
  deletedMemos: number;
  s3ObjectsRemoved: number;
  localFilesRemoved: number;
}

/**
 * Eliminação física de memos inativos cujo `updatedAt` cai no mês indicado (última atualização ≈ soft delete).
 * `api_usage_logs.memoId` fica NULL (ON DELETE SET NULL). Arquivos S3/local são removidos quando reconhecíveis.
 */
export async function hardDeleteInactiveMemosForMonth(month: string): Promise<HardDeleteMonthResult> {
  const ym = month.trim();
  if (!isValidYearMonth(ym)) {
    throw new Error("invalid_month");
  }

  const [rows] = await pool.query<InactiveMemoRow[]>(
    `SELECT id, userId, mediaAudioUrl, mediaImageUrl, mediaVideoUrl, mediaDocumentUrl
     FROM memos
     WHERE isactive = 0 AND TO_CHAR(updatedat, 'YYYY-MM') = ?`,
    [ym]
  );

  if (!rows.length) {
    return { month: ym, deletedMemos: 0, s3ObjectsRemoved: 0, localFilesRemoved: 0 };
  }

  let s3ObjectsRemoved = 0;
  let localFilesRemoved = 0;
  const s3KeysDone = new Set<string>();
  const localPathsDone = new Set<string>();

  for (const row of rows) {
    const urls = collectMemoMediaUrls(row);
    const { s3Removed, localRemoved } = await purgeMemoMediaUrls(urls, s3KeysDone, localPathsDone);
    s3ObjectsRemoved += s3Removed;
    localFilesRemoved += localRemoved;
  }

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  await pool.query(`DELETE FROM memos WHERE id IN (${placeholders})`, ids);

  return {
    month: ym,
    deletedMemos: ids.length,
    s3ObjectsRemoved,
    localFilesRemoved,
  };
}
