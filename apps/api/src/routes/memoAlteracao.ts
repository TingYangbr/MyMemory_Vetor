import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import {
  alterarMemo,
  desfazerAlteracao,
  filtrarMemosAlteraveis,
  obterMemoAlteravel,
} from "../services/memoAlteracaoService.js";
import { conflitosDeCompromisso } from "../services/compromissoConflitoService.js";
import { assertUserWorkspaceGroupAccess } from "../services/memoContextService.js";

/** Alteração de memos de categoria atualizável a partir da resposta do Perguntar. */
const plugin: FastifyPluginAsync = async (app) => {
  const idParam = z.coerce.number().int().positive();

  const erro = (reply: FastifyReply, e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not_found") return reply.code(404).send({ error: msg, message: "Memo não encontrado." });
    if (msg === "nao_atualizavel") {
      return reply.code(400).send({ error: msg, message: "A categoria deste memo não é atualizável." });
    }
    if (msg.startsWith("status_invalido|")) {
      const [, campo, valores] = msg.split("|");
      return reply.code(400).send({ error: "status_invalido", message: `${campo} aceita só: ${valores}.` });
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

  // Form de registro novo (Agenda): compromissos ativos que cruzam com a data/hora/duração digitadas
  app.post("/api/memos/compromisso/conflitos", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const body = z
      .object({
        categoria: z.string().trim().min(1).max(200),
        groupId: z.number().int().positive().nullable(),
        campos: z.record(z.string().max(4000)),
        excluirId: z.number().int().positive().nullable().optional(),
        resumo: z.string().max(4000).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    if (body.data.groupId != null) {
      try {
        await assertUserWorkspaceGroupAccess(userId, body.data.groupId, await getUserIsAdmin(userId));
      } catch {
        return reply.code(403).send({ error: "forbidden" });
      }
    }
    const conflitos = await conflitosDeCompromisso({
      categoria: body.data.categoria,
      groupId: body.data.groupId,
      userId,
      dados: body.data.campos,
      excluirId: body.data.excluirId ?? null,
      resumo: body.data.resumo ?? null,
    });
    return { conflitos: conflitos.map(({ resumo, inicio, fim }) => ({ resumo, inicio, fim })) };
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
    // Pendente/Válido, Concluído (ou o nome da categoria: Comprado, Pago), Cancelado; "Ativo" antigo também
    const body = z.object({ situacao: z.string().trim().min(1).max(40) }).safeParse(req.body);
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
