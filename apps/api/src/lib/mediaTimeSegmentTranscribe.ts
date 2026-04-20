import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { clampChunkMinutes } from "./mediaChunkMinutes.js";

export { clampChunkMinutes } from "./mediaChunkMinutes.js";

function ffmpegBin(): string {
  const bin = ffmpegStatic;
  if (!bin || typeof bin !== "string") {
    throw new Error("ffmpeg_static_unavailable");
  }
  return bin;
}

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr?.on("data", (c: Buffer) => {
      err += c.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr: err }));
  });
}

/** `Duration: HH:MM:SS(.xx)` no texto de probe (ignora `Duration: N/A`). */
function parseDurationHmsFromFfmpegStderr(stderr: string): number | null {
  let best: number | null = null;
  const re = /Duration:\s*(\d{1,4}):(\d{2}):(\d{2})(\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    const h = Number(m[1]);
    const mn = Number(m[2]);
    const s = Number(m[3]) + (m[4] ? Number(m[4]) : 0);
    if (!Number.isFinite(h) || !Number.isFinite(mn) || !Number.isFinite(s)) continue;
    const sec = h * 3600 + mn * 60 + s;
    if (sec > 0) best = sec;
  }
  return best;
}

/** Progresso `time=…` durante decode (WebM/Opus sem duração no header). */
function parseLastTimeFromDecodeStderr(stderr: string): number | null {
  let best: number | null = null;
  const reHms = /\btime=(\d+):(\d+):(\d+\.\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = reHms.exec(stderr)) !== null) {
    const h = Number(m[1]);
    const mn = Number(m[2]);
    const s = Number(m[3]);
    if (!Number.isFinite(h) || !Number.isFinite(mn) || !Number.isFinite(s)) continue;
    const sec = h * 3600 + mn * 60 + s;
    if (sec > (best ?? 0)) best = sec;
  }
  const reFlat = /\btime=(\d+\.\d+)\b/g;
  while ((m = reFlat.exec(stderr)) !== null) {
    const sec = Number(m[1]);
    if (Number.isFinite(sec) && sec > (best ?? 0)) best = sec;
  }
  return best;
}

/**
 * Duração em segundos: probe rápido, probe alargado, ou decode completo para null muxer.
 * WebM gravado no Chrome costuma reportar `Duration: N/A` até analisar o arquivo todo.
 */
export async function probeMediaDurationSeconds(inFile: string): Promise<number | null> {
  const pass1 = await runFfmpeg(["-hide_banner", "-i", inFile]);
  const d1 = parseDurationHmsFromFfmpegStderr(pass1.stderr);
  if (d1 != null && d1 > 0) return d1;

  const pass2 = await runFfmpeg([
    "-hide_banner",
    "-probesize",
    "100M",
    "-analyzeduration",
    "100M",
    "-i",
    inFile,
  ]);
  const d2 = parseDurationHmsFromFfmpegStderr(pass2.stderr);
  if (d2 != null && d2 > 0) return d2;

  const pass3 = await runFfmpeg([
    "-hide_banner",
    "-stats",
    "-loglevel",
    "info",
    "-i",
    inFile,
    "-f",
    "null",
    "-",
  ]);
  const d3 = parseLastTimeFromDecodeStderr(pass3.stderr);
  if (d3 != null && d3 > 0) return d3;

  return null;
}

const ALLOWED_EXT = new Set([
  ".webm",
  ".weba",
  ".ogg",
  ".oga",
  ".opus",
  ".mp4",
  ".m4a",
  ".mkv",
  ".mpeg",
  ".mpg",
  ".mp3",
  ".wav",
  ".flac",
  ".mov",
]);

function safeInputExt(filename: string, mime: string): string {
  const fromName = path.extname(filename || "").toLowerCase();
  if (fromName && ALLOWED_EXT.has(fromName)) return fromName;
  const ml = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (ml.includes("webm")) return ".webm";
  if (ml.includes("mp4")) return ".mp4";
  if (ml.includes("mpeg") || ml === "audio/mp3") return ".mp3";
  if (ml.includes("wav")) return ".wav";
  if (ml.includes("ogg")) return ".ogg";
  if (ml.includes("mp4") && ml.includes("audio")) return ".m4a";
  return ".webm";
}

export type TranscribeSegmentFn = (input: {
  buffer: Buffer;
  filename: string;
  mime: string;
}) => Promise<{ text: string; costUsd: number }>;

/**
 * Transcreve áudio ou vídeo (faixa de áudio) em segmentos temporais no servidor (modelo B).
 * Junta transcrições com quebra dupla entre segmentos.
 */
