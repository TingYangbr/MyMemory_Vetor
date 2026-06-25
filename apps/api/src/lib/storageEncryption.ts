import crypto from "node:crypto";

const ALGORITHM = "aes-256-cbc";
const IV_LEN = 16;
const PREFIX = "enc:";

function deriveKey(): Buffer | null {
  const raw = (process.env.STORAGE_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptCredential(plaintext: string): string {
  const key = deriveKey();
  if (!key) return plaintext;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptCredential(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = deriveKey();
  if (!key) return stored;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 2) return stored;
  try {
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = Buffer.from(parts[1], "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return stored;
  }
}
