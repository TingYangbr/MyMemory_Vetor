/**
 * Divide texto em chunks com sobreposição para geração de embeddings.
 * Trabalha em nível de palavras para evitar cortes no meio de termos.
 */

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_OVERLAP = 50;

export interface TextChunk {
  text: string;
  index: number;
}

/**
 * Divide `text` em janelas de ~`chunkSize` palavras com sobreposição de `overlap` palavras.
 * Retorna array de chunks em ordem.
 */
export function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP
): TextChunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const step = chunkSize - overlap;
  if (step <= 0) throw new Error("chunkText: overlap must be smaller than chunkSize");

  const chunks: TextChunk[] = [];
  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + chunkSize).join(" ");
    chunks.push({ text: slice, index: chunks.length });
    if (i + chunkSize >= words.length) break;
    i += step;
  }
  return chunks;
}

/**
 * Constrói o texto a ser chunked para um memo:
 * mediaText + keywords + valores do dadosEspecificosJson.
 */
export function buildMemoChunkSource(input: {
  mediaText: string | null;
  keywords: string | null;
  dadosEspecificosJson: string | null;
}): string {
  const parts: string[] = [];

  if (input.mediaText?.trim()) parts.push(input.mediaText.trim());
  if (input.keywords?.trim()) parts.push(input.keywords.trim());

  if (input.dadosEspecificosJson?.trim()) {
    try {
      const obj = JSON.parse(input.dadosEspecificosJson) as Record<string, unknown>;
      const values = Object.values(obj)
        .map((v) => (typeof v === "string" ? v.trim() : String(v ?? "")))
        .filter(Boolean);
      if (values.length) parts.push(values.join(", "));
    } catch {
      // JSON inválido: ignora
    }
  }

  return parts.join(" ").trim();
}
