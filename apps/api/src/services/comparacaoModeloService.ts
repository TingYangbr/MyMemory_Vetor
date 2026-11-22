/**
 * Compara uma categoria do grupo com o modelo de mesmo nome (catálogo de modelos; sem ele, a categoria global),
 * para o admin decidir se publica as alterações do grupo como nova versão do modelo.
 * Compara: dados da categoria, campos, subcategorias e consultas (SQL, descrição, parâmetros, colunas do resultado).
 * A conexão do ERP não entra (não vai junto para o modelo: cada grupo escolhe a sua).
 */
import type { ComparacaoModelo, ComparacaoModeloItem } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";

const NOME_IGUAL = (col: string) => `lower(translate(${col}, '—–', '--')) = lower(translate(?, '—–', '--'))`;
const chave = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[—–]/g, "-").trim();
const txt = (v: unknown) => (v == null ? "" : String(v).trim());
const sqlNorm = (s: unknown) => txt(s).replace(/\s+/g, " ");

const ROTULO_CATEGORIA: Record<string, string> = {
  description: "Descrição",
  mediatype: "Tipo de mídia",
  atualizavel: "Atualizável",
  campoSituacao: "Campo de situação",
  situacaoTipo: "Tipo de situação",
  rotuloConcluido: "Nome do Concluído",
  campoEncerraData: "Campo que encerra pela data",
  confirmarAlteracao: "Confirmar alteração",
  meusPorPadrao: "Meus por padrão",
  campoDono: "Campo dono",
  listaAbertaPor: "Lista aberta por",
  registroUnicoPor: "Registro único por",
  revisaoSempre: "Revisar sempre",
  revisaoMinPct: "% mínimo para gravar direto",
};

const ROTULO_CAMPO: Record<string, string> = {
  description: "descrição",
  tipo: "tipo",
  normalizedTerms: "padrões/valores",
  verbos: "verbos",
  ordemExibicao: "ordem na tabela",
  papelGrafico: "papel no gráfico",
  unidade: "unidade",
  completarDatas: "dias sem registro",
};

interface Carregada {
  id: number;
  nome: string;
  groupId: number | null;
  cat: Record<string, unknown>;
  campos: Map<string, Record<string, unknown>>;
  subs: Map<string, string>;
  queries: Map<string, { nome: string; descricao: string; sql: string; colunas: string; params: string }>;
}

async function carregar(id: number): Promise<Carregada | null> {
  const [c] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, groupid AS "groupId", description, mediatype AS "mediatype", atualizavel,
            campo_situacao AS "campoSituacao", situacao_tipo AS "situacaoTipo", rotulo_concluido AS "rotuloConcluido",
            campo_encerra_data AS "campoEncerraData", confirmar_alteracao AS "confirmarAlteracao",
            meus_por_padrao AS "meusPorPadrao", campo_dono AS "campoDono",
            lista_aberta_por AS "listaAbertaPor", registro_unico_por AS "registroUnicoPor",
            revisao_sempre AS "revisaoSempre", revisao_min_pct AS "revisaoMinPct"
     FROM categories WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!c[0]) return null;
  const [campos] = await pool.query<RowDataPacket[]>(
    `SELECT name, description, tipo, normalizedterms AS "normalizedTerms", verbos, ordem_exibicao AS "ordemExibicao",
            papel_grafico AS "papelGrafico", unidade, completar_datas AS "completarDatas"
     FROM categorycampos WHERE categoryid = ? AND isactive = 1 ORDER BY id`,
    [id]
  );
  const [subs] = await pool.query<RowDataPacket[]>(
    `SELECT name, description FROM subcategories WHERE categoryid = ? AND isactive = 1 ORDER BY id`,
    [id]
  );
  // Só as consultas escritas à mão (as automáticas são geradas de novo a partir dos campos)
  const [qs] = await pool.query<RowDataPacket[]>(
    `SELECT id, nome, descricao, sentencasql AS "sql", colunas_json AS "colunas" FROM queries_categoria
     WHERE categoryid = ? AND isactive = 1 AND sqlgerado IS NULL ORDER BY id`,
    [id]
  );
  const qIds = qs.map((q) => Number(q.id));
  const [ps] = qIds.length
    ? await pool.query<RowDataPacket[]>(
        `SELECT queryid AS "queryId", campo, tipo, operadorsql AS "op", obrigatorio FROM queries_categoria_params
         WHERE queryid IN (${qIds.map(() => "?").join(",")}) AND isactive = 1 ORDER BY ordem, id`,
        qIds
      )
    : [[] as RowDataPacket[]];
  const r = c[0];
  return {
    id,
    nome: String(r.name),
    groupId: r.groupId == null ? null : Number(r.groupId),
    cat: r,
    campos: new Map(campos.map((f) => [chave(f.name), f])),
    subs: new Map(subs.map((x) => [chave(x.name), txt(x.description)])),
    queries: new Map(
      qs.map((q) => [
        chave(q.nome),
        {
          nome: String(q.nome),
          descricao: txt(q.descricao),
          sql: sqlNorm(q.sql),
          colunas: txt(q.colunas),
          params: ps
            .filter((p) => Number(p.queryId) === Number(q.id))
            .map((p) => `${String(p.campo).toLowerCase()} ${p.tipo} ${p.op}${Number(p.obrigatorio) ? " obrig." : ""}`)
            .sort()
            .join(" · "),
        },
      ])
    ),
  };
}

