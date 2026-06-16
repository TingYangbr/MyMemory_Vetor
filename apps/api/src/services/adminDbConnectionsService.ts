import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import type { DbConnection } from "@mymemory/shared";

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function listDbConnections(options?: { groupId?: number | null }): Promise<DbConnection[]> {
  if (options && "groupId" in options) {
    const gid = options.groupId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, nome, descricao, host, port, database, username,
              encrypt, trustServerCertificate, isActive, groupId, createdAt, updatedAt
       FROM db_connections WHERE groupid = ? AND isactive = 1 ORDER BY nome ASC`,
      [gid]
    );
    return rows as DbConnection[];
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, nome, descricao, host, port, database, username,
            encrypt, trustServerCertificate, isActive, groupId, createdAt, updatedAt
     FROM db_connections ORDER BY nome ASC`
  );
  return rows as DbConnection[];
}

export async function getDbConnectionWithPassword(id: number): Promise<(DbConnection & { password: string }) | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, nome, descricao, host, port, database, username, password,
            encrypt, trustServerCertificate, isActive, createdAt, updatedAt
     FROM db_connections WHERE id = ? LIMIT 1`,
    [id]
  );
  return (rows[0] as (DbConnection & { password: string })) ?? null;
}

export async function createDbConnection(input: {
  nome: string;
  descricao?: string | null;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  encrypt: number;
  trustServerCertificate: number;
  groupId?: number | null;
}): Promise<number> {
  const [rows] = await pool.query<{ id: number }[]>(
    `INSERT INTO db_connections (nome, descricao, host, port, database, username, password, encrypt, trustservercertificate, isactive, groupid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING id`,
    [
      input.nome.trim(),
      input.descricao?.trim() ?? null,
      input.host.trim(),
      input.port,
      input.database.trim(),
      input.username.trim(),
      input.password,
      input.encrypt,
      input.trustServerCertificate,
      input.groupId ?? null,
    ]
  );
  return rows[0].id;
}

export async function updateDbConnection(
  id: number,
  patch: {
    nome?: string;
    descricao?: string | null;
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    encrypt?: number;
    trustServerCertificate?: number;
    isActive?: number;
    groupId?: number | null;
  }
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (patch.nome !== undefined)                   { sets.push("nome = ?");                   vals.push(patch.nome.trim()); }
  if (patch.descricao !== undefined)              { sets.push("descricao = ?");              vals.push(patch.descricao?.trim() ?? null); }
  if (patch.host !== undefined)                   { sets.push("host = ?");                   vals.push(patch.host.trim()); }
  if (patch.port !== undefined)                   { sets.push("port = ?");                   vals.push(patch.port); }
  if (patch.database !== undefined)               { sets.push("database = ?");               vals.push(patch.database.trim()); }
  if (patch.username !== undefined)               { sets.push("username = ?");               vals.push(patch.username.trim()); }
  if (patch.password !== undefined && patch.password !== "") { sets.push("password = ?"); vals.push(patch.password); }
  if (patch.encrypt !== undefined)                { sets.push("encrypt = ?");                vals.push(patch.encrypt); }
  if (patch.trustServerCertificate !== undefined) { sets.push("trustservercertificate = ?"); vals.push(patch.trustServerCertificate); }
  if (patch.isActive !== undefined)               { sets.push("isactive = ?");               vals.push(patch.isActive); }
  if ("groupId" in patch)                         { sets.push("groupid = ?");                vals.push(patch.groupId ?? null); }

  if (sets.length === 0) return;
  sets.push("updatedat = NOW()");
  vals.push(id);
  await pool.query(`UPDATE db_connections SET ${sets.join(", ")} WHERE id = ?`, vals);
}

export async function softDeleteDbConnection(id: number): Promise<void> {
  await updateDbConnection(id, { isActive: 0 });
}

export async function assertConnectionBelongsToGroup(connectionId: number, groupId: number): Promise<void> {
  const [rows] = await pool.query<{ id: number }[]>(
    `SELECT id FROM db_connections WHERE id = ? AND groupid = ? LIMIT 1`,
    [connectionId, groupId]
  );
  if (!rows[0]) throw Object.assign(new Error("not_found_or_forbidden"), { code: "not_found_or_forbidden" });
}

// ── Test connection (mssql) ───────────────────────────────────────────────────

export async function testDbConnection(id: number): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  const conn = await getDbConnectionWithPassword(id);
  if (!conn) return { ok: false, message: "Conexão não encontrada." };

  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mssql = require("mssql") as typeof import("mssql");

  const cfg: import("mssql").config = {
    server: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.username,
    password: conn.password,
    options: {
      encrypt: conn.encrypt === 1,
      trustServerCertificate: conn.trustServerCertificate === 1,
    },
    connectionTimeout: 10_000,
    requestTimeout: 10_000,
  };

  const start = Date.now();
  let sqlPool: import("mssql").ConnectionPool | null = null;
  try {
    sqlPool = new mssql.ConnectionPool(cfg);
    await sqlPool.connect();
    await sqlPool.request().query("SELECT 1 AS ok");
    const latencyMs = Date.now() - start;
    return { ok: true, message: "Conexão bem-sucedida.", latencyMs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Falha: ${msg}` };
  } finally {
    if (sqlPool?.connected) await sqlPool.close().catch(() => {});
  }
}

