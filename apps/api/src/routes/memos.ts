import type { FastifyPluginAsync } from "fastify";
import type {
  DeleteMemoResponse,
  MemoSearchMode,
  MemoSearchResponse,
  MemoSearchSynonymsResponse,
  PatchMemoResponse,
  PhotoAiUsage,
} from "@mymemory/shared";
import { z } from "zod";
import { getUserIsAdmin, resolveUserId } from "../lib/userContext.js";
import {
  createMemoAudioReviewed,
  createMemoVideoReviewed,
  createMemoFromUpload,
  createMemoImageReviewed,
  createMemoText,
  createMemoTextReviewed,
  createMemoUrl,
  createMemoUrlReviewed,
  finalizeDocumentMemoReview,
  getMemoAttachmentForViewer,
  getMemoForAuthorEdit,
  listRecentMemos,
  softDeleteMemoForUser,
  updateMemoForUser,
} from "../services/memoService.js";
import { classifyFile, isAcceptableForAudioProcess } from "../lib/media.js";
import { getMaxUploadBytesForUser } from "../services/mediaLimitsService.js";
import { getUserIaUseAudio, processAudioMemoForReview } from "../services/audioMemoProcessService.js";
import { getUserIaUseVideo, processVideoMemoForReview } from "../services/videoMemoProcessService.js";
import { getUserIaUseImagem, processImageMemoForReview } from "../services/imageMemoProcessService.js";
import { getUserIaUseDocumento, processDocumentMemoForReview } from "../services/documentMemoProcessService.js";
import {
  ABSOLUTE_CAP,
  clampTextToMax,
  resolveMaxSummaryCharsForAudio,
  resolveMaxSummaryCharsForDocument,
  resolveMaxSummaryCharsForImage,
  resolveMaxSummaryCharsForText,
  resolveMaxSummaryCharsForVideo,
} from "../services/textMemoMaxSummary.js";
import {
  getUserIaUseTexto,
  getUserIaUseUrl,
  processTextMemoForReview,
  processUrlMemoForReview,
} from "../services/textMemoProcessService.js";
import { llmSynonymsForTerm } from "../lib/invokeLlm.js";
import { listMemoSearchAuthors, searchMemosForUser, searchMemosSemantic } from "../services/memoSearchService.js";

const photoAiUsageField = z.enum(["none", "keywords", "full"]);

const textBody = z.object({
  mediaText: z.string().min(1).max(65_000),
  groupId: z.number().int().positive().nullable().optional(),
  aiUsage: photoAiUsageField.optional(),
});

const urlBody = z.object({
  mediaWebUrl: z.string().url().max(2048),
  note: z.string().max(4000).optional(),
  groupId: z.number().int().positive().nullable().optional(),
  aiUsage: photoAiUsageField.optional(),
});

const patchMemoBody = z
  .object({
    mediaText: z.string().min(1).max(65_000).optional(),
    keywords: z.union([z.string().max(4000), z.null()]).optional(),
    dadosEspecificosJson: z.union([z.string().max(32_000), z.null()]).optional(),
    dadosEspecificosOriginaisJson: z.union([z.string().max(32_000), z.null()]).optional(),
    matchedCategoryId: z.number().int().positive().nullable().optional(),
  })
  .refine((o) => o.mediaText !== undefined || o.keywords !== undefined || o.dadosEspecificosJson !== undefined, {
    message: "Informe mediaText e/ou keywords e/ou dadosEspecificosJson.",
  });

const userIaTextoEnum = z.enum(["semIA", "basico", "completo"]);

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const memoSearchModeEnum = z.enum(["all", "mediaText", "keywords", "dadosEspecificos"]);

const memoSearchBody = z.object({
  query: z.string().max(4000),
  logic: z.enum(["and", "or"]).default("and"),
  groupId: z.number().int().positive().nullable().optional(),
  excludeIds: z.array(z.number().int().positive()).max(200).optional().default([]),
  createdAtFrom: z.union([ymd, z.null()]).optional(),
  createdAtTo: z.union([ymd, z.null()]).optional(),
  authorUserId: z.union([z.number().int().positive(), z.null()]).optional(),
  searchMode: memoSearchModeEnum.optional(),
});

const memoSearchSynonymsBody = z.object({
  term: z.string().min(1).max(200),
});

type UserIaMultipart = z.infer<typeof userIaTextoEnum>;

/** Campos multipart podem vir como string ou Buffer; normaliza variantes comuns. */
function parseMultipartIaUseField(raw: unknown): UserIaMultipart | undefined {
  if (raw == null) return undefined;
  const s =
    typeof raw === "string"
      ? raw.trim()
      : Buffer.isBuffer(raw)
        ? raw.toString("utf8").trim()
        : String(raw).trim();
  if (!s) return undefined;
  const direct = userIaTextoEnum.safeParse(s);
  if (direct.success) return direct.data;
  const compact = s.toLowerCase().replace(/_/g, "");
  if (compact === "semia") return "semIA";
  if (compact === "basico") return "basico";
  if (compact === "completo") return "completo";
  return undefined;
}

const textProcessBody = z.object({
  mediaText: z.string().min(1).max(65_000),
  groupId: z.number().int().positive().nullable().optional(),
  iaUseTexto: userIaTextoEnum.optional(),
});

