import path from "node:path";
import { config } from "../config.js";
import { audioLikelyNeedsFfmpegForWhisper, transcodeAudioBufferToWav16kMono } from "./audioFfmpegNormalize.js";

/** Estimativa conservadora (Whisper ~$0.006/min); tamanho do arquivo como proxy de duração. */
export function estimateWhisperCostUsd(byteLength: number): number {
  const bytesPerMinute = 240_000;
  const minutes = Math.max(0.05, byteLength / bytesPerMinute);
  return Math.round(minutes * 0.006 * 1e8) / 1e8;
}

function extForMime(mime: string): string | null {
  const m = mime.toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".mp4",
    "audio/wave": ".wav",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/x-m4a": ".m4a",
    "audio/flac": ".flac",
    "audio/opus": ".opus",
    "video/webm": ".webm",
    "video/mp4": ".mp4",
  };
  return map[m] ?? null;
}

function mimeFromFilename(filename: string): string {
  const n = filename.toLowerCase();
  const ext = n.includes(".") ? n.slice(n.lastIndexOf(".")) : "";
  const map: Record<string, string> = {
    ".webm": "audio/webm",
    ".mp3": "audio/mpeg",
    ".mpeg": "audio/mpeg",
    ".mp4": "audio/mp4",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".flac": "audio/flac",
    ".opus": "audio/opus",
    ".weba": "audio/webm",
  };
  return map[ext] || "application/octet-stream";
}

function ensureWhisperFilename(filename: string, mime: string): string {
  const trimmed = filename?.trim() || "audio";
  if (/\.[a-z0-9]{2,5}$/i.test(trimmed)) return trimmed;
  const ext = extForMime(mime) || ".webm";
  return `${trimmed}${ext}`;
}

function parseOpenAiErrorBody(raw: string): string {
  const slice = raw.slice(0, 800).trim();
  try {
    const j = JSON.parse(raw) as { error?: { message?: string; code?: string } };
    const msg = j.error?.message?.trim();
    if (msg) return j.error?.code ? `${j.error.code}: ${msg}` : msg;
  } catch {
    /* ignore */
  }
  return slice || "(sem detalhe no corpo)";
}

async function postWhisperTranscription(input: {
  buffer: Buffer;
  uploadName: string;
  contentType: string;
}): Promise<{ text: string; costUsd: number }> {
  const key = config.openai.apiKey;
  if (!key) {
    throw new Error("openai_not_configured");
  }
  const form = new FormData();
  const blob = new Blob([new Uint8Array(input.buffer)], { type: input.contentType });
  form.append("file", blob, input.uploadName);
  form.append("model", config.openai.whisperModel);
  const lang = config.openai.whisperLanguage;
  if (lang) {
    form.append("language", lang);
  }

  const url = `${config.openai.baseUrl}/audio/transcriptions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const raw = await res.text();
  if (!res.ok) {
    const detail = parseOpenAiErrorBody(raw);
    throw new Error(`openai_whisper_http_${res.status}: ${detail}`);
  }
  let j: { text?: string };
  try {
    j = JSON.parse(raw) as { text?: string };
  } catch {
    const err = new Error("openai_whisper_invalid_json");
    (err as Error & { body?: string }).body = raw.slice(0, 400);
    throw err;
  }
  const text = typeof j.text === "string" ? j.text.trim() : "";
  return { text, costUsd: estimateWhisperCostUsd(input.buffer.length) };
}

export async function openaiTranscribeAudio(input: {
  buffer: Buffer;
  filename: string;
  mime: string;
}): Promise<{ text: string; costUsd: number }> {
  if (!config.openai.apiKey) {
    throw new Error("openai_not_configured");
  }
  if (!input.buffer.length) {
    throw new Error("openai_whisper_empty_file");
  }

  const uploadName0 = ensureWhisperFilename(input.filename, input.mime);
  let ext =
    path.extname(uploadName0).toLowerCase() ||
    extForMime(input.mime) ||
    ".webm";

  let buffer = input.buffer;
  let uploadName = uploadName0;
  let contentType = input.mime?.trim()?.split(";")[0]?.trim() || "";
  if (!contentType || contentType === "application/octet-stream") {
    contentType = mimeFromFilename(uploadName);
  }

  let sentViaFfmpeg = false;
  if (audioLikelyNeedsFfmpegForWhisper(uploadName, input.mime)) {
    buffer = await transcodeAudioBufferToWav16kMono(buffer, ext);
    uploadName = "normalized.wav";
    contentType = "audio/wav";
    sentViaFfmpeg = true;
  }

  try {
    return await postWhisperTranscription({ buffer, uploadName, contentType });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isFormatRejection =
      msg.includes("Invalid file format") ||
      msg.includes("invalid_file_format") ||
      /openai_whisper_http_400/.test(msg);
    if (!sentViaFfmpeg && isFormatRejection) {
      const wav = await transcodeAudioBufferToWav16kMono(input.buffer, ext);
      return await postWhisperTranscription({
        buffer: wav,
        uploadName: "normalized.wav",
        contentType: "audio/wav",
      });
    }
    throw e;
  }
}
