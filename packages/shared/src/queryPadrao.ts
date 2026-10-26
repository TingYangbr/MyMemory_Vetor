/**
 * Gerador da "Query padrão" de uma categoria (consulta interna sobre memos, PostgreSQL).
 * Usado pelo botão "✦ Gerar Query padrão" (web) e pela geração automática no backend quando a
 * categoria ou seus campos mudam — os dois precisam produzir exatamente o mesmo texto, porque o
 * backend decide se a query ainda é "automática" comparando o SQL salvo com o último gerado.
 */

export interface QueryPadraoCampo {
  id: number;
  name: string;
  /** "text" | "date" | "number" */
  tipo: string;
  normalizedTerms: string | null;
  isActive: number;
}

export interface QueryPadraoParam {
  campo: string;
  tipo: "string" | "number" | "date";
  obrigatorio: number;
  operadorSql: string;
  normalizar: number;
  ordem: number;
}

export function queryPadraoNome(categoriaNome: string): string {
  return `Query padrão — ${categoriaNome}`;
}

export function queryPadraoDescricao(categoriaNome: string): string {
  return `Query padrão para categoria "${categoriaNome}". Adapte os filtros conforme necessário.`;
}

/** Nome de campo → nome de parâmetro SQL (sem acento, minúsculo, "_" no lugar de espaço). */
export function toParamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Situações fixas das categorias atualizáveis. Encerradas = Concluído e Cancelado. */
export const SITUACOES_MEMO = ["Ativo", "Concluído", "Cancelado"] as const;
export type SituacaoMemo = (typeof SITUACOES_MEMO)[number];

/** Situação encerrada (Concluído/Cancelado, com ou sem acento)? Vazio = Ativo. */
export function situacaoEncerrada(valor: string | null | undefined): boolean {
  const v = (valor ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return v.startsWith("conclu") || v.startsWith("cancel");
}

export function gerarQueryPadraoMemos(
  categoriaNome: string,
  campos: QueryPadraoCampo[],
  /** Categoria atualizável: sem filtro de situação na pergunta, esconde Concluído e Cancelado. */
  opts: { campoSituacao?: string | null } = {}
): { sql: string; params: QueryPadraoParam[] } {
  const activeCampos = campos.filter((c) => c.isActive === 1);
  const catNameSafe = categoriaNome.replace(/'/g, "''");

  const whereParts: string[] = [
    "  m.isactive = 1",
    `  AND m.category = '${catNameSafe}'`,
    "  AND (",
    "    (:groupId IS NOT NULL AND m.groupid = :groupId)",
    "    OR (:groupId IS NULL AND m.groupid IS NULL AND m.userid = :userId)",
    "  )",
  ];

  for (const campo of activeCampos) {
    const p = toParamName(campo.name);
    if (!p) continue;
    const jsonExpr = `m.dadosespecificosjson::jsonb->>'${campo.name}'`;
    whereParts.push(`  AND (:${p} IS NULL OR ${jsonExpr} ILIKE :${p})`);
    if (opts.campoSituacao && campo.name === opts.campoSituacao) {
      whereParts.push(
        `  AND (:${p} IS NOT NULL OR NOT (lower(unaccent(COALESCE(${jsonExpr}, ''))) LIKE 'conclu%' OR lower(unaccent(COALESCE(${jsonExpr}, ''))) LIKE 'cancel%'))`
      );
    }
    if (campo.tipo === "date") {
      whereParts.push(
        `  AND (:${p}_ini IS NULL OR mymemory_parse_date(${jsonExpr}) >= :${p}_ini)`,
        `  AND (:${p}_fin IS NULL OR mymemory_parse_date(${jsonExpr}) <= :${p}_fin)`
      );
    } else if (campo.tipo === "number") {
      whereParts.push(
        // mymemory_parse_number tolera texto ("4 horas" = 4, "1h30" = 1.5, "R$ 1.500,25") em vez de quebrar a query
        `  AND (:${p}_ini IS NULL OR mymemory_parse_number(${jsonExpr}) >= :${p}_ini)`,
        `  AND (:${p}_fin IS NULL OR mymemory_parse_number(${jsonExpr}) <= :${p}_fin)`
      );
    }
  }

  const campoSelects = activeCampos
    .map((campo) => {
      const alias = toParamName(campo.name) || `campo_${campo.id}`;
      return `  m.dadosespecificosjson::jsonb->>'${campo.name}' AS ${alias},`;
    })
    .join("\n");

  const sql = [
    "SELECT",
    "  m.id,",
    "  m.mediatype,",
    "  m.mediatext,",
    "  m.keywords,",
    "  m.category,",
    ...(campoSelects ? [campoSelects] : []),
    "  m.createdat",
    "FROM memos m",
    "WHERE",
    ...whereParts,
    "ORDER BY m.createdat DESC",
    "LIMIT 50",
  ].join("\n");

  let paramOrdem = 2;
  const params: QueryPadraoParam[] = [
    { campo: "groupId", tipo: "number", obrigatorio: 0, operadorSql: "=", normalizar: 0, ordem: 0 },
    { campo: "userId", tipo: "number", obrigatorio: 0, operadorSql: "=", normalizar: 0, ordem: 1 },
  ];
  for (const campo of activeCampos) {
    const p = toParamName(campo.name);
    if (!p) continue;
    params.push({
      campo: p,
      tipo: "string",
      obrigatorio: 0,
      operadorSql: "LIKE",
      normalizar: campo.normalizedTerms ? 1 : 0,
      ordem: paramOrdem++,
    });
    if (campo.tipo === "date") {
      params.push(
        { campo: `${p}_ini`, tipo: "date", obrigatorio: 0, operadorSql: ">=", normalizar: 0, ordem: paramOrdem++ },
        { campo: `${p}_fin`, tipo: "date", obrigatorio: 0, operadorSql: "<=", normalizar: 0, ordem: paramOrdem++ }
      );
    } else if (campo.tipo === "number") {
      params.push(
        { campo: `${p}_ini`, tipo: "number", obrigatorio: 0, operadorSql: ">=", normalizar: 0, ordem: paramOrdem++ },
        { campo: `${p}_fin`, tipo: "number", obrigatorio: 0, operadorSql: "<=", normalizar: 0, ordem: paramOrdem++ }
      );
    }
  }

  return { sql, params };
}
