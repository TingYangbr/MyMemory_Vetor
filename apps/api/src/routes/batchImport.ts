import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import { classifyFile, guessMimeFromFilename } from "../lib/media.js";
import {
  verifyBatchFiles,
  processBatchFile,
  scanLocalFolder,
  estimateBatchCredits,
} from "../services/batchImportService.js";
import type { BatchProcessResponse } from "@mymemory/shared";

const PROVIDER_VALUES = ["S3", "ONEDRIVE", "GOOGLE_DRIVE", "LOCAL", "REDE", "URL"] as const;

const verifyLocalBody = z.object({
  provider: z.enum(["LOCAL", "REDE"]),
  folderPath: z.string().min(1),
  iaLevel: z.enum(["semIA", "basico", "completo"]).default("semIA"),
  groupId: z.number().int().positive().nullable().optional(),
  maxFileSizeBytes: z.number().int().positive().optional(),
});

const verifyUrlBody = z.object({
  provider: z.literal("URL"),
  fileUrl: z.string().url(),
  fileName: z.string().min(1),
  fileSizeBytes: z.number().int().min(0).optional(),
  iaLevel: z.enum(["semIA", "basico", "completo"]).default("semIA"),
  groupId: z.number().int().positive().nullable().optional(),
});

const processLocalBody = z.object({
  provider: z.enum(["LOCAL", "REDE"]),
  folderPath: z.string().min(1),
  iaLevel: z.enum(["semIA", "basico", "completo"]).default("semIA"),
  groupId: z.number().int().positive().nullable().optional(),
  onlyFileNames: z.array(z.string()).optional(),
});

const MAX_BATCH_FILES = 50;

const BATCH_MULTIPART_LIMITS = { fileSize: 500 * 1024 * 1024, files: 200 } as const;

