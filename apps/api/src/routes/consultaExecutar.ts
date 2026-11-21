import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import { assertUserCanAccessGroup, loadMemoContextStructure } from "../services/memoContextService.js";
import { buildQueriesDisponiveis } from "../services/perguntaService.js";
import { executarConsultaDireta } from "../services/perguntaPipe2.js";

/**
 * Aba Consultas da categoria → ▶ Executar: roda UMA consulta com os filtros digitados, sem IA, e devolve a
 * tabela como a IA a receberia. Só o dono do grupo (ou admin), no espaço do grupo.
 */
const plugin: FastifyPluginAsync = async (app) => {
  app.post("/api/consultas-categoria/:queryId/executar", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const qid = z.coerce.number().int().positive().safeParse((req.params as { queryId: string }).queryId);
    const body = z
      .object({ groupId: z.number().int().positive(), valores: z.record(z.string().max(500)).default({}) })
      .safeParse(req.body);
    if (!qid.success || !body.success) return reply.code(400).send({ error: "invalid_body" });
    const { groupId, valores } = body.data;
    const isAdmin = await getUserIsAdmin(userId);
    try {
      await assertUserCanAccessGroup(userId, groupId, isAdmin);
    } catch {
      return reply.code(403).send({ error: "forbidden", message: "Só o dono do grupo executa consultas por aqui." });
    }
    const structure = await loadMemoContextStructure(userId, groupId, null);
    const cat = structure.categories.find((c) => c.isActive === 1 && (c.queries ?? []).some((q) => q.id === qid.data));
    if (!cat) return reply.code(404).send({ error: "not_found", message: "Consulta não encontrada neste grupo." });
    const template = buildQueriesDisponiveis(structure.categories, [cat.name]).find((q) => q.query_id === String(qid.data));
    if (!template) return reply.code(404).send({ error: "not_found", message: "Consulta inativa." });
    if (template.conexaoPendente) {
      return reply.code(400).send({ error: "invalid", message: "A consulta é de ERP e o grupo ainda não tem a ligação com o ERP." });
    }
    try {
      const r = await executarConsultaDireta({ template, valores, userId, groupId });
      return { ok: true, ...r, params: template.params.map((p) => ({ nome: p.nome, tipo: p.tipo })) };
    } catch (e) {
      return reply.code(400).send({ error: "sql", message: e instanceof Error ? e.message : String(e) });
    }
  });
};

export default plugin;
