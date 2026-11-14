import type { MemoContextCategory, MemoContextCampo, MemoCreatedResponse, UserIaUseLevel } from "@mymemory/shared";
import { apiPatchJson, apiPostJson } from "../api";

/**
 * Lote 2 (Catalogar e editar): as telas novas de revisão e edição ficam ao lado das antigas.
 * Quem quiser experimentar liga a chave abaixo (fica guardada neste navegador).
 */
const CHAVE_TELAS_NOVAS = "mm_catalogar_novo";

export function usarTelasNovas(): boolean {
  try {
    return localStorage.getItem(CHAVE_TELAS_NOVAS) === "1";
  } catch {
    return false;
  }
}

export function definirTelasNovas(ligado: boolean): void {
  try {
    if (ligado) localStorage.setItem(CHAVE_TELAS_NOVAS, "1");
    else localStorage.removeItem(CHAVE_TELAS_NOVAS);
  } catch {
    /* navegador sem localStorage: segue com as telas antigas */
  }
}

export type RevisaoTipo = "texto" | "url" | "imagem" | "audio" | "video" | "documento";

/** Campos comuns a todas as respostas de processamento (texto, imagem, áudio, vídeo, documento). */
export interface RevisaoBase {
  originalText: string;
  suggestedMediaText: string;
  suggestedKeywords: string;
  dadosEspecificosJson?: string | null;
  dadosEspecificosOriginaisJson?: string | null;
  matchedCategoryId?: number | null;
  category?: string | null;
  maxSummaryChars: number;
  apiCost: number;
  iaLevel: UserIaUseLevel;
  processingWarning?: string | null;
  // Específicos de cada tipo (lidos com cuidado)
  mediaWebUrl?: string | null;
  mediaDocumentUrl?: string | null;
  mediaImageUrl?: string;
  mediaAudioUrl?: string;
  mediaVideoUrl?: string;
  tamMediaUrl?: number;
  originalFilename?: string;
  mime?: string;
  pipelineUsed?: string;
  source?: string;
  memoId?: number;
}

export interface DadoCampo {
  key: string;
  value: string;
}

export function parseDadosEntries(raw: string | null | undefined): DadoCampo[] {
  const t = raw?.trim();
  if (!t) return [];
  try {
    const j = JSON.parse(t) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return [];
    const out: DadoCampo[] = [];
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      const key = k.trim();
      if (!key) continue;
      const value =
        v == null ? "" : typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
      out.push({ key, value });
    }
    return out;
  } catch {
    return [];
  }
}

export function dadosParaJson(entries: DadoCampo[]): string | null {
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries.map((e) => [e.key, e.value]))) : null;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Junta os campos da categoria com os valores extraídos: primeiro os campos da categoria (na ordem
 * dela), depois os que vieram no memo mas não existem mais na categoria ("campo antigo").
 */
export function montarCamposFormulario(
  campos: MemoContextCampo[],
  entries: DadoCampo[]
): Array<{ key: string; value: string; tipo: string; antigo: boolean; descricao: string | null }> {
  const usados = new Set<string>();
  const out: Array<{ key: string; value: string; tipo: string; antigo: boolean; descricao: string | null }> = [];
  for (const c of campos) {
    const e = entries.find((x) => semAcento(x.key) === semAcento(c.name));
    if (e) usados.add(e.key);
    out.push({ key: e?.key ?? c.name, value: e?.value ?? "", tipo: c.tipo || "text", antigo: false, descricao: c.description });
  }
  for (const e of entries) {
    if (usados.has(e.key)) continue;
    out.push({ key: e.key, value: e.value, tipo: "text", antigo: campos.length > 0, descricao: null });
  }
  return out;
}

/** % de campos da categoria que a IA preencheu. Categoria sem campos conta como 100%. */
export function percentualPreenchido(campos: MemoContextCampo[], entries: DadoCampo[]): number {
  if (campos.length === 0) return 100;
  let cheios = 0;
  for (const c of campos) {
    const e = entries.find((x) => semAcento(x.key) === semAcento(c.name));
    if (e && e.value.trim()) cheios++;
  }
  return Math.round((cheios / campos.length) * 100);
}

/** Data gravada como AAAA-MM-DD aparece como DD/MM/AAAA; ao salvar volta para AAAA-MM-DD. */
export function dataParaTela(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}
export function dataDaTela(v: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : v.trim();
}

/** Campo de hora pelo nome (o cadastro de campos não tem tipo "hora"). */
export function ehCampoHora(nome: string): boolean {
  return /\bhora|horario/.test(semAcento(nome));
}

