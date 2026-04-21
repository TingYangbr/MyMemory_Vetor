import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type {
  MeResponse,
  MemoRecentCard,
  MemoSearchHighlightTerm,
  MemoSearchMode,
  MemoSearchResponse,
  MemoSearchSynonymsResponse,
} from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiGetOptional, apiPostJson } from "../api";
import Header from "../components/Header";
import { MemoFilePreviewModal } from "../components/MemoFilePreviewModal";
import { MemoResultListRow } from "../components/MemoResultListRow";
import recentListStyles from "../components/RecentMemos.module.css";
import { parseKeywordList, parseMemoDadosEspecificosEntries } from "../memo/memoCardDisplayUtils";
import { MemoDadosEspecificosDisplay } from "../memo/MemoDadosEspecificosDisplay";
import { MemoCardPrimaryRow } from "../memo/MemoCardPrimaryRow";
import {
  compareDadosEspecificosValuesForSort,
  computeSearchSuggestions,
  type SearchSuggestionRow,
} from "../search/memoSearchSuggestions";
import styles from "./MemoSearchPage.module.css";

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

const BUSCAR_RESULTS_VIEW_KEY = "mm_buscar_results_view_v1";
const BUSCAR_SNAPSHOT_KEY = "mm_buscar_snap_v1";
const BUSCAR_RESTORE_PENDING_KEY = "mm_buscar_restore_pending";
const SUGGESTION_PANEL_POS_KEY = "mm_buscar_suggestion_panel_pos_v1";

/** Campo de pesquisa: até 2 linhas visíveis; sem quebras reais no termo (Enter = buscar). */
const SEARCH_QUERY_MAX_LINES = 2;

const SILENCE_MS_TEXTUAL = 2500;
const SILENCE_MS_SEMANTIC = 5000;
const PAUSE_TIMEOUT_MS_SEMANTIC = 15000;

function loadSuggestionPanelPos(): { x: number; y: number } | null {
  try {
    const raw = sessionStorage.getItem(SUGGESTION_PANEL_POS_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof j.x === "number" && typeof j.y === "number" && Number.isFinite(j.x) && Number.isFinite(j.y)) {
      return { x: j.x, y: j.y };
    }
  } catch {
    /* */
  }
  return null;
}

/** Alinhado a `.suggestionPanel` (width / max-height em CSS). */
function suggestionPanelDimensions(): { w: number; h: number } {
  const innerW = window.innerWidth;
  const innerH = window.innerHeight;
  return {
    w: Math.min(innerW * 0.96, 56 * 16),
    h: Math.min(innerH * 0.88, 40 * 16),
  };
}

function clampSuggestionPanelPos(
  pos: { x: number; y: number },
  panelW: number,
  panelH: number
): { x: number; y: number } {
  const x = Math.max(8, Math.min(pos.x, window.innerWidth - panelW - 8));
  const y = Math.max(8, Math.min(pos.y, window.innerHeight - panelH - 8));
  return { x, y };
}

function defaultSuggestionPanelPos(): { x: number; y: number } {
  const innerW = window.innerWidth;
  const innerH = window.innerHeight;
  const { w: panelW } = suggestionPanelDimensions();
  const x = Math.max(8, (innerW - panelW) / 2);
  const y = Math.max(72, innerH * 0.06);
  return { x, y };
}

type BuscarSnapshot = {
  query: string;
  logic: "and" | "or";
  filterDateFrom: string;
  filterDateTo: string;
  filterAuthorUserId: number | null;
  searchMode: MemoSearchMode;
  items: MemoRecentCard[];
  totalCount: number;
  displayLabel: string;
  highlightTerms: MemoSearchHighlightTerm[];
  /** Compat legado: snapshots antigos podem trazer só esta flag. */
  synonymsExpanded: boolean;
  /** Query já expandida; usada para liberar botão em pesquisas novas. */
  expandedQueryKey?: string | null;
  noResultsFor: string | null;
};

