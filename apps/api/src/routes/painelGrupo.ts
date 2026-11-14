import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { PainelGrupoBuscaResponse, PainelGrupoContagensResponse } from "@mymemory/shared";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { assertUserCanAccessGroup } from "../services/memoContextService.js";

/**
 * Rotas de apoio do novo painel do grupo (/grupo/:id/admin). Só leitura e só acrescentam:
 * o painel antigo continua usando as rotas de sempre.
 */

const buscaQuery = z.object({
  q: z.string().trim().max(120).optional(),
  limite: z.coerce.number().int().min(1).max(50).optional(),
});

const groupIdParam = z.coerce.number().int().positive();

/** Dono do grupo = dono da assinatura do grupo ou membro com papel owner (mesma regra do resto do sistema). */
const DONO_SQL = `(
  EXISTS (SELECT 1 FROM subscriptions s WHERE s.id = g.subscriptionid AND s.ownerid = ? AND s.type = 'group' AND s.status = 'active')
  OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.groupid = g.id AND gm.userid = ? AND gm.role = 'owner')
)`;

const plugin: FastifyPluginAsync = async (app) => {
  /**
   * Busca de grupos para a caixinha "Grupo" do painel.
   * Admin: todos os grupos (por nome, nome/e-mail do dono ou número). Dono: só os grupos dele.
   */
  app.get("/api/painel-grupo/grupos", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    const parsed = buscaQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query", message: "Busca inválida." });
    const isAdmin = await getUserIsAdmin(userId);
    const q = parsed.data.q ?? "";
    const limite = parsed.data.limite ?? 20;

    const where: string[] = [];
    const vals: unknown[] = [];
    if (!isAdmin) {
      where.push(DONO_SQL);
      vals.push(userId, userId);
    }
    if (q) {
      const numero = /^#?(\d+)$/.exec(q);
      const like = `%${q}%`;
      if (numero) {
        where.push("(g.id = ? OR g.name ILIKE ?)");
        vals.push(Number(numero[1]), like);
      } else {
        where.push("(g.name ILIKE ? OR u.name ILIKE ? OR u.email ILIKE ?)");
        vals.push(like, like, like);
      }
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [totRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*)::int AS total
         FROM groups g
         LEFT JOIN subscriptions s ON s.id = g.subscriptionid
         LEFT JOIN users u ON u.id = s.ownerid
       ${whereSql}`,
      vals
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT g.id, g.name,
              u.name AS "donoNome", u.email AS "donoEmail",
              (SELECT COUNT(*)::int FROM group_members gm WHERE gm.groupid = g.id) AS membros,
              ${DONO_SQL} AS "souDono"
         FROM groups g
         LEFT JOIN subscriptions s ON s.id = g.subscriptionid
         LEFT JOIN users u ON u.id = s.ownerid
       ${whereSql}
       ORDER BY g.name ASC, g.id ASC
       LIMIT ?`,
      [userId, userId, ...vals, limite]
    );

    const body: PainelGrupoBuscaResponse = {
      isAdmin,
      total: Number(totRows[0]?.total ?? 0),
      grupos: rows.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        donoNome: (r.donoNome as string | null) ?? null,
        donoEmail: (r.donoEmail as string | null) ?? null,
        membros: Number(r.membros ?? 0),
        souDono: r.souDono === true || r.souDono === 1,
      })),
    };
    return body;
  });

  /** Quantos memos ativos o grupo tem em cada categoria e quantos estão sem categoria. */
  app.get("/api/painel-grupo/:groupId/contagens", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    const gid = groupIdParam.safeParse((req.params as { groupId: string }).groupId);
    if (!gid.success) return reply.code(400).send({ error: "invalid_group", message: "Grupo inválido." });
    const isAdmin = await getUserIsAdmin(userId);
    try {
      await assertUserCanAccessGroup(userId, gid.data, isAdmin);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "group_not_found") return reply.code(404).send({ error: "not_found", message: "Grupo não encontrado." });
      return reply.code(403).send({ error: "forbidden", message: "Sem permissão para este grupo." });
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(TRIM(m.category), ''), '') AS categoria, COUNT(*)::int AS total
         FROM memos m
        WHERE m.groupid = ? AND m.isactive = 1
        GROUP BY 1`,
      [gid.data]
    );
    const porCategoria: Record<string, number> = {};
    let semCategoria = 0;
    for (const r of rows) {
      const nome = String(r.categoria ?? "");
      const total = Number(r.total ?? 0);
      if (nome) porCategoria[nome] = total;
      else semCategoria = total;
    }
    const body: PainelGrupoContagensResponse = { porCategoria, semCategoria };
    return body;
  });
};

export default plugin;