const plugin: FastifyPluginAsync = async (app) => {
  // ── POST /api/memos/batch/verify ─────────────────────────────────────────

  /**
   * LOCAL/REDE: escaneia pasta e verifica arquivos.
   */
  app.post("/api/memos/batch/verify/local", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const parsed = verifyLocalBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

    const { provider, folderPath, iaLevel: _iaLevel, groupId, maxFileSizeBytes } = parsed.data;
    const groupIdVal = groupId ?? null;

    let scanned: { originalFileName: string; fullPath: string; sizeBytes: number }[];
    try {
      scanned = await scanLocalFolder(folderPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: "scan_error", message: msg });
    }

    const result = await verifyBatchFiles({
      userId,
      files: scanned,
      provider,
      maxFileSizeBytes,
    });

    return { ...result, folderPath, groupId: groupIdVal };
  });

  /**
   * OneDrive / Google Drive: arquivos enviados via multipart (upload em memória).
   * Não armazena no S3 — apenas registra referência ao caminho/URL externo.
   */
  app.post("/api/memos/batch/verify/upload", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const parts = req.parts({ limits: BATCH_MULTIPART_LIMITS });
    const files: { originalFileName: string; fullPath: string; sizeBytes: number }[] = [];
    let provider: (typeof PROVIDER_VALUES)[number] = "ONEDRIVE";
    let groupId: number | null = null;

    for await (const part of parts) {
      if (part.type === "field") {
        const fv = String(part.value ?? "");
        if (part.fieldname === "provider" && PROVIDER_VALUES.includes(fv as (typeof PROVIDER_VALUES)[number])) {
          provider = fv as (typeof PROVIDER_VALUES)[number];
        }
        if (part.fieldname === "groupId" && fv) {
          const n = Number(fv);
          if (Number.isFinite(n) && n > 0) groupId = n;
        }
        continue;
      }
      // Consome o buffer mas descarta — apenas usamos metadados para verificação
      let sizeBytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        sizeBytes += chunk.length;
        chunks.push(chunk);
        if (sizeBytes > 500 * 1024 * 1024) break;
      }
      if (files.length < MAX_BATCH_FILES * 2) {
        files.push({
          originalFileName: part.filename ?? "arquivo",
          fullPath: part.filename ?? "arquivo",
          sizeBytes,
        });
      }
    }

    const result = await verifyBatchFiles({ userId, files, provider });
    return { ...result, groupId };
  });

  /**
   * URL: verifica uma única URL externa.
   */
  app.post("/api/memos/batch/verify/url", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const parsed = verifyUrlBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

    const { fileUrl, fileName, fileSizeBytes, groupId } = parsed.data;
    const result = await verifyBatchFiles({
      userId,
      files: [{ originalFileName: fileName, fullPath: fileUrl, sizeBytes: fileSizeBytes ?? 0 }],
      provider: "URL",
    });
    return { ...result, groupId: groupId ?? null };
  });

  // ── POST /api/memos/batch/process ────────────────────────────────────────

  /**
   * LOCAL/REDE: escaneia e processa arquivos da pasta.
   */
  app.post("/api/memos/batch/process/local", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const isAdmin = await getUserIsAdmin(userId);

    const parsed = processLocalBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

    const { provider, folderPath, iaLevel, groupId, onlyFileNames } = parsed.data;
    const groupIdVal = groupId ?? null;

    let scanned: { originalFileName: string; fullPath: string; sizeBytes: number }[];
    try {
      scanned = await scanLocalFolder(folderPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: "scan_error", message: msg });
    }

    let toProcess = scanned;
    if (onlyFileNames?.length) {
      const nameSet = new Set(onlyFileNames);
      toProcess = scanned.filter((f) => nameSet.has(f.originalFileName));
    }
    toProcess = toProcess.slice(0, MAX_BATCH_FILES);

    const results = [];
    let totalCreated = 0;
    let totalErrors = 0;

    for (const file of toProcess) {
      const result = await processBatchFile({
        userId,
        groupId: groupIdVal,
        isAdmin,
        originalFileName: file.originalFileName,
        fullPath: file.fullPath,
        sizeBytes: file.sizeBytes,
        provider,
        iaLevel,
        folder: folderPath,
      });
      results.push(result);
      if (result.ok) totalCreated++;
      else totalErrors++;
    }

    return {
      totalRequested: toProcess.length,
      totalCreated,
      totalErrors,
      results,
    } satisfies BatchProcessResponse;
  });

  /**
   * OneDrive / Google Drive: arquivos enviados via multipart.
   * Processa em memória — não sobe para S3.
   */
  app.post("/api/memos/batch/process/upload", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const isAdmin = await getUserIsAdmin(userId);

    let provider: (typeof PROVIDER_VALUES)[number] = "ONEDRIVE";
    let iaLevel: "semIA" | "basico" | "completo" = "semIA";
    let groupId: number | null = null;
    const onlyFileNamesSet = new Set<string>();

    // Para upload multipart com processamento real, precisamos das partes de campo primeiro,
    // mas o multipart é stream-based. Coletamos tudo primeiro.
    const fileBuffers: { name: string; buffer: Buffer; sizeBytes: number; externalRef?: string }[] = [];

    const parts = req.parts({ limits: BATCH_MULTIPART_LIMITS });
    for await (const part of parts) {
      if (part.type === "field") {
        const fieldVal = String(part.value ?? "");
        if (part.fieldname === "provider" && PROVIDER_VALUES.includes(fieldVal as (typeof PROVIDER_VALUES)[number])) {
          provider = fieldVal as (typeof PROVIDER_VALUES)[number];
        }
        if (part.fieldname === "iaLevel" && ["semIA", "basico", "completo"].includes(fieldVal)) {
          iaLevel = fieldVal as "semIA" | "basico" | "completo";
        }
        if (part.fieldname === "groupId" && fieldVal) {
          const n = Number(fieldVal);
          if (Number.isFinite(n) && n > 0) groupId = n;
        }
        if (part.fieldname === "onlyFileNames") {
          try {
            const arr = JSON.parse(fieldVal) as string[];
            if (Array.isArray(arr)) arr.forEach((n) => onlyFileNamesSet.add(n));
          } catch { /* ignorar */ }
        }
        continue;
      }

      const fileName = part.filename ?? "arquivo";
      const chunks: Buffer[] = [];
      let sizeBytes = 0;
      for await (const chunk of part.file) {
        chunks.push(chunk);
        sizeBytes += chunk.length;
        if (sizeBytes > 200 * 1024 * 1024) break;
      }
      if (fileBuffers.length < MAX_BATCH_FILES) {
        fileBuffers.push({ name: fileName, buffer: Buffer.concat(chunks), sizeBytes });
      }
    }

    let toProcess = fileBuffers;
    if (onlyFileNamesSet.size > 0) {
      toProcess = fileBuffers.filter((f) => onlyFileNamesSet.has(f.name));
    }
    toProcess = toProcess.slice(0, MAX_BATCH_FILES);

    const results = [];
    let totalCreated = 0;
    let totalErrors = 0;

    for (const file of toProcess) {
      // Para OneDrive/GDrive o fullPath é o nome do arquivo (referência externa)
      // O buffer é usado apenas para extração de texto, não armazenado
      const result = await processBatchFileFromBuffer({
        userId,
        groupId,
        isAdmin,
        originalFileName: file.name,
        buffer: file.buffer,
        sizeBytes: file.sizeBytes,
        provider,
        iaLevel,
        externalFileRef: file.externalRef ?? file.name,
      });
      results.push(result);
      if (result.ok) totalCreated++;
      else totalErrors++;
    }

    return {
      totalRequested: toProcess.length,
      totalCreated,
      totalErrors,
      results,
    } satisfies BatchProcessResponse;
  });
};

