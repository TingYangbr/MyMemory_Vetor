import type { UserMediaLimitsResponse } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { clampChunkMinutes } from "../lib/mediaChunkMinutes.js";
import { pool } from "../db.js";
import { assertUserWorkspaceGroupAccess } from "./memoContextService.js";

export type UploadClassifyMediaKind = "audio" | "video" | "image" | "document";

const DEFAULT_KB: Record<string, number> = {
  audio: 20_000,
  video: 20_000,
  image: 20_000,
  document: 20_000,
  text: 20_000,
  html: 20_000,
  default: 20_000,
};

function isUnknownColumnErr(err: unknown, col: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; errno?: number; sqlMessage?: string };
  if (e.code !== "42703") return false;
  return String((e as {message?: string}).message ?? "").includes(col);
}

type MsRow = {
  mediaType: string;
  maxFileSizeKB: number;
  maxLargeVideoKb: number | null;
  maxLargeAudioKb: number | null;
  videoChunkMinutes: number | null;
  audioChunkMinutes: number | null;
};

function mapPacketToMsRow(r: RowDataPacket): MsRow {
  const mt = String(r.mediaType);
  const baseKb = Number(r.maxFileSizeKB);
  const legacyLarge =
    r.maxFileSizeKBLarge == null || r.maxFileSizeKBLarge === "" ? null : Number(r.maxFileSizeKBLarge);
  const lv =
    r.maxLargeVideoKb != null && r.maxLargeVideoKb !== ""
      ? Number(r.maxLargeVideoKb)
      : null;
  const la =
    r.maxLargeAudioKb != null && r.maxLargeAudioKb !== ""
      ? Number(r.maxLargeAudioKb)
      : null;
  const vcm =
    r.video_chunk_minutes != null && r.video_chunk_minutes !== ""
      ? Number(r.video_chunk_minutes)
      : null;
  const acm =
    r.audio_chunk_minutes != null && r.audio_chunk_minutes !== ""
      ? Number(r.audio_chunk_minutes)
      : null;
  return {
    mediaType: mt,
    maxFileSizeKB: Number.isFinite(baseKb) && baseKb > 0 ? baseKb : DEFAULT_KB[mt] ?? DEFAULT_KB.default,
    maxLargeVideoKb:
      lv != null && Number.isFinite(lv) && lv > 0
        ? lv
        : mt === "video" && legacyLarge != null && Number.isFinite(legacyLarge) && legacyLarge > 0
          ? legacyLarge
          : null,
    maxLargeAudioKb:
      la != null && Number.isFinite(la) && la > 0
        ? la
        : mt === "audio" && legacyLarge != null && Number.isFinite(legacyLarge) && legacyLarge > 0
          ? legacyLarge
          : null,
    videoChunkMinutes:
      vcm != null && Number.isFinite(vcm) && vcm > 0 ? Math.floor(vcm) : null,
    audioChunkMinutes:
      acm != null && Number.isFinite(acm) && acm > 0 ? Math.floor(acm) : null,
  };
}

