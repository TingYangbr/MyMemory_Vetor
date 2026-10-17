import { pool } from "../db.js";
import type { RowDataPacket } from "../lib/dbTypes.js";

/**
 * Perfis de acesso por grupo (fase 2 da integração com ERPs).
 *
 * Um perfil é uma lista de categorias com um nome. Cada grupo tem um e só um perfil PADRÃO; o membro
 * sem perfil explícito (group_members.perfilid NULL) usa o padrão. Não existe exceção individual:
 * um acesso diferente vira um perfil novo.
 *
 * Este módulo só administra os perfis e o de-para. A aplicação do perfil à pergunta fica em
 * `perfilPerguntaService.ts`, atrás da chave `groups.perfis_ativos`.
 */

export class PerfilError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

export interface CategoriaDoGrupo {
  id: number;
  nome: string;
  descricao: string | null;
  /** Categoria global (sem grupo) usada por fallback porque o grupo não tem categorias próprias. */
  global: boolean;
  meusPorPadrao: boolean;
  /** Tem queries cadastradas apontando para uma Conexão BD (ERP). */
  temSqlErp: boolean;
  /** Tem queries sobre os memos (PostgreSQL interno). */
  temSqlMemos: boolean;
}

export interface PerfilAcesso {
  id: number;
  groupId: number;
  nome: string;
  todas: boolean;
  incluiSemCategoria: boolean;
  padrao: boolean;
  categoriaIds: number[];
  /** Pessoas que usam o perfil (no padrão, inclui quem não tem perfil explícito). */
  pessoas: number;
}

export interface MembroDoGrupo {
  userId: number;
  nome: string | null;
  email: string | null;
  role: string;
  /** Perfil explícito do membro; null = usa o padrão. */
  perfilId: number | null;
  /** Perfil que vale de fato (explícito ou o padrão do grupo). */
  perfilEfetivoId: number;
  identidades: IdentidadeExterna[];
}

export interface IdentidadeExterna {
  id: number;
  groupId: number;
  sistema: string;
  banco: string;
  idExterno: string;
  userId: number;
  ativo: boolean;
}

export interface MatrizPerfis {
  categorias: CategoriaDoGrupo[];
  perfis: PerfilAcesso[];
  membros: MembroDoGrupo[];
  config: { perfisAtivos: boolean; exigirCadastro: boolean; maxMembers: number | null; totalMembros: number };
  avisos: string[];
}

const NOME_PADRAO = "Padrão";

function bool(v: unknown): boolean {
  return v === 1 || v === true || v === "1";
}

// ── Categorias do grupo ──────────────────────────────────────────────────────

/**
 * Categorias que o grupo enxerga. Mesma regra do restante do sistema: as do próprio grupo; se ele
 * não tem nenhuma, as globais (fallback usado em perguntas.ts).
 */
export async function listCategoriasDoGrupo(groupId: number): Promise<CategoriaDoGrupo[]> {
  const select = (where: string) => `
    SELECT c.id, c.name AS nome, c.description AS descricao, c.groupid AS "groupRef",
           c.meus_por_padrao AS "meusPorPadrao",
           EXISTS (SELECT 1 FROM queries_categoria q WHERE q.categoryid = c.id AND q.isactive = 1 AND q.conexaoid IS NOT NULL) AS "temSqlErp",
           EXISTS (SELECT 1 FROM queries_categoria q WHERE q.categoryid = c.id AND q.isactive = 1 AND q.conexaoid IS NULL) AS "temSqlMemos"
    FROM categories c
    WHERE ${where} AND c.isactive = 1
    ORDER BY c.name ASC`;

  let [rows] = await pool.query<RowDataPacket[]>(select("c.groupid = ?"), [groupId]);
  if (!rows.length) [rows] = await pool.query<RowDataPacket[]>(select("c.groupid IS NULL"), []);

  return rows.map((r) => ({
    id: Number(r.id),
    nome: String(r.nome),
    descricao: (r.descricao as string | null) ?? null,
    global: r.groupRef == null,
    meusPorPadrao: bool(r.meusPorPadrao),
    temSqlErp: bool(r.temSqlErp),
    temSqlMemos: bool(r.temSqlMemos),
  }));
}

