import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import { pool } from "../db.js";
import { config } from "../config.js";
import { invalidateAiConfigCache } from "../lib/aiProviderFactory.js";
import type { RowDataPacket, ResultSetHeader } from "../lib/dbTypes.js";
import type { AiConfigListResponse, AiConfigRow } from "@mymemory/shared";

const PROVIDER_VALUES = ["openai", "google_gemini", "anthropic", "manus_proxy", "microsoft_azure"] as const;

const updateSchema = z.object({
  provider:    z.enum(PROVIDER_VALUES),
  model:       z.string().min(1).max(100),
  isEnabled:   z.boolean(),
  maxTokens:   z.number().int().positive().nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  notes:       z.string().max(500).nullable().optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/ai-config", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, operation, displayName, provider, model, isEnabled, maxTokens, temperature, notes, updatedAt
       FROM ai_config ORDER BY id`
    );

    const mappedRows: AiConfigRow[] = (rows as AiConfigRow[]).map((r) => ({
      id:          r.id,
      operation:   r.operation,
      displayName: r.displayName,
      provider:    r.provider,
      model:       r.model,
      isEnabled:   r.isEnabled === (1 as unknown) || r.isEnabled === true,
      maxTokens:   r.maxTokens != null ? Number(r.maxTokens) : null,
      temperature: r.temperature != null ? Number(r.temperature) : null,
      notes:       r.notes ?? null,
      updatedAt:   r.updatedAt,
    }));

    const body: AiConfigListResponse = {
      rows: mappedRows,
      providersConfigured: {
        openai:   Boolean(config.openai.apiKey),
        gemini:   Boolean(config.gemini.apiKey),
        anthropic: Boolean(config.anthropic.apiKey),
      },
    };
    return body;
  });

  app.put("/api/admin/ai-config/:operation", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;

    const { operation } = req.params as { operation: string };
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: parsed.error.issues[0]?.message });
    }

    const { provider, model, isEnabled, maxTokens, temperature, notes } = parsed.data;

    const [res] = await pool.query<ResultSetHeader>(
      `UPDATE ai_config
       SET provider = ?, model = ?, isEnabled = ?, maxTokens = ?, temperature = ?, notes = ?, updatedAt = NOW()
       WHERE operation = ?`,
      [provider, model, isEnabled ? 1 : 0, maxTokens ?? null, temperature ?? null, notes ?? null, operation]
    );

    if (res.affectedRows === 0) {
      return reply.code(404).send({ error: "not_found" });
    }

    invalidateAiConfigCache(operation);
    return { ok: true };
  });
};

export default plugin;
