import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import { podeGerirImportacao } from "../services/donoMemoService.js";
import {
  AutomacaoError,
  INTERVALOS_AUTOMACAO_MIN,
  atualizarAutomacao,
  criarAutomacao,
  excluirAutomacao,
  executarAutomacao,
  listarAutomacoes,
  listarExecucoes,
  obterAutomacao,
  verificarPastaAutomacao,
} from "../services/automacaoImportacaoService.js";

const inputSchema = z.object({
  pasta: z.string().trim().min(1).max(2000),
  iaLevel: z.enum(["semIA", "basico", "completo"]),
  intervaloMin: z.number().int().refine((n) => (INTERVALOS_AUTOMACAO_MIN as readonly number[]).includes(n)),
  copiarArquivo: z.boolean(),
  limiteExecucao: z.number().int().min(1).max(500),
  avisarEmail: z.boolean(),
  ativo: z.boolean(),
});

const msgForbidden = { error: "forbidden", message: "Só owner ou editor do grupo podem automatizar a importação." };

/** Importação automática: CRUD, verificação da pasta, "Executar agora" e histórico (owner/editor do grupo). */
const plugin: FastifyPluginAsync = async (app) => {
  const idParam = z.coerce.number().int().positive();

  async function contexto(req: unknown, reply: FastifyReply, groupId: number): Promise<number | null> {
    const userId = await resolveUserId(req as never);
    if (!userId) { reply.code(401).send({ error: "unauthorized" }); return null; }
    if (!(await podeGerirImportacao(userId, groupId, await getUserIsAdmin(userId)))) {
      reply.code(403).send(msgForbidden);
      return null;
    }
    return userId;
  }

  async function daAutomacao(req: unknown, reply: FastifyReply) {
    const id = idParam.safeParse((req as { params: { id: string } }).params.id);
    if (!id.success) { reply.code(400).send({ error: "invalid_id" }); return null; }
    const a = await obterAutomacao(id.data);
    if (!a) { reply.code(404).send({ error: "not_found", message: "Automação não encontrada." }); return null; }
    const userId = await contexto(req, reply, a.groupId);
    return userId ? a : null;
  }

  app.get("/api/batch-automacoes", async (req, reply) => {
    const gid = idParam.safeParse((req.query as { groupId?: string }).groupId);
    if (!gid.success) return reply.code(400).send({ error: "invalid_group" });
    if (!(await contexto(req, reply, gid.data))) return;
    return { automacoes: await listarAutomacoes(gid.data) };
  });

  // Verifica a pasta (a janela mostra o erro em vermelho e permite "Verificar de novo")
  app.post("/api/batch-automacoes/verificar", async (req, reply) => {
    const body = z.object({ groupId: z.number().int().positive(), pasta: z.string().max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    if (!(await contexto(req, reply, body.data.groupId))) return;
    return verificarPastaAutomacao(body.data.pasta);
  });

  app.post("/api/batch-automacoes", async (req, reply) => {
    const body = inputSchema.extend({ groupId: z.number().int().positive() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body", message: body.error.issues[0]?.message });
    const userId = await contexto(req, reply, body.data.groupId);
    if (!userId) return;
    try {
      return reply.code(201).send({ automacao: await criarAutomacao(userId, body.data.groupId, body.data) });
    } catch (e) {
      if (e instanceof AutomacaoError) return reply.code(400).send({ error: "automacao_invalida", message: e.message });
      throw e;
    }
  });

  app.put("/api/batch-automacoes/:id", async (req, reply) => {
    const a = await daAutomacao(req, reply);
    if (!a) return;
    const body = inputSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body", message: body.error.issues[0]?.message });
    try {
      return { automacao: await atualizarAutomacao(a.id, body.data) };
    } catch (e) {
      if (e instanceof AutomacaoError) return reply.code(400).send({ error: "automacao_invalida", message: e.message });
      throw e;
    }
  });

  app.delete("/api/batch-automacoes/:id", async (req, reply) => {
    const a = await daAutomacao(req, reply);
    if (!a) return;
    await excluirAutomacao(a.id);
    return { ok: true };
  });

  // Roda em segundo plano (pode levar minutos); a tela acompanha pelo histórico/lista
  app.post("/api/batch-automacoes/:id/executar", async (req, reply) => {
    const a = await daAutomacao(req, reply);
    if (!a) return;
    if (a.executandoDesde) return reply.code(409).send({ error: "em_execucao", message: "Esta automação já está em execução." });
    void executarAutomacao(a.id, "manual").catch((err) => req.log.error(err, "[automacao] executar agora"));
    return reply.code(202).send({ ok: true });
  });

  app.get("/api/batch-automacoes/:id/execucoes", async (req, reply) => {
    const a = await daAutomacao(req, reply);
    if (!a) return;
    return { execucoes: await listarExecucoes(a.id) };
  });
};

export default plugin;
