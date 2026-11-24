/**
 * Ajustes do Fale comigo → financeiro, por espaço (grupo ou pessoal). No grupo, só o dono (ou admin) muda;
 * no espaço pessoal, o próprio usuário.
 */
import type { FinConfig, FinConfigResposta } from "@mymemory/shared";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { assertUserCanAccessGroup } from "./memoContextService.js";
import { FinErro, type Espaco } from "./financeiroService.js";

export const chaveEspaco = (e: Espaco) => (e.groupId != null ? `g:${e.groupId}` : `u:${e.userId}`);
const chave = chaveEspaco;

/** "3,0" → [3, 0] (dias de 0 a 30, sem repetir, do maior para o menor). */
export function lerDiasLembrete(v: unknown): number[] {
  const lista = String(v ?? "3,0")
    .split(/[,;\s]+/)
    .map((x) => Math.trunc(Number(x)))
    .filter((x) => Number.isFinite(x) && x >= 0 && x <= 30);
  return [...new Set(lista)].sort((a, b) => b - a).slice(0, 5);
}

export async function obterFinConfig(e: Espaco): Promise<FinConfig> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT gravar_direto AS "g", criar_grupo AS "cg", criar_conta AS "cc",
       lembrete_ativo AS "la", lembrete_dias AS "ld", lembrete_email AS "le",
       lembrete_quem AS "lq", lembrete_membros AS "lm", lembrete_emails AS "lx"
     FROM fin_config WHERE espaco = ? LIMIT 1`,
    [chave(e)]
  );
  const r = rows[0];
  return {
    gravarDireto: Number(r?.g ?? 0) === 1,
    criarGrupo: Number(r?.cg ?? 0) === 1,
    criarConta: Number(r?.cc ?? 0) === 1,
    lembreteAtivo: Number(r?.la ?? 1) === 1,
    lembreteDias: lerDiasLembrete(r?.ld ?? "3,0"),
    lembreteEmail: Number(r?.le ?? 1) === 1,
    lembreteQuem: r?.lq === "membros" || r?.lq === "escolhidos" ? r.lq : "dono",
    lembreteMembros: String(r?.lm ?? "")
      .split(",")
      .map((x) => Number(x))
      .filter((x) => Number.isInteger(x) && x > 0),
    lembreteEmails: String(r?.lx ?? ""),
  };
}

/** Membros do grupo (com o dono marcado). */
export async function membrosDoGrupo(groupId: number): Promise<{ id: number; nome: string; email: string | null; dono: boolean }[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.name, u.email, (gm.role = 'owner' OR s.ownerid = u.id) AS "dono"
     FROM group_members gm
     JOIN users u ON u.id = gm.userid
     JOIN groups g ON g.id = gm.groupid
     LEFT JOIN subscriptions s ON s.id = g.subscriptionid
     WHERE gm.groupid = ?
     UNION
     SELECT u.id, u.name, u.email, true
     FROM groups g JOIN subscriptions s ON s.id = g.subscriptionid JOIN users u ON u.id = s.ownerid
     WHERE g.id = ?
     ORDER BY 2`,
    [groupId, groupId]
  );
  const vistos = new Map<number, { id: number; nome: string; email: string | null; dono: boolean }>();
  for (const r of rows) {
    const id = Number(r.id);
    const atual = vistos.get(id);
    const dono = r.dono === true || r.dono === "t" || r.dono === 1;
    if (!atual) vistos.set(id, { id, nome: String(r.name ?? r.email ?? id), email: r.email ? String(r.email) : null, dono });
    else if (dono) atual.dono = true;
  }
  return [...vistos.values()];
}

async function podeEditar(e: Espaco): Promise<boolean> {
  if (e.groupId == null) return true;
  const [u] = await pool.query<RowDataPacket[]>(`SELECT role FROM users WHERE id = ? LIMIT 1`, [e.userId]);
  try {
    await assertUserCanAccessGroup(e.userId, e.groupId, u[0]?.role === "admin");
    return true;
  } catch {
    return false;
  }
}

export async function lerFinConfig(e: Espaco): Promise<FinConfigResposta> {
  return {
    ...(await obterFinConfig(e)),
    podeEditar: await podeEditar(e),
    ...(e.groupId != null ? { membros: await membrosDoGrupo(e.groupId) } : {}),
  };
}

export async function salvarFinConfig(e: Espaco, patch: Partial<FinConfig>): Promise<FinConfigResposta> {
  if (!(await podeEditar(e))) throw new FinErro("sem_permissao", "Só o dono do grupo muda estes ajustes.");
  const atual = await obterFinConfig(e);
  const n = { ...atual, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as FinConfig;
  const dias = lerDiasLembrete(n.lembreteDias.join(","));
  await pool.query(
    `INSERT INTO fin_config (espaco, gravar_direto, criar_grupo, criar_conta, lembrete_ativo, lembrete_dias, lembrete_email,
       lembrete_quem, lembrete_membros, lembrete_emails, updatedat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (espaco) DO UPDATE SET gravar_direto = EXCLUDED.gravar_direto, criar_grupo = EXCLUDED.criar_grupo,
       criar_conta = EXCLUDED.criar_conta, lembrete_ativo = EXCLUDED.lembrete_ativo, lembrete_dias = EXCLUDED.lembrete_dias,
       lembrete_email = EXCLUDED.lembrete_email, lembrete_quem = EXCLUDED.lembrete_quem, lembrete_membros = EXCLUDED.lembrete_membros,
       lembrete_emails = EXCLUDED.lembrete_emails, updatedat = NOW()`,
    [chave(e), n.gravarDireto ? 1 : 0, n.criarGrupo ? 1 : 0, n.criarConta ? 1 : 0, n.lembreteAtivo ? 1 : 0, dias.join(","), n.lembreteEmail ? 1 : 0,
      n.lembreteQuem, [...new Set(n.lembreteMembros)].join(",").slice(0, 500), n.lembreteEmails.trim().slice(0, 500)]
  );
  n.lembreteDias = dias;
  return { ...n, podeEditar: true, ...(e.groupId != null ? { membros: await membrosDoGrupo(e.groupId) } : {}) };
}
