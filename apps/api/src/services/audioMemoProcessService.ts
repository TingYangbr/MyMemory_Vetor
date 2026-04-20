import type { AudioMemoProcessResponse, AudioMemoProcessSource, UserIaUseLevel } from "@mymemory/shared";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { openaiTranscribeAudio } from "../lib/openaiTranscription.js";
import { transcribeByTimeSegments } from "../lib/mediaTimeSegmentTranscribe.js";
import { pool } from "../db.js";
import { assertUserWorkspaceGroupAccess } from "./memoContextService.js";
import { resolveLargeMediaSegmentedTranscription } from "./mediaLimitsService.js";
import { storeMemoBinaryAndGetUrl } from "./memoService.js";
import { transcriptLooksLikeWhisperHallucinationOrNoise } from "../lib/transcriptGarbage.js";
import { resolveMaxSummaryCharsForAudio } from "./textMemoMaxSummary.js";
import { processTextMemoForReview } from "./textMemoProcessService.js";

export async function getUserIaUseAudio(userId: number): Promise<UserIaUseLevel> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT iaUseAudio FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const v = rows[0]?.iaUseAudio;
  if (v === "semIA" || v === "basico" || v === "completo") return v;
  return "basico";
}

function baseResponse(
  partial: Omit<AudioMemoProcessResponse, "mediaAudioUrl" | "originalFilename" | "tamMediaUrl" | "source"> & {
    mediaAudioUrl: string;
    originalFilename: string;
    tamMediaUrl: number;
    source: AudioMemoProcessSource;
  }
): AudioMemoProcessResponse {
  return { ...partial };
}

/**
 * Grava áudio no armazenamento.
 * - semIA: sem transcrição; revisão com texto/keywords vazios.
 * - basico: Whisper + uma chamada LLM (como texto básico).
 * - completo: Whisper + duas chamadas LLM (categoria fechada, depois subcategorias/campos).
 */
