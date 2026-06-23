import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "webdav";
import type { FileStat } from "webdav";
import type {
  BatchFileSituacao,
  BatchFileVerifyResult,
  BatchCreditEstimate,
  BatchVerifyResponse,
  BatchProcessResult,
  MemoMediaTypeDb,
  StorageProvider,
  UserIaUseLevel,
} from "@mymemory/shared";
import { SEMIA_PLACEHOLDER_PREFIX } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { classifyFile, guessMimeFromFilename } from "../lib/media.js";
import { recognizeImageWithTesseract } from "../lib/imageOcr.js";
import { runDocumentExtractPipeline } from "./documentExtractService.js";
import { loadDocumentRoutingConfig, resolveDocumentPipeline } from "./documentRoutingService.js";
import { processTextMemoForReview } from "./textMemoProcessService.js";
import { createBatchMemoDirectly } from "./memoService.js";

// ── Constantes ────────────────────────────────────────────────────────────────

const MAX_FILES_PER_BATCH = 50;
const MAX_FILE_SIZE_DEFAULT = 100 * 1024 * 1024; // 100 MB

/** Extensões aceitas pelo batch (espelho do upload normal). */
const SUPPORTED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".odt", ".ods", ".odp", ".txt", ".csv", ".rtf", ".html", ".htm",
  ".msg", ".eml", ".dwg",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif",
  ".mp3", ".wav", ".ogg", ".oga", ".opus", ".m4a", ".flac", ".aac", ".wma",
  ".mp4", ".webm", ".avi", ".mov", ".mkv", ".m4v",
]);

// ── Whitelist LOCAL/REDE ──────────────────────────────────────────────────────

function getAllowedLocalPaths(): string[] {
  const raw = (process.env.BATCH_ALLOWED_LOCAL_PATHS ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
}

/** Lança Error se o caminho não estiver na whitelist. */
function assertPathAllowed(filePath: string): void {
  const allowed = getAllowedLocalPaths();
  if (!allowed.length) {
    throw new Error(
      "Acesso a arquivos locais desativado. Configure BATCH_ALLOWED_LOCAL_PATHS no .env."
    );
  }
  const resolved = path.resolve(filePath);
  const ok = allowed.some((base) => resolved.startsWith(base + path.sep) || resolved === base);
  if (!ok) {
    throw new Error(
      `Caminho fora da whitelist permitida: ${filePath}. Configure BATCH_ALLOWED_LOCAL_PATHS.`
    );
  }
}

// ── Whitelist WEBDAV ──────────────────────────────────────────────────────────

function parseWebDavUrl(input: string): { origin: string; startPath: string } {
  try {
    const u = new URL(input);
    return { origin: u.origin, startPath: u.pathname || "/" };
  } catch {
    return { origin: input.replace(/\/$/, ""), startPath: "/" };
  }
}

function getAllowedWebDavUrls(): string[] {
  const raw = (process.env.BATCH_ALLOWED_WEBDAV_URLS ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((u) => parseWebDavUrl(u.trim()).origin)
    .filter(Boolean);
}

function assertWebDavUrlAllowed(inputUrl: string): void {
  const allowed = getAllowedWebDavUrls();
  if (!allowed.length) {
    throw new Error("Acesso WebDAV desativado. Configure BATCH_ALLOWED_WEBDAV_URLS no .env.");
  }
  const { origin } = parseWebDavUrl(inputUrl);
  if (!allowed.includes(origin)) {
    throw new Error(`URL WebDAV fora da whitelist: ${inputUrl}. Configure BATCH_ALLOWED_WEBDAV_URLS.`);
  }
}

export async function scanWebDavFolder(
  inputUrl: string,
  maxDepth = 2
): Promise<BatchFileDescriptor[]> {
  assertWebDavUrlAllowed(inputUrl);

  const { origin, startPath } = parseWebDavUrl(inputUrl);
  const client = createClient(origin);
  const results: BatchFileDescriptor[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let items: FileStat[];
    try {
      items = (await client.getDirectoryContents(dir)) as FileStat[];
    } catch {
      return;
    }
    for (const item of items) {
      if (item.type === "directory") {
        await walk(item.filename, depth + 1);
      } else if (item.type === "file") {
        const ext = path.extname(item.filename).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
        results.push({
          originalFileName: item.basename,
          fullPath: item.filename,
          sizeBytes: item.size ?? 0,
          ext,
        });
        if (results.length >= MAX_FILES_PER_BATCH * 2) return;
      }
    }
  }

  await walk(startPath, 0);
  return results.slice(0, MAX_FILES_PER_BATCH * 2);
}

export async function downloadWebDavFile(inputUrl: string, remotePath: string): Promise<Buffer> {
  const { origin } = parseWebDavUrl(inputUrl);
  const client = createClient(origin);
  const data = await client.getFileContents(remotePath, { format: "binary" });
  return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
}

// ── Placeholder semIA ─────────────────────────────────────────────────────────

export function buildSemIaPlaceholder(input: {
  filename: string;
  provider: StorageProvider;
  folder?: string;
}): string {
  const lines = [
    SEMIA_PLACEHOLDER_PREFIX,
    "Arquivo importado sem processamento de IA.",
    `Nome do arquivo: ${input.filename}`,
    `Origem: ${input.provider}`,
  ];
  if (input.folder?.trim()) {
    lines.push(`Pasta: ${input.folder.trim()}`);
  }
  return lines.join("\n");
}

// ── Estimativa de créditos ────────────────────────────────────────────────────

export function estimateBatchCreditCost(
  fileCount: number,
  iaLevel: UserIaUseLevel
): number {
  if (iaLevel === "semIA") return 0;
  if (iaLevel === "basico") return Math.ceil(fileCount * 0.5);
  return Math.ceil(fileCount * 1.5); // completo
}

export function estimateBatchCredits(fileCount: number): BatchCreditEstimate {
  return {
    semIA: 0,
    basico: estimateBatchCreditCost(fileCount, "basico"),
    completo: estimateBatchCreditCost(fileCount, "completo"),
  };
}

// ── Scan LOCAL/REDE ───────────────────────────────────────────────────────────

export interface BatchFileDescriptor {
  originalFileName: string;
  fullPath: string;
  sizeBytes: number;
  ext: string;
}

export async function scanLocalFolder(
  folderPath: string,
  maxDepth = 2
): Promise<BatchFileDescriptor[]> {
  assertPathAllowed(folderPath);

  const results: BatchFileDescriptor[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
        let sizeBytes = 0;
        try {
          const stat = await fs.stat(full);
          sizeBytes = stat.size;
        } catch {
          continue;
        }
        results.push({
          originalFileName: entry.name,
          fullPath: full,
          sizeBytes,
          ext,
        });
        if (results.length >= MAX_FILES_PER_BATCH * 2) return;
      }
    }
  }

  await walk(folderPath, 0);
  return results.slice(0, MAX_FILES_PER_BATCH * 2);
}