/** Marca/desmarca "Meus por padrão". Categoria global só muda por admin do sistema (quem chama decide). */
export async function setMeusPorPadrao(
  groupId: number,
  categoryId: number,
  valor: boolean,
  isAdmin: boolean
): Promise<void> {
  const cats = await listCategoriasDoGrupo(groupId);
  const cat = cats.find((c) => c.id === categoryId);
  if (!cat) throw new PerfilError("categoria_nao_encontrada");
  if (cat.global && !isAdmin) throw new PerfilError("categoria_global_so_admin");
  if (valor && cat.temSqlErp && !cat.temSqlMemos) {
    // Só SQL do ERP: não há memos para filtrar por autor, a marca não teria efeito.
    throw new PerfilError("categoria_so_sql_erp");
  }
  await pool.query(`UPDATE categories SET meus_por_padrao = ?, updatedat = NOW() WHERE id = ?`, [valor ? 1 : 0, categoryId]);
}

// ── Perfis ───────────────────────────────────────────────────────────────────

/** Garante que o grupo tem um perfil padrão (criado com todas as categorias) e devolve o id. */
export async function ensurePerfilPadrao(groupId: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM perfis_acesso WHERE groupid = ? AND padrao = 1 LIMIT 1`,
    [groupId]
  );
  if (rows[0]) return Number(rows[0].id);

  // Se o nome "Padrão" já estiver ocupado por um perfil comum, promove esse; senão cria um novo.
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM perfis_acesso WHERE groupid = ? AND LOWER(nome) = LOWER(?) LIMIT 1`,
    [groupId, NOME_PADRAO]
  );
  if (existing[0]) {
    await pool.query(`UPDATE perfis_acesso SET padrao = 1, updatedat = NOW() WHERE id = ?`, [existing[0].id]);
    return Number(existing[0].id);
  }
  await pool.query(
    `INSERT INTO perfis_acesso (groupid, nome, todas, inclui_sem_categoria, padrao)
     VALUES (?, ?, 1, 1, 1) ON CONFLICT DO NOTHING`,
    [groupId, NOME_PADRAO]
  );
  const [again] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM perfis_acesso WHERE groupid = ? AND padrao = 1 LIMIT 1`,
    [groupId]
  );
  if (!again[0]) throw new PerfilError("perfil_padrao_nao_criado");
  return Number(again[0].id);
}

export async function listPerfis(groupId: number): Promise<PerfilAcesso[]> {
  const padraoId = await ensurePerfilPadrao(groupId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.nome, p.todas, p.inclui_sem_categoria AS "incluiSemCategoria", p.padrao,
            COALESCE((SELECT ARRAY_AGG(pc.categoryid ORDER BY pc.categoryid)
                      FROM perfil_acesso_categorias pc WHERE pc.perfilid = p.id), '{}') AS "categoriaIds",
            (SELECT COUNT(*) FROM group_members gm
              WHERE gm.groupid = p.groupid
                AND (gm.perfilid = p.id OR (p.padrao = 1 AND gm.perfilid IS NULL))) AS pessoas
     FROM perfis_acesso p
     WHERE p.groupid = ?
     ORDER BY p.padrao DESC, p.nome ASC`,
    [groupId]
  );
  void padraoId;
  return rows.map((r) => ({
    id: Number(r.id),
    groupId,
    nome: String(r.nome),
    todas: bool(r.todas),
    incluiSemCategoria: bool(r.incluiSemCategoria),
    padrao: bool(r.padrao),
    categoriaIds: ((r.categoriaIds as unknown[]) ?? []).map(Number),
    pessoas: Number(r.pessoas),
  }));
}

export interface PerfilInput {
  nome: string;
  todas?: boolean;
  incluiSemCategoria?: boolean;
  categoriaIds?: number[];
}

async function validarCategorias(groupId: number, ids: number[]): Promise<number[]> {
  const validas = new Set((await listCategoriasDoGrupo(groupId)).map((c) => c.id));
  const unicos = [...new Set(ids)];
  const fora = unicos.filter((id) => !validas.has(id));
  if (fora.length) throw new PerfilError("categoria_fora_do_grupo", `Categoria(s) fora do grupo: ${fora.join(", ")}`);
  return unicos;
}

function validarNome(nome: string): string {
  const n = nome.trim();
  if (!n) throw new PerfilError("nome_obrigatorio");
  if (n.length > 120) throw new PerfilError("nome_longo");
  return n;
}

