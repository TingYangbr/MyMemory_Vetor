import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { requireAdmin } from "../lib/adminContext.js";
import { cargaEmAndamento, iniciarCargaAnos, situacaoHistorico } from "../services/finPrecoHistoricoService.js";

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

/** Filtro de grupo da tela: id do grupo, ou "pessoal" (groupid vazio = espaço pessoal). Vazio/"todos" = sem filtro. */
function filtroGrupo(v: string | undefined): { sql: string; params: unknown[] } | null {
  if (!v || v === "todos") return null;
  if (v === "pessoal") return { sql: `groupid IS NULL`, params: [] };
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? { sql: `groupid = ?`, params: [n] } : null;
}

async function tabelasPublicas(): Promise<
  { nome: string; tipo: "tabela" | "view"; linhas: number | null; bytes: number | null; temGrupo: boolean }[]
> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT t.table_name AS "nome", t.table_type AS "tipo", c.reltuples::bigint AS "linhas",
       CASE WHEN t.table_type = 'BASE TABLE' THEN pg_total_relation_size(c.oid) END AS "bytes",
       EXISTS (SELECT 1 FROM information_schema.columns k
               WHERE k.table_schema = 'public' AND k.table_name = t.table_name AND k.column_name = 'groupid') AS "temGrupo"
     FROM information_schema.tables t
     LEFT JOIN pg_namespace n ON n.nspname = 'public'
     LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = t.table_name
     WHERE t.table_schema = 'public' AND t.table_type IN ('BASE TABLE', 'VIEW')
     ORDER BY t.table_name`
  );
  return rows.map((r) => ({
    nome: String(r.nome),
    tipo: r.tipo === "VIEW" ? ("view" as const) : ("tabela" as const),
    linhas: r.linhas == null || Number(r.linhas) < 0 ? null : Number(r.linhas),
    bytes: r.bytes == null ? null : Number(r.bytes),
    temGrupo: r.temGrupo === true || r.temGrupo === "t",
  }));
}

/** Tamanho do banco inteiro (dados, índices, TOAST) e quando foi medido. */
async function tamanhoBanco(): Promise<{ bytes: number; medidoEm: string }> {
  const [r] = await pool.query<RowDataPacket[]>(`SELECT pg_database_size(current_database()) AS "b"`);
  return { bytes: Number(r[0]?.b ?? 0), medidoEm: new Date().toISOString() };
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
  /** Histórico de preços (B3): situação e carga de anos inteiros (em segundo plano). */
  app.get("/api/admin/precos", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    return { ...(await situacaoHistorico()), carga: cargaEmAndamento() };
  });

  app.post("/api/admin/precos/carregar", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const b = z.object({ anos: z.array(z.number().int().min(1990).max(2100)).min(1).max(30) }).parse(req.body);
    try {
      iniciarCargaAnos(b.anos);
    } catch (e) {
      return reply.code(409).send({ error: "em_andamento", message: e instanceof Error ? e.message : String(e) });
    }
    return { ok: true, carga: cargaEmAndamento() };
  });

  /**
   * Lista + tamanho do banco + grupos. Com ?grupo=<id>|pessoal, cada tabela com coluna groupid traz também quantas
   * linhas são daquele grupo (ou do espaço pessoal, groupid vazio). Tabela sem groupid é compartilhada (*).
   */
  app.get("/api/admin/tabelas", async (req, reply) => {
    const adminId = await requireAdmin(req, reply);
    if (adminId == null) return;
    const grupo = filtroGrupo((req.query as { grupo?: string }).grupo);
    const [tabelas, banco, [gs], [me]] = await Promise.all([
      tabelasPublicas(),
      tamanhoBanco(),
      pool.query<RowDataPacket[]>(`SELECT id, name FROM groups ORDER BY name`),
      pool.query<RowDataPacket[]>(`SELECT lastworkspacegroupid AS "g" FROM users WHERE id = ?`, [adminId]),
    ]);
    if (grupo) {
      for (const t of tabelas) {
        if (!t.temGrupo || t.tipo !== "tabela") continue;
        const [c] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*)::bigint AS "n" FROM ${q(t.nome)} WHERE ${grupo.sql}`, grupo.params);
        (t as typeof t & { linhasGrupo?: number }).linhasGrupo = Number(c[0]?.n ?? 0);
      }
    }
    return {
      tabelas,
      banco,
      grupos: gs.map((g) => ({ id: Number(g.id), nome: String(g.name) })),
      grupoAtivo: me[0]?.g == null ? null : Number(me[0].g),
    };
  });

  /**
   * Armazenagem por grupo (estimativa): em cada tabela com groupid, o tamanho dela é repartido pela proporção de linhas
   * de cada grupo; groupid vazio = espaço pessoal. Tabelas sem groupid somam em "compartilhado".
   */
  app.get("/api/admin/tabelas-grupos", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const tabelas = (await tabelasPublicas()).filter((t) => t.tipo === "tabela");
    const porGrupo = new Map<string, { linhas: number; bytes: number }>();
    let compartilhado = 0;
    for (const t of tabelas) {
      const bytes = t.bytes ?? 0;
      if (!t.temGrupo) {
        compartilhado += bytes;
        continue;
      }
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT groupid AS "g", COUNT(*)::bigint AS "n" FROM ${q(t.nome)} GROUP BY groupid`);
      const total = rows.reduce((s, r) => s + Number(r.n), 0);
      for (const r of rows) {
        const k = r.g == null ? "pessoal" : String(r.g);
        const atual = porGrupo.get(k) ?? { linhas: 0, bytes: 0 };
        atual.linhas += Number(r.n);
        atual.bytes += total ? (bytes * Number(r.n)) / total : 0;
        porGrupo.set(k, atual);
      }
      if (!rows.length) compartilhado += bytes;
    }
    const [gs] = await pool.query<RowDataPacket[]>(`SELECT id, name FROM groups`);
    const nomes = new Map(gs.map((g) => [String(g.id), String(g.name)]));
    const banco = await tamanhoBanco();
    return {
      banco,
      compartilhadoBytes: compartilhado,
      grupos: [...porGrupo.entries()]
        .map(([k, v]) => ({
          grupo: k === "pessoal" ? "Espaços pessoais (sem grupo)" : nomes.get(k) ?? `Grupo ${k}`,
          groupId: k === "pessoal" ? null : Number(k),
          linhas: v.linhas,
          bytes: Math.round(v.bytes),
        }))
        .sort((a, b) => b.bytes - a.bytes),
    };
  });

  app.get("/api/admin/tabelas/:nome", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const nome = String((req.params as { nome: string }).nome);
    const qs = z
      .object({
        offset: z.coerce.number().int().min(0).default(0),
        limite: z.coerce.number().int().min(1).max(1000).default(1000),
        ordem: z.enum(["ultima", "natural"]).default("ultima"),
        grupo: z.string().max(20).optional(),
      })
      .parse(req.query);
    const grupoF = filtroGrupo(qs.grupo);
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

    // Filtro de grupo: só em tabela/view com coluna groupid (as compartilhadas vêm inteiras)
    const onde = grupoF && tabela.temGrupo ? ` WHERE ${grupoF.sql}` : "";
    const pg = grupoF && tabela.temGrupo ? grupoF.params : [];
    const [[cnt], [rows]] = await Promise.all([
      pool.query<RowDataPacket[]>(`SELECT COUNT(*)::bigint AS "n" FROM ${q(nome)}${onde}`, pg),
      pool.query<RowDataPacket[]>(`SELECT *${extra} FROM ${q(nome)}${onde}${ordem} LIMIT ${qs.limite} OFFSET ${qs.offset}`, pg),
    ]);
    const tipos = new Map(colunas.map((c) => [c.nome, c.tipo]));
    const colunasSaida = [...(extra ? [{ nome: "_gravado_em", tipo: "timestamp" }] : []), ...colunas];
    return {
      tabela: nome,
      tipo: tabela.tipo,
      compartilhada: !tabela.temGrupo,
      filtradaPorGrupo: !!onde,
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
