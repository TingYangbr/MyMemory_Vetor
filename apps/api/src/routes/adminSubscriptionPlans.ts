import type { FastifyPluginAsync } from "fastify";
import type { SubscriptionPlansListResponse } from "@mymemory/shared";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import {
  createSubscriptionPlanAdmin,
  deleteSubscriptionPlanAdmin,
  listSubscriptionPlansAdmin,
  updateSubscriptionPlanAdmin,
} from "../services/subscriptionPlanAdminService.js";

const planTypeEnum = z.enum(["individual", "group"]);

const patchBody = z
  .object({
    name: z.string().min(1).max(100).optional(),
    planType: planTypeEnum.optional(),
    price: z.coerce.number().min(0).optional(),
    maxMemos: z.coerce.number().int().min(0).optional(),
    maxStorageGB: z.coerce.number().min(0).optional(),
    maxMembers: z.union([z.coerce.number().int().min(1), z.null()]).optional(),
    durationDays: z.union([z.coerce.number().int().min(1), z.null()]).optional(),
    isActive: z.coerce.number().int().min(0).max(1).optional(),
    monthlyApiCredits: z.union([z.coerce.number().min(0), z.null()]).optional(),
    monthlyDownloadLimitGB: z.union([z.coerce.number().min(0), z.null()]).optional(),
    supportLargeAudio: z.coerce.number().int().min(0).max(1).optional(),
    supportLargeVideo: z.coerce.number().int().min(0).max(1).optional(),
  })
  .strict();

const createBody = z.object({
  name: z.string().min(1).max(100),
  planType: planTypeEnum.default("individual"),
  price: z.coerce.number().min(0).default(0),
  maxMemos: z.coerce.number().int().min(0).default(1000),
  maxStorageGB: z.coerce.number().min(0).default(1),
  maxMembers: z.union([z.coerce.number().int().min(1), z.null()]).optional().default(null),
  durationDays: z.union([z.coerce.number().int().min(1), z.null()]).optional().default(null),
  isActive: z.coerce.number().int().min(0).max(1).default(1),
  monthlyApiCredits: z.union([z.coerce.number().min(0), z.null()]).optional().default(null),
  monthlyDownloadLimitGB: z.union([z.coerce.number().min(0), z.null()]).optional().default(null),
  supportLargeAudio: z.coerce.number().int().min(0).max(1).default(0),
  supportLargeVideo: z.coerce.number().int().min(0).max(1).default(0),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/subscription-plans", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const plans = await listSubscriptionPlansAdmin();
    const body: SubscriptionPlansListResponse = { plans };
    return body;
  });

  app.post("/api/admin/subscription-plans", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const id = await createSubscriptionPlanAdmin(parsed.data);
    return reply.code(201).send({ id });
  });

  app.patch("/api/admin/subscription-plans/:planId", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const planId = z.coerce.number().int().positive().safeParse((req.params as { planId: string }).planId);
    if (!planId.success) {
      return reply.code(400).send({ error: "invalid_id" });
    }
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    try {
      await updateSubscriptionPlanAdmin(planId.data, parsed.data);
    } catch (e) {
      if (e instanceof Error && e.message === "plan_not_found") {
        return reply.code(404).send({ error: "not_found" });
      }
      throw e;
    }
    return { ok: true };
  });

  app.delete("/api/admin/subscription-plans/:planId", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const planId = z.coerce.number().int().positive().safeParse((req.params as { planId: string }).planId);
    if (!planId.success) {
      return reply.code(400).send({ error: "invalid_id" });
    }
    try {
      await deleteSubscriptionPlanAdmin(planId.data);
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === "plan_not_found") {
          return reply.code(404).send({ error: "not_found", message: "Plano não encontrado." });
        }
        if (e.message === "plan_has_active_subscriptions") {
          return reply.code(409).send({
            error: "plan_has_active_subscriptions",
            message: "Não é possível excluir: existem assinaturas ativas ligadas a este plano.",
          });
        }
        if (e.message === "plan_has_subscriptions") {
          return reply.code(409).send({
            error: "plan_has_subscriptions",
            message:
              "Não é possível excluir: ainda existem assinaturas (mesmo inativas) ligadas a este plano no banco.",
          });
        }
      }
      throw e;
    }
    return { ok: true };
  });
};

export default plugin;
