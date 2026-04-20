import type { UserIaUseLevel, VideoMemoProcessSource } from "@mymemory/shared";
import { config } from "../config.js";
import { openaiChatJson } from "../lib/openaiChat.js";
import type { VisionContentPart } from "../lib/openaiVision.js";
import { openaiChatVisionJson } from "../lib/openaiVision.js";
import {
  clampTextToMax,
  resumoPtBrPromptRule,
} from "./textMemoMaxSummary.js";
import {
  formatCategoriesBlock,
  loadCategoryContext,
  matchCategoryId,
  parseJsonLoose,
  uniqueKeywordParts,
} from "./textMemoProcessService.js";

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

const VISION_USER_STUB =
  "Analise os fotogramas em anexo (mesmo vídeo, instantes diferentes) e preencha o JSON conforme as regras.";

/**
 * Ramo «descrição por visão»: transcrição de áudio curta ou vazia vs. `textImagemMin` (mesmo limiar que imagem).
 */
export async function processVideoKeyframesForReview(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  frames: Buffer[];
  maxSummaryChars: number;
  iaLevel: UserIaUseLevel;
  /** Transcrição Whisper (pode ser vazia). */
  transcriptHint: string;
  textImagemMin: number;
}): Promise<{
  originalText: string;
  suggestedMediaText: string;
  suggestedKeywords: string;
  apiCost: number;
  processingWarning: string | null;
  source: VideoMemoProcessSource;
  iaLevel: UserIaUseLevel;
  maxSummaryChars: number;
}> {
  const { frames, maxSummaryChars, textImagemMin } = input;
  const hint = input.transcriptHint.trim();
  const audioBlock =
    hint.length > 0
      ? `Transcrição automática do áudio (${hint.length} caracteres; limiar de texto útil = ${textImagemMin}):\n"""${hint.slice(0, 8000)}"""`
      : `Sem transcrição de áudio útil (limiar de texto = ${textImagemMin} caracteres) — baseie-se só nos fotogramas.`;

  if (!config.openai.apiKey) {
    return {
      originalText: hint,
      suggestedMediaText: "",
      suggestedKeywords: "",
      apiCost: 0,
      processingWarning: "OPENAI_API_KEY não configurada.",
      source: "none",
      iaLevel: input.iaLevel,
      maxSummaryChars,
    };
  }

  const cats = await loadCategoryContext(input.userId, input.groupId, input.isAdmin);
  const imageParts: VisionContentPart[] = frames.map((buf) => ({
    type: "image_url",
    image_url: {
      url: `data:image/jpeg;base64,${buf.toString("base64")}`,
      detail: "high",
    },
  }));

  let totalCost = 0;
  const baseWarn = `Transcrição de áudio não tratada como texto útil (limiar do plano: >${textImagemMin} caracteres fiáveis, ou ruído/alucinação) — resumo e keywords a partir de ${frames.length} fotograma(s).`;

  if (input.iaLevel === "basico") {
    const sys = `Você analisa sequências de fotogramas de vídeo para memos. Os anexos são instantes do MESMO vídeo, em ordem cronológica.
Responda APENAS com um único objeto JSON válido (sem markdown), chaves em português:
{
  "resumo_pt_br": string,
  "categoria_lista": string | null (nome EXATO de uma categoria da lista fornecida, ou null),
  "categoria_livre": string | null (categoria sugerida se nenhuma da lista servir),
  "subcategorias": string[],
  "palavras_chave": string[]
}

Regras:
1) Use os FOTOGRAMAS como fonte principal do que acontece visualmente (ações, pessoas, ambiente, objetos, movimento aparente entre frames).
2) O bloco de transcrição de áudio pode estar vazio ou errado — não invente diálogos que não apareçam claramente no áudio transcrito.
3) categoria_lista: null ou nome EXATO da lista de categorias.
4) Se categoria_lista for null, preencha categoria_livre.
5) subcategorias e palavras_chave coerentes com o resumo.
6) ${resumoPtBrPromptRule(maxSummaryChars)}`;

    const userTxt = `Categorias e estrutura:\n${formatCategoriesBlock(cats)}\n\n---\n${audioBlock}\n\n${VISION_USER_STUB}`;

    const { content, costUsd } = await openaiChatVisionJson({
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [{ type: "text", text: userTxt }, ...imageParts],
        },
      ],
    });
    totalCost += costUsd;
    const j = parseJsonLoose(content);
    const resumoRaw = str(j.resumo_pt_br).trim();
    const suggestedMediaText = clampTextToMax(
      resumoRaw || "(Sem resumo automático.)",
      maxSummaryChars
    );
    const kw = uniqueKeywordParts([
      str(j.categoria_lista),
      str(j.categoria_livre),
      strArr(j.subcategorias).join(", "),
      strArr(j.palavras_chave).join(", "),
    ]);

    return {
      originalText: hint,
      suggestedMediaText,
      suggestedKeywords: kw,
      apiCost: Math.round(totalCost * 1e8) / 1e8,
      processingWarning: baseWarn,
      source: "video_vision_basic",
      iaLevel: input.iaLevel,
      maxSummaryChars,
    };
  }

  const sys1 = `Você analisa fotogramas de vídeo para memos. Responda APENAS JSON válido:
{
  "idioma_detectado": string,
  "resumo_pt_br": string,
  "categoria_lista": string | null (nome EXATO da lista abaixo ou null),
  "categoria_livre": string | null (categoria sugerida se a lista não servir),
  "palavras_chave": string[] (termos curtos; a 2.ª passagem refinará subcategorias/campos)
}

Regras: use os FOTOGRAMAS como fonte principal (ordem cronológica). O áudio transcrito é só apoio e pode estar vazio.
${resumoPtBrPromptRule(maxSummaryChars)}`;

  const user1 = `Categorias (use nome exato em categoria_lista quando possível):\n${formatCategoriesBlock(cats)}\n\n---\n${audioBlock}\n\n${VISION_USER_STUB}`;

  const r1 = await openaiChatVisionJson({
    messages: [
      { role: "system", content: sys1 },
      {
        role: "user",
        content: [{ type: "text", text: user1 }, ...imageParts],
      },
    ],
  });
  totalCost += r1.costUsd;
  const j1 = parseJsonLoose(r1.content);
  const resumo = str(j1.resumo_pt_br).trim() || "(Vídeo sem resumo automático.)";
  const catList = str(j1.categoria_lista) || null;
  const catFree = str(j1.categoria_livre) || null;
  const palavrasPasso1 = strArr(j1.palavras_chave);
  const catId = matchCategoryId(cats, catList) ?? matchCategoryId(cats, catFree);
  const cat = cats.find((c) => c.id === catId);
  const subNames = cat?.subcategories.map((s) => s.name) ?? [];
  const campoNames = cat?.campos.map((c) => c.name) ?? [];

  const contextBlock = [
    hint.length ? `TRANSCRIÇÃO ÁUDIO:\n${hint.slice(0, 8000)}` : "(Sem transcrição de áudio.)",
    `RESUMO PT-BR (análise visual dos fotogramas):\n${resumo}`,
  ].join("\n\n");
  const forSecond = contextBlock.length > 12_000 ? contextBlock.slice(0, 12_000) : contextBlock;

  const sys2 = `Você analisa um memo já resumido (vídeo, a partir de fotogramas). Responda APENAS JSON:
{
  "subcategorias_lista": string[] (subconjunto dos nomes exatos da lista fixa fornecida),
  "subcategorias_livres": string[],
  "campos": object (chaves = nomes exatos dos campos solicitados, valores = texto extraído ou "")
}`;
  const user2 = `Categoria escolhida: ${cat?.name ?? catList ?? catFree ?? "desconhecida"}
Subcategorias permitidas (use só estes nomes em subcategorias_lista): ${subNames.length ? subNames.join(", ") : "(nenhuma — deixe lista vazia)"}
Campos a preencher (chaves do objeto campos): ${campoNames.length ? campoNames.join(", ") : "(nenhum — use {})"}

CONTEXTO:
${forSecond}`;

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
  const campoVals = Object.values(camposObj as Record<string, unknown>)
    .map((x) => str(x))
    .filter(Boolean);

  const suggestedMediaText = clampTextToMax(resumo, maxSummaryChars);
  const kw = uniqueKeywordParts([
    catList,
    catFree,
    ...palavrasPasso1,
    ...subsLista,
    ...subsLivres,
    ...campoVals,
  ]);

  return {
    originalText: hint,
    suggestedMediaText,
    suggestedKeywords: kw,
    apiCost: Math.round(totalCost * 1e8) / 1e8,
    processingWarning: `${baseWarn} Segunda passagem: subcategorias/campos (lista fechada) fundidas em keywords.`,
    source: "video_vision_full",
    iaLevel: input.iaLevel,
    maxSummaryChars,
  };
}
