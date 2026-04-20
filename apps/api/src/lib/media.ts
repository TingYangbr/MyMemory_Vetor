import path from "node:path";
import type { MemoMediaTypeDb } from "@mymemory/shared";

const DOC_EXT = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".msg",
  ".eml",
  ".dwg",
  ".txt",
  ".csv",
  ".ppt",
  ".pptx",
  ".rtf",
  ".odt",
  ".ods",
]);

/** Extensões de áudio comuns (evita classificar .opus/.webm como documento com MIME octet-stream). */
const AUDIO_EXT = new Set([
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".opus",
  ".webm",
  ".weba",
  ".m4a",
  ".flac",
  ".aac",
  ".wma",
]);

export function classifyFile(
  mime: string,
  filename: string
): Exclude<MemoMediaTypeDb, "text" | "url"> {
  const m = mime.toLowerCase().split(";")[0].trim();
  const ext = path.extname(filename).toLowerCase();
  // MIME primeiro: `.webm` pode ser áudio ou vídeo; gravações do browser costumam vir como `video/webm` mesmo só com áudio.
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("text/") || m === "application/pdf" || DOC_EXT.has(ext)) return "document";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "document";
}

/**
 * Rota de áudio: aceita `audio/*` e WebM com MIME `video/webm` (contentor típico de MediaRecorder só com faixa de áudio).
 */
export function isAcceptableForAudioProcess(mime: string, filename: string): boolean {
  if (classifyFile(mime, filename) === "audio") return true;
  const m = mime.toLowerCase().split(";")[0].trim();
  const ext = path.extname(filename).toLowerCase();
  return (ext === ".webm" || ext === ".weba") && m === "video/webm";
}

export function safeBasename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base.slice(0, 200) || "file";
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".eml": "message/rfc822",
  ".msg": "application/vnd.ms-outlook",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".dwg": "application/acad",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".weba": "audio/webm",
  ".m4a": "audio/mp4",
};

export function guessMimeFromFilename(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
