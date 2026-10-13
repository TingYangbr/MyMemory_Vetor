import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { performance } from "node:perf_hooks";
import {
  aplicarValoresNoPlano,
  derivarChips,
  perguntaComValores,
  type AvisoExecucaoSnapshot,
  type MemoContextCategory,
  type PerguntaChipValor,
  type PerguntaPlanoSalvo,
  type PerguntaResponse,
  type PlanoSalvo,
} from "@mymemory/shared";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { resolveUserId } from "../lib/userContext.js";
import { assertUserWorkspaceGroupAccess } from "../services/memoContextService.js";
import { getUserIsAdmin } from "../lib/userContext.js";
import { loadMemoContextStructure } from "../services/memoContextService.js";
import { buildQueriesDisponiveis, hashQueryDisponivel } from "../services/perguntaService.js";
import { executarPlanoSalvo, sugerirValoresParam, type PlanoConsulta, type QueryDisponivel } from "../services/perguntaPipe2.js";
import { gerarSugestaoAviso } from "../services/avisoService.js";
import { runWithTraces } from "../lib/invokeLlm.js";
import { runWithTimings } from "../lib/requestTimings.js";

const planoSchema = z
  .object({
    versao: z.literal(1),
    classificacao: z.object({ categorias: z.array(z.string()) }).passthrough(),
    plano: z.object({ queries: z.array(z.object({ query_id: z.string(), parametros: z.array(z.any()) }).passthrough()).min(1) }).passthrough(),
    queryHashes: z.record(z.string()),
  })
  .passthrough();

const createSchema = z.object({
  pergunta: z.string().min(1).max(4000),
  category: z.string().nullable().optional(),
  workspaceGroupId: z.number().int().positive().nullable().optional(),
  anotacoes: z.string().nullable().optional(),
  /** Plano da execução que gerou a resposta (pergunta salva com chips). */
  plano: planoSchema.nullable().optional(),
});

const updateSchema = z.object({
  pergunta: z.string().min(1).max(4000).optional(),
  category: z.string().nullable().optional(),
  anotacoes: z.string().nullable().optional(),
  estrelas: z.number().int().min(1).max(5).nullable().optional(),
});

type ModeloComPlano = { id: number; userId: number; groupId: number | null; pergunta: string; plano: PerguntaPlanoSalvo | null };

