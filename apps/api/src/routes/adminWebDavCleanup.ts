import type { FastifyPluginAsync } from "fastify";
import type { FileStat } from "webdav";
import { createClient } from "webdav";
import { z } from "zod";
import { requireAdmin } from "../lib/adminContext.js";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { resolveGroupStorageDefault } from "../services/groupStorageService.js";

const bodySchema = z.object({
  groupId: z.number().int().positive(),
  confirm: z.boolean().optional().default(false),
});

const plugin: FastifyPluginAsync = async (app) => {
  /**
   * Lista (dry-run) ou deleta arquivos órfãos no WebDAV de um grupo.
   * Órfão = arquivo presente no WebDAV que não consta em nenhum memo ativo do grupo.
   *
   * POST /api/admin/storage/webdav-orphan-cleanup
   * Body: { groupId: number, confirm?: boolean }
   *   confirm=false (padrão): apenas lista os órfãos, sem deletar
   *   confirm=true: deleta os órfãos e retorna contadores
   */
  app.post("/api/admin/storage/webdav-orphan-cleanup", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Corpo inválido.",
      });
    }
    const { groupId, confirm } = parsed.data;

    // 1. Busca config WebDAV padrão do grupo (já com senha descriptografada)
    const cfg = await resolveGroupStorageDefault(groupId, null);
    if (!cfg) {
      return reply.code(404).send({ error: "Grupo não tem configuração de armazenamento padrão ativa." });
    }
    if (cfg.tipo !== "WEBDAV") {
      return reply.code(400).send({ error: `Configuração padrão do grupo é do tipo "${cfg.tipo}", não WEBDAV.` });
    }

    // 2. Cria client WebDAV
    const clientOpts = cfg.username && cfg.password
      ? { username: cfg.username, password: cfg.password }
      : {};
    const client = createClient(cfg.url, clientOpts);

    // 3. Lista arquivos na pasta configurada (sem recursão — todos os memos vão para o mesmo nível)
    const prefix = (cfg.pathPrefix ?? "").trim().replace(/^\//, "").replace(/\/$/, "");
    const dir = prefix ? `/${prefix}` : "/";

    let items: FileStat[];
    try {
      items = (await client.getDirectoryContents(dir)) as FileStat[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Falha ao listar WebDAV (${dir}): ${msg}` });
    }

    const files = items.filter((i) => i.type === "file");

    // 4. Busca todas as URLs de mídia de memos ativos do grupo
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT mediaImageUrl    AS url FROM memos WHERE groupid = ? AND isactive = TRUE AND mediaImageUrl    IS NOT NULL
       UNION ALL
       SELECT mediaAudioUrl    AS url FROM memos WHERE groupid = ? AND isactive = TRUE AND mediaAudioUrl    IS NOT NULL
       UNION ALL
       SELECT mediaVideoUrl    AS url FROM memos WHERE groupid = ? AND isactive = TRUE AND mediaVideoUrl    IS NOT NULL
       UNION ALL
       SELECT mediaDocumentUrl AS url FROM memos WHERE groupid = ? AND isactive = TRUE AND mediaDocumentUrl IS NOT NULL`,
      [groupId, groupId, groupId, groupId]
    );

    const dbUrls = new Set<string>(rows.map((r) => String(r.url)));

    // 5. Identifica órfãos: arquivo no WebDAV cuja URL completa não existe no banco
    const baseUrl = cfg.url.replace(/\/$/, "");
    const orphans: { remotePath: string; fullUrl: string; sizeBytes: number }[] = [];

    for (const file of files) {
      const fullUrl = `${baseUrl}${file.filename}`;
      if (!dbUrls.has(fullUrl)) {
        orphans.push({ remotePath: file.filename, fullUrl, sizeBytes: file.size ?? 0 });
      }
    }

    // 6. Dry-run: apenas retorna a lista
    if (!confirm) {
      return {
        dryRun: true,
        webdavDir: dir,
        totalWebDavFiles: files.length,
        activeMemosUrls: dbUrls.size,
        orphansFound: orphans.length,
        orphans,
      };
    }

    // 7. Deleta os órfãos um a um, acumulando erros sem interromper
    const deleted: string[] = [];
    const errors: { file: string; error: string }[] = [];

    for (const orphan of orphans) {
      try {
        await client.deleteFile(orphan.remotePath);
        deleted.push(orphan.fullUrl);
      } catch (err) {
        errors.push({
          file: orphan.fullUrl,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      dryRun: false,
      webdavDir: dir,
      totalWebDavFiles: files.length,
      activeMemosUrls: dbUrls.size,
      orphansFound: orphans.length,
      deleted: deleted.length,
      errors,
    };
  });
};

export default plugin;