const textConfirmBody = z.object({
  mediaText: z.string().min(1).max(65_000),
  keywords: z.string().max(8000).optional().default(""),
  groupId: z.number().int().positive().nullable().optional(),
  apiCost: z.number().min(0).max(1e6).optional().default(0),
  originalText: z.string(),
  iaLevel: userIaTextoEnum.optional(),
  dadosEspecificosJson: z.union([z.string().max(32_000), z.null()]).optional(),
  dadosEspecificosOriginaisJson: z.union([z.string().max(32_000), z.null()]).optional(),
  matchedCategoryId: z.number().int().positive().nullable().optional(),
});

const urlProcessBody = z.object({
  mediaWebUrl: z.string().url().max(2048),
  groupId: z.number().int().positive().nullable().optional(),
  iaUseUrl: userIaTextoEnum.optional(),
});

const urlConfirmBody = z.object({
  mediaWebUrl: z.string().url().max(2048),
  mediaDocumentUrl: z.string().min(1).max(4096).nullable().optional(),
  mediaText: z.string().min(1).max(65_000),
  keywords: z.string().max(8000).optional().default(""),
  groupId: z.number().int().positive().nullable().optional(),
  apiCost: z.number().min(0).max(1e6).optional().default(0),
  originalText: z.string(),
  iaLevel: userIaTextoEnum.optional(),
  dadosEspecificosJson: z.union([z.string().max(32_000), z.null()]).optional(),
  dadosEspecificosOriginaisJson: z.union([z.string().max(32_000), z.null()]).optional(),
  matchedCategoryId: z.number().int().positive().nullable().optional(),
});

const imageSourceEnum = z.enum(["none", "ocr_text", "vision_basic", "vision_full"]);

const audioSourceEnum = z.enum(["none", "speech_basic", "speech_full", "speech_segmented"]);

const videoSourceEnum = z.enum([
  "none",
  "video_basic",
  "video_full",
  "video_segmented",
  "video_vision_basic",
  "video_vision_full",
]);

const imageConfirmBody = z.object({
  mediaText: z.string().max(65_000),
  keywords: z.string().max(8000).optional().default(""),
  dadosEspecificosJson: z.union([z.string().max(32_000), z.null()]).optional(),
  dadosEspecificosOriginaisJson: z.union([z.string().max(32_000), z.null()]).optional(),
  matchedCategoryId: z.number().int().positive().nullable().optional(),
  groupId: z.number().int().positive().nullable().optional(),
  apiCost: z.number().min(0).max(1e6).optional().default(0),
  originalText: z.string(),
  iaLevel: userIaTextoEnum.optional(),
  mediaImageUrl: z.string().min(1).max(2048),
  tamMediaUrl: z.number().int().min(0).max(500_000_000),
  originalFilename: z.string().max(512),
  source: imageSourceEnum,
});

const audioConfirmBody = z.object({
  mediaText: z.string().max(65_000),
  keywords: z.string().max(8000).optional().default(""),
  dadosEspecificosJson: z.union([z.string().max(32_000), z.null()]).optional(),
  dadosEspecificosOriginaisJson: z.union([z.string().max(32_000), z.null()]).optional(),
  matchedCategoryId: z.number().int().positive().nullable().optional(),
  groupId: z.number().int().positive().nullable().optional(),
  apiCost: z.number().min(0).max(1e6).optional().default(0),
  originalText: z.string(),
  iaLevel: userIaTextoEnum.optional(),
  mediaAudioUrl: z.string().min(1).max(2048),
  tamMediaUrl: z.number().int().min(0).max(500_000_000),
  originalFilename: z.string().max(512),
  source: audioSourceEnum,
});

const videoConfirmBody = z.object({
  mediaText: z.string().max(65_000),
  keywords: z.string().max(8000).optional().default(""),
  groupId: z.number().int().positive().nullable().optional(),
  apiCost: z.number().min(0).max(1e6).optional().default(0),
  originalText: z.string(),
  iaLevel: userIaTextoEnum.optional(),
  mediaVideoUrl: z.string().min(1).max(2048),
  tamMediaUrl: z.number().int().min(0).max(500_000_000),
  originalFilename: z.string().max(512),
  source: videoSourceEnum,
});

const documentProcessBody = z.object({
  memoId: z.number().int().positive(),
  groupId: z.number().int().positive().nullable().optional(),
  iaUseDocumento: userIaTextoEnum.optional(),
});

