import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

/**
 * WebM do browser e Opus (Ogg/.opus) costumam falhar ou ser rejeitados pelo Whisper — normalizar com ffmpeg.
 */
export function audioLikelyNeedsFfmpegForWhisper(filename: string, mime: string): boolean {
  const base = path.basename(filename.toLowerCase());
  const ml = mime.toLowerCase();
  const m = ml.split(";")[0].trim();
  return (
    base.endsWith(".webm") ||
    base.endsWith(".weba") ||
    base.endsWith(".opus") ||
    base.endsWith(".oga") ||
    ml.includes("webm") ||
    ml.includes("opus") ||
    m === "video/webm" ||
    m === "video/mp4" ||
    m === "audio/opus"
  );
}

/**
 * Converte para WAV PCM 16 kHz mono (adequado à API de transcrição).
 * `inputExtensionWithDot` deve refletir o contentor real (ex.: `.webm`).
 */
export async function transcodeAudioBufferToWav16kMono(
  input: Buffer,
  inputExtensionWithDot: string
): Promise<Buffer> {
  const bin = ffmpegStatic;
  if (!bin || typeof bin !== "string") {
    throw new Error("ffmpeg_static_unavailable");
  }
  const raw = inputExtensionWithDot.startsWith(".") ? inputExtensionWithDot : `.${inputExtensionWithDot}`;
  const ext = raw.toLowerCase();
  const allowed = new Set([
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
  ]);
  const safeExt = allowed.has(ext) ? ext : ".webm";

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mm-whisper-"));
  const inFile = path.join(tmp, `in${safeExt}`);
  const outFile = path.join(tmp, "out.wav");
  try {
    await fs.writeFile(inFile, input);
    await execFileAsync(
      bin,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inFile,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "wav",
        outFile,
      ],
      { maxBuffer: 40 * 1024 * 1024 }
    );
    const out = await fs.readFile(outFile);
    if (!out.length) {
      throw new Error("ffmpeg_produced_empty_wav");
    }
    return out;
  } catch (err: unknown) {
    const xe = err as { stderr?: Buffer; message?: string };
    const detail = xe.stderr?.toString("utf8")?.trim() || xe.message || String(err);
    throw new Error(`ffmpeg_transcode_failed: ${detail.slice(0, 600)}`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
