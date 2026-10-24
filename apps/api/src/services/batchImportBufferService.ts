import type { BatchProcessResult } from "@mymemory/shared";
import { classifyFile, guessMimeFromFilename } from "../lib/media.js";
import { buildSemIaPlaceholder } from "./batchImportService.js";
import { runDocumentExtractPipeline } from "./documentExtractService.js";
import {
  loadDocumentRoutingConfig,
  resolveDocumentPipeline,
} from "./documentRoutingService.js";
import { processTextMemoForReview } from "./textMemoProcessService.js";
import { recognizeImageWithTesseract } from "../lib/imageOcr.js";
import { createBatchMemoDirectly } from "./memoService.js";
import type { StorageProvider } from "@mymemory/shared";
import { aplicarDonoPessoal } from "./donoMemoService.js";

/**
 * Processa um arquivo já em memória (WebDAV, upload, cópia da automação) e cria o memo do lote.
 * Extrai o texto (documento/imagem), aplica o nível de IA, grava o memo e o dono (categoria Pessoal).
 */
export async function processBatchFileFromBuffer(input: {
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

    // Extrai texto bruto (usado para semIA e basico/completo)
    let rawExtractedText = "";
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

    if (iaLevel === "semIA") {
      mediaText = rawExtractedText
        ? `[Edição Pendente]\n${rawExtractedText}`
        : buildSemIaPlaceholder({ filename: originalFileName, provider });
    } else {
      if (!rawExtractedText) {
        mediaText = buildSemIaPlaceholder({ filename: originalFileName, provider });
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

    // O custo já foi registrado em api_usage_logs por createBatchMemoDirectly ('memo_batch_ia')

    // Categoria Pessoal: o memo passa a ser da pessoa indicada no campo dono
    const dono = await aplicarDonoPessoal(result.id).catch((e: unknown) => {
      console.warn("[batchImport] dono do memo:", e instanceof Error ? e.message : e);
      return null;
    });
    return { originalFileName, ok: true, memoId: result.id, ...(dono?.status === "pendente" ? { donoPendente: true } : {}) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[batchImport/upload] Erro ao processar "${originalFileName}":`, msg);
    return { originalFileName, ok: false, error: msg };
  }
}
