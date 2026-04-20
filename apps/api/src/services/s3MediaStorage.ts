import { config } from "../config.js";

type S3Mod = typeof import("@aws-sdk/client-s3");

let s3Client: InstanceType<S3Mod["S3Client"]> | null = null;

/** URL pública do objeto (S3_PUBLIC_URL / S3_PUBLIC_BASE_URL ou host virtual AWS). */
function publicUrlForKey(key: string): string {
  const base = config.s3.publicBaseUrl.replace(/\/$/, "");
  const encodedKey = key.split("/").map((p) => encodeURIComponent(p)).join("/");
  if (base) return `${base}/${encodedKey}`;
  const { bucket, region } = config.s3;
  const host =
    region === "us-east-1" ? `${bucket}.s3.amazonaws.com` : `${bucket}.s3.${region}.amazonaws.com`;
  return `https://${host}/${encodedKey}`;
}

function buildS3Client(aws: S3Mod): InstanceType<S3Mod["S3Client"]> {
  const region = config.s3.region;
  const hasStaticCreds = Boolean(config.s3.accessKeyId && config.s3.secretAccessKey);

  if (config.s3.endpoint) {
    return new aws.S3Client({
      region,
      endpoint: config.s3.endpoint,
      forcePathStyle: true,
      ...(hasStaticCreds
        ? {
            credentials: {
              accessKeyId: config.s3.accessKeyId,
              secretAccessKey: config.s3.secretAccessKey,
            },
          }
        : {}),
    });
  }

  // AWS padrão: com chaves no .env o SDK usa-as; sem chaves, usa cadeia padrão (~/.aws, IAM role, etc.)
  return new aws.S3Client({
    region,
    ...(hasStaticCreds
      ? {
          credentials: {
            accessKeyId: config.s3.accessKeyId,
            secretAccessKey: config.s3.secretAccessKey,
          },
        }
      : {}),
  });
}

/** Upload para o bucket configurado; grava em `memos/{userId}/{storedName}`. */
export async function uploadMemoFileToS3(input: {
  userId: number;
  buffer: Buffer;
  contentType: string;
  storedName: string;
}): Promise<string> {
  const aws = (await import("@aws-sdk/client-s3")) as S3Mod;
  if (!s3Client) {
    s3Client = buildS3Client(aws);
  }
  const key = `memos/${input.userId}/${input.storedName}`;
  await s3Client.send(
    new aws.PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: input.buffer,
      ContentType: input.contentType || "application/octet-stream",
    })
  );
  return publicUrlForKey(key);
}

/**
 * Tenta obter a chave S3 `memos/{userId}/{nome}` a partir da URL pública gravada no memo.
 * Suporta path direto `/memos/...` ou path-style com prefixo de bucket.
 */
export function tryExtractMemoS3KeyFromPublicUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const decoded = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (/^memos\/\d+\//.test(decoded)) return decoded;
    const parts = decoded.split("/").filter(Boolean);
    const i = parts.indexOf("memos");
    if (i >= 0 && parts[i + 1] && /^\d+$/.test(parts[i + 1])) {
      return parts.slice(i).join("/");
    }
    return null;
  } catch {
    return null;
  }
}

/** Leitura com credenciais da API (bucket privado). */
export async function downloadMemoObjectFromS3(key: string): Promise<Buffer> {
  if (!config.s3.bucket.trim()) {
    throw new Error("s3_not_configured");
  }
  const aws = (await import("@aws-sdk/client-s3")) as S3Mod;
  if (!s3Client) {
    s3Client = buildS3Client(aws);
  }
  const out = await s3Client.send(
    new aws.GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    })
  );
  const body = out.Body;
  if (!body) {
    throw new Error("s3_empty_body");
  }
  const bytes = await body.transformToByteArray();
  return Buffer.from(bytes);
}

/** Remove objeto do bucket (hard delete). Ignora objeto inexistente. */
export async function deleteMemoObjectFromS3(key: string): Promise<void> {
  if (!config.s3.bucket.trim()) return;
  const k = key.trim();
  if (!k || k.length > 1024) return;
  const aws = (await import("@aws-sdk/client-s3")) as S3Mod;
  if (!s3Client) {
    s3Client = buildS3Client(aws);
  }
  try {
    await s3Client.send(
      new aws.DeleteObjectCommand({
        Bucket: config.s3.bucket,
        Key: k,
      })
    );
  } catch {
    /* NoSuchKey / rede — não bloquear purge em massa */
  }
}
