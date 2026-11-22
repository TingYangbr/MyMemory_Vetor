/**
 * Ajustes do Fale comigo → financeiro, por espaço (grupo ou pessoal). No grupo, só o dono (ou admin) muda;
 * no espaço pessoal, o próprio usuário.
 */
import type { FinConfig, FinConfigResposta } from "@mymemory/shared";
import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { assertUserCanAccessGroup } from "./memoContextService.js";
import { FinErro, type Espaco } from "./financeiroService.js";

const chave = (e: Espaco) => (e.groupId != null ? `g:${e.groupId}` : `u:${e.userId}`);

export async function obterFinConfig(e: Espaco): Promise<FinConfig> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT gravar_direto AS "g", criar_grupo AS "cg", criar_conta AS "cc" FROM fin_config WHERE espaco = ? LIMIT 1`,
    [chave(e)]
  );
  const r = rows[0];
  return { gravarDireto: Number(r?.g ?? 0) === 1, criarGrupo: Number(r?.cg ?? 0) === 1, criarConta: Number(r?.cc ?? 0) === 1 };
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
  return { ...(await obterFinConfig(e)), podeEditar: await podeEditar(e) };
}

export async function salvarFinConfig(e: Espaco, patch: Partial<FinConfig>): Promise<FinConfigResposta> {
  if (!(await podeEditar(e))) throw new FinErro("sem_permissao", "Só o dono do grupo muda estes ajustes.");
  const atual = await obterFinConfig(e);
  const n = { ...atual, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as FinConfig;
  await pool.query(
    `INSERT INTO fin_config (espaco, gravar_direto, criar_grupo, criar_conta, updatedat) VALUES (?, ?, ?, ?, NOW())
     ON CONFLICT (espaco) DO UPDATE SET gravar_direto = EXCLUDED.gravar_direto, criar_grupo = EXCLUDED.criar_grupo,
       criar_conta = EXCLUDED.criar_conta, updatedat = NOW()`,
    [chave(e), n.gravarDireto ? 1 : 0, n.criarGrupo ? 1 : 0, n.criarConta ? 1 : 0]
  );
  return { ...n, podeEditar: true };
}
