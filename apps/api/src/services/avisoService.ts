import crypto from "node:crypto";
import type { AvisoExecucaoSnapshot, AvisoQueryParamSnapshot, FrequenciaTipo } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { invokeLLM } from "../lib/invokeLlm.js";
import { searchMemosByEmbedding } from "../lib/openaiEmbedding.js";
import { sendAvisoAlert } from "../lib/mail.js";
import { bindTemplateParams, type PlanoParam } from "./perguntaPipe2.js";
import { executeQueryMssql } from "./adminDbConnectionsService.js";
import { config } from "../config.js";

// ── Tipos internos ─────────────────────────────────────────────────────────────

interface QueryTemplate {
  id: number;
  sentencaSql: string;
  conexaoId: number | null;
  params: Array<{
    nome: string;
    tipo: string;
    obrigatorio: boolean;
    operadorSql: string;
    normalizar: boolean;
  }>;
}

interface ResultadoExecucao {
  memoIds?: number[];
  queryResults?: Record<number, Record<string, unknown>[]>;
  respostaTexto?: string;
}

// ── Utilitários ────────────────────────────────────────────────────────────────

function hashResultado(resultado: ResultadoExecucao): string {
  const str = JSON.stringify({
    memoIds: resultado.memoIds ? [...resultado.memoIds].sort() : undefined,
    queryResults: resultado.queryResults,
  });
  return crypto.createHash("sha256").update(str).digest("hex");
}

