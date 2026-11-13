import type { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { resolveUserId } from "../lib/userContext.js";
import { compromissosDoUsuario } from "../services/lembreteService.js";

/**
 * Sino do cabeçalho.
 * - Aviso: pergunta monitorada cuja resposta mudou (aviso_historico) depois da última abertura do painel.
 * - Lembrete: compromisso (próximos 7 dias) de categoria com lembrete ligado em que o usuário é destinatário;
 *   conta no número quando entra no prazo do primeiro lembrete (ex.: 1 dia antes), mesmo que o e-mail ainda não tenha saído.
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
  noPrazo: boolean;
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

    // Compromissos com lembrete ativo para este usuário nos próximos 7 dias (inclui agendas catalogadas antes).
    // Contam no número só os que já entraram no prazo do lembrete (ex.: 1 dia antes).
    const [uRows] = await pool.query<{ email: string | null }[]>(`SELECT email FROM users WHERE id = ?`, [userId]);
    const compromissos = await compromissosDoUsuario(userId, uRows[0]?.email ?? "", 7);
    const ids = [...new Set(compromissos.map((c) => c.memoId))];
    const infoMemo = new Map<number, { titulo: string | null; texto: string | null }>();
    if (ids.length) {
      const [mRows] = await pool.query<{ id: number; titulo: string | null; texto: string | null }[]>(
        `SELECT id, NULLIF(titulo_curto, '') AS titulo, LEFT(mediatext, 160) AS texto FROM memos WHERE id = ANY(?::int[])`,
        [ids]
      );
      for (const m of mRows) infoMemo.set(Number(m.id), { titulo: m.titulo, texto: m.texto });
    }
    const lembretes: LembreteRow[] = compromissos.map((c) => ({
      id: `${c.regraId}:${c.memoId}:${c.momento.getTime()}`,
      memoId: c.memoId,
      categoria: c.categoria,
      titulo: infoMemo.get(c.memoId)?.titulo ?? null,
      texto: infoMemo.get(c.memoId)?.texto ?? null,
      momento: c.momento,
      noPrazo: c.noPrazo,
    }));
    const lembretesNoPrazo = lembretes.filter((l) => l.noPrazo).length;

    const avisosNaoLidos = avisos.filter((a) => !a.lido).length;
    return reply.send({
      total: avisosNaoLidos + lembretesNoPrazo,
      avisosNaoLidos,
      lembretesAtivos: lembretesNoPrazo,
      lembretesProximos: lembretes.length,
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
        noPrazo: l.noPrazo,
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
