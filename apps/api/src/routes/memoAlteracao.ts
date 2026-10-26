import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { SITUACOES_MEMO } from "@mymemory/shared";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import {
  alterarMemo,
  desfazerAlteracao,
  filtrarMemosAlteraveis,
  obterMemoAlteravel,
} from "../services/memoAlteracaoService.js";

/** Alteração de memos de categoria atualizável a partir da resposta do Perguntar. */
const plugin: FastifyPluginAsync = async (app) => {
  const idParam = z.coerce.number().int().positive();

  const erro = (reply: FastifyReply, e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not_found") return reply.code(404).send({ error: msg, message: "Memo não encontrado." });
    if (msg === "nao_atualizavel") {
      return reply.code(400).send({ error: msg, message: "A categoria deste memo não é atualizável." });
    }
    if (msg === "forbidden") {
      return reply.code(403).send({ error: msg, message: "Só o dono, quem catalogou ou owner/editor do grupo podem alterar." });
    }
    throw e;
  };

  // Quais memos da resposta ganham o ✎ (atualizáveis e com permissão)
  app.post("/api/memos/alteraveis", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const body = z.object({ ids: z.array(z.number().int().positive()).max(500) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    return { ids: await filtrarMemosAlteraveis(body.data.ids, userId, await getUserIsAdmin(userId)) };
  });

  app.get("/api/memos/:memoId/alteravel", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const mid = idParam.safeParse((req.params as { memoId: string }).memoId);
    if (!mid.success) return reply.code(400).send({ error: "invalid_id" });
    try {
      return await obterMemoAlteravel(mid.data, userId, await getUserIsAdmin(userId));
    } catch (e) {
      return erro(reply, e);
    }
  });

  app.post("/api/memos/:memoId/alterar", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const mid = idParam.safeParse((req.params as { memoId: string }).memoId);
    const body = z.object({ campos: z.record(z.string().max(4000)) }).safeParse(req.body);
    if (!mid.success || !body.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      return await alterarMemo({
        memoId: mid.data,
        userId,
        isAdmin: await getUserIsAdmin(userId),
        campos: body.data.campos,
        origem: "edicao",
      });
    } catch (e) {
      return erro(reply, e);
    }
  });

  app.post("/api/memos/:memoId/situacao", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const mid = idParam.safeParse((req.params as { memoId: string }).memoId);
    const body = z.object({ situacao: z.enum(SITUACOES_MEMO) }).safeParse(req.body);
    if (!mid.success || !body.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      const isAdmin = await getUserIsAdmin(userId);
      const atual = await obterMemoAlteravel(mid.data, userId, isAdmin);
      return await alterarMemo({
        memoId: mid.data,
        userId,
        isAdmin,
        campos: { [atual.campoSituacao]: body.data.situacao },
        origem: "situacao",
      });
    } catch (e) {
      return erro(reply, e);
    }
  });

  app.post("/api/memos/alteracoes/:lote/desfazer", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const lote = z.string().uuid().safeParse((req.params as { lote: string }).lote);
    if (!lote.success) return reply.code(400).send({ error: "invalid_lote" });
    try {
      return await desfazerAlteracao(lote.data, userId, await getUserIsAdmin(userId));
    } catch (e) {
      return erro(reply, e);
    }
  });
};

export default plugin;