// ── Syntax check via mssql PARSEONLY ─────────────────────────────────────────

export async function syntaxCheckMssql(
  conexaoId: number,
  sentencaSql: string
): Promise<{ ok: boolean; message: string }> {
  const conn = await getDbConnectionWithPassword(conexaoId);
  if (!conn) return { ok: false, message: "Conexão não encontrada." };

  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mssql = require("mssql") as typeof import("mssql");

  // Substitui :param e @param (não @@sistema) por NULL para validação sem execução.
  // SET NOEXEC ON compila a query (detecta erros de coluna/tabela) sem executar nada.
  const sqlForCheck = sentencaSql.replace(
    /(?<!:):([a-zA-Z][a-zA-Z0-9_]*)|(?<!@)@([a-zA-Z][a-zA-Z0-9_]*)/g,
    "NULL"
  );
  const sqlWithNoexec = `SET NOEXEC ON\n${sqlForCheck}\nSET NOEXEC OFF`;

  const cfg: import("mssql").config = {
    server: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.username,
    password: conn.password,
    options: {
      encrypt: conn.encrypt === 1,
      trustServerCertificate: conn.trustServerCertificate === 1,
    },
    connectionTimeout: 10_000,
    requestTimeout: 10_000,
  };

  let sqlPool: import("mssql").ConnectionPool | null = null;
  try {
    sqlPool = new mssql.ConnectionPool(cfg);
    await sqlPool.connect();
    await sqlPool.request().query(sqlWithNoexec);
    return { ok: true, message: "Sintaxe válida." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  } finally {
    if (sqlPool?.connected) await sqlPool.close().catch(() => {});
  }
}

// ── Execute query via mssql ───────────────────────────────────────────────────

/**
 * Converte `:paramName` → `@paramName` no SQL e coleta os valores.
 * Aplica o mesmo processamento de valores do PostgreSQL:
 *   - LIKE/NOT LIKE → adiciona %valor% automaticamente (e strip diacríticos)
 *   - IN/NOT IN com valor lista → expande `@param` em `@param_l0, @param_l1, ...`
 *   - Outros operadores → passa o valor cru
 * Parâmetros com valor null são passados como null (IS NULL check fica no template T-SQL).
 */
export function bindParamsMssql(
  sentencaSql: string,
  paramValues: Record<string, unknown>,
  paramDefs?: { nome: string; operadorSql: string }[],
  /** Operadores sugeridos pelo LLM por param (lowercase). "=" suprime o wrap com % do LIKE. */
  operadorOverrides?: Record<string, string>
): { sql: string; params: { name: string; value: unknown }[] } {
  const defByName = new Map((paramDefs ?? []).map((p) => [p.nome.toLowerCase(), p]));
  const params: { name: string; value: unknown }[] = [];
  const seen = new Set<string>();
  let listCounter = 0;

  // Pré-varre o SQL para detectar params que aparecem em contexto LIKE/NOT LIKE no template.
  // Necessário porque operadorSql pode ser "=" mesmo quando o template usa LIKE (configuração inconsistente).
  const likeContextParams = new Set<string>();
  const preScanRe = /\bNOT\s+LIKE\s+[@:]([a-zA-Z][a-zA-Z0-9_]*)|\bLIKE\s+[@:]([a-zA-Z][a-zA-Z0-9_]*)/gi;
  let psm: RegExpExecArray | null;
  while ((psm = preScanRe.exec(sentencaSql)) !== null) {
    likeContextParams.add((psm[1] ?? psm[2]).toLowerCase());
  }

  function detectInContextAt(sql: string, atIndex: number): "in" | "notin" | null {
    const before = sql.slice(0, atIndex);
    const reIn = /(?:\bNOT\s+IN|\bIN)\s*\(\s*$/i;
    const m = reIn.exec(before);
    if (!m) return null;
    return /\bNOT\s+IN/i.test(m[0]) ? "notin" : "in";
  }

  let result = "";
  let pos = 0;
  // Aceita tanto :param (convenção interna) quanto @param (T-SQL nativo).
  // (?<!@)@ exclui variáveis de sistema @@ROWCOUNT etc.
  const re = /(?<!:):([a-zA-Z][a-zA-Z0-9_]*)|(?<!@)@([a-zA-Z][a-zA-Z0-9_]*)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(sentencaSql)) !== null) {
    const key = (match[1] ?? match[2]).toLowerCase();
    result += sentencaSql.slice(pos, match.index);

    let val = Object.prototype.hasOwnProperty.call(paramValues, key) ? paramValues[key] : null;
    if (val === "") val = null;
    const def = defByName.get(key);
    const llmOpOverride = operadorOverrides?.[key];

    // isLikeContext: true se operadorSql é LIKE OU se o template usa LIKE/NOT LIKE para este param.
    const isLikeContext = /LIKE/i.test(def?.operadorSql ?? "") || likeContextParams.has(key);

    const ctx = detectInContextAt(sentencaSql, match.index);
    if (ctx) {
      // Token dentro de IN (...) ou NOT IN (...): expande lista para múltiplos placeholders
      if (val === null || val === undefined || (Array.isArray(val) && val.length === 0)) {
        result += "NULL";
      } else {
        const list = Array.isArray(val) ? val : [val];
        const placeholders: string[] = [];
        for (const item of list) {
          const phName = `${key}_l${listCounter++}`;
          params.push({ name: phName, value: item });
          placeholders.push(`@${phName}`);
        }
        result += placeholders.join(", ");
      }
    } else {
      // Padrão para LIKE params: match exato usando RTRIM(col) = @param.
      // RTRIM remove espaços finais de colunas CHAR(n) antes de comparar,
      // pois mssql envia parâmetros como NVarChar e CHAR = NVarChar não faz padding automático.
      // Só mantém LIKE com % quando LLM envia explicitamente operador_sugerido: "LIKE" (busca parcial).
      if (isLikeContext && llmOpOverride !== "LIKE") {
        if (/\bNOT\s+LIKE\s*$/i.test(result)) {
          result = result.replace(/(\S+)\s+NOT\s+LIKE\s*$/i, "RTRIM($1) <> ");
        } else if (/\bLIKE\s*$/i.test(result)) {
          result = result.replace(/(\S+)\s+LIKE\s*$/i, "RTRIM($1) = ");
        }
      }

      // Token fora de contexto IN. Se valor é array (primeira ocorrência no IS NULL check),
      // usa o primeiro elemento como representante.
      if (Array.isArray(val)) val = val.length > 0 ? val[0] : null;

      if (!seen.has(key)) {
        seen.add(key);
        if (val !== null && val !== undefined && isLikeContext) {
          const strVal = String(val).normalize("NFD").replace(/\p{Mn}/gu, "");
          if (llmOpOverride === "LIKE") {
            val = strVal.includes("%") ? strVal : `%${strVal}%`;
          } else {
            val = strVal; // match exato — operador já foi reescrito para RTRIM(col) =
          }
        }
        params.push({ name: key, value: val ?? null });
      }
      result += `@${key}`;
    }
    pos = match.index + match[0].length;
  }
  result += sentencaSql.slice(pos);

  return { sql: result, params };
}

