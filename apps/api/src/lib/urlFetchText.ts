import axios, { isAxiosError } from "axios";
import * as cheerio from "cheerio";
import { config } from "../config.js";
import { openaiTranscribeAudio } from "./openaiTranscription.js";

/** Limite de download HTTP (HTML ou texto). */
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
/** Limite maior só para o fallback de áudio (Whisper aceita até ~25 MB). */
const MAX_AUDIO_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
/** Tamanho máximo do texto final enviado ao pipeline / LLM. */
const MAX_OUTPUT_CHARS = 8_000;
/** Abaixo disso o texto extraído do HTML é tratado como "nada útil capturado". */
const MIN_MEANINGFUL_TEXT_CHARS = 40;

const CHROME_120_WIN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CONTENT_SELECTORS = [
  "article",
  "main",
  '[role="main"]',
  ".content",
  ".post-content",
  ".article-body",
  ".entry-content",
  "#content",
  "#main",
  "body",
] as const;

/** Remove ruído estrutural, consentimento, anúncios comuns (um único documento; não segue links). */
function cleanupDom($: cheerio.CheerioAPI): void {
  const junk = [
    "script",
    "style",
    "noscript",
    "nav",
    "footer",
    "header",
    "aside",
    "iframe",
    "svg",
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[role="complementary"]',
    // Cookies / consentimento / GDPR
    '[class*="cookie-consent"]',
    '[id*="cookie-consent"]',
    '[class*="cookie-banner"]',
    '[id*="cookie-banner"]',
    '[class*="cookie-notice"]',
    '[id*="cookie-notice"]',
    '[class*="consent-banner"]',
    '[id*="consent-banner"]',
    '[class*="CookieConsent"]',
    '[id*="CookieConsent"]',
    '[class*="gdpr-banner"]',
    '[id*="gdpr-banner"]',
    '[class*="privacy-banner"]',
    '[id*="onetrust"]',
    '[class*="onetrust"]',
    // Anúncios
    '[class*="advertisement"]',
    '[id*="advertisement"]',
    '[class*="sponsored-content"]',
    '[class*="ad-container"]',
    '[id*="ad-container"]',
    '[class*="google-ad"]',
    '[id*="google_ads"]',
    ".ad",
    ".ads",
    '[data-ad-slot]',
    '[data-ad-client]',
  ].join(", ");
  $(junk).remove();
}

