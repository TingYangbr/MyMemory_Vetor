import cron from "node-cron";
import { pool } from "../db.js";
import { invokeLLM } from "../lib/invokeLlm.js";
import { creditsFromUsdCost, getUsdToCreditsMultiplier } from "./systemConfigService.js";

/**
 * Título curto do memo: até 5 palavras, gerado por IA e editável pelo autor.
 * Complementa a categoria (não repete as palavras dela). Fica em memos.titulo_curto:
 *   NULL = ainda não gerado · '' = sem título (memo sem IA ou sem texto).
 */

const MAX_PALAVRAS = 5;
const MAX_CHARS = 60;
const MAX_TEXTO_PROMPT = 2500;

type MemoParaTitulo = {
  id: number;
  mediaType: string;
  mediaText: string | null;
  keywords: string | null;
  category: string | null;
  mediaMetadata: unknown;
  original_file_name: string | null;
};

function nivelIa(mediaMetadata: unknown): string | null {
  if (!mediaMetadata) return null;
  try {
    const m = (typeof mediaMetadata === "string" ? JSON.parse(mediaMetadata) : mediaMetadata) as Record<string, unknown>;
    const v = m.iaUseTexto ?? m.iaUseImagem ?? m.iaUseAudio ?? m.iaUseVideo ?? m.iaUseDocumento ?? m.iaUseUrl;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Limpa a resposta da IA: tira aspas/pontuação final, limita palavras e tira termos da categoria. */
export function normalizarTituloCurto(bruto: string, categoria: string | null): string {
  let t = bruto.replace(/[\r\n]+/g, " ").replace(/^["'“”«»\s]+|["'“”«»\s.;:!]+$/g, "").replace(/\s+/g, " ").trim();
  if (categoria) {
    const termosCat = new Set(
      semAcento(categoria).split(/[^a-z0-9]+/).filter((w) => w.length > 3)
    );
    const palavras = t.split(" ");
    const filtradas = palavras.filter((w) => !termosCat.has(semAcento(w).replace(/[^a-z0-9]/g, "")));
    if (filtradas.length > 0) t = filtradas.join(" ");
  }
  t = t.split(" ").slice(0, MAX_PALAVRAS).join(" ");
  if (t.length > MAX_CHARS) t = t.slice(0, MAX_CHARS).trim();
  // primeira letra maiúscula
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

function extrairTitulo(texto: string): string {
  const s = texto.trim();
  try {
    const i = s.indexOf("{");
    const k = s.lastIndexOf("}");
    const j = JSON.parse(i >= 0 && k > i ? s.slice(i, k + 1) : s) as { titulo?: unknown };
    return typeof j.titulo === "string" ? j.titulo : "";
  } catch {
    return s.split("\n")[0] ?? "";
  }
}

/** Gera o título de um memo (chama a IA). Retorna '' quando não há o que resumir. */
async function gerarTitulo(m: MemoParaTitulo): Promise<{ titulo: string; costUsd: number }> {
  const texto = (m.mediaText ?? "").trim();
  if (!texto && !m.original_file_name) return { titulo: "", costUsd: 0 };
  const categoria = (m.category ?? "").trim();
  const system =
    "Você cria títulos curtos para memos de uma empresa. Responda só JSON válido, sem markdown.";
  const user = [
    `Crie um título de no máximo ${MAX_PALAVRAS} palavras, em português, que diga do que trata este memo.`,
    categoria
      ? `A categoria do memo é "${categoria}" e já aparece ao lado do título: NÃO repita palavras da categoria; complemente-a (ex.: nome do cliente, assunto, data, decisão).`
      : "Seja específico (ex.: nome do cliente, assunto, data, decisão).",
    "Sem pontuação final e sem aspas.",
    `Tipo: ${m.mediaType}${m.original_file_name ? ` · arquivo: ${m.original_file_name}` : ""}`,
    m.keywords ? `Palavras-chave: ${m.keywords.slice(0, 300)}` : "",
    `Texto:\n${texto.slice(0, MAX_TEXTO_PROMPT)}`,
    'Responda: {"titulo":"..."}',
  ]
    .filter(Boolean)
    .join("\n");
  const { text, costUsd } = await invokeLLM({
    system,
    user,
    jsonObject: true,
    temperature: 0.2,
    source: "titulo_curto",
  });
  return { titulo: normalizarTituloCurto(extrairTitulo(text), categoria || null), costUsd };
}

const SELECT_MEMO = `SELECT m.id, m.mediatype, m.mediatext, m.keywords, m.category, m.mediametadata, m.original_file_name
  FROM memos m`;

/** Gera e grava o título de um memo. Memos "sem IA" ficam com '' (nenhuma chamada de IA). */
async function processarMemo(m: MemoParaTitulo): Promise<"gerado" | "vazio"> {
  if (nivelIa(m.mediaMetadata) === "semIA") {
    await pool.query(`UPDATE memos SET titulo_curto = '' WHERE id = ? AND titulo_curto IS NULL`, [m.id]);
    return "vazio";
  }
  const { titulo, costUsd } = await gerarTitulo(m);
  if (costUsd > 0) {
    const cred = creditsFromUsdCost(costUsd, await getUsdToCreditsMultiplier());
    await pool.query(
      `UPDATE memos SET titulo_curto = ?, apiCost = COALESCE(apiCost, 0) + ?, usedApiCred = COALESCE(usedApiCred, 0) + ?
       WHERE id = ? AND titulo_curto IS NULL`,
      [titulo, costUsd, cred, m.id]
    );
  } else {
    await pool.query(`UPDATE memos SET titulo_curto = ? WHERE id = ? AND titulo_curto IS NULL`, [titulo, m.id]);
  }
  return titulo ? "gerado" : "vazio";
}

async function processarLista(rows: MemoParaTitulo[]): Promise<{ gerados: number; vazios: number; erros: number }> {
  let gerados = 0;
  let vazios = 0;
  let erros = 0;
  for (const m of rows) {
    try {
      const r = await processarMemo(m);
      if (r === "gerado") gerados++;
      else vazios++;
    } catch (err) {
      erros++;
      console.warn(`[tituloCurto] memo ${m.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { gerados, vazios, erros };
}

/** Memos novos (últimos 2 dias) ainda sem título. Chamado pelo robô a cada 2 minutos. */
export async function gerarTitulosPendentes(limite = 20) {
  const [rows] = await pool.query<MemoParaTitulo[]>(
    `${SELECT_MEMO}
     WHERE m.titulo_curto IS NULL AND m.isactive = 1
       AND m.createdat > NOW() - INTERVAL '2 days'
       AND m.createdat < NOW() - INTERVAL '1 minute'
     ORDER BY m.id DESC
     LIMIT ?`,
    [limite]
  );
  return processarLista(rows);
}

/** Quantos memos de um grupo ainda não têm título (para o botão do admin). */
export async function contarSemTitulo(groupId: number): Promise<number> {
  const [rows] = await pool.query<{ c: unknown }[]>(
    `SELECT COUNT(*) AS c FROM memos WHERE groupid = ? AND isactive = 1 AND titulo_curto IS NULL`,
    [groupId]
  );
  return Number(rows[0]?.c ?? 0);
}

/** Preenche títulos dos memos antigos de um grupo (em lotes; gasta créditos de IA). */
export async function gerarTitulosDoGrupo(groupId: number, limite: number) {
  const lim = Math.min(Math.max(Math.floor(limite) || 1, 1), 200);
  const [rows] = await pool.query<MemoParaTitulo[]>(
    `${SELECT_MEMO}
     WHERE m.groupid = ? AND m.isactive = 1 AND m.titulo_curto IS NULL
     ORDER BY m.id DESC
     LIMIT ?`,
    [groupId, lim]
  );
  const r = await processarLista(rows);
  return { ...r, restantes: await contarSemTitulo(groupId) };
}

let iniciado = false;
let rodando = false;

/** Robô dos títulos curtos: a cada 2 minutos gera títulos dos memos recém-catalogados. */
export function iniciarTituloCurtoScheduler(): void {
  if (iniciado) return;
  iniciado = true;
  console.info("[tituloCurtoScheduler] iniciado (a cada 2 min)");
  cron.schedule("*/2 * * * *", async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await gerarTitulosPendentes();
      if (r.gerados || r.erros) console.info("[tituloCurtoScheduler]", r);
    } catch (err) {
      console.error("[tituloCurtoScheduler] erro:", err instanceof Error ? err.message : err);
    } finally {
      rodando = false;
    }
  });
}
