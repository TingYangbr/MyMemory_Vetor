import type { MemoRecentCard } from "@mymemory/shared";

export function memoCardHasAttachment(m: {
  hasFile: boolean;
  mediaFileUrl?: string | null;
}): boolean {
  return Boolean(m.hasFile || m.mediaFileUrl?.trim());
}

export function attachmentExt(mediaFileUrl: string | null | undefined): string {
  const u = mediaFileUrl?.trim();
  if (!u) return "";
  const path = (u.split("?")[0] ?? "").split("#")[0] ?? "";
  const slash = path.lastIndexOf("/");
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot >= base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function documentVisualKind(ext: string): "pdf" | "word" | "mail" | "other" {
  if (ext === "pdf") return "pdf";
  if (ext === "doc" || ext === "docx" || ext === "odt" || ext === "rtf") return "word";
  if (ext === "eml" || ext === "msg") return "mail";
  return "other";
}

export function formatSearchCardDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

export function displayBasenameFromUrl(url: string): string {
  try {
    const noQuery = (url.split("?")[0] ?? "").split("#")[0] ?? "";
    const last = noQuery.split("/").pop() ?? "";
    return last ? decodeURIComponent(last) : "";
  } catch {
    return "";
  }
}

export function searchCardPrimaryLabel(m: MemoRecentCard): string {
  const fromApi = m.attachmentDisplayName?.trim();
  if (fromApi) return fromApi;
  if (m.mediaType === "url") {
    const body = (m.mediaText || "").trim();
    if (body) return body.length > 80 ? `${body.slice(0, 77)}…` : body;
    if (m.mediaWebUrl?.trim()) return m.mediaWebUrl.trim();
  }
  const u = m.mediaFileUrl?.trim();
  if (u) {
    const base = displayBasenameFromUrl(u);
    if (base) return base;
  }
  const t = (m.mediaText || m.headline || "").trim();
  if (t) return t.length > 80 ? `${t.slice(0, 77)}…` : t;
  return "Memo";
}

export function resolvePublicMediaSrc(apiBase: string, mediaFileUrl: string | null | undefined): string {
  const u = mediaFileUrl?.trim();
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return `${apiBase}${u.startsWith("/") ? u : `/${u}`}`;
}

/** Par chave/valor de `dadosEspecificosJson` (objeto plano). */
export type MemoDadosEspecificosEntry = { key: string; value: string };

/** Lista de pares para exibição com estilos distintos (rótulo vs valor). */
export function parseMemoDadosEspecificosEntries(
  dadosJson: string | null | undefined
): MemoDadosEspecificosEntry[] | null {
  if (!dadosJson?.trim()) return null;
  try {
    const j = JSON.parse(dadosJson) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    const out: MemoDadosEspecificosEntry[] = [];
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      const key = k.trim();
      if (!key) continue;
      const val =
        v == null ? "" : typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
      out.push({ key, value: val });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** Uma linha legível «chave: valor» para cartões (truncada). */
export function formatMemoDadosEspecificosPreview(
  dadosJson: string | null | undefined,
  maxLen = 220
): string | null {
  const entries = parseMemoDadosEspecificosEntries(dadosJson);
  if (!entries?.length) return null;
  const parts = entries.map((e) => (e.value ? `${e.key}: ${e.value}` : e.key));
  const s = parts.join(" · ");
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
}

export function parseKeywordList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Contagem de campos de dados específicos preenchidos (valor não vazio) / total de chaves. */
export function dadosFilledCounts(json: string | null | undefined): { xx: number; yy: number } {
  const entries = parseMemoDadosEspecificosEntries(json);
  if (!entries?.length) return { xx: 0, yy: 0 };
  const yy = entries.length;
  const xx = entries.filter((e) => e.value.trim().length > 0).length;
  return { xx, yy };
}
