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
 * Retorna o prompt efetivo para uma chave.
 * Prioridade: override por categoria → texto_atual (global) → texto_padrao.
 * Lança erro se nenhum texto estiver configurado.
 */
export async function getActiveSystemPrompt(chave: string, categoryId?: number | null): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT texto_padrao, texto_atual FROM llm_prompt_configs WHERE chave = $1 LIMIT 1`,
    [chave]
  );
  const row = rows[0];
  const atual = row?.texto_atual != null ? String(row.texto_atual).trim() : null;
  const padrao = row?.texto_padrao != null ? String(row.texto_padrao).trim() : null;
  const basePrompt = (atual || null) ?? (padrao || null);
  if (!basePrompt) {
    throw new Error(
      "Uso de IA requer configuração mínima, não foi encontrada nenhuma preparação, contactar administrador"
    );
  }

  if (categoryId) {
    const [catRows] = await pool.query<RowDataPacket[]>(
      `SELECT texto FROM llm_prompt_category_overrides WHERE prompt_chave = $1 AND category_id = $2 LIMIT 1`,
      [chave, categoryId]
    );
    const catText = catRows[0]?.texto != null ? String(catRows[0].texto).trim() : null;
    if (catText) {
      return catText.includes("{{base_prompt}}") ? catText.replace(/\{\{base_prompt\}\}/g, basePrompt) : catText;
    }
  }

  return basePrompt;
}

// ── Category overrides ────────────────────────────────────────────────────────

export interface LlmPromptCategoryOverrideRow {
  id: number;
  prompt_chave: string;
  category_id: number;
  category_name: string | null;
  texto: string;
  updatedat: string;
}

export async function listCategoryOverrides(chave: string): Promise<LlmPromptCategoryOverrideRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT o.id, o.prompt_chave, o.category_id, c.name AS category_name, o.texto, o.updatedat
     FROM llm_prompt_category_overrides o
     LEFT JOIN categories c ON c.id = o.category_id
     WHERE o.prompt_chave = $1
     ORDER BY c.name ASC`,
    [chave]
  );
  return rows.map((r) => ({
    id: r.id as number,
    prompt_chave: String(r.prompt_chave),
    category_id: r.category_id as number,
    category_name: r.category_name != null ? String(r.category_name) : null,
    texto: String(r.texto ?? ""),
    updatedat: r.updatedat instanceof Date ? r.updatedat.toISOString() : String(r.updatedat ?? ""),
  }));
}

export async function upsertCategoryOverride(chave: string, categoryId: number, texto: string): Promise<void> {
  await pool.query(
    `INSERT INTO llm_prompt_category_overrides (prompt_chave, category_id, texto, updatedat)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (prompt_chave, category_id) DO UPDATE SET texto = EXCLUDED.texto, updatedat = NOW()`,
    [chave, categoryId, texto]
  );
}

export async function deleteCategoryOverride(chave: string, categoryId: number): Promise<void> {
  await pool.query(
    `DELETE FROM llm_prompt_category_overrides WHERE prompt_chave = $1 AND category_id = $2`,
    [chave, categoryId]
  );
}
