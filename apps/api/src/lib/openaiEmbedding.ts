import { config } from "../config.js";
import { pool } from "../db.js";
import { buildMemoChunkSource, chunkText } from "./chunkText.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { prompt_tokens: number; total_tokens: number };
}

/**
 * Gera embeddings via OpenAI text-embedding-3-small (1536 dims).
 * Retorna array de vetores, um por input.
 */
export async function generateEmbeddings(inputs: string[]): Promise<number[][]> {
  if (!inputs.length) return [];

  const apiKey = config.openai.apiKey;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurado — embeddings indisponíveis");

  const baseUrl = config.openai.baseUrl.replace(/\/v1$/, "");
  const url = `${baseUrl}/v1/embeddings`;

  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI embeddings error ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as OpenAIEmbeddingResponse;
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/**
 * Serializa um vetor number[] para o formato aceito pelo pgvector.
 * Ex.: [0.1, 0.2, 0.3] → "[0.1,0.2,0.3]"
 */
export function serializeVector(v: number[]): string {
  return `[${v.join(",")}]`;
}

/**
 * Processa e armazena os chunks de embedding para um memo.
 * Remove chunks antigos e insere os novos.
 * Falha silenciosamente se a API key não estiver configurada.
 */
export async function upsertMemoChunks(input: {
  memoId: number;
  mediaText: string | null;
  keywords: string | null;
  dadosEspecificosJson: string | null;
}): Promise<void> {
  if (!config.openai.apiKey) return;

  const source = buildMemoChunkSource({
    mediaText: input.mediaText,
    keywords: input.keywords,
    dadosEspecificosJson: input.dadosEspecificosJson,
  });
  if (!source) return;

  const chunks = chunkText(source);
  if (!chunks.length) return;

  const texts = chunks.map((c) => c.text);
  const vectors = await generateEmbeddings(texts);

  await pool.query(`DELETE FROM memo_chunks WHERE memo_id = ?`, [input.memoId]);

  const tuples = chunks.map(() => "(?, ?, ?, ?)").join(", ");
  const values: unknown[] = [];
  for (let i = 0; i < chunks.length; i++) {
    values.push(input.memoId, i, chunks[i].text, serializeVector(vectors[i]));
  }

  await pool.query(
    `INSERT INTO memo_chunks (memo_id, chunk_idx, chunk_text, embedding) VALUES ${tuples}`,
    values
  );
}

/**
 * Busca semântica por similaridade cosine nos chunks de memos.
 * Retorna até `limit` memo IDs ordenados por similaridade decrescente.
 */
/**
 * Restrições de acesso aplicadas DENTRO da busca por semelhança (não depois dos candidatos), para
 * o filtro não perder memos permitidos que ficariam fora dos N primeiros do grupo inteiro.
 * Perfil com "todas as categorias" não passa nada daqui — a busca fica idêntica à de antes.
 */
export interface RestricaoMemos {
  /** Categorias liberadas pelo perfil (nomes). Ausente = sem restrição por categoria. */
  categoriasPermitidas?: string[];
  /** O perfil inclui memos sem categoria. */
  incluiSemCategoria?: boolean;
  /**
   * Nomes de TODAS as categorias que existem para o grupo. Memo cuja categoria não está aqui (apagada,
   * renomeada) conta como "sem categoria", para não sumir da busca.
   */
  categoriasConhecidas?: string[];
  /** Marca "Só os meus": nestas categorias só entram memos do próprio autor. */
  escopoAutor?: { categorias: string[]; userId: number };
}

export function condicoesRestricao(r: RestricaoMemos | undefined): { where: string; vals: unknown[] } {
  if (!r) return { where: "", vals: [] };
  const conds: string[] = [];
  const vals: unknown[] = [];
  const lower = (a: string[]) => a.map((s) => s.toLowerCase());

  if (r.categoriasPermitidas) {
    const parts = ["LOWER(m.category) = ANY(?::text[])"];
    vals.push(lower(r.categoriasPermitidas));
    if (r.incluiSemCategoria) {
      parts.push("m.category IS NULL", "TRIM(m.category) = ''", "NOT (LOWER(m.category) = ANY(?::text[]))");
      vals.push(lower(r.categoriasConhecidas ?? []));
    }
    conds.push(`(${parts.join(" OR ")})`);
  }
  if (r.escopoAutor && r.escopoAutor.categorias.length) {
    conds.push("NOT (COALESCE(LOWER(m.category) = ANY(?::text[]), false) AND m.userid <> ?)");
    vals.push(lower(r.escopoAutor.categorias), r.escopoAutor.userId);
  }
  return { where: conds.length ? " AND " + conds.join(" AND ") : "", vals };
}

export async function searchMemosByEmbedding(input: {
  query: string;
  userId: number;
  groupId: number | null;
  limit?: number;
  minSimilarity?: number;
  dataInicio?: string | null;
  dataFim?: string | null;
  restricao?: RestricaoMemos;
}): Promise<Array<{ memoId: number; similarity: number }>> {
  if (!config.openai.apiKey) return [];

  const [queryVector] = await generateEmbeddings([input.query]);
  if (!queryVector) return [];

  const vectorStr = serializeVector(queryVector);
  const limit = input.limit ?? 20;
  const minSim = input.minSimilarity ?? 0;

  const baseWhere =
    input.groupId != null
      ? `m.groupid = ? AND m.isactive = 1`
      : `m.userid = ? AND m.groupid IS NULL AND m.isactive = 1`;
  const baseVal = input.groupId != null ? input.groupId : input.userId;

  const dateConditions: string[] = [];
  const dateVals: unknown[] = [];
  if (input.dataInicio) { dateConditions.push("m.createdat::date >= ?::date"); dateVals.push(input.dataInicio); }
  if (input.dataFim)    { dateConditions.push("m.createdat::date <= ?::date"); dateVals.push(input.dataFim); }
  const dateWhere = dateConditions.length ? " AND " + dateConditions.join(" AND ") : "";
  const restr = condicoesRestricao(input.restricao);

  const [rows] = await pool.query<{ memoId: number; similarity: number }[]>(
    `SELECT memoid, similarity FROM (
       SELECT m.id AS memoid, 1 - MIN(c.embedding <=> ?::vector) AS similarity
       FROM memo_chunks c
       JOIN memos m ON m.id = c.memo_id
       WHERE ${baseWhere}${dateWhere}${restr.where}
       GROUP BY m.id
     ) sub
     WHERE similarity >= ?
     ORDER BY similarity DESC
     LIMIT ?`,
    [vectorStr, baseVal, ...dateVals, ...restr.vals, minSim, limit]
  );

  return rows
    .map((r) => ({ memoId: r.memoId, similarity: r.similarity }))
    .sort((a, b) => b.similarity - a.similarity);
}
