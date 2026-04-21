import type { ResultSetHeader, RowDataPacket } from "../lib/dbTypes.js";
import type { AdminMediaSettingRow, AdminMediaSettingsResponse, MediaSettingsMediaTypeDb } from "@mymemory/shared";
import { pool } from "../db.js";

const MEDIA_ORDER: MediaSettingsMediaTypeDb[] = [
  "default",
  "audio",
  "image",
  "video",
  "document",
  "text",
  "html",
];

const DEFAULT_ROW = {
  maxFileSizeKB: 20_000,
  videoChunkMinutes: null as number | null,
  audioChunkMinutes: null as number | null,
  maxLargeVideoKb: null as number | null,
  maxLargeAudioKb: null as number | null,
  maxSummaryChars: 1000,
  textImagemMin: 100,
  compressBeforeAI: 0 as 0 | 1,
};

function numField(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nullablePosInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isUnknownColumnErr(err: unknown, col?: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; errno?: number; sqlMessage?: string };
  if (e.code !== "42703") return false;
  if (col) return String((e as {message?: string}).message ?? "").includes(col);
  return true;
}

/** Migração 013/014/019 não aplicada ou ENUM sem `text`/`html`. */
function isMediaSettings013Missing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; errno?: number; sqlMessage?: string };
  const m = String((e as {message?: string}).message ?? "");
  if (e.code === "42703") {
    if (
      m.includes("video_chunk_minutes") ||
      m.includes("audio_chunk_minutes") ||
      m.includes("video_chunk_size_kb") ||
      m.includes("audio_chunk_size_kb") ||
      m.includes("maxLargeVideoKb") ||
      m.includes("maxLargeAudioKb")
    ) {
      return true;
    }
  }
  if ((e.code === "22001" || e.code === "22P02") && m.includes("mediaType")) {
    return true;
  }
  return false;
}

function rowFromDb(r: RowDataPacket, planId: number): AdminMediaSettingRow {
  const mt = String(r.mediaType) as MediaSettingsMediaTypeDb;
  const legacyLarge =
    r.maxFileSizeKBLarge == null || r.maxFileSizeKBLarge === ""
      ? null
      : nullablePosInt(r.maxFileSizeKBLarge);
  return {
    id: Number(r.id),
    planId,
    mediaType: mt,
    maxFileSizeKB: numField(r.maxFileSizeKB, DEFAULT_ROW.maxFileSizeKB),
    videoChunkMinutes: nullablePosInt(r.video_chunk_minutes),
    audioChunkMinutes: nullablePosInt(r.audio_chunk_minutes),
    maxLargeVideoKb:
      nullablePosInt(r.maxLargeVideoKb) ?? (mt === "video" ? legacyLarge : null),
    maxLargeAudioKb:
      nullablePosInt(r.maxLargeAudioKb) ?? (mt === "audio" ? legacyLarge : null),
    maxSummaryChars: numField(r.maxSummaryChars, DEFAULT_ROW.maxSummaryChars),
    textImagemMin: numField(r.textImagemMin, DEFAULT_ROW.textImagemMin),
    compressBeforeAI: r.compressBeforeAI === 1 || r.compressBeforeAI === true ? 1 : 0,
  };
}

