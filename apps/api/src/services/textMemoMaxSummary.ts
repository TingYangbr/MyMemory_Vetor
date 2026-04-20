import type { RowDataPacket } from "mysql2";
import { pool } from "../db.js";
import { resolvePlanIdForUserWorkspace } from "./mediaLimitsService.js";
import { assertUserWorkspaceGroupAccess } from "./memoContextService.js";

export const ABSOLUTE_CAP = 65_000;

/**
 * Limite efetivo para `memos.mediaText` em memo de texto: min entre `media_settings.maxSummaryChars` (default do plano)
 * e `groups.maxSummaryLength` (se grupo).
 */
export async function resolveMaxSummaryCharsForText(
  userId: number,
  groupId: number | null,
  isAdmin: boolean
): Promise<number> {
  if (groupId != null) {
    await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
  }
  const planId = await resolvePlanIdForUserWorkspace(userId, groupId, isAdmin);
  let fromSettings = ABSOLUTE_CAP;
  if (planId != null) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT maxSummaryChars FROM media_settings WHERE planId = ? AND mediaType = 'default' LIMIT 1`,
      [planId]
    );
    if (rows[0]?.maxSummaryChars != null) {
      const n = Number(rows[0].maxSummaryChars);
      if (Number.isFinite(n) && n > 0) fromSettings = n;
    }
  }
  if (groupId == null) {
    return Math.min(fromSettings, ABSOLUTE_CAP);
  }
  const [grows] = await pool.query<RowDataPacket[]>(
    `SELECT maxSummaryLength FROM \`groups\` WHERE id = ? LIMIT 1`,
    [groupId]
  );
  const gMax =
    grows[0]?.maxSummaryLength != null ? Number(grows[0].maxSummaryLength) : ABSOLUTE_CAP;
  const g = Number.isFinite(gMax) && gMax > 0 ? gMax : ABSOLUTE_CAP;
  return Math.min(fromSettings, g, ABSOLUTE_CAP);
}

/**
 * Limite de caracteres para `mediaText` em memos de imagem: `media_settings` linha `image`, senão `default`,
 * depois teto do grupo (como texto).
 */
export async function resolveMaxSummaryCharsForImage(
  userId: number,
  groupId: number | null,
  isAdmin: boolean
): Promise<number> {
  if (groupId != null) {
    await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
  }
  const planId = await resolvePlanIdForUserWorkspace(userId, groupId, isAdmin);
  let fromSettings = ABSOLUTE_CAP;
  if (planId != null) {
    const [imgRows] = await pool.query<RowDataPacket[]>(
      `SELECT maxSummaryChars FROM media_settings WHERE planId = ? AND mediaType = 'image' LIMIT 1`,
      [planId]
    );
    if (imgRows[0]?.maxSummaryChars != null) {
      const n = Number(imgRows[0].maxSummaryChars);
      if (Number.isFinite(n) && n > 0) fromSettings = n;
    } else {
      const [defRows] = await pool.query<RowDataPacket[]>(
        `SELECT maxSummaryChars FROM media_settings WHERE planId = ? AND mediaType = 'default' LIMIT 1`,
        [planId]
      );
      if (defRows[0]?.maxSummaryChars != null) {
        const n = Number(defRows[0].maxSummaryChars);
        if (Number.isFinite(n) && n > 0) fromSettings = n;
      }
    }
  }
  if (groupId == null) {
    return Math.min(fromSettings, ABSOLUTE_CAP);
  }
  const [grows] = await pool.query<RowDataPacket[]>(
    `SELECT maxSummaryLength FROM \`groups\` WHERE id = ? LIMIT 1`,
    [groupId]
  );
  const gMax =
    grows[0]?.maxSummaryLength != null ? Number(grows[0].maxSummaryLength) : ABSOLUTE_CAP;
  const g = Number.isFinite(gMax) && gMax > 0 ? gMax : ABSOLUTE_CAP;
  return Math.min(fromSettings, g, ABSOLUTE_CAP);
}

/**
 * Limite de `mediaText` para memos de documento: linha `document` em media_settings, senão `default`.
 */
export async function resolveMaxSummaryCharsForDocument(
  userId: number,
  groupId: number | null,
  isAdmin: boolean
): Promise<number> {
  if (groupId != null) {
    await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
  }
  const planId = await resolvePlanIdForUserWorkspace(userId, groupId, isAdmin);
  let fromSettings = ABSOLUTE_CAP;
  if (planId != null) {
    const [docRows] = await pool.query<RowDataPacket[]>(
      `SELECT maxSummaryChars FROM media_settings WHERE planId = ? AND mediaType = 'document' LIMIT 1`,
      [planId]
    );
    if (docRows[0]?.maxSummaryChars != null) {
      const n = Number(docRows[0].maxSummaryChars);
      if (Number.isFinite(n) && n > 0) fromSettings = n;
    } else {
      const [defRows] = await pool.query<RowDataPacket[]>(
        `SELECT maxSummaryChars FROM media_settings WHERE planId = ? AND mediaType = 'default' LIMIT 1`,
        [planId]
      );
      if (defRows[0]?.maxSummaryChars != null) {
        const n = Number(defRows[0].maxSummaryChars);
        if (Number.isFinite(n) && n > 0) fromSettings = n;
      }
    }
  }
  if (groupId == null) {
    return Math.min(fromSettings, ABSOLUTE_CAP);
  }
  const [grows] = await pool.query<RowDataPacket[]>(
    `SELECT maxSummaryLength FROM \`groups\` WHERE id = ? LIMIT 1`,
    [groupId]
  );
  const gMax =
    grows[0]?.maxSummaryLength != null ? Number(grows[0].maxSummaryLength) : ABSOLUTE_CAP;
  const g = Number.isFinite(gMax) && gMax > 0 ? gMax : ABSOLUTE_CAP;
  return Math.min(fromSettings, g, ABSOLUTE_CAP);
}

