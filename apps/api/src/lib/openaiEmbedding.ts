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
export async function searchMemosByEmbedding(input: {
  query: string;
  userId: number;
  groupId: number | null;
  limit?: number;
}): Promise<Array<{ memoId: number; similarity: number }>> {
  if (!config.openai.apiKey) return [];

  const [queryVector] = await generateEmbeddings([input.query]);
  if (!queryVector) return [];

  const vectorStr = serializeVector(queryVector);
  const limit = input.limit ?? 20;

  const baseWhere =
    input.groupId != null
      ? `m.groupid = ? AND m.isactive = 1`
      : `m.userid = ? AND m.groupid IS NULL AND m.isactive = 1`;
  const baseVal = input.groupId != null ? input.groupId : input.userId;

  const [rows] = await pool.query<{ memoId: number; similarity: number }[]>(
    `SELECT DISTINCT ON (m.id) m.id AS memoid,
            1 - (c.embedding <=> ?::vector) AS similarity
     FROM memo_chunks c
     JOIN memos m ON m.id = c.memo_id
     WHERE ${baseWhere}
     ORDER BY m.id, c.embedding <=> ?::vector
     LIMIT ?`,
    [vectorStr, baseVal, vectorStr, limit]
  );

  return rows
    .map((r) => ({ memoId: r.memoId, similarity: r.similarity }))
    .sort((a, b) => b.similarity - a.similarity);
}
