import type { TextMemoProcessResponse, UserIaUseLevel } from "@mymemory/shared";
import { normalizeMemoKeywordKey } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { config } from "../config.js";
import { fetchAndExtractPlainTextFromUrl } from "../lib/urlFetchText.js";
import { openaiChatJson } from "../lib/openaiChat.js";
import { pool } from "../db.js";
import { assertUserWorkspaceGroupAccess } from "./memoContextService.js";
import {
  ABSOLUTE_CAP,
  clampTextToMax,
  resumoPtBrPromptRule,
  resolveMaxSummaryCharsForText,
} from "./textMemoMaxSummary.js";

const LLM_INPUT_MAX = 48_000;

type CatCtx = {
  id: number;
  name: string;
  subcategories: { name: string }[];
  campos: { name: string; normalizedTerms: string[] }[];
};

export async function loadCategoryContext(
  userId: number,
  groupId: number | null,
  isAdmin: boolean
): Promise<CatCtx[]> {
  if (groupId != null) {
    await assertUserWorkspaceGroupAccess(userId, groupId, isAdmin);
  }
  let [catRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name FROM categories
     WHERE groupId IS NOT DISTINCT FROM ? AND isActive = 1
       AND (mediaType IS NULL OR mediaType = 'text')
     ORDER BY id ASC`,
    [groupId]
  );
  /** Sem categorias do grupo: usar categorias globais (`groupId` NULL). */
  if (!catRows.length && groupId != null) {
    const [globalRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name FROM categories
       WHERE groupId IS NULL AND isActive = 1
         AND (mediaType IS NULL OR mediaType = 'text')
       ORDER BY id ASC`
    );
    catRows = globalRows;
  }
  if (!catRows.length) return [];
  const ids = catRows.map((r) => r.id as number);
  const ph = ids.map(() => "?").join(",");
  const [subRows] = await pool.query<RowDataPacket[]>(
    `SELECT categoryId, name FROM subcategories WHERE categoryId IN (${ph}) AND isActive = 1 ORDER BY id ASC`,
    ids
  );
  let campoRows: RowDataPacket[] = [];
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT categoryId, name, normalizedTerms FROM categorycampos WHERE categoryId IN (${ph}) AND isActive = 1 ORDER BY id ASC`,
      ids
    );
    campoRows = rows;
  } catch {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT categoryId, name FROM categorycampos WHERE categoryId IN (${ph}) AND isActive = 1 ORDER BY id ASC`,
      ids
    );
    campoRows = rows;
  }
  const subs = new Map<number, { name: string }[]>();
  const camps = new Map<number, { name: string; normalizedTerms: string[] }[]>();
  for (const id of ids) {
    subs.set(id, []);
    camps.set(id, []);
  }
  for (const r of subRows) {
    const cid = r.categoryId as number;
    const list = subs.get(cid);
    if (list) list.push({ name: String(r.name) });
  }
  for (const r of campoRows) {
    const cid = r.categoryId as number;
    const list = camps.get(cid);
    if (list)
      list.push({
        name: String(r.name),
        normalizedTerms: parseNormalizedTerms(r.normalizedTerms),
      });
  }
  return catRows.map((r) => ({
    id: r.id as number,
    name: String(r.name),
    subcategories: subs.get(r.id as number) ?? [],
    campos: camps.get(r.id as number) ?? [],
  }));
}

export async function getUserIaUseTexto(userId: number): Promise<UserIaUseLevel> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT iaUseTexto FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const v = rows[0]?.iaUseTexto;
  if (v === "semIA" || v === "basico" || v === "completo") return v;
  return "basico";
}

export async function getUserIaUseUrl(userId: number): Promise<UserIaUseLevel> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT iaUseUrl FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const v = rows[0]?.iaUseUrl;
  if (v === "semIA" || v === "basico" || v === "completo") return v;
  return "basico";
}

