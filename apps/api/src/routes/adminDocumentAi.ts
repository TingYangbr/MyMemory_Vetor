import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import { getAdminDocumentRoutingJson, saveAdminDocumentRoutingJson } from "../services/documentRoutingService.js";

const putBody = z.object({
  documentRoutingJson: z.string().min(2).max(2_000_000),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/document-ai-routing", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    try {
      const { json, usingDefaults } = await getAdminDocumentRoutingJson();
      return { json, usingDefaults };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("documentRoutingJson") || msg.includes("Unknown column")) {
        return reply.code(503).send({
          error: "schema_outdated",
          message: "Execute docs/migrations/015_ai_config_document_routing.sql no MySQL.",
        });
      }
      throw e;
    }
  });

  app.put("/api/admin/document-ai-routing", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const parsed = putBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    try {
      JSON.parse(parsed.data.documentRoutingJson);
    } catch {
      return reply.code(400).send({ error: "invalid_json", message: "JSON inválido." });
    }
    try {
      await saveAdminDocumentRoutingJson(parsed.data.documentRoutingJson);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_routing_json") {
        return reply.code(400).send({
          error: "invalid_routing_json",
          message: "O JSON deve ter pelo menos preprocess (array).",
        });
      }
      if (msg.includes("documentRoutingJson") || msg.includes("Unknown column")) {
        return reply.code(503).send({
          error: "schema_outdated",
          message: "Execute docs/migrations/015_ai_config_document_routing.sql no MySQL.",
        });
      }
      throw e;
    }
    return reply.code(204).send();
  });
};

export default plugin;