async function fetchQueryTemplate(queryId: number): Promise<QueryTemplate | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, sentencasql, conexaoid FROM queries_categoria WHERE id = ? AND isactive = 1`,
    [queryId]
  );
  if (!(rows as unknown[]).length) return null;
  const row = (rows as Record<string, unknown>[])[0];

  const [pRows] = await pool.query<RowDataPacket[]>(
    `SELECT campo, tipo, obrigatorio, operadorsql, normalizar
     FROM queries_categoria_params WHERE queryid = ? AND isactive = 1 ORDER BY ordem ASC, id ASC`,
    [queryId]
  );
  return {
    id: row.id as number,
    sentencaSql: row.sentencaSql as string,
    conexaoId: row.conexaoId as number | null,
    params: (pRows as Record<string, unknown>[]).map((p) => ({
      nome: p.campo as string,
      tipo: p.tipo as string,
      obrigatorio: Boolean(p.obrigatorio),
      operadorSql: p.operadorSql as string,
      normalizar: Boolean(p.normalizar),
    })),
  };
}

function toPlanoParams(snapParams: AvisoQueryParamSnapshot[]): PlanoParam[] {
  return snapParams.map((p) => ({
    nome: p.nome,
    termo_usuario: String(p.valor ?? ""),
    valor: p.valor,
    tipo: p.tipo,
    operador_sugerido: p.operadorSugerido,
    obrigatorio: false,
    precisa_normalizacao: p.precisaNormalizacao,
  }));
}

// ── Geração de sugestão de aviso ───────────────────────────────────────────────

export async function gerarSugestaoAviso(
  pergunta: string,
  pipe: "semantica" | "estruturada" | "hibrida",
  queriesUsadas: Array<{ nome: string }> = []
): Promise<{ texto: string; custoUsd: number }> {
  if (pipe === "semantica" || queriesUsadas.length <= 1) {
    return { texto: "Me avise quando a resposta desta pergunta mudar.", custoUsd: 0 };
  }

  const nomeQueries = queriesUsadas.map((q) => q.nome).join(", ");
  const user = `Pergunta original: "${pergunta}"\nConsultas utilizadas: ${nomeQueries}\n\nGere uma frase curta em português no formato "Me avise quando [condição]", descrevendo o que está sendo monitorado. Retorne apenas a frase, sem aspas.`;
  const { text, costUsd } = await invokeLLM({
    system: "Você gera frases curtas de monitoramento para alertas automáticos.",
    user,
    temperature: 0.3,
    source: "aviso_suggestion",
  });

  return { texto: text.trim() || "Me avise quando a resposta desta pergunta mudar.", custoUsd: costUsd };
}

// ── Re-execução e detecção de mudança ─────────────────────────────────────────

export async function reexecutarSnapshot(
  snapshot: AvisoExecucaoSnapshot,
  perguntaOriginal: string,
  userId: number,
  groupId: number | null
): Promise<ResultadoExecucao> {
  const resultado: ResultadoExecucao = {};

  if (snapshot.tipo === "semantica" || snapshot.tipo === "hibrida") {
    const limiar = snapshot.limiar ?? 0.6;
    const hits = await searchMemosByEmbedding({
      query: perguntaOriginal,
      userId,
      groupId,
      limit: 50,
      minSimilarity: limiar,
    });
    resultado.memoIds = hits.map((h) => h.memoId);
  }

  if (snapshot.tipo === "estruturada" || snapshot.tipo === "hibrida") {
    resultado.queryResults = {};
    for (const qs of snapshot.queries ?? []) {
      const template = await fetchQueryTemplate(qs.queryId);
      if (!template) continue;

      const planoParams = toPlanoParams(qs.parametros);

      if (template.conexaoId != null) {
        const paramValues: Record<string, unknown> = { userid: userId, groupid: groupId };
        for (const p of qs.parametros) paramValues[p.nome.toLowerCase()] = p.valor ?? null;
        const paramDefs = template.params.map((p) => ({ nome: p.nome, operadorSql: p.operadorSql }));
        const result = await executeQueryMssql(template.conexaoId, template.sentencaSql, paramValues, paramDefs, {});
        resultado.queryResults[qs.queryId] = result.linhas;
      } else {
        const { sql, values } = bindTemplateParams(
          template.sentencaSql,
          planoParams,
          template.params.map((p) => ({ nome: p.nome, tipo: p.tipo, obrigatorio: p.obrigatorio, operadorSql: p.operadorSql, normalizar: p.normalizar, descricao_campo: null, exemplos_valores: [] })),
          { userid: userId, groupid: groupId }
        );
        const [rows] = await pool.query<RowDataPacket[]>(sql, values);
        resultado.queryResults[qs.queryId] = rows as Record<string, unknown>[];
      }
    }
  }

  return resultado;
}

function detectarMudanca(anterior: ResultadoExecucao, atual: ResultadoExecucao): boolean {
  if (anterior.memoIds !== undefined && atual.memoIds !== undefined) {
    const setAnterior = new Set(anterior.memoIds);
    const intersecao = atual.memoIds.filter((id) => setAnterior.has(id)).length;
    const minLen = Math.max(1, anterior.memoIds.length);
    if (intersecao / minLen < 0.8) return true;
  }

  if (anterior.queryResults !== undefined && atual.queryResults !== undefined) {
    const hashAnt = crypto.createHash("sha256").update(JSON.stringify(anterior.queryResults)).digest("hex");
    const hashAtu = crypto.createHash("sha256").update(JSON.stringify(atual.queryResults)).digest("hex");
    if (hashAnt !== hashAtu) return true;
  }

  return false;
}

async function gerarTextoAviso(
  descricao: string,
  perguntaOriginal: string,
  resultadoAnterior: ResultadoExecucao,
  resultadoAtual: ResultadoExecucao
): Promise<{ texto: string; custoUsd: number }> {
  const user = JSON.stringify({
    descricao_aviso: descricao,
    pergunta_original: perguntaOriginal,
    resultado_anterior: resultadoAnterior.queryResults ?? { memoIds: resultadoAnterior.memoIds },
    resultado_atual: resultadoAtual.queryResults ?? { memoIds: resultadoAtual.memoIds },
  }, null, 2);

  const { text, costUsd } = await invokeLLM({
    system: "Você gera avisos concisos em português sobre mudanças detectadas em monitoramentos automáticos. Seja direto e objetivo, máximo 3 frases.",
    user: `Gere um aviso sobre a mudança detectada:\n${user}`,
    temperature: 0.3,
    source: "aviso_alert",
  });
  return { texto: text.trim(), custoUsd: costUsd };
}

// ── Aviso template (pipe estruturado, 1 query) ────────────────────────────────

function gerarTextoAvisoTemplate(
  descricao: string,
  resultadoAnterior: ResultadoExecucao,
  resultadoAtual: ResultadoExecucao
): string {
  const queryIds = Object.keys(resultadoAtual.queryResults ?? {});
  if (queryIds.length > 0) {
    const qid = Number(queryIds[0]);
    const anterior = (resultadoAnterior.queryResults ?? {})[qid] ?? [];
    const atual = (resultadoAtual.queryResults ?? {})[qid] ?? [];
    return `Aviso "${descricao}": alteração detectada. ${atual.length} registro(s) encontrado(s) (anterior: ${anterior.length}).`;
  }
  return `Aviso "${descricao}": alteração detectada.`;
}

// ── Próxima execução ───────────────────────────────────────────────────────────

export function calcularProximaExecucao(tipo: FrequenciaTipo, horas?: number | null): Date {
  const now = new Date();
  if (tipo === "horas") {
    const h = horas && horas > 0 ? horas : 6;
    return new Date(now.getTime() + h * 60 * 60 * 1000);
  }
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (tipo === "diaria") {
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }
  if (tipo === "semanal") {
    next.setDate(next.getDate() + 7);
    return next;
  }
  // mensal
  next.setMonth(next.getMonth() + 1);
  return next;
}

// ── Executar aviso ─────────────────────────────────────────────────────────────

const HISTORICO_FIFO_LIMIT = 3;

export async function executarAviso(avisoId: number): Promise<{ mudanca: boolean; custoUsd: number }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, userid, groupid, descricao, perguntaoriginal, pipe,
            execucaosnapshotjson, canaldestino, canalenvio,
            ultimoresultadojson, frequenciatipo, frequenciahoras
     FROM avisos WHERE id = ? AND status = 'ativo'`,
    [avisoId]
  );
  if (!(rows as unknown[]).length) return { mudanca: false, custoUsd: 0 };

  const aviso = (rows as Record<string, unknown>[])[0];
  const snapshot = aviso.execucaoSnapshotJson as AvisoExecucaoSnapshot;
  const userId = aviso.userId as number;
  const groupId = aviso.groupId as number | null;
  const descricao = aviso.descricao as string;
  const perguntaOriginal = aviso.perguntaOriginal as string;
  const pipe = aviso.pipe as string;
  const canalEnvio = aviso.canalEnvio as string;
  const canalDestino = aviso.canalDestino as string;
  const ultimoResultado = aviso.ultimoResultadoJson as ResultadoExecucao | null;
  const frequenciaTipo = aviso.frequenciaTipo as FrequenciaTipo;
  const frequenciaHoras = aviso.frequenciaHoras as number | null;

  let totalCustoUsd = 0;

  // Re-executa
  const resultadoAtual = await reexecutarSnapshot(snapshot, perguntaOriginal, userId, groupId);
  const proxima = calcularProximaExecucao(frequenciaTipo, frequenciaHoras);

  // Sem estado anterior — salva estado inicial e agenda
  if (!ultimoResultado) {
    await pool.query(
      `UPDATE avisos SET ultimoresultadojson = ?, ultimaexecucao = NOW(), proximaexecucao = ? WHERE id = ?`,
      [JSON.stringify(resultadoAtual), proxima.toISOString(), avisoId]
    );
    return { mudanca: false, custoUsd: 0 };
  }

  const mudou = detectarMudanca(ultimoResultado, resultadoAtual);

  if (mudou) {
    const ehSingle = pipe === "estruturada" && (snapshot.queries?.length ?? 0) <= 1;
    let textoAviso: string;

    if (ehSingle) {
      textoAviso = gerarTextoAvisoTemplate(descricao, ultimoResultado, resultadoAtual);
    } else {
      const { texto, custoUsd } = await gerarTextoAviso(descricao, perguntaOriginal, ultimoResultado, resultadoAtual);
      textoAviso = texto;
      totalCustoUsd += custoUsd;
    }

    // Envia e-mail (ou canal futuro)
    const linkVisualizacao = `${config.publicWebUrl}/avisos`;
    if (canalEnvio === "email") {
      await sendAvisoAlert({ to: canalDestino, descricao, texto: textoAviso, linkVisualizacao });
    }

    // Salva histórico com FIFO
    await pool.query(
      `INSERT INTO aviso_historico (avisoid, texto, custousd) VALUES (?, ?, ?)`,
      [avisoId, textoAviso, totalCustoUsd]
    );
    await pool.query(
      `DELETE FROM aviso_historico WHERE id NOT IN (
         SELECT id FROM aviso_historico WHERE avisoid = ? ORDER BY enviadoem DESC LIMIT ?
       ) AND avisoid = ?`,
      [avisoId, HISTORICO_FIFO_LIMIT, avisoId]
    );

    await pool.query(
      `UPDATE avisos SET ultimoresultadojson = ?, ultimaexecucao = NOW(), proximaexecucao = ? WHERE id = ?`,
      [JSON.stringify(resultadoAtual), proxima.toISOString(), avisoId]
    );

    // Registra custo na tabela de usage
    if (totalCustoUsd > 0) {
      await pool.query(
        `INSERT INTO api_usage_logs (userid, operation, model, costusd) VALUES (?, 'Monitoring Alert', 'aggregate', ?)`,
        [userId, totalCustoUsd]
      );
    }
  } else {
    await pool.query(
      `UPDATE avisos SET ultimaexecucao = NOW(), proximaexecucao = ? WHERE id = ?`,
      [proxima.toISOString(), avisoId]
    );
  }

  return { mudanca: mudou, custoUsd: totalCustoUsd };
}
