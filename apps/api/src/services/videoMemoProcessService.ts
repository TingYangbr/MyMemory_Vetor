import type { UserIaUseLevel, VideoMemoProcessResponse, VideoMemoProcessSource } from "@mymemory/shared";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { openaiTranscribeAudio } from "../lib/openaiTranscription.js";
import {
  extractFullAudioWav16kMonoFromBuffer,
  extractJpegKeyframesFromVideoBuffer,
  transcribeByTimeSegments,
} from "../lib/mediaTimeSegmentTranscribe.js";
import { transcriptLooksLikeWhisperHallucinationOrNoise } from "../lib/transcriptGarbage.js";
import { pool } from "../db.js";
import { assertUserWorkspaceGroupAccess } from "./memoContextService.js";
import { resolveLargeMediaSegmentedTranscription } from "./mediaLimitsService.js";
import { storeMemoBinaryAndGetUrl } from "./memoService.js";
import { processVideoKeyframesForReview } from "./videoMemoVisionService.js";
import {
  resolveMaxSummaryCharsForVideo,
  resolveTextImagemMinForPlan,
} from "./textMemoMaxSummary.js";
import { processTextMemoForReview, processVideoTranscriptBasicoForReview } from "./textMemoProcessService.js";

export async function getUserIaUseVideo(userId: number): Promise<UserIaUseLevel> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT iaUseVideo FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const v = rows[0]?.iaUseVideo;
  if (v === "semIA" || v === "basico" || v === "completo") return v;
  return "basico";
}

function finish(
  partial: Omit<VideoMemoProcessResponse, "textImagemMin"> & { source: VideoMemoProcessSource },
  textImagemMin: number
): VideoMemoProcessResponse {
  return { ...partial, textImagemMin };
}

/**
 * Grava vídeo, extrai áudio (WAV 16 kHz mono), transcreve (Whisper).
 * Se a transcrição tiver mais de `textImagemMin` caracteres e for considerada fala útil → fluxo texto (como antes).
 * Caso contrário → fotogramas + descrição por visão (alinhado ao limiar de imagem do plano).
 */