export interface CategoriaComRegra {
  id: number;
  name: string;
  description: string | null;
  campos: MemoContextCampo[];
  revisaoSempre: boolean;
  revisaoMinPct: number;
  /** Categoria atualizável: campo com a situação (Ativo, Concluído, Cancelado). */
  campoSituacao: string | null;
}

export function categoriaComRegra(c: MemoContextCategory): CategoriaComRegra {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    campos: c.campos ?? [],
    revisaoSempre: c.revisaoSempre === true,
    revisaoMinPct: typeof c.revisaoMinPct === "number" ? c.revisaoMinPct : 80,
    campoSituacao: c.atualizavel ? c.campoSituacao ?? null : null,
  };
}

export interface EdicaoRevisao {
  mediaText: string;
  keywords: string;
  dadosEspecificosJson: string | null;
  dadosEspecificosOriginaisJson: string | null;
  categoryId: number | null;
  categoryName: string | null;
  /** Custo extra (reextração, sugestão de Assunto) somado ao custo do processamento. */
  custoExtra: number;
  tituloCurto?: string | null;
}

/** Grava o memo pelo mesmo caminho das telas antigas (um "confirm" por tipo). */
export async function gravarMemoRevisado(
  tipo: RevisaoTipo,
  st: RevisaoBase,
  groupId: number | null,
  ed: EdicaoRevisao
): Promise<MemoCreatedResponse> {
  const comum = {
    mediaText: ed.mediaText.trim(),
    keywords: ed.keywords.trim(),
    groupId,
    apiCost: st.apiCost + ed.custoExtra,
    originalText: st.originalText,
    iaLevel: st.iaLevel,
    dadosEspecificosJson: ed.dadosEspecificosJson,
    dadosEspecificosOriginaisJson: ed.dadosEspecificosOriginaisJson,
    matchedCategoryId: ed.categoryId,
    category: ed.categoryName,
  };
  let memo: MemoCreatedResponse;
  if (tipo === "url") {
    memo = await apiPostJson<MemoCreatedResponse>("/api/memos/url/confirm", {
      ...comum,
      mediaWebUrl: st.mediaWebUrl?.trim() ?? "",
      mediaDocumentUrl: typeof st.mediaDocumentUrl === "string" && st.mediaDocumentUrl.trim() ? st.mediaDocumentUrl.trim() : null,
    });
  } else if (tipo === "texto") {
    memo = await apiPostJson<MemoCreatedResponse>("/api/memos/text/confirm", comum);
  } else if (tipo === "imagem") {
    memo = await apiPostJson<MemoCreatedResponse>("/api/memos/image/confirm", {
      ...comum,
      mediaImageUrl: st.mediaImageUrl,
      tamMediaUrl: st.tamMediaUrl,
      originalFilename: st.originalFilename,
      source: st.source,
    });
  } else if (tipo === "audio") {
    memo = await apiPostJson<MemoCreatedResponse>("/api/memos/audio/confirm", {
      ...comum,
      mediaAudioUrl: st.mediaAudioUrl,
      tamMediaUrl: st.tamMediaUrl,
      originalFilename: st.originalFilename,
      source: st.source,
    });
  } else if (tipo === "video") {
    memo = await apiPostJson<MemoCreatedResponse>("/api/memos/video/confirm", {
      ...comum,
      mediaVideoUrl: st.mediaVideoUrl,
      tamMediaUrl: st.tamMediaUrl,
      originalFilename: st.originalFilename,
      source: st.source,
    });
  } else {
    memo = await apiPostJson<MemoCreatedResponse>("/api/memos/document/confirm", {
      ...comum,
      memoId: st.memoId,
      mediaDocumentUrl: st.mediaDocumentUrl,
      tamMediaUrl: st.tamMediaUrl,
      originalFilename: st.originalFilename,
      mime: st.mime,
      pipelineUsed: st.pipelineUsed,
    });
  }
  const titulo = ed.tituloCurto?.trim();
  if (titulo && memo?.id) {
    try {
      await apiPatchJson(`/api/memos/${memo.id}`, { tituloCurto: titulo });
    } catch {
      /* o robô gera o Assunto depois, se falhar aqui */
    }
  }
  return memo;
}

/** Palavras-chave "a, b, c" ↔ lista de etiquetas. */
export function keywordsParaLista(s: string): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const p of s.split(",")) {
    const t = p.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(t);
  }
  return out;
}
