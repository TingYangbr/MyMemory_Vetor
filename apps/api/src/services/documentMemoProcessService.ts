import type { DocumentMemoProcessResponse, UserIaUseLevel } from "@mymemory/shared";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { pool } from "../db.js";
import type { VisionContentPart } from "../lib/openaiVision.js";
import { openaiChatVisionJson } from "../lib/openaiVision.js";
import { assertUserWorkspaceGroupAccess } from "./memoContextService.js";
import { readMemoMediaBuffer } from "./memoService.js";
import { runDocumentExtractPipeline } from "./documentExtractService.js";
import { loadDocumentRoutingConfig, resolveDocumentPipeline } from "./documentRoutingService.js";
import { parseJsonLoose, processTextMemoForReview } from "./textMemoProcessService.js";
import { resolveMaxSummaryCharsForDocument, resolveTextImagemMinForPlan } from "./textMemoMaxSummary.js";
import path from "node:path";

const OCR_TEXT_BRANCH_CONFIDENCE_FALLBACK = 48;
const OCR_MIN_ALNUM_RATIO_IF_NO_CONFIDENCE = 0.3;
const VISION_EXTRACT_TEXT_SYS = `Você extrai todo o texto legível visível nas páginas do documento.
Responda APENAS com um único objeto JSON válido (sem markdown): { "texto": string }
Use string vazia se não houver texto. Preserve parágrafos e ordem de leitura natural quando fizer sentido.`;

export async function getUserIaUseDocumento(userId: number): Promise<UserIaUseLevel> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT iaUseDocumento FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const v = rows[0]?.iaUseDocumento;
  if (v === "semIA" || v === "basico" || v === "completo") return v;
  return "basico";
}

function normalizeImageOcrVisionMinConfidence(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 100) return null;
  return Math.floor(n);
}

async function getImageOcrVisionMinConfidence(userId: number): Promise<number | null> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT imageOcrVisionMinConfidence AS c FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    return normalizeImageOcrVisionMinConfidence(rows[0]?.c);
  } catch {
    return null;
  }
}

function appendProcessingWarning(base: string | null, extra: string | null): string | null {
  const e = extra?.trim();
  if (!e) return base;
  const b = base?.trim();
  return b ? `${b} ${e}` : e;
}

function ocrAlnumRatio(text: string): number {
  if (!text.length) return 0;
  let n = 0;
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch)) n += 1;
  }
  return n / text.length;
}

function isOcrTrustworthyForTextOnlyPipeline(
  text: string,
  confidence: number | null,
  userImageOcrVisionMinConfidence: number | null
): boolean {
  const minConf = userImageOcrVisionMinConfidence ?? OCR_TEXT_BRANCH_CONFIDENCE_FALLBACK;
  if (confidence != null && confidence < minConf) return false;
  if (confidence == null && text.length > 0 && ocrAlnumRatio(text) < OCR_MIN_ALNUM_RATIO_IF_NO_CONFIDENCE) return false;
  return true;
}

