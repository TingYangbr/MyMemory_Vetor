import type { ResultSetHeader, RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { config } from "../config.js";
import {
  DEFAULT_DOCUMENT_ROUTING,
  type DocumentPreprocessRule,
  type DocumentRoutingConfig,
} from "./documentRoutingDefaults.js";
import { getCadPipelineEnabled } from "./cadPipelineService.js";

const OPERATION = "memo_document_ia";

function isUnknownColumnErr(err: unknown, col: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; errno?: number; sqlMessage?: string };
  if (e.code !== "42703") return false;
  return String((e as {message?: string}).message ?? "").includes(col);
}

function shallowMerge(base: DocumentRoutingConfig, patch: Partial<DocumentRoutingConfig>): DocumentRoutingConfig {
  return {
    version: typeof patch.version === "number" ? patch.version : base.version,
    preprocess: Array.isArray(patch.preprocess) ? patch.preprocess : base.preprocess,
    providers:
      patch.providers && typeof patch.providers === "object"
        ? { ...base.providers, ...patch.providers }
        : base.providers,
  };
}

function parseJsonRouting(raw: string | null | undefined): Partial<DocumentRoutingConfig> | null {
  if (raw == null || String(raw).trim() === "") return null;
  try {
    const j = JSON.parse(String(raw)) as unknown;
    if (!j || typeof j !== "object") return null;
    return j as Partial<DocumentRoutingConfig>;
  } catch {
    return null;
  }
}

export async function loadDocumentRoutingConfig(): Promise<DocumentRoutingConfig> {
  let cfg: DocumentRoutingConfig;
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT documentRoutingJson FROM ai_config WHERE operation = ? LIMIT 1`,
      [OPERATION]
    );
    const raw = rows[0]?.documentRoutingJson;
    const patch = parseJsonRouting(raw == null ? null : String(raw));
    cfg = patch
      ? shallowMerge(DEFAULT_DOCUMENT_ROUTING, patch)
      : { ...DEFAULT_DOCUMENT_ROUTING, preprocess: [...DEFAULT_DOCUMENT_ROUTING.preprocess] };
  } catch (e) {
    if (isUnknownColumnErr(e, "documentRoutingJson")) {
      cfg = { ...DEFAULT_DOCUMENT_ROUTING, preprocess: [...DEFAULT_DOCUMENT_ROUTING.preprocess] };
    } else {
      throw e;
    }
  }
  const cadEnabled = await getCadPipelineEnabled();
  if (cadEnabled) {
    cfg.preprocess = cfg.preprocess.map((rule) =>
      rule.pipeline === "cad_not_enabled" ? { ...rule, pipeline: "extract_ifc_text" } : rule
    );
  }
  if (config.dwgConverterUrl) {
    cfg.preprocess = cfg.preprocess.map((rule) =>
      rule.pipeline === "dwg_not_supported" ? { ...rule, pipeline: "extract_dwg_text" } : rule
    );
  }
  return cfg;
}

export async function getAdminDocumentRoutingJson(): Promise<{ json: string; usingDefaults: boolean }> {
  const cfg = await loadDocumentRoutingConfig();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT documentRoutingJson FROM ai_config WHERE operation = ? LIMIT 1`,
      [OPERATION]
    );
    const raw = rows[0]?.documentRoutingJson;
    if (raw != null && String(raw).trim() !== "") {
      return { json: String(raw), usingDefaults: false };
    }
  } catch (e) {
    if (!isUnknownColumnErr(e, "documentRoutingJson")) throw e;
  }
  return { json: JSON.stringify(cfg, null, 2), usingDefaults: true };
}

export async function saveAdminDocumentRoutingJson(jsonStr: string): Promise<void> {
  const parsed = JSON.parse(jsonStr) as DocumentRoutingConfig;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.preprocess)) {
    throw new Error("invalid_routing_json");
  }
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE ai_config SET documentRoutingJson = ? WHERE operation = ?`,
    [jsonStr, OPERATION]
  );
  if (res.affectedRows === 0) {
    await pool.query(
      `INSERT INTO ai_config (operation, displayName, provider, model, isEnabled, documentRoutingJson, notes)
       VALUES (?, 'Memo — processamento IA de documento', 'openai', 'gpt-4o-mini', 1, ?, NULL)`,
      [OPERATION, jsonStr]
    );
  }
}

function normExt(ext: string): string {
  const x = ext.toLowerCase();
  return x.startsWith(".") ? x : `.${x}`;
}

/** Critérios no mesmo `match` combinam em OU (ext OU mime OU prefixo). */
function ruleMatches(rule: DocumentPreprocessRule, mime: string, ext: string): boolean {
  const m = mime.toLowerCase();
  const e = normExt(ext);
  const { ext: exts, mime: mimes, mimePrefix } = rule.match;
  const hits: boolean[] = [];
  if (exts?.length) {
    hits.push(exts.map((x) => normExt(x)).includes(e));
  }
  if (mimes?.length) {
    hits.push(mimes.map((x) => x.toLowerCase()).includes(m));
  }
  if (mimePrefix?.length) {
    hits.push(mimePrefix.some((p) => m.startsWith(p.toLowerCase())));
  }
  if (hits.length === 0) return false;
  return hits.some(Boolean);
}

/** Primeira regra que coincide (ordem do array importa). */
export function resolveDocumentPipeline(
  mime: string,
  ext: string,
  routing: DocumentRoutingConfig
): string {
  const e = ext.startsWith(".") ? ext : `.${ext}`;
  for (const rule of routing.preprocess) {
    if (ruleMatches(rule, mime, e)) return rule.pipeline;
  }
  return "unsupported";
}