export async function processAudioMemoForReview(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  buffer: Buffer;
  mime: string;
  originalName: string;
  iaUseAudio?: UserIaUseLevel | null;
}): Promise<AudioMemoProcessResponse> {
  if (input.groupId != null) {
    await assertUserWorkspaceGroupAccess(input.userId, input.groupId, input.isAdmin);
  }

  const { mediaUrl, storedName } = await storeMemoBinaryAndGetUrl({
    userId: input.userId,
    buffer: input.buffer,
    mime: input.mime,
    originalName: input.originalName,
  });

  const maxSummaryChars = await resolveMaxSummaryCharsForAudio(
    input.userId,
    input.groupId,
    input.isAdmin
  );
  const dbLevel = await getUserIaUseAudio(input.userId);
  const iaLevel = input.iaUseAudio ?? dbLevel;
  const tamMediaUrl = input.buffer.length;
  const originalFilename = input.originalName || storedName;

  if (iaLevel === "semIA") {
    return baseResponse({
      originalText: "",
      suggestedMediaText: "",
      suggestedKeywords: "",
      maxSummaryChars,
      apiCost: 0,
      iaLevel,
      processingWarning: null,
      mediaAudioUrl: mediaUrl,
      originalFilename,
      tamMediaUrl,
      source: "none",
    });
  }

  if (!config.openai.apiKey) {
    return baseResponse({
      originalText: "",
      suggestedMediaText: "",
      suggestedKeywords: "",
      maxSummaryChars,
      apiCost: 0,
      iaLevel,
      processingWarning:
        "OPENAI_API_KEY não configurada — transcreva e preencha texto/keywords na revisão. O áudio já foi armazenado.",
      mediaAudioUrl: mediaUrl,
      originalFilename,
      tamMediaUrl,
      source: "none",
    });
  }

  let totalCost = 0;
  let processingWarning: string | null = null;

  const seg = await resolveLargeMediaSegmentedTranscription({
    userId: input.userId,
    groupId: input.groupId,
    isAdmin: input.isAdmin,
    kind: "audio",
    fileSizeBytes: tamMediaUrl,
  });

  let transcript: string;
  let segMeta: {
    segmentCount: number;
    chunkMinutes: number;
    singlePassUnknownDuration?: boolean;
  } | null = null;
  if (seg.useSegmented) {
    const r = await transcribeByTimeSegments({
      buffer: input.buffer,
      filename: originalFilename,
      mime: input.mime,
      chunkMinutes: seg.chunkMinutes,
      transcribe: (x) => openaiTranscribeAudio(x),
    });
    transcript = r.text;
    totalCost += r.totalCostUsd;
    segMeta = {
      segmentCount: r.segmentCount,
      chunkMinutes: seg.chunkMinutes,
      singlePassUnknownDuration: r.singlePassUnknownDuration,
    };
  } else {
    const w = await openaiTranscribeAudio({
      buffer: input.buffer,
      filename: originalFilename,
      mime: input.mime,
    });
    transcript = w.text;
    totalCost += w.costUsd;
  }

  const trimmed = transcript.trim();
  if (!trimmed) {
    processingWarning =
      "Nenhuma fala detetada na transcrição (áudio vazio ou ilegível). Preencha o texto do memo na revisão.";
    return baseResponse({
      originalText: "",
      suggestedMediaText: "",
      suggestedKeywords: "",
      maxSummaryChars,
      apiCost: Math.round(totalCost * 1e8) / 1e8,
      iaLevel,
      processingWarning,
      mediaAudioUrl: mediaUrl,
      originalFilename,
      tamMediaUrl,
      source: "none",
    });
  }

  if (transcriptLooksLikeWhisperHallucinationOrNoise(trimmed)) {
    processingWarning =
      "Não foi detetada fala clara (ou a transcrição automática produziu texto espúrio em áudio muito silencioso ou ambiente). Preencha o texto do memo na revisão.";
    return baseResponse({
      originalText: "",
      suggestedMediaText: "",
      suggestedKeywords: "",
      maxSummaryChars,
      apiCost: Math.round(totalCost * 1e8) / 1e8,
      iaLevel,
      processingWarning,
      mediaAudioUrl: mediaUrl,
      originalFilename,
      tamMediaUrl,
      source: "none",
    });
  }

  const textOut = await processTextMemoForReview({
    userId: input.userId,
    groupId: input.groupId,
    isAdmin: input.isAdmin,
    rawText: trimmed,
    iaUseTexto: iaLevel,
    maxSummaryChars,
  });
  totalCost += textOut.apiCost;

  const source: AudioMemoProcessSource = seg.useSegmented
    ? "speech_segmented"
    : iaLevel === "completo"
      ? "speech_full"
      : "speech_basic";

  const durUnknownWarn = segMeta?.singlePassUnknownDuration
    ? "O arquivo não indica duração nos metadados (comum em WebM do Chrome); a transcrição foi feita num único passo em vez de segmentos temporais."
    : null;
  const segWarn =
    segMeta && segMeta.segmentCount > 1
      ? `Arquivo processado em ${segMeta.segmentCount} segmentos (~${segMeta.chunkMinutes} min por segmento).`
      : null;
  const tailWarn =
    textOut.processingWarning ??
    (iaLevel === "completo"
      ? "Transcrição aplicada ao fluxo completo de memo em texto (categoria, subcategorias e campos)."
      : null);
  processingWarning = [durUnknownWarn, segWarn, tailWarn].filter(Boolean).join(" ").trim() || null;

  return baseResponse({
    originalText: textOut.originalText,
    suggestedMediaText: textOut.suggestedMediaText,
    suggestedKeywords: textOut.suggestedKeywords,
    dadosEspecificosJson: textOut.dadosEspecificosJson ?? null,
    dadosEspecificosOriginaisJson: textOut.dadosEspecificosOriginaisJson ?? null,
    matchedCategoryId: textOut.matchedCategoryId ?? null,
    maxSummaryChars: textOut.maxSummaryChars,
    apiCost: Math.round(totalCost * 1e8) / 1e8,
    iaLevel: textOut.iaLevel,
    processingWarning,
    mediaAudioUrl: mediaUrl,
    originalFilename,
    tamMediaUrl,
    source,
  });
}