export async function getPlanMediaSettingsAdmin(planId: number): Promise<AdminMediaSettingsResponse> {
  const [plans] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, supportLargeAudio, supportLargeVideo FROM subscription_plans WHERE id = ? LIMIT 1`,
    [planId]
  );
  if (!plans.length) {
    throw new Error("plan_not_found");
  }
  const p = plans[0];
  const planName = String(p.name);
  const supportLargeAudio = p.supportLargeAudio === 1 || p.supportLargeAudio === true ? 1 : 0;
  const supportLargeVideo = p.supportLargeVideo === 1 || p.supportLargeVideo === true ? 1 : 0;

  let rowsDb: RowDataPacket[] = [];
  try {
    const [r] = await pool.query<RowDataPacket[]>(
      `SELECT id, planId, mediaType, maxFileSizeKB,
              video_chunk_minutes, audio_chunk_minutes, maxLargeVideoKb, maxLargeAudioKb,
              maxSummaryChars, textImagemMin, compressBeforeAI
       FROM media_settings WHERE planId = ?`,
      [planId]
    );
    rowsDb = r;
  } catch (e) {
    if (!isUnknownColumnErr(e)) throw e;
    try {
      const [r] = await pool.query<RowDataPacket[]>(
        `SELECT id, planId, mediaType, maxFileSizeKB,
                video_chunk_size_kb, audio_chunk_size_kb, maxLargeVideoKb, maxLargeAudioKb,
                maxSummaryChars, textImagemMin, compressBeforeAI
         FROM media_settings WHERE planId = ?`,
        [planId]
      );
      rowsDb = r.map((x) => ({
        ...x,
        video_chunk_minutes: null,
        audio_chunk_minutes: null,
      }));
    } catch (e2) {
      if (!isUnknownColumnErr(e2)) throw e2;
      try {
        const [r] = await pool.query<RowDataPacket[]>(
          `SELECT id, planId, mediaType, maxFileSizeKB, maxFileSizeKBLarge, maxSummaryChars, textImagemMin, compressBeforeAI
           FROM media_settings WHERE planId = ?`,
          [planId]
        );
        rowsDb = r.map((x) => ({
          ...x,
          video_chunk_minutes: null,
          audio_chunk_minutes: null,
        }));
      } catch (e3) {
        if (!isUnknownColumnErr(e3, "textImagemMin")) throw e3;
        const [r] = await pool.query<RowDataPacket[]>(
          `SELECT id, planId, mediaType, maxFileSizeKB, maxFileSizeKBLarge, maxSummaryChars, compressBeforeAI
           FROM media_settings WHERE planId = ?`,
          [planId]
        );
        rowsDb = r.map((x) => ({
          ...x,
          textImagemMin: DEFAULT_ROW.textImagemMin,
          video_chunk_minutes: null,
          audio_chunk_minutes: null,
        }));
      }
    }
  }

  const byType = new Map<MediaSettingsMediaTypeDb, AdminMediaSettingRow>();
  for (const r of rowsDb) {
    const mt = String(r.mediaType) as MediaSettingsMediaTypeDb;
    if (MEDIA_ORDER.includes(mt)) {
      byType.set(mt, rowFromDb(r, planId));
    }
  }

  const rows: AdminMediaSettingRow[] = MEDIA_ORDER.map((mediaType) => {
    const existing = byType.get(mediaType);
    if (existing) return existing;
    return {
      id: 0,
      planId,
      mediaType,
      ...DEFAULT_ROW,
    };
  });

  return {
    planId,
    planName,
    supportLargeAudio,
    supportLargeVideo,
    rows,
  };
}

export type MediaSettingUpsertInput = {
  mediaType: MediaSettingsMediaTypeDb;
  maxFileSizeKB: number;
  videoChunkMinutes: number | null;
  audioChunkMinutes: number | null;
  maxLargeVideoKb: number | null;
  maxLargeAudioKb: number | null;
  maxSummaryChars: number;
  textImagemMin: number;
  compressBeforeAI: 0 | 1;
};

function normalizeUpsertRow(row: MediaSettingUpsertInput): MediaSettingUpsertInput {
  if (row.mediaType === "video") {
    return {
      ...row,
      audioChunkMinutes: null,
      maxLargeAudioKb: null,
    };
  }
  if (row.mediaType === "audio") {
    return {
      ...row,
      videoChunkMinutes: null,
      maxLargeVideoKb: null,
    };
  }
  return {
    ...row,
    videoChunkMinutes: null,
    audioChunkMinutes: null,
    maxLargeVideoKb: null,
    maxLargeAudioKb: null,
  };
}

export async function upsertPlanMediaSettingsAdmin(planId: number, inputRows: MediaSettingUpsertInput[]): Promise<void> {
  const [plans] = await pool.query<RowDataPacket[]>(`SELECT id FROM subscription_plans WHERE id = ? LIMIT 1`, [planId]);
  if (!plans.length) {
    throw new Error("plan_not_found");
  }

  const byMt = new Map(inputRows.map((r) => [r.mediaType, r]));
  for (const mediaType of MEDIA_ORDER) {
    const row = byMt.get(mediaType);
    if (!row) {
      throw new Error("missing_media_type");
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const raw of inputRows) {
      const row = normalizeUpsertRow(raw);
      if (!MEDIA_ORDER.includes(row.mediaType)) {
        throw new Error("invalid_media_type");
      }
      if (row.maxFileSizeKB < 1 || row.maxFileSizeKB > 500_000_000) {
        throw new Error("invalid_max_file_kb");
      }
      if (row.maxSummaryChars < 1 || row.maxSummaryChars > 65_000) {
        throw new Error("invalid_max_summary");
      }
      if (row.textImagemMin < 0 || row.textImagemMin > 65_000) {
        throw new Error("invalid_text_imagem_min");
      }
      const chkMin = (n: number | null) => n == null || (n >= 1 && n <= 120);
      if (!chkMin(row.videoChunkMinutes)) throw new Error("invalid_video_chunk_minutes");
      if (!chkMin(row.audioChunkMinutes)) throw new Error("invalid_audio_chunk_minutes");
      const chk = (n: number | null, max: number) => n == null || (n >= 1 && n <= max);
      if (!chk(row.maxLargeVideoKb, 500_000_000)) throw new Error("invalid_max_large_video_kb");
      if (!chk(row.maxLargeAudioKb, 500_000_000)) throw new Error("invalid_max_large_audio_kb");

      try {
        await conn.query<ResultSetHeader>(
          `INSERT INTO media_settings (
          planid, mediatype, maxfilesizekb,
          video_chunk_minutes, audio_chunk_minutes, maxlargevideokb, maxlargeaudiokb,
          maxsummarychars, textimagemmin, compressbeforeai
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (planid, mediatype) DO UPDATE SET
          maxfilesizekb = EXCLUDED.maxfilesizekb,
          video_chunk_minutes = EXCLUDED.video_chunk_minutes,
          audio_chunk_minutes = EXCLUDED.audio_chunk_minutes,
          maxlargevideokb = EXCLUDED.maxlargevideokb,
          maxlargeaudiokb = EXCLUDED.maxlargeaudiokb,
          maxsummarychars = EXCLUDED.maxsummarychars,
          textimagemmin = EXCLUDED.textimagemmin,
          compressbeforeai = EXCLUDED.compressbeforeai`,
          [
            planId,
            row.mediaType,
            row.maxFileSizeKB,
            row.videoChunkMinutes,
            row.audioChunkMinutes,
            row.maxLargeVideoKb,
            row.maxLargeAudioKb,
            row.maxSummaryChars,
            row.textImagemMin,
            row.compressBeforeAI,
          ]
        );
      } catch (e) {
        if (isMediaSettings013Missing(e)) {
          throw new Error("media_settings_schema_outdated");
        }
        throw e;
      }
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
