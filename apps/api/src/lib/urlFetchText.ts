import axios, { isAxiosError } from "axios";
import * as cheerio from "cheerio";

/** Limite de download HTTP (HTML ou texto). */
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
/** Tamanho máximo do texto final enviado ao pipeline / LLM. */
const MAX_OUTPUT_CHARS = 8_000;

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

async function downloadWithAxios(href: string): Promise<{ body: string; contentType: string }> {
  try {
    const res = await axios.get<string>(href, {
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: MAX_DOWNLOAD_BYTES,
      maxBodyLength: MAX_DOWNLOAD_BYTES,
      responseType: "text",
      responseEncoding: "utf8",
      headers: {
        "User-Agent": CHROME_120_WIN_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const ct = String(res.headers["content-type"] ?? "").toLowerCase();
    const body = typeof res.data === "string" ? res.data : String(res.data);
    return { body, contentType: ct };
  } catch (e) {
    if (isAxiosError(e)) {
      const status = e.response?.status;
      if (typeof status === "number") throw new Error(`url_fetch_http_${status}`);
      throw new Error("url_fetch_failed");
    }
    throw e;
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
 */
export async function fetchAndExtractPlainTextFromUrl(urlStr: string): Promise<{
  text: string;
  warning: string | null;
}> {
  const u = assertMemoUrlFetchable(urlStr);
  const href = u.href;
  const host = u.hostname;
  const { body: raw, contentType } = await downloadWithAxios(href);

  const warnings: string[] = [];
  if (raw.length >= MAX_DOWNLOAD_BYTES - 100) {
    warnings.push("Resposta próxima do limite de 5 MB; parte do HTML pode estar incompleta.");
  }

  const mimeMain = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
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
    return { text, warning: warnings.length ? warnings.join(" ") : null };
  }

  const $ = cheerio.load(raw);
  const meta = extractMeta($);
  cleanupDom($);
  const mainText = extractMainPlainText($);
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

  return { text, warning: warnings.length ? warnings.join(" ") : null };
}
