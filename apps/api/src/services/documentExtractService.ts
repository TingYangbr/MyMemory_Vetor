import { createRequire } from "node:module";
import { recognizeImageWithTesseract } from "../lib/imageOcr.js";
import { renderPdfPagesToPngBuffers } from "../lib/pdfRenderer.js";

const require = createRequire(import.meta.url);
const MsgReaderCtor = require("@kenjiuno/msgreader").default as new (
  buf: ArrayBuffer
) => {
  getFileData: () => {
    subject?: string;
    senderName?: string;
    senderEmail?: string;
    body?: string;
    bodyHtml?: string;
  };
};
const EXTRACT_MAX_CHARS = 500_000;
const PDF_PARSE_VERSIONS_FALLBACK = ["v2.0.550", "v1.10.100", "v1.9.426"] as const;
const PDF_GARBLED_CONTROL_CHAR_RATIO = 0.05;
const PDF_GARBLED_MIN_CHARS = 120;
const PDF_OCR_MAX_PAGES = 10;

function stripSimpleHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function runDocumentExtractPipeline(
  pipeline: string,
  buffer: Buffer,
  mime: string
): Promise<{
  text: string;
  pipelineUsed: string;
  ocrConfidence?: number | null;
  pageImages?: Buffer[];
  ocrPages?: { rendered: number; total: number; truncated: boolean };
}> {
  switch (pipeline) {
    case "extract_utf8_text":
      return { text: truncateExtract(utf8FromBuffer(buffer)), pipelineUsed: pipeline };
    case "extract_pdf_text": {
      const pdfParse = require("pdf-parse") as (
        b: Buffer,
        options?: { version?: string }
      ) => Promise<{ text?: string }>;
      let data: { text?: string };
      try {
        data = await pdfParse(buffer);
      } catch (err) {
        let parsedByFallback: { text?: string } | null = null;
        let fallbackErr: unknown = err;
        for (const version of PDF_PARSE_VERSIONS_FALLBACK) {
          try {
            parsedByFallback = await pdfParse(buffer, { version });
            break;
          } catch (e) {
            fallbackErr = e;
          }
        }
        if (parsedByFallback) {
          data = parsedByFallback;
        } else {
          const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          const low = msg.toLowerCase();
          if (
            low.includes("bad xref entry") ||
            low.includes("xref") ||
            low.includes("invalid pdf") ||
            low.includes("formaterror") ||
            low.includes("unexpected server response")
          ) {
            throw new Error("document_pdf_parse_failed");
          }
          throw fallbackErr;
        }
      }
      const raw = String(data?.text ?? "").replace(/\0/g, "");
      if (!raw.trim()) {
        throw new Error("document_pdf_empty_text");
      }
      if (isLikelyGarbledPdfText(raw)) {
        return runDocumentExtractPipeline("extract_pdf_ocr", buffer, mime);
      }
      return { text: truncateExtract(raw), pipelineUsed: pipeline };
    }
    case "extract_pdf_ocr": {
      try {
        const rendered = await renderPdfPagesToPngBuffers(buffer, {
          maxPages: PDF_OCR_MAX_PAGES,
          scale: 2,
        });
        if (!rendered.pages.length) {
          throw new Error("document_pdf_empty_text");
        }
        const chunks: string[] = [];
        const confidences: number[] = [];
        for (const pageBuffer of rendered.pages) {
          const ocr = await recognizeImageWithTesseract(pageBuffer);
          if (ocr.text.trim()) chunks.push(ocr.text.trim());
          if (ocr.confidence != null && Number.isFinite(ocr.confidence)) {
            confidences.push(ocr.confidence);
          }
        }
        const raw = chunks.join("\n\n").trim();
        if (!raw) {
          throw new Error("document_pdf_empty_text");
        }
        const avgConfidence =
          confidences.length > 0 ? confidences.reduce((sum, n) => sum + n, 0) / confidences.length : null;
        return {
          text: truncateExtract(raw),
          pipelineUsed: pipeline,
          ocrConfidence: avgConfidence,
          pageImages: rendered.pages,
          ocrPages: {
            rendered: rendered.renderedPages,
            total: rendered.totalPages,
            truncated: rendered.truncated,
          },
        };
      } catch (err) {
        if (err instanceof Error && err.message === "document_pdf_empty_text") throw err;
        throw new Error("document_pdf_ocr_failed");
      }
    }
    case "extract_docx_text": {
      const mammoth = require("mammoth") as {
        extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
      };
      const result = await mammoth.extractRawText({ buffer });
      const raw = String(result.value ?? "").replace(/\0/g, "").trim();
      if (!raw) {
        throw new Error("document_docx_empty_text");
      }
      return { text: truncateExtract(raw), pipelineUsed: pipeline };
    }
    case "extract_msg_text": {
      const copy = new Uint8Array(buffer.byteLength);
      copy.set(buffer);
      const reader = new MsgReaderCtor(copy.buffer);
      const data = reader.getFileData();
      const bodyPlain = (data.body ?? "").trim();
      const bodyHtml = data.bodyHtml ? stripSimpleHtml(String(data.bodyHtml)) : "";
      const mainBody = bodyPlain || bodyHtml;
      const parts = [
        data.subject ? `Assunto: ${data.subject}` : "",
        data.senderName ? `De: ${data.senderName}` : "",
        data.senderEmail ? `E-mail: ${data.senderEmail}` : "",
        mainBody,
      ].filter((p) => p.length > 0);
      const text = parts.join("\n\n").trim();
      if (!text) {
        throw new Error("document_msg_empty");
      }
      return { text: truncateExtract(text), pipelineUsed: pipeline };
    }
    case "extract_eml_text": {
      const { simpleParser } = require("mailparser") as {
        simpleParser: (src: Buffer) => Promise<{
          text?: string | false;
          html?: string | false;
          subject?: string;
          from?: { text?: string } | null;
          to?: { text?: string } | null;
          cc?: { text?: string } | null;
          date?: Date | null;
        }>;
      };
      let parsed: Awaited<ReturnType<(typeof simpleParser)>>;
      try {
        parsed = await simpleParser(buffer);
      } catch {
        throw new Error("document_eml_empty");
      }
      const bodyPlain = typeof parsed.text === "string" ? parsed.text.trim() : "";
      const bodyHtml =
        parsed.html && typeof parsed.html === "string" ? stripSimpleHtml(parsed.html) : "";
      const mainBody = bodyPlain || bodyHtml;
      const parts = [
        parsed.subject?.trim() ? `Assunto: ${parsed.subject.trim()}` : "",
        parsed.date ? `Data: ${parsed.date.toISOString()}` : "",
        parsed.from?.text?.trim() ? `De: ${parsed.from.text.trim()}` : "",
        parsed.to?.text?.trim() ? `Para: ${parsed.to.text.trim()}` : "",
        parsed.cc?.text?.trim() ? `Cc: ${parsed.cc.text.trim()}` : "",
        mainBody,
      ].filter((p) => p.length > 0);
      const text = parts.join("\n\n").trim();
      if (!text) {
        throw new Error("document_eml_empty");
      }
      return { text: truncateExtract(text), pipelineUsed: pipeline };
    }
    case "unsupported":
      throw new Error("document_unsupported_format");
    default:
      throw new Error("document_unknown_pipeline");
  }
}

