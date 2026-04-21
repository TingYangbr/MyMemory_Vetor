import type { MemoRecentCard, MemoSearchHighlightTerm, MemoSearchMode } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import {
  attachmentDisplayNameFromMemoLike,
  primaryMediaFileUrlFromMemoLike,
} from "../lib/memoAttachmentDisplayName.js";
import { getSingularPluralSearchVariants } from "../lib/ptSearchExpand.js";
import { pool } from "../db.js";
import { assertUserWorkspaceGroupAccess } from "./memoContextService.js";
import { searchMemosByEmbedding } from "../lib/openaiEmbedding.js";

const MAX_SEGMENTS = 24;
const MAX_OR_BRANCHES_TOTAL = 48;
/** Teto de variantes singular/plural por ramo OR (não inclui sinónimos da busca expandida). */
const MAX_SG_PL_VARIANTS_PER_BRANCH = 8;

function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function stripOuterParens(p: string): string {
  let t = p.trim();
  while (t.startsWith("(") && t.endsWith(")")) {
    const inner = t.slice(1, -1).trim();
    let d = 0;
    let ok = true;
    for (const ch of inner) {
      if (ch === "(") d++;
      else if (ch === ")") {
        d--;
        if (d < 0) ok = false;
      }
    }
    if (!ok || d !== 0) break;
    t = inner;
  }
  return t;
}

type Segment = { orBranches: string[] };

function parseSegments(raw: string): Segment[] {
  const parts = splitTopLevelCommas(raw.trim());
  if (parts.length > MAX_SEGMENTS) throw new Error("query_too_complex");
  const segments: Segment[] = [];
  let orTotal = 0;
  for (const part of parts) {
    const inner = stripOuterParens(part);
    const branches = inner
      .split(/\s+OR\s+/i)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!branches.length) continue;
    orTotal += branches.length;
    if (orTotal > MAX_OR_BRANCHES_TOTAL) throw new Error("query_too_complex");
    segments.push({ orBranches: branches });
  }
  return segments;
}

/**
 * Escapa metacaracteres para operador POSIX `~*` do PostgreSQL.
 */
function pgRegexpEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove acentos para busca accent-insensitive (espelha o unaccent() do PostgreSQL). */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Correspondência por **palavra inteira** usando `\y` (word boundary POSIX no PostgreSQL).
 * "ting" não casa "softing"; "softing" casa em "Softing Automação Ltda".
 */
function wholeWordRegexpPattern(termLower: string): string | null {
  const words = termLower
    .trim()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (!words.length) return null;
  const parts = words.map((w) => `\\y${pgRegexpEscape(w)}\\y`);
  return parts.join(".*?");
}

