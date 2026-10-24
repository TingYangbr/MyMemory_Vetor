/**
 * Dono do memo em categoria "Pessoal" (categories.meus_por_padrao): na importação em lote (manual e
 * automática) o memo é gravado por quem importou, mas pertence à pessoa indicada no campo dono da
 * categoria (categories.campo_dono) — e-mail ou nome de um membro do grupo. Não identificada, a pessoa
 * fica pendente (mediaMetadata.donoPendente) e o memo continua com quem importou até alguém atribuir.
 */
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";

export interface MembroGrupo {
  id: number;
  name: string | null;
  email: string | null;
}

export interface DonoPendente {
  campo: string | null;
  valor: string | null;
  motivo: string;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export async function listarMembrosDoGrupo(groupId: number): Promise<MembroGrupo[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.name, u.email FROM group_members gm JOIN users u ON u.id = gm.userid
     WHERE gm.groupid = ? ORDER BY u.name, u.email`,
    [groupId]
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    name: (r.name as string | null) ?? null,
    email: (r.email as string | null) ?? null,
  }));
}

/** E-mail (exato) ou nome (único no grupo) → membro. */
export function resolverMembro(valor: string | null, membros: MembroGrupo[]): { userId: number } | { motivo: string } {
  const v = (valor ?? "").trim();
  if (!v) return { motivo: "Campo dono vazio no memo." };
  const emails = (v.match(/[^\s<>;,()]+@[^\s<>;,()]+\.[^\s<>;,()]+/g) ?? []).map((e) => e.toLowerCase());
  if (emails.length) {
    const achados = membros.filter((m) => m.email && emails.includes(m.email.toLowerCase()));
    if (achados.length === 1) return { userId: achados[0].id };
    return { motivo: `"${v}" não é e-mail de membro do grupo.` };
  }
  const nv = norm(v);
  const exatos = membros.filter((m) => m.name && norm(m.name) === nv);
  if (exatos.length === 1) return { userId: exatos[0].id };
  if (exatos.length > 1) return { motivo: `Mais de um membro com o nome "${v}".` };
  const parecidos = membros.filter((m) => {
    if (!m.name) return false;
    const nm = norm(m.name);
    return nv.length >= 3 && (nm.includes(nv) || nv.includes(nm));
  });
  if (parecidos.length === 1) return { userId: parecidos[0].id };
  if (parecidos.length > 1) return { motivo: `Mais de um membro parecido com "${v}".` };
  return { motivo: `"${v}" não é membro do grupo.` };
}

function lerJson(texto: unknown): Record<string, unknown> {
  if (typeof texto !== "string" || !texto.trim()) return {};
  try {
    const v = JSON.parse(texto);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Valor de um campo nos dados do memo, sem diferenciar acento/maiúsculas no nome do campo. */
function valorDoCampo(dados: Record<string, unknown>, campo: string): string | null {
  const alvo = norm(campo);
  for (const [k, v] of Object.entries(dados)) {
    if (norm(k) === alvo && v != null) return String(v);
  }
  return null;
}

async function gravarPendencia(memoId: number, meta: Record<string, unknown>, pendente: DonoPendente | null) {
  if (pendente) meta.donoPendente = pendente;
  else delete meta.donoPendente;
  await pool.query(`UPDATE memos SET mediametadata = ? WHERE id = ?`, [JSON.stringify(meta), memoId]);
}

/**
 * Depois de criar um memo na importação: se a categoria é Pessoal, grava o dono pelo campo dono.
 * Sem efeito em memo sem grupo ou categoria que não é Pessoal.
 */
export async function aplicarDonoPessoal(
  memoId: number
): Promise<{ status: "atribuido"; userId: number } | { status: "pendente"; motivo: string } | { status: "nao_se_aplica" }> {
  const [mRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, groupid, category, dadosespecificosjson, mediametadata FROM memos WHERE id = ? LIMIT 1`,
    [memoId]
  );
  const memo = (mRows as Record<string, unknown>[])[0];
  if (!memo || memo.groupId == null || !memo.category) return { status: "nao_se_aplica" };
  const groupId = Number(memo.groupId);

