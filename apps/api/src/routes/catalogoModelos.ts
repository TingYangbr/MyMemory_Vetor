import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import { habilitarModelo, listarModelos, publicarModelo, retirarModelo } from "../services/catalogoModelosService.js";

/** Catálogo de modelos prontos: listar, habilitar num grupo; publicar e retirar (admin). */
function erro(reply: FastifyReply, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === "not_found") return reply.code(404).send({ error: msg, message: "Modelo não encontrado." });
  if (msg === "forbidden_group" || msg === "forbidden_context_edit")
    return reply.code(403).send({ error: "forbidden", message: "Só o dono do grupo pode habilitar modelos." });
  const status = (e as { statusCode?: number } | null)?.statusCode;
  if (status === 400 || status === 409) return reply.code(status).send({ error: "invalid", message: msg });
  throw e;
}

const plugin: FastifyPluginAsync = async (app) => {
  const id = z.coerce.number().int().positive();

  app.get("/api/catalogo-modelos", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const q = z.object({ groupId: id.optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_query" });
    try {
      return { modelos: await listarModelos(q.data.groupId ?? null) };
    } catch (e) {
      return erro(reply, e);
    }
  });

  app.post("/api/catalogo-modelos/:modeloId/habilitar", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const mid = id.safeParse((req.params as { modeloId: string }).modeloId);
    const body = z.object({ groupId: z.number().int().positive() }).safeParse(req.body);
    if (!mid.success || !body.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      return { ok: true, ...(await habilitarModelo(userId, mid.data, body.data.groupId)) };
    } catch (e) {
      return erro(reply, e);
    }
  });

  // Admin: publica uma categoria (de qualquer grupo ou global) como modelo do catálogo
  app.post("/api/catalogo-modelos", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    if (!(await getUserIsAdmin(userId))) return reply.code(403).send({ error: "forbidden", message: "Só o administrador publica modelos." });
    const body = z
      .object({
        categoryId: z.number().int().positive(),
        resumo: z.string().max(4000).nullable().optional(),
        exemplos: z.string().max(4000).nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      return { ok: true, ...(await publicarModelo({ userId, categoryId: body.data.categoryId, resumo: body.data.resumo ?? null, exemplos: body.data.exemplos ?? null })) };
    } catch (e) {
      return erro(reply, e);
    }
  });

  app.delete("/api/catalogo-modelos/:modeloId", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    if (!(await getUserIsAdmin(userId))) return reply.code(403).send({ error: "forbidden" });
    const mid = id.safeParse((req.params as { modeloId: string }).modeloId);
    if (!mid.success) return reply.code(400).send({ error: "invalid_id" });
    try {
      await retirarModelo(mid.data);
      return { ok: true };
    } catch (e) {
      return erro(reply, e);
    }
  });
};

export default plugin;
