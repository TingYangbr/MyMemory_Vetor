import type {
  PerguntaCardHistorico,
  PerguntaFiltros,
  PerguntaMemoUsado,
  PerguntaResposta,
  PerguntaResultadoEstruturado,
} from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { invokeLLM } from "../lib/invokeLlm.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Pipe2Input {
  pergunta: string;
  userId: number;
  groupId: number | null;
  filtros: PerguntaFiltros;
  historico: PerguntaCardHistorico[];
}

export interface Pipe2Result {
  resposta: PerguntaResposta;
  apiCost: number;
  dadosEstruturados: PerguntaResultadoEstruturado;
}

interface ConsultaEstruturada {
  intencao: "contagem" | "listagem" | "agrupamento";
  agrupar_por: "mediatype" | "mes" | null;
  filtros: {
    mediaType: string | null;
    dataInicio: string | null;
    dataFim: string | null;
  };
  limite: number;
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const SYSTEM_EXTRACAO_ESTRUTURADA = `Você é um extrator de parâmetros de consultas analíticas para o sistema MyMemory.

Analise a pergunta e extraia os parâmetros para executar uma consulta estruturada sobre os memos do usuário.

Tipos de intenção:
- contagem: perguntas sobre quantidade/total de memos (ex.: "quantos memos tenho?", "total de registros")
- listagem: perguntas para listar/ver memos específicos (ex.: "liste meus memos desta semana", "mostre os últimos 5")
- agrupamento: perguntas sobre distribuição ou comparação (ex.: "quantos por tipo?", "distribuição por mês")

Para intenção "agrupamento":
- agrupar_por="mediatype": por tipo de mídia (áudio, imagem, texto, vídeo, documento, url)
- agrupar_por="mes": por mês/período cronológico
- agrupar_por=null: sem agrupamento (equivale a contagem)

Tipos de mídia válidos: text, audio, image, video, document, url

Para filtros de data, converta expressões relativas ("este mês", "semana passada", "em março") usando a data_referencia fornecida.
Retorne null para filtros não mencionados explicitamente.

Você NÃO deve responder à pergunta. Apenas extraia os parâmetros.
Retorne somente JSON válido.`;

const SYSTEM_RESPOSTA_ESTRUTURADA = `Você é um assistente analítico do MyMemory.

Elabore uma resposta em linguagem natural com base nos dados estruturados fornecidos.
Os dados são resultado de uma consulta direta ao banco de dados — são precisos e determinísticos.
Apresente os dados de forma clara, objetiva e em português do Brasil.
Se os dados forem uma tabela, destaque os pontos mais relevantes.
Não invente informações além dos dados fornecidos.

Retorne somente JSON válido.`;

// ── Utilities ─────────────────────────────────────────────────────────────────

const VALID_MEDIA_TYPES = new Set(["text", "audio", "image", "video", "document", "url"]);

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

// ── Internal: extração via LLM ────────────────────────────────────────────────

async function extrairConsultaEstruturada(input: {
  pergunta: string;
  historico: PerguntaCardHistorico[];
}): Promise<{ consulta: ConsultaEstruturada; costUsd: number }> {
  const hoje = new Date().toISOString().slice(0, 10);

  const userMsg = JSON.stringify({
    pergunta: input.pergunta,
    contexto_sessao: buildContextoSessao(input.historico),
    tipos_midia_validos: ["text", "audio", "image", "video", "document", "url"],
    data_referencia: hoje,
  }, null, 2);

  const user = `Extraia os parâmetros da consulta analítica.\n\nEntrada:\n${userMsg}\n\nRetorne somente JSON:\n{"intencao":"contagem|listagem|agrupamento","agrupar_por":"mediatype|mes|null","filtros":{"mediaType":"text|audio|image|video|document|url|null","dataInicio":"YYYY-MM-DD|null","dataFim":"YYYY-MM-DD|null"},"limite":10}`;

  const { text, costUsd } = await invokeLLM({ system: SYSTEM_EXTRACAO_ESTRUTURADA, user, jsonObject: true, source: "extracao_estruturada" });

  type RawConsulta = {
    intencao?: string;
    agrupar_por?: string | null;
    filtros?: { mediaType?: string | null; dataInicio?: string | null; dataFim?: string | null };
    limite?: number;
  };

  const parsed = safeParseJson<RawConsulta>(text, {});

  const intencao = (["contagem", "listagem", "agrupamento"].includes(String(parsed.intencao ?? ""))
    ? parsed.intencao
    : "contagem") as ConsultaEstruturada["intencao"];

  const agrupar_por = (parsed.agrupar_por && ["mediatype", "mes"].includes(String(parsed.agrupar_por))
    ? parsed.agrupar_por
    : null) as "mediatype" | "mes" | null;

  const mediaTypeRaw = parsed.filtros?.mediaType;
  const mediaType =
    typeof mediaTypeRaw === "string" && VALID_MEDIA_TYPES.has(mediaTypeRaw) ? mediaTypeRaw : null;

  const dataInicio =
    typeof parsed.filtros?.dataInicio === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.filtros.dataInicio)
      ? parsed.filtros.dataInicio
      : null;

  const dataFim =
    typeof parsed.filtros?.dataFim === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.filtros.dataFim)
      ? parsed.filtros.dataFim
      : null;

  const consulta: ConsultaEstruturada = {
    intencao,
    agrupar_por,
    filtros: { mediaType, dataInicio, dataFim },
    limite: typeof parsed.limite === "number" && parsed.limite > 0 ? Math.min(parsed.limite, 20) : 10,
  };

  return { consulta, costUsd };
}

// ── Internal: execução SQL parametrizada ──────────────────────────────────────

