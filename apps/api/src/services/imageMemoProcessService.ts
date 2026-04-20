import type { ImageMemoProcessResponse, ImageMemoProcessSource, UserIaUseLevel } from "@mymemory/shared";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { recognizeImageWithTesseract } from "../lib/imageOcr.js";
import { openaiChatJson } from "../lib/openaiChat.js";
import { openaiChatVisionJson } from "../lib/openaiVision.js";
import { pool } from "../db.js";
import { assertUserWorkspaceGroupAccess } from "./memoContextService.js";
import { storeMemoBinaryAndGetUrl } from "./memoService.js";
import {
  clampTextToMax,
  resumoPtBrPromptRule,
  resolveMaxSummaryCharsForImage,
  resolveTextImagemMinForPlan,
} from "./textMemoMaxSummary.js";
import {
  formatCategoriesBlock,
  loadCategoryContext,
  matchCategoryId,
  normalizeCamposForCategory,
  parseJsonLoose,
  processTextMemoForReview,
  uniqueKeywordParts,
} from "./textMemoProcessService.js";

export async function getUserIaUseImagem(userId: number): Promise<UserIaUseLevel> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT iaUseImagem FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const v = rows[0]?.iaUseImagem;
  if (v === "semIA" || v === "basico" || v === "completo") return v;
  return "basico";
}

function normalizeImageOcrVisionMinConfidence(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 100) return null;
  return Math.floor(n);
}

async function getImageOcrVisionMinConfidence(userId: number): Promise<number | null> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT imageOcrVisionMinConfidence AS c FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    return normalizeImageOcrVisionMinConfidence(rows[0]?.c);
  } catch {
    return null;
  }
}

function appendProcessingWarning(base: string | null, extra: string | null): string | null {
  const e = extra?.trim();
  if (!e) return base;
  const b = base?.trim();
  return b ? `${b} ${e}` : e;
}

/**
 * Se `imageOcrVisionMinConfidence` do usuario estiver desligado (`null`), usa-se este piso para decidir se o OCR
 * alimenta o ramo “só LLM texto” quando existe confiança Tesseract.
 */
const OCR_TEXT_BRANCH_CONFIDENCE_FALLBACK = 48;
/** Quando o Tesseract não devolve confiança, proporção mínima de letras+dígitos no texto para confiar no ramo texto. */
const OCR_MIN_ALNUM_RATIO_IF_NO_CONFIDENCE = 0.3;

function ocrAlnumRatio(text: string): number {
  if (!text.length) return 0;
  let n = 0;
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch)) n += 1;
  }
  return n / text.length;
}

/**
 * OCR longo (> textImagemMin) só vai para `processTextMemoForReview` se parecer texto real.
 * Com confiança Tesseract: exige `confidence >= imageOcrVisionMinConfidence` do usuario (1–100), ou
 * `>= OCR_TEXT_BRANCH_CONFIDENCE_FALLBACK` quando a preferência está desligada (`null`).
 */