export function formatCategoriesBlock(cats: CatCtx[]): string {
  if (!cats.length) return "(Nenhuma categoria cadastrada neste contexto — use apenas categoria_livre se necessário.)";
  return cats
    .map((c) => {
      const sn = c.subcategories.map((s) => s.name).join("; ");
      const fn = c.campos
        .map((f) => {
          const terms = f.normalizedTerms.length ? ` [padrões: ${f.normalizedTerms.join(", ")}]` : "";
          return `${f.name}${terms}`;
        })
        .join("; ");
      return `- ID ${c.id} | Nome exato: "${c.name}"${sn ? ` | Subcategorias conhecidas: ${sn}` : ""}${fn ? ` | Campos: ${fn}` : ""}`;
    })
    .join("\n");
}

/** Bloco de instruções para o modo IA básico (prompt utilizador). */
export function buildTextMemoBasicoUserPrompt(cats: CatCtx[], bodyText: string): string {
  const catNames = cats.map((c) => c.name);
  const subLines: string[] = [];
  const campoLines: string[] = [];
  for (const c of cats) {
    if (c.subcategories.length) {
      subLines.push(`Categoria: ${c.name} (ID ${c.id})`);
      for (const s of c.subcategories) {
        subLines.push(`- ${s.name}`);
      }
      subLines.push("");
    }
    if (c.campos.length) {
      campoLines.push(`Categoria: ${c.name} (ID ${c.id})`);
      for (const f of c.campos) {
        const terms = f.normalizedTerms.length ? ` | padrões: ${f.normalizedTerms.join(", ")}` : "";
        campoLines.push(`- ${f.name}${terms}`);
      }
      campoLines.push("");
    }
  }
  const subBlock =
    subLines.length > 0
      ? subLines.join("\n").trim()
      : "(Nenhuma subcategoria listada — use subcategoria_livre se necessário.)";
  const camposBlock =
    campoLines.length > 0
      ? campoLines.join("\n").trim()
      : "(Nenhum campo listado — devolva dados_especificos.campos como {}.)";

  return [
    "TAREFA (UMA UNICA CHAMADA): extrair categoria, subcategorias e dados especificos do memo, junto com resumo e palavras-chave.",
    "IMPORTANTE: use o catalogo completo abaixo (todas as categorias, todas as subcategorias por categoria e todos os campos por categoria).",
    "",
    "CATALOGO COMPLETO — CATEGORIAS PERMITIDAS:",
    catNames.length ? catNames.map((n) => `- ${n}`).join("\n") : "(nenhuma — use categoria_livre.)",
    "",
    "REGRAS DE CATEGORIA:",
    "- Escolha a categoria com base no SIGNIFICADO do texto, não precisa ser igual ao termo usado.",
    '- Exemplo:  "ação judicial" → classificar como "Processo Judicial" (se existir na lista com esse nome exato).',
    "- Retorne exatamente o nome da categoria da lista.",
    "- Não criar novas categorias, exceto se não foi encontrada nenhuma categoria da lista; nesse caso preencher categoria_livre.",
    "",
    "CATALOGO COMPLETO — SUBCATEGORIAS POR CATEGORIA:",
    subBlock,
    "",
    "REGRAS DE SUBCATEGORIA:",
    "- Escolha a subcategoria com base no SIGNIFICADO do texto, não precisa ser igual ao termo usado.",
    "- Retorne exatamente o nome da subcategoria da lista da respectiva categoria.",
    "- Não criar novas subcategorias, exceto se não foi encontrada nenhuma subcategoria da lista; nesse caso preencher subcategoria_livre.",
    "",
    "CATALOGO COMPLETO — CAMPOS ESPECIFICOS POR CATEGORIA:",
    camposBlock,
    "",
    "REGRAS DE DADOS ESPECIFICOS:",
    "- Preencha dados_especificos.campos em JSON com os campos da categoria escolhida.",
    "- Use somente nomes de campo existentes no catalogo da categoria escolhida.",
    "- Quando o campo tiver padrões listados, normalize o valor escolhendo o padrão mais semelhante ao texto extraído.",
    "- Se não houver padrão semelhante para o campo, mantenha o texto original extraído.",
    "- Se um campo não for identificado no texto, retorne o campo com string vazia.",
    "- Não inventar campos fora da lista.",
    "",
    "SAIDA ESPERADA (EM UMA UNICA RESPOSTA JSON): categoria + subcategorias + palavras_chave + dados_especificos.campos.",
    "",
    "TEXTO PARA PROCESSAMENTO:",
    "",
    "---",
    bodyText,
  ].join("\n");
}