function parseYmd(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function assertDateRange(from: string | null, to: string | null): void {
  if (from && to && from > to) throw new Error("invalid_date_range");
}

function numDb(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

interface MemoSearchRow extends RowDataPacket {
  id: number;
  userId: number;
  groupId: number | null;
  mediaType: string;
  mediaText: string;
  mediaWebUrl: string | null;
  mediaAudioUrl: string | null;
  mediaImageUrl: string | null;
  mediaVideoUrl: string | null;
  mediaDocumentUrl: string | null;
  createdAt: Date;
  keywords: string | null;
  dadosEspecificosJson: string | null;
  mediaMetadata: string | null;
  apiCost?: unknown;
  usedApiCred?: unknown;
  hasChunks?: unknown;
}

function headlineFromRow(r: MemoSearchRow): string {
  const text = (r.mediaText ?? "").trim();
  if (text.length > 120) return text.slice(0, 117) + "…";
  if (text) return text;
  return r.mediaType;
}

function extractIaUseLevel(mediaMetadata: string | null | undefined): string | null {
  if (!mediaMetadata) return null;
  try {
    const m = typeof mediaMetadata === "string"
      ? (JSON.parse(mediaMetadata) as Record<string, unknown>)
      : mediaMetadata as Record<string, unknown>;
    const v = m.iaUseTexto ?? m.iaUseImagem ?? m.iaUseAudio ?? m.iaUseVideo ?? m.iaUseDocumento ?? m.iaUseUrl;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

function rowToCard(r: MemoSearchRow): MemoRecentCard {
  return {
    id: r.id,
    mediaType: r.mediaType as MemoRecentCard["mediaType"],
    headline: headlineFromRow(r),
    mediaText: r.mediaText ?? "",
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    mediaWebUrl: r.mediaWebUrl,
    hasFile: Boolean(
      r.mediaAudioUrl || r.mediaImageUrl || r.mediaVideoUrl || r.mediaDocumentUrl
    ),
    keywords: r.keywords ?? null,
    dadosEspecificosJson: r.dadosEspecificosJson ?? null,
    mediaFileUrl: primaryMediaFileUrlFromMemoLike(r),
    attachmentDisplayName: attachmentDisplayNameFromMemoLike(r),
    userId: r.userId,
    apiCost: numDb(r.apiCost),
    usedApiCred: numDb(r.usedApiCred),
    iaUseLevel: extractIaUseLevel(r.mediaMetadata),
    hasSemanticChunks: Boolean(r.hasChunks),
  };
}

function haystackSql(mode: MemoSearchMode): string {
  // unaccent() + LOWER() → busca accent-insensitive (ã=a, é=e, etc.)
  // REGEXP_REPLACE remove chaves JSON ("campo":) para buscar apenas nos valores
  const dadosValuesOnly = `unaccent(LOWER(TRIM(REGEXP_REPLACE(COALESCE(m.dadosespecificosjson,''), '"[^"]+"\\s*:', ' ', 'g'))))`;
  switch (mode) {
    case "mediaText":
      return `unaccent(LOWER(COALESCE(m.mediatext,'')))`;
    case "keywords":
      return `unaccent(LOWER(COALESCE(m.keywords,'')))`;
    case "dadosEspecificos":
      return dadosValuesOnly;
    default:
      return `unaccent(LOWER(CONCAT(COALESCE(m.mediatext,''), ' ', COALESCE(m.keywords,''), ' ', ${dadosValuesOnly})))`;
  }
}

async function assertAuthorFilterAllowed(input: {
  viewerId: number;
  groupId: number | null;
  authorUserId: number | null;
  isAdmin: boolean;
}): Promise<void> {
  if (input.authorUserId == null) return;
  if (input.groupId == null) {
    if (input.authorUserId !== input.viewerId) throw new Error("forbidden_author_filter");
    return;
  }
  await assertUserWorkspaceGroupAccess(input.viewerId, input.groupId, input.isAdmin);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM group_members WHERE groupid = ? AND userid = ? LIMIT 1`,
    [input.groupId, input.authorUserId]
  );
  if (!rows.length) throw new Error("forbidden_author_filter");
}

export async function listMemoSearchAuthors(input: {
  userId: number;
  groupId: number | null;
  isAdmin: boolean;
}): Promise<Array<{ id: number; name: string | null; email: string | null }>> {
  if (input.groupId == null) {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, email FROM users WHERE id = ? LIMIT 1",
      [input.userId]
    );
    const u = rows[0];
    if (!u) return [];
    return [{ id: u.id as number, name: (u.name as string) ?? null, email: (u.email as string) ?? null }];
  }
  await assertUserWorkspaceGroupAccess(input.userId, input.groupId, input.isAdmin);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT u.id, u.name, u.email
     FROM users u
     INNER JOIN group_members gm ON gm.userId = u.id AND gm.groupId = ?
     ORDER BY u.name ASC NULLS LAST, u.email ASC`,
    [input.groupId]
  );
  return rows.map((r) => ({
    id: r.id as number,
    name: (r.name as string) ?? null,
    email: (r.email as string) ?? null,
  }));
}

const SEARCH_LIMIT = 80;

/**
 * `LOWER(...) REGEXP '\\btermo\\b'` (palavra inteira, ICU) por cada variante OR; segmentos por AND/OR.
 */
export async function searchMemosForUser(input: {
  userId: number;
  isAdmin: boolean;
  groupId: number | null;
  query: string;
  logic: "and" | "or";
  excludeIds: number[];
  createdAtFrom: string | null;
  createdAtTo: string | null;
  authorUserId: number | null;
  /** Default `all`: texto, keywords e JSON de dados específicos. */
  searchMode?: MemoSearchMode;
}): Promise<{
  items: MemoRecentCard[];
  totalCount: number;
  displayLabel: string;
  highlightTerms: MemoSearchHighlightTerm[];
}> {
  const q = input.query.trim();
  if (!q) {
    return { items: [], totalCount: 0, displayLabel: "", highlightTerms: [] };
  }

  const cFrom = input.createdAtFrom ? parseYmd(input.createdAtFrom) : null;
  const cTo = input.createdAtTo ? parseYmd(input.createdAtTo) : null;
  if (input.createdAtFrom && !cFrom) throw new Error("invalid_date_range");
  if (input.createdAtTo && !cTo) throw new Error("invalid_date_range");
  assertDateRange(cFrom, cTo);

  await assertAuthorFilterAllowed({
    viewerId: input.userId,
    groupId: input.groupId,
    authorUserId: input.authorUserId,
    isAdmin: input.isAdmin,
  });

  if (input.groupId != null) {
    await assertUserWorkspaceGroupAccess(input.userId, input.groupId, input.isAdmin);
  }

  const segments = parseSegments(q);
  if (!segments.length) {
    return { items: [], totalCount: 0, displayLabel: q.slice(0, 120), highlightTerms: [] };
  }

  const mode: MemoSearchMode = input.searchMode ?? "all";
  const hay = haystackSql(mode);

  const conds: string[] = [];
  const vals: unknown[] = [];
  for (const seg of segments) {
    const orParts: string[] = [];
    for (const br of seg.orBranches) {
      const sgPl = getSingularPluralSearchVariants(br);
      const uniq = [...new Set(sgPl.map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(
        0,
        MAX_SG_PL_VARIANTS_PER_BRANCH
      );
      const sub: string[] = [];
      for (const term of uniq) {
        const pat = wholeWordRegexpPattern(stripAccents(term));
        if (!pat) continue;
        sub.push(`${hay} ~* ?`);
        vals.push(pat);
      }
      if (sub.length) orParts.push(sub.length === 1 ? sub[0]! : `(${sub.join(" OR ")})`);
    }
    if (!orParts.length) {
      return { items: [], totalCount: 0, displayLabel: q.length > 140 ? `${q.slice(0, 137)}…` : q, highlightTerms: [] };
    }
    conds.push(`(${orParts.join(" OR ")})`);
  }
  const logicOp = input.logic === "or" ? " OR " : " AND ";
  const matchSql = conds.join(logicOp);

  const baseWhere =
    input.groupId != null
      ? `m.groupId = ? AND m.isActive = 1`
      : `m.userId = ? AND m.groupId IS NULL AND m.isActive = 1`;
  const baseVal = input.groupId != null ? input.groupId : input.userId;

  const extra: string[] = [];
  const extraVals: unknown[] = [];
  if (input.excludeIds.length) {
    extra.push(`m.id NOT IN (${input.excludeIds.map(() => "?").join(",")})`);
    extraVals.push(...input.excludeIds);
  }
  if (input.authorUserId != null) {
    extra.push("m.userId = ?");
    extraVals.push(input.authorUserId);
  }
  if (cFrom) {
    extra.push(`m.createdat::date >= ?`);
    extraVals.push(cFrom);
  }
  if (cTo) {
    extra.push(`m.createdat::date <= ?`);
    extraVals.push(cTo);
  }

  const whereSql = `${baseWhere} AND (${matchSql})${extra.length ? ` AND ${extra.join(" AND ")}` : ""}`;
  const allVals = [baseVal, ...vals, ...extraVals];

  const countSql = `SELECT COUNT(*) AS c FROM memos m WHERE ${whereSql}`;
  const [countRows] = await pool.query<RowDataPacket[]>(countSql, allVals);
  const totalCount = Number(countRows[0]?.c ?? 0) || 0;

  const listSql = `SELECT m.id, m.userId, m.groupId, m.mediaType, m.mediaText, m.mediaWebUrl,
      m.mediaAudioUrl, m.mediaImageUrl, m.mediaVideoUrl, m.mediaDocumentUrl,
      m.createdAt, m.keywords, m.dadosEspecificosJson, m.mediaMetadata, m.apiCost, m.usedApiCred,
      (EXISTS(SELECT 1 FROM memo_chunks mc WHERE mc.memo_id = m.id))::int AS haschunks
    FROM memos m
    WHERE ${whereSql}
    ORDER BY m.createdAt DESC
    LIMIT ?`;
  const [rows] = await pool.query<MemoSearchRow[]>(listSql, [...allVals, SEARCH_LIMIT]);

  const highlightTerms: MemoSearchHighlightTerm[] = [];
  segments.forEach((seg, segIdx) => {
    for (const br of seg.orBranches) {
      const sgPl = getSingularPluralSearchVariants(br);
      const uniq = [...new Set(sgPl.map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(
        0,
        MAX_SG_PL_VARIANTS_PER_BRANCH
      );
      for (const t of uniq) {
        if (t) highlightTerms.push({ term: t, bucket: segIdx });
      }
    }
  });

  const displayLabel = q.length > 140 ? `${q.slice(0, 137)}…` : q;

  return {
    items: rows.map(rowToCard),
    totalCount,
    displayLabel,
    highlightTerms,
  };
}

export async function searchMemosSemantic(input: {
  userId: number;
  isAdmin: boolean;
  groupId: number | null;
  query: string;
  limit?: number;
}): Promise<{ items: MemoRecentCard[]; totalCount: number; displayLabel: string }> {
  const q = input.query.trim();
  if (!q) return { items: [], totalCount: 0, displayLabel: "" };

  if (input.groupId != null) {
    await assertUserWorkspaceGroupAccess(input.userId, input.groupId, input.isAdmin);
  }

  const hits = await searchMemosByEmbedding({
    query: q,
    userId: input.userId,
    groupId: input.groupId,
    limit: input.limit ?? 40,
  });

  if (!hits.length) {
    return { items: [], totalCount: 0, displayLabel: q.length > 140 ? `${q.slice(0, 137)}…` : q };
  }

  const simMap = new Map(hits.map((h) => [h.memoId, h.similarity]));
  const ids = hits.map((h) => h.memoId);
  const ph = ids.map(() => "?").join(",");

  const [rows] = await pool.query<MemoSearchRow[]>(
    `SELECT m.id, m.userid, m.groupid, m.mediatype, m.mediatext, m.mediaweburl,
            m.mediaaudiourl, m.mediaimageurl, m.mediavideourl, m.mediadocumenturl,
            m.createdat, m.keywords, m.dadosespecificosjson, m.mediametadata, m.apicost, m.usedapicred,
            (EXISTS(SELECT 1 FROM memo_chunks mc WHERE mc.memo_id = m.id))::int AS haschunks
     FROM memos m
     WHERE m.id IN (${ph}) AND m.isactive = 1`,
    ids
  );

  const items: MemoRecentCard[] = hits
    .map((h) => {
      const row = rows.find((r) => r.id === h.memoId);
      if (!row) return null;
      return { ...rowToCard(row), similarity: Math.round(h.similarity * 100) / 100 };
    })
    .filter((x): x is MemoRecentCard => x !== null);

  const displayLabel = q.length > 140 ? `${q.slice(0, 137)}…` : q;
  return { items, totalCount: items.length, displayLabel };
}