function isOcrTrustworthyForTextOnlyPipeline(
  text: string,
  confidence: number | null,
  userImageOcrVisionMinConfidence: number | null
): boolean {
  const minConf = userImageOcrVisionMinConfidence ?? OCR_TEXT_BRANCH_CONFIDENCE_FALLBACK;
  if (confidence != null && confidence < minConf) return false;
  if (confidence == null && text.length > 0 && ocrAlnumRatio(text) < OCR_MIN_ALNUM_RATIO_IF_NO_CONFIDENCE) return false;
  return true;
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

function dataUrlForImage(buffer: Buffer, mime: string): string {
  const m = (mime || "image/jpeg").split(";")[0].trim() || "image/jpeg";
  return `data:${m};base64,${buffer.toString("base64")}`;
}

function baseResponse(
  partial: Omit<ImageMemoProcessResponse, "mediaImageUrl" | "originalFilename" | "tamMediaUrl" | "source"> & {
    mediaImageUrl: string;
    originalFilename: string;
    tamMediaUrl: number;
    source: ImageMemoProcessSource;
  }
): ImageMemoProcessResponse {
  return { ...partial };
}

const VISION_USER_STUB = "Analise a imagem em anexo e preencha o JSON conforme as regras do sistema.";

const VISION_EXTRACT_TEXT_SYS = `Você extrai todo o texto legível visível na imagem (documento, placa, ecrã, letras manuscritas quando legíveis, etc.).
Responda APENAS com um único objeto JSON válido (sem markdown): { "texto": string }
Use string vazia se não houver texto. Preserve parágrafos e ordem de leitura natural quando fizer sentido.`;

/**
 * Híbrido custo / qualidade (alinhado à intenção do produto):
 * - **Tesseract** (grátis) primeiro. Se a confiança global for boa (vs. preferência ou piso 48), **não** se chama visão
 *   só para OCR — economiza API; o resumo segue como memo **texto** sobre o Tesseract.
 * - **Re-extração paga (1× visão, só texto)** quando:
 *   - a confiança Tesseract está **abaixo** de `imageOcrVisionMinConfidence` (se definido), **ou**
 *   - o texto Tesseract tem mais de `textImagemMin` caracteres mas **não** passa no teste de fiabilidade
 *     (confiança / proporção alfanumérica) — típico quando a preferência está desligada e o Tesseract é fraco.
 * - Depois de uma re-extração por visão com texto devolvido, esse texto é tratado como **fiável** para o ramo
 *   `processTextMemoForReview` (não se volta a julgar com a confiança **antiga** do Tesseract).
 * - Só se cai em **descrição multimodal** quando não há ramo texto viável (pouco texto, ou Tesseract lixo e visão sem texto).
 * - **semIA**: sem OCR nem LLM; revisão com `mediaText` vazio.
 *
 * Documentação alinhada (passos, notas *1/*2, excepções): `docs/processamento-imagens-fluxo.md`.
 */
export async function processImageMemoForReview(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
  buffer: Buffer;
  mime: string;
  originalName: string;
  iaUseImagem?: UserIaUseLevel | null;
}): Promise<ImageMemoProcessResponse> {
  if (input.groupId != null) {
    await assertUserWorkspaceGroupAccess(input.userId, input.groupId, input.isAdmin);
  }

  const { mediaUrl, storedName } = await storeMemoBinaryAndGetUrl({
    userId: input.userId,
    buffer: input.buffer,
    mime: input.mime,
    originalName: input.originalName,
  });

  const maxSummaryChars = await resolveMaxSummaryCharsForImage(
    input.userId,
    input.groupId,
    input.isAdmin
  );
  const textImagemMin = await resolveTextImagemMinForPlan(input.userId, input.groupId, input.isAdmin);
  const dbLevel = await getUserIaUseImagem(input.userId);
  const iaLevel = input.iaUseImagem ?? dbLevel;
  const tamMediaUrl = input.buffer.length;
  const originalFilename = input.originalName || storedName;

  if (iaLevel === "semIA") {
    return baseResponse({
      originalText: "",
      suggestedMediaText: "",
      suggestedKeywords: "",
      maxSummaryChars,
      apiCost: 0,
      iaLevel,
      processingWarning: null,
      tesseractConfidence: null,
      imageOcrVisionMinConfidence: null,
      mediaImageUrl: mediaUrl,
      originalFilename,
      tamMediaUrl,
      source: "none",
      textImagemMin,
    });
  }

  const ocrBundle = await recognizeImageWithTesseract(input.buffer);
  let ocrLocal = ocrBundle.text;
  const ocrConfidence = ocrBundle.confidence;
  const imageOcrVisionMinConfidence = await getImageOcrVisionMinConfidence(input.userId);

  if (!config.openai.apiKey) {
    const suggested = clampTextToMax(ocrLocal || "(Sem texto OCR.)", maxSummaryChars);
    return baseResponse({
      originalText: ocrLocal,
      suggestedMediaText: suggested,
      suggestedKeywords: "",
      maxSummaryChars,
      apiCost: 0,
      iaLevel,
      processingWarning:
        "OPENAI_API_KEY não configurada — só OCR local (Tesseract). Preencha na revisão ou configure a chave.",
      tesseractConfidence: ocrConfidence,
      imageOcrVisionMinConfidence,
      mediaImageUrl: mediaUrl,
      originalFilename,
      tamMediaUrl,
      source: "none",
      textImagemMin,
    });
  }

  const dataUrl = dataUrlForImage(input.buffer, input.mime);
  let totalCost = 0;
  let processingWarning: string | null = null;

  try {
    const tessTrustworthy = isOcrTrustworthyForTextOnlyPipeline(
      ocrLocal,
      ocrConfidence,
      imageOcrVisionMinConfidence
    );

    const lowTesseractVsUserMinimum =
      imageOcrVisionMinConfidence != null &&
      (ocrConfidence == null || ocrConfidence < imageOcrVisionMinConfidence);

    const longTesseractButNotTrusted = ocrLocal.length > textImagemMin && !tessTrustworthy;

    const tessCharCountBeforeVision = ocrLocal.length;
    let ocrFromPaidVisionTextExtract = false;

    if (lowTesseractVsUserMinimum || longTesseractButNotTrusted) {
      const tesseractHint = ocrLocal.slice(0, 8000);
      const extractUser = `Extraia o texto da imagem.\n\nRascunho Tesseract (pode estar errado ou incompleto):\n"""${tesseractHint}"""\n\n${VISION_USER_STUB}`;
      const extractR = await openaiChatVisionJson({
        messages: [
          { role: "system", content: VISION_EXTRACT_TEXT_SYS },
          {
            role: "user",
            content: [
              { type: "text", text: extractUser },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
      });
      totalCost += extractR.costUsd;
      const jEx = parseJsonLoose(extractR.content);
      const cleaned = str(jEx.texto).trim();
      if (cleaned.length > 0) {
        ocrLocal = cleaned;
        ocrFromPaidVisionTextExtract = true;
      }

      if (ocrFromPaidVisionTextExtract) {
        if (lowTesseractVsUserMinimum) {
          const confLabel = ocrConfidence == null ? "indisponível" : `${Math.round(ocrConfidence)}`;
          processingWarning = appendProcessingWarning(
            processingWarning,
            `Confiança Tesseract (${confLabel}) abaixo do mínimo (${imageOcrVisionMinConfidence}) — texto re-extraído por visão; o resumo segue o fluxo de memo texto sobre esse texto.`
          );
        } else {
          processingWarning = appendProcessingWarning(
            processingWarning,
            `Tesseract tinha ${tessCharCountBeforeVision} caracteres (>${textImagemMin}) mas não foi considerado fiável — texto re-extraído por visão; o resumo segue como memo texto.`
          );
        }
      } else if (lowTesseractVsUserMinimum) {
        const confLabel = ocrConfidence == null ? "indisponível" : `${Math.round(ocrConfidence)}`;
        processingWarning = appendProcessingWarning(
          processingWarning,
          `Confiança Tesseract (${confLabel}) abaixo do mínimo (${imageOcrVisionMinConfidence}); a re-extração por visão não devolveu texto útil.`
        );
      } else {
        processingWarning = appendProcessingWarning(
          processingWarning,
          `Tesseract com ${tessCharCountBeforeVision} caracteres não foi considerado fiável; a re-extração por visão não devolveu texto útil — segue fluxo multimodal.`
        );
      }
    }

    const useTextOnlyBranch =
      ocrLocal.length > textImagemMin &&
      (ocrFromPaidVisionTextExtract ||
        isOcrTrustworthyForTextOnlyPipeline(ocrLocal, ocrConfidence, imageOcrVisionMinConfidence));

    if (useTextOnlyBranch) {
      const textOut = await processTextMemoForReview({
        userId: input.userId,
        groupId: input.groupId,
        isAdmin: input.isAdmin,
        rawText: ocrLocal,
        iaUseTexto: iaLevel,
        maxSummaryChars,
      });
      totalCost += textOut.apiCost;
      processingWarning = appendProcessingWarning(
        processingWarning,
        textOut.processingWarning ??
          `Texto OCR (${ocrLocal.length} caracteres > limiar ${textImagemMin}) — só LLM texto (${iaLevel}), sem chamada de visão extra no resumo.`
      );
      return baseResponse({
        originalText: textOut.originalText,
        suggestedMediaText: textOut.suggestedMediaText,
        suggestedKeywords: textOut.suggestedKeywords,
        dadosEspecificosJson: textOut.dadosEspecificosJson ?? null,
        dadosEspecificosOriginaisJson: textOut.dadosEspecificosOriginaisJson ?? null,
        matchedCategoryId: textOut.matchedCategoryId ?? null,
        maxSummaryChars: textOut.maxSummaryChars,
        apiCost: Math.round(totalCost * 1e8) / 1e8,
        iaLevel: textOut.iaLevel,
        processingWarning,
        tesseractConfidence: ocrConfidence,
        imageOcrVisionMinConfidence,
        mediaImageUrl: mediaUrl,
        originalFilename,
        tamMediaUrl,
        source: "ocr_text",
        textImagemMin,
      });
    }

    const cats = await loadCategoryContext(input.userId, input.groupId, input.isAdmin);
    const unreliableLongOcr =
      !ocrFromPaidVisionTextExtract &&
      ocrLocal.length > textImagemMin &&
      !isOcrTrustworthyForTextOnlyPipeline(ocrLocal, ocrConfidence, imageOcrVisionMinConfidence);
    const textHintForVision = unreliableLongOcr
      ? "Sem texto OCR fiável (saída longa do Tesseract foi ignorada). Descreva a cena, objetos, cores, contexto e qualquer texto legível **só** a partir da imagem."
      : ocrLocal.trim().length > 0
        ? ocrLocal.slice(0, 4000)
        : "Nenhum texto útil no OCR; descreva a imagem (cena, objetos, contexto).";
    const originalTextOut = unreliableLongOcr ? "" : ocrLocal;
    const ocrLenNote = unreliableLongOcr
      ? `OCR longo mas pouco fiável (${ocrLocal.length} caracteres) — ignorado; uma chamada multimodal para descrição e keywords.`
      : ocrLocal.length > 0
        ? `Texto OCR (${ocrLocal.length} caracteres ≤ limiar ${textImagemMin}) — resumo/categorias com LLM multimodal.`
        : `Pouco ou nenhum texto no OCR (limiar ${textImagemMin}) — resumo/categorias com LLM multimodal.`;

    const useSingleVisionMultimodal = iaLevel === "basico" || unreliableLongOcr;

    if (useSingleVisionMultimodal) {
      const sys = `Você analisa imagens para memos. Responda APENAS com um único objeto JSON válido (sem markdown), chaves em português:
{
  "resumo_pt_br": string,
  "categoria_lista": string | null (nome EXATO de uma categoria da lista fornecida, ou null),
  "categoria_livre": string | null (categoria sugerida se nenhuma da lista servir),
  "subcategorias": string[],
  "palavras_chave": string[]
}

Regras:
1) Use a IMAGEM como fonte principal. O bloco "Texto local (OCR)" abaixo pode estar errado ou incompleto — corrija com o que vê na imagem.
2) categoria_lista: null ou nome EXATO da lista de categorias.
3) Se categoria_lista for null, preencha categoria_livre.
4) subcategorias e palavras_chave coerentes com o resumo.
5) ${resumoPtBrPromptRule(maxSummaryChars)}`;

      const userTxt = `Categorias e estrutura:\n${formatCategoriesBlock(cats)}\n\n---\nTexto local (OCR / instrução):\n"""${textHintForVision}"""\n\n${VISION_USER_STUB}`;

      const { content, costUsd } = await openaiChatVisionJson({
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: [
              { type: "text", text: userTxt },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
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

      processingWarning = appendProcessingWarning(
        processingWarning,
        unreliableLongOcr && iaLevel === "completo"
          ? `${ocrLenNote} Perfil completo: OCR ignorado — só esta passagem visual (sem 2.ª passagem lista fechada).`
          : ocrLenNote
      );

      return baseResponse({
        originalText: originalTextOut,
        suggestedMediaText,
        suggestedKeywords: kw,
        maxSummaryChars,
        apiCost: Math.round(totalCost * 1e8) / 1e8,
        iaLevel,
        processingWarning,
        tesseractConfidence: ocrConfidence,
        imageOcrVisionMinConfidence,
        mediaImageUrl: mediaUrl,
        originalFilename,
        tamMediaUrl,
        source: "vision_basic",
        textImagemMin,
      });
    }

    const sys1 = `Você analisa imagens para memos. Responda APENAS JSON válido:
{
  "idioma_detectado": string,
  "resumo_pt_br": string,
  "categoria_lista": string | null (nome EXATO da lista abaixo ou null),
  "categoria_livre": string | null (categoria sugerida se a lista não servir),
  "palavras_chave": string[] (termos curtos para busca; coerentes com o resumo — a 2.ª passagem refinará subcategorias/campos)
}

Regras: use a IMAGEM como fonte principal. O texto OCR no usuario é só apoio.
${resumoPtBrPromptRule(maxSummaryChars)}`;

    const user1 = `Categorias (use nome exato em categoria_lista quando possível):\n${formatCategoriesBlock(cats)}\n\n---\nTexto local (OCR / instrução):\n"""${textHintForVision}"""\n\n${VISION_USER_STUB}`;

    const r1 = await openaiChatVisionJson({
      messages: [
        { role: "system", content: sys1 },
        {
          role: "user",
          content: [
            { type: "text", text: user1 },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    });
    totalCost += r1.costUsd;
    const j1 = parseJsonLoose(r1.content);
    const resumo = str(j1.resumo_pt_br).trim() || ocrLocal || "(Imagem sem resumo automático.)";
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

    const contextBlock = [
      ocrLocal.length ? `TEXTO OCR:\n${ocrLocal.slice(0, 8000)}` : "(Sem texto OCR.)",
      `RESUMO PT-BR (análise visual):\n${resumo}`,
    ].join("\n\n");
    const forSecond = contextBlock.length > 12_000 ? contextBlock.slice(0, 12_000) : contextBlock;

    const sys2 = `Você analisa um memo já resumido (imagem). Responda APENAS JSON:
{
  "subcategorias_lista": string[] (subconjunto dos nomes exatos da lista fixa fornecida),
  "subcategorias_livres": string[],
  "campos": object (chaves = nomes exatos dos campos solicitados, valores = texto extraído ou "")
}`;
    const user2 = `Categoria escolhida: ${cat?.name ?? catList ?? catFree ?? "desconhecida"}
Subcategorias permitidas (use só estes nomes em subcategorias_lista): ${subNames.length ? subNames.join(", ") : "(nenhuma — deixe lista vazia)"}
Campos a preencher (chaves do objeto campos): ${campoNames.length ? campoNames.join(", ") : "(nenhum — use {})"}
Guia de padronização dos campos: ${campoGuide || "(sem padrões definidos)"}

CONTEXTO (OCR + resumo visual):
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
    const camposNormalizados = normalizeCamposForCategory(
      camposObj as Record<string, unknown>,
      cat
    );
    const dadosEspecificosJson =
      Object.keys(camposNormalizados.normalized).length > 0
        ? JSON.stringify(camposNormalizados.normalized)
        : null;
    const dadosEspecificosOriginaisJson =
      Object.keys(camposNormalizados.originals).length > 0
        ? JSON.stringify(camposNormalizados.originals)
        : null;
    const campoVals = Object.values(camposNormalizados.normalized)
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

    processingWarning = appendProcessingWarning(
      processingWarning,
      ocrLenNote + " Segunda passagem: subcategorias/campos (lista fechada) fundidas em keywords."
    );

    return baseResponse({
      originalText: ocrLocal || resumo,
      suggestedMediaText,
      suggestedKeywords: kw,
      dadosEspecificosJson,
      dadosEspecificosOriginaisJson,
      matchedCategoryId: cat?.id ?? null,
      maxSummaryChars,
      apiCost: Math.round(totalCost * 1e8) / 1e8,
      iaLevel,
      processingWarning,
      tesseractConfidence: ocrConfidence,
      imageOcrVisionMinConfidence,
      mediaImageUrl: mediaUrl,
      originalFilename,
      tamMediaUrl,
      source: "vision_full",
      textImagemMin,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    processingWarning = `Falha na IA (${msg}). Preencha na revisão; a imagem já foi armazenada.`;
    return baseResponse({
      originalText: ocrLocal,
      suggestedMediaText: ocrLocal ? clampTextToMax(ocrLocal, maxSummaryChars) : "",
      suggestedKeywords: "",
      maxSummaryChars,
      apiCost: Math.round(totalCost * 1e8) / 1e8,
      iaLevel,
      processingWarning,
      tesseractConfidence: ocrConfidence,
      imageOcrVisionMinConfidence,
      mediaImageUrl: mediaUrl,
      originalFilename,
      tamMediaUrl,
      source: "none",
      textImagemMin,
    });
  }
}
