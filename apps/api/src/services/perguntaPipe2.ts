import type {
  AvisoQuerySnapshot,
  PerguntaCardHistorico,
  PerguntaClassificacao,
  PerguntaFiltros,
  PerguntaMemoUsado,
  PerguntaResposta,
  PerguntaResultadoEstruturado,
} from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { resolverValorStatus, type VerbosStatus } from "@mymemory/shared";
import { pool, queryIsoladaPorGrupo } from "../db.js";
import { executeQueryMssql } from "./adminDbConnectionsService.js";
import { invokeLLM } from "../lib/invokeLlm.js";
import { withSpan } from "../lib/requestTimings.js";
import { getActiveSystemPrompt } from "./llmPromptConfigService.js";
import { setLastLlmPromptTrace } from "./llmPromptTraceStore.js";
import { parseRespostaStr, parseStringArray } from "./perguntaParseUtils.js";
import { contextoDatas, REGRA_CALENDARIO } from "../lib/calendarioPergunta.js";
import {
  comparacaoParaLlm,
  comparacaoParaTabela,
  detectarComparacaoPeriodos,
  type ComparacaoPeriodos,
} from "../lib/comparacaoPeriodos.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QueryDisponivel {
  query_id: string;
  nome: string;
  descricao: string | null;
  sentencaSql: string;
  /** null = executa no PostgreSQL interno; número = ID da db_connections SQL Server */
  conexaoId: number | null;
  /** true = clonada sem conexão escolhida; não pode executar */
  conexaoPendente?: boolean;
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
    /** Campo do tipo status: valores fixos e verbos ("pagas" → Pago, "em aberto" → Aberto). */
    status?: { valores: string[]; verbos: VerbosStatus };
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
  /** Autor do escopo "Pessoal" (vira o parâmetro :autor das queries sobre memos). */
  escopoAutorId?: number | null;
}

export interface Pipe2Result {
  resposta: PerguntaResposta;
  apiCost: number;
  dadosEstruturados: PerguntaResultadoEstruturado;
  /** Snapshot das queries executadas — usado para criar avisos automáticos. */
  queriesParaAviso?: AvisoQuerySnapshot[];
  /** Plano efetivamente executado (só queries executáveis) — guardado nas perguntas salvas. */
  planoExecutado?: PlanoConsulta;
  /** Comparação entre dois períodos calculada em código (null/ausente = consulta comum). */
  comparacao?: ComparacaoPeriodos | null;
}

export interface PlanoParam {
  nome: string;
  termo_usuario: string;
  valor: unknown;
  tipo: string;
  operador_sugerido: string;
  obrigatorio: boolean;
  precisa_normalizacao: boolean;
  /** Termo que só descreve o tipo de coisa ("oficina", "compromisso"): sem resultado, a busca repete sem ele. */
  generico?: boolean;
}

interface PlanoAgregacaoTrunc {
  campo: string;
  granularidade: "year" | "month" | "week" | "day";
}

interface PlanoMedida {
  medida: "count" | "sum" | "avg" | "min" | "max";
  campo: string;
  alias?: string;
}

