import type { FastifyPluginAsync } from "fastify";
import { resolveUserId } from "../lib/userContext.js";
import { guessMimeFromFilename } from "../lib/media.js";
import { abrirObjetoS3, tryExtractMemoS3KeyFromPublicUrl } from "../services/s3MediaStorage.js";

/**
 * GET /api/media-revisao?url=… — arquivo recém-enviado mostrado na tela de revisão do Catalogar
 * (imagem, áudio, vídeo), servido pelo servidor com as credenciais do S3. Assim o bucket pode ficar
 * privado. Só quem enviou (pasta memos/{seu id}/) pode abrir.
 */
const plugin: FastifyPluginAsync = async (app) => {
  app.get("/api/media-revisao", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    const url = String((req.query as { url?: string }).url ?? "");
    const key = url ? tryExtractMemoS3KeyFromPublicUrl(url) : null;
    if (!key || key.includes("..")) return reply.code(400).send({ error: "bad_request" });
    if (!key.startsWith(`memos/${userId}/`)) return reply.code(403).send({ error: "forbidden" });

    const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
    try {
      const obj = await abrirObjetoS3(key, range);
      reply.header("Cache-Control", "private, max-age=3600");
      reply.header("Accept-Ranges", "bytes");
      if (obj.contentLength != null) reply.header("Content-Length", String(obj.contentLength));
      if (obj.contentRange) {
        reply.header("Content-Range", obj.contentRange);
        reply.code(206);
      }
      reply.type(obj.contentType || guessMimeFromFilename(key.split("/").pop() ?? ""));
      return reply.send(obj.stream);
    } catch (e) {
      const nome = (e as { name?: string }).name;
      if (nome === "NoSuchKey") return reply.code(404).send({ error: "not_found" });
      if (nome === "InvalidRange") return reply.code(416).send({ error: "invalid_range" });
      throw e;
    }
  });
};

export default plugin;
