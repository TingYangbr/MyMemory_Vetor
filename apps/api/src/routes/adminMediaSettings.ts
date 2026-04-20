import type { FastifyPluginAsync } from "fastify";
import type { AdminMediaSettingsResponse, MediaSettingsMediaTypeDb } from "@mymemory/shared";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import { getPlanMediaSettingsAdmin, upsertPlanMediaSettingsAdmin } from "../services/mediaSettingsAdminService.js";

const mediaTypeEnum = z.enum(["audio", "image", "video", "document", "default", "text", "html"]);

const nullablePosKb = z.union([z.coerce.number().int().min(1).max(500_000_000), z.null()]);
const nullableChunkMinutes = z.union([z.coerce.number().int().min(1).max(120), z.null()]);

const putRowSchema = z.object({
  mediaType: mediaTypeEnum,
  maxFileSizeKB: z.coerce.number().int().min(1).max(500_000_000),
  videoChunkMinutes: nullableChunkMinutes,
  audioChunkMinutes: nullableChunkMinutes,
  maxLargeVideoKb: nullablePosKb,
  maxLargeAudioKb: nullablePosKb,
  maxSummaryChars: z.coerce.number().int().min(1).max(65_000),
  textImagemMin: z.coerce.number().int().min(0).max(65_000),
  compressBeforeAI: z.coerce.number().int().min(0).max(1),
});

const REQUIRED_MEDIA_TYPES: MediaSettingsMediaTypeDb[] = [
  "default",
  "audio",
  "image",
  "video",
  "document",
  "text",
  "html",
];

const putBodySchema = z
  .object({
    rows: z.array(putRowSchema).min(1),
  })
  .refine(
    (o) => {
      const s = new Set(o.rows.map((r) => r.mediaType));
      return s.size === REQUIRED_MEDIA_TYPES.length && REQUIRED_MEDIA_TYPES.every((t) => s.has(t));
    },
    { message: "rows_must_include_all_media_types" }
  );

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/subscription-plans/:planId/media-settings", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const planId = z.coerce.number().int().positive().safeParse((req.params as { planId: string }).planId);
    if (!planId.success) {
      return reply.code(400).send({ error: "invalid_id" });
    }
    try {
      const data: AdminMediaSettingsResponse = await getPlanMediaSettingsAdmin(planId.data);
      return data;
    } catch (e) {
      if (e instanceof Error && e.message === "plan_not_found") {
        return reply.code(404).send({ error: "not_found" });
      }
      throw e;
    }
  });

  app.put("/api/admin/subscription-plans/:planId/media-settings", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const planId = z.coerce.number().int().positive().safeParse((req.params as { planId: string }).planId);
    if (!planId.success) {
      return reply.code(400).send({ error: "invalid_id" });
    }
    const parsed = putBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const rows = parsed.data.rows.map((r) => ({
      mediaType: r.mediaType as MediaSettingsMediaTypeDb,
      maxFileSizeKB: r.maxFileSizeKB,
      videoChunkMinutes: r.videoChunkMinutes,
      audioChunkMinutes: r.audioChunkMinutes,
      maxLargeVideoKb: r.maxLargeVideoKb,
      maxLargeAudioKb: r.maxLargeAudioKb,
      maxSummaryChars: r.maxSummaryChars,
      textImagemMin: r.textImagemMin,
      compressBeforeAI: (r.compressBeforeAI === 1 ? 1 : 0) as 0 | 1,
    }));
    try {
      await upsertPlanMediaSettingsAdmin(planId.data, rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "plan_not_found") {
        return reply.code(404).send({ error: "not_found" });
      }
      if (msg === "media_settings_schema_outdated") {
        return reply.code(503).send({
          error: "schema_outdated",
          message:
            "O banco ainda não tem o esquema esperado de media_settings. Aplique em ordem: docs/migrations/013_media_settings_chunk_large_text_html.sql, 014_media_settings_drop_legacy_large.sql (se aplicável) e docs/migrations/019_media_settings_chunk_minutes.sql (chunk em minutos).",
        });
      }
      if (msg === "missing_media_type" || msg === "invalid_media_type") {
        return reply.code(400).send({ error: "invalid_rows" });
      }
      if (msg.startsWith("invalid_")) {
        return reply.code(400).send({ error: msg });
      }
      throw e;
    }
    return reply.code(204).send();
  });
};

export default plugin;
