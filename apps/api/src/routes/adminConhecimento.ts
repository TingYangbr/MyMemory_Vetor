import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { requireAdmin } from "../lib/adminContext.js";
import { createKnowledgeTextMemo, REVIEW_FLOW_CONHECIMENTO } from "../services/memoService.js";

/**
 * Importação de conhecimento em trechos (ex.: Manual MyMemory → docs/manual-chunks/chunks-mymemory-operacional.jsonl).
 * Cada trecho vira um memo de texto no grupo escolhido, já com categoria, campos e vetores —
 * sem IA de extração. Reimportar com "substituir" desativa só os trechos anteriores da MESMA ORIGEM
 * (nome do manual) na mesma categoria — assim vários manuais podem dividir uma categoria sem se apagarem.
 * Ordem segura: cria todos os trechos novos primeiro e só então desativa os anteriores (pelos ids
 * lidos antes). Se algum trecho falhar, os novos são desativados e o manual anterior fica inteiro.
 */

const MARCA_LIKE = `%"reviewFlow":"${REVIEW_FLOW_CONHECIMENTO}"%`;

/** Escapa %, _ e \ para uso literal em LIKE. */
const escLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);
/** Padrão LIKE que casa o par "origem":"<valor>" gravado em mediaMetadata (JSON). */
const origemLike = (origem: string) => `%"origem":${escLike(JSON.stringify(origem))}%`;

const trechoSchema = z.object({
  id: z.string().min(1).max(200),
  texto: z.string().min(1).max(20000),
  titulo: z.string().max(500).optional(),
  secao_num: z.number().int().optional(),
  secao: z.string().max(300).optional(),
  tela: z.string().max(300).optional(),
  subsecao: z.string().max(300).optional(),
  rota: z.string().max(500).optional(),
  perfil: z.string().max(50).optional(),
  tipo: z.string().max(50).optional(),
  versao: z.string().max(50).optional(),
}).passthrough();

const importarSchema = z.object({
  groupId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  substituir: z.boolean().default(true),
  origem: z.string().trim().min(1).max(200).default("manual"),
  trechos: z.array(trechoSchema).min(1).max(2000),
});

