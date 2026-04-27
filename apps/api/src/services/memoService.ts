import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  AudioMemoProcessSource,
  MemoAuthorEditResponse,
  MemoCreatedResponse,
  MemoMediaTypeDb,
  MemoRecentCard,
  PhotoAiUsage,
  UserIaUseLevel,
  VideoMemoProcessSource,
} from "@mymemory/shared";
import { dedupeMemoKeywordsCommaSeparated } from "@mymemory/shared";
import type { RowDataPacket, ResultSetHeader } from "../lib/dbTypes.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import { assertUserWorkspaceGroupAccess } from "./memoContextService.js";
import { getMaxUploadBytesForUser } from "./mediaLimitsService.js";
import { uploadsAbsolutePath } from "../paths.js";
import { upsertMemoChunks } from "../lib/openaiEmbedding.js";
import { attachmentDisplayNameFromMemoLike } from "../lib/memoAttachmentDisplayName.js";
import { classifyFile, guessMimeFromFilename, safeBasename } from "../lib/media.js";
import { insertMemoS3DownloadLog } from "./downloadLogService.js";
import {
  downloadMemoObjectFromS3,
  tryExtractMemoS3KeyFromPublicUrl,
} from "./s3MediaStorage.js";
import { creditsFromUsdCost, getUsdToCreditsMultiplier } from "./systemConfigService.js";
import { loadDocumentRoutingConfig, resolveDocumentPipeline } from "./documentRoutingService.js";

const ORIGINAL_TEXT_META_MAX = 65_000;

function truncateOriginalTextForMeta(s: string): string {
  return s.length <= ORIGINAL_TEXT_META_MAX ? s : s.slice(0, ORIGINAL_TEXT_META_MAX);
}

function keywordsForStorage(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  const d = dedupeMemoKeywordsCommaSeparated(t);
  return d.length ? d : null;
}

function numDb(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Aceita apenas object JSON plano (campos chave → valor escalar) para `memos.dadosEspecificosJson`. */
export function normalizeDadosEspecificosJson(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      const key = k.trim();
      if (!key || key.length > 200) continue;
      if (v == null) out[key] = "";
      else if (typeof v === "string") out[key] = v;
      else if (typeof v === "number" || typeof v === "boolean") out[key] = String(v);
    }
    return Object.keys(out).length ? JSON.stringify(out) : null;
  } catch {
    return null;
  }
}

function parseDadosEspecificosMap(raw: string | null | undefined): Record<string, string> {
  const t = raw?.trim();
  if (!t) return {};
  try {
    const j = JSON.parse(t) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      const key = k.trim();
      if (!key || key.length > 200) continue;
      if (v == null) out[key] = "";
      else if (typeof v === "string") out[key] = v.trim();
      else if (typeof v === "number" || typeof v === "boolean") out[key] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

async function resolveDadosCategory(input: {
  groupId: number | null;
  mediaType: MemoMediaTypeDb;
  explicitCategoryId?: number | null;
  dadosLabels: string[];
}): Promise<number | null> {
  if (input.explicitCategoryId != null) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM categories
       WHERE id = ?
         AND groupId IS NOT DISTINCT FROM ?
         AND isActive = 1
         AND (mediaType IS NULL OR mediaType = ?) LIMIT 1`,
      [input.explicitCategoryId, input.groupId, input.mediaType]
    );
    if (rows[0]?.id) return Number(rows[0].id);
  }
  if (!input.dadosLabels.length) return null;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id AS categoryId, cc.name AS campoName
     FROM categories c
     INNER JOIN categorycampos cc ON cc.categoryId = c.id AND cc.isActive = 1
     WHERE c.isActive = 1
       AND c.groupId IS NOT DISTINCT FROM ?
       AND (c.mediaType IS NULL OR c.mediaType = ?)`,
    [input.groupId, input.mediaType]
  );

  const categoryScore = new Map<number, number>();
  const labels = new Set(input.dadosLabels.map((x) => x.toLowerCase()));
  for (const r of rows) {
    const cid = Number(r.categoryId);
    const campo = String(r.campoName ?? "").trim().toLowerCase();
    if (!campo || !labels.has(campo)) continue;
    categoryScore.set(cid, (categoryScore.get(cid) ?? 0) + 1);
  }
  let winner: number | null = null;
  let winnerScore = 0;
  for (const [cid, score] of categoryScore.entries()) {
    if (score > winnerScore) {
      winner = cid;
      winnerScore = score;
    }
  }
  if (winner != null) return winner;

  if (input.groupId != null) {
    return resolveDadosCategory({
      ...input,
      groupId: null,
      explicitCategoryId: null,
    });
  }
  return null;
}

async function syncMemoDadosEspecificosRows(input: {
  memoId: number;
  groupId: number | null;
  mediaType: MemoMediaTypeDb;
  explicitCategoryId?: number | null;
  dadosEspecificosJson: string | null;
  dadosEspecificosOriginaisJson?: string | null;
}): Promise<void> {
  const normalizedMap = parseDadosEspecificosMap(input.dadosEspecificosJson);
  const originalMap = parseDadosEspecificosMap(input.dadosEspecificosOriginaisJson);
  const labels = Object.keys(normalizedMap);
  const categoryId = await resolveDadosCategory({
    groupId: input.groupId,
    mediaType: input.mediaType,
    explicitCategoryId: input.explicitCategoryId ?? null,
    dadosLabels: labels,
  });

  await pool.query(`DELETE FROM dadosespecificos WHERE id_memo = ?`, [input.memoId]);
  if (categoryId == null) return;

  const [fieldRows] = await pool.query<RowDataPacket[]>(
    `SELECT name FROM categorycampos WHERE categoryId = ? AND isActive = 1 ORDER BY id ASC`,
    [categoryId]
  );
  if (!fieldRows.length) return;

  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const row of fieldRows) {
    const label = String(row.name ?? "").trim();
    if (!label) continue;
    const originalRaw = originalMap[label] ?? normalizedMap[label] ?? null;
    const normalizedRaw = normalizedMap[label] ?? null;
    tuples.push("(?, ?, ?, ?, ?, ?)");
    values.push(
      categoryId,
      input.memoId,
      label,
      originalRaw && originalRaw.trim() ? originalRaw.trim() : null,
      normalizedRaw && normalizedRaw.trim() ? normalizedRaw.trim() : null,
      1
    );
  }
  if (!tuples.length) return;

  await pool.query(
    `INSERT INTO dadosespecificos (id_categoria, id_memo, label, dadooriginal, dadopadronizado, isactive)
     VALUES ${tuples.join(",")}`,
    values
  );
}

async function trySyncMemoDadosEspecificosRows(input: {
  memoId: number;
  groupId: number | null;
  mediaType: MemoMediaTypeDb;
  explicitCategoryId?: number | null;
  dadosEspecificosJson: string | null;
  dadosEspecificosOriginaisJson?: string | null;
}): Promise<void> {
  try {
    await syncMemoDadosEspecificosRows(input);
  } catch {
    // Migração ainda não aplicada ou tabela ausente: manter salvamento do memo.
  }
}

