/**
 * Relações entre memos: "a ata é resultado da reunião" (origem → destino, com um tipo).
 *
 * A ligação é explícita e gravada (memo_relacoes). Nasce de dois jeitos, sempre com o "sim" do usuário:
 *  - manual: "Concluir e registrar resultado" na reunião abre o Catalogar e, ao salvar, liga e conclui;
 *  - sugestão: logo depois de salvar um memo, a IA procura entre os compromissos próximos (categorias
 *    atualizáveis com campo de data, de 7 dias atrás até amanhã) o que este memo parece ser resultado.
 * Semelhança semântica só sugere; nunca liga sozinha.
 */
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { invokeLLM } from "../lib/invokeLlm.js";
import { assertUserWorkspaceGroupAccess } from "./memoContextService.js";
import { alterarMemo, obterMemoAlteravel } from "./memoAlteracaoService.js";

export interface MemoRelacaoItem {
  id: number;
  tipo: string;
  /** "origem": este memo é o resultado do outro; "destino": o outro é resultado deste. */
  lado: "origem" | "destino";
  outroId: number;
  outroCategoria: string | null;
  outroResumo: string;
  criadoEm: string;
}

export interface MemoRelacaoSugestao {
  destinoId: number;
  categoria: string | null;
  resumo: string;
  tipo: string;
  /** O destino é de categoria atualizável e ainda está ativo: dá para concluir junto. */
  podeConcluir: boolean;
  motivo: string;
}

interface MemoBasico {
  id: number;
  userId: number;
  groupId: number | null;
  category: string | null;
  texto: string;
}

async function carregar(memoId: number): Promise<MemoBasico | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, userid, groupid, category, mediatext FROM memos WHERE id = ? AND isactive = 1 LIMIT 1`,
    [memoId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    userId: Number(r.userId ?? r.userid),
    groupId: r.groupId != null || r.groupid != null ? Number(r.groupId ?? r.groupid) : null,
    category: (r.category as string | null) ?? null,
    texto: String(r.mediaText ?? r.mediatext ?? ""),
  };
}

/** O usuário enxerga o memo? (membro do grupo, ou dono do memo pessoal, ou admin) */
async function assertVe(m: MemoBasico, userId: number, isAdmin: boolean): Promise<void> {
  if (isAdmin) return;
  if (m.groupId != null) {
    await assertUserWorkspaceGroupAccess(userId, m.groupId, isAdmin);
    return;
  }
  if (m.userId !== userId) throw new Error("forbidden");
}

export async function criarRelacao(input: {
  userId: number;
  isAdmin: boolean;
  origemId: number;
  destinoId: number;
  tipo: string;
  /** Marca o destino como Concluído (ex.: reunião que acabou de ter o resultado registrado). */
  concluirDestino?: boolean;
}): Promise<{ id: number; concluido: boolean; destino: { categoria: string | null; resumo: string } }> {
  if (input.origemId === input.destinoId) throw new Error("mesmo_memo");
  const [o, d] = await Promise.all([carregar(input.origemId), carregar(input.destinoId)]);
  if (!o || !d) throw new Error("not_found");
  await assertVe(o, input.userId, input.isAdmin);
  await assertVe(d, input.userId, input.isAdmin);
  if ((o.groupId ?? null) !== (d.groupId ?? null)) throw new Error("grupos_diferentes");
  const tipo = input.tipo.trim().toLowerCase().slice(0, 40) || "relacionado";
  const [rows] = await pool.query<{ id: number }[]>(
    `INSERT INTO memo_relacoes (origem_id, destino_id, tipo, criado_por, isactive)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT (origem_id, destino_id, tipo) DO UPDATE SET isactive = 1, criado_por = EXCLUDED.criado_por, criado_em = NOW()
     RETURNING id`,
    [input.origemId, input.destinoId, tipo, input.userId]
  );
  let concluido = false;
  if (input.concluirDestino) {
    try {
      const atual = await obterMemoAlteravel(input.destinoId, input.userId, input.isAdmin);
      await alterarMemo({
        memoId: input.destinoId,
        userId: input.userId,
        isAdmin: input.isAdmin,
        campos: { [atual.campoSituacao]: "Concluído" },
        origem: "situacao",
      });
      concluido = true;
    } catch {
      // Destino não atualizável ou sem permissão de alterar: a ligação fica, só não conclui
    }
  }
  return {
    id: Number(rows[0]?.id),
    concluido,
    // Para a confirmação na tela: "Ligado à Agenda: Reunião com Carlos…"
    destino: { categoria: d.category, resumo: d.texto.replace(/\s+/g, " ").trim().slice(0, 90) },
  };
}

export async function listarRelacoes(userId: number, isAdmin: boolean, memoId: number): Promise<MemoRelacaoItem[]> {
  const m = await carregar(memoId);
  if (!m) throw new Error("not_found");
  await assertVe(m, userId, isAdmin);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id, r.tipo, r.criado_em AS "criadoEm",
            CASE WHEN r.origem_id = ? THEN 'origem' ELSE 'destino' END AS lado,
            o.id AS "outroId", o.category AS "outroCategoria", o.mediatext AS "outroResumo"
     FROM memo_relacoes r
     JOIN memos o ON o.id = CASE WHEN r.origem_id = ? THEN r.destino_id ELSE r.origem_id END
     WHERE r.isactive = 1 AND o.isactive = 1 AND (r.origem_id = ? OR r.destino_id = ?)
     ORDER BY r.criado_em DESC`,
    [memoId, memoId, memoId, memoId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    tipo: String(r.tipo),
    lado: r.lado === "origem" ? "origem" : "destino",
    outroId: Number(r.outroId),
    outroCategoria: (r.outroCategoria as string | null) ?? null,
    outroResumo: String(r.outroResumo ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    criadoEm: r.criadoEm instanceof Date ? r.criadoEm.toISOString() : String(r.criadoEm),
  }));
}