export async function processVideoMemoForReview(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  buffer: Buffer;
  mime: string;
  originalName: string;
  iaUseVideo?: UserIaUseLevel | null;
}): Promise<VideoMemoProcessResponse> {
  if (input.groupId != null) {
    await assertUserWorkspaceGroupAccess(input.userId, input.groupId, input.isAdmin);
  }

  const { mediaUrl, storedName } = await storeMemoBinaryAndGetUrl({
    userId: input.userId,
    buffer: input.buffer,
    mime: input.mime,
    originalName: input.originalName,
  });

  const maxSummaryChars = await resolveMaxSummaryCharsForVideo(
    input.userId,
    input.groupId,
    input.isAdmin
  );
  const textImagemMin = await resolveTextImagemMinForPlan(
    input.userId,
    input.groupId,
    input.isAdmin
  );
  const dbLevel = await getUserIaUseVideo(input.userId);
  const iaLevel = input.iaUseVideo ?? dbLevel;
  const tamMediaUrl = input.buffer.length;
  const originalFilename = input.originalName || storedName;

  if (iaLevel === "semIA") {
    return finish(
      {
        originalText: "",
        suggestedMediaText: "",
        suggestedKeywords: "",
        maxSummaryChars,
        apiCost: 0,
        iaLevel,
        processingWarning: null,
        mediaVideoUrl: mediaUrl,
        originalFilename,
        tamMediaUrl,
        source: "none",
      },
      textImagemMin
    );
  }

  if (!config.openai.apiKey) {
    return finish(
      {
        originalText: "",
        suggestedMediaText: "",
        suggestedKeywords: "",
        maxSummaryChars,
        apiCost: 0,
        iaLevel,
        processingWarning:
          "OPENAI_API_KEY não configurada — transcreva e preencha texto/keywords na revisão. O vídeo já foi armazenado.",
        mediaVideoUrl: mediaUrl,
        originalFilename,
        tamMediaUrl,
        source: "none",
      },
      textImagemMin
    );
  }

  let totalCost = 0;
  let processingWarning: string | null = null;

  const segPlan = await resolveLargeMediaSegmentedTranscription({
    userId: input.userId,
    groupId: input.groupId,
    isAdmin: input.isAdmin,
    kind: "video",
    fileSizeBytes: tamMediaUrl,
  });

  const wavBuffer = await extractFullAudioWav16kMonoFromBuffer({
    buffer: input.buffer,
    filename: originalFilename,
    mime: input.mime,
  });

  let transcript = "";
  let segMeta: {
    segmentCount: number;
    chunkMinutes: number;
    singlePassUnknownDuration?: boolean;
  } | null = null;

  if (wavBuffer && wavBuffer.length > 0) {
    if (segPlan.useSegmented) {
      const r = await transcribeByTimeSegments({
        buffer: wavBuffer,
        filename: "audio.wav",
        mime: "audio/wav",
        chunkMinutes: segPlan.chunkMinutes,
        transcribe: (x) => openaiTranscribeAudio(x),
      });
      transcript = r.text;
      totalCost += r.totalCostUsd;
      segMeta = {
        segmentCount: r.segmentCount,
        chunkMinutes: segPlan.chunkMinutes,
        singlePassUnknownDuration: r.singlePassUnknownDuration,
      };
    } else {
      const w = await openaiTranscribeAudio({
        buffer: wavBuffer,
        filename: "audio.wav",
        mime: "audio/wav",
      });
      transcript = w.text;
      totalCost += w.costUsd;
    }
  }

  const trimmed = transcript.trim();
  const durUnknownWarn = segMeta?.singlePassUnknownDuration
    ? "O áudio extraído não indicava duração nos metadados; a transcrição foi feita num único passo."
    : null;

  const consideredText =
    trimmed.length > textImagemMin && !transcriptLooksLikeWhisperHallucinationOrNoise(trimmed);

  if (!consideredText) {
    const frames = await extractJpegKeyframesFromVideoBuffer({
      buffer: input.buffer,
      filename: originalFilename,
      mime: input.mime,
    });

    if (!frames.length) {
      processingWarning = [
        wavBuffer
          ? null
          : "Não foi possível extrair áudio do arquivo (sem faixa de áudio ou formato não suportado).",
        "Não foi possível extrair fotogramas do vídeo para descrição automática.",
        trimmed
          ? `Transcrição (${trimmed.length} caracteres) não entra no fluxo de texto (limiar do plano: >${textImagemMin} caracteres fiáveis).`
          : `Sem transcrição útil para o fluxo de texto (limiar do plano: >${textImagemMin} caracteres).`,
      ]
        .filter(Boolean)
        .join(" ");

      return finish(
        {
          originalText: trimmed,
          suggestedMediaText: "",
          suggestedKeywords: "",
          maxSummaryChars,
          apiCost: Math.round(totalCost * 1e8) / 1e8,
          iaLevel,
          processingWarning,
          mediaVideoUrl: mediaUrl,
          originalFilename,
          tamMediaUrl,
          source: "none",
        },
        textImagemMin
      );
    }

    const visionOut = await processVideoKeyframesForReview({
      userId: input.userId,
      groupId: input.groupId,
      isAdmin: input.isAdmin,
      frames,
      maxSummaryChars,
      iaLevel,
      transcriptHint: trimmed,
      textImagemMin,
    });
    totalCost += visionOut.apiCost;

    const segWarn =
      segMeta && segMeta.segmentCount > 1
        ? `Transcrição em ${segMeta.segmentCount} segmentos (~${segMeta.chunkMinutes} min cada) antes do ramo visual.`
        : null;

    processingWarning = [durUnknownWarn, segWarn, visionOut.processingWarning].filter(Boolean).join(" ").trim() || null;

    return finish(
      {
        originalText: visionOut.originalText,
        suggestedMediaText: visionOut.suggestedMediaText,
        suggestedKeywords: visionOut.suggestedKeywords,
        maxSummaryChars: visionOut.maxSummaryChars,
        apiCost: Math.round(totalCost * 1e8) / 1e8,
        iaLevel: visionOut.iaLevel,
        processingWarning,
        mediaVideoUrl: mediaUrl,
        originalFilename,
        tamMediaUrl,
        source: visionOut.source,
      },
      textImagemMin
    );
  }

  if (iaLevel === "basico") {
    const textOut = await processVideoTranscriptBasicoForReview({
      userId: input.userId,
      groupId: input.groupId,
      isAdmin: input.isAdmin,
      transcript: trimmed,
      maxSummaryChars,
    });
    totalCost += textOut.apiCost;
    const segWarn =
      segMeta && segMeta.segmentCount > 1
        ? `Arquivo processado em ${segMeta.segmentCount} segmentos (~${segMeta.chunkMinutes} min por segmento).`
        : null;
    processingWarning =
      [
        durUnknownWarn,
        segWarn,
        `Transcrição com ${trimmed.length} caracteres (> limiar ${textImagemMin}) — fluxo de texto sobre o áudio.`,
        textOut.processingWarning ?? "Transcrição do vídeo analisada com IA básico (uma chamada: resumo, categorias e palavras-chave).",
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || null;

    return finish(
      {
        originalText: trimmed,
        suggestedMediaText: textOut.suggestedMediaText,
        suggestedKeywords: textOut.suggestedKeywords,
        maxSummaryChars,
        apiCost: Math.round(totalCost * 1e8) / 1e8,
        iaLevel,
        processingWarning,
        mediaVideoUrl: mediaUrl,
        originalFilename,
        tamMediaUrl,
        source: segPlan.useSegmented ? "video_segmented" : "video_basic",
      },
      textImagemMin
    );
  }

  const textOut = await processTextMemoForReview({
    userId: input.userId,
    groupId: input.groupId,
    isAdmin: input.isAdmin,
    rawText: trimmed,
    iaUseTexto: "completo",
    maxSummaryChars,
  });
  totalCost += textOut.apiCost;

  const segWarnFull =
    segMeta && segMeta.segmentCount > 1
      ? `Arquivo processado em ${segMeta.segmentCount} segmentos (~${segMeta.chunkMinutes} min por segmento).`
      : null;
  processingWarning =
    [
      durUnknownWarn,
      segWarnFull,
      `Transcrição com ${trimmed.length} caracteres (> limiar ${textImagemMin}) — fluxo de texto completo sobre o áudio.`,
      textOut.processingWarning ?? "Transcrição aplicada ao fluxo completo de memo em texto (categoria, subcategorias e campos).",
    ]
      .filter(Boolean)
      .join(" ")
      .trim() || null;

  return finish(
    {
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
      mediaVideoUrl: mediaUrl,
      originalFilename,
      tamMediaUrl,
      source: segPlan.useSegmented ? "video_segmented" : "video_full",
    },
    textImagemMin
  );
}