function normalizeText(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function extractMeta($: cheerio.CheerioAPI): {
  title: string;
  description: string;
  site: string;
} {
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const twTitle = $('meta[name="twitter:title"]').attr("content")?.trim();
  const docTitle = $("title").first().text().trim();
  const title = ogTitle || twTitle || docTitle || "";

  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim();
  const metaDesc = $('meta[name="description"]').attr("content")?.trim();
  let description = ogDesc || metaDesc || "";

  const site = $('meta[property="og:site_name"]').attr("content")?.trim() || "";
  const lang = $("html").attr("lang")?.trim() || "";
  if (!description && lang) description = `(html lang="${lang}")`;

  return { title, description, site };
}

function extractMainPlainText($: cheerio.CheerioAPI): string {
  for (const sel of CONTENT_SELECTORS) {
    const el = $(sel).first();
    if (!el.length) continue;
    const t = normalizeText(el.text());
    if (t.length >= 40) return t;
  }
  const body = $("body").first().text();
  return normalizeText(body);
}

function assemblePlainText(
  meta: { title: string; site: string; description: string },
  content: string
): { text: string; truncated: boolean } {
  const headerLines = [
    `Título: ${meta.title || "(sem título)"}`,
    `Site: ${meta.site || "(desconhecido)"}`,
    `Descrição: ${meta.description || "(sem descrição)"}`,
    "",
    "Conteúdo:",
  ];
  const header = headerLines.join("\n");
  let contentPart = normalizeText(content);
  const maxContent = Math.max(0, MAX_OUTPUT_CHARS - header.length - 1);
  let truncated = false;
  if (contentPart.length > maxContent) {
    contentPart = contentPart.slice(0, maxContent);
    truncated = true;
  }
  let full = `${header}\n${contentPart}`;
  if (full.length > MAX_OUTPUT_CHARS) {
    full = full.slice(0, MAX_OUTPUT_CHARS);
    truncated = true;
  }
  return { text: full, truncated };
}

/** Download binário (safe para HTML/texto e para áudio); `maxBytes` varia por caso de uso. */
async function downloadWithAxios(
  href: string,
  maxBytes: number = MAX_DOWNLOAD_BYTES
): Promise<{ buffer: Buffer; contentType: string }> {
  try {
    const res = await axios.get<ArrayBuffer>(href, {
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      responseType: "arraybuffer",
      headers: {
        "User-Agent": CHROME_120_WIN_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const ct = String(res.headers["content-type"] ?? "").toLowerCase();
    const buffer = Buffer.from(res.data);
    return { buffer, contentType: ct };
  } catch (e) {
    if (isAxiosError(e)) {
      const status = e.response?.status;
      if (typeof status === "number") throw new Error(`url_fetch_http_${status}`);
      throw new Error("url_fetch_failed");
    }
    throw e;
  }
}

function isAudioMime(mime: string): boolean {
  return mime.startsWith("audio/");
}

function guessFilenameFromUrl(u: URL, mime: string): string {
  const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
  if (/\.[a-z0-9]{2,5}$/i.test(last)) return last;
  const extMap: Record<string, string> = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/webm": ".webm",
    "audio/mp4": ".mp4",
    "audio/x-m4a": ".m4a",
    "audio/flac": ".flac",
    "audio/opus": ".opus",
  };
  const ext = extMap[mime.split(";")[0].trim().toLowerCase()] || ".mp3";
  return `${last || "audio"}${ext}`;
}

/** Procura `<audio src>` / `<audio><source src>` e resolve para URL absoluta (mesma página, sem seguir navegação). */
function findEmbeddedAudioUrl($: cheerio.CheerioAPI, baseHref: string): string | null {
  const raw =
    $("audio[src]").first().attr("src") || $("audio source[src]").first().attr("src") || null;
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim(), baseHref).href;
  } catch {
    return null;
  }
}

/**
 * Transcreve um recurso de áudio via Whisper. Retorna `null` (sem lançar) quando IA não está
 * configurada ou a transcrição falha — quem chama decide o fallback (nunca derruba o fluxo principal).
 * Só lança quando o próprio download excede o limite de tamanho (caso digno de mensagem específica).
 */
async function transcribeAudioResource(
  audioUrl: string,
  mimeHint: string
): Promise<{ text: string; costUsd: number } | null> {
  if (!config.openai.apiKey) return null;
  let u: URL;
  try {
    u = assertMemoUrlFetchable(audioUrl);
  } catch {
    return null;
  }
  let buffer: Buffer;
  let contentType: string;
  try {
    const dl = await downloadWithAxios(u.href, MAX_AUDIO_DOWNLOAD_BYTES);
    buffer = dl.buffer;
    contentType = dl.contentType || mimeHint;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "url_fetch_failed" || msg.startsWith("url_fetch_http_")) return null;
    throw e;
  }
  if (!buffer.length) return null;
  if (buffer.length >= MAX_AUDIO_DOWNLOAD_BYTES) throw new Error("url_audio_too_large");
  try {
    const { text, costUsd } = await openaiTranscribeAudio({
      buffer,
      filename: guessFilenameFromUrl(u, contentType),
      mime: contentType.split(";")[0]?.trim() || mimeHint,
    });
    const trimmed = text.trim();
    if (!trimmed) return null;
    return { text: trimmed, costUsd };
  } catch {
    return null;
  }
}

/** Evita SSRF óbvio em pedidos server-side para memos por URL. */
export function assertMemoUrlFetchable(urlStr: string): URL {
  let u: URL;
  try {
    u = new URL(urlStr.trim());
  } catch {
    throw new Error("url_invalid");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("url_invalid");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "[::1]" || host === "::1") {
    throw new Error("url_forbidden_host");
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    const c = Number(ipv4[3]);
    const d = Number(ipv4[4]);
    if ([a, b, c, d].some((n) => n > 255)) throw new Error("url_invalid");
    if (a === 0 || a === 127 || a === 10) throw new Error("url_forbidden_host");
    if (a === 192 && b === 168) throw new Error("url_forbidden_host");
    if (a === 169 && b === 254) throw new Error("url_forbidden_host");
    if (a === 172 && b >= 16 && b <= 31) throw new Error("url_forbidden_host");
  }
  return u;
}