/** Modelo de mesmo nome: no catálogo de modelos; sem ele, a categoria global. */
async function acharModelo(nome: string, excluirId: number): Promise<{ id: number; origem: "catalogo" | "global" } | null> {
  const [cat] = await pool.query<RowDataPacket[]>(
    `SELECT c.id FROM categories c JOIN groups g ON g.id = c.groupid
     WHERE g.tipo = 'catalogo' AND c.isactive = 1 AND c.id <> ? AND ${NOME_IGUAL("c.name")} ORDER BY c.id DESC LIMIT 1`,
    [excluirId, nome]
  );
  if (cat[0]) return { id: Number(cat[0].id), origem: "catalogo" };
  const [glob] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM categories WHERE groupid IS NULL AND isactive = 1 AND id <> ? AND ${NOME_IGUAL("name")} ORDER BY id LIMIT 1`,
    [excluirId, nome]
  );
  return glob[0] ? { id: Number(glob[0].id), origem: "global" } : null;
}

export async function compararComModelo(categoryId: number): Promise<ComparacaoModelo> {
  const grupo = await carregar(categoryId);
  if (!grupo) throw new Error("not_found");
  const achado = await acharModelo(grupo.nome, categoryId);
  if (!achado) return { categoria: grupo.nome, modelo: null, itens: [] };
  const modelo = (await carregar(achado.id))!;
  const [mv] = await pool.query<RowDataPacket[]>(
    `SELECT modelo_versao AS "versao", modelo_resumo AS "resumo", modelo_exemplos AS "exemplos" FROM categories WHERE id = ?`,
    [achado.id]
  );
  const itens: ComparacaoModeloItem[] = [];

  // Categoria
  for (const [k, rot] of Object.entries(ROTULO_CATEGORIA)) {
    const a = txt(grupo.cat[k]);
    const b = txt(modelo.cat[k]);
    if (a !== b) itens.push({ area: "categoria", item: rot, tipo: "diferente", grupo: a || "—", modelo: b || "—" });
  }

  // Campos
  for (const [k, f] of grupo.campos) {
    const m = modelo.campos.get(k);
    if (!m) {
      itens.push({ area: "campos", item: String(f.name), tipo: "so_grupo", grupo: `${txt(f.tipo) || "text"}${f.description ? ` — ${txt(f.description)}` : ""}` });
      continue;
    }
    for (const [p, rot] of Object.entries(ROTULO_CAMPO)) {
      const a = txt(f[p]);
      const b = txt(m[p]);
      if (a !== b) itens.push({ area: "campos", item: `${String(f.name)} · ${rot}`, tipo: "diferente", grupo: a || "—", modelo: b || "—" });
    }
  }
  for (const [k, m] of modelo.campos) {
    if (!grupo.campos.has(k)) itens.push({ area: "campos", item: String(m.name), tipo: "so_modelo", modelo: `${txt(m.tipo) || "text"}${m.description ? ` — ${txt(m.description)}` : ""}` });
  }

  // Subcategorias
  for (const [k, d] of grupo.subs) {
    if (!modelo.subs.has(k)) itens.push({ area: "subcategorias", item: k, tipo: "so_grupo", grupo: d || "—" });
    else if (modelo.subs.get(k) !== d) itens.push({ area: "subcategorias", item: `${k} · descrição`, tipo: "diferente", grupo: d || "—", modelo: modelo.subs.get(k) || "—" });
  }
  for (const [k, d] of modelo.subs) if (!grupo.subs.has(k)) itens.push({ area: "subcategorias", item: k, tipo: "so_modelo", modelo: d || "—" });

  // Consultas
  for (const [k, q] of grupo.queries) {
    const m = modelo.queries.get(k);
    if (!m) {
      itens.push({ area: "consultas", item: q.nome, tipo: "so_grupo", grupo: q.sql });
      continue;
    }
    if (q.sql !== m.sql) itens.push({ area: "consultas", item: `${q.nome} · SQL`, tipo: "diferente", grupo: q.sql, modelo: m.sql });
    if (q.descricao !== m.descricao) itens.push({ area: "consultas", item: `${q.nome} · descrição`, tipo: "diferente", grupo: q.descricao || "—", modelo: m.descricao || "—" });
    if (q.params !== m.params) itens.push({ area: "consultas", item: `${q.nome} · parâmetros`, tipo: "diferente", grupo: q.params || "—", modelo: m.params || "—" });
    if (q.colunas !== m.colunas) itens.push({ area: "consultas", item: `${q.nome} · colunas do resultado`, tipo: "diferente", grupo: q.colunas || "—", modelo: m.colunas || "—" });
  }
  for (const [k, m] of modelo.queries) if (!grupo.queries.has(k)) itens.push({ area: "consultas", item: m.nome, tipo: "so_modelo", modelo: m.sql });

  return {
    categoria: grupo.nome,
    modelo: {
      id: modelo.id,
      origem: achado.origem,
      versao: Number(mv[0]?.versao ?? 1),
      resumo: (mv[0]?.resumo as string | null) ?? null,
      exemplos: (mv[0]?.exemplos as string | null) ?? null,
    },
    itens,
  };
}