async function loadMediaSettingsRows(planId: number): Promise<MsRow[]> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT mediaType, maxFileSizeKB, maxLargeVideoKb, maxLargeAudioKb,
              video_chunk_minutes, audio_chunk_minutes
       FROM media_settings WHERE planId = ?`,
      [planId]
    );
    return rows.map(mapPacketToMsRow);
  } catch (err) {
    if (isUnknownColumnErr(err, "video_chunk_minutes") || isUnknownColumnErr(err, "audio_chunk_minutes")) {
      try {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT mediaType, maxFileSizeKB, maxLargeVideoKb, maxLargeAudioKb,
                  video_chunk_size_kb, audio_chunk_size_kb
           FROM media_settings WHERE planId = ?`,
          [planId]
        );
        return rows.map((r) =>
          mapPacketToMsRow({
            ...r,
            video_chunk_minutes: null,
            audio_chunk_minutes: null,
          })
        );
      } catch (errKb) {
        if (
          isUnknownColumnErr(errKb, "video_chunk_size_kb") ||
          isUnknownColumnErr(errKb, "audio_chunk_size_kb")
        ) {
          try {
            const [rows] = await pool.query<RowDataPacket[]>(
              `SELECT mediaType, maxFileSizeKB, maxLargeVideoKb, maxLargeAudioKb FROM media_settings WHERE planId = ?`,
              [planId]
            );
            return rows.map((r) =>
              mapPacketToMsRow({
                ...r,
                video_chunk_minutes: null,
                audio_chunk_minutes: null,
              })
            );
          } catch (err2) {
            if (isUnknownColumnErr(err2, "maxLargeVideoKb") || isUnknownColumnErr(err2, "maxLargeAudioKb")) {
              const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT mediaType, maxFileSizeKB, maxFileSizeKBLarge FROM media_settings WHERE planId = ?`,
                [planId]
              );
              return rows.map((r) =>
                mapPacketToMsRow({
                  ...r,
                  video_chunk_minutes: null,
                  audio_chunk_minutes: null,
                })
              );
            }
            throw err2;
          }
        }
        throw errKb;
      }
    }
    if (isUnknownColumnErr(err, "maxLargeVideoKb") || isUnknownColumnErr(err, "maxLargeAudioKb")) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT mediaType, maxFileSizeKB, maxFileSizeKBLarge FROM media_settings WHERE planId = ?`,
        [planId]
      );
      return rows.map((r) =>
        mapPacketToMsRow({
          ...r,
          video_chunk_minutes: null,
          audio_chunk_minutes: null,
        })
      );
    }
    if (isUnknownColumnErr(err, "maxFileSizeKBLarge")) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT mediaType, maxFileSizeKB FROM media_settings WHERE planId = ?`,
        [planId]
      );
      return rows.map((r) =>
        mapPacketToMsRow({
          ...r,
          maxFileSizeKBLarge: null,
          maxLargeVideoKb: null,
          maxLargeAudioKb: null,
          video_chunk_minutes: null,
          audio_chunk_minutes: null,
        })
      );
    }
    throw err;
  }
}

function rowsToMap(rows: MsRow[]): Map<string, MsRow> {
  const m = new Map<string, MsRow>();
  for (const r of rows) m.set(r.mediaType, r);
  return m;
}

function pickRow(map: Map<string, MsRow>, mediaType: string): MsRow {
  const direct = map.get(mediaType);
  if (direct) return direct;
  const def = map.get("default");
  if (def) return def;
  return {
    mediaType,
    maxFileSizeKB: DEFAULT_KB[mediaType] ?? DEFAULT_KB.default,
    maxLargeVideoKb: null,
    maxLargeAudioKb: null,
    videoChunkMinutes: null,
    audioChunkMinutes: null,
  };
}

function effectiveKbLarge(
  mediaType: "audio" | "video",
  row: MsRow,
  supportLargeAudio: boolean,
  supportLargeVideo: boolean
): number {
  const base = Number.isFinite(row.maxFileSizeKB) && row.maxFileSizeKB > 0 ? row.maxFileSizeKB : DEFAULT_KB[mediaType];
  if (mediaType === "audio" && supportLargeAudio) {
    if (row.maxLargeAudioKb != null && row.maxLargeAudioKb > 0) return row.maxLargeAudioKb;
    return base;
  }
  if (mediaType === "video" && supportLargeVideo) {
    if (row.maxLargeVideoKb != null && row.maxLargeVideoKb > 0) return row.maxLargeVideoKb;
    return base;
  }
  return base;
}

export async function resolvePlanIdForUserWorkspace(
  userId: number,
  workspaceGroupId: number | null,
  isAdmin: boolean
): Promise<number | null> {
  if (workspaceGroupId == null) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT planId FROM subscriptions
       WHERE type = 'individual' AND userId = ? AND ownerId = ? AND status = 'active'
       ORDER BY id DESC LIMIT 1`,
      [userId, userId]
    );
    if (!rows.length) return null;
    return Number(rows[0].planId);
  }
  await assertUserWorkspaceGroupAccess(userId, workspaceGroupId, isAdmin);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.planId FROM groups g
     INNER JOIN subscriptions s ON s.id = g.subscriptionId
     WHERE g.id = ?
     LIMIT 1`,
    [workspaceGroupId]
  );
  if (!rows.length) return null;
  return Number(rows[0].planId);
}

async function loadPlanFlags(planId: number): Promise<{ supportLargeAudio: boolean; supportLargeVideo: boolean }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT supportLargeAudio, supportLargeVideo FROM subscription_plans WHERE id = ? LIMIT 1`,
    [planId]
  );
  if (!rows.length) return { supportLargeAudio: false, supportLargeVideo: false };
  const r = rows[0];
  return {
    supportLargeAudio: r.supportLargeAudio === 1 || r.supportLargeAudio === true,
    supportLargeVideo: r.supportLargeVideo === 1 || r.supportLargeVideo === true,
  };
}

