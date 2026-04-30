import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";

export interface LlmPromptConfigRow {
  id: number;
  chave: string;
  grupo: string;
  titulo: string;
  texto_padrao: string | null;
  texto_atual: string | null;
  updatedat: string;
}

export async function listPromptConfigs(): Promise<LlmPromptConfigRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, chave, grupo, titulo, texto_padrao, texto_atual, updatedat
     FROM llm_prompt_configs ORDER BY grupo ASC, id ASC`
  );
  return rows.map((r) => ({
    id: r.id as number,
    chave: String(r.chave),
    grupo: String(r.grupo ?? ""),
    titulo: String(r.titulo ?? ""),
    texto_padrao: r.texto_padrao != null ? String(r.texto_padrao) : null,
    texto_atual: r.texto_atual != null ? String(r.texto_atual) : null,
    updatedat: r.updatedat instanceof Date ? r.updatedat.toISOString() : String(r.updatedat ?? ""),
  }));
}

export async function upsertPromptConfig(
  chave: string,
  fields: { texto_padrao?: string | null; texto_atual?: string | null }
): Promise<void> {
  const setParts: string[] = ["updatedat = NOW()"];
  const vals: unknown[] = [];
  let idx = 1;

  if ("texto_padrao" in fields) {
    setParts.push(`texto_padrao = $${idx++}`);
    vals.push(fields.texto_padrao ?? null);
  }
  if ("texto_atual" in fields) {
    setParts.push(`texto_atual = $${idx++}`);
    vals.push(fields.texto_atual ?? null);
  }

  vals.push(chave);
  await pool.query(
    `UPDATE llm_prompt_configs SET ${setParts.join(", ")} WHERE chave = $${idx}`,
    vals
  );
}

/**
 * Retorna o prompt efetivo para uma chave: texto_atual se preenchido, senão texto_padrao.
 * Lança erro com mensagem de configuração ausente se ambos estiverem vazios.
 */
export async function getActiveSystemPrompt(chave: string): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT texto_padrao, texto_atual FROM llm_prompt_configs WHERE chave = $1 LIMIT 1`,
    [chave]
  );
  const row = rows[0];
  const atual = row?.texto_atual?.trim() || null;
  const padrao = row?.texto_padrao?.trim() || null;
  const effective = atual ?? padrao;
  if (!effective) {
    throw new Error(
      "Uso de IA requer configuração mínima, não foi encontrada nenhuma preparação, contactar administrador"
    );
  }
  return effective;
}
