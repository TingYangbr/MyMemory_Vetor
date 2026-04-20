import crypto from "node:crypto";

export function newOpaqueToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  return { raw, hash };
}

export function hashOpaqueToken(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}