// ── Verificação de duplicidade ────────────────────────────────────────────────

async function checkDuplicate(
  userId: number,
  originalFileName: string
): Promise<"none" | "exact" | "suspect"> {
  const basename = path.basename(originalFileName);

  const [exactRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM memos
     WHERE userid = ? AND original_file_name = ? AND isactive = 1`,
    [userId, originalFileName]
  );
  if (Number(exactRows[0]?.cnt) > 0) return "exact";

  if (originalFileName !== basename) {
    const [suspectRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM memos
       WHERE userid = ? AND original_file_name = ? AND isactive = 1`,
      [userId, basename]
    );
    if (Number(suspectRows[0]?.cnt) > 0) return "suspect";
  }

  return "none";
}

// ── Verificação de lote ───────────────────────────────────────────────────────

export interface BatchVerifyInput {
  userId: number;
  files: { originalFileName: string; fullPath: string; sizeBytes: number }[];
  provider: StorageProvider;
  maxFileSizeBytes?: number;
}

export async function verifyBatchFiles(
  input: BatchVerifyInput
): Promise<BatchVerifyResponse> {
  const maxSize = input.maxFileSizeBytes ?? MAX_FILE_SIZE_DEFAULT;
  const results: BatchFileVerifyResult[] = [];

  for (const file of input.files.slice(0, MAX_FILES_PER_BATCH * 2)) {
    const ext = path.extname(file.originalFileName).toLowerCase();
    const mime = guessMimeFromFilename(file.originalFileName);
    let mediaType: MemoMediaTypeDb | null = null;
    let situacao: BatchFileSituacao;
    let motivo: string | null = null;

    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      situacao = "formato_nao_suportado";
      motivo = `Extensão ${ext || "(sem extensão)"} não suportada`;
    } else if (file.sizeBytes > maxSize) {
      situacao = "muito_grande";
      motivo = `Tamanho ${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB excede limite de ${(maxSize / 1024 / 1024).toFixed(0)} MB`;
      mediaType = classifyFile(mime, file.originalFileName);
    } else {
      mediaType = classifyFile(mime, file.originalFileName);
      const dup = await checkDuplicate(input.userId, file.originalFileName);
      if (dup === "exact") {
        situacao = "ja_cadastrado";
        motivo = "Arquivo já cadastrado com este nome";
      } else if (dup === "suspect") {
        situacao = "suspeito_duplicidade";
        motivo = "Existe memo com nome de arquivo semelhante";
      } else {
        if (input.provider === "LOCAL" || input.provider === "REDE") {
          try {
            assertPathAllowed(file.fullPath);
            await fs.access(file.fullPath, fs.constants.R_OK);
            situacao = "pronto";
          } catch (err) {
            situacao = "erro_acesso";
            motivo = err instanceof Error ? err.message : "Sem acesso ao arquivo";
          }
        } else {
          situacao = "pronto";
        }
      }
    }

    results.push({
      originalFileName: file.originalFileName,
      fullPath: file.fullPath,
      sizeBytes: file.sizeBytes,
      mediaType,
      situacao,
      motivo,
    });
  }

  const readyCount = results.filter((r) => r.situacao === "pronto" || r.situacao === "suspeito_duplicidade").length;
  const creditEstimate = estimateBatchCredits(readyCount);

  return { files: results, creditEstimate, userCurrentCredits: null, userCreditLimit: null };
}