  const [cRows] = await pool.query<RowDataPacket[]>(
    `SELECT meus_por_padrao AS "pessoal", campo_dono AS "campoDono" FROM categories
     WHERE name = ? AND (groupid = ? OR groupid IS NULL) AND isactive = 1
     ORDER BY groupid NULLS LAST LIMIT 1`,
    [String(memo.category), groupId]
  );
  const cat = (cRows as Record<string, unknown>[])[0];
  if (!cat || Number(cat.pessoal ?? 0) !== 1) return { status: "nao_se_aplica" };

  const meta = lerJson(memo.mediaMetadata);
  const campo = (cat.campoDono as string | null)?.trim() || null;
  if (!campo) {
    const motivo = "A categoria é Pessoal mas não tem campo dono configurado.";
    await gravarPendencia(memoId, meta, { campo: null, valor: null, motivo });
    return { status: "pendente", motivo };
  }
  const valor = valorDoCampo(lerJson(memo.dadosEspecificosJson), campo);
  const r = resolverMembro(valor, await listarMembrosDoGrupo(groupId));
  if ("motivo" in r) {
    await gravarPendencia(memoId, meta, { campo, valor, motivo: r.motivo });
    return { status: "pendente", motivo: r.motivo };
  }
  await pool.query(`UPDATE memos SET userid = ? WHERE id = ?`, [r.userId, memoId]);
  if (meta.donoPendente) await gravarPendencia(memoId, meta, null);
  return { status: "atribuido", userId: r.userId };
}

export interface MemoSemDono {
  id: number;
  category: string | null;
  resumo: string;
  campo: string | null;
  valor: string | null;
  motivo: string;
  donoAtualId: number;
  createdAt: string;
}

/** Memos do grupo com dono pendente (para a lista "Atribuir a"). */
export async function listarMemosSemDono(groupId: number): Promise<MemoSemDono[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, category, mediatext, mediametadata, userid, createdat FROM memos
     WHERE groupid = ? AND isactive = 1 AND mediametadata LIKE '%"donoPendente"%'
     ORDER BY createdat DESC LIMIT 200`,
    [groupId]
  );
  return (rows as Record<string, unknown>[]).flatMap((r) => {
    const p = lerJson(r.mediaMetadata).donoPendente as DonoPendente | undefined;
    if (!p) return [];
    const texto = String(r.mediaText ?? "").replace(/\s+/g, " ").trim();
    return [{
      id: Number(r.id),
      category: (r.category as string | null) ?? null,
      resumo: texto.length > 140 ? `${texto.slice(0, 140)}…` : texto,
      campo: p.campo ?? null,
      valor: p.valor ?? null,
      motivo: p.motivo,
      donoAtualId: Number(r.userId),
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }];
  });
}

/** Atribui o dono a um memo do grupo (o novo dono precisa ser membro) e limpa a pendência. */
export async function atribuirDono(memoId: number, groupId: number, novoDonoId: number): Promise<void> {
  const membros = await listarMembrosDoGrupo(groupId);
  if (!membros.some((m) => m.id === novoDonoId)) throw new Error("dono_nao_membro");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT mediametadata FROM memos WHERE id = ? AND groupid = ? AND isactive = 1 LIMIT 1`,
    [memoId, groupId]
  );
  const memo = (rows as Record<string, unknown>[])[0];
  if (!memo) throw new Error("memo_nao_encontrado");
  const meta = lerJson(memo.mediaMetadata);
  delete meta.donoPendente;
  await pool.query(`UPDATE memos SET userid = ?, mediametadata = ? WHERE id = ?`, [
    novoDonoId,
    JSON.stringify(meta),
    memoId,
  ]);
}

/** Owner ou editor do grupo (ou admin) pode importar, automatizar e atribuir dono. */
export async function podeGerirImportacao(userId: number, groupId: number, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT role FROM group_members WHERE groupid = ? AND userid = ? LIMIT 1`,
    [groupId, userId]
  );
  const role = String((rows as Record<string, unknown>[])[0]?.role ?? "");
  return role === "owner" || role === "editor";
}