export async function createPerfil(groupId: number, input: PerfilInput): Promise<number> {
  await ensurePerfilPadrao(groupId);
  const nome = validarNome(input.nome);
  const ids = await validarCategorias(groupId, input.categoriaIds ?? []);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [dup] = await conn.query<RowDataPacket[]>(
      `SELECT 1 FROM perfis_acesso WHERE groupid = ? AND LOWER(nome) = LOWER(?) LIMIT 1`,
      [groupId, nome]
    );
    if (dup[0]) throw new PerfilError("nome_duplicado");
    const [ins] = await conn.query<{ id: number }[]>(
      `INSERT INTO perfis_acesso (groupid, nome, todas, inclui_sem_categoria, padrao)
       VALUES (?, ?, ?, ?, 0) RETURNING id`,
      [groupId, nome, input.todas ? 1 : 0, input.incluiSemCategoria ? 1 : 0]
    );
    const perfilId = Number(ins[0].id);
    for (const cid of ids) {
      await conn.query(`INSERT INTO perfil_acesso_categorias (perfilid, categoryid) VALUES (?, ?)`, [perfilId, cid]);
    }
    await conn.commit();
    return perfilId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function updatePerfil(groupId: number, perfilId: number, input: Partial<PerfilInput>): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id FROM perfis_acesso WHERE id = ? AND groupid = ?`, [perfilId, groupId]);
  if (!rows[0]) throw new PerfilError("perfil_nao_encontrado");
  const nome = input.nome !== undefined ? validarNome(input.nome) : undefined;
  const ids = input.categoriaIds !== undefined ? await validarCategorias(groupId, input.categoriaIds) : undefined;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (nome !== undefined) {
      const [dup] = await conn.query<RowDataPacket[]>(
        `SELECT 1 FROM perfis_acesso WHERE groupid = ? AND LOWER(nome) = LOWER(?) AND id <> ? LIMIT 1`,
        [groupId, nome, perfilId]
      );
      if (dup[0]) throw new PerfilError("nome_duplicado");
    }
    await conn.query(
      `UPDATE perfis_acesso SET
         nome = COALESCE(?, nome),
         todas = COALESCE(?, todas),
         inclui_sem_categoria = COALESCE(?, inclui_sem_categoria),
         updatedat = NOW()
       WHERE id = ?`,
      [
        nome ?? null,
        input.todas === undefined ? null : input.todas ? 1 : 0,
        input.incluiSemCategoria === undefined ? null : input.incluiSemCategoria ? 1 : 0,
        perfilId,
      ]
    );
    if (ids !== undefined) {
      await conn.query(`DELETE FROM perfil_acesso_categorias WHERE perfilid = ?`, [perfilId]);
      for (const cid of ids) {
        await conn.query(`INSERT INTO perfil_acesso_categorias (perfilid, categoryid) VALUES (?, ?)`, [perfilId, cid]);
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function duplicarPerfil(groupId: number, perfilId: number, nome: string): Promise<number> {
  const perfis = await listPerfis(groupId);
  const origem = perfis.find((p) => p.id === perfilId);
  if (!origem) throw new PerfilError("perfil_nao_encontrado");
  return createPerfil(groupId, {
    nome,
    todas: origem.todas,
    incluiSemCategoria: origem.incluiSemCategoria,
    categoriaIds: origem.categoriaIds,
  });
}

/** Troca o perfil padrão do grupo (quem usava o antigo padrão sem perfil explícito passa a usar o novo). */
export async function setPerfilPadrao(groupId: number, perfilId: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id FROM perfis_acesso WHERE id = ? AND groupid = ?`, [perfilId, groupId]);
  if (!rows[0]) throw new PerfilError("perfil_nao_encontrado");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE perfis_acesso SET padrao = 0, updatedat = NOW() WHERE groupid = ? AND padrao = 1`, [groupId]);
    await conn.query(`UPDATE perfis_acesso SET padrao = 1, updatedat = NOW() WHERE id = ?`, [perfilId]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** O padrão não pode ser excluído sem eleger outro; membros do perfil excluído voltam ao padrão. */
export async function deletePerfil(groupId: number, perfilId: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id, padrao FROM perfis_acesso WHERE id = ? AND groupid = ?`, [perfilId, groupId]);
  if (!rows[0]) throw new PerfilError("perfil_nao_encontrado");
  if (bool(rows[0].padrao)) throw new PerfilError("perfil_padrao_nao_exclui");
  await pool.query(`DELETE FROM perfis_acesso WHERE id = ?`, [perfilId]);
}

