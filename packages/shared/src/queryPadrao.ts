/**
 * Gerador da "Query padrão" de uma categoria (consulta interna sobre memos, PostgreSQL).
 * Usado pelo botão "✦ Gerar Query padrão" (web) e pela geração automática no backend quando a
 * categoria ou seus campos mudam — os dois precisam produzir exatamente o mesmo texto, porque o
 * backend decide se a query ainda é "automática" comparando o SQL salvo com o último gerado.
 */

export interface QueryPadraoCampo {
  id: number;
  name: string;
  /** "text" | "date" | "number" | "lista" */
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

/** Tipo de consulta mantida pelo sistema (queries_categoria.autotipo). */
export type QueryAutoTipo = "padrao" | "alteracoes";

export function queryAlteracoesNome(categoriaNome: string): string {
  return `Alterações — ${categoriaNome}`;
}

export function queryAlteracoesDescricao(categoriaNome: string): string {
  return (
    `Histórico de alterações dos memos da categoria "${categoriaNome}": o que foi remarcado, mudado, ` +
    `concluído ou cancelado, com valor anterior, valor novo e quando foi alterado. ` +
    `Use para perguntas sobre remarcações, mudanças, cancelamentos e histórico.`
  );
}

/** Data/hora da alteração no fuso do Brasil (as perguntas falam do dia local). */
const ALTERADO_EM_LOCAL = "(a.createdat AT TIME ZONE 'America/Sao_Paulo')";

/**
 * "Consulta de alterações" de uma categoria atualizável: lê memo_alteracoes (uma linha por campo
 * alterado) dos memos da categoria. Filtros:
 *  - alterado_em_ini/_fin: QUANDO a alteração foi feita ("remarcado nesta semana");
 *  - valor_novo_ini/_fin: a NOVA data ("remarcado para esta semana");
 *  - campo_alterado / valor_novo: o que mudou (ex.: Situação → Cancelado);
 *  - um parâmetro por campo com o valor ATUAL do memo (ex.: com_quem).
 * Mesmo contrato da Query padrão: o backend compara o SQL salvo com o gerado para saber se é automática.
 */
export function gerarQueryAlteracoesMemos(
  categoriaNome: string,
  campos: QueryPadraoCampo[]
): { sql: string; params: QueryPadraoParam[] } {
  const activeCampos = campos.filter((c) => c.isActive === 1);
  const catNameSafe = categoriaNome.replace(/'/g, "''");
  const reservados = new Set(["alterado_em_ini", "alterado_em_fin", "campo_alterado", "valor_novo", "valor_novo_ini", "valor_novo_fin"]);

  const whereParts: string[] = [
    "  m.isactive = 1",
    `  AND m.category = '${catNameSafe}'`,
    "  AND (",
    "    (:groupId IS NOT NULL AND m.groupid = :groupId)",
    "    OR (:groupId IS NULL AND m.groupid IS NULL AND m.userid = :userId)",
    "  )",
    "  AND a.campo <> '__resumo'",
    `  AND (:alterado_em_ini IS NULL OR ${ALTERADO_EM_LOCAL}::date >= :alterado_em_ini)`,
    `  AND (:alterado_em_fin IS NULL OR ${ALTERADO_EM_LOCAL}::date <= :alterado_em_fin)`,
    "  AND (:campo_alterado IS NULL OR a.campo ILIKE :campo_alterado)",
    "  AND (:valor_novo IS NULL OR a.depois ILIKE :valor_novo)",
    "  AND (:valor_novo_ini IS NULL OR mymemory_parse_date(a.depois) >= :valor_novo_ini)",
    "  AND (:valor_novo_fin IS NULL OR mymemory_parse_date(a.depois) <= :valor_novo_fin)",
  ];

  const camposUsados: { campo: QueryPadraoCampo; p: string }[] = [];
  for (const campo of activeCampos) {
    const p = toParamName(campo.name);
    if (!p || reservados.has(p)) continue;
    camposUsados.push({ campo, p });
    whereParts.push(`  AND (:${p} IS NULL OR m.dadosespecificosjson::jsonb->>'${campo.name}' ILIKE :${p})`);
  }

  const sql = [
    "SELECT",
    "  m.id,",
    "  m.titulo_curto AS assunto,",
    "  a.campo AS campo_alterado,",
    "  a.antes AS valor_anterior,",
    "  a.depois AS valor_novo,",
    `  ${ALTERADO_EM_LOCAL} AS alterado_em,`,
    ...camposUsados.map(({ campo, p }) => `  m.dadosespecificosjson::jsonb->>'${campo.name}' AS ${p},`),
    "  m.mediatext",
    "FROM memo_alteracoes a",
    "JOIN memos m ON m.id = a.memoid",
    "WHERE",
    ...whereParts,
    "ORDER BY a.createdat DESC",
    "LIMIT 200",
  ].join("\n");

  let ordem = 0;
  const params: QueryPadraoParam[] = [
    { campo: "groupId", tipo: "number", obrigatorio: 0, operadorSql: "=", normalizar: 0, ordem: ordem++ },
    { campo: "userId", tipo: "number", obrigatorio: 0, operadorSql: "=", normalizar: 0, ordem: ordem++ },
    { campo: "alterado_em_ini", tipo: "date", obrigatorio: 0, operadorSql: ">=", normalizar: 0, ordem: ordem++ },
    { campo: "alterado_em_fin", tipo: "date", obrigatorio: 0, operadorSql: "<=", normalizar: 0, ordem: ordem++ },
    { campo: "campo_alterado", tipo: "string", obrigatorio: 0, operadorSql: "LIKE", normalizar: 0, ordem: ordem++ },
    { campo: "valor_novo", tipo: "string", obrigatorio: 0, operadorSql: "LIKE", normalizar: 0, ordem: ordem++ },
    { campo: "valor_novo_ini", tipo: "date", obrigatorio: 0, operadorSql: ">=", normalizar: 0, ordem: ordem++ },
    { campo: "valor_novo_fin", tipo: "date", obrigatorio: 0, operadorSql: "<=", normalizar: 0, ordem: ordem++ },
  ];
  for (const { campo, p } of camposUsados) {
    params.push({ campo: p, tipo: "string", obrigatorio: 0, operadorSql: "LIKE", normalizar: campo.normalizedTerms ? 1 : 0, ordem: ordem++ });
  }
  return { sql, params };
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
/** Valores gravados da situação (Pendente/Válido = aberto; "Ativo" antigo também conta como aberto). Ver situacaoMemo.ts. */
export const SITUACOES_MEMO = ["Pendente", "Concluído", "Cancelado"] as const;
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
  opts: { campoSituacao?: string | null; campoEncerraData?: string | null } = {}
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
    // "Encerra pela data": sem filtro de data na pergunta, esconde o que já passou (ex.: reunião de ontem)
    if (campo.tipo === "date" && opts.campoEncerraData && campo.name === opts.campoEncerraData) {
      whereParts.push(
        `  AND (:${p} IS NOT NULL OR :${p}_ini IS NOT NULL OR :${p}_fin IS NOT NULL OR mymemory_parse_date(${jsonExpr}) IS NULL OR mymemory_parse_date(${jsonExpr}) >= CURRENT_DATE)`
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
