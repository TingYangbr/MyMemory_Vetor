import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { resolveUserId } from "../lib/userContext.js";
import { assertCategoryInAccessibleGroup, userHasMemoContextAccess } from "../services/memoContextService.js";
import {
  atualizarRegra,
  criarRegra,
  excluirRegra,
  listarRegras,
  obterRegra,
  previaRegra,
} from "../services/lembreteService.js";
import { LEMBRETE_INTERVALOS_MIN } from "@mymemory/shared";

const regraSchema = z
  .object({
    ativo: z.boolean(),
    campoData: z.string().min(1).max(255),
    campoHorario: z.string().max(255).nullable(),
    antecedenciasMin: z.array(z.number().int().min(1).max(43_200)).min(1).max(6),
    destinatarioTipo: z.enum(["autor", "grupo", "owner", "email"]),
    destinatarioValor: z.string().max(2000).nullable(),
    campoAntecedencia: z.string().max(255).nullable(),
    campoDestinatario: z.string().max(255).nullable(),
    campoLembrete: z.string().max(255).nullable(),
    modeloTexto: z.string().max(4000).nullable(),
    horarioPadrao: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    lembrarImportados: z.boolean(),
    intervaloMin: z.number().int().refine((n) => (LEMBRETE_INTERVALOS_MIN as readonly number[]).includes(n)),
  })
  .refine((r) => r.destinatarioTipo !== "email" || /@/.test(r.destinatarioValor ?? ""), {
    message: "Informe ao menos um e-mail para o destinatário fixo.",
  });

/** Só owner/admin e só categorias de grupo (o lembrete usa os membros do grupo). */
async function autorizarCategoria(userId: number, categoryId: number, reply: FastifyReply): Promise<boolean> {
  if (!(await userHasMemoContextAccess(userId))) {
    reply.code(403).send({ error: "memo_context_forbidden" });
    return false;
  }
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT groupid FROM categories WHERE id = ? LIMIT 1`, [categoryId]);
  if (!rows[0]) {
    reply.code(404).send({ error: "not_found" });
    return false;
  }
  if (rows[0].groupId == null) {
    reply.code(400).send({ error: "categoria_global", message: "Lembretes são configurados em categorias de grupo." });
    return false;
  }
  try {
    await assertCategoryInAccessibleGroup(userId, categoryId);
    return true;
  } catch {
    reply.code(403).send({ error: "forbidden_context_edit", message: "Sem permissão para editar este escopo." });
    return false;
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  const idParam = z.coerce.number().int().positive();

  app.get("/api/memo-context/categories/:categoryId/lembretes", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const cid = idParam.safeParse((req.params as { categoryId: string }).categoryId);
    if (!cid.success) return reply.code(400).send({ error: "invalid_id" });
    if (!(await autorizarCategoria(userId, cid.data, reply))) return;
    return { regras: await listarRegras(cid.data) };
  });

  app.post("/api/memo-context/categories/:categoryId/lembretes", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const cid = idParam.safeParse((req.params as { categoryId: string }).categoryId);
    if (!cid.success) return reply.code(400).send({ error: "invalid_id" });
    const body = regraSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body", message: body.error.issues[0]?.message });
    if (!(await autorizarCategoria(userId, cid.data, reply))) return;
    return { id: await criarRegra(cid.data, body.data) };
  });

  app.patch("/api/lembretes/:id", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const id = idParam.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: "invalid_id" });
    const body = regraSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body", message: body.error.issues[0]?.message });
    const regra = await obterRegra(id.data);
    if (!regra) return reply.code(404).send({ error: "not_found" });
    if (!(await autorizarCategoria(userId, regra.categoryId, reply))) return;
    await atualizarRegra(id.data, body.data);
    return { ok: true };
  });

  app.delete("/api/lembretes/:id", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const id = idParam.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: "invalid_id" });
    const regra = await obterRegra(id.data);
    if (!regra) return reply.code(404).send({ error: "not_found" });
    if (!(await autorizarCategoria(userId, regra.categoryId, reply))) return;
    await excluirRegra(id.data);
    return { ok: true };
  });

  app.get("/api/lembretes/:id/previa", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const id = idParam.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: "invalid_id" });
    const regra = await obterRegra(id.data);
    if (!regra) return reply.code(404).send({ error: "not_found" });
    if (!(await autorizarCategoria(userId, regra.categoryId, reply))) return;
    return previaRegra(id.data);
  });
};

export default plugin;