export function matchCategoryId(cats: CatCtx[], llmName: string | null | undefined): number | null {
  if (!llmName?.trim()) return null;
  const t = llmName.trim().toLowerCase();
  for (const c of cats) {
    if (c.name.toLowerCase() === t) return c.id;
  }
  for (const c of cats) {
    if (c.name.toLowerCase().includes(t) || t.includes(c.name.toLowerCase())) return c.id;
  }
  return null;
}

export function uniqueKeywordParts(parts: (string | null | undefined)[]): string {
  const byNorm = new Map<string, string>();
  for (const p of parts) {
    if (!p?.trim()) continue;
    for (const bit of p.split(",")) {
      const s = bit.trim();
      if (!s.length) continue;
      const norm = normalizeMemoKeywordKey(s);
      if (!byNorm.has(norm)) byNorm.set(norm, s);
    }
  }
  return [...byNorm.values()].join(", ");
}

export function parseJsonLoose(raw: string): Record<string, unknown> {
  const t = raw.trim();
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    const i = t.indexOf("{");
    const j = t.lastIndexOf("}");
    if (i >= 0 && j > i) {
      return JSON.parse(t.slice(i, j + 1)) as Record<string, unknown>;
    }
    throw new Error("invalid_json_from_model");
  }
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter(Boolean);
}