// ── Membros e de-para ────────────────────────────────────────────────────────

async function listIdentidades(groupId: number): Promise<IdentidadeExterna[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, sistema, banco, idexterno AS "idExterno", userid AS "userId", ativo
     FROM identidades_externas WHERE groupid = ? ORDER BY sistema, banco, idexterno`,
    [groupId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    groupId,
    sistema: String(r.sistema),
    banco: String(r.banco),
    idExterno: String(r.idExterno),
    userId: Number(r.userId),
    ativo: bool(r.ativo),
  }));
}

export async function listMembros(groupId: number, padraoId: number): Promise<MembroDoGrupo[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT gm.userid AS "userId", u.name AS nome, u.email, gm.role, gm.perfilid AS "perfilId"
     FROM group_members gm JOIN users u ON u.id = gm.userid
     WHERE gm.groupid = ?
     ORDER BY u.name ASC NULLS LAST, u.email ASC`,
    [groupId]
  );
  const identidades = await listIdentidades(groupId);
  return rows.map((r) => {
    const userId = Number(r.userId);
    const perfilId = r.perfilId == null ? null : Number(r.perfilId);
    return {
      userId,
      nome: (r.nome as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      role: String(r.role),
      perfilId,
      perfilEfetivoId: perfilId ?? padraoId,
      identidades: identidades.filter((i) => i.userId === userId),
    };
  });
}

export async function setPerfilDoMembro(groupId: number, userId: number, perfilId: number | null): Promise<void> {
  if (perfilId !== null) {
    const [p] = await pool.query<RowDataPacket[]>(`SELECT id FROM perfis_acesso WHERE id = ? AND groupid = ?`, [perfilId, groupId]);
    if (!p[0]) throw new PerfilError("perfil_nao_encontrado");
  }
  const [res] = await pool.query<{ affectedRows: number }>(
    `UPDATE group_members SET perfilid = ? WHERE groupid = ? AND userid = ?`,
    [perfilId, groupId, userId]
  );
  if (!res.affectedRows) throw new PerfilError("membro_nao_encontrado");
}

export interface LigarIdentidadeInput {
  sistema: string;
  banco?: string;
  idExterno: string;
  userId: number;
}

/**
 * Liga um membro do grupo ao id dele no ERP. Idempotente: repetir a mesma ligação não duplica. O mesmo
 * id externo não pode apontar para outro membro, nem o membro ter dois ids no mesmo sistema/banco.
 */