function persistBuscarSnapshot(s: BuscarSnapshot): void {
  try {
    sessionStorage.setItem(BUSCAR_SNAPSHOT_KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode */
  }
}

function loadBuscarSnapshot(): BuscarSnapshot | null {
  try {
    const raw = sessionStorage.getItem(BUSCAR_SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BuscarSnapshot;
  } catch {
    return null;
  }
}

function coalesceSearchMode(raw: unknown): MemoSearchMode {
  if (raw === "mediaText" || raw === "keywords" || raw === "dadosEspecificos" || raw === "all" || raw === "semantic") return raw;
  return "all";
}

function normalizeSearchQueryKey(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Remove pontuação terminal adicionada automaticamente pelo Web Speech API (ex.: "gato."). */
function stripAsrPunctuation(s: string): string {
  return s.replace(/[.!?,;:]+$/u, "").trim();
}

type SearchAuthorOption = { id: number; name: string | null; email: string | null };

type SearchFilterSnap = {
  createdAtFrom?: string;
  createdAtTo?: string;
  authorUserId?: number | null;
};

function suggestionRowDisplayKey(row: SearchSuggestionRow): string {
  if (row.dadosExample) {
    return `${row.dadosExample.label}: ${row.dadosExample.value}`;
  }
  return row.term;
}

function tieBreakSuggestionCounts(a: SearchSuggestionRow, b: SearchSuggestionRow): number {
  if (b.countTotal !== a.countTotal) return b.countTotal - a.countTotal;
  if (b.countDadosEspecificos !== a.countDadosEspecificos) {
    return b.countDadosEspecificos - a.countDadosEspecificos;
  }
  if (b.countKeywords !== a.countKeywords) return b.countKeywords - a.countKeywords;
  if (b.countMediaText !== a.countMediaText) return b.countMediaText - a.countMediaText;
  return a.lemmaKey.localeCompare(b.lemmaKey);
}

/**
 * Com `dadosExample`, ordena por **label** e depois por **valor** (datas e números BR, não só texto).
 * Sem exemplo de dados, mantém a chave de exibição única (termo ou `label: valor`).
 */
function compareSuggestionRows(
  a: SearchSuggestionRow,
  b: SearchSuggestionRow,
  sort: "alpha" | "relevance"
): number {
  const da = a.dadosExample;
  const db = b.dadosExample;
  if (da && db) {
    const labelCmp = da.label.trim().localeCompare(db.label.trim(), "pt", { sensitivity: "base" });
    const valueCmp =
      labelCmp === 0
        ? compareDadosEspecificosValuesForSort(da.value.trim(), db.value.trim())
        : 0;

    if (sort === "alpha") {
      if (labelCmp !== 0) return labelCmp;
      if (valueCmp !== 0) return valueCmp;
      return tieBreakSuggestionCounts(a, b);
    }
    if (b.countTotal !== a.countTotal) return b.countTotal - a.countTotal;
    if (labelCmp !== 0) return labelCmp;
    if (valueCmp !== 0) return valueCmp;
    return tieBreakSuggestionCounts(a, b);
  }

  const keyA = suggestionRowDisplayKey(a);
  const keyB = suggestionRowDisplayKey(b);
  if (sort === "alpha") {
    const c = keyA.localeCompare(keyB, "pt", { sensitivity: "base" });
    if (c !== 0) return c;
    return tieBreakSuggestionCounts(a, b);
  }
  if (b.countTotal !== a.countTotal) return b.countTotal - a.countTotal;
  const c = keyA.localeCompare(keyB, "pt", { sensitivity: "base" });
  if (c !== 0) return c;
  return tieBreakSuggestionCounts(a, b);
}

type SpeechRecInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult:
    | ((
        ev: {
          resultIndex: number;
          results: { length: number; [i: number]: { isFinal: boolean; [k: number]: { transcript: string } } };
        }
      ) => void)
    | null;
  onerror: ((ev: Event) => void) | null;
  onend: (() => void) | null;
};

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

/** Número de ramos `a OR b OR c` dentro de um trecho (entre vírgulas de topo). */
function orBranchCountInSegment(seg: string): number {
  return stripOuterParens(seg.trim())
    .split(/\s+OR\s+/i)
    .map((x) => x.trim())
    .filter(Boolean).length;
}

/**
 * Índice do trecho a expandir com sinónimos:
 * - Se o 1.º trecho não vazio ainda é um único ramo, expande-o (comportamento original para `a, b`).
 * - Senão, o último trecho não vazio que ainda tem só um ramo (ex.: após `(a OR a1 OR a2), b` → expande `b`).
 */
function pickExpandSegmentIndexFromParts(parts: string[]): number | null {
  const nonEmptyIdx = parts.map((p, i) => (p.trim() ? i : -1)).filter((i) => i >= 0);
  if (!nonEmptyIdx.length) return null;
  const firstIdx = nonEmptyIdx[0]!;
  if (orBranchCountInSegment(parts[firstIdx]!) === 1) return firstIdx;
  for (let k = nonEmptyIdx.length - 1; k >= 0; k--) {
    const i = nonEmptyIdx[k]!;
    if (orBranchCountInSegment(parts[i]!) === 1) return i;
  }
  return null;
}

function mergeSegmentWithOrGroupAt(query: string, segmentIndex: number, orGroup: string): string {
  const parts = splitTopLevelCommas(query);
  if (!parts.length) return orGroup;
  if (segmentIndex < 0 || segmentIndex >= parts.length) return query;
  parts[segmentIndex] = orGroup;
  return parts.join(", ");
}

function extractPrimaryTermAt(parts: string[], segmentIndex: number): string | null {
  const seg = parts[segmentIndex];
  if (!seg) return null;
  const branches = stripOuterParens(seg.trim())
    .split(/\s+OR\s+/i)
    .map((x) => x.trim())
    .filter(Boolean);
  return branches[0] ?? null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, terms: MemoSearchHighlightTerm[]): ReactNode {
  if (!text?.trim() || !terms.length) return text;
  const uniq = new Map<string, number>();
  for (const t of terms) {
    const k = t.term.toLowerCase().trim();
    if (!k) continue;
    uniq.set(k, t.bucket % 3);
  }
  const keys = [...uniq.keys()].sort((a, b) => b.length - a.length);
  if (!keys.length) return text;
  const inner = keys.map(escapeRegExp).join("|");
  /** Realce alinhado à busca no servidor: só palavra inteira (Unicode). */
  const rx = new RegExp(`\\b(?:${inner})\\b`, "giu");
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    const mm = m[0];
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const b = uniq.get(mm.toLowerCase()) ?? 0;
    nodes.push(
      <mark key={`${m.index}-${mm}`} className={styles[`hl${b}` as "hl0" | "hl1" | "hl2"]}>
        {mm}
      </mark>
    );
    last = m.index + mm.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : text;
}

function IconList({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconCards({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconUser({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M4 20v-1a4 4 0 014-4h8a4 4 0 014 4v1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconMic({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M19 10v1a7 7 0 01-14 0v-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 6h18M8 6V4h8v2m-9 4v10a2 2 0 002 2h6a2 2 0 002-2V10" stroke="currentColor" strokeWidth="2" />
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconSpeaker({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M11 5L6 9H3v6h3l5 4V5zM15.54 8.46a5 5 0 010 7.07M17.66 6.34a8 8 0 010 11.32"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPrint({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconExpandSearch({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconBulb({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 18h6M10 22h4M12 3a5 5 0 00-3 9c0 2 1 3 1 3h4s1-1 1-3a5 5 0 00-3-9z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Seta curva para a esquerda (desfazer último trecho). */
function IconUndoTerm({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 14 4 9l5-5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MemoSearchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchId = useId();
  const panelTitleId = useId();
  const searchFormId = useId();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [query, setQuery] = useState("");
  const [logic, setLogic] = useState<"and" | "or">("and");
  const [items, setItems] = useState<MemoRecentCard[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [displayLabel, setDisplayLabel] = useState("");
  const [highlightTerms, setHighlightTerms] = useState<MemoSearchHighlightTerm[]>([]);
  const [expandedQueryKey, setExpandedQueryKey] = useState<string | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [expandBusy, setExpandBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"textual" | "semantic">("textual");
  const [micState, setMicState] = useState<"idle" | "listening" | "paused" | "done">("idle");
  const [showTimeoutPopup, setShowTimeoutPopup] = useState(false);
  const [listeningMode, setListeningMode] = useState<"nova" | "mais" | null>(null);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MemoRecentCard | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  /** Texto da última pesquisa com 0 resultados (para mensagem amigável). */
  const [noResultsFor, setNoResultsFor] = useState<string | null>(null);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAuthorUserId, setFilterAuthorUserId] = useState<number | null>(null);
  const [filterModal, setFilterModal] = useState<null | "quando" | "quem">(null);
  const [draftDateFrom, setDraftDateFrom] = useState("");
  const [draftDateTo, setDraftDateTo] = useState("");
  const [draftAuthorId, setDraftAuthorId] = useState<number | null>(null);
  const [authorOptions, setAuthorOptions] = useState<SearchAuthorOption[]>([]);
  const [suggestionModalOpen, setSuggestionModalOpen] = useState(false);
  const [suggestionPanelPos, setSuggestionPanelPos] = useState<{ x: number; y: number } | null>(() =>
    loadSuggestionPanelPos()
  );
  const [suggestionSort, setSuggestionSort] = useState<"alpha" | "relevance">("relevance");
  const [suggestionViewMode, setSuggestionViewMode] = useState<MemoSearchMode>("all");
  const [searchMode, setSearchMode] = useState<MemoSearchMode>("all");
  const suggestionDialogTitleId = useId();
  const suggestionPanelRef = useRef<HTMLDivElement | null>(null);
  const suggestionPosRef = useRef<{ x: number; y: number } | null>(null);
  const searchQueryRef = useRef<HTMLTextAreaElement | null>(null);

  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabRef = useRef<"textual" | "semantic">("textual");
  const lastFinalIdxRef = useRef(-1);
  /** Incrementa a cada sessão de voz; 0 = inactivo. Evita onend/onerror deixarem UI presa em “Ouvindo…”. */
  const voiceSessionRef = useRef(0);
  const voiceTranscriptRef = useRef("");
  const voiceHadResultRef = useRef(false);
  const runSearchRef = useRef<
    (q?: string, snap?: SearchFilterSnap, forcedSearchMode?: MemoSearchMode) => Promise<void>
  >(async () => {});

  activeTabRef.current = activeTab;
  const workspaceGroupId = me?.lastWorkspaceGroupId ?? null;
  const currentUserId = me?.id ?? null;
  const showApiCost = me?.showApiCost !== false;
  const isPersonalWorkspace = workspaceGroupId == null;
  const returnTo = useMemo(
    () => `${location.pathname}${location.search || ""}` || "/buscar",
    [location.pathname, location.search]
  );

  const [resultsViewMode, setResultsViewMode] = useState<"list" | "cards">(() => {
    try {
      return localStorage.getItem(BUSCAR_RESULTS_VIEW_KEY) === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });
  const [previewMemo, setPreviewMemo] = useState<MemoRecentCard | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(BUSCAR_RESULTS_VIEW_KEY, resultsViewMode);
    } catch {
      /* */
    }
  }, [resultsViewMode]);

  useEffect(() => {
    if (!previewMemo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewMemo(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewMemo]);

  /** Contexto pessoal: um só utilizador — filtro «Quem» não aplica. */
  useEffect(() => {
    if (!isPersonalWorkspace) return;
    setFilterAuthorUserId((id) => (id != null ? null : id));
    setDraftAuthorId((id) => (id != null ? null : id));
    setFilterModal((m) => (m === "quem" ? null : m));
  }, [isPersonalWorkspace]);

  useLayoutEffect(() => {
    suggestionPosRef.current = suggestionPanelPos;
  }, [suggestionPanelPos]);

  const syncSearchQueryHeight = useCallback(() => {
    const el = searchQueryRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    const fontSize = parseFloat(cs.fontSize);
    const lineHeight = Number.isFinite(lh) && lh > 0 ? lh : (Number.isFinite(fontSize) ? fontSize * 1.45 : 22);
    const maxH = lineHeight * SEARCH_QUERY_MAX_LINES;
    el.style.height = "auto";
    const sh = el.scrollHeight;
    el.style.height = `${Math.min(sh, maxH)}px`;
    el.style.overflowY = sh > maxH ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    syncSearchQueryHeight();
  }, [query, syncSearchQueryHeight]);

  useEffect(() => {
    const el = searchQueryRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncSearchQueryHeight());
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncSearchQueryHeight]);

  const handleSuggestionPanelDragStart = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button,a,input,textarea,select")) return;
    e.preventDefault();
    const cur = suggestionPosRef.current;
    if (!cur) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = cur.x;
    const origY = cur.y;

    const onMove = (ev: MouseEvent) => {
      const nx = origX + ev.clientX - startX;
      const ny = origY + ev.clientY - startY;
      const el = suggestionPanelRef.current;
      const pw = el?.offsetWidth ?? 640;
      const ph = el?.offsetHeight ?? 420;
      const clampedX = Math.max(8, Math.min(nx, window.innerWidth - pw - 8));
      const clampedY = Math.max(8, Math.min(ny, window.innerHeight - ph - 8));
      const next = { x: clampedX, y: clampedY };
      suggestionPosRef.current = next;
      setSuggestionPanelPos(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        const p = suggestionPosRef.current;
        if (p) sessionStorage.setItem(SUGGESTION_PANEL_POS_KEY, JSON.stringify(p));
      } catch {
        /* */
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  useEffect(() => {
    if (!suggestionModalOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setSuggestionModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [suggestionModalOpen]);

  /** Posição guardada pode ser de um ecrã largo; após pintar, mede o painel e mantém-no visível. */
  useLayoutEffect(() => {
    if (!suggestionModalOpen) return;
    const el = suggestionPanelRef.current;
    const { w: estW, h: estH } = suggestionPanelDimensions();
    const pw = el?.offsetWidth ?? estW;
    const ph = el?.offsetHeight ?? estH;
    setSuggestionPanelPos((p) => clampSuggestionPanelPos(p ?? defaultSuggestionPanelPos(), pw, ph));
  }, [suggestionModalOpen]);

  useEffect(() => {
    if (!suggestionModalOpen) return;
    const onResize = () => {
      const el = suggestionPanelRef.current;
      const { w: estW, h: estH } = suggestionPanelDimensions();
      const pw = el?.offsetWidth ?? estW;
      const ph = el?.offsetHeight ?? estH;
      setSuggestionPanelPos((p) => {
        if (!p) return clampSuggestionPanelPos(defaultSuggestionPanelPos(), pw, ph);
        return clampSuggestionPanelPos(p, pw, ph);
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [suggestionModalOpen]);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (r.ok) setMe(r.data);
      else if (r.status === 401) navigate("/login", { replace: true });
    });
  }, [navigate]);

  /** Não exige `me`: o grupo vem de `me` quando disponível; a sessão basta para a API. */
  useEffect(() => {
    let cancelled = false;
    const q = workspaceGroupId != null ? `?groupId=${workspaceGroupId}` : "";
    apiGet<{ authors: SearchAuthorOption[] }>(`/api/memos/search/authors${q}`)
      .then((r) => {
        if (!cancelled) setAuthorOptions(Array.isArray(r.authors) ? r.authors : []);
      })
      .catch(() => {
        if (!cancelled) setAuthorOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceGroupId]);

  /** Voltar da edição (Cancelar): repõe lista e filtros a partir do snapshot em sessionStorage. */
  useLayoutEffect(() => {
    if (location.pathname !== "/buscar") return;
    let pending = false;
    try {
      pending = sessionStorage.getItem(BUSCAR_RESTORE_PENDING_KEY) === "1";
    } catch {
      /* */
    }
    if (!pending) return;
    try {
      sessionStorage.removeItem(BUSCAR_RESTORE_PENDING_KEY);
    } catch {
      /* */
    }
    const snap = loadBuscarSnapshot();
    if (!snap || typeof snap.query !== "string") return;
    setQuery(snap.query);
    setLogic(snap.logic === "or" ? "or" : "and");
    setFilterDateFrom(typeof snap.filterDateFrom === "string" ? snap.filterDateFrom : "");
    setFilterDateTo(typeof snap.filterDateTo === "string" ? snap.filterDateTo : "");
    setFilterAuthorUserId(
      typeof snap.filterAuthorUserId === "number" && Number.isFinite(snap.filterAuthorUserId)
        ? snap.filterAuthorUserId
        : null
    );
    setItems(Array.isArray(snap.items) ? snap.items : []);
    setTotalCount(typeof snap.totalCount === "number" ? snap.totalCount : 0);
    setDisplayLabel(typeof snap.displayLabel === "string" ? snap.displayLabel : "");
    setHighlightTerms(Array.isArray(snap.highlightTerms) ? snap.highlightTerms : []);
    const restoredExpandedKey =
      typeof snap.expandedQueryKey === "string"
        ? snap.expandedQueryKey
        : snap.synonymsExpanded
          ? normalizeSearchQueryKey(snap.query)
          : null;
    setExpandedQueryKey(restoredExpandedKey);
    setNoResultsFor(
      snap.noResultsFor === null || typeof snap.noResultsFor === "string" ? snap.noResultsFor : null
    );
    setSearchMode(coalesceSearchMode((snap as { searchMode?: unknown }).searchMode));
    setError(null);
  }, [location.pathname]);

  const stopListening = useCallback((toMicState: "idle" | "done" = "idle") => {
    voiceSessionRef.current = 0;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
      pauseTimeoutRef.current = null;
    }
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    try {
      rec?.stop?.();
    } catch {
      /* já parado */
    }
    setListeningMode(null);
    setMicState(toMicState);
  }, []);

  const resetSilenceTimer = useCallback(
    (sessionId: number) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      const delay = activeTabRef.current === "semantic" ? SILENCE_MS_SEMANTIC : SILENCE_MS_TEXTUAL;
      silenceTimerRef.current = setTimeout(() => {
        silenceTimerRef.current = null;
        if (voiceSessionRef.current !== sessionId) return;
        const qV = voiceTranscriptRef.current.trim();
        const had = voiceHadResultRef.current;
        stopListening("done");
        if (had && qV) {
          queueMicrotask(() => void runSearchRef.current(qV, undefined, activeTabRef.current === "semantic" ? "semantic" : "all"));
        }
      }, delay);
    },
    [stopListening]
  );

  const startListening = useCallback(
    (mode: "nova" | "mais") => {
      const SR =
        (window as unknown as { SpeechRecognition?: new () => SpeechRecInstance }).SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecInstance }).webkitSpeechRecognition;
      if (!SR) {
        setError("Voz não disponível neste navegador. Use Chrome ou Edge atualizados.");
        return;
      }

      setError(null);
      stopListening();
      lastFinalIdxRef.current = -1;
      voiceHadResultRef.current = false;
      if (mode === "mais") {
        voiceTranscriptRef.current = query.trim();
      } else {
        voiceTranscriptRef.current = "";
      }
      const sessionId = ++voiceSessionRef.current;

      let rec: SpeechRecInstance;
      try {
        rec = new SR();
      } catch {
        voiceSessionRef.current = 0;
        setError("Não foi possível iniciar o reconhecimento de voz.");
        return;
      }

      rec.lang = "pt-BR";
      rec.continuous = activeTabRef.current === "semantic";
      rec.interimResults = true;

      rec.onresult = (ev: {
        resultIndex: number;
        results: { length: number; [i: number]: { isFinal: boolean; [k: number]: { transcript: string } } };
      }) => {
        if (voiceSessionRef.current !== sessionId) return;
        if (mode === "nova") {
          let display = "";
          for (let i = 0; i < ev.results.length; i++) {
            display += ev.results[i]![0]!.transcript;
          }
          const t = stripAsrPunctuation(display);
          if (t) {
            voiceTranscriptRef.current = t;
            voiceHadResultRef.current = true;
            setExpandedQueryKey(null);
            setQuery(t);
          }
        } else {
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const line = ev.results[i]!;
            if (!line.isFinal) continue;
            if (i <= lastFinalIdxRef.current) continue;
            lastFinalIdxRef.current = i;
            const chunk = stripAsrPunctuation(line[0]!.transcript);
            if (!chunk) continue;
            setExpandedQueryKey(null);
            setQuery((q0) => {
              const base = q0.trim();
              const next = !base ? chunk : `${base}, ${chunk}`;
              voiceTranscriptRef.current = next;
              voiceHadResultRef.current = true;
              return next;
            });
          }
        }
        resetSilenceTimer(sessionId);
      };

      rec.onerror = (ev: Event) => {
        const code = (ev as Event & { error?: string }).error ?? "";
        if (voiceSessionRef.current !== sessionId) return;
        const map: Record<string, string> = {
          "not-allowed": "Microfone bloqueado ou negado. Permita o acesso nas configurações do navegador (ícone do cadeado na barra de endereço).",
          "no-speech": "Não foi detetada fala. Tente de novo, mais perto do microfone.",
          aborted: "",
          network: "Erro de rede no reconhecimento de voz.",
          "service-not-allowed": "Serviço de voz não disponível (verifique permissões do sistema).",
        };
        const msg = map[code];
        if (msg) setError(msg);
        else if (code && code !== "aborted") setError(`Voz: ${code}`);
        stopListening();
      };

      rec.onend = () => {
        if (voiceSessionRef.current !== sessionId) return;
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        recognitionRef.current = null;
        voiceSessionRef.current = 0;
        setListeningMode(null);
        setMicState("done");
        const qV = voiceTranscriptRef.current.trim();
        const had = voiceHadResultRef.current;
        if (had && qV) {
          const mode = activeTabRef.current === "semantic" ? "semantic" : "all";
          queueMicrotask(() => void runSearchRef.current(qV, undefined, mode));
        }
      };

      recognitionRef.current = rec;
      setListeningMode(mode);
      setMicState("listening");
      try {
        rec.start();
        // Não inicia o timer aqui — começa apenas quando voz é detectada (onresult)
      } catch {
        voiceSessionRef.current = 0;
        recognitionRef.current = null;
        setListeningMode(null);
        setMicState("idle");
        setError("Não foi possível iniciar o microfone.");
      }
    },
    [resetSilenceTimer, stopListening, query]
  );

  const pauseMic = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    voiceSessionRef.current = 0;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    try { rec?.stop?.(); } catch { /* */ }
    setListeningMode(null);
    setMicState("paused");

    if (activeTabRef.current === "semantic") {
      if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
      pauseTimeoutRef.current = setTimeout(() => {
        pauseTimeoutRef.current = null;
        setMicState("done");
        setShowTimeoutPopup(true);
      }, PAUSE_TIMEOUT_MS_SEMANTIC);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
      voiceSessionRef.current = 0;
      try {
        recognitionRef.current?.stop();
      } catch {
        /* */
      }
      recognitionRef.current = null;
    };
  }, []);

  const runSearch = useCallback(
    async (queryOverride?: string, snap?: SearchFilterSnap, forcedSearchMode?: MemoSearchMode) => {
      const raw = (queryOverride !== undefined ? queryOverride : query).trim();
      if (!raw) return;
      if (queryOverride !== undefined) setQuery(raw);
      const modeForRequest = forcedSearchMode ?? searchMode;
      if (forcedSearchMode !== undefined) setSearchMode(forcedSearchMode);
      const cFrom = snap?.createdAtFrom !== undefined ? snap.createdAtFrom : filterDateFrom;
      const cTo = snap?.createdAtTo !== undefined ? snap.createdAtTo : filterDateTo;
      const author = snap?.authorUserId !== undefined ? snap.authorUserId : filterAuthorUserId;
      setItems([]);
      setTotalCount(0);
      setDisplayLabel("");
      setHighlightTerms([]);
      setSearchBusy(true);
      setError(null);
      setNoResultsFor(null);
      setExpandedQueryKey(null);
      if (ttsBusy) {
        window.speechSynthesis?.cancel();
        setTtsBusy(false);
      }
      try {
        let body: MemoSearchResponse;
        if (modeForRequest === "semantic") {
          const sem = await apiPostJson<{ items: MemoRecentCard[]; totalCount: number; displayLabel: string }>(
            "/api/memos/search/semantic",
            { query: raw, groupId: workspaceGroupId }
          );
          body = { items: sem.items, totalCount: sem.totalCount, displayLabel: sem.displayLabel, highlightTerms: [] };
        } else {
          body = await apiPostJson<MemoSearchResponse>("/api/memos/search", {
            query: raw,
            logic,
            groupId: workspaceGroupId,
            excludeIds: [],
            createdAtFrom: cFrom ? cFrom : null,
            createdAtTo: cTo ? cTo : null,
            authorUserId: author,
            searchMode: modeForRequest,
          });
        }
        setItems(body.items);
        setTotalCount(body.totalCount);
        setDisplayLabel(body.displayLabel);
        setHighlightTerms(body.highlightTerms);
        const nr = body.totalCount === 0 ? (body.displayLabel || raw) : null;
        if (body.totalCount === 0) {
          setNoResultsFor(body.displayLabel || raw);
        }
        persistBuscarSnapshot({
          query: raw,
          logic,
          filterDateFrom: cFrom ?? "",
          filterDateTo: cTo ?? "",
          filterAuthorUserId: author ?? null,
          searchMode: modeForRequest,
          items: body.items,
          totalCount: body.totalCount,
          displayLabel: body.displayLabel,
          highlightTerms: body.highlightTerms,
          synonymsExpanded: false,
          expandedQueryKey: null,
          noResultsFor: nr,
        });
      } catch (e) {
        let msg = e instanceof Error ? e.message : "Falha na busca.";
        if (msg.length > 260) msg = `${msg.slice(0, 257)}…`;
        setError(msg);
        setItems([]);
        setTotalCount(0);
        setDisplayLabel("");
        setHighlightTerms([]);
        setNoResultsFor(null);
      } finally {
        setSearchBusy(false);
      }
    },
    [query, logic, workspaceGroupId, filterDateFrom, filterDateTo, filterAuthorUserId, searchMode, ttsBusy]
  );

  runSearchRef.current = runSearch;

  const suggestionRows = useMemo(
    () => computeSearchSuggestions(items, query, highlightTerms),
    [items, query, highlightTerms]
  );

  const scopedSuggestionRows = useMemo(() => {
    if (suggestionViewMode === "all") return suggestionRows;
    if (suggestionViewMode === "mediaText") {
      return suggestionRows
        .filter((row) => row.countMediaText > 0)
        .map((row) => ({
          ...row,
          countKeywords: 0,
          countDadosEspecificos: 0,
          countTotal: row.countMediaText,
        }));
    }
    if (suggestionViewMode === "keywords") {
      return suggestionRows
        .filter((row) => row.countKeywords > 0)
        .map((row) => ({
          ...row,
          countMediaText: 0,
          countDadosEspecificos: 0,
          countTotal: row.countKeywords,
        }));
    }
    return suggestionRows
      .filter((row) => row.countDadosEspecificos > 0)
      .map((row) => ({
        ...row,
        countMediaText: 0,
        countKeywords: 0,
        countTotal: row.countDadosEspecificos,
      }));
  }, [suggestionRows, suggestionViewMode]);

  const sortedSuggestionRows = useMemo(() => {
    const r = [...scopedSuggestionRows];
    r.sort((a, b) => compareSuggestionRows(a, b, suggestionSort));
    return r;
  }, [scopedSuggestionRows, suggestionSort]);

  const querySegmentCount = useMemo(() => splitTopLevelCommas(query.trim()).length, [query]);

  const applySuggestionTermSelection = useCallback(
    (row: SearchSuggestionRow) => {
      const t = row.term.trim();
      if (!t) return;
      const base = query.trim();
      const next = base ? `${base}, ${t}` : t;
      setQuery(next);
      setSuggestionModalOpen(false);
      queueMicrotask(() => void runSearchRef.current(next));
    },
    [query]
  );

  const undoLastSearchTerm = useCallback(() => {
    const trimmed = query.trim();
    const parts = splitTopLevelCommas(trimmed);
    if (parts.length <= 1) return;
    parts.pop();
    const next = parts.join(", ").trim();
    if (!next) return;
    setQuery(next);
    queueMicrotask(() => void runSearchRef.current(next));
  }, [query]);

  const handleExpandSearch = useCallback(async () => {
    const parts = splitTopLevelCommas(query.trim());
    const segIdx = pickExpandSegmentIndexFromParts(parts);
    const primary = segIdx != null ? extractPrimaryTermAt(parts, segIdx) : null;
    if (segIdx == null || !primary) return;
    setExpandBusy(true);
    setError(null);
    setNoResultsFor(null);
    try {
      const syn = await apiPostJson<MemoSearchSynonymsResponse>("/api/memos/search/synonyms", {
        term: primary,
      });
      if (syn.unavailable) {
        setError("Sinónimos indisponíveis (configure a API LLM ou OpenAI).");
        setExpandBusy(false);
        return;
      }
      const mergedQuery = mergeSegmentWithOrGroupAt(query, segIdx, syn.suggestedQuery);
      setQuery(mergedQuery);
      const excludeIds = items.map((x) => x.id);
      const body = await apiPostJson<MemoSearchResponse>("/api/memos/search", {
        query: mergedQuery,
        logic,
        groupId: workspaceGroupId,
        excludeIds,
        createdAtFrom: filterDateFrom ? filterDateFrom : null,
        createdAtTo: filterDateTo ? filterDateTo : null,
        authorUserId: filterAuthorUserId,
        searchMode,
      });
      const existing = new Set(items.map((x) => x.id));
      const extra = body.items.filter((x) => !existing.has(x.id));
      const mergedItems = [...items, ...extra];
      setItems(mergedItems);
      /** Com `excludeIds`, `body.totalCount` é só memos *além* dos já listados; 0 não significa lista vazia. */
      const combinedTotal = items.length + body.totalCount;
      const displayTotal = Math.max(mergedItems.length, combinedTotal);
      setTotalCount(displayTotal);
      setDisplayLabel(body.displayLabel);
      setHighlightTerms(body.highlightTerms);
      const mergedQueryKey = normalizeSearchQueryKey(mergedQuery);
      setExpandedQueryKey(mergedQueryKey);
      const nr = mergedItems.length === 0 ? (body.displayLabel || mergedQuery) : null;
      if (mergedItems.length === 0) {
        setNoResultsFor(body.displayLabel || mergedQuery);
      } else {
        setNoResultsFor(null);
      }
      persistBuscarSnapshot({
        query: mergedQuery,
        logic,
        filterDateFrom,
        filterDateTo,
        filterAuthorUserId,
        searchMode,
        items: mergedItems,
        totalCount: displayTotal,
        displayLabel: body.displayLabel,
        highlightTerms: body.highlightTerms,
        synonymsExpanded: true,
        expandedQueryKey: mergedQueryKey,
        noResultsFor: nr,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível expandir a busca.");
    } finally {
      setExpandBusy(false);
    }
  }, [query, items, logic, workspaceGroupId, filterDateFrom, filterDateTo, filterAuthorUserId, searchMode]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeletingId(id);
    setError(null);
    try {
      await apiDeleteJson(`/api/memos/${id}`);
      setDeleteTarget(null);
      setItems((prev) => {
        const next = prev.filter((x) => x.id !== id);
        const snap = loadBuscarSnapshot();
        if (snap) {
          persistBuscarSnapshot({
            ...snap,
            searchMode: coalesceSearchMode((snap as { searchMode?: unknown }).searchMode),
            items: next,
            totalCount: Math.max(0, snap.totalCount - 1),
          });
        }
        return next;
      });
      setTotalCount((n) => Math.max(0, n - 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível excluir.");
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSpeakResults() {
    if (typeof window.speechSynthesis === "undefined") return;
    if (ttsBusy) {
      window.speechSynthesis.cancel();
      setTtsBusy(false);
      return;
    }
    if (!items.length) return;
    window.speechSynthesis.cancel();
    setTtsBusy(true);
    const texts = items.map((m, i) => `Memo ${i + 1}. ${m.mediaText || m.headline || ""}`);
    let idx = 0;
    function next() {
      if (idx >= texts.length) {
        setTtsBusy(false);
        return;
      }
      const u = new SpeechSynthesisUtterance(texts[idx]);
      u.lang = "pt-BR";
      u.onend = () => {
        idx++;
        next();
      };
      u.onerror = () => {
        setTtsBusy(false);
      };
      window.speechSynthesis.speak(u);
    }
    next();
  }

  const queryPartsForExpand = useMemo(() => splitTopLevelCommas(query.trim()), [query]);
  const expandSegmentIdx = useMemo(
    () => pickExpandSegmentIndexFromParts(queryPartsForExpand),
    [queryPartsForExpand]
  );
  const expandPrimaryTerm =
    expandSegmentIdx != null ? extractPrimaryTermAt(queryPartsForExpand, expandSegmentIdx) : null;
  const showBuscaExpandida =
    (!expandedQueryKey || expandedQueryKey !== normalizeSearchQueryKey(query)) &&
    expandSegmentIdx != null &&
    Boolean(expandPrimaryTerm);

  const quandoAtivo = Boolean(filterDateFrom || filterDateTo);
  const quemAtivo = filterAuthorUserId != null;
  const authorLabel =
    filterAuthorUserId != null
      ? authorOptions.find((a) => a.id === filterAuthorUserId)?.name ||
        authorOptions.find((a) => a.id === filterAuthorUserId)?.email ||
        `#${filterAuthorUserId}`
      : "";

  function formatYmdBR(ymd: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y}`;
  }

  const quandoTitle = quandoAtivo
    ? `Período: ${
        filterDateFrom && filterDateTo
          ? `${formatYmdBR(filterDateFrom)} – ${formatYmdBR(filterDateTo)}`
          : filterDateFrom
            ? `desde ${formatYmdBR(filterDateFrom)}`
            : `até ${formatYmdBR(filterDateTo)}`
      } · clique para consultar ou alterar`
    : "Filtrar por data de registo · clique para definir";

  const quemTitle = quemAtivo
    ? `Autor: ${authorLabel} · clique para consultar ou alterar`
    : "Filtrar por quem criou o memo · clique para definir";

  function applyQuandoFiltro() {
    setFilterDateFrom(draftDateFrom);
    setFilterDateTo(draftDateTo);
    setFilterModal(null);
    void runSearchRef.current(undefined, { createdAtFrom: draftDateFrom, createdAtTo: draftDateTo });
  }

  function limparQuandoFiltro() {
    setDraftDateFrom("");
    setDraftDateTo("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterModal(null);
    void runSearchRef.current(undefined, { createdAtFrom: "", createdAtTo: "" });
  }

  function applyQuemFiltro() {
    setFilterAuthorUserId(draftAuthorId);
    setFilterModal(null);
    void runSearchRef.current(undefined, { authorUserId: draftAuthorId });
  }

  function limparQuemFiltro() {
    setDraftAuthorId(null);
    setFilterAuthorUserId(null);
    setFilterModal(null);
    void runSearchRef.current(undefined, { authorUserId: null });
  }

  const openSuggestionPos = suggestionModalOpen
    ? (suggestionPanelPos ?? defaultSuggestionPanelPos())
    : null;

  return (
    <div className={styles.shell}>
      <Header />
      <main className={styles.main}>
        <section className={`mm-panel ${styles.unifiedCard}`} aria-labelledby={panelTitleId}>
          <p className={styles.visuallyHidden} id={searchFormId}>
            Vírgulas separam trechos de pesquisa. E ou OU aplica-se entre trechos. Nova e Mais usam voz em português.
          </p>
          <div className={styles.searchBlock}>
            <div className={styles.topBar}>
              <h2 id={panelTitleId} className={styles.panelTitle}>
                Buscar Memo
              </h2>
              <div className={styles.filterPills}>
                <button
                  type="button"
                  className={`${styles.filterPill} ${quandoAtivo ? styles.filterPillOn : styles.filterPillOff}`}
                  title={quandoTitle}
                  onClick={() => {
                    setDraftDateFrom(filterDateFrom);
                    setDraftDateTo(filterDateTo);
                    setFilterModal("quando");
                  }}
                >
                  <IconCalendar className={styles.filterPillIcon} aria-hidden />
                  <span className={styles.filterPillLabel}>Quando</span>
                </button>
                {!isPersonalWorkspace ? (
                  <button
                    type="button"
                    className={`${styles.filterPill} ${quemAtivo ? styles.filterPillOn : styles.filterPillOff}`}
                    title={quemTitle}
                    onClick={() => {
                      setDraftAuthorId(filterAuthorUserId);
                      setFilterModal("quem");
                    }}
                  >
                    <IconUser className={styles.filterPillIcon} aria-hidden />
                    <span className={styles.filterPillLabel}>Quem</span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className={styles.modeSwitcher} role="tablist" aria-label="Modo de busca">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "textual"}
                className={`${styles.modeSwitcherBtn} ${activeTab === "textual" ? styles.modeSwitcherTextualOn : ""}`}
                onClick={() => { setActiveTab("textual"); setMicState("idle"); setShowTimeoutPopup(false); }}
              >
                <span className={styles.modeSwitcherIcon} aria-hidden>🔤</span>
                Busca por Texto
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "semantic"}
                className={`${styles.modeSwitcherBtn} ${activeTab === "semantic" ? styles.modeSwitcherSemanticOn : ""}`}
                onClick={() => { setActiveTab("semantic"); setMicState("idle"); setShowTimeoutPopup(false); }}
              >
                <span className={styles.modeSwitcherIcon} aria-hidden>⊛</span>
                Busca Semântica
              </button>
            </div>

            <div className={styles.searchRow}>
              <div
                className={styles.searchFieldWrap}
                style={{
                  borderWidth: micState === "listening" || micState === "paused" ? "1.5px" : undefined,
                  borderColor:
                    micState === "paused" ? "#BA7517" :
                    micState === "listening" ? (activeTab === "semantic" ? "#7F77DD" : "#1D9E75") :
                    undefined,
                }}
              >
                <button
                  type="button"
                  className={styles.searchIconBtn}
                  aria-label={searchBusy ? "A buscar…" : "Buscar"}
                  disabled={searchBusy || !query.trim()}
                  onClick={() => void runSearch(undefined, undefined, activeTab === "semantic" ? "semantic" : "all")}
                >
                  <IconSearch className={styles.searchIcon} />
                </button>
                <textarea
                  ref={searchQueryRef}
                  id={searchId}
                  className={styles.searchInput}
                  name="q"
                  rows={1}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={activeTab === "semantic" ? "Descreva o que você quer encontrar…" : "Digite para buscar…"}
                  value={query}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\r\n|\r|\n/g, " ");
                    setQuery(v);
                    setNoResultsFor(null);
                    setExpandedQueryKey(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void runSearch(undefined, undefined, activeTab === "semantic" ? "semantic" : "all");
                    }
                  }}
                  aria-describedby={searchFormId}
                  aria-label="Termo de pesquisa"
                />
              </div>
              <button
                type="button"
                className={styles.undoTermBtn}
                title={activeTab === "semantic" ? "Limpar campo de busca" : "Desfazer último trecho (última vírgula) e voltar a buscar"}
                aria-label={activeTab === "semantic" ? "Limpar campo de busca" : "Desfazer último trecho da pesquisa"}
                disabled={activeTab === "semantic" ? (!query.trim() || searchBusy) : (querySegmentCount <= 1 || searchBusy || !query.trim())}
                onClick={() => activeTab === "semantic" ? (setQuery(""), setMicState("idle")) : undoLastSearchTerm()}
              >
                <IconUndoTerm className={styles.undoTermIcon} />
              </button>
              {activeTab === "textual" ? (
              <div className={styles.logicGroup} role="group" aria-label="Operador entre trechos separados por vírgula">
                <button
                  type="button"
                  className={styles.logicBtn}
                  title="Selecione E para restrigir a busca ou OU para acrescentar a busca com proximo ou útimo texto"
                  aria-label="Selecione E para restrigir a busca ou OU para acrescentar a busca com proximo ou útimo texto"
                  aria-pressed={logic === "and"}
                  onClick={() => setLogic("and")}
                >
                  E
                </button>
                <button
                  type="button"
                  className={styles.logicBtn}
                  title="Selecione E para restrigir a busca ou OU para acrescentar a busca com proximo ou útimo texto"
                  aria-label="Selecione E para restrigir a busca ou OU para acrescentar a busca com proximo ou útimo texto"
                  aria-pressed={logic === "or"}
                  onClick={() => setLogic("or")}
                >
                  OU
                </button>
              </div>
              ) : null}
            </div>

            {/* State badge */}
            <div className={styles.micStateBadge} data-state={micState}>
              {micState === "idle" && <span>Pronto para ouvir</span>}
              {micState === "listening" && <span>Ouvindo…</span>}
              {micState === "paused" && <span>Pausado</span>}
              {micState === "done" && <span>Pronto para buscar</span>}
            </div>

            <div className={styles.voiceRowBelow}>
              {/* Botão Nova (ambos os modos) */}
              <button
                type="button"
                className={`${styles.voiceBtn} ${
                  micState === "listening"
                    ? styles.voiceBtnListening
                    : micState === "paused"
                      ? styles.voiceBtnPaused
                      : activeTab === "semantic"
                        ? styles.voiceBtnSemantic
                        : styles.voiceBtnNova
                }`}
                title={
                  micState === "idle" || micState === "done" ? "Iniciar nova gravação" :
                  micState === "listening" ? "Pausar gravação" :
                  "Retomar gravação"
                }
                onClick={() => {
                  if (micState === "done" || micState === "idle") {
                    if (micState === "done") { setQuery(""); setMicState("idle"); }
                    else startListening("nova");
                  } else if (micState === "listening") {
                    pauseMic();
                  } else {
                    if (pauseTimeoutRef.current) { clearTimeout(pauseTimeoutRef.current); pauseTimeoutRef.current = null; }
                    startListening("nova");
                  }
                }}
              >
                <IconMic />
                {micState === "idle" || micState === "done" ? "Nova" : micState === "listening" ? "Pausar" : "Retomar"}
              </button>

              {/* + Mais — só textual */}
              {activeTab === "textual" ? (
                <button
                  type="button"
                  className={`${styles.voiceBtn} ${listeningMode === "mais" ? styles.voiceBtnListening : styles.voiceBtnMais}`}
                  title="Acrescentar texto por voz à pesquisa"
                  onClick={() => (listeningMode === "mais" ? pauseMic() : startListening("mais"))}
                >
                  <IconMic />
                  + Mais
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.voiceBtn} ${styles.voiceBtnDisabled}`}
                  disabled
                  title="Não disponível no modo semântico"
                >
                  <IconMic />
                  + Mais
                </button>
              )}

              {/* Finalizar narrativa — só semântico, visível em listening/paused */}
              {activeTab === "semantic" && (micState === "listening" || micState === "paused") ? (
                <button
                  type="button"
                  className={`${styles.voiceBtn} ${styles.voiceBtnFinalizarNarrativa}`}
                  title="Finalizar narrativa e buscar imediatamente"
                  onClick={() => {
                    const qV = voiceTranscriptRef.current.trim() || query.trim();
                    stopListening("done");
                    if (qV) void runSearchRef.current(qV, undefined, "semantic");
                  }}
                >
                  Finalizar narrativa
                </button>
              ) : null}

              {/* Buscar — só semântico, após finalizar via botão */}
              {activeTab === "semantic" && micState === "done" && query.trim() ? (
                <button
                  type="button"
                  className={`${styles.voiceBtn} ${styles.voiceBtnBuscarSemantic}`}
                  disabled={searchBusy}
                  title="Executar busca semântica"
                  onClick={() => void runSearch(undefined, undefined, "semantic")}
                >
                  {searchBusy ? "Buscando…" : "Buscar"}
                </button>
              ) : null}
            </div>

            <div className={styles.secondaryRow}>
              <button
                type="button"
                className={`${styles.secondaryBtn} ${styles.btnSugestao}`}
                aria-label="Visualizar os textos relacionados aos memos pesquisados com número de ocorrências."
                disabled={items.length === 0 || searchBusy || activeTab === "semantic"}
                title={activeTab === "semantic" ? "Não disponível no modo semântico" : "Visualizar os textos relacionados aos memos pesquisados com número de ocorrências."}
                onClick={() => {
                  setSuggestionSort("relevance");
                  setSuggestionViewMode("all");
                  const raw = suggestionPanelPos ?? loadSuggestionPanelPos() ?? defaultSuggestionPanelPos();
                  const { w, h } = suggestionPanelDimensions();
                  setSuggestionPanelPos(clampSuggestionPanelPos(raw, w, h));
                  setSuggestionModalOpen(true);
                }}
              >
                <IconBulb className={styles.secondarySvg} />
                Sugestão
              </button>
              {showBuscaExpandida && activeTab === "textual" ? (
                <button
                  type="button"
                  className={`${styles.secondaryBtn} ${styles.btnBuscaExpandida}`}
                  disabled={expandBusy}
                  title="Expandir a busca usando mais 2 sinonimos do último texto de busca"
                  onClick={() => void handleExpandSearch()}
                >
                  <IconExpandSearch className={styles.secondarySvg} />
                  {expandBusy ? "A expandir…" : "Busca expandida"}
                </button>
              ) : <div className={styles.secondaryPlaceholder} aria-hidden />}
            </div>
          </div>

          {/* Popup timeout de pausa semântico */}
          {showTimeoutPopup ? (
            <div className={styles.timeoutOverlay} role="dialog" aria-modal aria-labelledby="timeout-popup-title"
              onClick={() => setShowTimeoutPopup(false)}
            >
              <div className={styles.timeoutPopup} onClick={(e) => e.stopPropagation()}>
                <h3 id="timeout-popup-title" className={styles.timeoutPopupTitle}>Tempo esgotado</h3>
                <p className={styles.timeoutPopupMsg}>Nenhuma fala detectada por 15s. Sua narrativa foi salva.</p>
                <div className={styles.timeoutPopupActions}>
                  <button
                    type="button"
                    className="mm-btn mm-btn--primary"
                    onClick={() => {
                      setShowTimeoutPopup(false);
                      void runSearch(undefined, undefined, "semantic");
                    }}
                  >
                    Buscar agora
                  </button>
                  <button
                    type="button"
                    className="mm-btn"
                    onClick={() => {
                      setShowTimeoutPopup(false);
                      setMicState("idle");
                      setQuery("");
                    }}
                  >
                    Recomeçar
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {items.length > 0 || noResultsFor ? (
            <div className={styles.resultsInner} aria-label="Resultados">
              {items.length > 0 ? (
                <>
              <div className={styles.resultsHead}>
                <div className={styles.resultsHeadLeft}>
                  <p
                    className={styles.resultsCount}
                    title={
                      displayLabel
                        ? `Encontrados ${totalCount} memo${totalCount === 1 ? "" : "s"} com “${displayLabel}”`
                        : undefined
                    }
                  >
                    Encontrados {totalCount} memo{totalCount === 1 ? "" : "s"} com{" "}
                    <span className={styles.resultsQuery}>{displayLabel ? `“${displayLabel}”` : "esta pesquisa"}</span>
                  </p>
                </div>
                <div className={styles.resultsTools} role="toolbar" aria-label="Ações dos resultados">
                  <div className={`${styles.resultsViewToolbar} ${styles.resultsViewBar}`}>
                    <button
                      type="button"
                      className={`${styles.resultsViewBtn} ${resultsViewMode === "list" ? styles.resultsViewBtnOn : ""}`}
                      aria-pressed={resultsViewMode === "list"}
                      aria-label="Vista em lista: uma linha por memo, métricas e atalhos"
                      title="Lista — uma linha por memo (arquivo, data, texto/keywords/dados, editar/lixeira)"
                      onClick={() => setResultsViewMode("list")}
                    >
                      <IconList className={styles.resultsViewBtnIcon} />
                    </button>
                    <button
                      type="button"
                      className={`${styles.resultsViewBtn} ${resultsViewMode === "cards" ? styles.resultsViewBtnOn : ""}`}
                      aria-pressed={resultsViewMode === "cards"}
                      aria-label="Vista em cartões: detalhe, realce da busca e consultar"
                      title="Cartões — vista detalhada com realce dos termos e ligação a consultar"
                      onClick={() => setResultsViewMode("cards")}
                    >
                      <IconCards className={styles.resultsViewBtnIcon} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className={styles.iconOnlyBtn}
                    onClick={() => toggleSpeakResults()}
                    aria-pressed={ttsBusy}
                    aria-label={
                      ttsBusy
                        ? "Parar leitura em voz alta dos resultados"
                        : "Ouvir resultados em voz alta (ler cada memo pela ordem)"
                    }
                    title={
                      ttsBusy
                        ? "Parar a leitura em voz alta (síntese de fala do navegador)"
                        : "Ouvir resultados — lê em voz alta o texto de cada memo pela ordem (síntese de fala)"
                    }
                  >
                    <IconSpeaker className={styles.resultsToolIconSvg} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconOnlyBtn}
                    title="Imprimir esta página (diálogo de impressão do navegador)"
                    aria-label="Imprimir a página de resultados"
                    onClick={() => window.print()}
                  >
                    <IconPrint className={styles.resultsToolIconSvg} />
                  </button>
                </div>
              </div>

              {resultsViewMode === "list" ? (
                <ul className={recentListStyles.list}>
                  {items.map((m) => (
                    <MemoResultListRow
                      key={m.id}
                      m={m}
                      returnTo={returnTo}
                      currentUserId={currentUserId}
                      deletingId={deletingId}
                      onOpenPreview={setPreviewMemo}
                      onRequestDelete={setDeleteTarget}
                    />
                  ))}
                </ul>
              ) : (
                <ul className={styles.resultList}>
                  {items.map((m) => {
                    const isOwner = currentUserId != null && m.userId === currentUserId;
                    const kw = parseKeywordList(m.keywords);
                    const dadosEntries = parseMemoDadosEspecificosEntries(m.dadosEspecificosJson);
                    return (
                      <li key={m.id} className={styles.memoCard}>
                        <div className={styles.memoCardTop}>
                          <MemoCardPrimaryRow
                            m={m}
                            apiBase={apiBase}
                            returnTo={returnTo}
                            badge={
                              (m.iaUseLevel || m.hasSemanticChunks) ? (
                                <>
                                  {m.iaUseLevel === "semIA" && (
                                    <span className={`${styles.cardBadge} ${styles.cardBadgeSemIA}`} title="Processado sem IA">sem IA</span>
                                  )}
                                  {m.iaUseLevel === "basico" && (
                                    <span className={`${styles.cardBadge} ${styles.cardBadgeBasico}`} title="IA básica">IA básica</span>
                                  )}
                                  {(m.iaUseLevel === "completo" || m.hasSemanticChunks) && (
                                    <span className={`${styles.cardBadge} ${styles.cardBadgeSemantic}`} title="Semântico">⊛ semântico</span>
                                  )}
                                </>
                              ) : undefined
                            }
                          />
                          <div className={styles.memoIconActions}>
                            {isOwner ? (
                              <Link
                                to={`/memo/${m.id}/editar`}
                                state={{ returnTo }}
                                className={styles.iconAction}
                                title="Editar"
                                aria-label="Editar memo"
                              >
                                <IconPencil />
                              </Link>
                            ) : null}
                            {isOwner ? (
                              <button
                                type="button"
                                className={`${styles.iconAction} ${styles.iconDanger}`}
                                title="Lixeira"
                                aria-label="Mover para a lixeira"
                                disabled={deletingId !== null}
                                onClick={() => setDeleteTarget(m)}
                              >
                                <IconTrash />
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {m.similarity != null && (
                          <span className={styles.similarityBadge}>
                            {Math.round(m.similarity * 100)}% similar
                          </span>
                        )}
                        <p className={styles.memoBody}>
                          {highlightText((m.mediaText || "").trim() || m.headline, highlightTerms)}
                        </p>
                        <div className={styles.kwRow}>
                          <span className={styles.kwLabel}>Keywords:</span>
                          <span className={styles.kwValue}>
                            {kw.length
                              ? kw.map((k, i) => (
                                  <span key={`${m.id}-kw-${i}`}>
                                    {i > 0 ? ", " : null}
                                    {highlightText(k, highlightTerms)}
                                  </span>
                                ))
                              : "—"}
                          </span>
                        </div>
                        <div className={styles.kwRow}>
                          <span className={styles.kwLabel}>Dados específicos:</span>
                          <span className={styles.kwValue}>
                            {dadosEntries?.length ? (
                              <MemoDadosEspecificosDisplay
                                entries={dadosEntries}
                                formatSegment={(t) => highlightText(t, highlightTerms)}
                              />
                            ) : (
                              "—"
                            )}
                          </span>
                        </div>
                        {showApiCost ? (
                          <p className={styles.costLine}>
                            Custo de API: ${(m.apiCost ?? 0).toFixed(6)}
                            {(m.usedApiCred ?? 0) > 0 ? ` · Créditos: ${(m.usedApiCred ?? 0).toFixed(6)}` : null}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
                </>
              ) : (
                <p
                  className={styles.noResults}
                  role="status"
                  title={noResultsFor ? `Nenhum memo foi encontrado com “${noResultsFor}”` : undefined}
                >
                  Nenhum memo foi encontrado com{" "}
                  <span className={styles.resultsQuery}>“{noResultsFor}”</span>
                </p>
              )}
            </div>
          ) : null}
        </section>

        {error ? <p className="mm-error" role="alert">{error}</p> : null}

        {suggestionModalOpen && openSuggestionPos ? (
          <div
            ref={suggestionPanelRef}
            className={styles.suggestionPanel}
            style={{ left: openSuggestionPos.x, top: openSuggestionPos.y }}
            role="dialog"
            aria-modal={false}
            aria-labelledby={suggestionDialogTitleId}
          >
            <div
              className={styles.suggestionPanelDrag}
              onMouseDown={handleSuggestionPanelDragStart}
              title="Arrastar para mover o painel"
            >
              <h3 id={suggestionDialogTitleId} className={styles.suggestionPanelTitle}>
                Sugestão de busca
              </h3>
              <span className={styles.suggestionDragHint}>Arrastar</span>
            </div>
            <div className={styles.suggestionPanelBody}>
              <div className={styles.suggestionToolbar}>
                <span className={styles.suggestionSortLabel}>Ordenar:</span>
                <button
                  type="button"
                  className={`${styles.suggestionSortBtn} ${suggestionSort === "relevance" ? styles.suggestionSortBtnOn : ""}`}
                  aria-pressed={suggestionSort === "relevance"}
                  onClick={() => setSuggestionSort("relevance")}
                >
                  Relevância
                </button>
                <button
                  type="button"
                  className={`${styles.suggestionSortBtn} ${suggestionSort === "alpha" ? styles.suggestionSortBtnOn : ""}`}
                  aria-pressed={suggestionSort === "alpha"}
                  onClick={() => setSuggestionSort("alpha")}
                >
                  A–Z
                </button>
                <button
                  type="button"
                  className={`mm-btn mm-btn--ghost ${styles.suggestionCloseBtn}`}
                  onClick={() => setSuggestionModalOpen(false)}
                >
                  Fechar
                </button>
              </div>
              {sortedSuggestionRows.length === 0 ? (
                <p className={styles.suggestionEmpty}>
                  Nenhum termo adicional encontrado: ou já estão cobertos pela pesquisa (incl. sinónimos em OR), ou são
                  palavras muito comuns.
                </p>
              ) : (
                <div className={styles.suggestionTableWrap}>
                  <table className={styles.suggestionTable}>
                    <thead>
                      <tr>
                        <th scope="col" title="Toque numa linha para usar o termo na busca">
                          sugestão
                        </th>
                        <th scope="col" className={styles.suggestionNumCol}>
                          <button
                            type="button"
                            className={`${styles.suggestionColHeaderBtn} ${
                              suggestionViewMode === "all" ? styles.suggestionColHeaderBtnOn : ""
                            }`}
                            disabled={searchBusy}
                            title="Mostrar total (todas as colunas)"
                            onClick={() => setSuggestionViewMode("all")}
                          >
                            total
                          </button>
                        </th>
                        <th scope="col" className={styles.suggestionNumCol}>
                          <button
                            type="button"
                            className={`${styles.suggestionColHeaderBtn} ${
                              suggestionViewMode === "dadosEspecificos" ? styles.suggestionColHeaderBtnOn : ""
                            }`}
                            disabled={searchBusy}
                            title="Mostrar contagem só em contexto (dados específicos)"
                            onClick={() => setSuggestionViewMode("dadosEspecificos")}
                          >
                            contexto
                          </button>
                        </th>
                        <th scope="col" className={styles.suggestionNumCol}>
                          <button
                            type="button"
                            className={`${styles.suggestionColHeaderBtn} ${
                              suggestionViewMode === "keywords" ? styles.suggestionColHeaderBtnOn : ""
                            }`}
                            disabled={searchBusy}
                            title="Mostrar contagem só em keywords"
                            onClick={() => setSuggestionViewMode("keywords")}
                          >
                            keyword
                          </button>
                        </th>
                        <th scope="col" className={styles.suggestionNumCol}>
                          <button
                            type="button"
                            className={`${styles.suggestionColHeaderBtn} ${
                              suggestionViewMode === "mediaText" ? styles.suggestionColHeaderBtnOn : ""
                            }`}
                            disabled={searchBusy}
                            title="Mostrar contagem só em texto (mídia / resumo)"
                            onClick={() => setSuggestionViewMode("mediaText")}
                          >
                            texto
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSuggestionRows.map((row) => (
                        <tr key={row.lemmaKey}>
                          <td>
                            <button
                              type="button"
                              className={styles.suggestionRowBtn}
                              onClick={() => applySuggestionTermSelection(row)}
                            >
                              {row.dadosExample ? (
                                <>
                                  <span className={styles.suggestionDadosLabel}>{row.dadosExample.label}:</span>{" "}
                                  <strong className={styles.suggestionDadosValue}>{row.dadosExample.value}</strong>
                                </>
                              ) : (
                                row.term
                              )}
                            </button>
                          </td>
                          <td className={styles.suggestionNumCol}>{row.countTotal}</td>
                          <td className={styles.suggestionNumCol}>{row.countDadosEspecificos}</td>
                          <td className={styles.suggestionNumCol}>{row.countKeywords}</td>
                          <td className={styles.suggestionNumCol}>{row.countMediaText}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {filterModal === "quando" ? (
          <div
            className="mm-modal-overlay"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) setFilterModal(null);
            }}
          >
            <div
              className="mm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="filter-quando-title"
              onClick={(ev) => ev.stopPropagation()}
            >
              <h3 id="filter-quando-title">Quando</h3>
              <p className="mm-muted">Período pela data de registo do memo (inclusivo por dia).</p>
              <div className={styles.filterModalFields}>
                <label className={styles.filterField}>
                  <span>De</span>
                  <input
                    type="date"
                    value={draftDateFrom}
                    onChange={(e) => setDraftDateFrom(e.target.value)}
                    className={styles.filterDateInput}
                  />
                </label>
                <label className={styles.filterField}>
                  <span>Até</span>
                  <input
                    type="date"
                    value={draftDateTo}
                    onChange={(e) => setDraftDateTo(e.target.value)}
                    className={styles.filterDateInput}
                  />
                </label>
              </div>
              <div className={styles.confirmRow}>
                <button type="button" className="mm-btn mm-btn--ghost" onClick={() => setFilterModal(null)}>
                  Fechar
                </button>
                <button type="button" className="mm-btn mm-btn--ghost" onClick={() => limparQuandoFiltro()}>
                  Limpar filtro
                </button>
                <button type="button" className="mm-btn mm-btn--primary" onClick={() => applyQuandoFiltro()}>
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {filterModal === "quem" ? (
          <div
            className="mm-modal-overlay"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) setFilterModal(null);
            }}
          >
            <div
              className="mm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="filter-quem-title"
              onClick={(ev) => ev.stopPropagation()}
            >
              <h3 id="filter-quem-title">Quem</h3>
              <p className="mm-muted">Autor que criou o memo.</p>
              <label className={styles.filterField}>
                <span>Pessoa</span>
                <select
                  className={styles.filterSelect}
                  value={draftAuthorId != null ? String(draftAuthorId) : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDraftAuthorId(v ? Number(v) : null);
                  }}
                >
                  <option value="">Qualquer (sem filtro)</option>
                  {authorOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name?.trim() || a.email?.trim() || `Usuario #${a.id}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.confirmRow}>
                <button type="button" className="mm-btn mm-btn--ghost" onClick={() => setFilterModal(null)}>
                  Fechar
                </button>
                <button type="button" className="mm-btn mm-btn--ghost" onClick={() => limparQuemFiltro()}>
                  Limpar filtro
                </button>
                <button type="button" className="mm-btn mm-btn--primary" onClick={() => applyQuemFiltro()}>
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {previewMemo ? (
          <MemoFilePreviewModal
            m={previewMemo}
            apiBase={apiBase}
            returnTo={returnTo}
            onClose={() => setPreviewMemo(null)}
          />
        ) : null}

        {deleteTarget ? (
          <div
            className="mm-modal-overlay"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !deletingId) setDeleteTarget(null);
            }}
          >
            <div
              className="mm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="del-memo-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="del-memo-title">Mover para a lixeira?</h3>
              <p className="mm-muted">Exclusão lógica; só o autor pode recuperar via administrador se aplicável.</p>
              <div className={styles.confirmRow}>
                <button type="button" className="mm-btn mm-btn--ghost" disabled={deletingId !== null} onClick={() => setDeleteTarget(null)}>
                  Cancelar
                </button>
                <button type="button" className="mm-btn mm-btn--primary" disabled={deletingId !== null} onClick={() => void confirmDelete()}>
                  {deletingId ? "A excluir…" : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
