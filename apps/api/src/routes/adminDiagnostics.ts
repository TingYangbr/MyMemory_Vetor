import type { FastifyPluginAsync } from "fastify";
import type { AdminDiagnosticCheck, AdminDiagnosticsResponse } from "@mymemory/shared";
import { performance } from "node:perf_hooks";
import { requireAdmin } from "../lib/adminContext.js";
import { pool } from "../db.js";
import { generateEmbeddings } from "../lib/openaiEmbedding.js";
import { chatIa, getAiConfig, OPERATION_CHAT } from "../lib/aiProviderFactory.js";

/** Executa `fn`, cronometra e converte sucesso/erro em um AdminDiagnosticCheck. */
async function runCheck(
  id: string,
  label: string,
  fn: () => Promise<string | undefined>
): Promise<AdminDiagnosticCheck> {
  const start = performance.now();
  try {
    const detail = await fn();
    return { id, label, ok: true, durationMs: Math.round(performance.now() - start), detail };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { id, label, ok: false, durationMs: Math.round(performance.now() - start), detail };
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  // Diagnóstico de saúde: testa banco, embeddings e o provedor de chat configurado,
  // reportando latência e falhas de cada dependência da pergunta ao MyMemory.
  app.get("/api/admin/diagnostics", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;

    const checks: AdminDiagnosticCheck[] = [];

    // 1) Banco de dados (Postgres)
    checks.push(
      await runCheck("postgres", "Banco de dados (Postgres)", async () => {
        await pool.query("SELECT 1");
        return "SELECT 1 OK";
      })
    );

    // 2) Embeddings (OpenAI text-embedding-3-small) — usado pela busca semântica
    checks.push(
      await runCheck("embeddings", "Embeddings (busca semântica)", async () => {
        const [vec] = await generateEmbeddings(["ping de diagnóstico"]);
        if (!vec || vec.length === 0) throw new Error("resposta de embedding vazia");
        return `OK — ${vec.length} dimensões`;
      })
    );

    // 3) Provedor de chat configurado — usado por classificação, planejamento e síntese
    const chatConfig = await getAiConfig(OPERATION_CHAT).catch(() => null);
    checks.push(
      await runCheck("chat", "Provedor de IA (chat)", async () => {
        const { content } = await chatIa(
          [
            { role: "system", content: "Responda somente com JSON válido." },
            { role: "user", content: 'Responda exatamente: {"ok":true}' },
          ],
          { source: "diagnostics" }
        );
        const provider = chatConfig?.provider ?? "configurado";
        const model = chatConfig?.model ?? "?";
        const preview = content.trim().slice(0, 60);
        return `OK — ${provider} / ${model} — resposta: ${preview}`;
      })
    );

    const body: AdminDiagnosticsResponse = { checks, ranAt: new Date().toISOString() };
    return body;
  });
};

export default plugin;