function parseNormalizedTerms(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const bit of raw.split(",")) {
    const s = bit.trim();
    if (!s) continue;
    const key = normalizeTextForSimilarity(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function normalizeTextForSimilarity(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scorePatternSimilarity(value: string, pattern: string): number {
  const vNorm = normalizeTextForSimilarity(value);
  const pNorm = normalizeTextForSimilarity(pattern);
  if (!vNorm || !pNorm) return 0;
  if (vNorm === pNorm) return 1;
  if (vNorm.includes(pNorm) || pNorm.includes(vNorm)) return 0.92;

  const vTokens = new Set(vNorm.split(" ").filter(Boolean));
  const pTokens = new Set(pNorm.split(" ").filter(Boolean));
  if (!vTokens.size || !pTokens.size) return 0;
  let inter = 0;
  for (const t of vTokens) {
    if (pTokens.has(t)) inter += 1;
  }
  const union = new Set([...vTokens, ...pTokens]).size;
  return union > 0 ? inter / union : 0;
}

function chooseBestNormalizedTerm(rawValue: string, normalizedTerms: string[]): string {
  const value = rawValue.trim();
  if (!value || !normalizedTerms.length) return value;
  let best: string | null = null;
  let bestScore = 0;
  for (const candidate of normalizedTerms) {
    const score = scorePatternSimilarity(value, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= 0.6 && best ? best : value;
}

function extractBasicoCamposFromJson(j: Record<string, unknown>): Record<string, unknown> {
  const candidates = [j.dados_especificos, j.dadosEspecificos, j.dados_especificos_json];
  for (const c of candidates) {
    let de: unknown = c;
    if (typeof de === "string" && de.trim()) {
      try {
        de = JSON.parse(de);
      } catch {
        de = null;
      }
    }
    if (!de || typeof de !== "object" || Array.isArray(de)) continue;
    const obj = de as Record<string, unknown>;
    const inner = obj.campos;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return inner as Record<string, unknown>;
    }
    const direct: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "campos") continue;
      direct[k] = v;
    }
    if (Object.keys(direct).length > 0) return direct;
  }
  return {};
}

export function normalizeCamposForCategory(
  rawCampos: Record<string, unknown>,
  selectedCategory: CatCtx | undefined,
  allowFreeSpecificFieldsWithoutCategoryMatch = false
): { normalized: Record<string, string>; originals: Record<string, string> } {
  const normalized: Record<string, string> = {};
  const originals: Record<string, string> = {};
  if (!selectedCategory?.campos.length) {
    if (!allowFreeSpecificFieldsWithoutCategoryMatch) return { normalized, originals };
    for (const [k, v] of Object.entries(rawCampos)) {
      const key = k.trim();
      if (!key || key.length > 200) continue;
      const value = v == null ? "" : typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
      originals[key] = value;
      normalized[key] = value;
    }
    return { normalized, originals };
  }

  const rawEntries = Object.entries(rawCampos);
  const byLower = new Map<string, string>();
  for (const [k, v] of rawEntries) {
    const kk = k.trim().toLowerCase();
    if (!kk) continue;
    byLower.set(kk, str(v).trim());
  }

  // Garante shape estável: sempre devolve os campos cadastrados da categoria detectada.
  for (const c of selectedCategory.campos) {
    const key = c.name.trim();
    if (!key) continue;
    const originalVal = byLower.get(key.toLowerCase()) ?? "";
    originals[key] = originalVal;
    normalized[key] = chooseBestNormalizedTerm(originalVal, c.normalizedTerms);
  }
  return { normalized, originals };
}

async function resolveAllowFreeSpecificFieldsWithoutCategoryMatch(
  userId: number,
  groupId: number | null
): Promise<boolean> {
  try {
    if (groupId != null) {
      const [gRows] = await pool.query<RowDataPacket[]>(
        `SELECT allowFreeSpecificFieldsWithoutCategoryMatch FROM groups WHERE id = ? LIMIT 1`,
        [groupId]
      );
      const raw = gRows[0]?.allowFreeSpecificFieldsWithoutCategoryMatch;
      return raw === 1 || raw === true;
    }
    const [uRows] = await pool.query<RowDataPacket[]>(
      `SELECT allowFreeSpecificFieldsWithoutCategoryMatch FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    const raw = uRows[0]?.allowFreeSpecificFieldsWithoutCategoryMatch;
    return raw === 1 || raw === true;
  } catch {
    return false;
  }
}

export async function processTextMemoForReview(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  rawText: string;
  /**
   * Texto mostrado como “original” na revisão e gravado em metadata (ex.: URL do memo por página).
   * Quando omitido, usa-se `rawText`.
   */
  originalTextOverride?: string | null;
  /** Se omitido, usa `users.iaUseTexto`. */
  iaUseTexto?: UserIaUseLevel | null;
  /** Ex.: limite da linha `media_settings` para imagem. */
  maxSummaryChars?: number | null;
}): Promise<TextMemoProcessResponse> {
  const pipelineText = input.rawText.trim();
  if (!pipelineText) {
    throw new Error("empty_text");
  }
  const responseOriginalText = (input.originalTextOverride?.trim() || pipelineText).trim();
  const maxSummaryChars =
    input.maxSummaryChars != null &&
    Number.isFinite(input.maxSummaryChars) &&
    (input.maxSummaryChars as number) > 0
      ? Math.min(input.maxSummaryChars as number, ABSOLUTE_CAP)
      : await resolveMaxSummaryCharsForText(input.userId, input.groupId, input.isAdmin);
  const dbLevel = await getUserIaUseTexto(input.userId);
  const iaLevel = input.iaUseTexto ?? dbLevel;
  const allowFreeSpecificFieldsWithoutCategoryMatch =
    await resolveAllowFreeSpecificFieldsWithoutCategoryMatch(input.userId, input.groupId);
  const cats = await loadCategoryContext(input.userId, input.groupId, input.isAdmin);
  const forLlm = pipelineText.length > LLM_INPUT_MAX ? pipelineText.slice(0, LLM_INPUT_MAX) : pipelineText;
  const truncatedNote = pipelineText.length > LLM_INPUT_MAX;

  if (iaLevel === "semIA") {
    const stored = pipelineText.length > ABSOLUTE_CAP ? pipelineText.slice(0, ABSOLUTE_CAP) : pipelineText;
    const warnings: string[] = [];
    if (pipelineText.length > ABSOLUTE_CAP) {
      warnings.push(
        `Texto truncado para ${ABSOLUTE_CAP.toLocaleString("pt-BR")} caracteres (limite de armazenamento do memo).`
      );
    }
    const reviewLimit = Math.max(maxSummaryChars, Math.min(stored.length, ABSOLUTE_CAP));
    return {
      originalText: responseOriginalText,
      suggestedMediaText: stored,
      suggestedKeywords: "",
      maxSummaryChars: reviewLimit,
      apiCost: 0,
      iaLevel,
      processingWarning: warnings.length ? warnings.join(" ") : null,
    };
  }

  if (!config.openai.apiKey) {
    const suggested = clampTextToMax(pipelineText, maxSummaryChars);
    return {
      originalText: responseOriginalText,
      suggestedMediaText: suggested,
      suggestedKeywords: "",
      maxSummaryChars,
      apiCost: 0,
      iaLevel,
      processingWarning:
        "OPENAI_API_KEY não configurada — memo tratado sem IA. Defina a chave em apps/api/.env.",
    };
  }

  let totalCost = 0;
  let processingWarning: string | null = truncatedNote
    ? "Parte do texto foi truncada na chamada à IA (limite interno); o campo texto original abaixo está completo."
    : null;

  try {
    if (iaLevel === "basico") {
      const summaryRule = `${resumoPtBrPromptRule(maxSummaryChars)} Tipo de mídia do memo: texto; limite aplicável neste processamento: ${maxSummaryChars} caracteres (media_settings / plano e contexto).`;
      const sys = `Você é assistente que analisa memos em texto. Responda APENAS com um único objeto JSON válido (sem markdown), chaves em português:
{
  "idioma_detectado": string,
  "resumo_pt_br": string (resumo fiel em português do Brasil),
  "categoria": string | null (classifique com base no significado do texto),
  "categoria_livre": string | null (categoria livre se nenhuma da lista servir),
  "subcategorias": string[],
  "subcategoria_livre": string[],
  "palavras_chave": string[],
  "dados_especificos": {
    "campos": {}
  }
}
"dados_especificos" deve ser um objeto JSON contendo:
- campos simples (chave: valor)
Regras: ${summaryRule}`;
      const user = buildTextMemoBasicoUserPrompt(cats, forLlm);
      const { content, costUsd } = await openaiChatJson({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      });
      totalCost += costUsd;
      const j = parseJsonLoose(content);
      const resumo = str(j.resumo_pt_br) || pipelineText;
      const suggestedMediaText = clampTextToMax(resumo, maxSummaryChars);
      const categoriaLista = str(j.categoria) || str(j.categoria_lista) || null;
      const catFree = str(j.categoria_livre) || null;
      const subsLista = strArr(j.subcategorias);
      const subsLivre = strArr(j.subcategoria_livre);
      const catId = matchCategoryId(cats, categoriaLista) ?? matchCategoryId(cats, catFree);
      const selectedCat = cats.find((c) => c.id === catId);
      const camposObj = normalizeCamposForCategory(
        extractBasicoCamposFromJson(j),
        selectedCat,
        allowFreeSpecificFieldsWithoutCategoryMatch
      );
      const dadosEspecificosJson =
        Object.keys(camposObj.normalized).length > 0 ? JSON.stringify(camposObj.normalized) : null;
      const dadosEspecificosOriginaisJson =
        Object.keys(camposObj.originals).length > 0 ? JSON.stringify(camposObj.originals) : null;
      const kw = uniqueKeywordParts([
        categoriaLista,
        catFree,
        subsLista.join(", "),
        subsLivre.join(", "),
        strArr(j.palavras_chave).join(", "),
      ]);
      return {
        originalText: responseOriginalText,
        suggestedMediaText,
        suggestedKeywords: kw,
        maxSummaryChars,
        apiCost: Math.round(totalCost * 1e8) / 1e8,
        iaLevel,
        processingWarning,
        dadosEspecificosJson,
        dadosEspecificosOriginaisJson,
        matchedCategoryId: selectedCat?.id ?? null,
        category: selectedCat?.name ?? catFree ?? categoriaLista ?? null,
      };
    }

    // completo — 2 chamadas
    const sys1 = `Você é assistente que analisa memos. Responda APENAS JSON válido:
{
  "idioma_detectado": string,
  "resumo_pt_br": string,
  "categoria_lista": string | null (nome EXATO da lista abaixo ou null),
  "categoria_livre": string | null,
  "palavras_chave": string[] (termos curtos úteis para busca; coerentes com o resumo — a 2.ª passagem só refinará subcategorias/campos)
}`;
    const user1 = `Categorias (use nome exato de categoria_lista quando possível):\n${formatCategoriesBlock(cats)}\n\n---\nTEXTO:\n${forLlm}`;
    const r1 = await openaiChatJson({
      messages: [
        { role: "system", content: sys1 },
        { role: "user", content: user1 },
      ],
    });
    totalCost += r1.costUsd;
    const j1 = parseJsonLoose(r1.content);
    const resumo = str(j1.resumo_pt_br) || pipelineText;
    const catList = str(j1.categoria_lista) || null;
    const catFree = str(j1.categoria_livre) || null;
    const palavrasPasso1 = strArr(j1.palavras_chave);
    const catId = matchCategoryId(cats, catList) ?? matchCategoryId(cats, catFree);
    const cat = cats.find((c) => c.id === catId);
    const subNames = cat?.subcategories.map((s) => s.name) ?? [];
    const campoNames = cat?.campos.map((c) => c.name) ?? [];
    const campoGuide =
      cat?.campos
        .map((c) =>
          c.normalizedTerms.length
            ? `${c.name} (padrões: ${c.normalizedTerms.join(", ")})`
            : `${c.name} (sem padrões)`
        )
        .join("; ") ?? "";

    const sys2 = `Você analisa um memo já resumido. Responda APENAS JSON:
{
  "subcategorias_lista": string[] (subconjunto dos nomes exatos da lista fixa fornecida),
  "subcategorias_livres": string[],
  "campos": object (${allowFreeSpecificFieldsWithoutCategoryMatch
    ? "se houver campos solicitados: chaves = nomes exatos dos campos solicitados; se não houver, extraia campos livres chave→valor"
    : "chaves = nomes exatos dos campos solicitados, valores = texto extraído ou \"\""})
}`;
    const user2 = `Categoria escolhida: ${cat?.name ?? catList ?? catFree ?? "desconhecida"}
Subcategorias permitidas (use só estes nomes em subcategorias_lista): ${subNames.length ? subNames.join(", ") : "(nenhuma — deixe lista vazia)"}
Campos a preencher (chaves do objeto campos): ${campoNames.length ? campoNames.join(", ") : allowFreeSpecificFieldsWithoutCategoryMatch ? "(catálogo vazio — extraia campos livres chave→valor)" : "(nenhum — use {})"}
Guia de padronização dos campos: ${campoGuide || "(sem padrões definidos)"}

RESUMO PT-BR:
${resumo}

TEXTO ORIGINAL (trecho):
${forLlm.slice(0, 12_000)}`;
    const r2 = await openaiChatJson({
      messages: [
        { role: "system", content: sys2 },
        { role: "user", content: user2 },
      ],
    });
    totalCost += r2.costUsd;
    const j2 = parseJsonLoose(r2.content);
    const subsLista = strArr(j2.subcategorias_lista);
    const subsLivres = strArr(j2.subcategorias_livres);
    const camposObj = j2.campos && typeof j2.campos === "object" && !Array.isArray(j2.campos) ? j2.campos : {};
    const camposNormalizados = normalizeCamposForCategory(
      camposObj as Record<string, unknown>,
      cat,
      allowFreeSpecificFieldsWithoutCategoryMatch
    );
    const dadosEspecificosJson =
      Object.keys(camposNormalizados.normalized).length > 0
        ? JSON.stringify(camposNormalizados.normalized)
        : null;
    const dadosEspecificosOriginaisJson =
      Object.keys(camposNormalizados.originals).length > 0
        ? JSON.stringify(camposNormalizados.originals)
        : null;
    const suggestedMediaText = clampTextToMax(resumo, maxSummaryChars);
    const kw = uniqueKeywordParts([
      catList,
      catFree,
      ...palavrasPasso1,
      ...subsLista,
      ...subsLivres,
    ]);

    return {
      originalText: responseOriginalText,
      suggestedMediaText,
      suggestedKeywords: kw,
      maxSummaryChars,
      apiCost: Math.round(totalCost * 1e8) / 1e8,
      iaLevel,
      processingWarning,
      dadosEspecificosJson,
      dadosEspecificosOriginaisJson,
      matchedCategoryId: cat?.id ?? null,
      category: cat?.name ?? catList ?? catFree ?? null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    processingWarning = `Falha na IA (${msg}). Texto exibido sem enriquecimento automático.`;
    return {
      originalText: responseOriginalText,
      suggestedMediaText: clampTextToMax(pipelineText, maxSummaryChars),
      suggestedKeywords: "",
      maxSummaryChars,
      apiCost: Math.round(totalCost * 1e8) / 1e8,
      iaLevel,
      processingWarning,
      category: null,
    };
  }
}

export async function processUrlMemoForReview(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  mediaWebUrl: string;
  iaUseUrl: UserIaUseLevel;
  maxSummaryChars?: number | null;
}): Promise<TextMemoProcessResponse> {
  const href = input.mediaWebUrl.trim();
  if (!href) throw new Error("empty_text");
  let pipelineText: string;
  let extractWarning: string | null = null;
  try {
    const { text, warning } = await fetchAndExtractPlainTextFromUrl(href);
    extractWarning = warning;
    pipelineText = text.trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "url_invalid" || msg === "url_forbidden_host") throw new Error(msg);
    if (msg.startsWith("url_fetch_http_")) throw new Error(msg);
    throw new Error("url_fetch_failed");
  }
  if (!pipelineText) throw new Error("url_no_text");

  const out = await processTextMemoForReview({
    userId: input.userId,
    groupId: input.groupId,
    isAdmin: input.isAdmin,
    rawText: pipelineText,
    originalTextOverride: href,
    iaUseTexto: input.iaUseUrl,
    maxSummaryChars: input.maxSummaryChars,
  });
  const parts = [out.processingWarning, extractWarning].filter((s): s is string => Boolean(s?.trim()));
  if (parts.length) {
    out.processingWarning = parts.join(" ");
  }
  return out;
}

function num01(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.min(1, Math.max(0, v));
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return Math.min(1, Math.max(0, n));
  }
  return null;
}

/**
 * IA básico para memo de vídeo: uma chamada JSON sobre a transcrição do áudio do vídeo
 * (prompt dedicado — não reutiliza o fluxo básico de memo em texto).
 */
export async function processVideoTranscriptBasicoForReview(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  transcript: string;
  maxSummaryChars: number;
}): Promise<Pick<
  TextMemoProcessResponse,
  "suggestedMediaText" | "suggestedKeywords" | "apiCost" | "processingWarning"
>> {
  const originalText = input.transcript.trim();
  const maxSummaryChars =
    Number.isFinite(input.maxSummaryChars) && input.maxSummaryChars > 0
      ? Math.min(input.maxSummaryChars, ABSOLUTE_CAP)
      : await resolveMaxSummaryCharsForText(input.userId, input.groupId, input.isAdmin);

  if (!config.openai.apiKey) {
    return {
      suggestedMediaText: clampTextToMax(originalText, maxSummaryChars),
      suggestedKeywords: "",
      apiCost: 0,
      processingWarning:
        "OPENAI_API_KEY não configurada — memo tratado sem IA. Defina a chave em apps/api/.env.",
    };
  }

  const cats = await loadCategoryContext(input.userId, input.groupId, input.isAdmin);
  const forLlm = originalText.length > LLM_INPUT_MAX ? originalText.slice(0, LLM_INPUT_MAX) : originalText;
  const truncatedNote = originalText.length > LLM_INPUT_MAX;

  const sys = `Você é um assistente que analisa memos multimodais.

Entrada:
- Transcrição de áudio de um vídeo.

Sua tarefa é entender o conteúdo e responder APENAS com um único objeto JSON válido (sem markdown).

Formato obrigatório:
{
  "idioma_detectado": string,
  "resumo_pt_br": string,
  "categoria_lista": string | null,
  "categoria_livre": string | null,
  "subcategorias": string[],
  "palavras_chave": string[],
  "confianca": number
}

Regras:

1) Idioma:
- Detecte o idioma da transcrição.

2) Resumo:
- Sempre em português do Brasil.
- ${resumoPtBrPromptRule(maxSummaryChars)}
- Deve refletir o conteúdo completo do vídeo (início, meio e fim).
- Priorize: objetivo, assunto principal e conclusões.

3) Interpretação:
- Considere que a transcrição pode conter erros (ruído de áudio).
- Ignore repetições, pausas e palavras irrelevantes.

4) Classificação (categoria_lista da tabela Categories)
- Use APENAS uma categoria da lista fornecida (nome exato).
- Se não houver correspondência clara, use null.

5) Categoria livre:
- Preencha somente se categoria_lista for null.

