import type { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { resolveUserId } from "../lib/userContext.js";
import { z } from "zod";
import { compromissosDoUsuario, reunioesSemResultado, type PerguntaResultado } from "../services/lembreteService.js";
import { lembretesFinanceiroDoUsuario } from "../services/finLembreteService.js";

/**
 * Sino do cabeçalho.
 * - Aviso: pergunta monitorada cuja resposta mudou (aviso_historico) depois da última abertura do painel.
 * - Lembrete: compromisso (próximos 7 dias) de categoria com lembrete ligado em que o usuário é destinatário;
 *   conta no número quando entra no prazo do primeiro lembrete (ex.: 1 dia antes), mesmo que o e-mail ainda não tenha saído.
 * - Resultado: compromisso que já terminou (até 7 dias) sem memo de resultado ligado — "Registrar" ou "Não precisa".
 * Número do sino = avisos não lidos + lembretes do período + resultados pendentes. Abrir o painel zera só os avisos.
 */

const PREFS: PerguntaResultado[] = ["sempre", "com_pessoas", "quando_pedir", "nunca"];
const lerPref = (v: unknown): PerguntaResultado => (PREFS.includes(v as PerguntaResultado) ? (v as PerguntaResultado) : "sempre");

type AvisoRow = { id: number; avisoId: number; descricao: string; texto: string; quando: Date | string; lido: boolean };
type LembreteRow = {
  id: string;
  memoId: number;
  categoria: string | null;
  /** Grupo de origem (o sino mostra numa etiqueta). */
  grupo: string | null;
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
    const [uRows] = await pool.query<{ email: string | null; pref: string | null }[]>(
      `SELECT email, pergunta_resultado AS "pref" FROM users WHERE id = ?`,
      [userId]
    );
    const compromissos = await compromissosDoUsuario(userId, uRows[0]?.email ?? "", 7);
    const pref = lerPref(uRows[0]?.pref);
    const reunioes = await reunioesSemResultado(userId, uRows[0]?.email ?? "", pref).catch(() => []);
    const ids = [...new Set([...compromissos.map((c) => c.memoId), ...reunioes.map((r) => r.memoId)])];
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
      grupo: c.grupo,
      titulo: infoMemo.get(c.memoId)?.titulo ?? null,
      texto: infoMemo.get(c.memoId)?.texto ?? null,
      momento: c.momento,
      noPrazo: c.noPrazo,
    }));
    // Contas a pagar/receber (financeiro): atrasadas e as que vencem nos dias do lembrete — todas contam no número
    const fin = await lembretesFinanceiroDoUsuario(userId).catch(() => []);
    for (const f of fin) {
      lembretes.push({
        id: f.id,
        memoId: 0,
        categoria: f.atrasado ? "Conta atrasada" : "Conta",
        grupo: f.espaco,
        titulo: f.titulo,
        texto: f.texto,
        momento: new Date(`${f.vencimento}T12:00:00-03:00`),
        noPrazo: true,
      });
    }
    lembretes.sort((a, b) => iso(a.momento).localeCompare(iso(b.momento)));
    const lembretesNoPrazo = lembretes.filter((l) => l.noPrazo).length;

    const avisosNaoLidos = avisos.filter((a) => !a.lido).length;
    const resultados = reunioes.slice(0, 20).map((r) => ({
      memoId: r.memoId,
      categoria: r.categoria,
      grupo: r.grupo,
      titulo: infoMemo.get(r.memoId)?.titulo ?? null,
      texto: infoMemo.get(r.memoId)?.texto ?? null,
      momento: iso(r.momento),
    }));
    return reply.send({
      total: avisosNaoLidos + lembretesNoPrazo + resultados.length,
      perguntaResultado: pref,
      resultados,
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
        grupo: l.grupo,
        titulo: l.titulo,
        texto: l.texto,
        momento: iso(l.momento),
        noPrazo: l.noPrazo,
      })),
    });
  });

  // POST /api/sino/lido — marca os avisos como lidos (abrir o painel)
  // GET /api/lembretes/meus?dias=N — compromissos do usuário nos próximos N dias (aba Lembretes de Meus avisos).
  // O botão "Mais" da tela pede de 7 em 7 dias; limite de 365.
  app.get("/api/lembretes/meus", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const diasRaw = Number((req.query as { dias?: string }).dias ?? 7);
    const dias = Math.min(365, Math.max(1, Number.isFinite(diasRaw) ? Math.floor(diasRaw) : 7));
    const [uRows] = await pool.query<{ email: string | null }[]>(`SELECT email FROM users WHERE id = ?`, [userId]);
    const compromissos = await compromissosDoUsuario(userId, uRows[0]?.email ?? "", dias);
    const ids = [...new Set(compromissos.map((c) => c.memoId))];
    const infoMemo = new Map<number, { titulo: string | null; texto: string | null }>();
    if (ids.length) {
      const [mRows] = await pool.query<{ id: number; titulo: string | null; texto: string | null }[]>(
        `SELECT id, NULLIF(titulo_curto, '') AS titulo, LEFT(mediatext, 160) AS texto FROM memos WHERE id = ANY(?::int[])`,
        [ids]
      );
      for (const m of mRows) infoMemo.set(Number(m.id), { titulo: m.titulo, texto: m.texto });
    }
    return reply.send({
      dias,
      lembretes: compromissos.map((c) => ({
        id: `${c.regraId}:${c.memoId}:${c.momento.getTime()}`,
        memoId: c.memoId,
        categoria: c.grupo ? `${c.categoria} · ${c.grupo}` : c.categoria,
        titulo: infoMemo.get(c.memoId)?.titulo ?? null,
        texto: infoMemo.get(c.memoId)?.texto ?? null,
        momento: iso(c.momento),
        hora: c.hora,
        noPrazo: c.noPrazo,
        envios: c.envios.map((e) => ({ enviarEm: iso(e.enviarEm), situacao: e.situacao })),
      })),
    });
  });

  // POST /api/sino/resultado/:memoId/dispensar — "Não precisa": não pergunta mais o resultado deste compromisso
  app.post("/api/sino/resultado/:memoId/dispensar", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const memoId = z.coerce.number().int().positive().safeParse((req.params as { memoId: string }).memoId);
    if (!memoId.success) return reply.code(400).send({ error: "invalid" });
    await pool.query(
      `INSERT INTO reuniao_resultado_dispensa (userid, memoid) VALUES (?, ?) ON CONFLICT DO NOTHING`,
      [userId, memoId.data]
    );
    return reply.send({ ok: true });
  });

  // PUT /api/sino/pergunta-resultado — sempre | com_pessoas | nunca
  app.put("/api/sino/pergunta-resultado", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const b = z.object({ valor: z.enum(["sempre", "com_pessoas", "quando_pedir", "nunca"]) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_body" });
    await pool.query(`UPDATE users SET pergunta_resultado = ? WHERE id = ?`, [b.data.valor, userId]);
    return reply.send({ ok: true });
  });

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