/** Carrega a pergunta salva e confere o acesso (dono, ou membro do grupo dela). */
async function carregarModeloAcessivel(id: number, userId: number): Promise<ModeloComPlano | "not_found" | "forbidden"> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, userid, groupid, pergunta, plano_json AS plano FROM pergunta_modelos WHERE id = ?`,
    [id]
  );
  const row = (rows as Record<string, unknown>[])[0] as ModeloComPlano | undefined;
  if (!row) return "not_found";
  if (row.groupId != null) {
    const isAdmin = await getUserIsAdmin(userId);
    try {
      await assertUserWorkspaceGroupAccess(userId, row.groupId, isAdmin);
    } catch {
      return "forbidden";
    }
  } else if (row.userId !== userId) {
    return "forbidden";
  }
  return row;
}

/** Mesma regra da rota /api/perguntas: categorias do grupo; sem categorias próprias → globais. */
async function carregarCategorias(userId: number, groupId: number | null): Promise<MemoContextCategory[]> {
  if (groupId == null) return [];
  try {
    const s = await loadMemoContextStructure(userId, groupId, null);
    if (s.categories.length) return s.categories;
    return (await loadMemoContextStructure(userId, null, null)).categories;
  } catch {
    return [];
  }
}

/** Queries do plano ainda existem e não mudaram (SQL, parâmetros, conexão) desde que a pergunta foi salva. */
function planoAindaValido(salvo: PerguntaPlanoSalvo, disponiveis: QueryDisponivel[]): boolean {
  return salvo.plano.queries.every((t) => {
    const q = disponiveis.find((x) => x.query_id === t.query_id);
    return q != null && !q.conexaoPendente && salvo.queryHashes[t.query_id] === hashQueryDisponivel(q);
  });
}

// Cache curto das sugestões do autocomplete (consulta pode ir a um SQL Server remoto)
const cacheSugestoes = new Map<string, { em: number; valores: string[] }>();
const CACHE_SUGESTOES_MS = 10 * 60_000;

const executarSchema = z.object({
  valores: z
    .record(z.union([
      z.string().max(500),
      z.object({ ini: z.string().nullable(), fin: z.string().nullable(), rotulo: z.string().nullable().optional() }),
    ]))
    .default({}),
});

const plugin: FastifyPluginAsync = async (app) => {
  // GET /api/pergunta-modelos?workspaceGroupId=N
  app.get("/api/pergunta-modelos", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const query = req.query as Record<string, string>;
    const rawGid = query.workspaceGroupId;
    const groupId = rawGid && rawGid !== "null" ? parseInt(rawGid, 10) : null;

    if (groupId != null) {
      const isAdmin = await getUserIsAdmin(userId);
      try {
        await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
      } catch {
        return reply.code(403).send({ error: "forbidden_group" });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, userid, groupid, category, pergunta, anotacoes, estrelas, createdat, updatedat, plano_json AS plano
         FROM pergunta_modelos WHERE groupid = ? ORDER BY createdat DESC`,
        [groupId]
      );
      return reply.send({ modelos: rows });
    } else {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, userid, groupid, category, pergunta, anotacoes, estrelas, createdat, updatedat, plano_json AS plano
         FROM pergunta_modelos WHERE groupid IS NULL AND userid = ? ORDER BY createdat DESC`,
        [userId]
      );
      return reply.send({ modelos: rows });
    }
  });

  // POST /api/pergunta-modelos
  app.post("/api/pergunta-modelos", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const { pergunta, category, workspaceGroupId, anotacoes, plano } = parsed.data;
    const groupId = workspaceGroupId ?? null;

    if (groupId != null) {
      const isAdmin = await getUserIsAdmin(userId);
      try {
        await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
      } catch {
        return reply.code(403).send({ error: "forbidden_group" });
      }
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `INSERT INTO pergunta_modelos (userid, groupid, category, pergunta, anotacoes, plano_json)
       VALUES (?, ?, ?, ?, ?, ?::jsonb) RETURNING id, userid, groupid, category, pergunta, anotacoes, estrelas, createdat, updatedat, plano_json AS plano`,
      [userId, groupId, category ?? null, pergunta, anotacoes ?? null, plano ? JSON.stringify(plano) : null]
    );
    return reply.code(201).send({ modelo: (rows as Record<string, unknown>[])[0] });
  });

  // PUT /api/pergunta-modelos/:id
  app.put("/api/pergunta-modelos/:id", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const id = parseInt((req.params as { id: string }).id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: "invalid_id" });

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id, userid, groupid FROM pergunta_modelos WHERE id = ?`,
      [id]
    );
    if (!(existing as unknown[]).length) return reply.code(404).send({ error: "not_found" });

    const row = (existing as Record<string, unknown>[])[0] as { id: number; userId: number; groupId: number | null };
    if (row.userId !== userId) {
      if (row.groupId != null) {
        // Membros do grupo podem editar perguntas salvas do grupo
        const isAdmin = await getUserIsAdmin(userId);
        try {
          await assertUserWorkspaceGroupAccess(userId, row.groupId, isAdmin);
        } catch {
          return reply.code(403).send({ error: "forbidden" });
        }
      } else {
        return reply.code(403).send({ error: "forbidden" });
      }
    }

    const { pergunta, category, anotacoes, estrelas } = parsed.data;
    const sets: string[] = ["updatedat = NOW()"];
    const vals: unknown[] = [];
    // Texto alterado: o plano salvo pode não corresponder mais à pergunta — volta a ser pergunta comum
    if (pergunta !== undefined) { sets.push("pergunta = ?", "plano_json = CASE WHEN pergunta = ? THEN plano_json ELSE NULL END"); vals.push(pergunta, pergunta); }
    if (category !== undefined) { sets.push("category = ?"); vals.push(category); }
    if (anotacoes !== undefined) { sets.push("anotacoes = ?"); vals.push(anotacoes); }
    if (estrelas !== undefined) { sets.push("estrelas = ?"); vals.push(estrelas); }
    vals.push(id);

    const [rows] = await pool.query<RowDataPacket[]>(
      `UPDATE pergunta_modelos SET ${sets.join(", ")} WHERE id = ?
       RETURNING id, userid, groupid, category, pergunta, anotacoes, estrelas, createdat, updatedat, plano_json AS plano`,
      vals
    );
    return reply.send({ modelo: (rows as Record<string, unknown>[])[0] });
  });

  // DELETE /api/pergunta-modelos/:id
  app.delete("/api/pergunta-modelos/:id", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const id = parseInt((req.params as { id: string }).id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: "invalid_id" });

    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT userid, groupid FROM pergunta_modelos WHERE id = ?`,
      [id]
    );
    if (!(existing as unknown[]).length) return reply.send({ ok: true }); // já deletado

    const row = (existing as Record<string, unknown>[])[0] as { userId: number; groupId: number | null };
    if (row.userId !== userId) {
      if (row.groupId != null) {
        const isAdmin = await getUserIsAdmin(userId);
        try {
          await assertUserWorkspaceGroupAccess(userId, row.groupId, isAdmin);
        } catch {
          return reply.code(403).send({ error: "forbidden" });
        }
      } else {
        return reply.code(403).send({ error: "forbidden" });
      }
    }

    await pool.query(`DELETE FROM pergunta_modelos WHERE id = ?`, [id]);
    return reply.send({ ok: true });
  });
  // POST /api/pergunta-modelos/:id/executar — reexecuta o plano salvo com os valores dos chips.
  // Se alguma query do plano mudou desde o salvamento, devolve { replanejar, pergunta } e o
  // frontend faz a pergunta pelo caminho normal (/api/perguntas).
  app.post("/api/pergunta-modelos/:id/executar", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const id = parseInt((req.params as { id: string }).id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: "invalid_id" });
    const parsed = executarSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const modelo = await carregarModeloAcessivel(id, userId);
    if (modelo === "not_found") return reply.code(404).send({ error: "not_found" });
    if (modelo === "forbidden") return reply.code(403).send({ error: "forbidden" });

    const valores = parsed.data.valores as Record<string, PerguntaChipValor>;
    const salvo = modelo.plano;
    const chips = salvo ? derivarChips(salvo.plano) : [];
    const perguntaTexto = perguntaComValores(modelo.pergunta, chips, valores);
    if (!salvo) return reply.send({ replanejar: true, pergunta: perguntaTexto, motivo: "sem_plano" });

    const categories = await carregarCategorias(userId, modelo.groupId);
    const disponiveis = buildQueriesDisponiveis(categories, salvo.classificacao.categorias);
    if (!planoAindaValido(salvo, disponiveis)) {
      return reply.send({ replanejar: true, pergunta: perguntaTexto, motivo: "query_alterada" });
    }

    const plano = aplicarValoresNoPlano(salvo.plano, chips, valores) as unknown as PlanoConsulta;
    const primeira = salvo.classificacao.categorias[0];
    const categoryId = primeira ? categories.find((c) => c.isActive === 1 && c.name === primeira)?.id ?? null : null;

    try {
      const t0 = performance.now();
      const { value: ran, traces } = await runWithTraces(() => runWithTimings(() => executarPlanoSalvo({
        pergunta: perguntaTexto,
        plano,
        queriesDisponiveis: disponiveis,
        userId,
        groupId: modelo.groupId,
        categoryId,
      })));
      const result = ran.value;

      pool.query(
        `INSERT INTO api_usage_logs (memoid, userid, operation, model, inputtokens, outputtokens, totaltokens, costusd)
         VALUES (NULL, ?, 'Response to Question', 'aggregate', 0, 0, 0, ?)`,
        [userId, result.apiCost]
      ).catch((err: unknown) => req.log.error(err, "[pergunta-modelos/executar] api_usage_logs INSERT failed"));

      const avisoSnapshot: AvisoExecucaoSnapshot = { tipo: "estruturada", queries: result.queriesParaAviso ?? [] };
      const body: PerguntaResponse = {
        resposta: result.resposta,
        classificacao: salvo.classificacao,
        apiCost: result.apiCost,
        timings: [{ label: "Total", durationMs: Math.round(performance.now() - t0) }, ...ran.timings],
        llmTrace: traces,
        sugestaoAviso: gerarSugestaoAviso().texto,
        avisoSnapshot,
        planoReaproveitado: true,
        // Salvar este card de novo guarda o plano já com os valores trocados
        planoSalvavel: { ...salvo, plano: plano as unknown as PlanoSalvo },
      };
      return reply.send({ pergunta: perguntaTexto, resultado: body });
    } catch (err) {
      req.log.error(err, "[pergunta-modelos/executar] failed");
      const msg = err instanceof Error ? err.message : "Erro interno";
      const parcial = (err && typeof err === "object" ? err : {}) as { llmTrace?: unknown[]; timings?: unknown[] };
      return reply.code(500).send({
        error: "execucao_falhou",
        message: `Erro ao processar a pergunta: ${msg}`,
        pergunta: perguntaTexto,
        llmTrace: parcial.llmTrace ?? [],
        timings: parcial.timings ?? [],
      });
    }
  });

  // GET /api/pergunta-modelos/:id/valores?chave=abrev_empresa&q=gen — sugestões para o chip
  app.get("/api/pergunta-modelos/:id/valores", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const id = parseInt((req.params as { id: string }).id, 10);
    const { chave, q } = req.query as { chave?: string; q?: string };
    const termo = (q ?? "").trim().slice(0, 100);
    if (isNaN(id) || !chave || termo.length < 2) return reply.send({ valores: [] });

    const modelo = await carregarModeloAcessivel(id, userId);
    if (modelo === "not_found") return reply.code(404).send({ error: "not_found" });
    if (modelo === "forbidden") return reply.code(403).send({ error: "forbidden" });
    if (!modelo.plano) return reply.send({ valores: [] });

    const chip = derivarChips(modelo.plano.plano).find((c) => c.chave === chave);
    if (!chip || chip.tipo === "periodo" || chip.tipo === "numero") return reply.send({ valores: [] });

    const chaveCache = `${userId}|${id}|${chave}|${termo.toLowerCase()}`;
    const emCache = cacheSugestoes.get(chaveCache);
    if (emCache && Date.now() - emCache.em < CACHE_SUGESTOES_MS) return reply.send({ valores: emCache.valores });

    const categories = await carregarCategorias(userId, modelo.groupId);
    const template = buildQueriesDisponiveis(categories, modelo.plano.classificacao.categorias)
      .find((x) => x.query_id === chip.queryId);
    if (!template || template.conexaoPendente) return reply.send({ valores: [] });

    try {
      const valores = await sugerirValoresParam({ template, param: chip.param, termo, userId, groupId: modelo.groupId });
      if (cacheSugestoes.size > 500) cacheSugestoes.clear();
      cacheSugestoes.set(chaveCache, { em: Date.now(), valores });
      return reply.send({ valores });
    } catch (err) {
      req.log.warn(err, "[pergunta-modelos/valores] sugestão falhou");
      return reply.send({ valores: [] });
    }
  });
};

export default plugin;