const documentConfirmBody = z.object({
  memoId: z.number().int().positive(),
  mediaText: z.string().max(65_000),
  keywords: z.string().max(8000).optional().default(""),
  dadosEspecificosJson: z.union([z.string().max(32_000), z.null()]).optional(),
  dadosEspecificosOriginaisJson: z.union([z.string().max(32_000), z.null()]).optional(),
  matchedCategoryId: z.number().int().positive().nullable().optional(),
  groupId: z.number().int().positive().nullable().optional(),
  apiCost: z.number().min(0).max(1e6).optional().default(0),
  originalText: z.string(),
  iaLevel: userIaTextoEnum.optional(),
  mediaDocumentUrl: z.string().min(1).max(2048),
  tamMediaUrl: z.number().int().min(0).max(500_000_000),
  originalFilename: z.string().max(512),
  mime: z.string().max(256),
  pipelineUsed: z.string().max(128),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.post("/api/memos/text/process", async (req, reply) => {
    const parsed = textProcessBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const groupId = parsed.data.groupId ?? null;
    try {
      const out = await processTextMemoForReview({
        userId,
        groupId,
        isAdmin,
        rawText: parsed.data.mediaText,
        iaUseTexto: parsed.data.iaUseTexto,
      });
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "empty_text") {
        return reply.code(400).send({ error: "empty_text", message: "Informe um texto." });
      }
      throw e;
    }
  });

  app.post("/api/memos/url/process", async (req, reply) => {
    const parsed = urlProcessBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const groupId = parsed.data.groupId ?? null;
    const href = parsed.data.mediaWebUrl.trim();
    const iaLevel = parsed.data.iaUseUrl ?? (await getUserIaUseUrl(userId));
    try {
      const out = await processUrlMemoForReview({
        userId,
        groupId,
        isAdmin,
        mediaWebUrl: href,
        iaUseUrl: iaLevel,
      });
      return { ...out, mediaWebUrl: href };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "empty_text") {
        return reply.code(400).send({ error: "empty_text", message: "Informe uma URL." });
      }
      if (msg === "url_no_text") {
        return reply.code(400).send({
          error: "url_no_text",
          message: "Não foi possível extrair texto legível desta página.",
        });
      }
      if (msg === "url_invalid") {
        return reply.code(400).send({ error: "url_invalid", message: "URL inválida." });
      }
      if (msg === "url_forbidden_host") {
        return reply.code(400).send({
          error: "url_forbidden_host",
          message: "Este endereço não pode ser obtido pelo servidor.",
        });
      }
      if (msg.startsWith("url_fetch_http_")) {
        const code = msg.replace("url_fetch_http_", "");
        return reply.code(400).send({
          error: "url_fetch_http",
          message: `A página devolveu HTTP ${code} ao obter o conteúdo.`,
        });
      }
      if (msg === "url_fetch_failed") {
        return reply.code(400).send({
          error: "url_fetch_failed",
          message: "Falha ao obter o conteúdo da URL (rede ou tempo esgotado).",
        });
      }
      throw e;
    }
  });

  app.post("/api/memos/text/confirm", async (req, reply) => {
    const parsed = textConfirmBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const groupId = parsed.data.groupId ?? null;
    const iaLevel = parsed.data.iaLevel ?? (await getUserIaUseTexto(userId));
    const maxChars =
      iaLevel === "semIA" ? ABSOLUTE_CAP : await resolveMaxSummaryCharsForText(userId, groupId, isAdmin);
    const finalText = clampTextToMax(parsed.data.mediaText.trim(), maxChars);
    if (!finalText.length) {
      return reply.code(400).send({ error: "empty_text", message: "Texto do memo vazio." });
    }
    try {
      const memo = await createMemoTextReviewed({
        userId,
        groupId,
        isAdmin,
        mediaText: finalText,
        keywords: parsed.data.keywords.trim() || null,
        dadosEspecificosJson: parsed.data.dadosEspecificosJson ?? undefined,
        dadosEspecificosOriginaisJson: parsed.data.dadosEspecificosOriginaisJson ?? undefined,
        matchedCategoryId: parsed.data.matchedCategoryId ?? null,
        apiCost: parsed.data.apiCost,
        iaLevel,
        originalText: parsed.data.originalText,
      });
      return reply.code(201).send(memo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este grupo." });
      }
      throw e;
    }
  });

  app.post("/api/memos/url/confirm", async (req, reply) => {
    const parsed = urlConfirmBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const groupId = parsed.data.groupId ?? null;
    const iaLevel = parsed.data.iaLevel ?? (await getUserIaUseUrl(userId));
    const maxChars =
      iaLevel === "semIA" ? ABSOLUTE_CAP : await resolveMaxSummaryCharsForText(userId, groupId, isAdmin);
    const finalText = clampTextToMax(parsed.data.mediaText.trim(), maxChars);
    if (!finalText.length) {
      return reply.code(400).send({ error: "empty_text", message: "Texto do memo vazio." });
    }
    try {
      const memo = await createMemoUrlReviewed({
        userId,
        groupId,
        isAdmin,
        mediaWebUrl: parsed.data.mediaWebUrl.trim(),
        mediaDocumentUrl: parsed.data.mediaDocumentUrl ?? null,
        mediaText: finalText,
        keywords: parsed.data.keywords.trim() || null,
        dadosEspecificosJson: parsed.data.dadosEspecificosJson ?? undefined,
        dadosEspecificosOriginaisJson: parsed.data.dadosEspecificosOriginaisJson ?? undefined,
        matchedCategoryId: parsed.data.matchedCategoryId ?? null,
        apiCost: parsed.data.apiCost,
        iaLevel,
        originalText: parsed.data.originalText,
      });
      return reply.code(201).send(memo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este grupo." });
      }
      throw e;
    }
  });

  app.post("/api/memos/image/process", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    let buf: Buffer | null = null;
    let filename = "upload.jpg";
    let mimetype = "image/jpeg";
    let groupId: number | null = null;
    let iaUseImagem: z.infer<typeof userIaTextoEnum> | undefined;

    for await (const part of req.parts()) {
      if (part.type === "file") {
        filename = part.filename || filename;
        mimetype = part.mimetype || mimetype;
        buf = await part.toBuffer();
      } else if (part.fieldname === "groupId" && part.value != null && String(part.value).trim() !== "") {
        const g = z.coerce.number().int().positive().safeParse(String(part.value));
        if (g.success) groupId = g.data;
      } else if (part.fieldname === "iaUseImagem" && part.value != null) {
        const p = parseMultipartIaUseField(part.value);
        if (p != null) iaUseImagem = p;
      }
    }

    if (!buf?.length) {
      return reply.code(400).send({ error: "file_required", message: "Envie um arquivo de imagem." });
    }

    const mediaType = classifyFile(mimetype, filename);
    if (mediaType !== "image") {
      return reply.code(400).send({ error: "not_image", message: "O arquivo deve ser uma imagem." });
    }

    try {
      const maxBytes = await getMaxUploadBytesForUser(userId, groupId, isAdmin, "image");
      if (buf.length > maxBytes) {
        return reply.code(413).send({
          error: "file_too_large",
          message: "A imagem excede o tamanho m?ximo permitido para o seu plano.",
          maxBytes,
        });
      }
      const out = await processImageMemoForReview({
        userId,
        groupId,
        isAdmin,
        buffer: buf,
        mime: mimetype,
        originalName: filename,
        iaUseImagem,
      });
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este grupo." });
      }
      throw e;
    }
  });

  app.post("/api/memos/image/confirm", async (req, reply) => {
    const parsed = imageConfirmBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const groupId = parsed.data.groupId ?? null;
    const maxChars = await resolveMaxSummaryCharsForImage(userId, groupId, isAdmin);
    const finalText = clampTextToMax(parsed.data.mediaText.trim(), maxChars);
    const iaLevel = parsed.data.iaLevel ?? (await getUserIaUseImagem(userId));
    try {
      const memo = await createMemoImageReviewed({
        userId,
        groupId,
        isAdmin,
        mediaImageUrl: parsed.data.mediaImageUrl,
        mediaText: finalText,
        keywords: parsed.data.keywords.trim() || null,
        dadosEspecificosJson: parsed.data.dadosEspecificosJson ?? undefined,
        dadosEspecificosOriginaisJson: parsed.data.dadosEspecificosOriginaisJson ?? undefined,
        matchedCategoryId: parsed.data.matchedCategoryId ?? null,
        apiCost: parsed.data.apiCost,
        iaLevel,
        originalText: parsed.data.originalText,
        tamMediaUrl: parsed.data.tamMediaUrl,
        originalFilename: parsed.data.originalFilename,
        source: parsed.data.source,
      });
      return reply.code(201).send(memo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_image_url") {
        return reply.code(400).send({ error: "invalid_image_url", message: "URL da imagem inv?lida ou n?o pertence ao usu?rio." });
      }
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este grupo." });
      }
      throw e;
    }
  });

  app.post("/api/memos/audio/process", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    let buf: Buffer | null = null;
    let filename = "audio.webm";
    let mimetype = "audio/webm";
    let groupId: number | null = null;
    let iaUseAudio: z.infer<typeof userIaTextoEnum> | undefined;

    for await (const part of req.parts()) {
      if (part.type === "file") {
        filename = part.filename || filename;
        mimetype = part.mimetype || mimetype;
        buf = await part.toBuffer();
      } else if (part.fieldname === "groupId" && part.value != null && String(part.value).trim() !== "") {
        const g = z.coerce.number().int().positive().safeParse(String(part.value));
        if (g.success) groupId = g.data;
      } else if (part.fieldname === "iaUseAudio" && part.value != null) {
        const p = parseMultipartIaUseField(part.value);
        if (p != null) iaUseAudio = p;
      }
    }

    if (!buf?.length) {
      return reply.code(400).send({ error: "file_required", message: "Envie um arquivo de áudio." });
    }

    if (!isAcceptableForAudioProcess(mimetype, filename)) {
      return reply.code(400).send({ error: "not_audio", message: "O arquivo deve ser um áudio." });
    }

    try {
      const maxBytes = await getMaxUploadBytesForUser(userId, groupId, isAdmin, "audio");
      if (buf.length > maxBytes) {
        return reply.code(413).send({
          error: "file_too_large",
          message: "O áudio excede o tamanho máximo permitido para o seu plano.",
          maxBytes,
        });
      }
      const out = await processAudioMemoForReview({
        userId,
        groupId,
        isAdmin,
        buffer: buf,
        mime: mimetype,
        originalName: filename,
        iaUseAudio,
      });
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este grupo." });
      }
      if (
        msg.includes("openai_whisper") ||
        msg.includes("ffmpeg_") ||
        msg.includes("openai_not_configured")
      ) {
        const friendly =
          msg.includes("ffmpeg_static_unavailable") || msg.includes("ffmpeg_static_missing")
            ? "Servidor sem conversor de áudio (ffmpeg-static). Contacte o administrador."
            : msg;
        return reply.code(422).send({
          error: "audio_process_failed",
          message: friendly,
        });
      }
      throw e;
    }
  });

  app.post("/api/memos/audio/confirm", async (req, reply) => {
    const parsed = audioConfirmBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const groupId = parsed.data.groupId ?? null;
    const maxChars = await resolveMaxSummaryCharsForAudio(userId, groupId, isAdmin);
    const finalText = clampTextToMax(parsed.data.mediaText.trim(), maxChars);
    const iaLevel = parsed.data.iaLevel ?? (await getUserIaUseAudio(userId));
    try {
      const memo = await createMemoAudioReviewed({
        userId,
        groupId,
        isAdmin,
        mediaAudioUrl: parsed.data.mediaAudioUrl,
        mediaText: finalText,
        keywords: parsed.data.keywords.trim() || null,
        dadosEspecificosJson: parsed.data.dadosEspecificosJson,
        dadosEspecificosOriginaisJson: parsed.data.dadosEspecificosOriginaisJson,
        matchedCategoryId: parsed.data.matchedCategoryId ?? null,
        apiCost: parsed.data.apiCost,
        iaLevel,
        originalText: parsed.data.originalText,
        tamMediaUrl: parsed.data.tamMediaUrl,
        originalFilename: parsed.data.originalFilename,
        source: parsed.data.source,
      });
      return reply.code(201).send(memo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_image_url") {
        return reply
          .code(400)
          .send({ error: "invalid_audio_url", message: "URL do áudio inválida ou não pertence ao usuário." });
      }
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este grupo." });
      }
      throw e;
    }
  });

  app.post("/api/memos/video/process", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    let buf: Buffer | null = null;
    let filename = "video.webm";
    let mimetype = "video/webm";
    let groupId: number | null = null;
    let iaUseVideo: z.infer<typeof userIaTextoEnum> | undefined;

    for await (const part of req.parts()) {
      if (part.type === "file") {
        filename = part.filename || filename;
        mimetype = part.mimetype || mimetype;
        buf = await part.toBuffer();
      } else if (part.fieldname === "groupId" && part.value != null && String(part.value).trim() !== "") {
        const g = z.coerce.number().int().positive().safeParse(String(part.value));
        if (g.success) groupId = g.data;
      } else if (part.fieldname === "iaUseVideo" && part.value != null) {
        const p = parseMultipartIaUseField(part.value);
        if (p != null) iaUseVideo = p;
      }
    }

    if (!buf?.length) {
      return reply.code(400).send({ error: "file_required", message: "Envie um arquivo de vídeo." });
    }

    const mediaType = classifyFile(mimetype, filename);
    if (mediaType !== "video") {
      return reply.code(400).send({ error: "not_video", message: "O arquivo deve ser um vídeo." });
    }

    try {
      const maxBytes = await getMaxUploadBytesForUser(userId, groupId, isAdmin, "video");
      if (buf.length > maxBytes) {
        return reply.code(413).send({
          error: "file_too_large",
          message: "O vídeo excede o tamanho máximo permitido para o seu plano.",
          maxBytes,
        });
      }
      const out = await processVideoMemoForReview({
        userId,
        groupId,
        isAdmin,
        buffer: buf,
        mime: mimetype,
        originalName: filename,
        iaUseVideo,
      });
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este grupo." });
      }
      if (
        msg.includes("openai_whisper") ||
        msg.includes("ffmpeg_") ||
        msg.includes("openai_not_configured")
      ) {
        const friendly =
          msg.includes("ffmpeg_static_unavailable") || msg.includes("ffmpeg_static_missing")
            ? "Servidor sem conversor de áudio/vídeo (ffmpeg-static). Contacte o administrador."
            : msg;
        return reply.code(422).send({
          error: "video_process_failed",
          message: friendly,
        });
      }
      throw e;
    }
  });

  app.post("/api/memos/video/confirm", async (req, reply) => {
    const parsed = videoConfirmBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const groupId = parsed.data.groupId ?? null;
    const maxChars = await resolveMaxSummaryCharsForVideo(userId, groupId, isAdmin);
    const finalText = clampTextToMax(parsed.data.mediaText.trim(), maxChars);
    const iaLevel = parsed.data.iaLevel ?? (await getUserIaUseVideo(userId));
    try {
      const memo = await createMemoVideoReviewed({
        userId,
        groupId,
        isAdmin,
        mediaVideoUrl: parsed.data.mediaVideoUrl,
        mediaText: finalText,
        keywords: parsed.data.keywords.trim() || null,
        apiCost: parsed.data.apiCost,
        iaLevel,
        originalText: parsed.data.originalText,
        tamMediaUrl: parsed.data.tamMediaUrl,
        originalFilename: parsed.data.originalFilename,
        source: parsed.data.source,
      });
      return reply.code(201).send(memo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_image_url") {
        return reply
          .code(400)
          .send({ error: "invalid_video_url", message: "URL do vídeo inválida ou não pertence ao usuário." });
      }
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este grupo." });
      }
      throw e;
    }
  });

  app.post("/api/memos/document/process", async (req, reply) => {
    const parsed = documentProcessBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const groupId = parsed.data.groupId ?? null;
    try {
      const out = await processDocumentMemoForReview({
        userId,
        memoId: parsed.data.memoId,
        isAdmin,
        groupId,
        iaUseDocumento: parsed.data.iaUseDocumento,
      });
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "not_found") return reply.code(404).send({ error: "not_found" });
      if (msg === "forbidden") return reply.code(403).send({ error: "forbidden" });
      if (msg === "not_document_memo") {
        return reply.code(400).send({ error: "not_document", message: "Memo não é um documento." });
      }
      if (msg === "group_mismatch") {
        return reply.code(400).send({ error: "group_mismatch", message: "Grupo não coincide com o memo." });
      }
      if (msg === "document_format_not_in_plan") {
        return reply.code(422).send({
          error: "document_format_not_in_plan",
          message: "Formato não suportado neste plano.",
        });
      }
      if (msg === "document_unsupported_format") {
        return reply.code(422).send({
          error: "document_unsupported_format",
          message:
            "Este tipo de arquivo exige pipeline especial (Office, MSG, DWG, etc.). Ajuste o JSON em ai_config ou converta para PDF/texto.",
        });
      }
      if (msg === "document_pdf_empty_text") {
        return reply.code(422).send({
          error: "document_pdf_empty_text",
          message: "PDF sem texto selecionável (possível digitalização). Use OCR ou outro formato.",
        });
      }
      if (msg === "document_pdf_parse_failed") {
        return reply.code(422).send({
          error: "document_pdf_parse_failed",
          message:
            "Não foi possível ler este PDF (estrutura interna inválida/corrompida). Em PDFs escaneados, tente exportar novamente em PDF padrão ou enviar como imagem para OCR.",
        });
      }
      if (msg === "document_pdf_ocr_failed") {
        return reply.code(422).send({
          error: "document_pdf_ocr_failed",
          message:
            "Foi detectado texto PDF com codificação inválida e o fallback OCR não conseguiu renderizar as páginas. Tente exportar novamente em PDF padrão.",
        });
      }
      if (msg === "document_msg_empty") {
        return reply.code(422).send({
          error: "document_msg_empty",
          message: "Arquivo .msg sem corpo ou metadados legíveis.",
        });
      }
      if (msg === "document_eml_empty") {
        return reply.code(422).send({
          error: "document_eml_empty",
          message:
            "Não foi possível extrair texto do .eml (arquivo vazio, corrupto ou sem corpo/cabeçalhos legíveis).",
        });
      }
      if (msg === "document_docx_empty_text") {
        return reply.code(422).send({
          error: "document_docx_empty_text",
          message: "DOCX sem texto extraível (arquivo vazio ou formato inválido).",
        });
      }
      if (msg === "document_dwg_empty_text") {
        return reply.code(422).send({
          error: "document_dwg_empty_text",
          message: "Arquivo DWG sem entidades de texto (TEXT/MTEXT/ATTRIB). O desenho pode conter apenas geometria.",
        });
      }
      if (msg.startsWith("document_dwg_converter_unreachable")) {
        return reply.code(503).send({
          error: "document_dwg_converter_unreachable",
          message: "Serviço de conversão DWG indisponível. Verifique se o container dwg-converter está rodando.",
        });
      }
      if (msg.startsWith("document_dwg_conversion_failed")) {
        return reply.code(422).send({
          error: "document_dwg_conversion_failed",
          message: "Falha na conversão do arquivo DWG. O arquivo pode estar corrompido ou em versão não suportada.",
        });
      }
      if (msg === "invalid_media_url" || msg === "document_fetch_failed" || msg === "document_empty_file") {
        return reply.code(400).send({ error: msg, message: "Não foi possível ler o arquivo do memo." });
      }
      if (msg === "empty_text") {
        return reply.code(400).send({ error: "empty_text", message: "Nenhum texto extraído do documento." });
      }
      if (msg === "document_unknown_pipeline") {
        return reply.code(400).send({
          error: "document_unknown_pipeline",
          message: "Pipeline desconhecido no JSON de roteamento — corrija ai_config.documentRoutingJson.",
        });
      }
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este grupo." });
      }
      throw e;
    }
  });

  app.post("/api/memos/document/confirm", async (req, reply) => {
    const parsed = documentConfirmBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const groupId = parsed.data.groupId ?? null;
    const maxChars = await resolveMaxSummaryCharsForDocument(userId, groupId, isAdmin);
    const finalText = clampTextToMax(parsed.data.mediaText.trim(), maxChars);
    if (!finalText.length) {
      return reply.code(400).send({ error: "empty_text", message: "Texto do memo vazio." });
    }
    const iaLevel = parsed.data.iaLevel ?? (await getUserIaUseDocumento(userId));
    try {
      const memo = await finalizeDocumentMemoReview({
        userId,
        memoId: parsed.data.memoId,
        isAdmin,
        mediaText: finalText,
        keywords: parsed.data.keywords.trim() || null,
        dadosEspecificosJson: parsed.data.dadosEspecificosJson ?? undefined,
        dadosEspecificosOriginaisJson: parsed.data.dadosEspecificosOriginaisJson ?? undefined,
        matchedCategoryId: parsed.data.matchedCategoryId ?? null,
        apiCost: parsed.data.apiCost,
        iaLevel,
        originalText: parsed.data.originalText,
        pipelineUsed: parsed.data.pipelineUsed,
        originalFilename: parsed.data.originalFilename,
        mime: parsed.data.mime,
        mediaDocumentUrl: parsed.data.mediaDocumentUrl,
        tamMediaUrl: parsed.data.tamMediaUrl,
      });
      return memo;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "not_found") return reply.code(404).send({ error: "not_found" });
      if (msg === "forbidden") return reply.code(403).send({ error: "forbidden" });
      if (msg === "not_document_memo") {
        return reply.code(400).send({ error: "not_document", message: "Memo não é um documento." });
      }
      if (msg === "document_url_mismatch" || msg === "document_size_mismatch") {
        return reply.code(400).send({ error: msg, message: "Dados do arquivo não coincidem com o memo." });
      }
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este grupo." });
      }
      throw e;
    }
  });

  app.post("/api/memos/text", async (req, reply) => {
    const parsed = textBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const memo = await createMemoText({
      userId,
      groupId: parsed.data.groupId ?? null,
      isAdmin,
      mediaText: parsed.data.mediaText,
      aiUsage: parsed.data.aiUsage,
    });
    return reply.code(201).send(memo);
  });

  app.post("/api/memos/url", async (req, reply) => {
    const parsed = urlBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const memo = await createMemoUrl({
      userId,
      groupId: parsed.data.groupId ?? null,
      isAdmin,
      mediaWebUrl: parsed.data.mediaWebUrl,
      note: parsed.data.note,
      aiUsage: parsed.data.aiUsage,
    });
    return reply.code(201).send(memo);
  });

  app.post("/api/memos/upload", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    let note: string | undefined;
    let aiUsage: PhotoAiUsage | undefined;
    let groupId: number | null = null;
    let buf: Buffer | null = null;
    let filename = "upload.bin";
    let mimetype = "application/octet-stream";

    for await (const part of req.parts()) {
      if (part.type === "file") {
        filename = part.filename || filename;
        mimetype = part.mimetype || mimetype;
        buf = await part.toBuffer();
      } else if (part.fieldname === "note" && part.value != null) {
        note = String(part.value);
      } else if (part.fieldname === "aiUsage" && part.value != null) {
        const parsed = photoAiUsageField.safeParse(String(part.value));
        if (parsed.success) aiUsage = parsed.data;
      } else if (part.fieldname === "groupId" && part.value != null && String(part.value).trim() !== "") {
        const g = z.coerce.number().int().positive().safeParse(String(part.value));
        if (g.success) groupId = g.data;
      }
    }

    if (!buf?.length) return reply.code(400).send({ error: "file_required" });

    try {
      const memo = await createMemoFromUpload({
        userId,
        groupId,
        isAdmin,
        buffer: buf,
        originalName: filename,
        mime: mimetype,
        note,
        aiUsage,
      });
      return reply.code(201).send(memo);
    } catch (e) {
      if (e instanceof Error && e.message === "file_too_large") {
        const maxBytes = (e as Error & { maxBytes?: number }).maxBytes;
        return reply.code(413).send({
          error: "file_too_large",
          message: "O arquivo excede o tamanho máximo permitido para este tipo de mídia e plano.",
          maxBytes: typeof maxBytes === "number" ? maxBytes : undefined,
        });
      }
      if (e instanceof Error && e.message === "document_format_not_in_plan") {
        return reply.code(422).send({
          error: "document_format_not_in_plan",
          message: "Formato não suportado neste plano. O processamento de arquivos IFC/CAD precisa ser habilitado nas configurações.",
        });
      }
      if (e instanceof Error && e.message === "document_unsupported_format") {
        return reply.code(422).send({
          error: "document_unsupported_format",
          message: "Formato de arquivo não suportado.",
        });
      }
      throw e;
    }
  });

  app.get("/api/memos/recent", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const q = req.query as { limit?: string; groupId?: string };
    const lim = z.coerce.number().int().min(1).max(50).safeParse(q.limit);
    const limit = lim.success ? lim.data : 12;
    const gidParsed = z.coerce.number().int().positive().safeParse(q.groupId);
    const workspaceGroupId = gidParsed.success ? gidParsed.data : null;
    const isAdmin = await getUserIsAdmin(userId);
    const items = await listRecentMemos(userId, limit, { workspaceGroupId, isAdmin });
    void reply.header("Cache-Control", "private, no-store");
    return { items };
  });

  app.get("/api/memos/search/authors", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const q = req.query as { groupId?: string };
    const gidRaw = q.groupId;
    let groupId: number | null = null;
    if (gidRaw != null && gidRaw !== "") {
      const p = z.coerce.number().int().positive().safeParse(gidRaw);
      if (!p.success) return reply.code(400).send({ error: "invalid_groupId" });
      groupId = p.data;
    }
    const isAdmin = await getUserIsAdmin(userId);
    try {
      const authors = await listMemoSearchAuthors({ userId, groupId, isAdmin });
      return { authors };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este grupo." });
      }
      throw e;
    }
  });

  app.post("/api/memos/search", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const parsed = memoSearchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const isAdmin = await getUserIsAdmin(userId);
    const gidParsed = parsed.data.groupId;
    const workspaceGroupId = gidParsed === undefined ? null : gidParsed;
    try {
      const searchMode: MemoSearchMode | undefined = parsed.data.searchMode;
      const out = await searchMemosForUser({
        userId,
        isAdmin,
        groupId: workspaceGroupId,
        query: parsed.data.query,
        logic: parsed.data.logic,
        excludeIds: parsed.data.excludeIds,
        createdAtFrom: parsed.data.createdAtFrom ?? null,
        createdAtTo: parsed.data.createdAtTo ?? null,
        authorUserId: parsed.data.authorUserId ?? null,
        searchMode,
      });
      const body: MemoSearchResponse = {
        items: out.items,
        totalCount: out.totalCount,
        displayLabel: out.displayLabel,
        highlightTerms: out.highlightTerms,
      };
      return body;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "query_too_complex") {
        return reply.code(400).send({ error: "query_too_complex", message: "Reduza o número de termos OR." });
      }
      if (msg === "invalid_date_range") {
        return reply.code(400).send({ error: "invalid_date_range", message: "A data inicial não pode ser depois da final." });
      }
      if (msg === "forbidden_author_filter") {
        return reply.code(403).send({ error: "forbidden", message: "Filtro por autor inválido." });
      }
      throw e;
    }
  });

  app.post("/api/memos/search/synonyms", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const parsed = memoSearchSynonymsBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const primary = parsed.data.term.trim();
    let synonyms: string[] = [];
    let costUsd = 0;
    let unavailable = false;
    try {
      const r = await llmSynonymsForTerm(primary);
      synonyms = r.synonyms;
      costUsd = r.costUsd;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (
        msg === "openai_not_configured" ||
        msg.startsWith("openai_http_") ||
        msg.startsWith("forge_http_")
      ) {
        unavailable = true;
      } else {
        throw e;
      }
    }
    const parts = [primary, ...synonyms].map((t) => t.trim()).filter(Boolean).slice(0, 3);
    const suggestedQuery = parts.length ? `(${parts.join(" OR ")})` : `(${primary})`;
    const body: MemoSearchSynonymsResponse = {
      synonyms,
      suggestedQuery,
      costUsd,
      unavailable: unavailable || undefined,
    };
    return body;
  });

  app.post("/api/memos/search/semantic", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const parsed = z
      .object({
        query: z.string().min(1).max(4000),
        groupId: z.number().int().positive().nullable().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const isAdmin = await getUserIsAdmin(userId);
    try {
      const out = await searchMemosSemantic({
        userId,
        isAdmin,
        groupId: parsed.data.groupId ?? null,
        query: parsed.data.query,
        limit: parsed.data.limit,
      });
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este grupo." });
      }
      if (msg === "openai_not_configured" || msg.includes("embeddings")) {
        return reply.code(503).send({ error: "semantic_unavailable", message: "Busca semântica indisponível — configure OPENAI_API_KEY." });
      }
      throw e;
    }
  });

  app.get("/api/memos/:id/file", async (req, reply) => {
    const idParsed = z.coerce.number().int().positive().safeParse((req.params as { id: string }).id);
    if (!idParsed.success) return reply.code(400).send({ error: "invalid_id" });
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Faça login." });
    }
    const qParsed = z
      .object({ attachment: z.enum(["0", "1"]).optional() })
      .safeParse(req.query as Record<string, unknown>);
    const asAttachment = qParsed.success && qParsed.data.attachment === "1";
    const isAdmin = await getUserIsAdmin(userId);
    try {
      const { buffer, filename, mime } = await getMemoAttachmentForViewer({
        memoId: idParsed.data,
        viewerId: userId,
        isAdmin,
      });
      const asciiName = filename.replace(/[^\x20-\x7E]/g, "_") || "attachment";
      const utf8Star = encodeURIComponent(filename);
      const safeAscii = asciiName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      reply.header(
        "Content-Disposition",
        `${asAttachment ? "attachment" : "inline"}; filename="${safeAscii}"; filename*=UTF-8''${utf8Star}`
      );
      return reply.type(mime).send(buffer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "not_found" || msg === "no_attachment") {
        return reply.code(404).send({ error: "not_found" });
      }
      if (
        msg === "forbidden_memo_view" ||
        msg === "group_not_found" ||
        msg === "forbidden_group"
      ) {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este memo." });
      }
      if (
        msg === "invalid_media_url" ||
        msg === "document_fetch_failed" ||
        msg === "document_empty_file"
      ) {
        return reply.code(502).send({ error: "media_unavailable", message: "Não foi possível obter o arquivo." });
      }
      throw e;
    }
  });

  app.get("/api/memos/:id", async (req, reply) => {
    const idParsed = z.coerce.number().int().positive().safeParse((req.params as { id: string }).id);
    if (!idParsed.success) return reply.code(400).send({ error: "invalid_id" });
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    try {
      const memo = await getMemoForAuthorEdit({
        memoId: idParsed.data,
        userId,
        isAdmin,
      });
      return memo;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "not_found") return reply.code(404).send({ error: "not_found" });
      if (msg === "forbidden") return reply.code(403).send({ error: "forbidden", message: "S? o autor pode ver/editar." });
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este memo." });
      }
      throw e;
    }
  });

  app.patch("/api/memos/:id", async (req, reply) => {
    const idParsed = z.coerce.number().int().positive().safeParse((req.params as { id: string }).id);
    if (!idParsed.success) return reply.code(400).send({ error: "invalid_id" });
    const parsed = patchMemoBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    try {
      const memo = await updateMemoForUser({
        memoId: idParsed.data,
        userId,
        isAdmin,
        mediaText: parsed.data.mediaText,
        keywords: parsed.data.keywords,
        dadosEspecificosJson: parsed.data.dadosEspecificosJson,
        dadosEspecificosOriginaisJson: parsed.data.dadosEspecificosOriginaisJson,
        matchedCategoryId: parsed.data.matchedCategoryId ?? null,
      });
      const body: PatchMemoResponse = { ok: true, memo };
      return body;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "not_found") return reply.code(404).send({ error: "not_found" });
      if (msg === "forbidden") return reply.code(403).send({ error: "forbidden", message: "S? o autor pode editar." });
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este memo." });
      }
      throw e;
    }
  });

  app.delete("/api/memos/:id", async (req, reply) => {
    const idParsed = z.coerce.number().int().positive().safeParse((req.params as { id: string }).id);
    if (!idParsed.success) return reply.code(400).send({ error: "invalid_id" });
    const userId = await resolveUserId(req);
    if (userId === null) {
      return reply.code(401).send({ error: "unauthorized", message: "Fa?a login." });
    }
    const isAdmin = await getUserIsAdmin(userId);
    try {
      await softDeleteMemoForUser(idParsed.data, userId, isAdmin);
      const body: DeleteMemoResponse = { ok: true };
      return body;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "not_found") return reply.code(404).send({ error: "not_found" });
      if (msg === "forbidden") return reply.code(403).send({ error: "forbidden", message: "S? o autor pode excluir." });
      if (msg === "forbidden_group" || msg === "group_not_found") {
        return reply.code(403).send({ error: "forbidden", message: "Sem acesso a este memo." });
      }
      throw e;
    }
  });
};

export default plugin;
