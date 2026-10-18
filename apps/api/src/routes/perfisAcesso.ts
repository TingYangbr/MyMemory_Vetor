import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { assertOwnerOrAdmin } from "../lib/groupOwnerContext.js";
import {
  PerfilError,
  carregarMatriz,
  createPerfil,
  deletePerfil,
  desligarIdentidade,
  duplicarPerfil,
  ligarIdentidade,
  setConfigGrupo,
  setMeusPorPadrao,
  setPerfilDoMembro,
  setPerfilPadrao,
  updatePerfil,
} from "../services/perfisAcessoService.js";

const id = z.coerce.number().int().positive();

const perfilBody = z.object({
  nome: z.string().min(1).max(120),
  todas: z.boolean().optional(),
  incluiSemCategoria: z.boolean().optional(),
  categoriaIds: z.array(z.number().int().positive()).max(500).optional(),
});

function erro(reply: FastifyReply, e: unknown) {
  if (e instanceof PerfilError) {
    const conflito = ["nome_duplicado", "id_externo_ja_ligado", "membro_ja_tem_id", "perfil_padrao_nao_exclui"].includes(e.code);
    return reply.code(conflito ? 409 : 400).send({ error: e.code, message: e.message });
  }
  throw e;
}

/**
 * Perfis de acesso e de-para — uma API só, usada pelo painel administrativo (admin escolhe o grupo)
 * e pelo painel do dono do grupo.
 */
const plugin: FastifyPluginAsync = async (app) => {
  const base = "/api/groups/:groupId/perfis";

  /** Valida groupId + autoriza. Devolve o contexto ou null (resposta já enviada). */
  async function entrar(req: FastifyRequest, reply: FastifyReply) {
    const gid = id.safeParse((req.params as { groupId: string }).groupId);
    if (!gid.success) {
      void reply.code(400).send({ error: "invalid_group_id" });
      return null;
    }
    const auth = await assertOwnerOrAdmin(req, reply, gid.data);
    return auth ? { groupId: gid.data, ...auth } : null;
  }

  app.get(base, async (req, reply) => {
    const ctx = await entrar(req, reply);
    if (!ctx) return;
    return carregarMatriz(ctx.groupId);
  });

  app.post(base, async (req, reply) => {
    const ctx = await entrar(req, reply);
    if (!ctx) return;
    const parsed = perfilBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      return reply.code(201).send({ id: await createPerfil(ctx.groupId, parsed.data) });
    } catch (e) {
      return erro(reply, e);
    }
  });

  app.patch(`${base}/:perfilId`, async (req, reply) => {
    const ctx = await entrar(req, reply);
    if (!ctx) return;
    const pid = id.safeParse((req.params as { perfilId: string }).perfilId);
    const parsed = perfilBody.partial().safeParse(req.body);
    if (!pid.success || !parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      await updatePerfil(ctx.groupId, pid.data, parsed.data);
      return { ok: true };
    } catch (e) {
      return erro(reply, e);
    }
  });

  app.post(`${base}/:perfilId/duplicar`, async (req, reply) => {
    const ctx = await entrar(req, reply);
    if (!ctx) return;
    const pid = id.safeParse((req.params as { perfilId: string }).perfilId);
    const parsed = z.object({ nome: z.string().min(1).max(120) }).safeParse(req.body);
    if (!pid.success || !parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      return reply.code(201).send({ id: await duplicarPerfil(ctx.groupId, pid.data, parsed.data.nome) });
    } catch (e) {
      return erro(reply, e);
    }
  });

  app.post(`${base}/:perfilId/padrao`, async (req, reply) => {
    const ctx = await entrar(req, reply);
    if (!ctx) return;
    const pid = id.safeParse((req.params as { perfilId: string }).perfilId);
    if (!pid.success) return reply.code(400).send({ error: "invalid_id" });
    try {
      await setPerfilPadrao(ctx.groupId, pid.data);
      return { ok: true };
    } catch (e) {
      return erro(reply, e);
    }
  });

  app.delete(`${base}/:perfilId`, async (req, reply) => {
    const ctx = await entrar(req, reply);
    if (!ctx) return;
    const pid = id.safeParse((req.params as { perfilId: string }).perfilId);
    if (!pid.success) return reply.code(400).send({ error: "invalid_id" });
    try {
      await deletePerfil(ctx.groupId, pid.data);
      return { ok: true };
    } catch (e) {
      return erro(reply, e);
    }
  });

  // Perfil de um membro (perfilId null = volta ao padrão do grupo).
  app.put(`${base}/membros/:userId`, async (req, reply) => {
    const ctx = await entrar(req, reply);
    if (!ctx) return;
    const uid = id.safeParse((req.params as { userId: string }).userId);
    const parsed = z.object({ perfilId: z.number().int().positive().nullable() }).safeParse(req.body);
    if (!uid.success || !parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      await setPerfilDoMembro(ctx.groupId, uid.data, parsed.data.perfilId);
      return { ok: true };
    } catch (e) {
      return erro(reply, e);
    }
  });

  // De-para: liga o membro ao id dele no ERP.
  app.put(`${base}/identidades`, async (req, reply) => {
    const ctx = await entrar(req, reply);
    if (!ctx) return;
    const parsed = z
      .object({
        sistema: z.string().min(1).max(60),
        banco: z.string().max(120).optional(),
        idExterno: z.string().min(1).max(120),
        userId: z.number().int().positive(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      return { id: await ligarIdentidade(ctx.groupId, parsed.data) };
    } catch (e) {
      return erro(reply, e);
    }
  });

  app.delete(`${base}/identidades/:identidadeId`, async (req, reply) => {
    const ctx = await entrar(req, reply);
    if (!ctx) return;
    const iid = id.safeParse((req.params as { identidadeId: string }).identidadeId);
    if (!iid.success) return reply.code(400).send({ error: "invalid_id" });
    await desligarIdentidade(ctx.groupId, iid.data);
    return { ok: true };
  });

  // Marca "Só os meus" da categoria.
  app.patch(`${base}/categorias/:categoryId`, async (req, reply) => {
    const ctx = await entrar(req, reply);
    if (!ctx) return;
    const cid = id.safeParse((req.params as { categoryId: string }).categoryId);
    const parsed = z.object({ meusPorPadrao: z.boolean() }).safeParse(req.body);
    if (!cid.success || !parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      await setMeusPorPadrao(ctx.groupId, cid.data, parsed.data.meusPorPadrao, ctx.isAdmin);
      return { ok: true };
    } catch (e) {
      return erro(reply, e);
    }
  });

  // Chaves do grupo: aplicar perfis nas perguntas / exigir cadastro no de-para.
  app.patch(`${base}/config`, async (req, reply) => {
    const ctx = await entrar(req, reply);
    if (!ctx) return;
    const parsed = z
      .object({ perfisAtivos: z.boolean().optional(), exigirCadastro: z.boolean().optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    await setConfigGrupo(ctx.groupId, parsed.data);
    return { ok: true };
  });
};

export default plugin;
