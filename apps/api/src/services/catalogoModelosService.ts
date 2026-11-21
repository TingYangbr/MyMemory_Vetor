/**
 * Catálogo de modelos prontos (plug-ins de categoria). Os modelos são categorias do grupo
 * "Catálogo de modelos" (groups.tipo = 'catalogo'), que não tem membros: não aparecem para ninguém
 * até alguém habilitar. Habilitar = copiar o modelo para um grupo, guardando a origem e a versão.
 * O admin do sistema publica (a partir de uma categoria que já funciona) e retira modelos.
 */
import type { CatalogoModelo } from "@mymemory/shared";
import { lerValoresStatus, rotulosSituacao } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { copiarCategoriaParaGrupo } from "./memoContextService.js";

/** Mesmo nome, sem diferenciar maiúsculas nem travessão/hífen ("Fin — X" = "Fin - X"); compara com o parâmetro "?". */
const NOME_IGUAL = (col: string) => `lower(translate(${col}, '—–', '--')) = lower(translate(?, '—–', '--'))`;

async function grupoCatalogo(): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id FROM groups WHERE tipo = 'catalogo' ORDER BY id LIMIT 1`);
  const id = Number(rows[0]?.id);
  if (!id) throw Object.assign(new Error("O catálogo de modelos ainda não existe (rode as migrations)."), { statusCode: 400 });
  return id;
}

const linhas = (s: unknown) =>
  String(s ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** Modelos do catálogo; com groupId, diz quais já estão habilitados naquele grupo (mesmo nome, ativa). */
export async function listarModelos(groupId: number | null): Promise<CatalogoModelo[]> {
  const catalogo = await grupoCatalogo();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.name, c.description, c.modelo_resumo AS "resumo", c.modelo_exemplos AS "exemplos",
            c.modelo_versao AS "versao", c.atualizavel, c.situacao_tipo AS "situacaoTipo",
            c.rotulo_concluido AS "rotuloConcluido", c.campo_situacao AS "campoSituacao",
            ${groupId != null
              ? `(SELECT d.id FROM categories d WHERE d.groupid = ? AND d.isactive = 1 AND lower(translate(d.name, '—–', '--')) = lower(translate(c.name, '—–', '--')) LIMIT 1)`
              : "NULL"} AS "habilitadaId"
     FROM categories c
     WHERE c.groupid = ? AND c.isactive = 1
     ORDER BY c.name ASC`,
    groupId != null ? [groupId, catalogo] : [catalogo]
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => Number(r.id));
  const [campos] = await pool.query<RowDataPacket[]>(
    `SELECT categoryid AS "categoryId", name, tipo, normalizedterms AS "normalizedTerms"
     FROM categorycampos WHERE categoryid IN (${ids.map(() => "?").join(",")}) AND isactive = 1 ORDER BY id ASC`,
    ids
  );
  return rows.map((r) => {
    const id = Number(r.id);
    const sit = String(r.campoSituacao ?? "").toLowerCase();
    const rot = rotulosSituacao(r.situacaoTipo as string | null, r.rotuloConcluido as string | null);
    return {
      id,
      nome: String(r.name),
      resumo: (r.resumo as string | null)?.trim() || (r.description as string | null) || "",
      exemplos: linhas(r.exemplos),
      versao: Number(r.versao ?? 1),
      situacao: Number(r.atualizavel ?? 0) === 1 ? rot.opcoes.map((e) => rot[e]) : null,
      campos: campos
        .filter((f) => Number(f.categoryId) === id && String(f.name).toLowerCase() !== sit)
        .map((f) => ({
          nome: String(f.name),
          tipo: String(f.tipo ?? "text"),
          ...(f.tipo === "status" ? { valores: lerValoresStatus(f.normalizedTerms as string | null) } : {}),
        })),
      habilitadaId: r.habilitadaId != null ? Number(r.habilitadaId) : null,
    };
  });
}

/**
 * Admin: publica uma categoria como modelo. Se já existe modelo com o mesmo nome, o novo substitui
 * (versão + 1) e o antigo sai do catálogo; quem já habilitou continua com a sua cópia.
 */
export async function publicarModelo(input: {
  userId: number;
  categoryId: number;
  resumo: string | null;
  exemplos: string | null;
}): Promise<{ id: number; versao: number }> {
  const catalogo = await grupoCatalogo();
  const [cRows] = await pool.query<RowDataPacket[]>(`SELECT name, groupid AS "groupId" FROM categories WHERE id = ? LIMIT 1`, [
    input.categoryId,
  ]);
  const cat = cRows[0];
  if (!cat) throw new Error("not_found");
  if (Number(cat.groupId) === catalogo) {
    // Já é um modelo: só atualiza os textos do catálogo
    await pool.query(`UPDATE categories SET modelo_resumo = ?, modelo_exemplos = ? WHERE id = ?`, [
      input.resumo?.trim() || null,
      input.exemplos?.trim() || null,
      input.categoryId,
    ]);
    const [v] = await pool.query<RowDataPacket[]>(`SELECT modelo_versao AS "v" FROM categories WHERE id = ?`, [input.categoryId]);
    return { id: input.categoryId, versao: Number(v[0]?.v ?? 1) };
  }
  const [ant] = await pool.query<RowDataPacket[]>(
    `SELECT id, modelo_versao AS "versao" FROM categories WHERE groupid = ? AND isactive = 1 AND ${NOME_IGUAL("name")} LIMIT 1`,
    [catalogo, String(cat.name)]
  );
  const versao = ant[0] ? Number(ant[0].versao ?? 1) + 1 : 1;
  if (ant[0]) await pool.query(`UPDATE categories SET isactive = 0 WHERE id = ?`, [ant[0].id]);
  try {
    const novo = await copiarCategoriaParaGrupo(input.userId, input.categoryId, catalogo);
    await pool.query(`UPDATE categories SET modelo_resumo = ?, modelo_exemplos = ?, modelo_versao = ? WHERE id = ?`, [
      input.resumo?.trim() || null,
      input.exemplos?.trim() || null,
      versao,
      novo.id,
    ]);
    return { id: novo.id, versao };
  } catch (e) {
    // Falhou a cópia: o modelo anterior volta ao catálogo
    if (ant[0]) await pool.query(`UPDATE categories SET isactive = 1 WHERE id = ?`, [ant[0].id]);
    throw e;
  }
}

/** Admin: tira o modelo do catálogo (as cópias já habilitadas continuam nos grupos). */
export async function retirarModelo(modeloId: number): Promise<void> {
  const catalogo = await grupoCatalogo();
  const [r] = await pool.query<RowDataPacket[]>(
    `UPDATE categories SET isactive = 0 WHERE id = ? AND groupid = ? RETURNING id`,
    [modeloId, catalogo]
  );
  if (!r.length) throw new Error("not_found");
}

/** Dono do grupo (ou admin): habilita o modelo no grupo — copia, guardando de onde veio. */
export async function habilitarModelo(userId: number, modeloId: number, groupId: number): Promise<{ id: number; name: string }> {
  const catalogo = await grupoCatalogo();
  const [m] = await pool.query<RowDataPacket[]>(
    `SELECT modelo_versao AS "versao" FROM categories WHERE id = ? AND groupid = ? AND isactive = 1 LIMIT 1`,
    [modeloId, catalogo]
  );
  if (!m[0]) throw new Error("not_found");
  return copiarCategoriaParaGrupo(userId, modeloId, groupId, { doCatalogo: { versao: Number(m[0].versao ?? 1) } });
}
