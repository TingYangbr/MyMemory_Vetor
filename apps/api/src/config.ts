import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Raiz do monorepo (opcional) e depois `apps/api/.env` — este sobrescreve chaves iguais. */
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

const isProd = process.env.NODE_ENV === "production";

/** Disco local: `1` = /media estático sem auth (só dev); `0` = sempre com JWT; vazio = público só fora de produção. */
function mediaLocalPublicFromEnv(): boolean {
  const v = process.env.MEDIA_LOCAL_PUBLIC;
  if (v === "1") return true;
  if (v === "0") return false;
  return !isProd;
}

function normalizeOpenAiBaseUrl(raw: string): string {
  let u = raw.trim().replace(/\/$/, "");
  if (!u.endsWith("/v1")) {
    u = `${u}/v1`;
  }
  return u;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  /**
   * Origens permitidas (CORS com cookies). `CORS_ORIGIN` pode listar várias separadas por vírgula.
   * Em desenvolvimento, se `CORS_ORIGIN` estiver vazio, aceita `localhost` e `127.0.0.1` na porta do Vite
   * (evita “Failed to fetch” ao abrir o front por um dos dois).
   */
  corsOrigins: (() => {
    const fromEnv = (process.env.CORS_ORIGIN ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const devLoopbacks = ["http://localhost:5173", "http://127.0.0.1:5173"];
    if (!isProd) {
      // Em dev, sempre aceita localhost e 127.0.0.1, mesmo se CORS_ORIGIN listar só um (evita Failed to fetch).
      return [...new Set([...fromEnv, ...devLoopbacks])];
    }
    if (fromEnv.length) return fromEnv;
    return ["http://localhost:5173"];
  })(),
  mysql: {
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "mymemory",
    password: process.env.MYSQL_PASSWORD ?? "mymemory_secret",
    database: process.env.MYSQL_DATABASE ?? "mymemory",
  },
  /** Relativo a `apps/api` se não for caminho absoluto */
  uploadsDir: process.env.UPLOADS_DIR ?? "uploads",
  /** ID do usuário em `users` quando não há JWT e o fallback de dev está ativo */
  devUserId: Number(process.env.DEV_USER_ID ?? 1),
  allowDevUserHeader:
    process.env.ALLOW_DEV_USER_HEADER === "1" ||
    process.env.NODE_ENV !== "production",
  /**
   * Em desenvolvimento, sem cookie JWT, usa DEV_USER_ID (comportamento antigo da API).
   * Defina USE_DEV_FALLBACK=0 para forçar login na web em dev.
   */
  useDevUserFallback: !isProd && process.env.USE_DEV_FALLBACK !== "0",

  jwtSecret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-me",
  cookieSecure: isProd,
  resendApiKey: (process.env.RESEND_API_KEY ?? "").trim(),
  /** Resend aceita `email@dominio` ou `Nome <email@dominio>`. */
  emailFrom: (process.env.EMAIL_FROM ?? "MyMemory <onboarding@resend.dev>").trim(),
  /** Origem do front (links nos e-mails). Sem barra final. */
  publicWebUrl: (process.env.PUBLIC_WEB_URL ?? "http://localhost:5173").replace(/\/$/, ""),

  /**
   * `local` = disco em `uploadsDir`; `s3` = AWS S3 (URL absoluta nos campos `media*Url`).
   * Ative com `MEDIA_STORAGE=s3` ou `STORAGE_MODE=s3`.
   */
  mediaStorage: (() => {
    const a = (process.env.MEDIA_STORAGE ?? "").trim().toLowerCase();
    const b = (process.env.STORAGE_MODE ?? "").trim().toLowerCase();
    if (a === "s3" || b === "s3") return "s3" as const;
    return "local" as const;
  })(),
  /** Ver `mediaLocalPublicFromEnv`. Em produção SaaS use `0` ou S3. */
  mediaLocalPublic: mediaLocalPublicFromEnv(),
  s3: {
    bucket: (process.env.S3_BUCKET ?? process.env.S3_BUCKET_NAME ?? "").trim(),
    region: (process.env.AWS_REGION ?? process.env.S3_REGION ?? "us-east-1").trim(),
    publicBaseUrl: (process.env.S3_PUBLIC_BASE_URL ?? process.env.S3_PUBLIC_URL ?? "")
      .trim()
      .replace(/\/$/, ""),
    accessKeyId: (process.env.AWS_ACCESS_KEY_ID ?? "").trim(),
    secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY ?? "").trim(),
    endpoint: (process.env.S3_ENDPOINT ?? "").trim(),
    /**
     * Preço aproximado por GiB de saída (egress) para estimar custo por download em `download_logs.costUsd`.
     * Ex.: 0.09 (USD). Vazio = não grava custo (costUsd NULL).
     */
    egressUsdPerGb: (() => {
      const raw = (process.env.S3_EGRESS_USD_PER_GB ?? "").trim().replace(",", ".");
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    })(),
  },
  openai: {
    apiKey: (process.env.OPENAI_API_KEY ?? "").trim(),
    /** Base com `/v1` (ex.: https://api.openai.com/v1). */
    baseUrl: normalizeOpenAiBaseUrl(process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com/v1"),
    model: (process.env.OPENAI_MODEL ?? "gpt-4o-mini").trim(),
    /** Modelo de transcrição (`/v1/audio/transcriptions`). */
    whisperModel: (process.env.OPENAI_WHISPER_MODEL ?? "whisper-1").trim(),
    /**
     * ISO 639-1 (ex.: `pt`). Variável **omitida** no ambiente → `pt` (evita Whisper a assumir japonês/outro em ruído).
     * Para deteção automática pela API, defina explicitamente `OPENAI_WHISPER_LANGUAGE=` (string vazia).
     */
    whisperLanguage: (() => {
      if (process.env.OPENAI_WHISPER_LANGUAGE === undefined) return "pt";
      return (process.env.OPENAI_WHISPER_LANGUAGE ?? "").trim();
    })(),
  },
};

if (isProd && config.jwtSecret === "dev-jwt-secret-change-me") {
  console.warn("[config] JWT_SECRET não definido — defina um segredo forte em produção.");
}

/** Falha no boot se S3 estiver ativado sem bucket (não importa o SDK AWS). */
export function assertMediaStorageEnv(): void {
  if (config.mediaStorage !== "s3") return;
  if (!config.s3.bucket.trim()) {
    throw new Error(
      "S3 ativo (MEDIA_STORAGE=s3 ou STORAGE_MODE=s3): defina S3_BUCKET ou S3_BUCKET_NAME."
    );
  }
}
