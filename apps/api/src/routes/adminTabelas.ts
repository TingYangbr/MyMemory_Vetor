import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { requireAdmin } from "../lib/adminContext.js";

/**
 * Suporte (Admin → Sistema → Tabelas do banco): ver o conteúdo das tabelas do Postgres, só leitura.
 * A tabela é conferida na lista real do schema public (nunca SQL montado com texto livre). Colunas sensíveis (senha,
 * hash, token, chave de API) saem mascaradas; textos longos e vetores saem resumidos. Lotes de até 1000 linhas.
 * "Última modificação": a coluna de atualização da tabela (updatedat, atualizado_em…, ou a de criação); sem ela, a
 * ordem interna de gravação do Postgres (xmin) — aproximada: o que foi gravado ou alterado por último vem antes.
 */

const SENSIVEL = /(pass|senha|hash|token|secret|segredo|api_?key|apikey|chave_api|salt|private|privada)/i;
const COLUNAS_MOD = ["updatedat", "updated_at", "atualizado_em", "atualizadoem", "modificado_em", "alterado_em", "lastmodified"];
const COLUNAS_CRIA = ["createdat", "created_at", "criado_em", "criadoem", "enviadoem", "data_criacao"];
const MAX_TEXTO = 2000;

const q = (nome: string) => `"${nome.replace(/"/g, '""')}"`;

async function tabelasPublicas(): Promise<{ nome: string; tipo: "tabela" | "view"; linhas: number | null }[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT t.table_name AS "nome", t.table_type AS "tipo",
       (SELECT c.reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = t.table_name) AS "linhas"
     FROM information_schema.tables t
     WHERE t.table_schema = 'public' AND t.table_type IN ('BASE TABLE', 'VIEW')
     ORDER BY t.table_name`
  );
  return rows.map((r) => ({
    nome: String(r.nome),
    tipo: r.tipo === "VIEW" ? ("view" as const) : ("tabela" as const),
    linhas: r.linhas == null || Number(r.linhas) < 0 ? null : Number(r.linhas),
  }));
}

/** Valor para a tela: data em ISO, JSON em texto, binário/vetor resumido, texto longo cortado, sensível mascarado. */
function valorTela(v: unknown, coluna: string, tipo: string): unknown {
  if (v == null) return null;
  if (SENSIVEL.test(coluna)) return "••••••";
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return `[binário, ${v.length} bytes]`;
  if (tipo === "USER-DEFINED" || /vector/i.test(tipo)) {
    const s = String(v);
    return `[vetor, ${s.split(",").length} dimensões]`;
  }
  if (typeof v === "object") v = JSON.stringify(v);
  if (typeof v === "string" && v.length > MAX_TEXTO) return `${v.slice(0, MAX_TEXTO)}… (${v.length} caracteres)`;
  return v;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/tabelas", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    return { tabelas: await tabelasPublicas() };
  });

  app.get("/api/admin/tabelas/:nome", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const nome = String((req.params as { nome: string }).nome);
    const qs = z
      .object({
        offset: z.coerce.number().int().min(0).default(0),
        limite: z.coerce.number().int().min(1).max(1000).default(1000),
        ordem: z.enum(["ultima", "natural"]).default("ultima"),
      })
      .parse(req.query);
    const tabela = (await tabelasPublicas()).find((t) => t.nome === nome);
    if (!tabela) return reply.code(404).send({ error: "not_found", message: "Tabela não encontrada no schema public." });

    const [cols] = await pool.query<RowDataPacket[]>(
      `SELECT column_name AS "nome", data_type AS "tipo", udt_name AS "udt"
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position`,
      [nome]
    );
    const colunas = cols.map((c) => ({ nome: String(c.nome), tipo: String(c.tipo === "USER-DEFINED" ? c.udt : c.tipo) }));
    const nomesLower = new Map(colunas.map((c) => [c.nome.toLowerCase(), c.nome]));
    const colMod = COLUNAS_MOD.map((c) => nomesLower.get(c)).find(Boolean) ?? null;
    const colCria = COLUNAS_CRIA.map((c) => nomesLower.get(c)).find(Boolean) ?? null;
    const ehTabela = tabela.tipo === "tabela";

    // Data de gravação pelo Postgres, só se o servidor registra (track_commit_timestamp)
    let comTimestamp = false;
    if (ehTabela) {
      const [s] = await pool.query<RowDataPacket[]>(`SELECT current_setting('track_commit_timestamp', true) AS "v"`);
      comTimestamp = String(s[0]?.v ?? "") === "on";
    }

    let ordem = "";
    let criterio: string;
    if (qs.ordem === "ultima" && (colMod || colCria)) {
      const c = colMod ?? colCria!;
      ordem = ` ORDER BY ${q(c)} DESC NULLS LAST${ehTabela ? ", xmin::text::bigint DESC" : ""}`;
      criterio = colMod ? `coluna ${c} (última atualização)` : `coluna ${c} (criação — a tabela não tem coluna de atualização)`;
    } else if (qs.ordem === "ultima" && ehTabela) {
      ordem = ` ORDER BY xmin::text::bigint DESC`;
      criterio = "ordem interna de gravação do Postgres (aproximada: a tabela não tem coluna de data)";
    } else {
      criterio = qs.ordem === "ultima" ? "ordem natural (view sem coluna de data)" : "ordem natural";
    }
    const extra = ehTabela && comTimestamp ? `, pg_xact_commit_timestamp(xmin) AS "_gravado_em"` : "";

    const [[cnt], [rows]] = await Promise.all([
      pool.query<RowDataPacket[]>(`SELECT COUNT(*)::bigint AS "n" FROM ${q(nome)}`),
      pool.query<RowDataPacket[]>(`SELECT *${extra} FROM ${q(nome)}${ordem} LIMIT ${qs.limite} OFFSET ${qs.offset}`),
    ]);
    const tipos = new Map(colunas.map((c) => [c.nome, c.tipo]));
    const colunasSaida = [...(extra ? [{ nome: "_gravado_em", tipo: "timestamp" }] : []), ...colunas];
    return {
      tabela: nome,
      tipo: tabela.tipo,
      total: Number(cnt[0]?.n ?? 0),
      offset: qs.offset,
      limite: qs.limite,
      criterio,
      colunas: colunasSaida.map((c) => ({ ...c, mascarada: SENSIVEL.test(c.nome) })),
      linhas: rows.map((r) => {
        const o: Record<string, unknown> = {};
        for (const c of colunasSaida) o[c.nome] = valorTela(r[c.nome], c.nome, tipos.get(c.nome) ?? "");
        return o;
      }),
    };
  });
};

export default plugin;