export async function ligarIdentidade(groupId: number, input: LigarIdentidadeInput): Promise<number> {
  const sistema = input.sistema.trim().toLowerCase();
  const banco = (input.banco ?? "").trim();
  const idExterno = input.idExterno.trim();
  if (!sistema || !idExterno) throw new PerfilError("identidade_incompleta");

  const [m] = await pool.query<RowDataPacket[]>(`SELECT 1 FROM group_members WHERE groupid = ? AND userid = ?`, [groupId, input.userId]);
  if (!m[0]) throw new PerfilError("membro_nao_encontrado");

  const [porId] = await pool.query<RowDataPacket[]>(
    `SELECT id, userid FROM identidades_externas WHERE groupid = ? AND sistema = ? AND banco = ? AND LOWER(idexterno) = LOWER(?)`,
    [groupId, sistema, banco, idExterno]
  );
  if (porId[0]) {
    if (Number(porId[0].userId) !== input.userId) throw new PerfilError("id_externo_ja_ligado");
    await pool.query(`UPDATE identidades_externas SET ativo = 1, updatedat = NOW() WHERE id = ?`, [porId[0].id]);
    return Number(porId[0].id);
  }
  const [porUser] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM identidades_externas WHERE groupid = ? AND sistema = ? AND banco = ? AND userid = ?`,
    [groupId, sistema, banco, input.userId]
  );
  if (porUser[0]) throw new PerfilError("membro_ja_tem_id");

  const [ins] = await pool.query<{ id: number }[]>(
    `INSERT INTO identidades_externas (groupid, sistema, banco, idexterno, userid) VALUES (?, ?, ?, ?, ?) RETURNING id`,
    [groupId, sistema, banco, idExterno, input.userId]
  );
  return Number(ins[0].id);
}

export async function desligarIdentidade(groupId: number, identidadeId: number): Promise<void> {
  await pool.query(`DELETE FROM identidades_externas WHERE id = ? AND groupid = ?`, [identidadeId, groupId]);
}

// ── Configuração por grupo e visão geral ─────────────────────────────────────

export async function setConfigGrupo(
  groupId: number,
  cfg: { perfisAtivos?: boolean; exigirCadastro?: boolean }
): Promise<void> {
  await pool.query(
    `UPDATE groups SET
       perfis_ativos = COALESCE(?, perfis_ativos),
       exigir_cadastro = COALESCE(?, exigir_cadastro)
     WHERE id = ?`,
    [
      cfg.perfisAtivos === undefined ? null : cfg.perfisAtivos ? 1 : 0,
      cfg.exigirCadastro === undefined ? null : cfg.exigirCadastro ? 1 : 0,
      groupId,
    ]
  );
}

/** Tudo que a aba "Perfis" precisa numa chamada só: matriz, pessoas, de-para, chaves e avisos. */
export async function carregarMatriz(groupId: number): Promise<MatrizPerfis> {
  const padraoId = await ensurePerfilPadrao(groupId);
  const [categorias, perfis, membros] = await Promise.all([
    listCategoriasDoGrupo(groupId),
    listPerfis(groupId),
    listMembros(groupId, padraoId),
  ]);
  const [cfgRows] = await pool.query<RowDataPacket[]>(
    `SELECT g.perfis_ativos AS "perfisAtivos", g.exigir_cadastro AS "exigirCadastro", sp.maxmembers AS "maxMembers"
     FROM groups g
     LEFT JOIN subscriptions s ON s.id = g.subscriptionid
     LEFT JOIN subscription_plans sp ON sp.id = s.planid
     WHERE g.id = ?`,
    [groupId]
  );
  const c = cfgRows[0] ?? {};

  const avisos: string[] = [];
  for (const cat of categorias) {
    const alguem = perfis.some((p) => p.todas || p.categoriaIds.includes(cat.id));
    if (!alguem) avisos.push(`A categoria "${cat.nome}" não está em nenhum perfil.`);
  }
  for (const p of perfis) {
    if (p.pessoas === 0) avisos.push(`O perfil "${p.nome}" não tem ninguém.`);
  }
  const cegas = categorias.filter((x) => x.meusPorPadrao && x.temSqlMemos);
  if (cegas.length) {
    avisos.push(
      `"Meus por padrão" em ${cegas.map((x) => `"${x.nome}"`).join(", ")}: queries escritas à mão sem o parâmetro de autor não aplicam o escopo.`
    );
  }

  return {
    categorias,
    perfis,
    membros,
    config: {
      perfisAtivos: bool(c.perfisAtivos),
      exigirCadastro: bool(c.exigirCadastro),
      maxMembers: c.maxMembers == null ? null : Number(c.maxMembers),
      totalMembros: membros.length,
    },
    avisos,
  };
}

/**
 * Aviso ao cadastrar a PRIMEIRA SQL query de uma categoria: quem já tem a categoria no perfil passa a
 * ter também o modo estruturado (antes só o texto dos memos). Devolve os nomes dos perfis afetados
 * (vazio quando a categoria já tinha queries, é global, ou nenhum perfil a inclui).
 */
export async function perfisQueGanhamEstruturada(categoryId: number): Promise<string[]> {
  const [c] = await pool.query<RowDataPacket[]>(`SELECT groupid AS "groupRef" FROM categories WHERE id = ?`, [categoryId]);
  if (!c[0] || c[0].groupRef == null) return [];
  const [q] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM queries_categoria WHERE categoryid = ? AND isactive = 1 LIMIT 1`,
    [categoryId]
  );
  if (q[0]) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.nome FROM perfis_acesso p
     WHERE p.groupid = ?
       AND (p.todas = 1 OR EXISTS (SELECT 1 FROM perfil_acesso_categorias pc WHERE pc.perfilid = p.id AND pc.categoryid = ?))
     ORDER BY p.nome`,
    [Number(c[0].groupRef), categoryId]
  );
  return rows.map((r) => String(r.nome));
}