// ── Processamento de arquivo via buffer (OneDrive/GDrive) ─────────────────────

import {
  buildSemIaPlaceholder,
  estimateBatchCreditCost,
} from "../services/batchImportService.js";
import { runDocumentExtractPipeline } from "../services/documentExtractService.js";
import {
  loadDocumentRoutingConfig,
  resolveDocumentPipeline,
} from "../services/documentRoutingService.js";
import { processTextMemoForReview } from "../services/textMemoProcessService.js";
import { recognizeImageWithTesseract } from "../lib/imageOcr.js";
import { createBatchMemoDirectly } from "../services/memoService.js";
import type { BatchProcessResult, StorageProvider } from "@mymemory/shared";

async function processBatchFileFromBuffer(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  originalFileName: string;
  buffer: Buffer;
  sizeBytes: number;
  provider: StorageProvider;
  iaLevel: "semIA" | "basico" | "completo";
  externalFileRef: string;
}): Promise<BatchProcessResult> {
  const { originalFileName, buffer, provider, iaLevel, externalFileRef } = input;
  try {
    const mime = guessMimeFromFilename(originalFileName);
    const mediaType = classifyFile(mime, originalFileName);
    const ext = originalFileName.includes(".") ? originalFileName.slice(originalFileName.lastIndexOf(".")).toLowerCase() : "";

    let mediaText = "";
    let keywords: string | null = null;
    let dadosEspecificosJson: string | null = null;
    let matchedCategoryId: number | null = null;
    let category: string | null = null;
    let apiCost = 0;

    if (iaLevel === "semIA") {
      mediaText = buildSemIaPlaceholder({ filename: originalFileName, provider });
    } else if (mediaType === "document") {
      const routing = await loadDocumentRoutingConfig();
      const pipeline = resolveDocumentPipeline(mime, ext, routing);
      if (pipeline === "unsupported") {
        mediaText = buildSemIaPlaceholder({ filename: originalFileName, provider });
      } else {
        const extracted = await runDocumentExtractPipeline(pipeline, buffer, mime, originalFileName);
        if (!extracted.text.trim()) {
          mediaText = buildSemIaPlaceholder({ filename: originalFileName, provider });
        } else {
          const processed = await processTextMemoForReview({
            userId: input.userId,
            groupId: input.groupId,
            isAdmin: input.isAdmin,
            rawText: extracted.text,
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
    } else if (mediaType === "image") {
      const ocrResult = await recognizeImageWithTesseract(buffer);
      if (!ocrResult.text.trim()) {
        mediaText = buildSemIaPlaceholder({ filename: originalFileName, provider });
      } else {
        const processed = await processTextMemoForReview({
          userId: input.userId,
          groupId: input.groupId,
          isAdmin: input.isAdmin,
          rawText: ocrResult.text,
          iaUseTexto: iaLevel,
        });
        mediaText = processed.suggestedMediaText;
        keywords = processed.suggestedKeywords || null;
        dadosEspecificosJson = processed.dadosEspecificosJson ?? null;
        matchedCategoryId = processed.matchedCategoryId ?? null;
        category = processed.category ?? null;
        apiCost = processed.apiCost ?? 0;
      }
    } else {
      mediaText = buildSemIaPlaceholder({ filename: originalFileName, provider });
    }

    const result = await createBatchMemoDirectly({
      userId: input.userId,
      groupId: input.groupId,
      mediaType,
      externalFileRef,
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

    return { originalFileName, ok: true, memoId: result.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[batchImport/upload] Erro ao processar "${originalFileName}":`, msg);
    return { originalFileName, ok: false, error: msg };
  }
}

export default plugin;