async function ensureUploadsDir(sub: string) {
  const dir = path.join(uploadsAbsolutePath(), sub);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function publicMediaPath(userId: number, storedName: string): string {
  return `/media/${userId}/${storedName}`;
}

/** Grava buffer no S3 ou disco local; retorna URL pública/relativa usada em `memos.media*Url`. */
export async function storeMemoBinaryAndGetUrl(input: {
  userId: number;
  buffer: Buffer;
  mime: string;
  originalName: string;
}): Promise<{ mediaUrl: string; storedName: string }> {
  const id = crypto.randomUUID();
  const base = safeBasename(input.originalName);
  const storedName = `${id}-${base}`;
  if (config.mediaStorage === "s3") {
    const { uploadMemoFileToS3 } = await import("./s3MediaStorage.js");
    const mediaUrl = await uploadMemoFileToS3({
      userId: input.userId,
      buffer: input.buffer,
      contentType: input.mime || "application/octet-stream",
      storedName,
    });
    return { mediaUrl, storedName };
  }
  const userDir = await ensureUploadsDir(String(input.userId));
  const absPath = path.join(userDir, storedName);
  await fs.writeFile(absPath, input.buffer);
  return { mediaUrl: publicMediaPath(input.userId, storedName), storedName };
}

/** Evita confirmar memo com URL de mídia de outro usuário (imagem, áudio, etc.). */
export function assertMemoImageUrlBelongsToUser(url: string, userId: number): void {
  const u = url.trim();
  if (!u) throw new Error("invalid_image_url");
  const needle = `/${userId}/`;
  if (!u.includes(needle)) throw new Error("invalid_image_url");
  const okPath =
    u.includes("/media/") ||
    u.includes("/memos/") ||
    u.includes("amazonaws.com") ||
    u.includes("digitaloceanspaces.com") ||
    u.startsWith("/media/");
  if (!okPath) throw new Error("invalid_image_url");
}

export function assertMemoAudioUrlBelongsToUser(url: string, userId: number): void {
  assertMemoImageUrlBelongsToUser(url, userId);
}

/** Quem pode baixar `/media/{authorUserId}/{storedFileName}`: autor, membro do grupo do memo ou admin. */
export async function canAccessMemoMediaForDownload(input: {
  viewerId: number;
  authorUserId: number;
  storedFileName: string;
  isAdmin: boolean;
}): Promise<boolean> {
  const { storedFileName } = input;
  if (!storedFileName || storedFileName.includes("..") || storedFileName.includes("/") || storedFileName.includes("\\")) {
    return false;
  }
  const relPath = `/media/${input.authorUserId}/${storedFileName}`;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT userId, groupId FROM memos
     WHERE isActive = 1
       AND (
         mediaAudioUrl IS NOT DISTINCT FROM ?
         OR mediaImageUrl IS NOT DISTINCT FROM ?
         OR mediaVideoUrl IS NOT DISTINCT FROM ?
         OR mediaDocumentUrl IS NOT DISTINCT FROM ?
       )
     LIMIT 1`,
    [relPath, relPath, relPath, relPath]
  );
  const row = rows[0] as { userId: number; groupId: number | null } | undefined;
  if (!row) return false;
  if (input.isAdmin) return true;
  if (row.groupId == null) return row.userId === input.viewerId;
  try {
    await assertUserWorkspaceGroupAccess(input.viewerId, row.groupId, input.isAdmin);
    return true;
  } catch {
    return false;
  }
}

function buildMediaText(note: string | undefined, fallback: string): string {
  const n = note?.trim();
  if (n) return n;
  return fallback;
}

async function validateMemoWorkspaceGroup(
  userId: number,
  groupId: number | null,
  isAdmin: boolean
): Promise<void> {
  if (groupId == null) return;
  await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
}

function defaultCaptionForUpload(mediaType: MemoMediaTypeDb, aiUsage?: PhotoAiUsage): string {
  if (mediaType === "image") {
    if (aiUsage === "keywords") return "(Imagem — extração de keywords por IA pendente.)";
    if (aiUsage === "full") return "(Imagem — análise completa por IA pendente.)";
    return "(Imagem registrada — sem processamento por IA.)";
  }
  if (aiUsage === "none") return "(Conteúdo multimídia — sem processamento por IA.)";
  if (aiUsage === "keywords") return "(Conteúdo multimídia — extração de keywords por IA pendente.)";
  if (aiUsage === "full") return "(Conteúdo multimídia — processamento completo por IA pendente.)";
  return "(Conteúdo multimídia — processamento por IA pendente.)";
}

export async function createMemoFromUpload(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  buffer: Buffer;
  originalName: string;
  mime: string;
  note?: string;
  /** Só aplica legenda/metadata específicos quando a mídia é classificada como imagem. */
  aiUsage?: PhotoAiUsage;
}): Promise<MemoCreatedResponse> {
  await validateMemoWorkspaceGroup(input.userId, input.groupId, input.isAdmin);
  const mediaType = classifyFile(input.mime, input.originalName);
  const maxBytes = await getMaxUploadBytesForUser(input.userId, input.groupId, input.isAdmin, mediaType);
  if (input.buffer.length > maxBytes) {
    const err = new Error("file_too_large");
    (err as Error & { maxBytes?: number }).maxBytes = maxBytes;
    throw err;
  }
  if (mediaType === "document") {
    const routing = await loadDocumentRoutingConfig();
    const pipeline = resolveDocumentPipeline(input.mime, path.extname(input.originalName) || ".bin", routing);
    if (pipeline === "unsupported") throw new Error("document_unsupported_format");
  }
  const { mediaUrl: rel } = await storeMemoBinaryAndGetUrl({
    userId: input.userId,
    buffer: input.buffer,
    mime: input.mime,
    originalName: input.originalName,
  });
  const mediaText = buildMediaText(input.note, defaultCaptionForUpload(mediaType, input.aiUsage));
  const metadata = JSON.stringify({
    originalName: input.originalName,
    mime: input.mime,
    size: input.buffer.length,
    aiUsage: input.aiUsage ?? "none",
  });

  const cols = {
    audio: "mediaAudioUrl",
    image: "mediaImageUrl",
    video: "mediaVideoUrl",
    document: "mediaDocumentUrl",
  } as const;
  const urlCol = cols[mediaType];

  const sql = `
    INSERT INTO memos (
      userId, groupId, mediaType,
      mediaAudioUrl, mediaImageUrl, mediaVideoUrl, mediaDocumentUrl, mediaWebUrl,
      mediaText, mediaMetadata, tamMediaUrl, isActive
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `;
  const [memoRows] = await pool.query<{ id: number }[]>(`${sql} RETURNING id`, [
    input.userId,
    input.groupId,
    mediaType,
    mediaType === "audio" ? rel : null,
    mediaType === "image" ? rel : null,
    mediaType === "video" ? rel : null,
    mediaType === "document" ? rel : null,
    null,
    mediaText,
    metadata,
    input.buffer.length,
  ]);

  const memoId = memoRows[0].id;
  const row = await getMemoById(memoId, input.userId);
  if (!row) throw new Error("insert_failed");
  return rowToCreated(row);
}

export async function createMemoText(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  mediaText: string;
  aiUsage?: PhotoAiUsage;
}): Promise<MemoCreatedResponse> {
  await validateMemoWorkspaceGroup(input.userId, input.groupId, input.isAdmin);
  const mediaMetadata =
    input.aiUsage != null ? JSON.stringify({ aiUsage: input.aiUsage }) : null;
  const sql = `
    INSERT INTO memos (
      userId, groupId, mediaType,
      mediaAudioUrl, mediaImageUrl, mediaVideoUrl, mediaDocumentUrl, mediaWebUrl,
      mediaText, mediaMetadata, isActive
    ) VALUES (?, ?, 'text', NULL, NULL, NULL, NULL, NULL, ?, ?, 1)
  `;
  const [memoRows] = await pool.query<{ id: number }[]>(`${sql} RETURNING id`, [
    input.userId,
    input.groupId,
    input.mediaText.trim(),
    mediaMetadata,
  ]);
  const row = await getMemoById(memoRows[0].id, input.userId);
  if (!row) throw new Error("insert_failed");
  return rowToCreated(row);
}

export async function createMemoTextReviewed(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  mediaText: string;
  keywords: string | null;
  dadosEspecificosJson?: string | null;
  dadosEspecificosOriginaisJson?: string | null;
  matchedCategoryId?: number | null;
  apiCost: number;
  iaLevel: UserIaUseLevel;
  originalText: string;
}): Promise<MemoCreatedResponse> {
  await validateMemoWorkspaceGroup(input.userId, input.groupId, input.isAdmin);
  const tam = Buffer.byteLength(input.originalText, "utf8");
  const meta = JSON.stringify({
    iaUseTexto: input.iaLevel,
    originalText: truncateOriginalTextForMeta(input.originalText),
    reviewFlow: "text_v1",
  });
  const cost = Number.isFinite(input.apiCost) && input.apiCost >= 0 ? input.apiCost : 0;
  const mult = await getUsdToCreditsMultiplier();
  const usedCred = creditsFromUsdCost(cost, mult);
  const kw = keywordsForStorage(input.keywords);
  const dadosJson = normalizeDadosEspecificosJson(input.dadosEspecificosJson);
  const text = input.mediaText.trim();
  const sql = `
    INSERT INTO memos (
      userId, groupId, mediaType,
      mediaAudioUrl, mediaImageUrl, mediaVideoUrl, mediaDocumentUrl, mediaWebUrl,
      mediaText, keywords, dadosEspecificosJson, mediaMetadata, apiCost, usedApiCred, tamMediaUrl, isActive
    ) VALUES (?, ?, 'text', NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 1)
  `;
  const [memoRows] = await pool.query<{ id: number }[]>(`${sql} RETURNING id`, [
    input.userId,
    input.groupId,
    text,
    kw,
    dadosJson,
    meta,
    cost,
    usedCred,
    tam,
  ]);
  const memoId = memoRows[0].id;
  await trySyncMemoDadosEspecificosRows({
    memoId,
    groupId: input.groupId,
    mediaType: "text",
    explicitCategoryId: input.matchedCategoryId ?? null,
    dadosEspecificosJson: dadosJson,
    dadosEspecificosOriginaisJson: normalizeDadosEspecificosJson(input.dadosEspecificosOriginaisJson),
  });
  if (cost > 0) {
    try {
      await pool.query(
        `INSERT INTO api_usage_logs (memoId, userId, operation, model, inputTokens, outputTokens, totalTokens, costUsd)
         VALUES (?, ?, 'memo_text_ia', 'aggregate', 0, 0, 0, ?)`,
        [memoId, input.userId, cost]
      );
    } catch {
      /* tabela opcional / ambiente sem FK */
    }
  }
  if (input.iaLevel === "completo") {
    upsertMemoChunks({ memoId, mediaText: text, keywords: kw, dadosEspecificosJson: dadosJson }).catch(() => {});
  }
  const row = await getMemoById(memoId, input.userId);
  if (!row) throw new Error("insert_failed");
  return rowToCreated(row);
}

export async function createMemoUrlReviewed(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  mediaWebUrl: string;
  /** HTML arquivado (memo `url`) — coluna `mediaDocumentUrl`; omitido = NULL. */
  mediaDocumentUrl?: string | null;
  mediaText: string;
  keywords: string | null;
  dadosEspecificosJson?: string | null;
  dadosEspecificosOriginaisJson?: string | null;
  matchedCategoryId?: number | null;
  apiCost: number;
  iaLevel: UserIaUseLevel;
  originalText: string;
}): Promise<MemoCreatedResponse> {
  const archive = input.mediaDocumentUrl?.trim() ?? null;
  if (archive) assertMemoImageUrlBelongsToUser(archive, input.userId);
  await validateMemoWorkspaceGroup(input.userId, input.groupId, input.isAdmin);
  const href = input.mediaWebUrl.trim();
  const meta = JSON.stringify({
    iaUseUrl: input.iaLevel,
    originalText: truncateOriginalTextForMeta(input.originalText),
    reviewFlow: "url_v1",
  });
  const cost = Number.isFinite(input.apiCost) && input.apiCost >= 0 ? input.apiCost : 0;
  const mult = await getUsdToCreditsMultiplier();
  const usedCred = creditsFromUsdCost(cost, mult);
  const kw = keywordsForStorage(input.keywords);
  const dadosJson = normalizeDadosEspecificosJson(input.dadosEspecificosJson);
  const text = input.mediaText.trim();
  const tam = Buffer.byteLength(input.originalText, "utf8");
  const sql = `
    INSERT INTO memos (
      userId, groupId, mediaType,
      mediaAudioUrl, mediaImageUrl, mediaVideoUrl, mediaDocumentUrl, mediaWebUrl,
      mediaText, keywords, dadosEspecificosJson, mediaMetadata, apiCost, usedApiCred, tamMediaUrl, isActive
    ) VALUES (?, ?, 'url', NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `;
  const [memoRows] = await pool.query<{ id: number }[]>(`${sql} RETURNING id`, [
    input.userId,
    input.groupId,
    archive,
    href,
    text,
    kw,
    dadosJson,
    meta,
    cost,
    usedCred,
    tam,
  ]);
  const memoId = memoRows[0].id;
  await trySyncMemoDadosEspecificosRows({
    memoId,
    groupId: input.groupId,
    mediaType: "url",
    explicitCategoryId: input.matchedCategoryId ?? null,
    dadosEspecificosJson: dadosJson,
    dadosEspecificosOriginaisJson: normalizeDadosEspecificosJson(input.dadosEspecificosOriginaisJson),
  });
  if (cost > 0) {
    try {
      await pool.query(
        `INSERT INTO api_usage_logs (memoId, userId, operation, model, inputTokens, outputTokens, totalTokens, costUsd)
         VALUES (?, ?, 'memo_url_ia', 'aggregate', 0, 0, 0, ?)`,
        [memoId, input.userId, cost]
      );
    } catch {
      /* tabela opcional / ambiente sem FK */
    }
  }
  if (input.iaLevel === "completo") {
    upsertMemoChunks({ memoId, mediaText: text, keywords: kw, dadosEspecificosJson: dadosJson }).catch(() => {});
  }
  const row = await getMemoById(memoId, input.userId);
  if (!row) throw new Error("insert_failed");
  return rowToCreated(row);
}

export async function createMemoImageReviewed(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  mediaImageUrl: string;
  mediaText: string;
  keywords: string | null;
  dadosEspecificosJson?: string | null;
  dadosEspecificosOriginaisJson?: string | null;
  matchedCategoryId?: number | null;
  apiCost: number;
  iaLevel: UserIaUseLevel;
  originalText: string;
  tamMediaUrl: number;
  originalFilename: string;
  source: "none" | "ocr_text" | "vision_basic" | "vision_full";
}): Promise<MemoCreatedResponse> {
  assertMemoImageUrlBelongsToUser(input.mediaImageUrl, input.userId);
  await validateMemoWorkspaceGroup(input.userId, input.groupId, input.isAdmin);
  const meta = JSON.stringify({
    iaUseImagem: input.iaLevel,
    originalText: truncateOriginalTextForMeta(input.originalText),
    reviewFlow: "image_v1",
    source: input.source,
    originalFilename: input.originalFilename,
  });
  const cost = Number.isFinite(input.apiCost) && input.apiCost >= 0 ? input.apiCost : 0;
  const mult = await getUsdToCreditsMultiplier();
  const usedCred = creditsFromUsdCost(cost, mult);
  const kw = keywordsForStorage(input.keywords);
  const dadosJson = normalizeDadosEspecificosJson(input.dadosEspecificosJson);
  const text = input.mediaText.trim();
  const tam = Number.isFinite(input.tamMediaUrl) && input.tamMediaUrl > 0 ? Math.floor(input.tamMediaUrl) : 0;
  const sql = `
    INSERT INTO memos (
      userId, groupId, mediaType,
      mediaAudioUrl, mediaImageUrl, mediaVideoUrl, mediaDocumentUrl, mediaWebUrl,
      mediaText, keywords, dadosEspecificosJson, mediaMetadata, apiCost, usedApiCred, tamMediaUrl, isActive
    ) VALUES (?, ?, 'image', NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 1)
  `;
  const [memoRows] = await pool.query<{ id: number }[]>(`${sql} RETURNING id`, [
    input.userId,
    input.groupId,
    input.mediaImageUrl.trim(),
    text,
    kw,
    dadosJson,
    meta,
    cost,
    usedCred,
    tam,
  ]);
  const memoId = memoRows[0].id;
  await trySyncMemoDadosEspecificosRows({
    memoId,
    groupId: input.groupId,
    mediaType: "image",
    explicitCategoryId: input.matchedCategoryId ?? null,
    dadosEspecificosJson: dadosJson,
    dadosEspecificosOriginaisJson: normalizeDadosEspecificosJson(input.dadosEspecificosOriginaisJson),
  });
  if (cost > 0) {
    try {
      await pool.query(
        `INSERT INTO api_usage_logs (memoId, userId, operation, model, inputTokens, outputTokens, totalTokens, costUsd)
         VALUES (?, ?, 'memo_image_ia', 'aggregate', 0, 0, 0, ?)`,
        [memoId, input.userId, cost]
      );
    } catch {
      /* opcional */
    }
  }
  if (input.iaLevel === "completo") {
    upsertMemoChunks({ memoId, mediaText: text, keywords: kw, dadosEspecificosJson: dadosJson }).catch(() => {});
  }
  const row = await getMemoById(memoId, input.userId);
  if (!row) throw new Error("insert_failed");
  return rowToCreated(row);
}

export async function createMemoAudioReviewed(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  mediaAudioUrl: string;
  mediaText: string;
  keywords: string | null;
  dadosEspecificosJson?: string | null;
  dadosEspecificosOriginaisJson?: string | null;
  matchedCategoryId?: number | null;
  apiCost: number;
  iaLevel: UserIaUseLevel;
  originalText: string;
  tamMediaUrl: number;
  originalFilename: string;
  source: AudioMemoProcessSource;
}): Promise<MemoCreatedResponse> {
  assertMemoAudioUrlBelongsToUser(input.mediaAudioUrl, input.userId);
  await validateMemoWorkspaceGroup(input.userId, input.groupId, input.isAdmin);
  const meta = JSON.stringify({
    iaUseAudio: input.iaLevel,
    originalText: truncateOriginalTextForMeta(input.originalText),
    reviewFlow: "audio_v1",
    source: input.source,
    originalFilename: input.originalFilename,
  });
  const cost = Number.isFinite(input.apiCost) && input.apiCost >= 0 ? input.apiCost : 0;
  const mult = await getUsdToCreditsMultiplier();
  const usedCred = creditsFromUsdCost(cost, mult);
  const kw = keywordsForStorage(input.keywords);
  const dadosJson = normalizeDadosEspecificosJson(input.dadosEspecificosJson);
  const text = input.mediaText.trim();
  const tam = Number.isFinite(input.tamMediaUrl) && input.tamMediaUrl > 0 ? Math.floor(input.tamMediaUrl) : 0;
  const sql = `
    INSERT INTO memos (
      userId, groupId, mediaType,
      mediaAudioUrl, mediaImageUrl, mediaVideoUrl, mediaDocumentUrl, mediaWebUrl,
      mediaText, keywords, dadosEspecificosJson, mediaMetadata, apiCost, usedApiCred, tamMediaUrl, isActive
    ) VALUES (?, ?, 'audio', ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 1)
  `;
  const [memoRows] = await pool.query<{ id: number }[]>(`${sql} RETURNING id`, [
    input.userId,
    input.groupId,
    input.mediaAudioUrl.trim(),
    text,
    kw,
    dadosJson,
    meta,
    cost,
    usedCred,
    tam,
  ]);
  const memoId = memoRows[0].id;
  await trySyncMemoDadosEspecificosRows({
    memoId,
    groupId: input.groupId,
    mediaType: "audio",
    explicitCategoryId: input.matchedCategoryId ?? null,
    dadosEspecificosJson: dadosJson,
    dadosEspecificosOriginaisJson: normalizeDadosEspecificosJson(input.dadosEspecificosOriginaisJson),
  });
  if (cost > 0) {
    try {
      await pool.query(
        `INSERT INTO api_usage_logs (memoId, userId, operation, model, inputTokens, outputTokens, totalTokens, costUsd)
         VALUES (?, ?, 'memo_audio_ia', 'aggregate', 0, 0, 0, ?)`,
        [memoId, input.userId, cost]
      );
    } catch {
      /* opcional */
    }
  }
  if (input.iaLevel === "completo") {
    upsertMemoChunks({ memoId, mediaText: text, keywords: kw, dadosEspecificosJson: dadosJson }).catch(() => {});
  }
  const row = await getMemoById(memoId, input.userId);
  if (!row) throw new Error("insert_failed");
  return rowToCreated(row);
}

export async function createMemoVideoReviewed(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  mediaVideoUrl: string;
  mediaText: string;
  keywords: string | null;
  apiCost: number;
  iaLevel: UserIaUseLevel;
  originalText: string;
  tamMediaUrl: number;
  originalFilename: string;
  source: VideoMemoProcessSource;
}): Promise<MemoCreatedResponse> {
  assertMemoImageUrlBelongsToUser(input.mediaVideoUrl, input.userId);
  await validateMemoWorkspaceGroup(input.userId, input.groupId, input.isAdmin);
  const meta = JSON.stringify({
    iaUseVideo: input.iaLevel,
    originalText: truncateOriginalTextForMeta(input.originalText),
    reviewFlow: "video_v1",
    source: input.source,
    originalFilename: input.originalFilename,
  });
  const cost = Number.isFinite(input.apiCost) && input.apiCost >= 0 ? input.apiCost : 0;
  const mult = await getUsdToCreditsMultiplier();
  const usedCred = creditsFromUsdCost(cost, mult);
  const kw = keywordsForStorage(input.keywords);
  const text = input.mediaText.trim();
  const tam = Number.isFinite(input.tamMediaUrl) && input.tamMediaUrl > 0 ? Math.floor(input.tamMediaUrl) : 0;
  const sql = `
    INSERT INTO memos (
      userId, groupId, mediaType,
      mediaAudioUrl, mediaImageUrl, mediaVideoUrl, mediaDocumentUrl, mediaWebUrl,
      mediaText, keywords, mediaMetadata, apiCost, usedApiCred, tamMediaUrl, isActive
    ) VALUES (?, ?, 'video', NULL, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, 1)
  `;
  const [memoRows] = await pool.query<{ id: number }[]>(`${sql} RETURNING id`, [
    input.userId,
    input.groupId,
    input.mediaVideoUrl.trim(),
    text,
    kw,
    meta,
    cost,
    usedCred,
    tam,
  ]);
  const memoId = memoRows[0].id;
  if (cost > 0) {
    try {
      await pool.query(
        `INSERT INTO api_usage_logs (memoId, userId, operation, model, inputTokens, outputTokens, totalTokens, costUsd)
         VALUES (?, ?, 'memo_video_ia', 'aggregate', 0, 0, 0, ?)`,
        [memoId, input.userId, cost]
      );
    } catch {
      /* opcional */
    }
  }
  if (input.iaLevel === "completo") {
    upsertMemoChunks({ memoId, mediaText: text, keywords: kw, dadosEspecificosJson: null }).catch(() => {});
  }
  const row = await getMemoById(memoId, input.userId);
  if (!row) throw new Error("insert_failed");
  return rowToCreated(row);
}

export async function createMemoUrl(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  mediaWebUrl: string;
  note?: string;
  aiUsage?: PhotoAiUsage;
}): Promise<MemoCreatedResponse> {
  await validateMemoWorkspaceGroup(input.userId, input.groupId, input.isAdmin);
  const urlDefault =
    input.aiUsage === "none"
      ? "(Página / URL registrada — sem enriquecimento por IA.)"
      : input.aiUsage === "keywords"
        ? "(Página / URL — extração de keywords por IA pendente.)"
        : input.aiUsage === "full"
          ? "(Página / URL — processamento completo por IA pendente.)"
          : "(Página / URL registrada — enriquecimento por IA pendente.)";
  const mediaText = buildMediaText(input.note, urlDefault);
  const metadata = JSON.stringify({
    url: input.mediaWebUrl,
    ...(input.aiUsage != null ? { aiUsage: input.aiUsage } : {}),
  });
  const sql = `
    INSERT INTO memos (
      userId, groupId, mediaType,
      mediaAudioUrl, mediaImageUrl, mediaVideoUrl, mediaDocumentUrl, mediaWebUrl,
      mediaText, mediaMetadata, isActive
    ) VALUES (?, ?, 'url', NULL, NULL, NULL, NULL, ?, ?, ?, 1)
  `;
  const [memoRows] = await pool.query<{ id: number }[]>(`${sql} RETURNING id`, [
    input.userId,
    input.groupId,
    input.mediaWebUrl.trim(),
    mediaText,
    metadata,
  ]);
  const row = await getMemoById(memoRows[0].id, input.userId);
  if (!row) throw new Error("insert_failed");
  return rowToCreated(row);
}

interface MemoRow extends RowDataPacket {
  id: number;
  userId: number;
  groupId: number | null;
  mediaType: MemoMediaTypeDb;
  mediaText: string;
  mediaWebUrl: string | null;
  mediaAudioUrl: string | null;
  mediaImageUrl: string | null;
  mediaVideoUrl: string | null;
  mediaDocumentUrl: string | null;
  createdAt: Date;
  mediaMetadata: string | null;
  keywords: string | null;
  dadosEspecificosJson?: string | null;
  tamMediaUrl?: number | null;
  apiCost?: unknown;
  usedApiCred?: unknown;
  hasChunks?: unknown;
}

function primaryMediaFileUrl(
  r: Pick<
    MemoRow,
    | "mediaType"
    | "mediaImageUrl"
    | "mediaVideoUrl"
    | "mediaAudioUrl"
    | "mediaDocumentUrl"
  >
): string | null {
  if (r.mediaType === "url" && r.mediaDocumentUrl?.trim()) return r.mediaDocumentUrl.trim();
  const u =
    r.mediaImageUrl?.trim() ||
    r.mediaVideoUrl?.trim() ||
    r.mediaAudioUrl?.trim() ||
    r.mediaDocumentUrl?.trim() ||
    "";
  return u || null;
}

async function getMemoById(id: number, userId: number): Promise<MemoRow | null> {
  const [rows] = await pool.query<MemoRow[]>(
    `SELECT id, userId, groupId, mediaType, mediaText, mediaWebUrl,
            mediaAudioUrl, mediaImageUrl, mediaVideoUrl, mediaDocumentUrl,
            createdAt, mediaMetadata, keywords, dadosEspecificosJson
     FROM memos WHERE id = ? AND userId = ? AND isActive = 1`,
    [id, userId]
  );
  return rows[0] ?? null;
}

/** Carrega memo ativo e garante que o usuário é o autor e tem acesso ao grupo (se aplicável). */
async function assertMemoAuthorCanModify(
  memoId: number,
  userId: number,
  isAdmin: boolean
): Promise<MemoRow> {
  const [rows] = await pool.query<MemoRow[]>(
    `SELECT id, userId, groupId, mediaType, mediaText, mediaWebUrl,
            mediaAudioUrl, mediaImageUrl, mediaVideoUrl, mediaDocumentUrl,
            createdAt, mediaMetadata, keywords, dadosEspecificosJson, tamMediaUrl, apiCost, usedApiCred
     FROM memos WHERE id = ? AND isActive = 1`,
    [memoId]
  );
  const m = rows[0];
  if (!m) throw new Error("not_found");
  if (m.userId !== userId) throw new Error("forbidden");
  if (m.groupId != null) {
    await assertUserWorkspaceGroupAccess(userId, m.groupId, isAdmin);
  }
  return m;
}

export async function getMemoForAuthorEdit(input: {
  memoId: number;
  userId: number;
  isAdmin: boolean;
}): Promise<MemoAuthorEditResponse> {
  const m = await assertMemoAuthorCanModify(input.memoId, input.userId, input.isAdmin);
  return {
    id: m.id,
    mediaType: m.mediaType,
    groupId: m.groupId,
    mediaText: m.mediaText ?? "",
    keywords: m.keywords ?? null,
    dadosEspecificosJson: m.dadosEspecificosJson ?? null,
    mediaMetadata: m.mediaMetadata ?? null,
    apiCost: numDb(m.apiCost),
    usedApiCred: numDb(m.usedApiCred),
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
    mediaWebUrl: m.mediaWebUrl,
    hasFile: Boolean(m.mediaAudioUrl || m.mediaImageUrl || m.mediaVideoUrl || m.mediaDocumentUrl),
    mediaFileUrl: primaryMediaFileUrl(m),
  };
}

export async function updateMemoForUser(input: {
  memoId: number;
  userId: number;
  isAdmin: boolean;
  mediaText?: string;
  keywords?: string | null;
  dadosEspecificosJson?: string | null;
  dadosEspecificosOriginaisJson?: string | null;
  matchedCategoryId?: number | null;
}): Promise<MemoCreatedResponse> {
  const current = await assertMemoAuthorCanModify(input.memoId, input.userId, input.isAdmin);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (input.mediaText !== undefined) {
    sets.push("mediaText = ?");
    vals.push(input.mediaText.trim());
  }
  if (input.keywords !== undefined) {
    sets.push("keywords = ?");
    vals.push(keywordsForStorage(input.keywords));
  }
  if (input.dadosEspecificosJson !== undefined) {
    sets.push("dadosEspecificosJson = ?");
    vals.push(normalizeDadosEspecificosJson(input.dadosEspecificosJson));
  }
  if (!sets.length) {
    const row = await getMemoById(input.memoId, input.userId);
    if (!row) throw new Error("not_found");
    return rowToCreated(row);
  }
  vals.push(input.memoId, input.userId);
  await pool.query(`UPDATE memos SET ${sets.join(", ")} WHERE id = ? AND userId = ?`, vals);
  if (input.dadosEspecificosJson !== undefined) {
    const dadosNormalized = normalizeDadosEspecificosJson(input.dadosEspecificosJson);
    await trySyncMemoDadosEspecificosRows({
      memoId: input.memoId,
      groupId: current.groupId,
      mediaType: current.mediaType,
      explicitCategoryId: input.matchedCategoryId ?? null,
      dadosEspecificosJson: dadosNormalized,
      dadosEspecificosOriginaisJson: normalizeDadosEspecificosJson(input.dadosEspecificosOriginaisJson),
    });
  }
  const row = await getMemoById(input.memoId, input.userId);
  if (!row) throw new Error("not_found");
  return rowToCreated(row);
}

/** Resultado da leitura de mídia; `s3GetObject` só quando o fluxo usou S3 GetObject no bucket da app. */
export type ReadMemoMediaResult = {
  buffer: Buffer;
  s3GetObject: { key: string } | null;
};

/** Lê bytes do arquivo do memo (disco local `/media/{userId}/…` ou URL HTTP pública / S3). */
export async function readMemoMediaBuffer(authorUserId: number, mediaUrl: string): Promise<ReadMemoMediaResult> {
  const u = mediaUrl.trim();
  if (!u) throw new Error("invalid_media_url");
  if (u.startsWith("/media/")) {
    const m = u.match(/^\/media\/(\d+)\/([^/?#]+)$/);
    if (!m) throw new Error("invalid_media_url");
    const uid = Number(m[1]);
    const name = decodeURIComponent(m[2]);
    if (uid !== authorUserId) throw new Error("invalid_media_url");
    if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
      throw new Error("invalid_media_url");
    }
    const abs = path.join(uploadsAbsolutePath(), String(uid), name);
    const buffer = await fs.readFile(abs);
    return { buffer, s3GetObject: null };
  }
  if (u.startsWith("http://") || u.startsWith("https://")) {
    if (config.mediaStorage === "s3" && config.s3.bucket.trim()) {
      const key = tryExtractMemoS3KeyFromPublicUrl(u);
      if (key) {
        const buffer = await downloadMemoObjectFromS3(key);
        if (!buffer.length) throw new Error("document_empty_file");
        return {
          buffer,
          s3GetObject: { key },
        };
      }
    }
    const res = await fetch(u, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error("document_fetch_failed");
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) throw new Error("document_empty_file");
    return { buffer, s3GetObject: null };
  }
  throw new Error("invalid_media_url");
}

async function assertMemoReadableForViewer(
  memoId: number,
  viewerId: number,
  isAdmin: boolean
): Promise<MemoRow> {
  const [rows] = await pool.query<MemoRow[]>(
    `SELECT id, userId, groupId, mediaType, mediaText, mediaWebUrl,
            mediaAudioUrl, mediaImageUrl, mediaVideoUrl, mediaDocumentUrl,
            createdAt, mediaMetadata, keywords, tamMediaUrl
     FROM memos WHERE id = ? AND isActive = 1`,
    [memoId]
  );
  const m = rows[0];
  if (!m) throw new Error("not_found");
  if (isAdmin) return m;
  if (m.groupId == null) {
    if (m.userId !== viewerId) throw new Error("forbidden_memo_view");
    return m;
  }
  await assertUserWorkspaceGroupAccess(viewerId, m.groupId, isAdmin);
  return m;
}

/** Bytes do anexo (local ou S3) para quem pode ver o memo (autor, grupo, admin). */
export async function getMemoAttachmentForViewer(input: {
  memoId: number;
  viewerId: number;
  isAdmin: boolean;
}): Promise<{ buffer: Buffer; filename: string; mime: string }> {
  const m = await assertMemoReadableForViewer(input.memoId, input.viewerId, input.isAdmin);
  const url = primaryMediaFileUrl(m);
  if (!url?.trim()) throw new Error("no_attachment");
  let meta: Record<string, unknown> = {};
  try {
    if (m.mediaMetadata) meta = JSON.parse(m.mediaMetadata) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  const origName =
    typeof meta.originalName === "string" && meta.originalName.trim() ? meta.originalName.trim() : null;
  const metaMime =
    typeof meta.mime === "string" && meta.mime.trim() ? meta.mime.trim().split(";")[0]!.trim() : null;
  const lastSeg = url.split("/").pop() ?? "";
  let decodedSeg = lastSeg;
  try {
    decodedSeg = decodeURIComponent(lastSeg.split("?")[0] || "");
  } catch {
    decodedSeg = lastSeg.split("?")[0] || "";
  }
  const filename = origName || safeBasename(decodedSeg || `memo-${m.id}`);
  const { buffer, s3GetObject } = await readMemoMediaBuffer(m.userId, url);
  if (s3GetObject) {
    void insertMemoS3DownloadLog({
      userId: input.viewerId,
      groupId: m.groupId == null ? null : Number(m.groupId),
      memoId: Number(m.id),
      s3Key: s3GetObject.key,
      bytesDownloaded: buffer.length,
    });
  }
  const mime = metaMime || guessMimeFromFilename(filename);
  return { buffer, filename, mime };
}

export async function finalizeDocumentMemoReview(input: {
  memoId: number;
  userId: number;
  isAdmin: boolean;
  mediaText: string;
  keywords: string | null;
  dadosEspecificosJson?: string | null;
  dadosEspecificosOriginaisJson?: string | null;
  matchedCategoryId?: number | null;
  apiCost: number;
  iaLevel: UserIaUseLevel;
  originalText: string;
  pipelineUsed: string;
  originalFilename: string;
  mime: string;
  mediaDocumentUrl: string;
  tamMediaUrl: number;
}): Promise<MemoCreatedResponse> {
  const m = await assertMemoAuthorCanModify(input.memoId, input.userId, input.isAdmin);
  if (m.mediaType !== "document" || !m.mediaDocumentUrl?.trim()) {
    throw new Error("not_document_memo");
  }
  if (m.mediaDocumentUrl.trim() !== input.mediaDocumentUrl.trim()) {
    throw new Error("document_url_mismatch");
  }
  const expectedTam = Number(m.tamMediaUrl);
  if (
    Number.isFinite(expectedTam) &&
    expectedTam > 0 &&
    input.tamMediaUrl > 0 &&
    input.tamMediaUrl !== expectedTam
  ) {
    throw new Error("document_size_mismatch");
  }
  let meta: Record<string, unknown>;
  try {
    meta = m.mediaMetadata ? (JSON.parse(m.mediaMetadata) as Record<string, unknown>) : {};
  } catch {
    meta = {};
  }
  const suggestedDadosFromProcess =
    typeof meta.reviewSuggestedDadosEspecificosJson === "string"
      ? String(meta.reviewSuggestedDadosEspecificosJson).trim()
      : null;
  const suggestedDadosOriginaisFromProcess =
    typeof meta.reviewSuggestedDadosEspecificosOriginaisJson === "string"
      ? String(meta.reviewSuggestedDadosEspecificosOriginaisJson).trim()
      : null;
  const suggestedMatchedCategoryIdFromProcess =
    typeof meta.reviewSuggestedMatchedCategoryId === "number" &&
    Number.isFinite(meta.reviewSuggestedMatchedCategoryId)
      ? Math.floor(meta.reviewSuggestedMatchedCategoryId)
      : null;
  delete meta.reviewSuggestedDadosEspecificosJson;
  delete meta.reviewSuggestedDadosEspecificosOriginaisJson;
  delete meta.reviewSuggestedMatchedCategoryId;
  meta.reviewFlow = "document_v1";
  meta.documentPipeline = input.pipelineUsed;
  meta.originalExtractedText = truncateOriginalTextForMeta(input.originalText);
  meta.originalFilename = input.originalFilename;
  meta.mime = input.mime;
  meta.iaUseDocumento = input.iaLevel;
  const cost = Number.isFinite(input.apiCost) && input.apiCost >= 0 ? input.apiCost : 0;
  const mult = await getUsdToCreditsMultiplier();
  const usedCred = creditsFromUsdCost(cost, mult);
  const kw = keywordsForStorage(input.keywords);
  const dadosRaw =
    input.dadosEspecificosJson !== undefined ? input.dadosEspecificosJson : suggestedDadosFromProcess;
  const dadosJson = normalizeDadosEspecificosJson(dadosRaw);
  const dadosOriginaisRaw =
    input.dadosEspecificosOriginaisJson !== undefined
      ? input.dadosEspecificosOriginaisJson
      : suggestedDadosOriginaisFromProcess;
  const matchedCategoryId =
    input.matchedCategoryId !== undefined ? input.matchedCategoryId : suggestedMatchedCategoryIdFromProcess;
  const text = input.mediaText.trim();
  await pool.query(
    `UPDATE memos SET mediaText = ?, keywords = ?, dadosEspecificosJson = ?, mediaMetadata = ?, apiCost = ?, usedApiCred = ? WHERE id = ? AND userId = ?`,
    [text, kw, dadosJson, JSON.stringify(meta), cost, usedCred, input.memoId, input.userId]
  );
  await trySyncMemoDadosEspecificosRows({
    memoId: input.memoId,
    groupId: m.groupId,
    mediaType: "document",
    explicitCategoryId: matchedCategoryId ?? null,
    dadosEspecificosJson: dadosJson,
    dadosEspecificosOriginaisJson: normalizeDadosEspecificosJson(dadosOriginaisRaw),
  });
  if (cost > 0) {
    try {
      await pool.query(
        `INSERT INTO api_usage_logs (memoId, userId, operation, model, inputTokens, outputTokens, totalTokens, costUsd)
         VALUES (?, ?, 'memo_document_ia', 'aggregate', 0, 0, 0, ?)`,
        [input.memoId, input.userId, cost]
      );
    } catch {
      /* opcional */
    }
  }
  if (input.iaLevel === "completo") {
    upsertMemoChunks({ memoId: input.memoId, mediaText: text, keywords: kw, dadosEspecificosJson: dadosJson }).catch(() => {});
  }
  const row = await getMemoById(input.memoId, input.userId);
  if (!row) throw new Error("not_found");
  return rowToCreated(row);
}

export async function softDeleteMemoForUser(
  memoId: number,
  userId: number,
  isAdmin: boolean
): Promise<void> {
  await assertMemoAuthorCanModify(memoId, userId, isAdmin);
  const [res] = await pool.execute<ResultSetHeader>(
    `UPDATE memos SET isActive = 0 WHERE id = ? AND userId = ? AND isActive = 1`,
    [memoId, userId]
  );
  if (res.affectedRows === 0) {
    throw new Error("not_found");
  }
}

function rowToCreated(r: MemoRow): MemoCreatedResponse {
  return {
    id: r.id,
    mediaType: r.mediaType,
    mediaText: r.mediaText,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

function extractIaUseLevel(mediaMetadata: string | null | undefined): string | null {
  if (!mediaMetadata) return null;
  try {
    const m = typeof mediaMetadata === "string" ? (JSON.parse(mediaMetadata) as Record<string, unknown>) : mediaMetadata;
    const v = m.iaUseTexto ?? m.iaUseImagem ?? m.iaUseAudio ?? m.iaUseVideo ?? m.iaUseDocumento ?? m.iaUseUrl;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

function headlineFromRow(r: MemoRow): string {
  const text = (r.mediaText ?? "").trim();
  if (text.length > 120) return text.slice(0, 117) + "…";
  if (text) return text;
  return r.mediaType;
}

export async function listRecentMemos(
  userId: number,
  limit: number,
  opts?: { workspaceGroupId?: number | null; isAdmin?: boolean }
): Promise<MemoRecentCard[]> {
  const lim = Math.min(Math.max(limit, 1), 50);
  const gid = opts?.workspaceGroupId ?? null;
  const isAdmin = opts?.isAdmin ?? false;

  const chunksSubquery = `(EXISTS(SELECT 1 FROM memo_chunks mc WHERE mc.memo_id = m.id))::int AS haschunks`;

  if (gid != null) {
    await assertUserWorkspaceGroupAccess(userId, gid, isAdmin);
    const [rows] = await pool.query<MemoRow[]>(
      `SELECT m.id, m.userId, m.groupId, m.mediaType, m.mediaText, m.mediaWebUrl,
              m.mediaAudioUrl, m.mediaImageUrl, m.mediaVideoUrl, m.mediaDocumentUrl,
              m.createdAt, m.mediaMetadata, m.keywords, m.dadosEspecificosJson, m.apiCost, m.usedApiCred,
              ${chunksSubquery}
       FROM memos m
       WHERE m.groupId = ? AND m.isActive = 1
       ORDER BY m.createdAt DESC
       LIMIT ?`,
      [gid, lim]
    );
    return rows.map((r) => ({
      id: r.id,
      mediaType: r.mediaType,
      headline: headlineFromRow(r),
      mediaText: r.mediaText ?? "",
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      mediaWebUrl: r.mediaWebUrl,
      hasFile: Boolean(
        r.mediaAudioUrl || r.mediaImageUrl || r.mediaVideoUrl || r.mediaDocumentUrl
      ),
      keywords: r.keywords ?? null,
      dadosEspecificosJson: r.dadosEspecificosJson ?? null,
      mediaFileUrl: primaryMediaFileUrl(r),
      attachmentDisplayName: attachmentDisplayNameFromMemoLike(r),
      userId: r.userId,
      apiCost: numDb(r.apiCost),
      usedApiCred: numDb(r.usedApiCred),
      iaUseLevel: extractIaUseLevel(r.mediaMetadata),
      hasSemanticChunks: Boolean(r.hasChunks),
    }));
  }

  const [rows] = await pool.query<MemoRow[]>(
    `SELECT m.id, m.userId, m.groupId, m.mediaType, m.mediaText, m.mediaWebUrl,
            m.mediaAudioUrl, m.mediaImageUrl, m.mediaVideoUrl, m.mediaDocumentUrl,
            m.createdAt, m.mediaMetadata, m.keywords, m.dadosEspecificosJson, m.apiCost, m.usedApiCred,
            ${chunksSubquery}
     FROM memos m
     WHERE m.userId = ? AND m.groupId IS NULL AND m.isActive = 1
     ORDER BY m.createdAt DESC
     LIMIT ?`,
    [userId, lim]
  );
  return rows.map((r) => ({
    id: r.id,
    mediaType: r.mediaType,
    headline: headlineFromRow(r),
    mediaText: r.mediaText ?? "",
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    mediaWebUrl: r.mediaWebUrl,
    hasFile: Boolean(r.mediaAudioUrl || r.mediaImageUrl || r.mediaVideoUrl || r.mediaDocumentUrl),
    keywords: r.keywords ?? null,
    dadosEspecificosJson: r.dadosEspecificosJson ?? null,
    mediaFileUrl: primaryMediaFileUrl(r),
    attachmentDisplayName: attachmentDisplayNameFromMemoLike(r),
    userId: r.userId,
    apiCost: numDb(r.apiCost),
    usedApiCred: numDb(r.usedApiCred),
    iaUseLevel: extractIaUseLevel(r.mediaMetadata),
    hasSemanticChunks: Boolean(r.hasChunks),
  }));
}

export async function getMemoCardForViewer(input: {
  memoId: number;
  userId: number;
  isAdmin: boolean;
}): Promise<MemoRecentCard> {
  const chunksSubquery = `(EXISTS(SELECT 1 FROM memo_chunks mc WHERE mc.memo_id = m.id))::int AS haschunks`;
  const [rows] = await pool.query<MemoRow[]>(
    `SELECT m.id, m.userId, m.groupId, m.mediaType, m.mediaText, m.mediaWebUrl,
            m.mediaAudioUrl, m.mediaImageUrl, m.mediaVideoUrl, m.mediaDocumentUrl,
            m.createdAt, m.mediaMetadata, m.keywords, m.dadosEspecificosJson, m.apiCost, m.usedApiCred,
            ${chunksSubquery}
     FROM memos m
     WHERE m.id = ? AND m.isActive = 1`,
    [input.memoId]
  );
  const m = rows[0];
  if (!m) throw new Error("not_found");
  if (!input.isAdmin) {
    if (m.groupId == null) {
      if (m.userId !== input.userId) throw new Error("forbidden");
    } else {
      await assertUserWorkspaceGroupAccess(input.userId, m.groupId, input.isAdmin);
    }
  }
  return {
    id: m.id,
    mediaType: m.mediaType,
    headline: headlineFromRow(m),
    mediaText: m.mediaText ?? "",
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
    mediaWebUrl: m.mediaWebUrl,
    hasFile: Boolean(m.mediaAudioUrl || m.mediaImageUrl || m.mediaVideoUrl || m.mediaDocumentUrl),
    keywords: m.keywords ?? null,
    dadosEspecificosJson: m.dadosEspecificosJson ?? null,
    mediaFileUrl: primaryMediaFileUrl(m),
    attachmentDisplayName: attachmentDisplayNameFromMemoLike(m),
    userId: m.userId,
    apiCost: numDb(m.apiCost),
    usedApiCred: numDb(m.usedApiCred),
    iaUseLevel: extractIaUseLevel(m.mediaMetadata),
    hasSemanticChunks: Boolean(m.hasChunks),
  };
}