/**
 * Limite de `mediaText` para memos de áudio: linha `audio` em media_settings, senão `default`.
 */
export async function resolveMaxSummaryCharsForAudio(
  userId: number,
  groupId: number | null,
  isAdmin: boolean
): Promise<number> {
  if (groupId != null) {
    await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
  }
  const planId = await resolvePlanIdForUserWorkspace(userId, groupId, isAdmin);
  let fromSettings = ABSOLUTE_CAP;
  if (planId != null) {
    const [audRows] = await pool.query<RowDataPacket[]>(
      `SELECT maxSummaryChars FROM media_settings WHERE planId = ? AND mediaType = 'audio' LIMIT 1`,
      [planId]
    );
    if (audRows[0]?.maxSummaryChars != null) {
      const n = Number(audRows[0].maxSummaryChars);
      if (Number.isFinite(n) && n > 0) fromSettings = n;
    } else {
      const [defRows] = await pool.query<RowDataPacket[]>(
        `SELECT maxSummaryChars FROM media_settings WHERE planId = ? AND mediaType = 'default' LIMIT 1`,
        [planId]
      );
      if (defRows[0]?.maxSummaryChars != null) {
        const n = Number(defRows[0].maxSummaryChars);
        if (Number.isFinite(n) && n > 0) fromSettings = n;
      }
    }
  }
  if (groupId == null) {
    return Math.min(fromSettings, ABSOLUTE_CAP);
  }
  const [grows] = await pool.query<RowDataPacket[]>(
    `SELECT maxSummaryLength FROM \`groups\` WHERE id = ? LIMIT 1`,
    [groupId]
  );
  const gMax =
    grows[0]?.maxSummaryLength != null ? Number(grows[0].maxSummaryLength) : ABSOLUTE_CAP;
  const g = Number.isFinite(gMax) && gMax > 0 ? gMax : ABSOLUTE_CAP;
  return Math.min(fromSettings, g, ABSOLUTE_CAP);
}

/**
 * Limite de `mediaText` para memos de vídeo (transcrição + resumo): linha `video` em media_settings, senão `default`.
 */
export async function resolveMaxSummaryCharsForVideo(
  userId: number,
  groupId: number | null,
  isAdmin: boolean
): Promise<number> {
  if (groupId != null) {
    await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
  }
  const planId = await resolvePlanIdForUserWorkspace(userId, groupId, isAdmin);
  let fromSettings = ABSOLUTE_CAP;
  if (planId != null) {
    const [vidRows] = await pool.query<RowDataPacket[]>(
      `SELECT maxSummaryChars FROM media_settings WHERE planId = ? AND mediaType = 'video' LIMIT 1`,
      [planId]
    );
    if (vidRows[0]?.maxSummaryChars != null) {
      const n = Number(vidRows[0].maxSummaryChars);
      if (Number.isFinite(n) && n > 0) fromSettings = n;
    } else {
      const [defRows] = await pool.query<RowDataPacket[]>(
        `SELECT maxSummaryChars FROM media_settings WHERE planId = ? AND mediaType = 'default' LIMIT 1`,
        [planId]
      );
      if (defRows[0]?.maxSummaryChars != null) {
        const n = Number(defRows[0].maxSummaryChars);
        if (Number.isFinite(n) && n > 0) fromSettings = n;
      }
    }
  }
  if (groupId == null) {
    return Math.min(fromSettings, ABSOLUTE_CAP);
  }
  const [grows] = await pool.query<RowDataPacket[]>(
    `SELECT maxSummaryLength FROM \`groups\` WHERE id = ? LIMIT 1`,
    [groupId]
  );
  const gMax =
    grows[0]?.maxSummaryLength != null ? Number(grows[0].maxSummaryLength) : ABSOLUTE_CAP;
  const g = Number.isFinite(gMax) && gMax > 0 ? gMax : ABSOLUTE_CAP;
  return Math.min(fromSettings, g, ABSOLUTE_CAP);
}

/** Mínimo de caracteres de OCR na imagem para acionar o fluxo de texto (`media_settings.image`). */
export async function resolveTextImagemMinForPlan(
  userId: number,
  groupId: number | null,
  isAdmin: boolean
): Promise<number> {
  const planId = await resolvePlanIdForUserWorkspace(userId, groupId, isAdmin);
  const fallback = 100;
  if (planId == null) return fallback;
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT textImagemMin FROM media_settings WHERE planId = ? AND mediaType = 'image' LIMIT 1`,
      [planId]
    );
    const n = rows[0]?.textImagemMin;
    if (n == null) return fallback;
    const v = Number(n);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function clampTextToMax(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

/** Regra comum para instruções de `resumo_pt_br` nos prompts (limite alinhado a `media_settings`). */
export function resumoPtBrPromptRule(maxSummaryChars: number): string {
  return `resumo_pt_br deve ser fiel ao conteúdo original, conter as informações mais relevantes e respeitar limite máximo de ${maxSummaryChars} caracteres.`;
}