export async function transcribeByTimeSegments(input: {
  buffer: Buffer;
  filename: string;
  mime: string;
  chunkMinutes: number;
  transcribe: TranscribeSegmentFn;
}): Promise<{
  text: string;
  totalCostUsd: number;
  segmentCount: number;
  /** Duração desconhecida no header: uma única chamada Whisper (arquivo completo). */
  singlePassUnknownDuration?: boolean;
}> {
  const chunkMin = clampChunkMinutes(input.chunkMinutes);
  const chunkSec = chunkMin * 60;
  const ext = safeInputExt(input.filename, input.mime);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mm-seg-"));
  const inFile = path.join(tmp, `in${ext}`);
  await fs.writeFile(inFile, input.buffer);
  const totalDur = await probeMediaDurationSeconds(inFile);
  if (totalDur == null || !Number.isFinite(totalDur) || totalDur <= 0) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    const { text, costUsd } = await input.transcribe({
      buffer: input.buffer,
      filename: input.filename,
      mime: input.mime,
    });
    return {
      text: text.trim(),
      totalCostUsd: Math.round(costUsd * 1e8) / 1e8,
      segmentCount: 1,
      singlePassUnknownDuration: true,
    };
  }

  const parts: string[] = [];
  let totalCostUsd = 0;
  let segIndex = 0;
  for (let start = 0; start < totalDur - 0.05; start += chunkSec) {
    const len = Math.min(chunkSec, totalDur - start);
    if (len < 0.5) break;
    const outWav = path.join(tmp, `seg_${segIndex}.wav`);
    const { code, stderr } = await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(start),
      "-i",
      inFile,
      "-t",
      String(len),
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      outWav,
    ]);
    if (code !== 0) {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
      throw new Error(`ffmpeg_segment_failed: ${stderr.slice(-500)}`);
    }
    const wavBuf = await fs.readFile(outWav);
    await fs.unlink(outWav).catch(() => {});
    if (!wavBuf.length) {
      segIndex += 1;
      continue;
    }
    const { text, costUsd } = await input.transcribe({
      buffer: wavBuf,
      filename: `segmento-${segIndex + 1}.wav`,
      mime: "audio/wav",
    });
    totalCostUsd += costUsd;
    const t = text.trim();
    if (t) parts.push(t);
    segIndex += 1;
  }

  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});

  const text = parts.join("\n\n").trim();
  return {
    text,
    totalCostUsd: Math.round(totalCostUsd * 1e8) / 1e8,
    segmentCount: segIndex,
  };
}

/**
 * Extrai toda a faixa de áudio do vídeo (ou áudio) para WAV PCM 16 kHz mono (adequado ao Whisper).
 * Devolve `null` se não houver áudio ou o ffmpeg falhar.
 */
export async function extractFullAudioWav16kMonoFromBuffer(input: {
  buffer: Buffer;
  filename: string;
  mime: string;
}): Promise<Buffer | null> {
  if (!input.buffer.length) return null;
  const ext = safeInputExt(input.filename, input.mime);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mm-aud-"));
  try {
    const inFile = path.join(tmp, `in${ext}`);
    await fs.writeFile(inFile, input.buffer);
    const outWav = path.join(tmp, "full.wav");
    const { code } = await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inFile,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      outWav,
    ]);
    if (code !== 0) return null;
    const wav = await fs.readFile(outWav);
    return wav.length ? wav : null;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

const KEYFRAME_CAP = 8;

/**
 * Extrai fotogramas JPEG espaçados ao longo do vídeo (ordem temporal), para descrição por visão.
 */
export async function extractJpegKeyframesFromVideoBuffer(input: {
  buffer: Buffer;
  filename: string;
  mime: string;
  /** Entre 1 e 8; predefinido 6. */
  frameCount?: number;
}): Promise<Buffer[]> {
  if (!input.buffer.length) return [];
  const n = Math.min(KEYFRAME_CAP, Math.max(1, Math.floor(input.frameCount ?? 6)));
  const ext = safeInputExt(input.filename, input.mime);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mm-vkf-"));
  const frames: Buffer[] = [];
  try {
    const inFile = path.join(tmp, `in${ext}`);
    await fs.writeFile(inFile, input.buffer);
    const dur = await probeMediaDurationSeconds(inFile);
    const positions: number[] = [];
    if (dur == null || !Number.isFinite(dur) || dur <= 0) {
      positions.push(0);
    } else if (n === 1) {
      positions.push(0);
    } else {
      const last = Math.max(0, dur - 0.1);
      for (let i = 0; i < n; i++) {
        positions.push((i / (n - 1)) * last);
      }
    }
    for (let i = 0; i < positions.length; i++) {
      const outJpg = path.join(tmp, `f_${i}.jpg`);
      const { code } = await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(positions[i] ?? 0),
        "-i",
        inFile,
        "-frames:v",
        "1",
        "-vf",
        "scale=1280:-2",
        "-q:v",
        "3",
        outJpg,
      ]);
      if (code === 0) {
        const b = await fs.readFile(outJpg);
        if (b.length) frames.push(b);
      }
      await fs.unlink(outJpg).catch(() => {});
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return frames;
}
