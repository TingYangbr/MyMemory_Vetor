import type { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { resolveUserId } from "../lib/userContext.js";

/**
 * Sino do cabeçalho.
 * - Aviso: pergunta monitorada cuja resposta mudou (aviso_historico) depois da última abertura do painel.
 * - Lembrete: lembrete já enviado ao e-mail do usuário cujo compromisso ainda não passou.
 * Número do sino = avisos não lidos + lembretes do período. Abrir o painel zera só os avisos.
 */

type AvisoRow = { id: number; avisoId: number; descricao: string; texto: string; quando: Date | string; lido: boolean };
type LembreteRow = {
  id: string;
  memoId: number;
  categoria: string | null;
  titulo: string | null;
  texto: string | null;
  momento: Date | string;
};

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d));

const plugin: FastifyPluginAsync = async (app) => {
  // GET /api/sino — contagem + itens recentes
  app.get("/api/sino", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const [avisos] = await pool.query<AvisoRow[]>(
      `SELECT h.id, a.id AS "avisoId", a.descricao, h.texto, h.enviadoem AS quando,
              (h.enviadoem <= COALESCE(s.lido_em, 'epoch'::timestamptz)) AS lido
       FROM aviso_historico h
       JOIN avisos a ON a.id = h.avisoid
       LEFT JOIN sino_leitura s ON s.userid = a.userid
       WHERE a.userid = ? AND h.enviadoem > NOW() - INTERVAL '30 days'
       ORDER BY h.enviadoem DESC
       LIMIT 20`,
      [userId]
    );

    // Lembretes enviados a este usuário (pelo e-mail) com compromisso ainda por vir; um por compromisso.
    const [lembretes] = await pool.query<LembreteRow[]>(
      `SELECT DISTINCT ON (le.regraid, le.chave_item, le.momento_alvo)
              le.regraid || ':' || le.chave_item || ':' || EXTRACT(EPOCH FROM le.momento_alvo)::bigint AS id,
              m.id AS "memoId", c.name AS categoria, NULLIF(m.titulo_curto, '') AS titulo,
              LEFT(m.mediatext, 160) AS texto, le.momento_alvo AS momento
       FROM lembretes_enviados le
       JOIN users u ON u.id = ?
       JOIN lembrete_regras r ON r.id = le.regraid
       LEFT JOIN categories c ON c.id = r.categoryid
       JOIN memos m ON m.id::text = le.chave_item AND m.isactive = 1
       WHERE le.situacao = 'enviado'
         AND le.momento_alvo > NOW()
         AND u.email IS NOT NULL AND u.email <> ''
         AND POSITION(LOWER(u.email) IN LOWER(COALESCE(le.destino, ''))) > 0
       ORDER BY le.regraid, le.chave_item, le.momento_alvo
       LIMIT 50`,
      [userId]
    );
    lembretes.sort((x, y) => new Date(x.momento).getTime() - new Date(y.momento).getTime());

    const avisosNaoLidos = avisos.filter((a) => !a.lido).length;
    return reply.send({
      total: avisosNaoLidos + lembretes.length,
      avisosNaoLidos,
      lembretesAtivos: lembretes.length,
      avisos: avisos.map((a) => ({
        id: a.id,
        avisoId: a.avisoId,
        descricao: a.descricao,
        texto: a.texto,
        quando: iso(a.quando),
        lido: Boolean(a.lido),
      })),
      lembretes: lembretes.slice(0, 20).map((l) => ({
        id: String(l.id),
        memoId: l.memoId,
        categoria: l.categoria,
        titulo: l.titulo,
        texto: l.texto,
        momento: iso(l.momento),
      })),
    });
  });

  // POST /api/sino/lido — marca os avisos como lidos (abrir o painel)
  app.post("/api/sino/lido", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    await pool.query(
      `INSERT INTO sino_leitura (userid, lido_em) VALUES (?, NOW())
       ON CONFLICT (userid) DO UPDATE SET lido_em = EXCLUDED.lido_em`,
      [userId]
    );
    return reply.send({ ok: true });
  });
};

export default plugin;