interface PlanoAgregacao {
  medida: "count" | "sum" | "avg" | "min" | "max" | null;
  campo_medida: string | null;
  /** Múltiplas funções de agregação simultâneas (ex: AVG(prazo) + AVG(atraso) na mesma query). */
  medidas?: PlanoMedida[];
  /** % entre duas medidas do mesmo grupo (ex.: margem % = 100 × margem / faturamento), calculado no banco. */
  percentuais?: { alias: string; numerador: string; denominador: string }[];
  /** Participação de cada grupo no total (ou no total de um recorte, dentro_de), calculada no banco por janela. */
  participacao?: { alias: string; medida: string; dentro_de?: string[] }[];
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

export interface PlanoConsulta {
  queries: PlanoQuery[];
  dados_insuficientes: boolean;
  pergunta_para_usuario: string | null;
  observacoes: string[];
  /** Comparação entre períodos: só itens com movimento nos dois períodos. */
  comparacao_somente_em_ambos?: boolean;
}

/** Id numérico da consulta (query_id do plano é o id da queries_categoria em texto). */
const idConsulta = (qid: string): { queryId?: number } => {
  const n = Number(qid);
  return Number.isInteger(n) && n > 0 ? { queryId: n } : {};
};

interface QueryExecResultado {
  query_id: string;
  colunas: string[];
  linhas: Record<string, unknown>[];
  totalLinhas: number;
  /** Consulta usada só como filtro (cross_query_filter) de outra — não vira tabela na resposta. */
  auxiliar?: boolean;
  /** Prioridade da tarefa do plano que gerou este resultado. */
  prioridade?: number;
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

// Garante que valores de parâmetros numéricos sejam números puros.
// O LLM às vezes retorna "1 suite" ou "3 quartos" em vez de 1 ou 3.
function coerceNumericParam(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  const str = String(val).trim();
  const match = /^-?(\d+([.,]\d+)?)/.exec(str);
  if (!match) return null;
  const n = parseFloat(match[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Data inexistente gerada pelo LLM (ex.: 2026-02-29, 2026-04-31) estoura no banco com erro de conversão.
 * Ajusta o dia para o último do mês; valores que não são YYYY-MM-DD passam como vieram.
 */
function coerceDateParam(val: unknown): unknown {
  if (typeof val !== "string") return val;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(val.trim());
  if (!m) return val;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1) return val;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diaOk = Math.min(dia, ultimoDia);
  return `${m[1]}-${m[2]}-${String(diaOk).padStart(2, "0")}`;
}

const ehTipoData = (tipo: string | undefined | null) => /^(date|data)$/i.test(tipo ?? "");

const semAcentoMin = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A pergunta quer SABER a data ("que dia está marcado…", "quando é…", "qual a data…"). */
export function perguntaPedeData(pergunta: string): boolean {
  const t = semAcentoMin(pergunta);
  return /\b(que|qual|quais|em que|para que|pra que)(?: (?:e|a|o|as|os|era|sera|foi))* (dia|dias|data|datas|hora|horas|horario)\b|\bquando\b|\bpara quando\b|\bpra quando\b/.test(t);
}

/** A pergunta cita um dia ou período (então a data é filtro, não resposta). */
export function perguntaCitaPeriodo(pergunta: string): boolean {
  const t = semAcentoMin(pergunta);
  return (
    /\d{1,2}\s*\/\s*\d{1,2}|\b\d{4}\b|\bdia \d{1,2}\b|\b\d{1,2} de [a-z]+/.test(t) ||
    /\b(hoje|amanha|ontem|anteontem|depois de amanha|semana|semanal|mes|meses|ano|anos|trimestre|semestre|fim de semana|feriado)\b/.test(t) ||
    /\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(t) ||
    /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(t) ||
    /\b(proxim[oa]s?|passad[oa]s?|ultim[oa]s?|seguinte|anterior|desde|ate|entre|antes|depois)\b/.test(t)
  );
}

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

/**
 * Colunas do SELECT que guardam NÚMERO como texto: vêm de campo de memo (`...->>'Campo' AS col`, sempre texto)
 * e a query declara o campo como número (parâmetros `col_ini`/`col_fin` do tipo número). SUM/AVG/MIN/MAX nelas
 * precisam passar por mymemory_parse_number: no PostgreSQL `avg(text)` não existe ("function avg(text) does not
 * exist"). Colunas que já são numéricas de verdade (cast, função, tabela) ficam de fora e não são tocadas.
 */
export function colunasNumericasEmTexto(sentencaSql: string, params: { nome: string; tipo: string }[]): Set<string> {
  const declaradas = new Set<string>();
  for (const p of params) {
    const m = /^(.+)_(ini|fin)$/i.exec(p.nome);
    if (m && /^(number|numeric|numero)$/i.test(p.tipo)) declaradas.add(m[1].toLowerCase());
  }
  const out = new Set<string>();
  if (!declaradas.size) return out;
  const sel = /\bSELECT\b([\s\S]+?)\bFROM\b/i.exec(sentencaSql);
  if (!sel) return out;
  for (const item of sel[1].split(",")) {
    const t = item.trim().replace(/\s+/g, " ");
    const as = /\bAS\s+[\[\"`]?(\w+)[\]\"`]?\s*$/i.exec(t);
    if (!as) continue;
    const col = as[1].toLowerCase();
    const ehTextoDoJson = /->>/.test(t);
    const jaEhNumero = /::\s*(numeric|int|integer|float|double|decimal)|mymemory_parse_number|\bcast\s*\(/i.test(t);
    if (declaradas.has(col) && ehTextoDoJson && !jaEhNumero) out.add(col);
  }
  return out;
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

export function applyAgregacao(
  baseSql: string,
  ag: PlanoAgregacao,
  dialect: "pg" | "mssql" = "pg",
  /** Colunas que guardam número como texto (campos de memo): entram em SUM/AVG/MIN/MAX por mymemory_parse_number. */
  textoNumerico?: Set<string>
): string {
  const cleanBase = stripLimitOffset(baseSql);
  const qi = (name: string) => sanitizeIdentifier(name, dialect);

  // Remove prefixo "_base." que o LLM às vezes inclui nos nomes de coluna
  const stripBase = (name: string) => name.replace(/^_base\./i, "");

  // Argumento de uma função de agregação: coluna de texto com número vira número (só PostgreSQL)
  const numArg = (campo: string) => {
    const nome = stripBase(campo);
    return dialect === "pg" && textoNumerico?.has(nome.toLowerCase()) ? `mymemory_parse_number(${qi(nome)})` : qi(nome);
  };

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

  // SQL Server: AVG de coluna inteira devolve inteiro truncado (média 0,8 dias → 0)
  const avgArg = (col: string) => (dialect === "mssql" ? `CAST(${col} AS FLOAT)` : col);

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
      // Coluna "AAAA-MM" (ex.: mes da view de lançamentos) não é data completa: completa com o dia 1º
      expr = `DATE_TRUNC('${t.granularidade}', COALESCE(mymemory_parse_date(${colQ}::text), mymemory_parse_date(${colQ}::text || '-01'))::timestamp)`;
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

  // Sem função de medida E sem medidas[] — apenas ORDER BY + LIMIT (ex.: "mostre os 10 mais recentes")
  if (!ag.medida && !(ag.medidas && ag.medidas.length > 0)) {
    // group_by sem medida não agrega nada: antes virava SELECT só das colunas do grupo e perdia os valores
    // (ex.: consulta que já soma por grupo → só "grupo", sem o total). Mantém todas as colunas; só a data
    // truncada (agrupamento por período) seleciona as colunas do grupo.
    const cols = "*";
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

  // Participação com uma medida simples (medida + campo_medida): passa a ser medidas[] de um item
  if (ag.participacao?.length && !(ag.medidas && ag.medidas.length > 0) && ag.medida) {
    const ALS: Record<string, string> = { sum: "total", avg: "media", min: "minimo", max: "maximo", count: "contagem" };
    if (ag.medida === "count" || ag.campo_medida) {
      ag = { ...ag, medidas: [{ medida: ag.medida, campo: ag.campo_medida ?? "*", alias: ALS[ag.medida] }] };
    }
  }

  // Multi-medida: quando o LLM especificou medidas[] com 2+ funções simultâneas
  if (ag.medidas && ag.medidas.length > 0) {
    const FN: Record<string, string> = { sum: "SUM", avg: "AVG", min: "MIN", max: "MAX", count: "COUNT" };
    const AL: Record<string, string> = { sum: "total", avg: "media", min: "minimo", max: "maximo", count: "contagem" };
    const aliasDe = (m: PlanoMedida) => m.alias || `${AL[m.medida]}_${stripBase(m.campo).toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    const fnDe = (m: PlanoMedida) => {
      const arg = m.medida === "count" ? "*" : numArg(m.campo);
      return `${FN[m.medida]}(${m.medida === "avg" ? avgArg(arg) : arg})`;
    };
    const exprPorAlias = new Map(ag.medidas.map((m) => [aliasDe(m).toLowerCase(), fnDe(m)]));
    const measureExprs = ag.medidas.map((m) => `${fnDe(m)} AS ${aliasDe(m)}`);
    // % entre duas medidas (margem %, participação): 100 × num / den, nulo quando o denominador é zero
    const percentAliases = new Set<string>();
    for (const pc of ag.percentuais ?? []) {
      const num = exprPorAlias.get(pc.numerador.toLowerCase());
      const den = exprPorAlias.get(pc.denominador.toLowerCase());
      if (!num || !den || exprPorAlias.has(pc.alias.toLowerCase())) continue;
      const razao = `100.0 * ${num} / NULLIF(${den}, 0)`;
      measureExprs.push(`${dialect === "pg" ? `ROUND((${razao})::numeric, 2)` : `ROUND(${razao}, 2)`} AS ${pc.alias}`);
      percentAliases.add(pc.alias.toLowerCase());
    }
    // Participação no total (ou no total de um recorte): 100 × medida do grupo / soma da medida em todos os grupos
    // (SUM(SUM(x)) OVER (PARTITION BY recorte)) — igual no PostgreSQL e no SQL Server, calculado antes do LIMIT.
    const groupExprPorCol = new Map(ag.group_by.map((c, i) => [stripBase(c).toLowerCase(), groupByParts[i]]));
    for (const pt of ag.participacao ?? []) {
      const chave = pt.medida.toLowerCase();
      const m =
        ag.medidas.find((x) => aliasDe(x).toLowerCase() === chave) ??
        ag.medidas.find((x) => stripBase(x.campo).toLowerCase() === chave) ??
        ag.medidas[0];
      const al = pt.alias.toLowerCase();
      if (!m || exprPorAlias.has(al) || percentAliases.has(al)) continue;
      const expr = fnDe(m);
      const particao = (pt.dentro_de ?? [])
        .map((c) => groupExprPorCol.get(stripBase(c).toLowerCase()))
        .filter((e): e is string => !!e);
      const janela = `SUM(${expr}) OVER (${particao.length ? `PARTITION BY ${particao.join(", ")}` : ""})`;
      const razao = `100.0 * ${expr} / NULLIF(${janela}, 0)`;
      measureExprs.push(`${dialect === "pg" ? `ROUND((${razao})::numeric, 2)` : `ROUND(${razao}, 2)`} AS ${pt.alias}`);
      percentAliases.add(al);
    }
    // ORDER BY numa coluna que já é medida (ex.: SUM(Lucro) AS margem): ordena pela medida, sem coluna extra
    const medidaPorCampo = new Map<string, string>();
    for (const m of ag.medidas) {
      const k = stripBase(m.campo).toLowerCase();
      if (m.medida !== "count" && (!medidaPorCampo.has(k) || m.medida === "sum")) medidaPorCampo.set(k, aliasDe(m));
    }
    const medidaAliasLowers = new Set([...ag.medidas.map((m) => aliasDe(m).toLowerCase()), ...percentAliases]);
    const groupByLowersMulti = new Set(ag.group_by.map((c) => stripBase(c).toLowerCase()));
    const multiOrderExtras: { alias: string; expr: string }[] = [];
    const multiOrderClauses: string[] = [];
    const multiOrderSeen = new Set<string>();
    for (const o of ag.order_by) {
      const name = normalizeOrderCampo(o.campo);
      const lower = name.toLowerCase();
      let resolved: string;
      if (medidaAliasLowers.has(lower) || MEDIDA_ALIAS[lower]) {
        resolved = MEDIDA_ALIAS[lower] ?? name;
      } else if (medidaPorCampo.has(lower)) {
        resolved = medidaPorCampo.get(lower)!;
      } else if (groupByLowersMulti.has(lower)) {
        resolved = name;
      } else {
        const extraAlias = `ord_${lower.replace(/[^a-z0-9_]/g, "_")}`;
        if (!multiOrderExtras.some((e) => e.alias === extraAlias)) {
          multiOrderExtras.push({ alias: extraAlias, expr: `SUM(${numArg(name)}) AS ${extraAlias}` });
        }
        resolved = extraAlias;
      }
      if (!multiOrderSeen.has(resolved.toLowerCase())) {
        multiOrderSeen.add(resolved.toLowerCase());
        multiOrderClauses.push(`${qi(resolved)} ${o.direcao === "desc" ? "DESC" : "ASC"}`);
      }
    }
    const baseSelect = groupSelectParts.length > 0
      ? `${groupSelectParts.join(", ")}, ${measureExprs.join(", ")}`
      : measureExprs.join(", ");
    const selectList = multiOrderExtras.length > 0
      ? `${baseSelect}, ${multiOrderExtras.map((e) => e.expr).join(", ")}`
      : baseSelect;
    let sql = `WITH _base AS (\n${cleanBase}\n) SELECT ${topN}${selectList} FROM _base`;
    if (groupByParts.length > 0) sql += ` GROUP BY ${groupByParts.join(", ")}`;
    if (multiOrderClauses.length) sql += ` ORDER BY ${multiOrderClauses.join(", ")}`;
    sql += limitClause;
    return sql;
  }

  // Aqui ag.medida é garantidamente não-nulo (medidas[] retornou acima; !medida+!medidas retornou acima)
  if (!ag.medida) throw new Error("medida obrigatório para agregação simples");

  let measureAlias: string;
  let measureExpr: string;
  let measureFnExpr: string; // sem alias — usado no HAVING
  if (ag.medida === "count") {
    measureAlias = "contagem";
    measureFnExpr = "COUNT(*)";
    measureExpr = `${measureFnExpr} AS ${measureAlias}`;
  } else {
    if (!ag.campo_medida) throw new Error(`campo_medida obrigatório para medida "${ag.medida}"`);
    const col = numArg(ag.campo_medida);
    const fnName = { sum: "SUM", avg: "AVG", min: "MIN", max: "MAX" }[ag.medida];
    measureAlias = { sum: "total", avg: "media", min: "minimo", max: "maximo" }[ag.medida];
    measureFnExpr = `${fnName}(${ag.medida === "avg" ? avgArg(col) : col})`;
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
      orderByExtras.push({ alias, expr: `SUM(${numArg(name)}) AS ${alias}` });
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
  const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const matchFull = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (matchFull) {
    const [, yyyy, mm, dd] = matchFull;
    const mes = MESES[parseInt(mm, 10) - 1] ?? mm;
    const d = parseInt(dd, 10);
    return [
      `%${dd}/${mm}/${yyyy}%`,
      `%${isoDate}%`,
      `%${d} de ${mes} de ${yyyy}%`,
    ];
  }
  const matchMonth = /^(\d{4})-(\d{2})$/.exec(isoDate);
  if (matchMonth) {
    const [, yyyy, mm] = matchMonth;
    const mes = MESES[parseInt(mm, 10) - 1] ?? mm;
    return [
      `%/${mm}/${yyyy}%`,
      `%${yyyy}-${mm}%`,
      `%${yyyy}/${mm}%`,
      `% de ${mes} de ${yyyy}%`,
    ];
  }
  return [`%${isoDate}%`];
}

/** Tratamentos e palavras de ligação que não identificam ninguém ("sr. Wilson da FAPESP" → wilson, fapesp). */
const PALAVRAS_IGNORADAS = new Set([
  "sr", "sra", "srta", "dr", "dra", "prof", "profa", "eng", "o", "a", "os", "as",
  "de", "da", "do", "das", "dos", "e", "em", "com", "para", "um", "uma",
]);

/** Palavras do valor de busca, sem acento, sem tratamentos e sem palavras de ligação. */
/**
 * Parâmetro de situação (Situação/Status/Estado) com o estado dito do jeito do usuário
 * ("canceladas", "concluídas", "feitas", "encerradas"): devolve o padrão que casa com o valor
 * gravado (Cancelado, Concluído). "Encerradas" = os dois. Fora disso, null (busca normal).
 */
export function padraoSituacao(nomeParam: string, valorSemAcento: string): string | null {
  if (!/situac|status|estado/i.test(nomeParam)) return null;
  const v = valorSemAcento.trim().toLowerCase();
  // "Todos" / "incluindo concluídos": não filtra ("" casa com qualquer situação gravada)
  if (/^(tod[oa]s|qualquer|inclu)/.test(v)) return "";
  // Pendente = aberto: tudo que não é Concluído nem Cancelado (Pendente, Válido, o "Ativo" antigo)
  if (/^(pendent|ativ|abert|valid|vigent|a fazer|em aberto)/.test(v)) return "^(?!\\s*(conclu|cancel))";
  if (/^(encerrad|finalizad|fechad)/.test(v) || (/conclu/.test(v) && /cancel/.test(v))) return "\\m(conclu|cancel)";
  // Concluído, com qualquer nome que a categoria dê a ele (Comprado, Pago, Recebido, Realizado)
  if (/^(conclu|feit|terminad|comprad|realizad|pag[oa]s?$|recebid|entregu)/.test(v)) return "\\mconclu";
  if (/^(revogad|estornad|anulad)/.test(v)) return "\\mcancel";
  if (/^cancel/.test(v)) return "\\mcancel";
  return null;
}

export function palavrasDeBusca(valor: string): string[] {
  return [
    ...new Set(
      valor
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w && !PALAVRAS_IGNORADAS.has(w))
    ),
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
export function bindTemplateParams(
  sentencaSql: string,
  llmParams: PlanoParam[],
  paramDefs: QueryDisponivel["params"],
  systemParams: { userid: number; groupid: number | null; autor?: number | null }
): { sql: string; values: unknown[] } {
  // "col ILIKE '%' || :p || '%'" (consultas do financeiro) não passava pelo unaccent de "col ILIKE :p": grupo
  // "Condominio" não achava "condomínio". Os dois lados ficam sem acento (só PostgreSQL interno usa esta função).
  sentencaSql = sentencaSql.replace(
    /([A-Za-z_][\w.]*)\s+ILIKE\s+'%'\s*\|\|\s*:(\w+)\s*\|\|\s*'%'/g,
    (_m, col: string, p: string) => `unaccent(${col}::text) ILIKE '%' || unaccent(CAST(:${p} AS text)) || '%'`
  );
  // Chaves em lowercase para comparação case-insensitive (SQL usa :groupId, mapa guarda "groupid")
  const paramMap: Record<string, unknown> = {
    userid: systemParams.userid,
    groupid: systemParams.groupid,
    // Escopo "Pessoal": queries escritas à mão podem usar (:autor IS NULL OR m.userid = :autor).
    // Nulo = sem escopo; query que não declara :autor não é afetada.
    autor: systemParams.autor ?? null,
  };
  // operador_sugerido por param: "=" suprime wrap com % mesmo que paramDef tenha operadorSql LIKE
  const llmOpMap = new Map<string, string>();
  const defByName = new Map(paramDefs.map((p) => [p.nome.toLowerCase(), p]));
  for (const p of llmParams) {
    if (p.nome) {
      const key = p.nome.toLowerCase();
      const def = defByName.get(key);
      const isNumeric = /^(number|numeric|numero)$/i.test(def?.tipo ?? p.tipo ?? "");
      paramMap[key] = isNumeric
        ? coerceNumericParam(p.valor)
        : ehTipoData(def?.tipo ?? p.tipo) ? (coerceDateParam(p.valor) ?? null) : (p.valor ?? null);
      if (p.operador_sugerido) llmOpMap.set(key, p.operador_sugerido);
    }
  }

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
  const re = /(?<!:):([a-zA-Z\p{L}][a-zA-Z0-9_\p{L}]*)/gu;
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
    if (paramMap[key] == null) continue;
    const before = sentencaSql.slice(0, token.start);
    const colInfo = extractColBeforeLike(before);
    // Processa expansão se operadorSql tem LIKE OU se o SQL tem ILIKE antes do placeholder
    if (!/LIKE/i.test(def?.operadorSql ?? "") && !colInfo) continue;
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
    const isLikeParam = /LIKE/i.test(def?.operadorSql ?? "");
    // Garante cast text mesmo quando operadorSql não tem LIKE mas o SQL usa ILIKE antes do placeholder
    const isSqlLikeCtx = /\bI?LIKE\s*$/i.test(sentencaSql.slice(0, token.start));
    const cast = (isLikeParam || isSqlLikeCtx) ? "text" : (SYSTEM_PARAM_CAST[key] ?? TIPO_PG_CAST[def?.tipo ?? ""] ?? "text");

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
        const situacao = padraoSituacao(key, stripped);
        const valorStatus = def?.status ? resolverValorStatus(stripped, def.status.valores, def.status.verbos) : null;
        if (valorStatus) {
          // Status: o valor da lista, inteiro ("abertas" → Aberto)
          result += `unaccent(${token.colExpr}) ILIKE ?::text`;
          values.push(valorStatus.normalize("NFD").replace(/\p{Mn}/gu, ""));
        } else if (situacao !== null) {
          // "canceladas", "concluídas", "encerradas" x valor gravado "Cancelado"/"Concluído"
          result += `unaccent(${token.colExpr}) ~* ?::text`;
          values.push(situacao);
        } else if (wantLike) {
          // Várias palavras ("Wilson FAPESP" x "Sr. Wilson da FAPESP"): cada palavra precisa estar no
          // campo, em qualquer ordem e com qualquer coisa entre elas; achar o trecho colado era frágil.
          // Uma palavra só: busca por trecho, como antes. Aceita tudo que o trecho colado aceitava.
          const palavrasLike = palavrasDeBusca(stripped);
          if (palavrasLike.length > 1) {
            result += `(${palavrasLike.map(() => `unaccent(${token.colExpr}) ILIKE ?::text`).join(" AND ")})`;
            for (const w of palavrasLike) values.push(`%${w}%`);
          } else {
            result += `unaccent(${token.colExpr}) ILIKE ?::text`;
            values.push(`%${stripped}%`);
          }
        } else {
          // Memos guardam texto livre extraído pela IA ("Sr. Wilson da FAPESP"): cada palavra
          // relevante do valor precisa aparecer inteira no campo, em qualquer ordem.
          const palavras = palavrasDeBusca(stripped);
          if (palavras.length) {
            result += `(${palavras.map(() => `unaccent(${token.colExpr}) ~* ?::text`).join(" AND ")})`;
            for (const w of palavras) values.push(`\\m${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\M`);
          } else {
            // Só palavras vazias ("o", "da"): ILIKE sem wildcard = exato, sem maiúscula nem acento
            result += `unaccent(${token.colExpr}) ILIKE ?::text`;
            values.push(stripped);
          }
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
      if (val === null || val === undefined) {
        // Sem valor: NULL literal, sem cast. Com "?::text" o PostgreSQL valida os tipos antes de executar e
        // um filtro não usado com tipo cadastrado errado (ex.: date >= text) derrubava a pergunta inteira.
        // Com cast do próprio template (":param::numeric") vira "NULL::numeric", também válido.
        result += "NULL";
        pos = token.end;
        continue;
      }
      if (/LIKE/i.test(def?.operadorSql ?? "") && llmOpMap.get(key) === "LIKE") {
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

/**
 * Regras do planejador. As gerais vão sempre; as específicas só quando a pergunta ou as consultas pedem (ex.: guia
 * de % só com %/percentual/margem; histórico só quando há a consulta "Alterações"), para o prompt não crescer a
 * cada ajuste.
 */
const REGRAS_PLANEJADOR: { n: number; texto: string }[] = [
  { n: 1, texto: `REGRA CRÍTICA 1: campo_medida e group_by DEVEM usar SOMENTE nomes exatos de colunas presentes em colunas_select da query selecionada. Nunca invente ou reutilize nomes de colunas de outra query. Para medidas sum/avg/min/max, campo_medida DEVE ser uma coluna numérica (ex: Valor_xxx, Qtde_xxx, Custo_xxx, Total_xxx, Saldo_xxx). NUNCA aplique sum/avg/min/max a colunas de texto como nomes, códigos ou descrições.` },
  { n: 2, texto: `REGRA CRÍTICA 2 — ÚLTIMO/MAIS RECENTE/PRIMEIRO: Quando a pergunta pede o ÚLTIMO, MAIS RECENTE, MAIS ANTIGO, PRIMEIRO ou um único registro específico por ordem (ex: "último pagamento", "nota mais recente", "primeiro lançamento"), você DEVE SEMPRE preencher agregacao com order_by na coluna de data apropriada e limit:1. NUNCA retorne agregacao:null nesses casos — sem order_by o banco retorna registros em ordem arbitrária e a resposta será errada.` },
  { n: 3, texto: `REGRA CRÍTICA 3 — MATCH EXATO vs PARCIAL: Para parâmetros de texto cujo operadorSql é LIKE, o backend usa match EXATO por padrão (sem wildcards, operador =). Use operador_sugerido: "LIKE" SOMENTE quando o usuário pedir busca PARCIAL com palavras como "contendo", "que tem X no nome", "começando com", "parecido com", "coringa", "parte do nome". Para todos os outros casos (código, nome exato, referência, CPF, CNPJ, busca normal), use operador_sugerido: "=" — o backend aplicará match exato. Nas queries de memos (PostgreSQL interno) o backend compara texto por PALAVRAS (cada palavra do valor precisa estar no campo, ignorando "sr.", "da", "de"): envie o valor como o usuário disse, sem cortar nem completar. PROIBIÇÕES ABSOLUTAS: (1) NUNCA inclua "%" ou qualquer wildcard no campo "valor" do parâmetro — o backend gerencia wildcards internamente; (2) NUNCA use contexto de perguntas anteriores da sessão para decidir usar LIKE — baseie-se EXCLUSIVAMENTE na intenção explícita da pergunta atual.` },
  { n: 4, texto: `REGRA CRÍTICA 4 — HAVING: Use having_gt quando o usuário pedir para excluir grupos com resultado de agregação zero ou negativo (ex: "desconsiderar zeros", "somente com estoque", "apenas com saldo positivo"). Defina having_gt:0 para filtrar grupos cujo SUM/COUNT/etc. seja <= 0. Não use having_gt para filtros de linha individual — esses vão nos parâmetros da query.` },
  { n: 5, texto: `REGRA CRÍTICA 5 — CROSS_QUERY_FILTER: O campo to_param DEVE ser o nome de um parâmetro com operadorSql "IN" ou "NOT IN". Nunca aponte to_param para um parâmetro com operadorSql "=" ou "LIKE". Quando a query destino tiver dois parâmetros para o mesmo conceito (ex: abrev_cliente com operador = e abrev_cliente_IN com operador IN), use SEMPRE o parâmetro com operador IN.` },
  { n: 6, texto: `REGRA CRÍTICA 6 — FATURADO/FATURAMENTO = VALOR: Os termos "faturado", "faturamento", "faturou" ou "total faturado", sozinhos, significam por padrão o VALOR MONETÁRIO faturado — use a coluna de valor da nota/produto faturado (ex: Valor_NF, Valor_Prod_Fat) como campo_medida. Use colunas de quantidade (Qtde_xxx) SOMENTE quando a pergunta explicitar quantidade (ex: "quantidade faturada", "qtde faturada", "quantas unidades faturadas"). Preço unitário, custo, impostos etc. só quando citados explicitamente.` },
  { n: 7, texto: `REGRA CRÍTICA 7 — ORIGEM DO CROSS_QUERY_FILTER: from_field DEVE ser uma coluna presente em colunas_select da query de ORIGEM (a de prioridade from_priority). Se a query de origem não tiver essa coluna (ex.: cabeçalho de pedido sem Codigo_Produto), use como origem outra query que a tenha (ex.: a versão detalhada por produto). Sem query de origem adequada, não use cross_query_filter e registre a limitação em observacoes.` },
  { n: 8, texto: `REGRA CRÍTICA 8 — DURAÇÃO EM HORAS: Parâmetros _INI/_FIN de campos de duração ou tempo (ex.: duracao_ini, tempo_fin) são comparados em HORAS decimais. Converta o que o usuário disser: "uma hora e meia" → 1.5; "90 minutos" → 1.5; "meia hora" → 0.5; "mais que 2 horas" → _INI = 2.` },
  { n: 9, texto: `REGRA CRÍTICA 9 — UMA EXPRESSÃO, UM PARÂMETRO: Os parâmetros de uma query são combinados com E. Uma mesma expressão da pergunta que identifica alguém ou algo (ex.: "sr. Wilson da FAPESP" = pessoa + empresa dela) vai INTEIRA para um único parâmetro — o do campo cuja descrição melhor corresponde (ex.: Com quem). NUNCA a divida entre dois parâmetros (ex.: Wilson em com_quem e FAPESP em assunto): se a outra parte não estiver no segundo campo, o resultado fica vazio.` },
  { n: 11, texto: `REGRA CRÍTICA 11 — ORDENAÇÃO: Quando a pergunta pedir ordem ("ordene por X", "em ordem alfabética", "de A a Z", "do maior para o menor", "mais recentes primeiro"), a ordenação é feita NO BANCO: preencha agregacao com order_by [{"campo": coluna exata de colunas_select, "direcao": "asc"|"desc"}]. Numa listagem sem agrupamento use medida null, group_by [] e limit null (a lista vem inteira, só ordenada). NUNCA deixe a ordenação para o frontend ou para a síntese — ninguém ordena depois.` },
  { n: 12, texto: `REGRA CRÍTICA 12 — COMPARAÇÃO/VARIAÇÃO ENTRE PERÍODOS: Quando a pergunta pedir variação, evolução ou comparação entre dois períodos (ex.: "% variação de fevereiro sobre janeiro", "comparar março com abril"), monte EXATAMENTE DUAS entradas com o MESMO query_id, parâmetros idênticos exceto as datas (_INI/_FIN de cada período, a mais antiga com prioridade 1), e a MESMA agregacao nas duas: group_by pelo item (ex.: código e descrição do produto), medida "sum" (ou medidas[] com várias somas, ex.: faturamento e custo total, na mesma ordem e com o MESMO alias nas duas — sem o mês no alias, ex.: \"faturamento\", \"cmv\"), limit 1000, sem cross_query_filter. O sistema cruza os dois períodos e calcula as variações em valor e %. Se a pergunta pedir só os itens presentes nos DOIS períodos (ex.: "somente produtos que tiveram faturamento em janeiro e também em fevereiro"), preencha "comparacao_somente_em_ambos": true — NÃO use cross_query_filter nem consultas extras para isso. SÉRIE (cada mês sobre o anterior, "crescimento mensal", "variação mês a mês", "evolução mensal"): NÃO é a comparação acima — use UMA só consulta com group_by [data] e group_by_trunc mensal (ou a granularidade pedida) cobrindo todo o período pedido, order_by na data asc; o sistema acrescenta a coluna de variação % de cada período sobre o anterior. Nunca divida a série em várias consultas nem crie consulta para meses sem dados.` },
  { n: 13, texto: `REGRA CRÍTICA 13 — REMARCADO/ALTERADO/CANCELADO (HISTÓRICO): Perguntas sobre o que foi remarcado, alterado, mudado, adiado, antecipado, cancelado ou concluído, ou sobre o histórico de um memo (ex.: \"o que foi remarcado esta semana\", \"quando a reunião com o Carlos foi mudada\", \"o que foi cancelado em outubro\") usam a consulta \"Alterações — <categoria>\" (lê o histórico; uma linha por campo alterado, com valor_anterior, valor_novo e alterado_em). NÃO use a Query padrão para isso: ela só tem o valor atual e não sabe o que mudou. Filtros: (a) \"remarcado/alterado/cancelado NESTA semana / EM outubro / ontem\" = QUANDO a alteração foi feita → alterado_em_ini/alterado_em_fin; (b) \"remarcado PARA esta semana / PARA sexta\" = a NOVA data → valor_novo_ini/valor_novo_fin (e campo_alterado com o nome do campo de data, se houver mais de um); (c) \"cancelado\" ou \"concluído\" → campo_alterado = nome do campo de situação (ex.: Situação) e valor_novo = Cancelado ou Concluído; (d) \"remarcado\" sem dizer o campo → campo_alterado = o campo de data (ou de horário, se a pergunta falar de hora). Quem/o quê (ex.: \"reunião com o Carlos\") vai no parâmetro do campo correspondente dessa mesma consulta. Sem período citado, não preencha alterado_em_*. ATENÇÃO: o ESTADO ATUAL (\"listas canceladas\", \"tarefas concluídas\", \"o que está encerrado\", \"listas fechadas\"), sem perguntar QUANDO mudou nem o que mudou, NÃO é histórico: use a Query padrão com o parâmetro de situação (valor Concluído ou Cancelado; \"encerradas\"/\"fechadas\" → Encerrado, que cobre os dois). INCLUINDO: \"incluindo/inclusive/também os concluídos e cancelados\", \"todas, até as encerradas\" pedem TUDO (ativos e encerrados): parâmetro de situação = Todos.` },
  { n: 14, texto: `REGRA CRÍTICA 14 — DATA É A RESPOSTA: Quando a pergunta quer SABER a data ou o dia (\"que dia está marcado…\", \"quando é…\", \"qual a data…\") e não cita dia nem período, NÃO preencha nenhum parâmetro de data: a data é o que se procura. Nunca copie datas, filtros ou períodos de perguntas anteriores da sessão (contexto_sessao) para a pergunta atual, a não ser que ela os retome explicitamente (\"e nesse dia?\", \"e na semana seguinte?\").` },
  { n: 15, texto: `REGRA CRÍTICA 15 — TERMO GENÉRICO: Num parâmetro de texto cujo valor só descreve o TIPO de coisa ou de lugar, e não identifica o registro (ex.: \"levar o carro na oficina\" → \"oficina\"; \"compromisso\", \"agendamento\", \"evento\", \"registro\", \"anotação\"), marque \"generico\": true. Não use termos genéricos como único filtro quando a pergunta tem outro termo que identifica (ex.: \"carro\"). O sistema aplica o termo genérico e, só se nada for encontrado, repete a busca sem ele. Termos que identificam (nomes, pessoas, objetos, assuntos específicos) ficam com \"generico\": false.` },
  { n: 16, texto: `REGRA CRÍTICA 16 — PERCENTUAL ENTRE MEDIDAS: Quando a pergunta pedir um % que é a razão entre duas somas do mesmo grupo (ex.: "% de margem", "margem %", "margem de contribuição em %", "% do lucro sobre o faturamento", "participação do custo no faturamento"), use medidas[] com as duas somas (ex.: {"medida":"sum","campo":"Lucro_Total_Prod_Fat","alias":"margem_contribuicao"} e {"medida":"sum","campo":"Valor_Prod_Fat","alias":"faturamento"}) e acrescente em agregacao "percentuais": [{"alias":"margem_pct","numerador":"margem_contribuicao","denominador":"faturamento"}] (numerador e denominador = aliases de medidas[]; alias terminado em _pct). O banco calcula 100 × numerador / denominador por grupo. NUNCA faça média de percentuais. Para ordenar pelo % ("mais rentáveis em %"), use order_by com o alias do percentual; para ordenar por um valor que já é medida, use o alias da medida (não a coluna original).` },
  { n: 17, texto: `REGRA CRÍTICA 17 — CONSULTA DE DETALHE PEDE AGREGAÇÃO: Quando a descrição da query começa com \"Detalhe:\" (uma linha por lançamento ou item, ex.: Lançamentos do financeiro, faturamento por produto do ERP) e a pergunta pede total, soma, quanto, \"por <algo>\" (por grupo, por mês, por conta, por cliente), \"mensal\", \"mês a mês\" ou ranking, você DEVE preencher agregacao: group_by com as colunas do \"por\" (ex.: [\"mes\", \"grupo\"] para \"gastos mensais por grupo\"; use a coluna mes quando existir, senão group_by_trunc mensal na coluna de data), medida \"sum\" na coluna de valor certa (despesa para gastos, receita para recebimentos, resultado para sobra/falta, valor para quanto saiu/entrou de uma conta) e order_by. Deixe agregacao null (ou só order_by) quando a pergunta pede a LISTA dos lançamentos: \"o que tenho a pagar/receber\", \"quais foram/quais são os gastos\", \"liste\", \"mostre\", \"quais pagamentos\", extrato — \"quais foram os gastos neste mês\" e \"listar os gastos neste mês\" são a MESMA pergunta (uma linha por lançamento). Somar só quando a pergunta pede quanto, total, soma ou \"por <algo>\".` },
  { n: 18, texto: `REGRA CRÍTICA 18 — GUIA DE %: Quando a pergunta pede %, percentual, porcentagem, participação, proporção, fatia ou "quanto representa", escolha UM destes tipos: (1) RAZÃO ENTRE DUAS MEDIDAS do mesmo grupo ("margem %", "% de lucro sobre o faturamento", "custo em % do faturamento", "taxa de") → percentuais (regra 16). (2) PARTICIPAÇÃO NO TOTAL ("% de cada grupo nos gastos", "quanto o combustível representa", "participação de cada cliente no faturamento", "% por categoria") → group_by pelo item, a soma em medidas[] (ex.: {"medida":"sum","campo":"despesa","alias":"gastos"}) e "participacao": [{"alias":"gastos_pct","medida":"gastos"}]; o banco calcula 100 × valor do grupo / soma de todos os grupos. NÃO crie uma segunda consulta para o total. (3) PARTICIPAÇÃO DENTRO DE UM RECORTE ("% de cada grupo em cada mês", "mix de produtos por vendedor", "dentro de cada conta") → igual ao (2), com group_by contendo o recorte e o item (ex.: ["mes","grupo"]) e "dentro_de": ["mes"] na participação — o total passa a ser o de cada mês. (4) VARIAÇÃO ("crescimento", "variação", "aumento ou queda em %", "mês a mês", "sobre o mês anterior") → regra 12. Para decidir entre (1) e (2): se a pergunta cita DUAS grandezas (lucro e faturamento, custo e venda) é (1); se cita UMA grandeza repartida por item ("de cada", "por grupo", "no total", "do total") é (2). Sem pista clara, use (2). ITEM FILTRADO SOBRE O TOTAL ("% do produto AST001 no faturamento total", "participação mensal do cliente GAMA no faturamento do mês"): o item vem de um FILTRO (parâmetro), não de um agrupamento — use DUAS entradas da mesma query com a MESMA agregacao (mesmo group_by, ex.: mês): a primeira com o filtro do item e a segunda sem ele, com motivo_uso "total geral para cálculo de percentual"; o sistema junta as duas numa tabela com o item, o total geral e a participação %. O alias do % sempre termina em _pct. Os percentuais são sempre calculados no banco: nunca deixe a conta para a síntese, nunca faça média de percentuais. Para ordenar pelo %, use order_by com o alias dele.` },
  { n: 19, texto: `REGRA CRÍTICA 19 — RESULTADO: Quando a pergunta é sobre o RESULTADO de registros (\"resultados das agendas com Carlos\", \"o que foi decidido na reunião com…\", \"como foi a consulta com o Dr. Paulo\", \"resultado da tarefa…\") e a query tem o parâmetro tem_resultado, preencha tem_resultado = \"sim\": traz só os registros com resultado registrado (já concluídos e no passado — não filtre situação nem data por isso) e a coluna resultado traz o memo do resultado. Os outros filtros (com quem, assunto, período citado) continuam normais. Sem falar em resultado, NÃO preencha tem_resultado. "Resultado" como ASSUNTO não conta: "agendas que analisam resultados da etapa 2", "reunião sobre o resultado do trimestre" — aí o termo vai no parâmetro do assunto e tem_resultado fica vazio.` },
];

/** Só as regras do planejador que valem para esta pergunta e estas consultas. */
export function regrasDoPlanejador(pergunta: string, queries: QueryDisponivel[]): string {
  const t = pergunta.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const txtQ = queries.map((q) => `${q.nome} ${q.descricao ?? ""}`).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const temIn = queries.some((q) => q.params.some((p) => /\bIN\b/i.test(p.operadorSql)));
  const pct = /%|percent|porcent|margem|particip|propor|fatia|represent|taxa/.test(t);
  const cond: Record<number, boolean> = {
    4: /zer|positiv|negativ|desconsider|somente com|apenas com|com saldo|com estoque|sem estoque/.test(t),
    5: temIn,
    6: /fatur/.test(t) || /fatur/.test(txtQ),
    7: temIn,
    8: queries.some((q) => q.params.some((p) => /dura|tempo|hora/i.test(p.nome))),
    12: /varia|cresc|evolu|compar|queda|aument|mes a mes|sobre o|sobre a|versus|\bvs\b|anterior/.test(t),
    13: queries.some((q) => /^altera/i.test(q.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))),
    16: pct,
    17: queries.some((q) => /^\s*detalhe:/i.test(q.descricao ?? "")),
    18: pct,
    19: queries.some((q) => q.params.some((p) => p.nome === "tem_resultado")),
  };
  return REGRAS_PLANEJADOR.filter((r) => cond[r.n] ?? true).map((r) => r.texto).join("\n\n");
}

// ── Internal: planejamento via LLM ────────────────────────────────────────────

async function planejarConsultaEstruturada(input: {
  pergunta: string;
  classificacao: PerguntaClassificacao;
  historico: PerguntaCardHistorico[];
  queriesDisponiveis: QueryDisponivel[];
  categoryId?: number | null;
}): Promise<{ plano: PlanoConsulta; costUsd: number }> {
  // Horário de Brasília (antes era UTC: depois das 21h "hoje" já virava amanhã) + calendário pronto
  const datas = contextoDatas();
  const dataAtual = datas.hoje.slice(0, 10); // YYYY-MM-DD

  const entradaJson = JSON.stringify(
    {
      pergunta: input.pergunta,
      data_atual: dataAtual,
      hoje: datas.hoje,
      calendario: datas.calendario,
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

  const user = `Planeje a execução estruturada.\n\nEntrada:\n${entradaJson}\n\n${regrasDoPlanejador(input.pergunta, input.queriesDisponiveis)}\n\n${REGRA_CALENDARIO}\n\nRetorne somente JSON neste formato:\n{"queries":[{"query_id":"","motivo_uso":"","prioridade":1,"parametros":[{"nome":"","termo_usuario":"","valor":null,"tipo":"texto|lista_texto|data|numero|boolean","operador_sugerido":"=|IN|NOT IN|BETWEEN|>=|<=|LIKE","obrigatorio":true,"precisa_normalizacao":true,"generico":false}],"agregacao":{"medida":"count|sum|avg|min|max|null","campo_medida":"nome_coluna_ou_null","group_by":["coluna"],"group_by_trunc":[{"campo":"coluna_data","granularidade":"year|month|week|day"}],"order_by":[{"campo":"coluna","direcao":"asc|desc"}],"limit":50,"having_gt":null,"percentuais":[],"participacao":[]},"cross_query_filter":[{"from_priority":1,"from_field":"nome_coluna_query_origem","to_param":"nome_param_query_destino"}]}],"dados_insuficientes":false,"pergunta_para_usuario":null,"observacoes":[],"comparacao_somente_em_ambos":false}`;

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
    comparacao_somente_em_ambos?: boolean;
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
              const tipoParam = String(pObj.tipo ?? "texto");
              parametros.push({
                nome: String(pObj.nome ?? ""),
                termo_usuario: String(pObj.termo_usuario ?? ""),
                // Data inexistente do LLM (2026-02-29) já é corrigida aqui: plano salvo, rótulos e execução ficam coerentes
                valor: (ehTipoData(tipoParam) ? coerceDateParam(pObj.valor) : pObj.valor) ?? null,
                tipo: tipoParam,
                operador_sugerido: String(pObj.operador_sugerido ?? "="),
                obrigatorio: Boolean(pObj.obrigatorio ?? false),
                precisa_normalizacao: Boolean(pObj.precisa_normalizacao ?? false),
                ...(pObj.generico === true ? { generico: true } : {}),
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
          const MEDIDAS_VALS = ["count", "sum", "avg", "min", "max"] as const;
          type MedidaVal = typeof MEDIDAS_VALS[number];
          const medidas: PlanoMedida[] = Array.isArray(ag.medidas)
            ? (ag.medidas as unknown[])
                .filter((m): m is Record<string, unknown> => m !== null && typeof m === "object")
                .flatMap((m): PlanoMedida[] => {
                  const mv = m.medida as MedidaVal;
                  if (!MEDIDAS_VALS.includes(mv) || !String(m.campo ?? "").length) return [];
                  return [{ medida: mv, campo: String(m.campo), ...(typeof m.alias === "string" && m.alias.length > 0 ? { alias: m.alias } : {}) }];
                })
            : [];
          const percentuais = Array.isArray(ag.percentuais)
            ? (ag.percentuais as unknown[])
                .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
                .map((x) => ({ alias: String(x.alias ?? "").trim(), numerador: String(x.numerador ?? "").trim(), denominador: String(x.denominador ?? "").trim() }))
                .filter((x) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(x.alias) && x.numerador && x.denominador)
            : [];
          const participacao = Array.isArray(ag.participacao)
            ? (ag.participacao as unknown[])
                .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
                .map((x) => ({
                  alias: String(x.alias ?? "").trim(),
                  medida: String(x.medida ?? "").trim(),
                  dentro_de: Array.isArray(x.dentro_de)
                    ? (x.dentro_de as unknown[]).filter((c): c is string => typeof c === "string" && c.length > 0)
                    : [],
                }))
                .filter((x) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(x.alias))
            : [];
          if (medida || group_by.length > 0 || group_by_trunc.length > 0 || order_by.length > 0 || limit || medidas.length > 0) {
            agregacao = {
              medida,
              campo_medida: typeof ag.campo_medida === "string" && ag.campo_medida.length > 0 ? ag.campo_medida : null,
              ...(medidas.length > 0 ? { medidas } : {}),
              ...(medidas.length > 0 && percentuais.length > 0 ? { percentuais } : {}),
              ...((medidas.length > 0 || medida) && participacao.length > 0 ? { participacao } : {}),
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

  // "Que dia está marcado X?" sem citar período: a data é a RESPOSTA. Filtro de data aqui só pode ter
  // vindo de perguntas anteriores da sessão (ex.: 07/12) e esconderia o registro — é retirado.
  if (perguntaPedeData(input.pergunta) && !perguntaCitaPeriodo(input.pergunta)) {
    for (const q of queries) {
      for (const p of q.parametros) {
        const ehData = ehTipoData(p.tipo) || (typeof p.valor === "string" && /^\d{4}-\d{2}-\d{2}/.test(p.valor));
        if (ehData && p.valor != null && !/^alterado_em/i.test(p.nome)) p.valor = null;
      }
    }
  }

  const plano: PlanoConsulta = {
    queries: queries.sort((a, b) => a.prioridade - b.prioridade),
    dados_insuficientes: Boolean(parsed.dados_insuficientes ?? false),
    pergunta_para_usuario:
      typeof parsed.pergunta_para_usuario === "string" ? parsed.pergunta_para_usuario : null,
    observacoes: parseStringArray(parsed.observacoes),
    ...(parsed.comparacao_somente_em_ambos === true ? { comparacao_somente_em_ambos: true } : {}),
  };

  return { plano, costUsd };
}

// Padrões de nomes de colunas que indicam valor numérico (monetário, quantidade, etc.)
const NUMERIC_COL_RE = /^(valor|perda|qtde|quantidade|custo|total|preco|preço|saldo|percentual|peso|volume|desconto|acrescimo|imposto|taxa|margem|lucro|receita|prazo|indice|índice|media|média|dias|atraso|juros|num|numero|número|nr|seq|idade|limite|credito|crédito|debito|débito|frete|comissao|comissão)_|_(valor|perda|qtde|quantidade|custo|total|preco|preço|saldo|percentual|peso|volume|medio|médio|media|média|prazo|indice|índice|dias|atraso|pagamento|juros|num|numero|número|nr|seq|id)$/i;
/** Nome de coluna que É o valor (sem prefixo/sufixo): "despesa", "receita", "resultado", "valor" (financeiro). */
const NUMERIC_COL_EXATA_RE = /^(valor|despesa|receita|resultado|total|quantidade|qtde|preco|preço|saldo|custo|lucro|margem|juros|desconto|entradas|saidas|saídas|lancamentos|lançamentos|contagem|media|média)$/i;
function isLikelyNumericColumn(col: string): boolean {
  // Antes só valor_x / x_valor: a soma de "despesa" era descartada e "gastos mensais por grupo" voltava sem agregar
  return NUMERIC_COL_RE.test(col) || NUMERIC_COL_EXATA_RE.test(col);
}

/**
 * Valida e sanitiza os campos de agregação contra as colunas disponíveis no SELECT do template.
 * Previne "Invalid column name" no SQL Server quando o LLM referencia colunas de outro template.
 */
export function sanitizeAgregacaoCols(
  ag: PlanoAgregacao,
  sentencaSql: string,
  /** Colunas que o campo da categoria declara como número (guardado em texto): valem para SUM/AVG mesmo sem "parecer" número pelo nome. */
  numericasDeclaradas?: Set<string>,
  /** Só no PostgreSQL interno (memos): sobe o limite de série por data em ordem crescente (ver abaixo). O ERP (SQL Server) não muda. */
  pisoLimiteSerie = false
): PlanoAgregacao {
  const available = new Set(extractSelectColumnNames(sentencaSql));
  if (available.size === 0) return ag; // não conseguiu extrair colunas — deixa passar
  let { medida, campo_medida, group_by, order_by } = ag;
  // Antes só o NOME decidia (ex.: peso_*, valor_*, qtde_*); "igp", "imc" ou "idade_corporal" eram descartadas.
  // O tipo declarado do campo na categoria passa a valer primeiro.
  const numerica = (col: string) => !!numericasDeclaradas?.has(col.toLowerCase()) || isLikelyNumericColumn(col);

  // Valida medidas[] quando presente
  let medidas = ag.medidas;
  if (medidas && medidas.length > 0) {
    const validMedidas = medidas.filter((m) => {
      const lower = m.campo.toLowerCase();
      if (!available.has(lower)) {
        console.warn(`[Pipe2] medidas campo "${m.campo}" não existe no SELECT do template. Removendo.`);
        return false;
      }
      if ((m.medida === "sum" || m.medida === "avg") && !numerica(lower)) {
        console.warn(`[Pipe2] medidas campo "${m.campo}" não parece numérico para medida "${m.medida}". Removendo.`);
        return false;
      }
      return true;
    });
    medidas = validMedidas.length > 0 ? validMedidas : undefined;
  }
  if (campo_medida && medida !== "count" && medida !== null) {
    if (!available.has(campo_medida.toLowerCase())) {
      console.warn(`[Pipe2] campo_medida "${campo_medida}" não existe no SELECT do template. Colunas disponíveis: ${[...available].join(", ")}`);
      campo_medida = null;
      medida = null;
    } else if ((medida === "sum" || medida === "avg") && !numerica(campo_medida)) {
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
  // Aliases das medidas[] e dos percentuais (ex.: "margem_pct") também ordenam
  const aliasesMedidas = new Set([
    ...(medidas ?? []).map((m) => (m.alias ?? "").toLowerCase()).filter(Boolean),
    ...(medidas?.length ? ag.percentuais ?? [] : []).map((x) => x.alias.toLowerCase()),
    ...(medidas?.length || medida ? ag.participacao ?? [] : []).map((x) => x.alias.toLowerCase()),
    ...(medidas?.length || !medida ? [] : [({ sum: "total", avg: "media", min: "minimo", max: "maximo", count: "contagem" } as Record<string, string>)[medida]]),
  ]);
  const validOrderBy = order_by
    .map((o) => {
      const lower = o.campo.toLowerCase().replace(/^_base\./i, "");
      if (Object.prototype.hasOwnProperty.call(MEDIDA_ALIAS, lower)) return o;
      if (aliasesMedidas.has(lower)) return o;
      if (campoDaMedidaLower && lower === campoDaMedidaLower) return o;
      if (groupByLowerSet.has(lower)) return o;
      // Sem função de agregação: qualquer coluna disponível no SELECT é segura para ORDER BY
      if (!medida && available.has(lower)) return o;
      // Se a coluna existe no template e parece numérica, deixa passar — applyAgregacao vai envolvê-la em SUM()
      // Não deixar passar varchar/date: applyAgregacao usa SUM() cegamente e quebraria no SQL Server.
      if (available.has(lower) && numerica(lower)) return o;
      // Coluna inexistente no template: substitui pelo alias da medida para não gerar SQL inválido
      const fallbackAlias = medida ? (MEDIDA_ALIAS[medida] ?? null) : null;
      if (fallbackAlias) {
        console.warn(`[Pipe2] order_by "${o.campo}" não existe no template nem é GROUP BY/medida. Substituindo por "${fallbackAlias}".`);
        return { ...o, campo: fallbackAlias };
      }
      console.warn(`[Pipe2] order_by "${o.campo}" removido (não encontrado no SELECT).`);
      return null;
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);
  // Série por data em ordem crescente ("evolução diária dos últimos 15 dias"): o período já limita as linhas, e um
  // limite escrito pela IA com a conta errada (15 para 16 dias) cortaria o dia mais recente. Piso de 400 linhas.
  // Não vale para "top N" (ordenado pela medida) nem para "os N mais recentes" (ordem decrescente).
  const trunc = ag.group_by_trunc?.length === 1 ? ag.group_by_trunc[0] : null;
  const ordenaPelaData =
    pisoLimiteSerie &&
    !!trunc &&
    validOrderBy.length > 0 &&
    validOrderBy[0].direcao === "asc" &&
    validOrderBy[0].campo.toLowerCase().replace(/^_base\./i, "") === trunc.campo.toLowerCase().replace(/^_base\./i, "");
  const limit = ordenaPelaData && ag.limit != null && ag.limit < 400 ? 400 : ag.limit;
  return { ...ag, medida, campo_medida, group_by: validGroupBy, order_by: validOrderBy, medidas, limit };
}

// ── Internal: execução das queries do plano ───────────────────────────────────

/**
 * Registra no trace a consulta que falhou (SQL, parâmetros e mensagem do banco) — sem isso o erro chega à
 * tela sem dizer qual query nem qual SQL — e devolve um erro que identifica a query.
 */
function registrarFalhaSql(template: QueryDisponivel, sql: string, params: unknown, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  setLastLlmPromptTrace({
    provider: "sql",
    model: template.conexaoId != null ? "SQL Server" : "PostgreSQL",
    source: "consulta_sql (erro)",
    messages: [
      {
        role: "system",
        content: `Query #${template.query_id} "${template.nome}"\n\nSQL executado:\n${sql.replace(/\s+/g, " ").trim()}\n\nparâmetros: ${JSON.stringify(params)}`,
      },
      { role: "user", content: `Erro do banco de dados:\n${msg}` },
    ],
  });
  return new Error(`Query #${template.query_id} "${template.nome}": ${msg}`);
}

async function executarConsultasPlano(input: {
  plano: PlanoConsulta;
  queriesDisponiveis: QueryDisponivel[];
  userId: number;
  groupId: number | null;
  escopoAutorId?: number | null;
}): Promise<{ agregado: PerguntaResultadoEstruturado; porQuery: QueryExecResultado[]; avisos: string[] }> {
  const { plano, queriesDisponiveis, userId, groupId } = input;
  /** Queries puladas (ex.: cross_query_filter inválido) — viram limitações na resposta */
  const avisos: string[] = [];

  const porQuery: QueryExecResultado[] = [];
  const allLinhas: Record<string, unknown>[] = [];
  let colunas: string[] = [];
  const sqlParts: string[] = [];
  const allValues: unknown[] = [];

  /** Mapa de prioridade → resultado. Usado para resolver cross_query_filter de tasks subsequentes. */
  const resultadosPorPrioridade = new Map<number, QueryExecResultado>();

  /** Prioridades usadas como origem de cross_query_filter: são só filtro, não resposta. */
  const prioridadesAuxiliares = new Set(
    plano.queries.flatMap((q) => (q.cross_query_filter ?? []).map((f) => f.from_priority))
  );

  for (const task of plano.queries) {
    const template = queriesDisponiveis.find((q) => q.query_id === task.query_id);
    const auxiliar = prioridadesAuxiliares.has(task.prioridade) ? { auxiliar: true as const } : {};
    if (!template) continue;
    if (template.conexaoPendente) {
      throw new Error(
        `A query "${template.nome}" foi clonada e ainda não tem conexão definida. ` +
        `Selecione a "Conexão BD externa" dela em Estrutura do contexto.`
      );
    }

    // Resolve cross_query_filter: extrai lista de valores de query origem e injeta como parâmetro IN/NOT IN.
    // Filtro inválido não derruba a pergunta: a query destino é pulada e o motivo vai para as limitações.
    const parametrosResolvidos: PlanoParam[] = [...task.parametros];
    let pularQuery: string | null = null;
    let resultadoVazio = false;
    for (const ref of task.cross_query_filter ?? []) {
      const rotulo = `query #${task.query_id} "${template.nome}"`;
      const origem = resultadosPorPrioridade.get(ref.from_priority);
      if (!origem) {
        pularQuery = `Não foi possível executar a ${rotulo}: ela dependia da consulta de prioridade ${ref.from_priority}, que não foi executada.`;
        break;
      }
      // Parâmetro destino: cadastrado com IN/NOT IN; senão a variante _in cadastrada; senão o próprio SQL com "IN (@param)"
      const toLower = ref.to_param.toLowerCase();
      const ehIn = (op: string | undefined) => ["IN", "NOT IN"].includes((op ?? "").toUpperCase());
      let paramDef = template.params.find((p) => p.nome.toLowerCase() === toLower);
      if (paramDef && !ehIn(paramDef.operadorSql)) {
        paramDef = template.params.find((p) => p.nome.toLowerCase() === `${toLower}_in` && ehIn(p.operadorSql));
      }
      let nomeParam = paramDef?.nome ?? ref.to_param;
      let operador = paramDef?.operadorSql?.toUpperCase();
      if (!paramDef) {
        const escapado = ref.to_param.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const noSql = new RegExp(`(NOT\\s+)?IN\\s*\\(\\s*[@:]${escapado}\\s*\\)`, "i").exec(template.sentencaSql);
        if (noSql) {
          nomeParam = ref.to_param;
          operador = noSql[1] ? "NOT IN" : "IN";
          console.warn(`[Pipe2] cross_query_filter: "${ref.to_param}" não cadastrado na ${rotulo}; usando o IN do SQL.`);
        } else {
          pularQuery =
            `Não foi possível filtrar a ${rotulo} pelos resultados da consulta anterior: falta o parâmetro "${ref.to_param}" ` +
            `(tipo lista_texto, operador IN). Cadastre-o na query para suportar este tipo de pergunta.`;
          break;
        }
      }
      // Coluna de origem precisa existir no resultado (com 0 linhas não há como conferir — lista vazia de qualquer forma)
      const fieldLower = ref.from_field.toLowerCase();
      const fieldKey = origem.colunas.find((c) => c.toLowerCase() === fieldLower);
      if (!fieldKey && origem.linhas.length > 0) {
        pularQuery =
          `Não foi possível filtrar a ${rotulo}: a coluna "${ref.from_field}" não existe no resultado da consulta de origem ` +
          `(colunas: ${origem.colunas.join(", ")}).`;
        break;
      }
      // Extrai valores únicos não-nulos do campo na query origem
      const valores = fieldKey
        ? Array.from(new Set(
            origem.linhas
              .map((row) => row[fieldKey])
              .filter((v): v is string | number => v !== null && v !== undefined && v !== "")
              .map((v) => String(v))
          ))
        : [];
      // IN com lista vazia = nenhum registro (sem isso o "IS NULL" do template devolveria tudo).
      // NOT IN com lista vazia = não exclui nada.
      if (valores.length === 0) {
        if (operador === "IN") { resultadoVazio = true; break; }
        continue;
      }
      // Dois filtros no mesmo parâmetro (ex.: produtos de janeiro E de fevereiro): IN cruza as listas
      // (só o que está nas duas); NOT IN junta as listas (exclui o que está em qualquer uma)
      const jaExiste = parametrosResolvidos.find(
        (p) => p.nome.toLowerCase() === nomeParam.toLowerCase() && Array.isArray(p.valor)
      );
      if (jaExiste) {
        const anteriores = (jaExiste.valor as unknown[]).map((v) => String(v));
        if ((operador ?? "IN") === "IN") {
          const nova = new Set(valores);
          jaExiste.valor = anteriores.filter((v) => nova.has(v));
          if ((jaExiste.valor as unknown[]).length === 0) { resultadoVazio = true; break; }
        } else {
          jaExiste.valor = Array.from(new Set([...anteriores, ...valores]));
        }
        jaExiste.termo_usuario = `${jaExiste.termo_usuario} + (de query prioridade ${ref.from_priority}.${ref.from_field})`;
        continue;
      }
      parametrosResolvidos.push({
        nome: nomeParam,
        termo_usuario: `(de query prioridade ${ref.from_priority}.${ref.from_field})`,
        valor: valores,
        tipo: "lista_texto",
        operador_sugerido: operador ?? "IN",
        obrigatorio: false,
        precisa_normalizacao: false,
      });
    }
    if (pularQuery) {
      avisos.push(pularQuery);
      continue;
    }
    if (resultadoVazio) {
      const vazio: QueryExecResultado = { query_id: task.query_id, colunas: [], linhas: [], totalLinhas: 0, prioridade: task.prioridade, ...auxiliar };
      porQuery.push(vazio);
      resultadosPorPrioridade.set(task.prioridade, vazio);
      continue;
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
          const key = p.nome.toLowerCase();
          const paramDef = template.params.find((d) => d.nome.toLowerCase() === key);
          const isNumeric = /^(number|numeric|numero)$/i.test(paramDef?.tipo ?? p.tipo ?? "");
          paramValues[key] = isNumeric
            ? coerceNumericParam(p.valor)
            : ehTipoData(paramDef?.tipo ?? p.tipo) ? (coerceDateParam(p.valor) ?? null) : (p.valor ?? null);
          if (p.operador_sugerido) operadorOverrides[key] = p.operador_sugerido;
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
      let result: Awaited<ReturnType<typeof executeQueryMssql>>;
      try {
        result = await executeQueryMssql(
          template.conexaoId,
          sqlToExecute,
          paramValues,
          template.params.map((p) => ({ nome: p.nome, operadorSql: p.operadorSql })),
          operadorOverrides
        );
      } catch (err) {
        throw registrarFalhaSql(template, `[mssql:${template.conexaoId}] ${sqlToExecute}`, paramValues, err);
      }
      linhas = result.linhas;
      colunasQuery = result.colunas;
      sqlParts.push(`[mssql:${template.conexaoId}] ${sqlToExecute}`);
      allValues.push(paramValues);
    } else {
      const { sql: baseSql, values } = bindTemplateParams(
        template.sentencaSql,
        parametrosResolvidos,
        template.params,
        { userid: userId, groupid: groupId, autor: input.escopoAutorId ?? null }
      );

      let finalSql = baseSql;
      if (task.agregacao) {
        // Campos de memo guardam número como texto: a média/soma precisa converter (ver colunasNumericasEmTexto)
        const textoNumerico = colunasNumericasEmTexto(template.sentencaSql, template.params);
        const ag = sanitizeAgregacaoCols(task.agregacao, template.sentencaSql, textoNumerico, true);
        try {
          finalSql = applyAgregacao(baseSql, ag, "pg", textoNumerico);
        } catch (err) {
          console.warn("[Pipe2] applyAgregacao ignorada:", err instanceof Error ? err.message : err);
        }
      }

      let rows: RowDataPacket[];
      try {
        // SQL escrito pelo owner: roda isolado (read only, papel restrito, RLS por grupo)
        [rows] = await queryIsoladaPorGrupo<RowDataPacket[]>(finalSql, values, { userId, groupId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/permission denied|read-only transaction|cannot insert multiple commands/i.test(msg)) {
          throw new Error(
            `A query "${template.nome}" tentou uma operação não permitida (${msg}). ` +
            `Queries de categoria só podem ler memos, dadosespecificos, categories, subcategories e categorycampos.`
          );
        }
        if (/invalid input syntax for type date/i.test(msg)) {
          throw new Error(
            `Campo de data com valor inválido na query "${template.nome}". ` +
            `Substitua cast direto como (campo)::date por mymemory_parse_date(campo) no template SQL para tratar campos vazios.`
          );
        }
        throw registrarFalhaSql(template, finalSql, values, err);
      }
      linhas = numerosDoPostgres(rows as Record<string, unknown>[]);
      colunasQuery = linhas.length > 0 ? Object.keys(linhas[0]) : [];
      sqlParts.push(finalSql);
      allValues.push(...values);
    }

    const resultado: QueryExecResultado = { query_id: task.query_id, colunas: colunasQuery, linhas, totalLinhas: linhas.length, prioridade: task.prioridade, ...auxiliar };
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
        content: `SQL executado:\n${sqlParts.join("\n---\n").replace(/\s+/g, " ").trim()}\n\nparâmetros: ${JSON.stringify(allValues)}` +
          (avisos.length ? `\n\nqueries puladas:\n${avisos.join("\n")}` : ""),
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
    avisos,
  };
}

// ── Internal: síntese em linguagem natural ────────────────────────────────────

async function gerarRespostaEstruturada(input: {
  pergunta: string;
  plano: PlanoConsulta;
  porQuery: QueryExecResultado[];
  agregado: PerguntaResultadoEstruturado;
  categoryId?: number | null;
  /** Queries que não puderam ser executadas e o motivo */
  avisosExecucao?: string[];
  /** Comparação entre períodos já calculada: o LLM só narra, sem recalcular. */
  comparacao?: ComparacaoPeriodos | null;
}): Promise<{ resposta: PerguntaResposta; costUsd: number }> {
  const queries_executadas = input.plano.queries.map((q) => ({
    query_id: q.query_id,
    motivo_uso: q.motivo_uso,
    prioridade: q.prioridade,
  }));

  const LIMITE_LINHAS_LLM = 20;
  /** A tela mostra 20 linhas; o PDF da resposta leva todas (até 2.000). */
  const linhasParaPdf = (linhas: Record<string, unknown>[]) =>
    linhas.length > LIMITE_LINHAS_LLM ? { linhasCompletas: linhas.slice(0, 2000) } : {};

  /** Somas das colunas numéricas sobre TODAS as linhas (a IA só recebe 20) — para o total do resumo. */
  const ehColunaDeValor = (col: string) =>
    /(valor|vlr|total|qtde|qtd|quantidade|lucro|saldo|receita|despesa|montante|juros)/i.test(col) &&
    !/(preco|unit|taxa|indice|prazo|perc|aliq|media|data|%)/i.test(col);
  const somasTodasLinhas = (colunas: string[], linhas: Record<string, unknown>[]) => {
    const somas: Record<string, number> = {};
    for (const col of colunas) {
      if (!ehColunaDeValor(col)) continue;
      let total = 0;
      let numerica = linhas.length > 0;
      for (const l of linhas) {
        const v = l[col];
        if (v == null || v === "") continue;
        const n = typeof v === "number" ? v : Number(v);
        if (typeof v === "boolean" || v instanceof Date || !Number.isFinite(n)) {
          numerica = false;
          break;
        }
        total += n;
      }
      if (numerica) somas[col] = Math.round(total * 100) / 100;
    }
    return somas;
  };

  /**
   * Maiores e menores de cada coluna de valor sobre TODAS as linhas (a IA só recebe 20 e
   * erra ao comparar números de cabeça) — para os destaques do resumo.
   */
  const destaquesTodasLinhas = (colunas: string[], linhas: Record<string, unknown>[]) => {
    const somas = somasTodasLinhas(colunas, linhas);
    const rotulos = colunas
      .filter((c) => !(c in somas) && c.toLowerCase() !== "id")
      .filter((c) => linhas.some((l) => typeof l[c] === "string"))
      .slice(0, 3);
    const out: Record<string, { maiores: Record<string, unknown>[]; menores: Record<string, unknown>[] }> = {};
    for (const col of Object.keys(somas)) {
      const ord = linhas
        .map((l) => ({ l, n: l[col] == null || l[col] === "" ? NaN : Number(l[col]) }))
        .filter((x) => Number.isFinite(x.n))
        .sort((a, b) => b.n - a.n);
      const proj = (x: { l: Record<string, unknown>; n: number }, pos: number) => ({
        posicao: pos,
        ...Object.fromEntries(rotulos.map((c) => [c, x.l[c]])),
        [col]: Math.round(x.n * 100) / 100,
      });
      out[col] = {
        maiores: ord.slice(0, 5).map((x, i) => proj(x, i + 1)),
        menores: ord.slice(-3).reverse().map((x, i) => proj(x, ord.length - i)),
      };
    }
    return out;
  };

  const resultados = input.porQuery.map((r) => r.auxiliar ? {
    query_id: r.query_id,
    papel: "consulta auxiliar: só serviu de filtro para a consulta seguinte (não é a resposta; não comente seus registros)",
    total_linhas: r.totalLinhas,
  } : ({
    query_id: r.query_id,
    colunas: r.colunas,
    linhas: r.linhas.slice(0, LIMITE_LINHAS_LLM),
    total_linhas: r.totalLinhas,
    ...(r.totalLinhas > LIMITE_LINHAS_LLM
      ? {
          somas_todas_linhas: somasTodasLinhas(r.colunas, r.linhas),
          destaques_todas_linhas: destaquesTodasLinhas(r.colunas, r.linhas),
        }
      : {}),
  }));

  // Aviso injetado pelo backend quando o resultado foi truncado
  const avisosTruncamento: string[] = input.comparacao ? [] : input.porQuery
    .filter((r) => r.totalLinhas > LIMITE_LINHAS_LLM && !r.auxiliar)
    .map(
      (r) =>
        `Query ${r.query_id}: resultado contém ${r.totalLinhas} linhas mas apenas ${LIMITE_LINHAS_LLM} foram entregues ao modelo. Para totais use somas_todas_linhas (somam todas as ${r.totalLinhas} linhas) e total_linhas para a contagem; não some as linhas recebidas. Para maiores/menores/ranking use SOMENTE destaques_todas_linhas (já calculados sobre todas as linhas, em ordem) — nunca escolha os maiores olhando as linhas recebidas. Para outras contas sobre todas as linhas, diga na resposta que não é possível e sugira reformular a pergunta com agregação.`
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
      ...contextoDatas(),
      queries_executadas,
      ...(input.comparacao ? { comparacao_calculada: comparacaoParaLlm(input.comparacao) } : { resultados }),
      parametros_aplicados,
      normalizacoes_aplicadas,
      ...(avisosTruncamento.length > 0 ? { avisos_truncamento: avisosTruncamento } : {}),
      // Consultas puladas e buscas ampliadas (sem termo genérico / sem uma palavra): cite na resposta
      ...(input.avisosExecucao?.length ? { avisos_execucao: input.avisosExecucao } : {}),
    },
    null,
    2
  );

  const regraApresentacao =
    "REGRA DE APRESENTAÇÃO: os registros já aparecem numa tabela completa logo abaixo da resposta (na tela e no PDF). " +
    "Se o resultado tiver mais de 5 linhas, NÃO liste os registros no texto: escreva de 1 a 3 frases com o que foi encontrado " +
    "(quantidade de registros e filtros/período), o total quando fizer sentido (de somas_todas_linhas, quando existir) e, só se a pergunta pedir ranking/maiores/menores, " +
    "no máximo 3 destaques — copiados de destaques_todas_linhas quando existir (nunca compare valores você mesmo); se a pergunta não pediu, não invente destaques. " +
    "Termine dizendo que a lista completa está na tabela. Com até 5 linhas, pode citar cada uma. " +
    "Nunca escreva \"primeiros N registros\" nem registre em limitacoes que a tabela mostra só parte das linhas (a tabela e o PDF trazem todas).\n\n" +
    "VARIAÇÃO JÁ CALCULADA: colunas terminadas em \"var. %\" trazem a variação de cada linha sobre a ANTERIOR, calculada pelo sistema (vazia na primeira). " +
    "Copie esses valores; nunca recalcule a variação. Não comente meses ou períodos sem dados que a pergunta não citou.\n\n" +
    "PERCENTUAL JÁ CALCULADO: colunas terminadas em \"%\" ou \"_pct\" (ex.: \"participação %\", margem_pct) já trazem o percentual calculado pelo sistema. " +
    "Copie esses valores; nunca recalcule nem invente colunas de percentual. Em colunas_exibir use só nomes de colunas que existem no resultado.\n\n" +
    "COLUNAS DA TABELA: em colunas_exibir, liste (nomes exatos de colunas) SOMENTE o que a pergunta pede: " +
    "o item perguntado (ex.: \"produtos\" → código e descrição do produto) e a medida pedida (ex.: \"faturados\"/\"faturamento\" → valor faturado). " +
    "NÃO acrescente outras colunas (data, nota, cliente, vendedor, impostos…) a menos que a pergunta as cite " +
    "(ex.: \"incluir o cliente\", \"com o número da nota\"). " +
    "Deixe vazio para mostrar todas (resultados com poucas colunas, ex.: agregações).";
  // Campo do tipo lista (valor com vários itens em linhas): a tela já mostra a lista inteira em
  // cartões, então a resposta não repete os itens — fica mais curta e mais rápida.
  const temLista = resultados.some(
    (r) => "linhas" in r && r.linhas.some((l) => Object.values(l).some((v) => typeof v === "string" && v.includes("\n")))
  );
  const regraLista = temLista
    ? "\n\nHá campo com vários itens, um por linha (lista). A tela mostra a lista inteira logo abaixo da resposta: NÃO repita os itens no texto. Diga só quantas listas há, o nome de cada uma e quantos itens tem, em uma ou duas frases. Itens que começam com ✓ estão concluídos e com ✗ cancelados: conte só os pendentes (sem marca) e, se houver, diga quantos já foram concluídos. Se a pergunta é se um item está na lista, responda só isso em uma frase curta (ex.: \"Sim, sorvete está na lista Mercado.\" ou \"Não, arroz não está na lista Mercado.\"), sem listar os outros itens."
    : "";
  const user = `Elabore a resposta final.\n\nEntrada:\n${entradaJson}\n\n${regraApresentacao}${regraLista}\n\nRetorne somente JSON:\n{"resposta":"","colunas_exibir":[],"tipo_resposta":"estruturada","dados_usados":[{"query_id":"","linhas_usadas":0}],"limitacoes":[],"confianca_estimada":0.0}`;

  // Trace dedicado mostrando as linhas do resultado entregues ao LLM de síntese
  setLastLlmPromptTrace({
    provider: "sql",
    model: "PostgreSQL",
    source: "resultado_sql",
    messages: resultados.map((r) => ({
      role: "assistant" as const,
      content: "linhas" in r
        ? `[${r.query_id}] ${r.total_linhas} linha(s) total — ${r.linhas.length} entregue(s) ao LLM\ncolunas: ${r.colunas.join(", ")}\n\n${JSON.stringify(r.linhas, null, 2)}`
        : `[${r.query_id}] ${r.total_linhas} linha(s) — consulta auxiliar (só filtro), não entregue ao LLM`,
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
    colunas_exibir?: unknown;
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
    limitacoes: [
      ...parseStringArray(parsed.limitacoes).filter(
        (t) => !t.split(/\D+/).includes(String(LIMITE_LINHAS_LLM)) || !/(linha|registro|exibid|visualiza|entregue)/i.test(t)
      ),
      ...(input.avisosExecucao ?? []),
    ],
    confianca_estimada: typeof parsed.confianca_estimada === "number"
      ? Math.min(Math.max(parsed.confianca_estimada, 0), 1)
      : 1.0,
    dados_estruturados: (() => {
      if (input.comparacao) return comparacaoParaTabela(input.comparacao);
      // Colunas escolhidas pela IA (as que respondem à pergunta); as linhas seguem completas
      const pedidas = parseStringArray(parsed.colunas_exibir).map((c) => c.toLowerCase());
      const colunasDe = (colunas: string[]) => {
        if (colunas.length <= 6 || !pedidas.length) return colunas;
        const escolhidas = pedidas
          .map((c) => colunas.find((col) => col.toLowerCase() === c))
          .filter((c): c is string => !!c);
        if (!escolhidas.length) return colunas;
        // id (memo) e lancamento_id (✎ de corrigir no financeiro) ficam sempre
        const fixas = colunas.filter((c) => (c.toLowerCase() === "id" || c === "lancamento_id") && !escolhidas.includes(c));
        return [...fixas, ...new Set(escolhidas)];
      };
      const principais = input.porQuery.filter((r) => !r.auxiliar);
      const comLinhas = (principais.length ? principais : input.porQuery).filter((r) => r.linhas.length > 0);
      if (comLinhas.length <= 1) {
        const r = comLinhas[0] ?? principais[0] ?? input.porQuery[0];
        return r
          ? { colunas: colunasDe(r.colunas), linhas: r.linhas.slice(0, LIMITE_LINHAS_LLM), totalLinhas: r.totalLinhas, ...linhasParaPdf(r.linhas), ...idConsulta(r.query_id) }
          : input.agregado;
      }
      return comLinhas.map((r) => ({
        nome: r.query_id,
        colunas: colunasDe(r.colunas),
        linhas: r.linhas.slice(0, LIMITE_LINHAS_LLM),
        totalLinhas: r.totalLinhas,
        ...linhasParaPdf(r.linhas),
        ...idConsulta(r.query_id),
      }));
    })(),
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

  const { plano, costUsd: c1 } = await withSpan("Planejamento da consulta", () => planejarConsultaEstruturada({
    pergunta: input.pergunta,
    classificacao: input.classificacao,
    historico: input.historico,
    queriesDisponiveis: input.queriesDisponiveis,
    categoryId: input.categoryId,
  }));
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

  let planoExec = {
    ...plano,
    queries: executableQueries.map((t) =>
      comResultado(listaSemSoma(periodoPadraoSerie(t, input.queriesDisponiveis), input.pergunta), input.pergunta, input.queriesDisponiveis)
    ),
  };
  let { agregado, porQuery, avisos } = await withSpan("Execução das queries SQL", () => executarConsultasPlano({
    plano: planoExec,
    queriesDisponiveis: input.queriesDisponiveis,
    userId: input.userId,
    groupId: input.groupId,
    escopoAutorId: input.escopoAutorId,
  }));

  // Nada encontrado e há termo genérico ("oficina"): repete sem ele. Quem gravou "oficina" já teria
  // aparecido na 1ª busca; aqui só se amplia quando ela veio vazia.
  const genericos = planoExec.queries.flatMap((q) =>
    q.parametros.filter((p) => p.generico && p.valor != null && String(p.valor).trim() !== "")
  );
  if (agregado.totalLinhas === 0 && genericos.length) {
    const termos = [...new Set(genericos.map((p) => String(p.termo_usuario || p.valor)))];
    const planoSem: PlanoConsulta = {
      ...planoExec,
      queries: planoExec.queries.map((q) => ({
        ...q,
        parametros: q.parametros.map((p) => (p.generico ? { ...p, valor: null } : p)),
      })),
    };
    // Sem nenhum outro filtro de texto a busca traria tudo: só repete se sobrar algo que identifique
    const sobraFiltro = planoSem.queries.some((q) =>
      q.parametros.some(
        (p) =>
          p.valor != null &&
          String(p.valor).trim() !== "" &&
          !SYSTEM_PARAM_NAMES.has(p.nome.toLowerCase()) &&
          !ehTipoData(p.tipo) &&
          !/situac|status|estado/i.test(p.nome) &&
          !/^\d{4}-\d{2}-\d{2}/.test(String(p.valor))
      )
    );
    if (sobraFiltro) {
      const r2 = await withSpan("Execução sem termo genérico", () => executarConsultasPlano({
        plano: planoSem,
        queriesDisponiveis: input.queriesDisponiveis,
        userId: input.userId,
        groupId: input.groupId,
        escopoAutorId: input.escopoAutorId,
      }));
      if (r2.agregado.totalLinhas > 0) {
        planoExec = planoSem;
        ({ agregado, porQuery } = r2);
        avisos = [
          ...r2.avisos,
          `Nenhum registro tem ${termos.map((t) => `"${t}"`).join(", ")}; mostrando os que batem com o resto da pergunta.`,
        ];
      }
    }
  }

  // Ainda vazio e um filtro de texto tem várias palavras ("carro oficina"): cada palavra precisa estar no
  // campo. Tenta sem uma palavra de cada vez (da última para a primeira; no máximo 4 tentativas) e fica
  // com a primeira que achar algo. O termo dito continua valendo quando existe: só se amplia no vazio.
  if (agregado.totalLinhas === 0) {
    const PARADAS = new Set(["de", "da", "do", "das", "dos", "na", "no", "nas", "nos", "a", "o", "as", "os", "e", "com", "para", "pra", "em", "um", "uma"]);
    const tentativas: { plano: PlanoConsulta; tirada: string }[] = [];
    planoExec.queries.forEach((q, qi) => {
      q.parametros.forEach((p, pi) => {
        if (typeof p.valor !== "string" || ehTipoData(p.tipo) || /situac|status|estado/i.test(p.nome)) return;
        if (/^\d{4}-\d{2}-\d{2}/.test(p.valor)) return;
        const palavras = p.valor.split(/\s+/).filter(Boolean);
        const significativas = palavras.filter((w) => w.length >= 3 && !PARADAS.has(semAcentoMin(w)));
        if (significativas.length < 2) return;
        for (const w of [...significativas].reverse()) {
          if (tentativas.length >= 4) return;
          const valor = palavras.filter((x) => x !== w).join(" ");
          tentativas.push({
            tirada: w,
            plano: {
              ...planoExec,
              queries: planoExec.queries.map((q2, i) =>
                i !== qi ? q2 : { ...q2, parametros: q2.parametros.map((p2, j) => (j === pi ? { ...p2, valor } : p2)) }
              ),
            },
          });
        }
      });
    });
    for (const t of tentativas) {
      const r3 = await withSpan(`Execução sem a palavra "${t.tirada}"`, () => executarConsultasPlano({
        plano: t.plano,
        queriesDisponiveis: input.queriesDisponiveis,
        userId: input.userId,
        groupId: input.groupId,
        escopoAutorId: input.escopoAutorId,
      }));
      if (r3.agregado.totalLinhas > 0) {
        planoExec = t.plano;
        ({ agregado, porQuery } = r3);
        avisos = [...r3.avisos, `Nenhum registro tem "${t.tirada}" junto com o resto da pergunta; mostrando os que batem sem essa palavra.`];
        break;
      }
    }
  }

  await anexarResultados(input.pergunta, agregado, porQuery);

  // Comparação simples entre dois períodos: contas feitas em código (null = consulta comum, fluxo inalterado)
  const comparacao = detectarComparacaoPeriodos(planoExec, porQuery);

  // Série temporal (agrupada por mês/ano/semana) e pergunta de variação: a var. % de cada período
  // sobre o anterior é calculada aqui, não pela IA
  const participacaoJunta = !comparacao && juntarParticipacaoSubconjunto(planoExec, porQuery);
  const pedeVariacao =
    /varia|cresc|evolu|queda|aumento/i.test(input.pergunta) ||
    (/percent|%/i.test(input.pergunta) && !/particip|represent|propor|fatia|total/i.test(input.pergunta));
  if (!comparacao && !participacaoJunta && pedeVariacao) {
    for (const r of porQuery) {
      const task = planoExec.queries.find((q) => q.prioridade === r.prioridade);
      if (task) adicionarVariacaoSequencial(task, r);
    }
  }

  const { resposta, costUsd: c2 } = await withSpan("Síntese da resposta (estruturada)", () => gerarRespostaEstruturada({
    pergunta: input.pergunta,
    plano: planoExec,
    porQuery,
    agregado,
    categoryId: input.categoryId,
    avisosExecucao: avisos,
    comparacao,
  }));
  totalCost += c2;

  const queriesParaAviso = montarQueriesParaAviso(planoExec, input.queriesDisponiveis);

  return {
    resposta,
    apiCost: totalCost,
    dadosEstruturados: comparacao ? comparacaoParaTabela(comparacao) : agregado,
    queriesParaAviso,
    planoExecutado: planoExec,
    comparacao,
  };
}

function montarQueriesParaAviso(plano: PlanoConsulta, queriesDisponiveis: QueryDisponivel[]): AvisoQuerySnapshot[] {
  return plano.queries.map((task) => {
    const template = queriesDisponiveis.find((q) => q.query_id === task.query_id);
    return {
      queryId: Number(task.query_id),
      nome: template?.nome ?? task.query_id,
      conexaoId: template?.conexaoId ?? null,
      parametros: task.parametros
        .filter((p) => !SYSTEM_PARAM_NAMES.has(p.nome.toLowerCase()))
        .map((p) => ({
          nome: p.nome,
          valor: p.valor,
          tipo: p.tipo,
          operadorSugerido: p.operador_sugerido,
          precisaNormalizacao: p.precisa_normalizacao,
        })),
    };
  });
}

/**
 * Reexecuta um plano salvo (pergunta salva com chips): pula classificação e planejamento,
 * roda só as queries e a síntese. Quem chama garante que as queries do plano não mudaram.
 */
export async function executarPlanoSalvo(input: {
  pergunta: string;
  plano: PlanoConsulta;
  queriesDisponiveis: QueryDisponivel[];
  userId: number;
  groupId: number | null;
  categoryId?: number | null;
}): Promise<Pipe2Result> {
  const planoExec: PlanoConsulta = {
    ...input.plano,
    queries: input.plano.queries.filter((t) => input.queriesDisponiveis.some((q) => q.query_id === t.query_id)),
  };
  const { agregado, porQuery, avisos } = await withSpan("Execução das queries SQL", () => executarConsultasPlano({
    plano: planoExec,
    queriesDisponiveis: input.queriesDisponiveis,
    userId: input.userId,
    groupId: input.groupId,
  }));
  const { resposta, costUsd } = await withSpan("Síntese da resposta (estruturada)", () => gerarRespostaEstruturada({
    pergunta: input.pergunta,
    plano: planoExec,
    porQuery,
    agregado,
    categoryId: input.categoryId,
    avisosExecucao: avisos,
  }));
  return {
    resposta,
    apiCost: costUsd,
    dadosEstruturados: agregado,
    queriesParaAviso: montarQueriesParaAviso(planoExec, input.queriesDisponiveis),
    planoExecutado: planoExec,
  };
}

// ── Sugestão de valores para os chips das perguntas salvas ────────────────────

/** Colunas do SELECT preservando maiúsculas (aliases entre aspas no PostgreSQL são sensíveis a caixa). */
function extractSelectColumnNamesOriginal(sentencaSql: string): string[] {
  const m = /\bSELECT\b([\s\S]+?)\bFROM\b/i.exec(sentencaSql);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((col) => {
      const t = col.trim().replace(/\s+/g, " ");
      const asMatch = /\bAS\s+[\[\"`]?(\w+)[\]\"`]?\s*$/i.exec(t);
      if (asMatch) return asMatch[1];
      const lastId = /[\[\"`]?(\w+)[\]\"`]?\s*$/.exec(t);
      return lastId && lastId[1].toLowerCase() !== "select" ? lastId[1] : "";
    })
    .filter((c) => c.length > 0 && c !== "*");
}

const normNomeCol = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/**
 * Valores distintos da coluna ligada ao parâmetro que contenham `termo` — alimenta o autocomplete do chip.
 * Roda o próprio template da query (sem os demais filtros) com o mesmo isolamento da execução normal.
 * Sem coluna identificável no SELECT → lista vazia (o usuário ainda pode digitar livremente).
 */
export async function sugerirValoresParam(input: {
  template: QueryDisponivel;
  param: string;
  termo: string;
  userId: number;
  groupId: number | null;
}): Promise<string[]> {
  const { template } = input;
  const base = input.param.toLowerCase().replace(/_(in|nin)$/, "");
  const col = extractSelectColumnNamesOriginal(template.sentencaSql).find((c) => normNomeCol(c) === base);
  if (!col) return [];
  const semFim = (sql: string) =>
    sql.replace(/\s+ORDER\s+BY\s+[^()]*$/i, "").replace(/\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i, "").trim();
  const like = `%${input.termo.trim()}%`;

  let linhas: Record<string, unknown>[];
  if (template.conexaoId != null) {
    const sql =
      `WITH _base AS (\n${semFim(template.sentencaSql)}\n) ` +
      `SELECT DISTINCT TOP 30 ${sanitizeIdentifier(col, "mssql")} AS v FROM _base ` +
      `WHERE ${sanitizeIdentifier(col, "mssql")} LIKE @mm_sugestao ORDER BY 1`;
    const r = await executeQueryMssql(
      template.conexaoId,
      sql,
      { userid: input.userId, groupid: input.groupId, mm_sugestao: like },
      template.params.map((p) => ({ nome: p.nome, operadorSql: p.operadorSql })),
      { mm_sugestao: "LIKE" }
    );
    linhas = r.linhas;
  } else {
    const { sql: baseSql, values } = bindTemplateParams(template.sentencaSql, [], template.params, {
      userid: input.userId,
      groupid: input.groupId,
    });
    const c = sanitizeIdentifier(col, "pg");
    const sql =
      `WITH _base AS (\n${semFim(baseSql)}\n) ` +
      `SELECT DISTINCT ${c}::text AS v FROM _base ` +
      `WHERE unaccent(${c}::text) ILIKE unaccent(?::text) ORDER BY 1 LIMIT 30`;
    const [rows] = await queryIsoladaPorGrupo<RowDataPacket[]>(sql, [...values, like], {
      userId: input.userId,
      groupId: input.groupId,
    });
    linhas = rows as Record<string, unknown>[];
  }
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const l of linhas) {
    const v = l.v ?? Object.values(l)[0];
    if (v == null) continue;
    const s = String(v).trim();
    if (s && !vistos.has(s.toLowerCase())) { vistos.add(s.toLowerCase()); out.push(s); }
  }
  return out;
}

/**
 * "Quais foram os gastos neste mês" = "listar os gastos neste mês": pede a lista, não a soma. Quando a pergunta só pede
 * lista (quais/liste/mostre) sem quanto/total/soma/média/"por <algo>" e o plano somou tudo numa linha (medida sem
 * agrupamento), tira a soma e mantém só a ordenação.
 */
/** Pergunta sobre o resultado de registros ("resultados das agendas com Carlos", "o que foi decidido…"). */
function perguntaPedeResultado(pergunta: string): boolean {
  const t = pergunta.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /\b(resultad\w*|decidid\w*|decis\w*|combinad\w*)\b/.test(t);
}

const PALAVRAS_REGISTRO =
  /^(agenda|reuni|compromiss|tarefa|visita|consulta|encontro|call|conversa|entrega|pendenci|atividade|evento|ligac|todo|to-do)/;

/**
 * A pergunta é sobre o resultado registrado DO PRÓPRIO registro — não sobre "resultado" como assunto
 * ("agendas que analisam resultados da etapa 2" NÃO é). Vale:
 *  - "resultado(s) d(a/o/as/os) [minha/meu] <agenda|reunião|tarefa…|nome da categoria da consulta>";
 *  - "com resultado", "tem/têm/tiveram resultado";
 *  - "o que foi decidido/combinado", "o que ficou decidido/combinado".
 */
function pedeResultadoDoRegistro(pergunta: string, nomeConsulta: string): boolean {
  const sa = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = sa(pergunta);
  if (/\bo que (foi|ficou) (decidid|combinad)\w*/.test(t)) return true;
  if (/\b(com|tem|tenham|tiveram|teve|tinham)\s+(o\s+|um\s+|algum\s+)?resultados?\b/.test(t)) return true;
  const m = t.match(/\bresultados?\s+(?:d[aeo]s?|n[ao]s?)\s+(?:minhas?\s+|meus?\s+|ultim\w+\s+)?(\S+)/);
  if (!m) return false;
  const palavra = m[1];
  if (PALAVRAS_REGISTRO.test(palavra)) return true;
  // Nome da categoria da consulta ("resultados das consultas médicas" → "Consultas médicas — …")
  const raiz = palavra.replace(/s$/, "").slice(0, 5);
  return raiz.length >= 4 && sa(nomeConsulta).split(/[^a-z0-9]+/).some((w) => w.startsWith(raiz));
}

/**
 * Pergunta sobre resultado numa consulta que tem tem_resultado: preenche "sim" sem depender da IA
 * (sem ele, as concluídas e passadas ficam escondidas e a resposta vem vazia ou com outras).
 */
function comResultado(task: PlanoQuery, pergunta: string, queries: QueryDisponivel[]): PlanoQuery {
  const q = queries.find((x) => x.query_id === task.query_id);
  if (!pedeResultadoDoRegistro(pergunta, q?.nome ?? "")) return task;
  const def = q?.params.find((p) => p.nome === "tem_resultado");
  if (!def) return task;
  const atual = task.parametros.find((p) => p.nome === "tem_resultado");
  if (atual && atual.valor != null && String(atual.valor).trim() !== "") return task;
  const novo: PlanoParam = {
    nome: "tem_resultado",
    termo_usuario: "resultado",
    valor: "sim",
    tipo: def.tipo,
    operador_sugerido: "=",
    obrigatorio: false,
    precisa_normalizacao: false,
  };
  return {
    ...task,
    parametros: atual ? task.parametros.map((p) => (p.nome === "tem_resultado" ? novo : p)) : [...task.parametros, novo],
  };
}

/**
 * Pergunta sobre resultado e a tabela não trouxe a coluna resultado (consulta editada à mão ou de antes de
 * "Pedir o resultado"): busca os memos ligados como resultado pelo id de cada linha e acrescenta a coluna.
 * Só acrescenta quando alguma linha tem resultado.
 */
async function anexarResultados(pergunta: string, agregado: PerguntaResultadoEstruturado, porQuery: QueryExecResultado[]): Promise<void> {
  if (!perguntaPedeResultado(pergunta) || agregado.colunas.includes("resultado")) return;
  // Só linhas de memo (id + category/mediatype): id de tabela do ERP não é id de memo
  const deMemo = (l: Record<string, unknown>) => "id" in l && ("category" in l || "mediatype" in l);
  const todas = [...agregado.linhas, ...(agregado.linhasCompletas ?? []), ...porQuery.flatMap((r) => r.linhas)].filter(deMemo);
  const ids = [...new Set(todas.map((l) => Number(l.id)).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return;
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.destino_id AS "destinoId",
              string_agg('#' || o.id || ' ' || LEFT(regexp_replace(COALESCE(o.mediatext, ''), '\\s+', ' ', 'g'), 140), ' | ' ORDER BY r.criado_em) AS "texto"
         FROM memo_relacoes r JOIN memos o ON o.id = r.origem_id AND o.isactive = 1
        WHERE r.destino_id = ANY(?::int[]) AND r.isactive = 1 AND r.tipo = 'resultado'
        GROUP BY r.destino_id`,
      [ids]
    );
    if (!rows.length) return;
    const porId = new Map(rows.map((r) => [Number(r.destinoId), String(r.texto ?? "")]));
    for (const l of todas) if (l.id != null) l.resultado = porId.get(Number(l.id)) ?? null;
    agregado.colunas = [...agregado.colunas, "resultado"];
    for (const r of porQuery) if (!r.colunas.includes("resultado") && r.linhas.some((l) => "id" in l)) r.colunas = [...r.colunas, "resultado"];
  } catch (err) {
    console.warn("[pipe2] resultado:", err instanceof Error ? err.message : err);
  }
}

function listaSemSoma(task: PlanoQuery, pergunta: string): PlanoQuery {
  const ag = task.agregacao;
  if (!ag || ag.group_by.length > 0 || (!ag.medida && !(ag.medidas?.length))) return task;
  const t = pergunta.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const pedeLista = /\b(quais|o que|que contas|liste|listar|lista|mostre|mostrar|exiba|ver|detalhe|extrato|discrimin\w*)\b/.test(t);
  const pedeConta = /\b(quanto|quantos|quantas|total|totais|soma|somar|media|maior|maiores|menor|menores|mais|primeir\w*|ultim\w*|recente|antig\w*|por \w+|mensal|ranking|top)\b/.test(t);
  if (!pedeLista || pedeConta) return task;
  return { ...task, agregacao: { medida: null, campo_medida: null, group_by: [], order_by: ag.order_by, limit: null } };
}

/**
 * Série mensal ("gastos por mês", "total mês a mês") numa consulta de detalhe do banco interno, sem período citado:
 * o padrão da consulta é só o mês atual, e a série saía com um mês. Sem nenhuma data na pergunta, a série começa em
 * 1º de janeiro do ano atual (a data final fica no padrão da consulta).
 */
function periodoPadraoSerie(task: PlanoQuery, queries: QueryDisponivel[]): PlanoQuery {
  const ag = task.agregacao;
  const tpl = queries.find((q) => q.query_id === task.query_id);
  if (!ag || !tpl || tpl.conexaoId != null || !/^\s*detalhe:/i.test(tpl.descricao ?? "")) return task;
  const serie = (ag.group_by_trunc?.length ?? 0) > 0 || ag.group_by.some((c) => /^(_base\.)?mes$/i.test(c));
  if (!serie) return task;
  const ehData = (tipo: string) => /date|data/i.test(tipo);
  const temData = task.parametros.some(
    (p) => p.valor != null && String(p.valor).trim() !== "" && (ehData(p.tipo) || /_(ini|fin)$/i.test(p.nome))
  );
  if (temData) return task;
  const ini = tpl.params.find((p) => /_ini$/i.test(p.nome) && ehData(p.tipo));
  if (!ini) return task;
  const hoje = contextoDatas().calendario["hoje"] ?? new Date().toISOString().slice(0, 10);
  return {
    ...task,
    parametros: [
      ...task.parametros,
      {
        nome: ini.nome,
        termo_usuario: "(série sem período: desde janeiro)",
        valor: `${hoje.slice(0, 4)}-01-01`,
        tipo: ini.tipo,
        operador_sugerido: ">=",
        obrigatorio: false,
        precisa_normalizacao: false,
      },
    ],
  };
}

/**
 * "% do item X sobre o total" (ex.: participação mensal do AST001 no faturamento mensal): o plano traz duas entradas
 * da mesma consulta com a mesma agregação — uma filtrada (o item) e outra com motivo "total geral para cálculo de
 * percentual". Junta as duas numa tabela só, pelas colunas do agrupamento: item, total geral e participação %,
 * calculada aqui (antes a IA da resposta fazia a conta e a tela mostrava duas tabelas soltas). Devolve true se juntou.
 */
export function juntarParticipacaoSubconjunto(plano: PlanoConsulta, porQuery: QueryExecResultado[]): boolean {
  const tTotal = plano.queries.find((q) => /total\s+geral/i.test(q.motivo_uso ?? "") && /percent/i.test(q.motivo_uso ?? ""));
  if (!tTotal) return false;
  const tItem = plano.queries.find((q) => q !== tTotal && q.query_id === tTotal.query_id);
  if (!tItem) return false;
  const rTotal = porQuery.find((r) => r.prioridade === tTotal.prioridade);
  const rItem = porQuery.find((r) => r.prioridade === tItem.prioridade);
  if (!rTotal || !rItem || rTotal.auxiliar || rItem.auxiliar) return false;
  const gb = (tItem.agregacao?.group_by ?? []).map((c) => c.replace(/^_base\./i, "").toLowerCase());
  const gbTotal = (tTotal.agregacao?.group_by ?? []).map((c) => c.replace(/^_base\./i, "").toLowerCase());
  if (gb.join("|") !== gbTotal.join("|")) return false;
  const chaves = gb.map((g) => rItem.colunas.find((c) => c.toLowerCase() === g)).filter((c): c is string => !!c);
  if (chaves.length !== gb.length) return false;
  const medidas = rItem.colunas.filter(
    (c) => !chaves.includes(c) && rTotal.colunas.includes(c) && rItem.linhas.every((l) => l[c] == null || Number.isFinite(Number(l[c])))
  );
  if (!medidas.length) return false;
  // Rótulo do item: valores dos filtros que só a consulta do item tem (ex.: AST001)
  const nomesTotal = new Set(tTotal.parametros.filter((x) => x.valor != null && x.valor !== "").map((x) => x.nome.toLowerCase()));
  const rotulo = tItem.parametros
    .filter((x) => x.valor != null && x.valor !== "" && !nomesTotal.has(x.nome.toLowerCase()))
    .map((x) => (Array.isArray(x.valor) ? x.valor.join(", ") : String(x.valor)))
    .join(" / ")
    .slice(0, 40);
  const uma = medidas.length === 1;
  const nItem = (m: string) => (uma ? rotulo || m : `${m} ${rotulo || "item"}`);
  const nTotal = (m: string) => (uma ? "total geral" : `${m} total geral`);
  const nPct = (m: string) => (uma ? "participação %" : `${m} participação %`);
  const chave = (l: Record<string, unknown>) =>
    chaves.map((c) => (l[c] instanceof Date ? (l[c] as Date).toISOString() : String(l[c] ?? ""))).join("|");
  const totalPorChave = new Map(rTotal.linhas.map((l) => [chave(l), l]));
  const linhas = rItem.linhas.map((l) => {
    const t = totalPorChave.get(chave(l));
    const out: Record<string, unknown> = {};
    for (const c of chaves) out[c] = l[c];
    for (const m of medidas) {
      const v = l[m] == null ? null : Number(l[m]);
      const tot = t?.[m] == null ? null : Number(t[m]);
      out[nItem(m)] = v;
      out[nTotal(m)] = tot;
      out[nPct(m)] = v != null && tot ? Math.round((v / tot) * 1000) / 10 : null;
    }
    return out;
  });
  rItem.linhas = linhas;
  rItem.colunas = [...chaves, ...medidas.flatMap((m) => [nItem(m), nTotal(m), nPct(m)])];
  rItem.totalLinhas = linhas.length;
  porQuery.splice(porQuery.indexOf(rTotal), 1);
  return true;
}

/**
 * Numa série temporal (uma única coluna de agrupamento, truncada por mês/ano/semana/dia) acrescenta, ao lado de
 * cada medida, a coluna "<medida> var. %" com a variação de cada linha sobre a anterior (vazia na primeira).
 * Ordena as linhas pela data. Fora desse formato não faz nada.
 */
function adicionarVariacaoSequencial(task: PlanoQuery, r: QueryExecResultado): void {
  const ag = task.agregacao;
  if (!ag || ag.group_by.length !== 1 || ag.group_by_trunc?.length !== 1 || r.linhas.length < 2) return;
  const colData = r.colunas.find((c) => c.toLowerCase() === ag.group_by[0].toLowerCase());
  if (!colData) return;
  const medidas = r.colunas.filter(
    (c) => c !== colData && r.linhas.every((l) => l[c] == null || Number.isFinite(Number(l[c])))
  );
  if (!medidas.length) return;
  const chave = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ""));
  r.linhas.sort((a, b) => chave(a[colData]).localeCompare(chave(b[colData])));
  const nomeVar = (m: string) => `${m} var. %`;
  r.linhas.forEach((l, i) => {
    for (const m of medidas) {
      const ant = i > 0 ? Number(r.linhas[i - 1][m] ?? 0) : NaN;
      const atual = Number(l[m] ?? 0);
      l[nomeVar(m)] = i === 0 || !ant ? null : Math.round(((atual - ant) / Math.abs(ant)) * 1000) / 10;
    }
  });
  r.colunas = r.colunas.flatMap((c) => (medidas.includes(c) ? [c, nomeVar(c)] : [c]));
}

// ── Executar uma consulta da categoria direto (aba Consultas, botão ▶ Executar) ─────────────────

/**
 * Roda UMA consulta da categoria com os filtros informados, sem IA: mesmo executor do Fale comigo
 * (papel restrito, espaço do grupo, conexão de ERP), para o dono testar o que a IA vai receber.
 */
export async function executarConsultaDireta(input: {
  template: QueryDisponivel;
  valores: Record<string, string>;
  userId: number;
  groupId: number | null;
}): Promise<{ resultado: PerguntaResultadoEstruturado; avisos: string[]; ms: number }> {
  const t0 = Date.now();
  const parametros: PlanoParam[] = [];
  for (const p of input.template.params) {
      const v = (input.valores[p.nome] ?? "").trim();
      if (!v) continue;
      parametros.push({
        nome: p.nome,
        termo_usuario: v,
        valor: ehTipoData(p.tipo) ? (coerceDateParam(v) ?? v) : v,
        tipo: p.tipo,
        operador_sugerido: "=",
        obrigatorio: false,
        precisa_normalizacao: false,
      });
  }
  const plano: PlanoConsulta = {
    queries: [{ query_id: input.template.query_id, motivo_uso: "execução manual", prioridade: 1, parametros, agregacao: null }],
    dados_insuficientes: false,
    pergunta_para_usuario: null,
    observacoes: [],
  };
  const { agregado, avisos } = await executarConsultasPlano({
    plano,
    queriesDisponiveis: [input.template],
    userId: input.userId,
    groupId: input.groupId,
  });
  const linhas = agregado.linhasCompletas ?? agregado.linhas;
  return {
    resultado: { colunas: agregado.colunas, linhas, totalLinhas: Math.max(agregado.totalLinhas, linhas.length) },
    avisos,
    ms: Date.now() - t0,
  };
}

/**
 * O Postgres devolve NUMERIC como texto com todas as casas ("800.000000"). Na resposta, a IA lia o ponto como
 * separador de milhar ("800 mil ações"). Texto no formato decimal do banco vira número; códigos com zero à esquerda
 * e inteiros em texto ficam como estão.
 */
export function numerosDoPostgres(linhas: Record<string, unknown>[]): Record<string, unknown>[] {
  const re = /^-?(0|[1-9]\d{0,14})\.\d{1,10}$/;
  for (const l of linhas) {
    for (const k of Object.keys(l)) {
      const v = l[k];
      if (typeof v === "string" && re.test(v)) {
        const n = Number(v);
        if (Number.isFinite(n)) l[k] = n;
      }
    }
  }
  return linhas;
}
