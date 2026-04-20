#!/usr/bin/env node
/**
 * Envia um e-mail de teste via Resend.
 * Uso (apps/api): node scripts/send-test-email.mjs destino@email.com
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Resend } from "resend";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

const to = process.argv[2]?.trim();
if (!to || !to.includes("@")) {
  console.error("Uso: node scripts/send-test-email.mjs destino@email.com");
  process.exit(1);
}

const key = (process.env.RESEND_API_KEY ?? "").trim();
const from = (process.env.EMAIL_FROM ?? "MyMemory <onboarding@resend.dev>").trim();

if (!key) {
  console.error("RESEND_API_KEY não definida em apps/api/.env");
  process.exit(1);
}

const resend = new Resend(key);
const { data, error } = await resend.emails.send({
  from,
  to: [to],
  subject: "MyMemory — e-mail de teste",
  text: `Olá,\n\nEste é um e-mail de teste enviado em ${new Date().toISOString()}.\n\n— MyMemory`,
  html: `<p>Olá,</p><p>Este é um e-mail de teste enviado em <strong>${new Date().toISOString()}</strong>.</p><p>— MyMemory</p>`,
});

if (error) {
  console.error("Resend:", error);
  process.exit(1);
}

console.log("Enviado. id:", data?.id ?? data);