function asDataUrlImage(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function assertMemoDocumentAuthor(input: {
  memoId: number;
  userId: number;
  isAdmin: boolean;
}): Promise<{
  mediaDocumentUrl: string;
  groupId: number | null;
  mediaMetadata: string | null;
}> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, userId, groupId, mediaType, mediaDocumentUrl, mediaMetadata
     FROM memos WHERE id = ? AND isActive = 1`,
    [input.memoId]
  );
  const m = rows[0];
  if (!m) throw new Error("not_found");
  if (m.userId !== input.userId) throw new Error("forbidden");
  if (m.mediaType !== "document" || !m.mediaDocumentUrl?.trim()) {
    throw new Error("not_document_memo");
  }
  if (m.groupId != null) {
    await assertUserWorkspaceGroupAccess(input.userId, m.groupId as number, input.isAdmin);
  }
  return {
    mediaDocumentUrl: String(m.mediaDocumentUrl).trim(),
    groupId: m.groupId == null ? null : Number(m.groupId),
    mediaMetadata: m.mediaMetadata == null ? null : String(m.mediaMetadata),
  };
}

export async function processDocumentMemoForReview(input: {
  userId: number;
  memoId: number;
  isAdmin: boolean;
  /** Deve coincidir com o grupo do memo (validação). */
  groupId: number | null;
  iaUseDocumento?: UserIaUseLevel | null;
}): Promise<DocumentMemoProcessResponse> {
  const row = await assertMemoDocumentAuthor({
    memoId: input.memoId,
    userId: input.userId,
    isAdmin: input.isAdmin,
  });
  if ((input.groupId ?? null) !== (row.groupId ?? null)) {
    throw new Error("group_mismatch");
  }

  let meta: { originalName?: string; mime?: string; size?: number };
  try {
    meta = row.mediaMetadata ? (JSON.parse(row.mediaMetadata) as typeof meta) : {};
  } catch {
    meta = {};
  }
  const originalFilename = String(meta.originalName ?? "document").slice(0, 512);
  const mime = String(meta.mime ?? "application/octet-stream").slice(0, 256);
  const ext = path.extname(originalFilename) || path.extname(row.mediaDocumentUrl) || "";

  const routing = await loadDocumentRoutingConfig();
  const pipeline = resolveDocumentPipeline(mime, ext || ".bin", routing);

  const { buffer } = await readMemoMediaBuffer(input.userId, row.mediaDocumentUrl);
  const tamMediaUrl = buffer.length;

  const extract = await runDocumentExtractPipeline(pipeline, buffer, mime);
  let extracted = extract.text;
  let pipelineUsed = extract.pipelineUsed;
  let preProcessWarning: string | null = null;
  let preProcessCost = 0;

  const maxDoc = await resolveMaxSummaryCharsForDocument(
    input.userId,
    row.groupId,
    input.isAdmin
  );
  const textImagemMin = await resolveTextImagemMinForPlan(input.userId, row.groupId, input.isAdmin);
  const imageOcrVisionMinConfidence = await getImageOcrVisionMinConfidence(input.userId);
  const ocrMinConf = imageOcrVisionMinConfidence ?? OCR_TEXT_BRANCH_CONFIDENCE_FALLBACK;
  const dbLevel = await getUserIaUseDocumento(input.userId);
  const iaLevel = input.iaUseDocumento ?? dbLevel;

  if (pipelineUsed === "extract_pdf_ocr") {
    const ocrConfidence = extract.ocrConfidence ?? null;
    const ocrTrustworthy = isOcrTrustworthyForTextOnlyPipeline(
      extracted,
      ocrConfidence,
      imageOcrVisionMinConfidence
    );
    const shouldRunVisionFallback = extracted.length > textImagemMin && !ocrTrustworthy;
    if (shouldRunVisionFallback && config.openai.apiKey && extract.pageImages?.length) {
      const promptHint = extracted.slice(0, 8000);
      const extractUser = `Extraia todo o texto útil das páginas em anexo.\n\nOCR local (pode estar errado):\n"""${promptHint}"""`;
      const visionParts: VisionContentPart[] = [
        { type: "text", text: extractUser },
        ...extract.pageImages.map((img) => ({
          type: "image_url" as const,
          image_url: { url: asDataUrlImage(img), detail: "high" as const },
        })),
      ];
      const visionResult = await openaiChatVisionJson({
        messages: [
          { role: "system", content: VISION_EXTRACT_TEXT_SYS },
          { role: "user", content: visionParts },
        ],
      });
      preProcessCost += visionResult.costUsd;
      const parsed = parseJsonLoose(visionResult.content);
      const visionText = String(parsed.texto ?? "").trim();
      if (visionText) {
        extracted = visionText;
        pipelineUsed = "extract_pdf_ocr_vision";
        preProcessWarning = appendProcessingWarning(
          preProcessWarning,
          `OCR do PDF com confiança baixa (${ocrConfidence == null ? "indisponível" : Math.round(ocrConfidence)}/${ocrMinConf}); texto reextraído por visão.`
        );
      } else {
        preProcessWarning = appendProcessingWarning(
          preProcessWarning,
          "OCR do PDF foi considerado pouco confiável, mas a reextração por visão não retornou texto útil."
        );
      }
    } else if (shouldRunVisionFallback && !config.openai.apiKey) {
      preProcessWarning = appendProcessingWarning(
        preProcessWarning,
        "OCR do PDF com baixa confiança e OPENAI_API_KEY ausente; mantendo texto OCR local."
      );
    }
    if (extract.ocrPages?.truncated) {
      preProcessWarning = appendProcessingWarning(
        preProcessWarning,
        `OCR PDF limitado às primeiras ${extract.ocrPages.rendered} páginas de ${extract.ocrPages.total}.`
      );
    }
  }

  const textOut = await processTextMemoForReview({
    userId: input.userId,
    groupId: row.groupId,
    isAdmin: input.isAdmin,
    rawText: extracted,
    iaUseTexto: iaLevel,
    maxSummaryChars: maxDoc,
  });

  // Compatibilidade: guarda sugestão de dados específicos no metadata do memo para o confirm
  // conseguir persistir mesmo se o frontend não enviar esse campo (cliente desatualizado).
  try {
    const m = row.mediaMetadata ? (JSON.parse(row.mediaMetadata) as Record<string, unknown>) : {};
    if (typeof textOut.dadosEspecificosJson === "string" && textOut.dadosEspecificosJson.trim()) {
      m.reviewSuggestedDadosEspecificosJson = textOut.dadosEspecificosJson.trim();
    } else {
      delete m.reviewSuggestedDadosEspecificosJson;
    }
    if (
      typeof textOut.dadosEspecificosOriginaisJson === "string" &&
      textOut.dadosEspecificosOriginaisJson.trim()
    ) {
      m.reviewSuggestedDadosEspecificosOriginaisJson = textOut.dadosEspecificosOriginaisJson.trim();
    } else {
      delete m.reviewSuggestedDadosEspecificosOriginaisJson;
    }
    if (typeof textOut.matchedCategoryId === "number" && Number.isFinite(textOut.matchedCategoryId)) {
      m.reviewSuggestedMatchedCategoryId = Math.floor(textOut.matchedCategoryId);
    } else {
      delete m.reviewSuggestedMatchedCategoryId;
    }
    await pool.query(`UPDATE memos SET mediaMetadata = ? WHERE id = ? AND userId = ?`, [
      JSON.stringify(m),
      input.memoId,
      input.userId,
    ]);
  } catch {
    // best-effort: não bloquear a revisão por falha neste cache temporário
  }

  let processingWarning = textOut.processingWarning ?? null;
  if (pipelineUsed === "extract_pdf_text") {
    processingWarning = processingWarning
      ? `${processingWarning} Texto obtido por extração local do PDF (sem OCR para imagens digitalizadas).`
      : "Texto obtido por extração local do PDF. PDFs só com imagem podem precisar de OCR num pipeline futuro.";
  } else if (pipelineUsed === "extract_pdf_ocr" || pipelineUsed === "extract_pdf_ocr_vision") {
    processingWarning = appendProcessingWarning(
      processingWarning,
      `Texto extraído por OCR de PDF (${pipelineUsed === "extract_pdf_ocr_vision" ? "com reextração por visão" : "Tesseract local"}).`
    );
  }
  processingWarning = appendProcessingWarning(processingWarning, preProcessWarning);

  return {
    ...textOut,
    apiCost: Math.round((textOut.apiCost + preProcessCost) * 1e8) / 1e8,
    processingWarning,
    memoId: input.memoId,
    mediaDocumentUrl: row.mediaDocumentUrl,
    originalFilename,
    mime,
    pipelineUsed,
    tamMediaUrl,
  };
}
