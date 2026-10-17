import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";

/**
 * Identidade externa (de-para): "o ERP diz que é a pessoa 57; o myMemory decide quem é".
 * Sistema e banco vêm SEMPRE do registro da chave de integração; da requisição vem só o id externo.
 */

export type IdentidadeResolvida =
  | { tipo: "ligada"; userId: number }
  | { tipo: "nao_ligada" }
  | { tipo: "sem_id" };

export async function grupoExigeCadastro(groupId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT exigir_cadastro AS "exigir" FROM groups WHERE id = ?`, [groupId]);
  const v = rows[0]?.exigir;
  return v === 1 || v === true;
}

/** Valida o id externo recebido no header (texto curto, sem lixo); null = ausente/inválido. */
export function lerIdExterno(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const v = valor.trim();
  return v && v.length <= 120 ? v : null;
}

/**
 * Quem é a pessoa por trás do id externo neste grupo. Só vale se a ligação está ativa E a pessoa
 * ainda é membro do grupo (sair do grupo desliga o acesso sem precisar apagar o de-para).
 */
export async function resolverIdentidade(input: {
  groupId: number;
  sistema: string;
  banco: string;
  idExterno: string | null;
}): Promise<IdentidadeResolvida> {
  if (!input.idExterno) return { tipo: "sem_id" };
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ie.userid AS "userId"
     FROM identidades_externas ie
     JOIN group_members gm ON gm.groupid = ie.groupid AND gm.userid = ie.userid
     WHERE ie.groupid = ? AND ie.sistema = ? AND ie.banco = ? AND LOWER(ie.idexterno) = LOWER(?) AND ie.ativo = 1
     LIMIT 1`,
    [input.groupId, input.sistema.toLowerCase(), input.banco, input.idExterno]
  );
  return rows[0] ? { tipo: "ligada", userId: Number(rows[0].userId) } : { tipo: "nao_ligada" };
}

export interface DecisaoIdentidade {
  /** Pode seguir? */
  permitido: boolean;
  /** Usuário em nome de quem a pergunta roda (a pessoa ligada); null = segue como o usuário da chave. */
  userId: number | null;
  /** Código para a resposta de recusa. */
  motivo?: "nao_cadastrado" | "identidade_obrigatoria";
  mensagem?: string;
}

/**
 * Regra única, usada pela pergunta e pelo /status:
 *  - id ligado no de-para  → roda como essa pessoa (com o perfil e o escopo dela);
 *  - id não ligado         → recusa se o grupo exige cadastro; senão segue como o usuário da chave;
 *  - sem id (conector antigo) → recusa se o grupo exige cadastro; senão segue como antes.
 */
export async function decidirIdentidade(input: {
  groupId: number;
  sistema: string;
  banco: string;
  idExterno: string | null;
}): Promise<DecisaoIdentidade> {
  const ident = await resolverIdentidade(input);
  if (ident.tipo === "ligada") return { permitido: true, userId: ident.userId };
  if (!(await grupoExigeCadastro(input.groupId))) return { permitido: true, userId: null };
  if (ident.tipo === "sem_id") {
    return {
      permitido: false,
      userId: null,
      motivo: "identidade_obrigatoria",
      mensagem: "Este grupo exige identificar quem pergunta. Atualize o sistema de origem para informar o usuário.",
    };
  }
  return {
    permitido: false,
    userId: null,
    motivo: "nao_cadastrado",
    mensagem: "Seu usuário ainda não foi ligado ao myMemory. Peça ao administrador do grupo para cadastrá-lo.",
  };
}
