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

interface PlanoAgregacao {
  medida: "count" | "sum" | "avg" | "min" | "max" | null;
  campo_medida: string | null;
  group_by: string[];
  order_by: { campo: string; direcao: "asc" | "desc" }[];
  limit: number | null;
}

interface PlanoQuery {
  query_id: string;
  motivo_uso: string;
  prioridade: number;
  parametros: PlanoParam[];
  agregacao?: PlanoAgregacao | null;
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

// ── Prompts ───────────────────────────────────────────────────────────────────

const SYSTEM_PLANEJAMENTO_ESTRUTURADO = `Você é um planejador de consultas estruturadas do MyMemory. Sua função é escolher uma ou mais queries cadastradas, preencher os parâmetros de filtro e, quando necessário, especificar uma agregação analítica.

Você receberá as queries disponíveis para a categoria identificada. Cada query inclui:
- sentenca_sql: o SQL que será executado — use para identificar os nomes exatos das colunas retornadas
- params: parâmetros de filtro, cada um podendo ter descricao_campo e exemplos_valores

Use descricao_campo e exemplos_valores para associar com precisão os termos do usuário ao parâmetro correto.
Por exemplo: se o usuário menciona "diabete" e há um parâmetro com descricao_campo="Diagnóstico médico do paciente" e exemplos_valores=["diabetes","hipertensão"], associe "diabete" a esse parâmetro.

Extração de valores numéricos: quando o usuário menciona uma quantidade com descritor de unidade (ex: "1 vaga", "2 dormitórios", "3 banheiros", "1 suite"), extraia SOMENTE o número como valor do parâmetro — nunca inclua o descritor. Exemplos: "1 vaga" → valor "1"; "2 dormitórios" → valor "2"; "3 banheiros" → valor "3". Se os exemplos_valores do parâmetro forem numéricos (["1","2","3"]), sempre retorne o número puro.

Parâmetros de sistema (NUNCA peça ao usuário, são injetados automaticamente pelo backend):
- userid, groupid — identificação do contexto do usuário; sempre disponíveis.

Data de referência:
- A entrada inclui o campo "data_atual" com a data de hoje no formato YYYY-MM-DD
- Use data_atual para resolver referências relativas: "este mês" → ano-mês de data_atual, "hoje" → data_atual, "mês passado" → mês anterior a data_atual, etc.
- NUNCA use datas do seu treinamento — sempre derive de data_atual

Regras de filtro:
- Escolha somente queries da lista queries_disponiveis
- Preencha os parâmetros com base na pergunta, no contexto da sessão e nas descrições/exemplos de cada parâmetro
- Para parâmetros não mencionados na pergunta, retorne valor null
- Só sinalize dados_insuficientes: true quando NENHUMA query puder ser executada
- Você NÃO deve criar SQL — apenas selecionar queries, preencher parâmetros e especificar agregação

Agregação analítica (campo "agregacao"):
Quando a pergunta solicitar contagem, soma, média, agrupamento, ordenação ou limite de resultados analíticos, preencha o campo "agregacao" na query selecionada usando os nomes de coluna que aparecem no sentenca_sql:
- medida: "count" | "sum" | "avg" | "min" | "max" (null se não precisar de função de agregação)
- campo_medida: nome exato da coluna para sum/avg/min/max; null para count
- group_by: lista de nomes de coluna para agrupar os resultados
- order_by: lista de {campo, direcao: "asc"|"desc"} para ordenar os resultados agregados
- limit: número máximo de grupos/linhas (padrão 50 quando não especificado; máximo 1000)
Se a pergunta não precisar de agregação, omita "agregacao" ou defina como null.

Retorne somente JSON válido`;

const SYSTEM_RESPOSTA_ESTRUTURADA = `Você é um assistente de resposta do MyMemory.

Responda à pergunta do usuário usando somente os resultados estruturados fornecidos.
Não invente números.
Não altere totais.
Não use conhecimento externo.
Se o resultado for vazio ou insuficiente, informe isso claramente.

A resposta deve ser clara, objetiva e em português do Brasil.
Retorne somente JSON válido.`;

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

/** Valida e double-quota um identificador de coluna para uso seguro em SQL. */
function sanitizeIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Nome de coluna inválido: "${name}"`);
  }
  return `"${name}"`;
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

function applyAgregacao(baseSql: string, ag: PlanoAgregacao): string {
  const cleanBase = stripLimitOffset(baseSql);

  const groupCols = ag.group_by.map(sanitizeIdentifier);

  // Normaliza o campo de order_by: se o LLM referenciou o alias da medida pelo nome
  // genérico (ex: "count"), substitui pelo alias real gerado abaixo (ex: "contagem").
  const resolveOrderCampo = (campo: string): string =>
    MEDIDA_ALIAS[campo.toLowerCase()] ?? campo;

  const limitClause = ag.limit ? ` LIMIT ${ag.limit}` : "";

  // Sem função de medida — apenas ORDER BY + LIMIT (ex.: "mostre os 10 mais recentes")
  if (!ag.medida) {
    const cols = groupCols.length > 0 ? groupCols.join(", ") : "*";
    const orderClauses = ag.order_by.map(
      (o) => `${sanitizeIdentifier(resolveOrderCampo(o.campo))} ${o.direcao === "desc" ? "DESC" : "ASC"}`
    );
    let sql = `WITH _base AS (\n${cleanBase}\n) SELECT ${cols} FROM _base`;
    if (orderClauses.length) sql += ` ORDER BY ${orderClauses.join(", ")}`;
    sql += limitClause;
    return sql;
  }

  let measureAlias: string;
  let measureExpr: string;
  if (ag.medida === "count") {
    measureAlias = "contagem";
    measureExpr = `COUNT(*) AS ${measureAlias}`;
  } else {
    if (!ag.campo_medida) throw new Error(`campo_medida obrigatório para medida "${ag.medida}"`);
    const col = sanitizeIdentifier(ag.campo_medida);
    const fnName = { sum: "SUM", avg: "AVG", min: "MIN", max: "MAX" }[ag.medida];
    measureAlias = { sum: "total", avg: "media", min: "minimo", max: "maximo" }[ag.medida];
    measureExpr = `${fnName}(${col}) AS ${measureAlias}`;
  }

  const orderClauses = ag.order_by.map(
    (o) => `${sanitizeIdentifier(resolveOrderCampo(o.campo))} ${o.direcao === "desc" ? "DESC" : "ASC"}`
  );

  const selectList = groupCols.length > 0
    ? `${groupCols.join(", ")}, ${measureExpr}`
    : measureExpr;

  let sql = `WITH _base AS (\n${cleanBase}\n) SELECT ${selectList} FROM _base`;
  if (groupCols.length > 0) sql += ` GROUP BY ${groupCols.join(", ")}`;
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
  for (const p of llmParams) {
    if (p.nome) paramMap[p.nome.toLowerCase()] = p.valor ?? null;
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
  }
  const tokens: Token[] = [];
  const re = /(?<!:):([a-zA-Z][a-zA-Z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentencaSql)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, name: m[1] });
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
    const def = defByName.get(key);
    const cast = SYSTEM_PARAM_CAST[key] ?? TIPO_PG_CAST[def?.tipo ?? ""] ?? "text";

    if (token.colExpr !== undefined && token.colStart !== undefined) {
      if (token.isUnaccentLike) {
        // Texto ILIKE accent-insensitive: substitui "col ILIKE :param" por "unaccent(col) ILIKE ?::text"
        const stripped = String(val).normalize("NFD").replace(/\p{Mn}/gu, "");
        result += sentencaSql.slice(pos, token.colStart);
        result += `unaccent(${token.colExpr}) ILIKE ?::text`;
        values.push(`%${stripped}%`);
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
      if (val !== null && val !== undefined && /LIKE/i.test(def?.operadorSql ?? "")) {
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

  const user = `Planeje a execução estruturada.\n\nEntrada:\n${entradaJson}\n\nRetorne somente JSON neste formato:\n{"queries":[{"query_id":"","motivo_uso":"","prioridade":1,"parametros":[{"nome":"","termo_usuario":"","valor":null,"tipo":"texto|lista_texto|data|numero|boolean","operador_sugerido":"=|IN|BETWEEN|>=|<=|LIKE","obrigatorio":true,"precisa_normalizacao":true}],"agregacao":{"medida":"count|sum|avg|min|max|null","campo_medida":"nome_coluna_ou_null","group_by":["coluna"],"order_by":[{"campo":"coluna","direcao":"asc|desc"}],"limit":50}}],"dados_insuficientes":false,"pergunta_para_usuario":null,"observacoes":[]}`;

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
          const limit = typeof ag.limit === "number" && ag.limit > 0 ? Math.min(ag.limit, 1000) : null;
          if (medida || group_by.length > 0 || order_by.length > 0 || limit) {
            agregacao = {
              medida,
              campo_medida: typeof ag.campo_medida === "string" && ag.campo_medida.length > 0 ? ag.campo_medida : null,
              group_by,
              order_by,
              limit,
            };
          }
        }
        queries.push({
          query_id: String(qObj.query_id ?? ""),
          motivo_uso: String(qObj.motivo_uso ?? ""),
          prioridade: typeof qObj.prioridade === "number" ? qObj.prioridade : 1,
          parametros,
          agregacao,
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

  for (const task of plano.queries) {
    const template = queriesDisponiveis.find((q) => q.query_id === task.query_id);
    if (!template) continue;

    const { sql: baseSql, values } = bindTemplateParams(
      template.sentencaSql,
      task.parametros,
      template.params,
      { userid: userId, groupid: groupId }
    );

    let finalSql = baseSql;
    if (task.agregacao) {
      try {
        finalSql = applyAgregacao(baseSql, task.agregacao);
      } catch (err) {
        // Coluna inválida ou campo_medida ausente — executa sem agregação
        console.warn("[Pipe2] applyAgregacao ignorada:", err instanceof Error ? err.message : err);
      }
    }

    const [rows] = await pool.query<RowDataPacket[]>(finalSql, values);
    const linhas = rows as Record<string, unknown>[];
    const colunasQuery = linhas.length > 0 ? Object.keys(linhas[0]) : [];

    porQuery.push({ query_id: task.query_id, colunas: colunasQuery, linhas, totalLinhas: linhas.length });

    if (colunas.length === 0) colunas = colunasQuery;
    allLinhas.push(...linhas);
    sqlParts.push(finalSql);
    allValues.push(...values);
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

  const resultados = input.porQuery.map((r) => ({
    query_id: r.query_id,
    colunas: r.colunas,
    linhas: r.linhas.slice(0, 20),
    total_linhas: r.totalLinhas,
  }));

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
    dados_estruturados: input.agregado,
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