async function executarConsultaEstruturada(input: {
  consulta: ConsultaEstruturada;
  userId: number;
  groupId: number | null;
  filtrosBase: PerguntaFiltros;
}): Promise<PerguntaResultadoEstruturado> {
  const { consulta, userId, groupId, filtrosBase } = input;
  const params: unknown[] = [];
  const where: string[] = [];

  if (groupId != null) {
    params.push(groupId);
    where.push("m.groupid = ?");
  } else {
    params.push(userId);
    where.push("m.userid = ? AND m.groupid IS NULL");
  }
  where.push("m.isactive = 1");

  if (filtrosBase.autorId != null) {
    params.push(filtrosBase.autorId);
    where.push("m.userid = ?");
  }

  // Filtros de data: UI tem prioridade sobre os extraídos pelo LLM
  const dataInicio = filtrosBase.dataInicio ?? consulta.filtros.dataInicio;
  const dataFim = filtrosBase.dataFim ?? consulta.filtros.dataFim;

  if (dataInicio) { params.push(dataInicio); where.push("m.createdat >= ?"); }
  if (dataFim) { params.push(dataFim + " 23:59:59"); where.push("m.createdat <= ?"); }
  if (consulta.filtros.mediaType) { params.push(consulta.filtros.mediaType); where.push("m.mediatype = ?"); }

  const whereClause = where.join(" AND ");

  let sql: string;
  let colunas: string[];

  if (consulta.intencao === "agrupamento" && consulta.agrupar_por === "mediatype") {
    sql = `SELECT m.mediatype, COUNT(*)::int AS total
           FROM memos m
           WHERE ${whereClause}
           GROUP BY m.mediatype
           ORDER BY total DESC`;
    colunas = ["mediaType", "total"];
  } else if (consulta.intencao === "agrupamento" && consulta.agrupar_por === "mes") {
    sql = `SELECT TO_CHAR(m.createdat, 'YYYY-MM') AS mes, COUNT(*)::int AS total
           FROM memos m
           WHERE ${whereClause}
           GROUP BY mes
           ORDER BY mes DESC
           LIMIT 24`;
    colunas = ["mes", "total"];
  } else if (consulta.intencao === "listagem") {
    params.push(consulta.limite);
    sql = `SELECT m.id, LEFT(m.mediatext, 300) AS resumo, m.keywords,
                  m.mediatype, TO_CHAR(m.createdat, 'YYYY-MM-DD') AS data
           FROM memos m
           WHERE ${whereClause}
           ORDER BY m.createdat DESC
           LIMIT ?`;
    colunas = ["id", "resumo", "keywords", "mediaType", "data"];
  } else {
    // contagem (default)
    sql = `SELECT COUNT(*)::int AS total FROM memos m WHERE ${whereClause}`;
    colunas = ["total"];
  }

  const [rows] = await pool.query<RowDataPacket[]>(sql, params);

  return {
    colunas,
    linhas: rows as Record<string, unknown>[],
    totalLinhas: rows.length,
  };
}

// ── Internal: síntese em linguagem natural ────────────────────────────────────

async function gerarRespostaEstruturada(input: {
  pergunta: string;
  consulta: ConsultaEstruturada;
  resultado: PerguntaResultadoEstruturado;
}): Promise<{ resposta: PerguntaResposta; costUsd: number }> {
  const userMsg = JSON.stringify({
    pergunta: input.pergunta,
    consulta: {
      intencao: input.consulta.intencao,
      agrupar_por: input.consulta.agrupar_por,
    },
    dados: {
      colunas: input.resultado.colunas,
      linhas: input.resultado.linhas.slice(0, 20),
      total_linhas: input.resultado.totalLinhas,
    },
  }, null, 2);

  const user = `Elabore a resposta com base nos dados estruturados.\n\nEntrada:\n${userMsg}\n\nRetorne somente JSON:\n{"resposta":"","limitacoes":[],"confianca_estimada":1.0}`;

  const { text, costUsd } = await invokeLLM({ system: SYSTEM_RESPOSTA_ESTRUTURADA, user, jsonObject: true, source: "resposta_estruturada" });

  type RawResp = { resposta?: string; limitacoes?: string[]; confianca_estimada?: number };
  const parsed = safeParseJson<RawResp>(text, {});

  // Para listagem, expõe os IDs dos memos em dados_usados (permite abrir o memo no modal)
  const dadosUsados: PerguntaMemoUsado[] =
    input.consulta.intencao === "listagem"
      ? input.resultado.linhas
          .filter((r) => r.id != null)
          .map((r) => ({ memo_id: Number(r.id), trecho_usado: "" }))
      : [];

  const resposta: PerguntaResposta = {
    resposta: String(parsed.resposta ?? "Não foi possível gerar uma resposta."),
    tipo_resposta: "estruturada",
    dados_usados: dadosUsados,
    limitacoes: Array.isArray(parsed.limitacoes) ? (parsed.limitacoes as string[]) : [],
    confianca_estimada: 1.0,
    dados_estruturados: input.resultado,
  };

  return { resposta, costUsd };
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function executarPipe2(input: Pipe2Input): Promise<Pipe2Result> {
  let totalCost = 0;

  const { consulta, costUsd: c1 } = await extrairConsultaEstruturada({
    pergunta: input.pergunta,
    historico: input.historico,
  });
  totalCost += c1;

  const resultado = await executarConsultaEstruturada({
    consulta,
    userId: input.userId,
    groupId: input.groupId,
    filtrosBase: input.filtros,
  });

  const { resposta, costUsd: c2 } = await gerarRespostaEstruturada({
    pergunta: input.pergunta,
    consulta,
    resultado,
  });
  totalCost += c2;

  return { resposta, apiCost: totalCost, dadosEstruturados: resultado };
}