export async function executeQueryMssql(
  conexaoId: number,
  sentencaSql: string,
  paramValues: Record<string, unknown>,
  paramDefs?: { nome: string; operadorSql: string }[],
  operadorOverrides?: Record<string, string>
): Promise<{ colunas: string[]; linhas: Record<string, unknown>[] }> {
  const conn = await getDbConnectionWithPassword(conexaoId);
  if (!conn) throw new Error("db_connection_not_found");

  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mssql = require("mssql") as typeof import("mssql");

  const cfg: import("mssql").config = {
    server: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.username,
    password: conn.password,
    options: {
      encrypt: conn.encrypt === 1,
      trustServerCertificate: conn.trustServerCertificate === 1,
    },
    connectionTimeout: 30_000,
    requestTimeout: 60_000,
  };

  const { sql, params } = bindParamsMssql(sentencaSql, paramValues, paramDefs, operadorOverrides);

  let sqlPool: import("mssql").ConnectionPool | null = null;
  try {
    sqlPool = new mssql.ConnectionPool(cfg);
    await sqlPool.connect();
    const request = sqlPool.request();
    for (const p of params) {
      request.input(p.name, p.value ?? null);
    }
    const result = await request.query(sql);
    const linhas = (result.recordset ?? []) as Record<string, unknown>[];
    const colunas = linhas.length > 0 ? Object.keys(linhas[0]) : [];
    return { colunas, linhas };
  } catch (err) {
    console.error("[executeQueryMssql] SQL error:", err instanceof Error ? err.message : String(err));
    console.error("[executeQueryMssql] SQL sent:\n", sql);
    console.error("[executeQueryMssql] Params:", JSON.stringify(params, null, 2));
    throw err;
  } finally {
    if (sqlPool?.connected) await sqlPool.close().catch(() => {});
  }
}
