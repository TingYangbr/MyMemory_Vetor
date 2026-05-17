import type {
  PerguntaCardHistorico,
  PerguntaClassificacao,
  PerguntaFiltros,
  PerguntaMemoUsado,
  PerguntaResposta,
  PerguntaResultadoEstruturado,
} from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { executeQueryMssql } from "./adminDbConnectionsService.js";
import { invokeLLM } from "../lib/invokeLlm.js";
import { getActiveSystemPrompt } from "./llmPromptConfigService.js";
import { setLastLlmPromptTrace } from "./llmPromptTraceStore.js";
import { parseRespostaStr, parseStringArray } from "./perguntaParseUtils.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QueryDisponivel {
  query_id: string;
  nome: string;
  descricao: string | null;
  sentencaSql: string;
  /** null = executa no PostgreSQL interno; número = ID da db_connections SQL Server */
  conexaoId: number | null;
  params: {
    nome: string;
    tipo: string;
    obrigatorio: boolean;
    operadorSql: string;
    normalizar: boolean;
    /** Descrição semântica do campo (para ajudar o LLM a associar termos do usuário ao parâmetro correto). */
    descricao_campo?: string | null;
    /** Exemplos de valores aceitos pelo campo (extraídos de normalizedTerms). */
    exemplos_valores?: string[];
  }[];
}

export interface Pipe2Input {
  pergunta: string;
  userId: number;
  groupId: number | null;
  filtros: PerguntaFiltros;
  historico: PerguntaCardHistorico[];
  classificacao: PerguntaClassificacao;
  queriesDisponiveis: QueryDisponivel[];
  /** ID da primeira categoria classificada, para lookup de override de prompt. */
  categoryId?: number | null;
}

export interface Pipe2Result {
  resposta: PerguntaResposta;
  apiCost: number;
  dadosEstruturados: PerguntaResultadoEstruturado;
}

interface PlanoParam {
  nome: string;
  termo_usuario: string;
  valor: unknown;
  tipo: string;
  operador_sugerido: string;
  obrigatorio: boolean;
  precisa_normalizacao: boolean;
}

interface PlanoAgregacaoTrunc {
  campo: string;
  granularidade: "year" | "month" | "week" | "day";
}

interface PlanoAgregacao {
  medida: "count" | "sum" | "avg" | "min" | "max" | null;
  campo_medida: string | null;
  group_by: string[];
  group_by_trunc?: PlanoAgregacaoTrunc[];
  order_by: { campo: string; direcao: "asc" | "desc" }[];
  limit: number | null;
  /** Filtra grupos onde o resultado da função de agregação seja > having_gt. Ex: 0 exclui grupos com total <= 0. */
  having_gt?: number | null;
}

interface PlanoCrossQueryFilter {
  /** Prioridade da query cujos resultados serão usados como filtro. */
  from_priority: number;
  /** Nome da coluna nos resultados da query origem. */
  from_field: string;
  /** Nome do parâmetro da query destino que receberá a lista. Deve estar cadastrado com operador IN ou NOT IN. */
  to_param: string;
}

interface PlanoQuery {
  query_id: string;
  motivo_uso: string;
  prioridade: number;
  parametros: PlanoParam[];
  agregacao?: PlanoAgregacao | null;
  cross_query_filter?: PlanoCrossQueryFilter[];
}

interface PlanoConsulta {
  queries: PlanoQuery[];
  dados_insuficientes: boolean;
  pergunta_para_usuario: string | null;
  observacoes: string[];
}

interface QueryExecResultado {
  query_id: string;
  colunas: string[];
  linhas: Record<string, unknown>[];
  totalLinhas: number;
}

// Parâmetros injetados automaticamente pelo backend — nunca expostos ao LLM
const SYSTEM_PARAM_NAMES = new Set(["userid", "groupid"]);

// Mapeamento tipo da query_param → cast PostgreSQL
const TIPO_PG_CAST: Record<string, string> = {
  string: "text", texto: "text", lista_texto: "text",
  number: "numeric", numero: "numeric",
  date: "date", data: "date",
  boolean: "boolean",
};
// Cast fixo para parâmetros de sistema
const SYSTEM_PARAM_CAST: Record<string, string> = { userid: "int", groupid: "int" };

// ── Utilities ─────────────────────────────────────────────────────────────────

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    const t = raw.trim();
    const i = t.indexOf("{");
    const k = t.lastIndexOf("}");
    if (i >= 0 && k > i) return JSON.parse(t.slice(i, k + 1)) as T;
  } catch { /* */ }
  return fallback;
}

function buildContextoSessao(historico: PerguntaCardHistorico[]): object {
  if (!historico.length) return { mensagens: [] };
  return {
    mensagens: historico.slice(-3).map((h) => ({
      pergunta: h.pergunta,
      resposta: h.resposta,
      pipe: h.pipe,
    })),
  };
}

/** Remove cláusula LIMIT/OFFSET do final do SQL para não restringir a base antes de agregar. */
function stripLimitOffset(sql: string): string {
  return sql.replace(/\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i, "").trim();
}

/**
 * Extrai os nomes das colunas presentes no SELECT da sentença SQL.
 * Retorna lista em lowercase. Usado para validar campo_medida e group_by do LLM
 * e para informar explicitamente ao LLM quais colunas existem no template.
 */