6) Subcategorias:
- Liste de 1 a 3 subcategorias mais específicas.

7) Palavras-chave:
- Entre 5 e 10 termos relevantes.

8) Confiança:
- Número de 0 a 1, baseado na clareza da transcrição e consistência do conteúdo.

9) Não invente informações:
- Se houver dúvida, reduza a confiança.

10) Transcrição sem fala útil:
- Se for só avisos de legendas, créditos, agradecimentos de plataforma ou texto claramente alucinado sem conteúdo falado real, use resumo_pt_br curto (uma frase: não há fala útil), palavras_chave vazias ou mínimas, e confianca abaixo de 0,35.

As categorias permitidas (nomes exatos da tabela \`categories\`) vêm no bloco «Categorias e estrutura do contexto» na mensagem seguinte.

Responda apenas o JSON.`;

  let totalCost = 0;
  let processingWarning: string | null = truncatedNote
    ? "Parte da transcrição foi truncada na chamada à IA (limite interno); o texto original abaixo na revisão está completo."
    : null;

  try {
    const user = `Categorias e estrutura do contexto de trabalho:\n${formatCategoriesBlock(cats)}\n\n---\nTRANSCRIÇÃO DO ÁUDIO DO VÍDEO:\n${forLlm}`;
    const { content, costUsd } = await openaiChatJson({
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });
    totalCost += costUsd;
    const j = parseJsonLoose(content);
    const resumo = str(j.resumo_pt_br) || originalText;
    const suggestedMediaText = clampTextToMax(resumo, maxSummaryChars);
    const kw = uniqueKeywordParts([
      str(j.categoria_lista),
      str(j.categoria_livre),
      strArr(j.subcategorias).join(", "),
      strArr(j.palavras_chave).join(", "),
    ]);
    const conf = num01(j.confianca);
    if (conf != null && conf < 0.45) {
      processingWarning = [processingWarning, `Confiança do modelo na interpretação da transcrição: ${conf.toFixed(2)} (baixa).`]
        .filter(Boolean)
        .join(" ");
    }
    return {
      suggestedMediaText,
      suggestedKeywords: kw,
      apiCost: Math.round(totalCost * 1e8) / 1e8,
      processingWarning,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      suggestedMediaText: clampTextToMax(originalText, maxSummaryChars),
      suggestedKeywords: "",
      apiCost: Math.round(totalCost * 1e8) / 1e8,
      processingWarning: `Falha na IA (${msg}). Texto exibido sem enriquecimento automático.`,
    };
  }
}
