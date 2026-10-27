/**
 * Conferência única antes de executar queries de categoria FORA do fluxo do Perguntar (avisos,
 * perguntas salvas, sugestões dos chips): o pedido traz só números de query, então o servidor
 * confere tudo de novo — membro do grupo, query do grupo (ou global), conexão de ERP do grupo e
 * perfil de acesso (corte por categoria, igual ao Perguntar).
 */
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { getUserIsAdmin } from "../lib/userContext.js";
import { assertUserWorkspaceGroupAccess } from "./memoContextService.js";
import { aplicarCorte, carregarPerfilEfetivo } from "./perfilPerguntaService.js";

/** null = pode executar; texto = motivo da recusa. */
export async function motivoQueriesNaoPermitidas(input: {
  userId: number;
  groupId: number | null;
  queryIds: number[];
}): Promise<string | null> {
  const isAdmin = await getUserIsAdmin(input.userId);
  if (input.groupId != null) {
    try {
      await assertUserWorkspaceGroupAccess(input.userId, input.groupId, isAdmin);
    } catch {
      return "Sem acesso a este grupo.";
    }
  }
  const ids = [...new Set(input.queryIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return null;

  const ph = ids.map(() => "?").join(",");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT q.id, c.name AS "categoria", c.groupid AS "catGroupId", q.conexaoid AS "conexaoId",
            dc.groupid AS "conexaoGroupId"
     FROM queries_categoria q
     JOIN categories c ON c.id = q.categoryid
     LEFT JOIN db_connections dc ON dc.id = q.conexaoid
     WHERE q.id IN (${ph})`,
    ids
  );
  const porId = new Map(rows.map((r) => [Number(r.id), r]));
  for (const id of ids) {
    const r = porId.get(id);
    if (!r) return `Query #${id} não encontrada.`;
    const catGroup = r.catGroupId != null ? Number(r.catGroupId) : null;
    if (catGroup !== null && catGroup !== input.groupId) return `Query #${id} não pertence a este grupo.`;
    if (r.conexaoId != null) {
      const conGroup = r.conexaoGroupId != null ? Number(r.conexaoGroupId) : null;
      if (conGroup !== null && conGroup !== input.groupId) return `Query #${id} usa uma conexão de outro grupo.`;
    }
  }

  if (input.groupId != null) {
    const perfil = await carregarPerfilEfetivo(input.userId, input.groupId);
    if (perfil && !perfil.todas) {
      const categorias = [...new Set(rows.map((r) => String(r.categoria)))];
      const corte = aplicarCorte(perfil, categorias, categorias);
      if (!corte.liberada) return `Fora do seu perfil de acesso: ${corte.foraDoPerfil.join(", ")}.`;
    }
  }
  return null;
}

/** E-mail de destino de aviso: o do próprio usuário ou de um membro do grupo. */
export async function emailDestinoPermitido(userId: number, groupId: number | null, email: string): Promise<boolean> {
  const alvo = email.trim().toLowerCase();
  const [rows] = await pool.query<RowDataPacket[]>(
    groupId != null
      ? `SELECT 1 FROM users u WHERE LOWER(u.email) = ? AND (u.id = ? OR EXISTS
           (SELECT 1 FROM group_members gm WHERE gm.userid = u.id AND gm.groupid = ?)) LIMIT 1`
      : `SELECT 1 FROM users u WHERE LOWER(u.email) = ? AND u.id = ? LIMIT 1`,
    groupId != null ? [alvo, userId, groupId] : [alvo, userId]
  );
  return rows.length > 0;
}