// ── Processamento de um arquivo ───────────────────────────────────────────────

export interface BatchProcessFileInput {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  originalFileName: string;
  fullPath: string;
  sizeBytes: number;
  provider: StorageProvider;
  iaLevel: UserIaUseLevel;
  folder?: string;
}

export async function processBatchFile(
  input: BatchProcessFileInput
): Promise<BatchProcessResult> {
  const { originalFileName, fullPath, provider, iaLevel } = input;

  try {
    const mime = guessMimeFromFilename(originalFileName);
    const mediaType = classifyFile(mime, originalFileName);
    const ext = path.extname(originalFileName).toLowerCase();

    let mediaText = "";
    let keywords: string | null = null;
    let dadosEspecificosJson: string | null = null;
    let matchedCategoryId: number | null = null;
    let category: string | null = null;
    let apiCost = 0;

    // Ler buffer para LOCAL/REDE (usado em todos os níveis para extração de texto)
    let buffer: Buffer | null = null;
    if (provider === "LOCAL" || provider === "REDE") {
      assertPathAllowed(fullPath);
      buffer = await fs.readFile(fullPath);
    } else if (iaLevel !== "semIA") {
      throw new Error(
        `Processamento com IA para provider "${provider}" não suportado nesta versão. Use semIA ou OneDrive/GDrive via upload de arquivo.`
      );
    }

    // Extrai texto bruto (usado tanto para semIA quanto para basico/completo)
    let rawExtractedText = "";
    if (buffer) {
      if (mediaType === "document") {
        const routing = await loadDocumentRoutingConfig();
        const pipeline = resolveDocumentPipeline(mime, ext, routing);
        if (pipeline !== "unsupported") {
          const extracted = await runDocumentExtractPipeline(pipeline, buffer, mime, originalFileName);
          rawExtractedText = extracted.text.trim();
        }
      } else if (mediaType === "image") {
        const ocrResult = await recognizeImageWithTesseract(buffer);
        rawExtractedText = ocrResult.text.trim();
      }
      // áudio e vídeo: sem extração em batch fase 1
    }

    if (iaLevel === "semIA") {
      // Texto bruto com marcação de edição pendente; placeholder quando sem texto extraível
      mediaText = rawExtractedText
        ? `[Edição Pendente]\n${rawExtractedText}`
        : buildSemIaPlaceholder({ filename: originalFileName, provider, folder: input.folder });
    } else {
      // basico / completo — processa com IA
      if (!rawExtractedText) {
        mediaText = buildSemIaPlaceholder({ filename: originalFileName, provider, folder: input.folder });
      } else {
        const processed = await processTextMemoForReview({
          userId: input.userId,
          groupId: input.groupId,
          isAdmin: input.isAdmin,
          rawText: rawExtractedText,
          iaUseTexto: iaLevel,
        });
        mediaText = processed.suggestedMediaText;
        keywords = processed.suggestedKeywords || null;
        dadosEspecificosJson = processed.dadosEspecificosJson ?? null;
        matchedCategoryId = processed.matchedCategoryId ?? null;
        category = processed.category ?? null;
        apiCost = processed.apiCost ?? 0;
      }
    }

    const result = await createBatchMemoDirectly({
      userId: input.userId,
      groupId: input.groupId,
      mediaType,
      externalFileRef: fullPath,
      mediaText,
      keywords,
      dadosEspecificosJson,
      matchedCategoryId,
      category,
      apiCost,
      iaLevel,
      originalText: mediaText,
      tamMediaUrl: input.sizeBytes,
      originalFileName,
      storageProvider: provider,
    });

    if (apiCost > 0) {
      pool.query(
        `INSERT INTO api_usage_logs (memoid, userid, operation, model, inputtokens, outputtokens, totaltokens, costusd)
         VALUES (?, ?, 'batch_import', 'aggregate', 0, 0, 0, ?)`,
        [result.id, input.userId, apiCost]
      ).catch((e: unknown) => console.error("[batchImport] api_usage_logs INSERT failed:", e));
    }

    return { originalFileName, ok: true, memoId: result.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[batchImport] Erro ao processar "${originalFileName}":`, msg);
    return { originalFileName, ok: false, error: msg };
  }
}
