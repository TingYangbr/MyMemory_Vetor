import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import { createUserInvite, listUserInvites } from "../services/userInviteAdminService.js";

const postBody = z.object({
  email: z.string().trim().email("E-mail inválido."),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/admin/user-invites", async (req, reply) => {
    if ((await requireAdmin(req, reply)) == null) return;
    const invites = await listUserInvites();
    return { invites };
  });

  app.post("/api/admin/user-invites", async (req, reply) => {
    const adminUserId = await requireAdmin(req, reply);
    if (adminUserId == null) return;
    const parsed = postBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      });
    }
    try {
      const result = await createUserInvite({
        adminUserId,
        emailRaw: parsed.data.email,
      });
      return reply.code(201).send(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "invalid_email") {
        return reply.code(400).send({ error: "invalid_email", message: "E-mail inválido." });
      }
      throw e;
    }
  });
};

export default plugin;
