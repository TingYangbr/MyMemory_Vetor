import type { FastifyPluginAsync } from "fastify";
import type { PerguntaRequest, PerguntaResponse } from "@mymemory/shared";
import { z } from "zod";
import { resolveUserId, getUserIsAdmin } from "../lib/userContext.js";
import { assertUserWorkspaceGroupAccess } from "../services/memoContextService.js";
import { loadMemoContextStructure } from "../services/memoContextService.js";
import { perguntarMemory } from "../services/perguntaService.js";
import { getSemanticSearchThresholds } from "../services/systemConfigService.js";
import { getAllLlmPromptTraces } from "../lib/invokeLlm.js";
import { runWithStatusEmitter } from "../lib/requestStatus.js";
import { pool } from "../db.js";
import { openaiTranscribeAudio } from "../lib/openaiTranscription.js";

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
  forcePipe: z.enum(["semantica", "estruturada", "hibrida"]).optional(),
  thresholdOverride: z.number().min(0).max(1).optional(),
  forceCategories: z.array(z.string()).optional(),
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
      // Fallback: se o contexto do grupo não tiver categorias, tenta as globais (groupId = null)
      if (!structure.categories.length && groupId != null) {
        const global = await loadMemoContextStructure(userId, null, null);
        if (global.categories.length) structure = { ...structure, categories: global.categories };
      }
    } catch {
      structure = { categories: [], capabilities: { canEditStructure: false } };
    }

    const thresholds = await getSemanticSearchThresholds();

    // ── SSE setup ───────────────────────────────────────────────────────────────
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    raw.flushHeaders();

    const sendEvent = (data: unknown) => {
      if (!raw.destroyed) raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let result;
    try {
      result = await runWithStatusEmitter(
        (msg) => sendEvent({ type: "status", message: msg }),
        () => perguntarMemory({
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
          forcePipe: parsed.data.forcePipe,
          forceCategories: parsed.data.forceCategories,
          thresholdInitial: parsed.data.thresholdOverride != null
            ? Math.max(parsed.data.thresholdOverride, thresholds.min)
            : thresholds.initial,
          thresholdMin: thresholds.min,
        })
      );
    } catch (err) {
      req.log.error(err, "perguntarMemory failed");
      const msg = err instanceof Error ? err.message : "Erro interno";
      const isNetwork = /fetch failed|ECONNREFUSED|ETIMEDOUT|socket hang up/i.test(msg);
      sendEvent({
        type: "error",
        message: isNetwork
          ? "Não foi possível contatar o serviço de IA. Tente novamente em instantes."
          : `Erro ao processar a pergunta: ${msg}`,
      });
      raw.end();
      return reply;
    }

    pool.query(
      `INSERT INTO api_usage_logs (memoid, userid, operation, model, inputtokens, outputtokens, totaltokens, costusd)
       VALUES (NULL, ?, 'Response to Question', 'aggregate', 0, 0, 0, ?)`,
      [userId, result.apiCost]
    ).catch((err: unknown) => {
      req.log.error(err, "[perguntas] api_usage_logs INSERT failed");
    });

    const body: PerguntaResponse = {
      resposta: result.resposta,
      classificacao: result.classificacao,
      apiCost: result.apiCost,
      aguardaFase2: result.aguardaFase2 || undefined,
      limiarInicial: result.limiarInicial,
      limiarUsado: result.limiarUsado,
      limiarMinimo: result.limiarMinimo,
      memosEncontrados: result.memosEncontrados,
      llmTrace: getAllLlmPromptTraces(),
    };

    sendEvent({ type: "result", data: body });
    raw.end();
    return reply;
  });

  // Transcrição de chunk de áudio via Whisper (usado pelo gravador mobile)
  app.post("/api/perguntas/transcribe", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) return reply.code(401).send({ error: "unauthorized" });

    const data = await req.file();
    if (!data) return reply.code(400).send({ error: "no_file" });

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);

    if (buffer.length < 1000) return reply.send({ text: "" });

    const mime = data.mimetype || "audio/webm";
    const filename = data.filename || "chunk.webm";

    const result = await openaiTranscribeAudio({ buffer, filename, mime });
    return reply.send({ text: result.text });
  });
};

export default plugin;