function buildLimitsFromPlan(
  rows: MsRow[],
  flags: { supportLargeAudio: boolean; supportLargeVideo: boolean }
): UserMediaLimitsResponse {
  const empty = rows.length === 0;
  const map = empty ? new Map<string, MsRow>() : rowsToMap(rows);

  const rowFor = (mt: string): MsRow =>
    empty
      ? {
          mediaType: mt,
          maxFileSizeKB: DEFAULT_KB[mt] ?? DEFAULT_KB.default,
          maxLargeVideoKb: null,
          maxLargeAudioKb: null,
          videoChunkMinutes: null,
          audioChunkMinutes: null,
        }
      : pickRow(map, mt);

  const defRow = empty
    ? {
        mediaType: "default",
        maxFileSizeKB: DEFAULT_KB.default,
        maxLargeVideoKb: null,
        maxLargeAudioKb: null,
        videoChunkMinutes: null,
        audioChunkMinutes: null,
      }
    : pickRow(map, "default");

  const simpleKb = (mt: string) => {
    const r = rowFor(mt);
    const kb =
      Number.isFinite(r.maxFileSizeKB) && r.maxFileSizeKB > 0 ? r.maxFileSizeKB : DEFAULT_KB[mt] ?? DEFAULT_KB.default;
    return Math.max(1, kb);
  };

  return {
    maxFileBytes: {
      audio: effectiveKbLarge("audio", rowFor("audio"), flags.supportLargeAudio, flags.supportLargeVideo) * 1024,
      video: effectiveKbLarge("video", rowFor("video"), flags.supportLargeAudio, flags.supportLargeVideo) * 1024,
      image: simpleKb("image") * 1024,
      document: simpleKb("document") * 1024,
      text: simpleKb("text") * 1024,
      html: simpleKb("html") * 1024,
      default: Math.max(1, defRow.maxFileSizeKB) * 1024,
    },
    supportLargeAudio: flags.supportLargeAudio,
    supportLargeVideo: flags.supportLargeVideo,
  };
}

export async function getUserMediaLimits(
  userId: number,
  workspaceGroupId: number | null,
  isAdmin: boolean
): Promise<UserMediaLimitsResponse> {
  const planId = await resolvePlanIdForUserWorkspace(userId, workspaceGroupId, isAdmin);
  if (planId == null) {
    return buildLimitsFromPlan([], { supportLargeAudio: false, supportLargeVideo: false });
  }
  const flags = await loadPlanFlags(planId);
  const rows = await loadMediaSettingsRows(planId);
  return buildLimitsFromPlan(rows, flags);
}

export async function getMaxUploadBytesForUser(
  userId: number,
  workspaceGroupId: number | null,
  isAdmin: boolean,
  mediaType: UploadClassifyMediaKind
): Promise<number> {
  const lim = await getUserMediaLimits(userId, workspaceGroupId, isAdmin);
  return lim.maxFileBytes[mediaType] ?? lim.maxFileBytes.default;
}

/**
 * Modelo B: arquivo completo até ao teto “large”; se tamanho > simples (maxFileSizeKB) e plano suporta large,
 * segmentação temporal no servidor e Whisper por segmento.
 */
export async function resolveLargeMediaSegmentedTranscription(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  kind: "audio" | "video";
  fileSizeBytes: number;
}): Promise<{ useSegmented: boolean; chunkMinutes: number }> {
  const planId = await resolvePlanIdForUserWorkspace(input.userId, input.groupId, input.isAdmin);
  if (planId == null) {
    return { useSegmented: false, chunkMinutes: clampChunkMinutes(null) };
  }
  const flags = await loadPlanFlags(planId);
  const rows = await loadMediaSettingsRows(planId);
  const map = rowsToMap(rows);
  const row = pickRow(map, input.kind);
  const standardKb =
    Number.isFinite(row.maxFileSizeKB) && row.maxFileSizeKB > 0
      ? row.maxFileSizeKB
      : DEFAULT_KB[input.kind] ?? DEFAULT_KB.default;
  const standardBytes = Math.max(1, standardKb) * 1024;
  const support = input.kind === "audio" ? flags.supportLargeAudio : flags.supportLargeVideo;
  const chunkRaw = input.kind === "audio" ? row.audioChunkMinutes : row.videoChunkMinutes;
  const chunkMinutes = clampChunkMinutes(chunkRaw);
  const uploadMax = await getMaxUploadBytesForUser(input.userId, input.groupId, input.isAdmin, input.kind);
  const useSegmented =
    support &&
    input.fileSizeBytes > standardBytes &&
    input.fileSizeBytes <= uploadMax;
  return { useSegmented, chunkMinutes };
}