const normNome = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function categoriaDoGrupo(categoryId: number, groupId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, groupid FROM categories WHERE id = ? AND isactive = 1 AND (groupid = ? OR groupid IS NULL)`,
    [categoryId, groupId]
  );
  return (rows as Record<string, unknown>[])[0] as { id: number; name: string; groupId: number | null } | undefined;
}

/** Executa tarefas com no máximo `n` em paralelo (vetores da busca semântica chamam a API de embeddings). */
async function emParalelo<T>(itens: T[], n: number, fn: (item: T, idx: number) => Promise<void>) {
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      await fn(itens[i], i);
    }
  }));
}

const plugin: FastifyPluginAsync = async (app) => {
  // GET /api/admin/conhecimento?groupId=N — categorias disponíveis e conjuntos já importados no grupo
  app.get("/api/admin/conhecimento", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const groupId = z.coerce.number().int().positive().safeParse((req.query as { groupId?: string }).groupId);
    if (!groupId.success) return reply.code(400).send({ error: "invalid_groupId" });

    const [cats] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, groupid FROM categories
       WHERE isactive = 1 AND (groupid = ? OR groupid IS NULL)
       ORDER BY (groupid IS NULL), name`,
      [groupId.data]
    );
    const [imps] = await pool.query<RowDataPacket[]>(
      `SELECT category,
              COALESCE(substring(mediametadata from '"origem":"([^"]*)"'), 'manual') AS origem,
              COUNT(*)::int AS total, MAX(createdat) AS "atualizadoEm",
              MAX(substring(mediametadata from '"versao":"([^"]*)"')) AS versao
       FROM memos
       WHERE groupid = ? AND isactive = 1 AND mediametadata LIKE ?
       GROUP BY category, 2 ORDER BY category, 2`,
      [groupId.data, MARCA_LIKE]
    );
    return {
      categorias: (cats as Record<string, unknown>[]).map((c) => ({ id: c.id, name: c.name, global: c.groupId == null })),
      importados: imps,
    };
  });

  // POST /api/admin/conhecimento/importar — cria os memos dos trechos
  app.post("/api/admin/conhecimento/importar", { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const parsed = importarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: parsed.error.issues[0]?.message ?? "Dados inválidos." });
    }
    const { groupId, categoryId, substituir, origem, trechos } = parsed.data;

    const [grp] = await pool.query<RowDataPacket[]>(`SELECT id FROM groups WHERE id = ?`, [groupId]);
    if (!(grp as unknown[]).length) return reply.code(404).send({ error: "group_not_found", message: "Grupo não encontrado." });
    const categoria = await categoriaDoGrupo(categoryId, groupId);
    if (!categoria) return reply.code(404).send({ error: "category_not_found", message: "Categoria não disponível para este grupo." });

    // Nomes reais dos campos da categoria (o arquivo usa "Seção", o campo pode ser "Secao")
    const [campos] = await pool.query<RowDataPacket[]>(
      `SELECT name FROM categorycampos WHERE categoryid = ? AND isactive = 1`,
      [categoryId]
    );
    const porNorm = new Map((campos as { name: string }[]).map((c) => [normNome(c.name), c.name]));
    const campo = (nome: string) => porNorm.get(normNome(nome)) ?? nome;

    // ids dos trechos anteriores, lidos ANTES de criar os novos (os novos nunca entram nesta lista)
    let anteriores: number[] = [];
    if (substituir) {
      const [r] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM memos
         WHERE groupid = ? AND category = ? AND isactive = 1 AND mediametadata LIKE ? AND mediametadata LIKE ?`,
        [groupId, categoria.name, MARCA_LIKE, origemLike(origem)]
      );
      anteriores = r.map((x) => Number(x.id));
    }

    const novos: number[] = [];
    const erros: { id: string; erro: string }[] = [];
    await emParalelo(trechos, 4, async (t) => {
      const dados: Record<string, string> = {};
      const por = (nome: string, valor: string | number | undefined | null) => {
        if (valor != null && String(valor).trim()) dados[campo(nome)] = String(valor).trim();
      };
      por("Seção", t.secao ? `${t.secao_num != null ? `${t.secao_num} — ` : ""}${t.secao}` : undefined);
      por("Tela", t.tela);
      por("Rota", t.rota);
      por("Perfil", t.perfil);
      por("Tipo", t.tipo);
      por("Versão", t.versao);
      const keywords = [t.tela, t.subsecao, t.tipo, t.perfil].filter(Boolean).join(", ");
      try {
        const id = await createKnowledgeTextMemo({
          userId: admin,
          groupId,
          categoryId,
          categoryName: categoria.name,
          texto: t.texto,
          keywords: keywords || null,
          dadosEspecificos: dados,
          trechoId: t.id,
          versao: t.versao ?? null,
          origem,
        });
        novos.push(id);
      } catch (err) {
        erros.push({ id: t.id, erro: err instanceof Error ? err.message : String(err) });
      }
    });

    const desativa = async (ids: number[]) => {
      if (!ids.length) return 0;
      const [r] = await pool.query<RowDataPacket[]>(
        `UPDATE memos SET isactive = 0 WHERE id = ANY(?::int[]) AND isactive = 1 RETURNING id`,
        [ids]
      );
      return (r as unknown[]).length;
    };

    // falhou algum trecho e havia manual anterior: desfaz os novos e mantém o anterior inteiro
    if (erros.length && anteriores.length) {
      await desativa(novos);
      req.log.warn({ groupId, categoryId, erros: erros.length }, "[conhecimento] importação desfeita; anterior mantido");
      return { criados: 0, desativados: 0, erros, anteriorMantido: true };
    }

    const desativados = await desativa(anteriores);
    req.log.info({ groupId, categoryId, criados: novos.length, desativados, erros: erros.length }, "[conhecimento] importação");
    return { criados: novos.length, desativados, erros };
  });

  // DELETE /api/admin/conhecimento?groupId=N&category=Nome[&origem=Manual] — desativa os trechos
  // importados da categoria (só os da origem informada, quando houver)
  app.delete("/api/admin/conhecimento", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin == null) return;
    const q = req.query as { groupId?: string; category?: string; origem?: string };
    const groupId = z.coerce.number().int().positive().safeParse(q.groupId);
    if (!groupId.success || !q.category) return reply.code(400).send({ error: "invalid_query" });
    const filtraOrigem = typeof q.origem === "string" && q.origem !== "";
    const [r] = await pool.query<RowDataPacket[]>(
      `UPDATE memos SET isactive = 0
       WHERE groupid = ? AND category = ? AND isactive = 1 AND mediametadata LIKE ?${filtraOrigem ? " AND mediametadata LIKE ?" : ""}
       RETURNING id`,
      filtraOrigem ? [groupId.data, q.category, MARCA_LIKE, origemLike(q.origem!)] : [groupId.data, q.category, MARCA_LIKE]
    );
    return { desativados: (r as unknown[]).length };
  });
};

export default plugin;
