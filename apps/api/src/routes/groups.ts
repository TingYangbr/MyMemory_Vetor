import type { FastifyPluginAsync } from "fastify";
import type { CreateGroupResponse, GroupPlansResponse } from "@mymemory/shared";
import { z } from "zod";
import { resolveUserId } from "../lib/userContext.js";
import { createGroupForOwner } from "../services/groupService.js";
import { listActiveGroupPlansPublic } from "../services/subscriptionPlanAdminService.js";

const createBody = z.object({
  planId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Informe o nome do grupo.").max(255),
  description: z.string().trim().max(8000).optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/group-plans", async () => {
    const plans = await listActiveGroupPlansPublic();
    const body: GroupPlansResponse = { plans };
    return body;
  });

  app.post("/api/groups", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login para criar um grupo." });
    }

    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      });
    }

    try {
      const { groupId, subscriptionId } = await createGroupForOwner({
        userId,
        planId: parsed.data.planId,
        name: parsed.data.name,
        description: parsed.data.description?.length ? parsed.data.description : null,
      });
      const body: CreateGroupResponse = {
        ok: true,
        groupId,
        subscriptionId,
        name: parsed.data.name.trim(),
      };
      return reply.code(201).send(body);
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "invalid_group_plan") {
        return reply.code(400).send({
          error: "invalid_plan",
          message: "Plano de grupo inválido ou inativo.",
        });
      }
      if (code === "duplicate_group_name_owner") {
        return reply.code(409).send({
          error: "duplicate_group_name",
          message:
            "Já existe um grupo seu com este nome. Escolha outro nome ou use a descrição noutro grupo para o distinguir. Donos diferentes podem usar o mesmo nome.",
        });
      }
      throw e;
    }
  });
};

export default plugin;
