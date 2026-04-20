import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { guessMimeFromFilename } from "../lib/media.js";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import { uploadsAbsolutePath } from "../paths.js";
import { canAccessMemoMediaForDownload } from "../services/memoService.js";

/**
 * GET /media/:authorUserId/:fileName — exige cookie JWT.
 * Autor do memo, membro do grupo (memo com groupId) ou admin podem baixar.
 */
const plugin: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { authorId: string; fileName: string } }>(
    "/media/:authorId/:fileName",
    async (req, reply) => {
      const viewerId = await resolveUserId(req);
      if (viewerId === null) {
        return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
      }
      const authorUserId = Number(req.params.authorId);
      if (!Number.isFinite(authorUserId) || authorUserId < 1) {
        return reply.code(400).send({ error: "bad_request" });
      }
      const fileName = req.params.fileName;
      if (!fileName || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
        return reply.code(400).send({ error: "bad_request" });
      }

      const isAdmin = await getUserIsAdmin(viewerId);
      const allowed = await canAccessMemoMediaForDownload({
        viewerId,
        authorUserId,
        storedFileName: fileName,
        isAdmin,
      });
      if (!allowed) {
        return reply.code(403).send({ error: "forbidden", message: "Sem permissão para este arquivo." });
      }

      const base = path.resolve(uploadsAbsolutePath(), String(authorUserId));
      const abs = path.resolve(base, fileName);
      const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
      if (abs !== base && !abs.startsWith(baseWithSep)) {
        return reply.code(400).send({ error: "bad_request" });
      }

      try {
        await access(abs);
      } catch {
        return reply.code(404).send({ error: "not_found" });
      }

      const stream = createReadStream(abs);
      reply.type(guessMimeFromFilename(fileName));
      reply.header("Cache-Control", "private, max-age=3600");
      return reply.send(stream);
    }
  );
};

export default plugin;