/**
 * Um único GET (sem seguir `href`); monta texto estruturado para pipeline / LLM.
 *
 * Fallback de áudio (Whisper), só neste pipeline de URL:
 * - se a própria URL responder com `content-type: audio/*`, transcreve o áudio diretamente;
 * - se for HTML mas o texto extraído for vazio/muito curto, procura um `<audio>` embutido na
 *   página e, se achar, transcreve esse áudio. Qualquer falha nesse fallback é silenciosa e
 *   cai de volta no comportamento anterior (texto curto tal como estava, ou `url_no_text`).
 */
export async function fetchAndExtractPlainTextFromUrl(urlStr: string): Promise<{
  text: string;
  warning: string | null;
  apiCost: number;
}> {
  const u = assertMemoUrlFetchable(urlStr);
  const href = u.href;
  const host = u.hostname;
  // Baixa sempre com o teto maior (áudio): o content-type só é conhecido depois do download,
  // então não dá para decidir o limite antes. HTML/texto seguem cortados em 8.000 chars no final,
  // então o teto maior aqui não muda o comportamento deles, só permite áudio maior que 5 MB.
  const { buffer: rawBuf, contentType } = await downloadWithAxios(href, MAX_AUDIO_DOWNLOAD_BYTES);

  const mimeMain = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const warnings: string[] = [];

  if (isAudioMime(mimeMain)) {
    if (rawBuf.length >= MAX_AUDIO_DOWNLOAD_BYTES) throw new Error("url_audio_too_large");
    if (!config.openai.apiKey) throw new Error("url_no_text");
    const transcript = await transcribeAudioResource(href, mimeMain);
    if (!transcript?.text) throw new Error("url_no_text");
    const { text, truncated } = assemblePlainText(
      {
        title: "(áudio)",
        site: host,
        description: "(transcrito automaticamente via IA — narração em áudio)",
      },
      transcript.text
    );
    if (truncated) warnings.push("Texto final truncado em 8.000 caracteres (limite para IA).");
    return { text, warning: warnings.length ? warnings.join(" ") : null, apiCost: transcript.costUsd };
  }

  if (rawBuf.length >= MAX_DOWNLOAD_BYTES - 100) {
    warnings.push("Resposta próxima do limite de 5 MB; parte do conteúdo pode estar incompleta.");
  }

  const raw = rawBuf.toString("utf8");
  const isPlainMime = mimeMain === "text/plain";

  if (isPlainMime) {
    const plain = normalizeText(raw);
    if (!plain) throw new Error("url_no_text");
    const { text, truncated } = assemblePlainText(
      {
        title: "(documento texto)",
        site: host,
        description: "(sem metadados — recurso text/plain)",
      },
      plain
    );
    if (truncated) warnings.push("Texto final truncado em 8.000 caracteres (limite para IA).");
    return { text, warning: warnings.length ? warnings.join(" ") : null, apiCost: 0 };
  }

  const $ = cheerio.load(raw);
  const meta = extractMeta($);
  const embeddedAudioUrl = findEmbeddedAudioUrl($, href);
  cleanupDom($);
  const mainText = extractMainPlainText($);

  if (normalizeText(mainText).length < MIN_MEANINGFUL_TEXT_CHARS && embeddedAudioUrl) {
    const transcript = await transcribeAudioResource(embeddedAudioUrl, "audio/mpeg").catch(() => null);
    if (transcript?.text) {
      const siteLabel = meta.site || host;
      const titleLabel = meta.title || host;
      const { text, truncated } = assemblePlainText(
        {
          title: titleLabel,
          site: siteLabel,
          description: meta.description || "(transcrito automaticamente via IA — narração em áudio da página)",
        },
        transcript.text
      );
      if (truncated) warnings.push("Texto final truncado em 8.000 caracteres (limite para IA).");
      return { text, warning: warnings.length ? warnings.join(" ") : null, apiCost: transcript.costUsd };
    }
  }

  if (!mainText) throw new Error("url_no_text");

  const siteLabel = meta.site || host;
  const titleLabel = meta.title || host;

  const { text, truncated } = assemblePlainText(
    {
      title: titleLabel,
      site: siteLabel,
      description: meta.description,
    },
    mainText
  );
  if (truncated) warnings.push("Texto final truncado em 8.000 caracteres (limite para IA).");

  return { text, warning: warnings.length ? warnings.join(" ") : null, apiCost: 0 };
}
