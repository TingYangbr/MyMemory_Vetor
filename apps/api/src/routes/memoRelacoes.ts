import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import { criarRelacao, desfazerRelacao, listarRelacoes, sugerirRelacao } from "../services/memoRelacaoService.js";

/** Relações entre memos ("a ata é resultado da reunião"). */
function erro(reply: FastifyReply, e: unknown) {
  const msg = e instanceof Error ? e.message : "";
  if (msg === "not_found") return reply.code(404).send({ error: msg, message: "Memo não encontrado." });
  if (msg === "forbidden" || msg === "forbidden_group") return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este memo." });
  if (msg === "mesmo_memo") return reply.code(400).send({ error: msg, message: "Um memo não pode ser ligado a ele mesmo." });
  if (msg === "grupos_diferentes")
    return reply.code(400).send({ error: msg, message: "Só dá para ligar memos do mesmo grupo." });
  throw e;
}

const plugin: FastifyPluginAsync = async (app) => {
  const idParam = z.coerce.number().int().positive();

  app.get("/api/memos/:memoId/relacoes", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const mid = idParam.safeParse((req.params as { memoId: string }).memoId);
    if (!mid.success) return reply.code(400).send({ error: "invalid_id" });
    try {
      return { relacoes: await listarRelacoes(userId, await getUserIsAdmin(userId), mid.data) };
    } catch (e) {
      return erro(reply, e);
    }
  });

  // Este memo (origem) "é <tipo> de" destinoId; concluirDestino marca o destino como Concluído
  app.post("/api/memos/:memoId/relacoes", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const mid = idParam.safeParse((req.params as { memoId: string }).memoId);
    const body = z
      .object({ destinoId: z.number().int().positive(), tipo: z.string().max(40).optional(), concluirDestino: z.boolean().optional() })
      .safeParse(req.body);
    if (!mid.success || !body.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      return await criarRelacao({
        userId,
        isAdmin: await getUserIsAdmin(userId),
        origemId: mid.data,
        destinoId: body.data.destinoId,
        tipo: body.data.tipo ?? "resultado",
        concluirDestino: body.data.concluirDestino,
      });
    } catch (e) {
      return erro(reply, e);
    }
  });

  // Logo depois de salvar um memo: a IA sugere o compromisso de que ele parece ser o resultado
  app.post("/api/memos/:memoId/sugerir-relacao", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const mid = idParam.safeParse((req.params as { memoId: string }).memoId);
    if (!mid.success) return reply.code(400).send({ error: "invalid_id" });
    try {
      const r = await sugerirRelacao(userId, await getUserIsAdmin(userId), mid.data);
      return { sugestao: r.sugestao };
    } catch (e) {
      return erro(reply, e);
    }
  });

  app.delete("/api/memos/relacoes/:relacaoId", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const rid = idParam.safeParse((req.params as { relacaoId: string }).relacaoId);
    if (!rid.success) return reply.code(400).send({ error: "invalid_id" });
    try {
      await desfazerRelacao(userId, await getUserIsAdmin(userId), rid.data);
      return { ok: true };
    } catch (e) {
      return erro(reply, e);
    }
  });
};

export default plugin;