function extractSelectColumnNames(sentencaSql: string): string[] {
  const m = /\bSELECT\b([\s\S]+?)\bFROM\b/i.exec(sentencaSql);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((col) => {
      const trimmed = col.trim().replace(/\s+/g, " ");
      const asMatch = /\bAS\s+[\[\"`]?(\w+)[\]\"`]?\s*$/i.exec(trimmed);
      if (asMatch) return asMatch[1].toLowerCase();
      const lastId = /[\[\"`]?(\w+)[\]\"`]?\s*$/.exec(trimmed);
      const name = lastId ? lastId[1].toLowerCase() : "";
      return name === "select" ? "" : name;
    })
    .filter((c) => c.length > 0 && c !== "*");
}

/** Quota um identificador de coluna usando a convenção do dialeto. Aceita qualquer nome. */
function sanitizeIdentifier(name: string, dialect: "pg" | "mssql" = "pg"): string {
  if (dialect === "mssql") {
    return `[${name.replace(/]/g, "]]")}]`;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Envolve o SQL base (já com parâmetros bindados) em um CTE e aplica
 * GROUP BY / função de agregação / ORDER BY / LIMIT conforme especificado pelo LLM.
 */
// Mapeia nomes que o LLM usa no order_by para os aliases reais gerados por applyAgregacao.
// O LLM tende a usar nomes como "count", "sum", "avg" sem saber o alias exato (ex: "contagem").
const MEDIDA_ALIAS: Record<string, string> = {
  count: "contagem", contagem: "contagem",
  sum: "total", total: "total",
  avg: "media", media: "media", average: "media",
  min: "minimo", minimo: "minimo",
  max: "maximo", maximo: "maximo",
};

function applyAgregacao(baseSql: string, ag: PlanoAgregacao, dialect: "pg" | "mssql" = "pg"): string {
  const cleanBase = stripLimitOffset(baseSql);
  const qi = (name: string) => sanitizeIdentifier(name, dialect);

  // Remove prefixo "_base." que o LLM às vezes inclui nos nomes de coluna
  const stripBase = (name: string) => name.replace(/^_base\./i, "");

  // Desempacota chamadas de função literais que o LLM coloca no order_by:
  // "COUNT(*)" → "contagem", "SUM(col)" → "col", "MIN(col)" → "col".
  const unwrapFn = (name: string): string => {
    const m = /^(\w+)\(([^)]*)\)$/.exec(name.trim());
    if (!m) return name;
    const fn = m[1].toLowerCase();
    const arg = m[2].trim();
    if (fn === "count") return "contagem";
    return arg === "*" ? name : arg;
  };

  const normalizeOrderCampo = (campo: string) => unwrapFn(stripBase(campo));

  // Constrói expressões de truncamento para colunas de data com granularidade
  const truncMap = new Map<string, { selectExpr: string; groupExpr: string }>();
  for (const t of (ag.group_by_trunc ?? [])) {
    const colNorm = stripBase(t.campo).toLowerCase();
    const colQ = qi(stripBase(t.campo));
    const aliasQ = qi(stripBase(t.campo));
    let expr: string;
    if (dialect === "mssql") {
      const fmtMap: Record<string, string> = { year: "yyyy", month: "yyyy-MM", week: "yyyy-WW", day: "yyyy-MM-dd" };
      const fmt = fmtMap[t.granularidade] ?? "yyyy-MM";
      expr = `FORMAT(${colQ}, '${fmt}')`;
    } else {
      expr = `DATE_TRUNC('${t.granularidade}', mymemory_parse_date(${colQ})::timestamp)`;
    }
    truncMap.set(colNorm, { selectExpr: `${expr} AS ${aliasQ}`, groupExpr: expr });
  }

  const groupSelectParts = ag.group_by.map((col) => {
    const stripped = stripBase(col);
    const trunc = truncMap.get(stripped.toLowerCase());
    return trunc ? trunc.selectExpr : qi(stripped);
  });
  const groupByParts = ag.group_by.map((col) => {
    const stripped = stripBase(col);
    const trunc = truncMap.get(stripped.toLowerCase());
    return trunc ? trunc.groupExpr : qi(stripped);
  });

  // mssql usa TOP N antes do SELECT; PostgreSQL usa LIMIT N no final
  const topN = dialect === "mssql" && ag.limit ? `TOP ${ag.limit} ` : "";
  const limitClause = dialect === "pg" && ag.limit ? ` LIMIT ${ag.limit}` : "";

  // Sem função de medida — apenas ORDER BY + LIMIT (ex.: "mostre os 10 mais recentes")
  if (!ag.medida) {
    const cols = groupSelectParts.length > 0 ? groupSelectParts.join(", ") : "*";
    const orderClauses = ag.order_by.map((o) => {
      const name = normalizeOrderCampo(o.campo);
      const resolved = MEDIDA_ALIAS[name.toLowerCase()] ?? name;
      return `${qi(resolved)} ${o.direcao === "desc" ? "DESC" : "ASC"}`;
    });
    let sql = `WITH _base AS (\n${cleanBase}\n) SELECT ${topN}${cols} FROM _base`;
    if (orderClauses.length) sql += ` ORDER BY ${orderClauses.join(", ")}`;
    sql += limitClause;
    return sql;
  }

  let measureAlias: string;
  let measureExpr: string;
  let measureFnExpr: string; // sem alias — usado no HAVING
  if (ag.medida === "count") {
    measureAlias = "contagem";
    measureFnExpr = "COUNT(*)";
    measureExpr = `${measureFnExpr} AS ${measureAlias}`;
  } else {
    if (!ag.campo_medida) throw new Error(`campo_medida obrigatório para medida "${ag.medida}"`);
    const col = qi(stripBase(ag.campo_medida));
    const fnName = { sum: "SUM", avg: "AVG", min: "MIN", max: "MAX" }[ag.medida];
    measureAlias = { sum: "total", avg: "media", min: "minimo", max: "maximo" }[ag.medida];
    measureFnExpr = `${fnName}(${col})`;
    measureExpr = `${measureFnExpr} AS ${measureAlias}`;
  }

  // Extras adicionados automaticamente ao SELECT quando ORDER BY usa coluna fora do GROUP BY.
  // Ex: ORDER BY Valor_Total_Produto com medida=min → adiciona SUM(Valor_Total_Produto) AS ord_xxx.
  const orderByExtras: { alias: string; expr: string }[] = [];
  // aliases das colunas de GROUP BY: para trunc, o alias é o campo original (ex: "Data_Emissao")
  const groupByLowers = new Set(ag.group_by.map((c) => stripBase(c).toLowerCase()));

  // Resolve o campo do ORDER BY: normaliza (strip prefix + unwrap fn); mapeia alias genérico;
  // mapeia coluna da medida principal; aceita coluna do GROUP BY; senão adiciona SUM extra.
  const resolveOrderCampoFinal = (campo: string): string => {
    const name = normalizeOrderCampo(campo);
    const lower = name.toLowerCase();
    if (MEDIDA_ALIAS[lower]) return MEDIDA_ALIAS[lower];
    if (ag.campo_medida && lower === stripBase(ag.campo_medida).toLowerCase()) return measureAlias;
    if (groupByLowers.has(lower)) return name;
    const alias = `ord_${lower.replace(/[^a-z0-9_]/g, "_")}`;
    if (!orderByExtras.some((e) => e.alias === alias)) {
      orderByExtras.push({ alias, expr: `SUM(${qi(name)}) AS ${alias}` });
    }
    return alias;
  };

  const orderClauses: string[] = [];
  const orderSeen = new Set<string>();
  for (const o of ag.order_by) {
    const resolved = resolveOrderCampoFinal(o.campo);
    if (orderSeen.has(resolved.toLowerCase())) continue;
    orderSeen.add(resolved.toLowerCase());
    orderClauses.push(`${qi(resolved)} ${o.direcao === "desc" ? "DESC" : "ASC"}`);
  }

  const baseSelect = groupSelectParts.length > 0 ? `${groupSelectParts.join(", ")}, ${measureExpr}` : measureExpr;
  const selectList = orderByExtras.length > 0
    ? `${baseSelect}, ${orderByExtras.map((e) => e.expr).join(", ")}`
    : baseSelect;

  let sql = `WITH _base AS (\n${cleanBase}\n) SELECT ${topN}${selectList} FROM _base`;
  if (groupByParts.length > 0) sql += ` GROUP BY ${groupByParts.join(", ")}`;
  if (ag.having_gt !== null && ag.having_gt !== undefined) {
    sql += ` HAVING ${measureFnExpr} > ${ag.having_gt}`;
  }
  if (orderClauses.length) sql += ` ORDER BY ${orderClauses.join(", ")}`;
  sql += limitClause;

  return sql;
}

/**
 * Para datas em formato ISO (YYYY-MM-DD), gera as variantes de exibição usadas em português:
 * DD/MM/YYYY, YYYY-MM-DD (ISO), D de mês de YYYY.
 * Retorna os valores já envolvidos em %...% para ILIKE.
 */
function parseDateVariants(isoDate: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return [`%${isoDate}%`];
  const [, yyyy, mm, dd] = match;
  const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const mes = MESES[parseInt(mm, 10) - 1] ?? mm;
  const d = parseInt(dd, 10);
  return [
    `%${dd}/${mm}/${yyyy}%`,
    `%${isoDate}%`,
    `%${d} de ${mes} de ${yyyy}%`,
  ];
}

/**
 * Substitui placeholders :paramName no SQL por ?::tipo (compatível com pool.query + toPositional).
 * O cast explícito evita "could not determine data type of parameter $N" quando o valor é null.
 * Não substitui :: (cast PostgreSQL) graças ao lookbehind (?<!:).
 *
 * Para parâmetros do tipo date/data com operador LIKE, expande o placeholder em múltiplos
 * formatos de data (DD/MM/YYYY, YYYY-MM-DD, "D de mês de YYYY") combinados com OR, cobrindo
 * todas as formas em que uma data pode estar armazenada em dadosEspecificosJson.
 */
function bindTemplateParams(
  sentencaSql: string,
  llmParams: PlanoParam[],
  paramDefs: QueryDisponivel["params"],
  systemParams: { userid: number; groupid: number | null }
): { sql: string; values: unknown[] } {
  // Chaves em lowercase para comparação case-insensitive (SQL usa :groupId, mapa guarda "groupid")
  const paramMap: Record<string, unknown> = {
    userid: systemParams.userid,
    groupid: systemParams.groupid,
  };
  // operador_sugerido por param: "=" suprime wrap com % mesmo que paramDef tenha operadorSql LIKE
  const llmOpMap = new Map<string, string>();
  for (const p of llmParams) {
    if (p.nome) {
      paramMap[p.nome.toLowerCase()] = p.valor ?? null;
      if (p.operador_sugerido) llmOpMap.set(p.nome.toLowerCase(), p.operador_sugerido);
    }
  }
  const defByName = new Map(paramDefs.map((p) => [p.nome.toLowerCase(), p]));

  // Coleta todos os tokens :paramName da esquerda para a direita (preserva ordem dos values[])
  interface Token {
    start: number;
    end: number;
    name: string;
    colExpr?: string;  // expressão de coluna antes de ILIKE
    colStart?: number; // posição no SQL onde a expressão de coluna começa
    isUnaccentLike?: boolean; // true = envolve colExpr em unaccent(); false = expansão de datas
    inContext?: "in" | "notin"; // token está dentro de "IN (...)" ou "NOT IN (...)" → expandir lista
  }
  const tokens: Token[] = [];
  const re = /(?<!:):([a-zA-Z][a-zA-Z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentencaSql)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, name: m[1] });
  }

  // Detecta tokens dentro de cláusula IN (...) ou NOT IN (...). Sinal: termina com "IN (" ou "NOT IN ("
  function detectInContext(before: string): "in" | "notin" | null {
    const reIn = /(?:\bNOT\s+IN|\bIN)\s*\(\s*$/i;
    const m = reIn.exec(before);
    if (!m) return null;
    return /\bNOT\s+IN/i.test(m[0]) ? "notin" : "in";
  }
  for (const token of tokens) {
    const ctx = detectInContext(sentencaSql.slice(0, token.start));
    if (ctx) token.inContext = ctx;
  }

  // Para parâmetros com ILIKE/LIKE e valor não-nulo, encontra a expressão de coluna
  // imediatamente antes do operador: datas → expansão de formato; texto → unaccent().
  // extractColBeforeLike varre da direita para a esquerda respeitando aspas simples,
  // suportando chaves JSONB com espaços, ex: ->>'Data atendimento'.
  function extractColBeforeLike(before: string): { colExpr: string; colStart: number } | null {
    const likeMatch = /\s+I?LIKE\s*$/i.exec(before);
    if (!likeMatch) return null;
    const exprEnd = likeMatch.index;
    let inQuote = false;
    let i = exprEnd - 1;
    for (; i >= 0; i--) {
      const c = before[i];
      if (c === "'") { inQuote = !inQuote; }
      if (!inQuote && (c === " " || c === "\t" || c === "\n" || c === "," || c === "(" || c === ")")) break;
    }
    const colStart = i + 1;
    const colExpr = before.slice(colStart, exprEnd);
    return colExpr ? { colExpr, colStart } : null;
  }

  for (const token of tokens) {
    const key = token.name.toLowerCase();
    const def = defByName.get(key);
    const isDate = def?.tipo === "date" || def?.tipo === "data";
    if (!/LIKE/i.test(def?.operadorSql ?? "") || paramMap[key] == null) continue;
    const before = sentencaSql.slice(0, token.start);
    const colInfo = extractColBeforeLike(before);
    if (colInfo) {
      token.colExpr = colInfo.colExpr;
      token.colStart = colInfo.colStart;
      token.isUnaccentLike = !isDate;
    }
  }

  // Constrói o SQL de saída e o array de values na ordem correta (esquerda → direita)
  const values: unknown[] = [];
  let result = "";
  let pos = 0;

  for (const token of tokens) {
    const key = token.name.toLowerCase();
    let val = Object.prototype.hasOwnProperty.call(paramMap, key) ? paramMap[key] : null;
    if (val === "") val = null; // LLMs às vezes retornam "" para "sem valor" — trata como null
    const def = defByName.get(key);
    const cast = SYSTEM_PARAM_CAST[key] ?? TIPO_PG_CAST[def?.tipo ?? ""] ?? "text";

    if (token.inContext) {
      // Token está dentro de "IN (...)" ou "NOT IN (...)" — expande lista para múltiplos placeholders
      result += sentencaSql.slice(pos, token.start);
      if (val === null || val === undefined || (Array.isArray(val) && val.length === 0)) {
        // Lista vazia ou nula: emite NULL — IN/NOT IN com NULL não casa, mas o template normalmente
        // tem "(:param IS NULL OR col IN (:param))", e o IS NULL pega esse caso.
        result += "NULL";
      } else {
        const list = Array.isArray(val) ? val : [val];
        result += list.map(() => `?::${cast}`).join(", ");
        for (const item of list) values.push(item);
      }
      pos = token.end;
      continue;
    }

    // Token fora de contexto IN mas valor é lista (caso "(:param IS NULL OR col IN (:param))"):
    // primeira ocorrência precisa de scalar para o IS NULL check. Usa primeiro elemento como
    // representante: se lista vazia → null (IS NULL passa); senão → valor não-nulo (IS NULL falha).
    if (Array.isArray(val)) {
      val = val.length > 0 ? val[0] : null;
    }

    if (token.colExpr !== undefined && token.colStart !== undefined) {
      if (token.isUnaccentLike) {
        // Texto ILIKE accent-insensitive: substitui "col ILIKE :param" por "unaccent(col) ILIKE ?::text"
        const stripped = String(val).normalize("NFD").replace(/\p{Mn}/gu, "");
        result += sentencaSql.slice(pos, token.colStart);
        const wantLike = llmOpMap.get(key) === "LIKE";
        if (wantLike) {
          result += `unaccent(${token.colExpr}) ILIKE ?::text`;
          values.push(`%${stripped}%`);
        } else {
          // Padrão: match exato sem wildcards. LLM deve enviar "LIKE" explicitamente para busca parcial.
          result += `unaccent(${token.colExpr}) = ?::text`;
          values.push(stripped);
        }
        pos = token.end;
      } else {
        // Data ILIKE: substitui "col ILIKE :param" por "(col ILIKE ?::text OR col ILIKE ?::text OR ...)"
        const variants = parseDateVariants(String(val));
        result += sentencaSql.slice(pos, token.colStart);
        result += `(${variants.map(() => `${token.colExpr} ILIKE ?::text`).join(" OR ")})`;
        for (const v of variants) values.push(v);
        pos = token.end;
      }
    } else {
      // Parâmetro comum (inclui ocorrências IS NULL e fallback quando colExpr não detectado)
      result += sentencaSql.slice(pos, token.start);
      if (val !== null && val !== undefined && /LIKE/i.test(def?.operadorSql ?? "") && llmOpMap.get(key) === "LIKE") {
        const stripped = String(val).normalize("NFD").replace(/\p{Mn}/gu, "");
        val = `%${stripped}%`;
      }
      values.push(val);
      // Se o template já tem ::tipo imediatamente após o placeholder (ex: :param::numeric),
      // usa só ? para evitar duplo cast ?::text::numeric. O cast do template resolve.
      const hasTrailingCast = sentencaSql.slice(token.end, token.end + 2) === "::";
      result += hasTrailingCast ? "?" : `?::${cast}`;
      pos = token.end;
    }
  }
  result += sentencaSql.slice(pos);

  return { sql: result, values };
}

// ── Internal: planejamento via LLM ────────────────────────────────────────────

async function planejarConsultaEstruturada(input: {
  pergunta: string;
  classificacao: PerguntaClassificacao;
  historico: PerguntaCardHistorico[];
  queriesDisponiveis: QueryDisponivel[];
  categoryId?: number | null;
}): Promise<{ plano: PlanoConsulta; costUsd: number }> {
  const dataAtual = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const entradaJson = JSON.stringify(
    {
      pergunta: input.pergunta,
      data_atual: dataAtual,
      resultado_classificacao: input.classificacao,
      contexto_sessao: buildContextoSessao(input.historico),
      queries_disponiveis: input.queriesDisponiveis.map((q) => ({
        query_id: q.query_id,
        nome: q.nome,
        descricao: q.descricao,
        sentenca_sql: q.sentencaSql,
        colunas_select: extractSelectColumnNames(q.sentencaSql),
        params: q.params
          .filter((p) => !SYSTEM_PARAM_NAMES.has(p.nome.toLowerCase()))
          .map(({ nome, tipo, obrigatorio, operadorSql, normalizar, descricao_campo, exemplos_valores }) => ({
            nome,
            tipo,
            obrigatorio,
            operadorSql,
            normalizar,
            ...(descricao_campo ? { descricao_campo } : {}),
            ...(exemplos_valores?.length ? { exemplos_valores } : {}),
          })),
      })),
    },
    null,
    2
  );

  const user = `Planeje a execução estruturada.\n\nEntrada:\n${entradaJson}\n\nREGRA CRÍTICA 1: campo_medida e group_by DEVEM usar SOMENTE nomes exatos de colunas presentes em colunas_select da query selecionada. Nunca invente ou reutilize nomes de colunas de outra query. Para medidas sum/avg/min/max, campo_medida DEVE ser uma coluna numérica (ex: Valor_xxx, Qtde_xxx, Custo_xxx, Total_xxx, Saldo_xxx). NUNCA aplique sum/avg/min/max a colunas de texto como nomes, códigos ou descrições.\n\nREGRA CRÍTICA 2 — ÚLTIMO/MAIS RECENTE/PRIMEIRO: Quando a pergunta pede o ÚLTIMO, MAIS RECENTE, MAIS ANTIGO, PRIMEIRO ou um único registro específico por ordem (ex: "último pagamento", "nota mais recente", "primeiro lançamento"), você DEVE SEMPRE preencher agregacao com order_by na coluna de data apropriada e limit:1. NUNCA retorne agregacao:null nesses casos — sem order_by o banco retorna registros em ordem arbitrária e a resposta será errada.\n\nREGRA CRÍTICA 3 — MATCH EXATO vs PARCIAL: Para parâmetros de texto cujo operadorSql é LIKE, o backend usa match EXATO por padrão (sem wildcards, operador =). Use operador_sugerido: "LIKE" SOMENTE quando o usuário pedir busca PARCIAL com palavras como "contendo", "que tem X no nome", "começando com", "parecido com", "coringa", "parte do nome". Para todos os outros casos (código, nome exato, referência, CPF, CNPJ, busca normal), use operador_sugerido: "=" — o backend aplicará match exato.\n\nREGRA CRÍTICA 4 — HAVING: Use having_gt quando o usuário pedir para excluir grupos com resultado de agregação zero ou negativo (ex: "desconsiderar zeros", "somente com estoque", "apenas com saldo positivo"). Defina having_gt:0 para filtrar grupos cujo SUM/COUNT/etc. seja <= 0. Não use having_gt para filtros de linha individual — esses vão nos parâmetros da query.\n\nRetorne somente JSON neste formato:\n{"queries":[{"query_id":"","motivo_uso":"","prioridade":1,"parametros":[{"nome":"","termo_usuario":"","valor":null,"tipo":"texto|lista_texto|data|numero|boolean","operador_sugerido":"=|IN|NOT IN|BETWEEN|>=|<=|LIKE","obrigatorio":true,"precisa_normalizacao":true}],"agregacao":{"medida":"count|sum|avg|min|max|null","campo_medida":"nome_coluna_ou_null","group_by":["coluna"],"group_by_trunc":[{"campo":"coluna_data","granularidade":"year|month|week|day"}],"order_by":[{"campo":"coluna","direcao":"asc|desc"}],"limit":50,"having_gt":null},"cross_query_filter":[{"from_priority":1,"from_field":"nome_coluna_query_origem","to_param":"nome_param_query_destino"}]}],"dados_insuficientes":false,"pergunta_para_usuario":null,"observacoes":[]}`;

  const systemPrompt = await getActiveSystemPrompt("perguntas_pipe2_planejamento_estruturado_system", input.categoryId);
  const { text, costUsd } = await invokeLLM({
    system: systemPrompt,
    user,
    jsonObject: true,
    source: "planejamento_estruturado",
  });

  type RawPlano = {
    queries?: unknown[];
    dados_insuficientes?: boolean;
    pergunta_para_usuario?: string | null;
    observacoes?: string[];
  };

  const parsed = safeParseJson<RawPlano>(text, {});

  const queries: PlanoQuery[] = [];
  if (Array.isArray(parsed.queries)) {
    for (const q of parsed.queries) {
      if (q && typeof q === "object") {
        const qObj = q as Record<string, unknown>;
        const parametros: PlanoParam[] = [];
        if (Array.isArray(qObj.parametros)) {
          for (const p of qObj.parametros) {
            if (p && typeof p === "object") {
              const pObj = p as Record<string, unknown>;
              parametros.push({
                nome: String(pObj.nome ?? ""),
                termo_usuario: String(pObj.termo_usuario ?? ""),
                valor: pObj.valor ?? null,
                tipo: String(pObj.tipo ?? "texto"),
                operador_sugerido: String(pObj.operador_sugerido ?? "="),
                obrigatorio: Boolean(pObj.obrigatorio ?? false),
                precisa_normalizacao: Boolean(pObj.precisa_normalizacao ?? false),
              });
            }
          }
        }
        let agregacao: PlanoAgregacao | null = null;
        if (qObj.agregacao && typeof qObj.agregacao === "object") {
          const ag = qObj.agregacao as Record<string, unknown>;
          const MEDIDAS = ["count", "sum", "avg", "min", "max"] as const;
          type Medida = typeof MEDIDAS[number];
          const medida = MEDIDAS.includes(ag.medida as Medida) ? (ag.medida as Medida) : null;
          const group_by = Array.isArray(ag.group_by)
            ? (ag.group_by as unknown[]).filter((c): c is string => typeof c === "string" && c.length > 0)
            : [];
          const order_by = Array.isArray(ag.order_by)
            ? (ag.order_by as unknown[])
                .filter((o): o is Record<string, unknown> => o !== null && typeof o === "object")
                .map((o) => ({ campo: String(o.campo ?? ""), direcao: o.direcao === "desc" ? "desc" as const : "asc" as const }))
                .filter((o) => o.campo.length > 0)
            : [];
          // Limite padrão 100 para queries com GROUP BY/medida e sem limit explícito.
          // Evita que queries subsidiárias de comparação retornem todos os registros.
          const hasGroupOrMedida = MEDIDAS.includes(ag.medida as Medida) || Array.isArray(ag.group_by) && (ag.group_by as unknown[]).length > 0;
          const defaultLimit = hasGroupOrMedida ? 100 : null;
          const limit = typeof ag.limit === "number" && ag.limit > 0 ? Math.min(ag.limit, 1000) : defaultLimit;
          const GRANULARIDADES = ["year", "month", "week", "day"] as const;
          type Granularidade = typeof GRANULARIDADES[number];
          const group_by_trunc: PlanoAgregacaoTrunc[] = Array.isArray(ag.group_by_trunc)
            ? (ag.group_by_trunc as unknown[])
                .filter((t): t is Record<string, unknown> => t !== null && typeof t === "object")
                .map((t) => ({
                  campo: String(t.campo ?? ""),
                  granularidade: GRANULARIDADES.includes(t.granularidade as Granularidade) ? (t.granularidade as Granularidade) : "month",
                }))
                .filter((t) => t.campo.length > 0)
            : [];
          if (medida || group_by.length > 0 || group_by_trunc.length > 0 || order_by.length > 0 || limit) {
            agregacao = {
              medida,
              campo_medida: typeof ag.campo_medida === "string" && ag.campo_medida.length > 0 ? ag.campo_medida : null,
              group_by,
              ...(group_by_trunc.length > 0 ? { group_by_trunc } : {}),
              order_by,
              limit,
              ...(typeof ag.having_gt === "number" ? { having_gt: ag.having_gt } : {}),
            };
          }
        }
        // Parse cross_query_filter (referência cruzada de resultados entre queries)
        const cross_query_filter: PlanoCrossQueryFilter[] = Array.isArray(qObj.cross_query_filter)
          ? (qObj.cross_query_filter as unknown[])
              .filter((f): f is Record<string, unknown> => f !== null && typeof f === "object")
              .map((f) => ({
                from_priority: typeof f.from_priority === "number" ? f.from_priority : 0,
                from_field: String(f.from_field ?? ""),
                to_param: String(f.to_param ?? ""),
              }))
              .filter((f) => f.from_priority > 0 && f.from_field.length > 0 && f.to_param.length > 0)
          : [];

        queries.push({
          query_id: String(qObj.query_id ?? ""),
          motivo_uso: String(qObj.motivo_uso ?? ""),
          prioridade: typeof qObj.prioridade === "number" ? qObj.prioridade : 1,
          parametros,
          agregacao,
          ...(cross_query_filter.length > 0 ? { cross_query_filter } : {}),
        });
      }
    }
  }

  const plano: PlanoConsulta = {
    queries: queries.sort((a, b) => a.prioridade - b.prioridade),
    dados_insuficientes: Boolean(parsed.dados_insuficientes ?? false),
    pergunta_para_usuario:
      typeof parsed.pergunta_para_usuario === "string" ? parsed.pergunta_para_usuario : null,
    observacoes: parseStringArray(parsed.observacoes),
  };

  return { plano, costUsd };
}

// Padrões de nomes de colunas que indicam valor numérico (monetário, quantidade, etc.)
const NUMERIC_COL_RE = /^(valor|qtde|quantidade|custo|total|preco|preço|saldo|percentual|peso|volume|desconto|acrescimo|imposto|taxa|margem|lucro|receita|prazo|indice|índice|media|média|dias)_|_(valor|qtde|quantidade|custo|total|preco|preço|saldo|percentual|peso|volume|medio|médio|media|média|prazo|indice|índice|dias)$/i;
function isLikelyNumericColumn(col: string): boolean {
  return NUMERIC_COL_RE.test(col);
}

/**
 * Valida e sanitiza os campos de agregação contra as colunas disponíveis no SELECT do template.
 * Previne "Invalid column name" no SQL Server quando o LLM referencia colunas de outro template.
 */
function sanitizeAgregacaoCols(ag: PlanoAgregacao, sentencaSql: string): PlanoAgregacao {
  const available = new Set(extractSelectColumnNames(sentencaSql));
  if (available.size === 0) return ag; // não conseguiu extrair colunas — deixa passar
  let { medida, campo_medida, group_by, order_by } = ag;
  if (campo_medida && medida !== "count" && medida !== null) {
    if (!available.has(campo_medida.toLowerCase())) {
      console.warn(`[Pipe2] campo_medida "${campo_medida}" não existe no SELECT do template. Colunas disponíveis: ${[...available].join(", ")}`);
      campo_medida = null;
      medida = null;
    } else if ((medida === "sum" || medida === "avg") && !isLikelyNumericColumn(campo_medida)) {
      // SUM/AVG exigem coluna numérica. MIN/MAX funcionam em datas e textos — não bloquear.
      console.warn(`[Pipe2] campo_medida "${campo_medida}" não parece numérico para medida "${medida}". Removendo.`);
      campo_medida = null;
      medida = null;
    }
  }
  const validGroupBy = group_by.filter((c) => available.has(c.toLowerCase()));
  if (validGroupBy.length < group_by.length) {
    const removidos = group_by.filter((c) => !available.has(c.toLowerCase()));
    console.warn(`[Pipe2] group_by colunas inválidas removidas: ${removidos.join(", ")}`);
  }
  const campoDaMedidaLower = campo_medida?.toLowerCase() ?? null;
  const groupByLowerSet = new Set(validGroupBy.map((c) => c.toLowerCase()));
  // Sem medida (apenas ORDER BY + LIMIT): qualquer coluna do SELECT é válida para ordenar.
  // Com medida: restringe a aliases de medida, campo_medida ou group_by para evitar
  // SUM(col_varchar) gerado por applyAgregacao no SQL Server.
  const validOrderBy = order_by
    .map((o) => {
      const lower = o.campo.toLowerCase().replace(/^_base\./i, "");
      if (Object.prototype.hasOwnProperty.call(MEDIDA_ALIAS, lower)) return o;
      if (campoDaMedidaLower && lower === campoDaMedidaLower) return o;
      if (groupByLowerSet.has(lower)) return o;
      // Sem função de agregação: qualquer coluna disponível no SELECT é segura para ORDER BY
      if (!medida && available.has(lower)) return o;
      // Com agregação e coluna inválida: substitui pelo alias da medida
      const fallbackAlias = medida ? (MEDIDA_ALIAS[medida] ?? null) : null;
      if (fallbackAlias) {
        console.warn(`[Pipe2] order_by "${o.campo}" não é coluna de GROUP BY nem de medida. Substituindo por "${fallbackAlias}".`);
        return { ...o, campo: fallbackAlias };
      }
      console.warn(`[Pipe2] order_by "${o.campo}" removido (não encontrado no SELECT).`);
      return null;
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);
  return { ...ag, medida, campo_medida, group_by: validGroupBy, order_by: validOrderBy };
}

// ── Internal: execução das queries do plano ───────────────────────────────────

async function executarConsultasPlano(input: {
  plano: PlanoConsulta;
  queriesDisponiveis: QueryDisponivel[];
  userId: number;
  groupId: number | null;
}): Promise<{ agregado: PerguntaResultadoEstruturado; porQuery: QueryExecResultado[] }> {
  const { plano, queriesDisponiveis, userId, groupId } = input;

  const porQuery: QueryExecResultado[] = [];
  const allLinhas: Record<string, unknown>[] = [];
  let colunas: string[] = [];
  const sqlParts: string[] = [];
  const allValues: unknown[] = [];

  /** Mapa de prioridade → resultado. Usado para resolver cross_query_filter de tasks subsequentes. */
  const resultadosPorPrioridade = new Map<number, QueryExecResultado>();

  for (const task of plano.queries) {
    const template = queriesDisponiveis.find((q) => q.query_id === task.query_id);
    if (!template) continue;

    // Resolve cross_query_filter: extrai lista de valores de query origem e injeta como parâmetro IN/NOT IN
    const parametrosResolvidos: PlanoParam[] = [...task.parametros];
    if (task.cross_query_filter && task.cross_query_filter.length > 0) {
      for (const ref of task.cross_query_filter) {
        const origem = resultadosPorPrioridade.get(ref.from_priority);
        if (!origem) {
          throw new Error(
            `cross_query_filter inválido: query de prioridade ${ref.from_priority} não foi executada antes da prioridade ${task.prioridade}.`
          );
        }
        const paramDef = template.params.find((p) => p.nome.toLowerCase() === ref.to_param.toLowerCase());
        if (!paramDef) {
          throw new Error(
            `cross_query_filter inválido: query ${task.query_id} não tem parâmetro "${ref.to_param}" cadastrado. ` +
            `Cadastre o parâmetro com tipo "lista_texto" e operador IN ou NOT IN para suportar este tipo de pergunta.`
          );
        }
        const op = (paramDef.operadorSql ?? "").toUpperCase();
        if (op !== "IN" && op !== "NOT IN") {
          throw new Error(
            `cross_query_filter inválido: parâmetro "${ref.to_param}" da query ${task.query_id} tem operador "${paramDef.operadorSql}". ` +
            `Esperado IN ou NOT IN para receber lista de valores de outra query.`
          );
        }
        // Extrai valores únicos não-nulos do campo na query origem
        const fieldLower = ref.from_field.toLowerCase();
        const fieldKey = origem.colunas.find((c) => c.toLowerCase() === fieldLower) ?? ref.from_field;
        const valores = Array.from(new Set(
          origem.linhas
            .map((row) => row[fieldKey])
            .filter((v): v is string | number => v !== null && v !== undefined && v !== "")
            .map((v) => String(v))
        ));
        parametrosResolvidos.push({
          nome: ref.to_param,
          termo_usuario: `(de query prioridade ${ref.from_priority}.${ref.from_field})`,
          valor: valores,
          tipo: "lista_texto",
          operador_sugerido: paramDef.operadorSql,
          obrigatorio: false,
          precisa_normalizacao: false,
        });
      }
    }

    let linhas: Record<string, unknown>[];
    let colunasQuery: string[];

    if (template.conexaoId != null) {
      // Execução em SQL Server externo via mssql
      const paramValues: Record<string, unknown> = {
        userid: userId,
        groupid: groupId,
      };
      // operadorOverrides: LLM pode pedir "=" para suprimir o wrap com % do LIKE
      const operadorOverrides: Record<string, string> = {};
      for (const p of parametrosResolvidos) {
        if (p.nome) {
          paramValues[p.nome.toLowerCase()] = p.valor ?? null;
          if (p.operador_sugerido) operadorOverrides[p.nome.toLowerCase()] = p.operador_sugerido;
        }
      }
      let sqlToExecute = template.sentencaSql;
      if (task.agregacao) {
        const ag = sanitizeAgregacaoCols(task.agregacao, template.sentencaSql);
        try {
          sqlToExecute = applyAgregacao(template.sentencaSql, ag, "mssql");
        } catch (err) {
          console.warn("[Pipe2] applyAgregacao mssql ignorada:", err instanceof Error ? err.message : err);
        }
      }
      const result = await executeQueryMssql(
        template.conexaoId,
        sqlToExecute,
        paramValues,
        template.params.map((p) => ({ nome: p.nome, operadorSql: p.operadorSql })),
        operadorOverrides
      );
      linhas = result.linhas;
      colunasQuery = result.colunas;
      sqlParts.push(`[mssql:${template.conexaoId}] ${sqlToExecute}`);
      allValues.push(paramValues);
    } else {
      const { sql: baseSql, values } = bindTemplateParams(
        template.sentencaSql,
        parametrosResolvidos,
        template.params,
        { userid: userId, groupid: groupId }
      );

      let finalSql = baseSql;
      if (task.agregacao) {
        const ag = sanitizeAgregacaoCols(task.agregacao, template.sentencaSql);
        try {
          finalSql = applyAgregacao(baseSql, ag);
        } catch (err) {
          console.warn("[Pipe2] applyAgregacao ignorada:", err instanceof Error ? err.message : err);
        }
      }

      const [rows] = await pool.query<RowDataPacket[]>(finalSql, values);
      linhas = rows as Record<string, unknown>[];
      colunasQuery = linhas.length > 0 ? Object.keys(linhas[0]) : [];
      sqlParts.push(finalSql);
      allValues.push(...values);
    }

    const resultado: QueryExecResultado = { query_id: task.query_id, colunas: colunasQuery, linhas, totalLinhas: linhas.length };
    porQuery.push(resultado);
    resultadosPorPrioridade.set(task.prioridade, resultado);

    if (colunas.length === 0) colunas = colunasQuery;
    allLinhas.push(...linhas);
  }

  setLastLlmPromptTrace({
    provider: "sql",
    model: "PostgreSQL",
    source: "consulta_sql",
    messages: [
      {
        role: "system",
        content: `SQL executado:\n${sqlParts.join("\n---\n").replace(/\s+/g, " ").trim()}\n\nparâmetros: ${JSON.stringify(allValues)}`,
      },
      {
        role: "user",
        content: JSON.stringify(porQuery.map((r) => ({ query_id: r.query_id, linhas: r.linhas.slice(0, 20), totalLinhas: r.totalLinhas })), null, 2),
      },
    ],
  });

  return {
    agregado: { colunas, linhas: allLinhas, totalLinhas: allLinhas.length },
    porQuery,
  };
}

// ── Internal: síntese em linguagem natural ────────────────────────────────────

async function gerarRespostaEstruturada(input: {
  pergunta: string;
  plano: PlanoConsulta;
  porQuery: QueryExecResultado[];
  agregado: PerguntaResultadoEstruturado;
  categoryId?: number | null;
}): Promise<{ resposta: PerguntaResposta; costUsd: number }> {
  const queries_executadas = input.plano.queries.map((q) => ({
    query_id: q.query_id,
    motivo_uso: q.motivo_uso,
    prioridade: q.prioridade,
  }));

  const LIMITE_LINHAS_LLM = 20;

  const resultados = input.porQuery.map((r) => ({
    query_id: r.query_id,
    colunas: r.colunas,
    linhas: r.linhas.slice(0, LIMITE_LINHAS_LLM),
    total_linhas: r.totalLinhas,
  }));

  // Aviso injetado pelo backend quando o resultado foi truncado
  const avisosTruncamento: string[] = input.porQuery
    .filter((r) => r.totalLinhas > LIMITE_LINHAS_LLM)
    .map(
      (r) =>
        `Query ${r.query_id}: resultado contém ${r.totalLinhas} linhas mas apenas ${LIMITE_LINHAS_LLM} foram entregues ao modelo. Valores de soma, contagem ou total calculados a partir dessas linhas estão incompletos e podem estar incorretos. Informe essa limitação ao usuário e sugira usar um filtro mais específico ou reformular a pergunta com agregação.`
    );

  const parametros_aplicados = input.plano.queries.map((q) => ({
    query_id: q.query_id,
    parametros: q.parametros
      .filter((p) => p.valor !== null && p.valor !== undefined)
      .map((p) => ({ nome: p.nome, termo_usuario: p.termo_usuario, valor: p.valor })),
  }));

  const normalizacoes_aplicadas: unknown[] = [];

  const entradaJson = JSON.stringify(
    {
      pergunta: input.pergunta,
      queries_executadas,
      resultados,
      parametros_aplicados,
      normalizacoes_aplicadas,
      ...(avisosTruncamento.length > 0 ? { avisos_truncamento: avisosTruncamento } : {}),
    },
    null,
    2
  );

  const user = `Elabore a resposta final.\n\nEntrada:\n${entradaJson}\n\nRetorne somente JSON:\n{"resposta":"","tipo_resposta":"estruturada","dados_usados":[{"query_id":"","linhas_usadas":0}],"limitacoes":[],"confianca_estimada":0.0}`;

  // Trace dedicado mostrando as linhas do resultado entregues ao LLM de síntese
  setLastLlmPromptTrace({
    provider: "sql",
    model: "PostgreSQL",
    source: "resultado_sql",
    messages: resultados.map((r) => ({
      role: "assistant" as const,
      content: `[${r.query_id}] ${r.total_linhas} linha(s) total — ${r.linhas.length} entregue(s) ao LLM\ncolunas: ${r.colunas.join(", ")}\n\n${JSON.stringify(r.linhas, null, 2)}`,
    })),
  });

  const systemPrompt = await getActiveSystemPrompt("perguntas_pipe2_resposta_estruturada_system", input.categoryId);
  const { text, costUsd } = await invokeLLM({
    system: systemPrompt,
    user,
    jsonObject: true,
    source: "resposta_estruturada",
  });

  type RawResp = {
    resposta?: string;
    dados_usados?: { query_id?: string; linhas_usadas?: number }[];
    limitacoes?: string[];
    confianca_estimada?: number;
  };
  const parsed = safeParseJson<RawResp>(text, {});

  const respostaFallback = input.agregado.totalLinhas > 0 ? "Segue a listagem:" : "Não foi possível gerar uma resposta.";
  const resposta: PerguntaResposta = {
    resposta: parseRespostaStr(parsed.resposta, respostaFallback),
    tipo_resposta: "estruturada",
    dados_usados: [] as PerguntaMemoUsado[],
    limitacoes: parseStringArray(parsed.limitacoes),
    confianca_estimada: typeof parsed.confianca_estimada === "number"
      ? Math.min(Math.max(parsed.confianca_estimada, 0), 1)
      : 1.0,
    dados_estruturados: {
      ...input.agregado,
      linhas: input.agregado.linhas.slice(0, LIMITE_LINHAS_LLM),
    },
  };

  return { resposta, costUsd };
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function executarPipe2(input: Pipe2Input): Promise<Pipe2Result> {
  // Sem queries cadastradas: resposta informativa sem chamada LLM extra
  if (input.queriesDisponiveis.length === 0) {
    const resultado: PerguntaResultadoEstruturado = { colunas: [], linhas: [], totalLinhas: 0 };
    const resposta: PerguntaResposta = {
      resposta:
        "Não existem dados estruturados registrados para sua pergunta. Você pode reformular a pergunta ou usar a resposta semântica.",
      tipo_resposta: "estruturada",
      dados_usados: [],
      limitacoes: ["Nenhuma query disponível para a categoria classificada."],
      confianca_estimada: 0,
      dados_estruturados: resultado,
    };
    return { resposta, apiCost: 0, dadosEstruturados: resultado };
  }

  let totalCost = 0;

  const { plano, costUsd: c1 } = await planejarConsultaEstruturada({
    pergunta: input.pergunta,
    classificacao: input.classificacao,
    historico: input.historico,
    queriesDisponiveis: input.queriesDisponiveis,
    categoryId: input.categoryId,
  });
  totalCost += c1;

  // Queries executáveis = aquelas cujo query_id existe em queriesDisponiveis
  const executableQueries = plano.queries.filter((task) =>
    input.queriesDisponiveis.some((q) => q.query_id === task.query_id)
  );

  // Só bloqueia se não há nenhuma query executável — independente de dados_insuficientes
  if (executableQueries.length === 0) {
    const resultado: PerguntaResultadoEstruturado = { colunas: [], linhas: [], totalLinhas: 0 };
    const mensagem =
      plano.dados_insuficientes && plano.pergunta_para_usuario
        ? plano.pergunta_para_usuario
        : "Não foi possível identificar uma consulta adequada para a sua pergunta. Tente reformulá-la.";
    const resposta: PerguntaResposta = {
      resposta: mensagem,
      tipo_resposta: "estruturada",
      dados_usados: [],
      limitacoes: plano.observacoes,
      confianca_estimada: 0,
      dados_estruturados: resultado,
    };
    return { resposta, apiCost: totalCost, dadosEstruturados: resultado };
  }

  const planoExec = { ...plano, queries: executableQueries };
  const { agregado, porQuery } = await executarConsultasPlano({
    plano: planoExec,
    queriesDisponiveis: input.queriesDisponiveis,
    userId: input.userId,
    groupId: input.groupId,
  });

  const { resposta, costUsd: c2 } = await gerarRespostaEstruturada({
    pergunta: input.pergunta,
    plano: planoExec,
    porQuery,
    agregado,
    categoryId: input.categoryId,
  });
  totalCost += c2;

  return { resposta, apiCost: totalCost, dadosEstruturados: agregado };
}
