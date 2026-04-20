import type { FastifyPluginAsync } from "fastify";
import type { HardDeleteSoftDeletedMonthResponse, SoftDeletedMemosMonthlySummaryResponse } from "@mymemory/shared";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import {
  hardDeleteInactiveMemosForMonth,
  listSoftDeletedMemosByMonth,
} from "../services/adminSoftDeletedMemosService.js";

const bodyMonth = z.object({
  month: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido (use YYYY-MM)."),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/soft-deleted-memos/monthly-summary", async (req, reply) => {
    const adminId = await requireAdmin(req, reply);
    if (adminId === null) return;
    const rows = await listSoftDeletedMemosByMonth();
    const body: SoftDeletedMemosMonthlySummaryResponse = { ok: true, rows };
    return body;
  });

  app.post("/api/admin/soft-deleted-memos/hard-delete-month", async (req, reply) => {
    const adminId = await requireAdmin(req, reply);
    if (adminId === null) return;
    const parsed = bodyMonth.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Corpo inválido.",
      });
    }
    try {
      const result = await hardDeleteInactiveMemosForMonth(parsed.data.month);
      const body: HardDeleteSoftDeletedMonthResponse = { ok: true, ...result };
      return body;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "invalid_month") {
        return reply.code(400).send({ error: "invalid_month", message: "Mês inválido." });
      }
      throw e;
    }
  });
};

export default plugin;
