import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import {
  atribuirDono,
  listarMembrosDoGrupo,
  listarMemosSemDono,
  podeGerirImportacao,
} from "../services/donoMemoService.js";

/** Memos de categoria Pessoal sem dono identificado (importação em lote) e atribuição manual. */
const plugin: FastifyPluginAsync = async (app) => {
  const idParam = z.coerce.number().int().positive();

  app.get("/api/memos/sem-dono", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const gid = idParam.safeParse((req.query as { groupId?: string }).groupId);
    if (!gid.success) return reply.code(400).send({ error: "invalid_group" });
    if (!(await podeGerirImportacao(userId, gid.data, await getUserIsAdmin(userId)))) {
      return reply.code(403).send({ error: "forbidden", message: "Só owner ou editor do grupo." });
    }
    const [itens, membros] = await Promise.all([listarMemosSemDono(gid.data), listarMembrosDoGrupo(gid.data)]);
    return { itens, membros };
  });

  app.post("/api/memos/:memoId/atribuir-dono", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const mid = idParam.safeParse((req.params as { memoId: string }).memoId);
    const body = z.object({ groupId: z.number().int().positive(), userId: z.number().int().positive() }).safeParse(req.body);
    if (!mid.success || !body.success) return reply.code(400).send({ error: "invalid_body" });
    if (!(await podeGerirImportacao(userId, body.data.groupId, await getUserIsAdmin(userId)))) {
      return reply.code(403).send({ error: "forbidden", message: "Só owner ou editor do grupo." });
    }
    try {
      await atribuirDono(mid.data, body.data.groupId, body.data.userId);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "dono_nao_membro") return reply.code(400).send({ error: msg, message: "A pessoa não é membro do grupo." });
      if (msg === "memo_nao_encontrado") return reply.code(404).send({ error: msg, message: "Memo não encontrado neste grupo." });
      throw e;
    }
  });
};

export default plugin;
