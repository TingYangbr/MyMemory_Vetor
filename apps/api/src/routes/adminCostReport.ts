import type { FastifyPluginAsync } from "fastify";
import type { AdminCostReportResponse } from "@mymemory/shared";
import { requireAdmin } from "../lib/adminContext.js";
import { buildAdminCostReport } from "../services/adminCostReportService.js";

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/cost-report", async (req, reply) => {
    const adminId = await requireAdmin(req, reply);
    if (adminId === null) return;

    const q = req.query as Record<string, string | undefined>;
    const dateFrom = q.dateFrom?.trim() ?? "";
    const dateTo = q.dateTo?.trim() ?? "";
    const mediaType = q.mediaType;

    if (!dateFrom || !dateTo) {
      return reply.code(400).send({
        error: "invalid_query",
        message: "Informe dateFrom e dateTo (YYYY-MM-DD).",
      });
    }

    try {
      const body: AdminCostReportResponse = await buildAdminCostReport({
        dateFrom,
        dateTo,
        mediaType,
      });
      return body;
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      if (code === "invalid_dates") {
        return reply.code(400).send({
          error: "invalid_dates",
          message: "Datas inválidas. Use YYYY-MM-DD.",
        });
      }
      if (code === "date_order") {
        return reply.code(400).send({
          error: "date_order",
          message: "A data inicial não pode ser posterior à data final.",
        });
      }
      throw e;
    }
  });
};

export default plugin;
