import type { FastifyPluginAsync } from "fastify";
import type { PerguntaRequest, PerguntaResponse } from "@mymemory/shared";
import { z } from "zod";
import { resolveUserId, getUserIsAdmin } from "../lib/userContext.js";
import { assertUserWorkspaceGroupAccess } from "../services/memoContextService.js";
import { loadMemoContextStructure } from "../services/memoContextService.js";
import { perguntarMemory } from "../services/perguntaService.js";

const perguntaBodySchema = z.object({
  pergunta: z.string().min(1).max(4000),
  workspaceGroupId: z.number().int().positive().nullable().optional(),
  filtros: z
    .object({
      autorId: z.number().int().positive().nullable().optional(),
      dataInicio: z.string().nullable().optional(),
      dataFim: z.string().nullable().optional(),
    })
    .optional(),
  contextoSessao: z
    .array(
      z.object({
        pergunta: z.string(),
        resposta: z.string(),
        pipe: z.enum(["semantica", "estruturada", "hibrida"]),
      })
    )
    .max(10)
    .optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.post("/api/perguntas", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login para continuar." });
    }

    const parsed = perguntaBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      });
    }

    const { pergunta, workspaceGroupId, filtros, contextoSessao } = parsed.data;
    const groupId = workspaceGroupId ?? null;
    const isAdmin = await getUserIsAdmin(userId);

    if (groupId != null) {
      try {
        await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
      } catch {
        return reply.code(403).send({ error: "forbidden_group", message: "Sem acesso a este grupo." });
      }
    }

    let structure;
    try {
      structure = await loadMemoContextStructure(userId, groupId, null);
    } catch {
      structure = { categories: [], capabilities: { canEditStructure: false } };
    }

    const result = await perguntarMemory({
      userId,
      isAdmin,
      groupId,
      pergunta,
      filtros: {
        autorId: filtros?.autorId ?? null,
        dataInicio: filtros?.dataInicio ?? null,
        dataFim: filtros?.dataFim ?? null,
      },
      historico: contextoSessao ?? [],
      categories: structure.categories,
    });

    const body: PerguntaResponse = {
      resposta: result.resposta,
      classificacao: result.classificacao,
      apiCost: result.apiCost,
      aguardaFase2: result.aguardaFase2 || undefined,
    };

    return body;
  });
};

export default plugin;