function pdfAlnumRatio(t: string): number {
  if (!t.length) return 0;
  let n = 0;
  for (const ch of t) {
    if (/[\p{L}\p{N}]/u.test(ch)) n += 1;
  }
  return n / t.length;
}

/**
 * Texto extraído por pdf-parse que parece lixo (PDFCreator, Type 3, ToUnicode falho, etc.).
 * O critério só com control chars falha quando o lixo é “legível” em Unicode mas sem significado.
 */
function isLikelyGarbledPdfText(text: string): boolean {
  if (text.length < PDF_GARBLED_MIN_CHARS) return false;

  const controlChars = (text.match(/[\x01-\x08\x0e-\x1f\x7f]/g) || []).length;
  if (controlChars > 0 && controlChars / text.length > PDF_GARBLED_CONTROL_CHAR_RATIO) {
    return true;
  }

  const replacement = (text.match(/\uFFFD/g) || []).length;
  if (replacement > 0 && replacement / text.length > 0.015) return true;

  let pua = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (
      (cp >= 0xe000 && cp <= 0xf8ff) ||
      (cp >= 0xf0000 && cp <= 0xffffd) ||
      (cp >= 0x100000 && cp <= 0x10fffd)
    ) {
      pua += 1;
    }
  }
  if (pua / text.length > 0.03) return true;

  if (text.length >= 200 && pdfAlnumRatio(text) < 0.12) return true;

  return false;
}

function utf8FromBuffer(buffer: Buffer): string {
  try {
    const s = buffer.toString("utf8");
    if (!s.includes("\uFFFD")) return s;
  } catch {
    /* */
  }
  return buffer.toString("latin1");
}

function truncateExtract(s: string): string {
  const t = s.replace(/\0/g, "").trim();
  if (t.length <= EXTRACT_MAX_CHARS) return t;
  return `${t.slice(0, EXTRACT_MAX_CHARS)}\n\n[… texto truncado para processamento …]`;
}
