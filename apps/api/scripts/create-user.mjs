#!/usr/bin/env node
/**
 * Cria ou atualiza um usuário com login por e-mail/senha.
 *
 * Uso (na pasta apps/api):
 *   node scripts/create-user.mjs --email=a@b.com --password=MinhaSenhaSegura8
 *   node scripts/create-user.mjs --email=a@b.com --password=x --name="João" --admin
 *
 * Opções:
 *   --email       (obrigatório)
 *   --password    (obrigatório, mín. 8 caracteres, como na API)
 *   --name        opcional (predefinição: parte local do e-mail)
 *   --admin       define role = admin
 *   --unverified  emailVerified = 0 (precisa confirmar e-mail na app)
 *   --help
 *
 * Lê MYSQL_* de apps/api/.env ou .env na raiz do monorepo (igual à API).
 */

import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

function parseArgs() {
  const argv = process.argv.slice(2);
  const o = { admin: false, unverified: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--admin") o.admin = true;
    else if (a === "--unverified") o.unverified = true;
    else if (a.startsWith("--email=")) o.email = a.slice(8);
    else if (a === "--email") o.email = argv[++i];
    else if (a.startsWith("--password=")) o.password = a.slice(11);
    else if (a === "--password") o.password = argv[++i];
    else if (a.startsWith("--name=")) o.name = a.slice(7);
    else if (a === "--name") o.name = argv[++i];
  }
  return o;
}

function printHelp() {
  console.log(`
create-user.mjs — novo usuário MyMemory (e-mail + senha)

  npm run create-user -- --email a@b.com --password MinhaSenha8
  node scripts/create-user.mjs --email=a@b.com --password=MinhaSenha8 --name "João" --admin

Variáveis: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE (apps/api/.env)
`);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const email = (args.email ?? "").trim().toLowerCase();
  const password = args.password ?? "";
  const name = (args.name ?? "").trim() || email.split("@")[0] || "Usuário";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Erro: --email inválido.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Erro: --password deve ter pelo menos 8 caracteres.");
    process.exit(1);
  }

  const host = process.env.MYSQL_HOST ?? "127.0.0.1";
  const port = Number(process.env.MYSQL_PORT ?? 3306);
  const user = process.env.MYSQL_USER ?? "mymemory";
  const pass = process.env.MYSQL_PASSWORD ?? "mymemory_secret";
  const database = process.env.MYSQL_DATABASE ?? "mymemory";

  const conn = await mysql.createConnection({ host, port, user, password: pass, database });
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const role = args.admin ? "admin" : "user";
    const emailVerified = args.unverified ? 0 : 1;

    const [existing] = await conn.query(
      "SELECT id, openId FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1",
      [email]
    );

    if (existing.length) {
      const row = existing[0];
      await conn.query(
        `UPDATE users SET
          name = ?,
          passwordHash = ?,
          loginMethod = 'password',
          emailVerified = ?,
          role = ?
        WHERE id = ?`,
        [name, passwordHash, emailVerified, role, row.id]
      );
      console.log(`Atualizado: id=${row.id} email=${email}`);
      if (args.unverified) console.log("  (e-mail não verificado — usar fluxo de confirmação na app)");
    } else {
      const openId = `pwd:${crypto.randomUUID()}`;
      const [res] = await conn.query(
        `INSERT INTO users (openId, name, email, loginMethod, emailVerified, passwordHash, role)
         VALUES (?, ?, ?, 'password', ?, ?, ?)`,
        [openId, name, email, emailVerified, passwordHash, role]
      );
      console.log(`Criado: id=${res.insertId} email=${email} openId=${openId}`);
      if (args.unverified) console.log("  (e-mail não verificado — usar fluxo de confirmação na app)");
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