export async function desfazerRelacao(userId: number, isAdmin: boolean, relacaoId: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT origem_id AS "origemId" FROM memo_relacoes WHERE id = ? LIMIT 1`,
    [relacaoId]
  );
  const origemId = rows[0]?.origemId != null ? Number(rows[0].origemId) : null;
  if (origemId == null) throw new Error("not_found");
  const o = await carregar(origemId);
  if (!o) throw new Error("not_found");
  await assertVe(o, userId, isAdmin);
  await pool.query(`UPDATE memo_relacoes SET isactive = 0 WHERE id = ?`, [relacaoId]);
}

const SYSTEM_SUGESTAO = [
  "Você decide se um memo recém-registrado é o RESULTADO de um compromisso (reunião, palestra, visita, consulta) já registrado.",
  "Recebe o texto do memo novo e uma lista de compromissos próximos (id, categoria, resumo, campos).",
  "Responda SOMENTE JSON:",
  '{"destino": <id ou null>, "confianca": "alta" | "media" | "baixa", "motivo": "frase curta"}',
  "Regras:",
  "- Só indique um compromisso quando o memo novo claramente trata dele: mesmas pessoas, mesmo assunto, data compatível.",
  "- Na dúvida entre dois, ou sem evidência clara, devolva destino null.",
  "- Nunca invente ids: use só os da lista.",
].join("\n");

/**
 * Sugere o compromisso de que o memo recém-salvo parece ser o resultado. Só olha categorias
 * atualizáveis com campo de data (Agenda), de 7 dias atrás até amanhã. Sem candidato, não chama a IA.
 */
export async function sugerirRelacao(userId: number, isAdmin: boolean, memoId: number): Promise<{ sugestao: MemoRelacaoSugestao | null; costUsd: number }> {
  const m = await carregar(memoId);
  if (!m) throw new Error("not_found");
  await assertVe(m, userId, isAdmin);
  if (!m.texto.trim()) return { sugestao: null, costUsd: 0 };

  // Categorias atualizáveis do mesmo escopo, com o campo de data que marca o compromisso
  const [cats] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.name, c.campo_situacao AS "campoSituacao",
            COALESCE(c.campo_encerra_data,
                     (SELECT f.name FROM categorycampos f WHERE f.categoryid = c.id AND f.isactive = 1 AND f.tipo = 'date' ORDER BY f.id ASC LIMIT 1)) AS "campoData"
     FROM categories c
     WHERE c.isactive = 1 AND c.atualizavel = 1 AND (c.groupid IS NOT DISTINCT FROM ? OR c.groupid IS NULL)`,
    [m.groupId]
  );
  const alvo = cats.filter((c) => c.campoData && String(c.name) !== (m.category ?? ""));
  if (!alvo.length) return { sugestao: null, costUsd: 0 };

  const partes: string[] = [];
  const params: unknown[] = [];
  for (const c of alvo) {
    partes.push(
      `(m.category = ? AND mymemory_parse_date(m.dadosespecificosjson::jsonb->>(?::text)) BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE + 1)`
    );
    params.push(String(c.name), String(c.campoData));
  }
  const escopo = m.groupId != null ? "m.groupid = ?" : "(m.groupid IS NULL AND m.userid = ?)";
  params.push(m.groupId != null ? m.groupId : m.userId, memoId, memoId);
  const [cand] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.category, m.mediatext, m.dadosespecificosjson
     FROM memos m
     WHERE m.isactive = 1 AND (${partes.join(" OR ")}) AND ${escopo} AND m.id <> ?
       AND NOT EXISTS (SELECT 1 FROM memo_relacoes r WHERE r.isactive = 1 AND r.origem_id = ? AND r.destino_id = m.id)
     ORDER BY m.createdat DESC
     LIMIT 25`,
    params
  );
  if (!cand.length) return { sugestao: null, costUsd: 0 };

  const user = JSON.stringify(
    {
      memo_novo: m.texto.slice(0, 2000),
      compromissos: cand.map((c) => ({
        id: Number(c.id),
        categoria: c.category ?? null,
        resumo: String(c.mediaText ?? c.mediatext ?? "").replace(/\s+/g, " ").slice(0, 300),
        campos: (() => {
          try {
            return JSON.parse(String(c.dadosEspecificosJson ?? c.dadosespecificosjson ?? "{}"));
          } catch {
            return {};
          }
        })(),
      })),
    },
    null,
    2
  );
  const { text, costUsd } = await invokeLLM({ system: SYSTEM_SUGESTAO, user, jsonObject: true, temperature: 0, source: "sugestao_relacao" });
  let j: { destino?: unknown; confianca?: unknown; motivo?: unknown } = {};
  try {
    const t = text.trim();
    const i = t.indexOf("{");
    const k = t.lastIndexOf("}");
    j = i >= 0 && k > i ? JSON.parse(t.slice(i, k + 1)) : {};
  } catch {
    j = {};
  }
  const destinoId = Number(j.destino);
  const escolhido = cand.find((c) => Number(c.id) === destinoId);
  if (!escolhido || j.confianca === "baixa") return { sugestao: null, costUsd };

  const cat = alvo.find((c) => String(c.name) === String(escolhido.category ?? ""));
  let podeConcluir = false;
  if (cat?.campoSituacao) {
    try {
      const dados = JSON.parse(String(escolhido.dadosEspecificosJson ?? escolhido.dadosespecificosjson ?? "{}")) as Record<string, unknown>;
      const chave = Object.keys(dados).find((x) => x.toLowerCase() === String(cat.campoSituacao).toLowerCase());
      const sit = chave ? String(dados[chave] ?? "") : "";
      podeConcluir = !/^(conclu|cancel)/i.test(sit.normalize("NFD").replace(/\p{Mn}/gu, ""));
    } catch {
      podeConcluir = true;
    }
  }
  return {
    sugestao: {
      destinoId,
      categoria: (escolhido.category as string | null) ?? null,
      resumo: String(escolhido.mediaText ?? escolhido.mediatext ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      tipo: "resultado",
      podeConcluir,
      motivo: typeof j.motivo === "string" ? j.motivo : "",
    },
    costUsd,
  };
}
