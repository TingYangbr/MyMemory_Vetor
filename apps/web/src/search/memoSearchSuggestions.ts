import type { MemoRecentCard, MemoSearchHighlightTerm } from "@mymemory/shared";

/** Palavras comuns PT (artigos, preposições, etc.) — não sugerir. */
const STOP = new Set(
  [
    "o",
    "a",
    "os",
    "as",
    "um",
    "uma",
    "uns",
    "umas",
    "de",
    "do",
    "da",
    "dos",
    "das",
    "em",
    "no",
    "na",
    "nos",
    "nas",
    "por",
    "para",
    "pra",
    "com",
    "sem",
    "sob",
    "sobre",
    "entre",
    "ate",
    "até",
    "e",
    "ou",
    "que",
    "se",
    "como",
    "mais",
    "menos",
    "muito",
    "muita",
    "muitos",
    "muitas",
    "pouco",
    "pouca",
    "todo",
    "toda",
    "todos",
    "todas",
    "este",
    "esta",
    "estes",
    "estas",
    "esse",
    "essa",
    "esses",
    "essas",
    "aquele",
    "aquela",
    "aqueles",
    "aquelas",
    "eu",
    "tu",
    "ele",
    "ela",
    "nós",
    "vos",
    "eles",
    "elas",
    "me",
    "te",
    "lhe",
    "nos",
    "vos",
    "lhes",
    "já",
    "não",
    "num",
    "numa",
    "nem",
    "só",
    "cada",
    "qual",
    "quais",
    "quando",
    "onde",
    "porque",
    "porquê",
    "assim",
    "então",
    "ha",
    "há",
    "ser",
    "estar",
    "ter",
    "foi",
    "são",
    "era",
    "eram",
    "pelo",
    "pela",
    "pelos",
    "pelas",
    "ao",
    "aos",
    "à",
    "às",
    "del",
    "dum",
    "duma",
  ].map((w) => stripAccents(w).toLowerCase())
);

const WORD_RE = /\p{L}[\p{L}'-]*/gu;

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

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

function tokenize(text: string): string[] {
  if (!text?.trim()) return [];
  const out: string[] = [];
  const m = text.matchAll(WORD_RE);
  for (const x of m) {
    const w = x[0];
    if (w && w.length >= 2) out.push(w);
  }
  return out;
}

/** Chave aproximada para singular/plural e algumas flexões PT. */
function lemmaKey(raw: string): string {
  let w = stripAccents(raw).toLowerCase();
  if (w.length <= 2) return w;
  if (w.endsWith("ões")) return w.slice(0, -3) + "ao";
  if (w.endsWith("ães")) return w.slice(0, -3) + "ao";
  if (w.endsWith("ais") && w.length > 4) return w.slice(0, -3) + "al";
  if (w.endsWith("éis") && w.length > 4) return w.slice(0, -3) + "el";
  if (w.endsWith("óis") && w.length > 4) return w.slice(0, -3) + "ol";
  if (w.endsWith("ns") && w.length > 3) {
    const base = w.slice(0, -1);
    if (base.endsWith("e")) return base.slice(0, -1) + "em";
  }
  if (w.endsWith("es") && w.length > 4) {
    const b = w.slice(0, -2);
    if (b.endsWith("ã")) return b + "o";
    if (b.endsWith("õ")) return b.slice(0, -1) + "ao";
  }
  if (w.endsWith("s") && w.length > 3) return w.slice(0, -1);
  return w;
}

function isStopToken(raw: string): boolean {
  const k = stripAccents(raw).toLowerCase();
  return STOP.has(k) || STOP.has(lemmaKey(raw));
}

function parseKeywordPhrases(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizePhrase(s: string): string {
  return stripAccents(s).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Ruído típico em keywords: apenas números/sinais sem letras (ex.: "44", "86.018", "12/2024"). */
function isNumericNoisePhrase(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/\p{L}/u.test(t)) return false;
  return /[\d]/.test(t);
}

function buildExcludedLemmaKeys(query: string, highlightTerms: MemoSearchHighlightTerm[]): Set<string> {
  const ex = new Set<string>();
  for (const h of highlightTerms) {
    const t = h.term?.trim();
    if (!t) continue;
    for (const tok of tokenize(t)) {
      ex.add(lemmaKey(tok));
    }
    if (!t.includes(" ")) ex.add(lemmaKey(t));
  }
  const q = query.trim();
  if (q) {
    for (const part of splitTopLevelCommas(q)) {
      const inner = stripOuterParens(part);
      for (const branch of inner.split(/\s+OR\s+/i)) {
        for (const tok of tokenize(branch)) {
          ex.add(lemmaKey(tok));
        }
      }
    }
  }
  return ex;
}

function buildExcludedPhrases(query: string, highlightTerms: MemoSearchHighlightTerm[]): Set<string> {
  const ex = new Set<string>();
  for (const h of highlightTerms) {
    const t = normalizePhrase(h.term ?? "");
    if (t) ex.add(t);
  }
  const q = query.trim();
  if (q) {
    for (const part of splitTopLevelCommas(q)) {
      const inner = stripOuterParens(part);
      for (const branch of inner.split(/\s+OR\s+/i)) {
        const t = normalizePhrase(branch);
        if (t) ex.add(t);
      }
    }
  }
  return ex;
}

export type SearchSuggestionRow = {
  /** Forma mais vista no corpus (exibição). */
  term: string;
  lemmaKey: string;
  /** Quantidade de memos distintos em que o lema aparece em `mediaText` (no máx. 1 por memo). */
  countMediaText: number;
  /** Quantidade de memos distintos em que o lema aparece em `keywords` (no máx. 1 por memo). */
  countKeywords: number;
  /** Memos distintos em que o lema aparece nos valores de `dadosEspecificosJson`. */
  countDadosEspecificos: number;
  /** Memos distintos com o lema em texto, keywords ou dados específicos (união). */
  countTotal: number;
  /** Exemplo opcional para UI: mostra label + valor sem afetar a busca. */
  dadosExample?: { label: string; value: string };
};

type DadosValueSortKind = "epoch" | "num" | "str";

type DadosValueSortParsed =
  | { kind: "epoch"; ms: number }
  | { kind: "num"; n: number }
  | { kind: "str" };

function parseDadosValueForSort(raw: string): DadosValueSortParsed {
  const sFull = raw.trim();
  if (!sFull) return { kind: "str" };

  const isoHead = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/.exec(sFull);
  if (isoHead) {
    const ms = Date.UTC(+isoHead[1], +isoHead[2] - 1, +isoHead[3]);
    if (!Number.isNaN(ms)) return { kind: "epoch", ms };
  }

  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?=\D|$)/;
  const m = br.exec(sFull);
  if (m) {
    const d = +m[1];
    const mo = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const ms = Date.UTC(y, mo - 1, d);
      if (!Number.isNaN(ms)) return { kind: "epoch", ms };
    }
  }

  const n = parseLooseNumericForSort(sFull);
  if (n != null) return { kind: "num", n };

  return { kind: "str" };
}

/**
 * `1.234,56` / `R$ 10,00` / `3,5` / `1000`; senão comparação textual pt.
 */
function parseLooseNumericForSort(raw: string): number | null {
  const t = raw
    .replace(/^\s*R\$\s*/i, "")
    .replace(/\s/g, "")
    .trim();
  if (!t || !/^[+-]?[\d.,]+$/.test(t)) return null;

  let norm = t;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) {
    norm = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d+$/.test(t)) {
    norm = t.replace(",", ".");
  } else if (/^\d+\.\d+$/.test(t)) {
    norm = t;
  } else if (/^\d+$/.test(t)) {
    norm = t;
  } else {
    return null;
  }
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ordenação de valores típicos em “dados específicos”: datas (yyyy-mm-dd ou dd/mm/aaaa) e números BR;
 * tipos diferentes caem em `localeCompare` para não misturar escalas.
 */
export function compareDadosEspecificosValuesForSort(a: string, b: string): number {
  const pa = parseDadosValueForSort(a);
  const pb = parseDadosValueForSort(b);
  if (pa.kind === "epoch" && pb.kind === "epoch") return pa.ms - pb.ms;
  if (pa.kind === "num" && pb.kind === "num") return pa.n - pb.n;
  if (pa.kind !== pb.kind) {
    const rank = (k: DadosValueSortKind) => (k === "epoch" ? 0 : k === "num" ? 1 : 2);
    const ra = rank(pa.kind);
    const rb = rank(pb.kind);
    if (ra !== rb) return ra - rb;
  }
  return a.localeCompare(b, "pt", { sensitivity: "base" });
}

/** Texto derivado do JSON de campos específicos para tokenização (somente valores). */
export function textFromDadosEspecificosJson(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  try {
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return raw;
    const parts: string[] = [];
    for (const [, v] of Object.entries(j as Record<string, unknown>)) {
      if (v == null) continue;
      if (typeof v === "string" && v.trim()) parts.push(v);
      else if (typeof v === "number" || typeof v === "boolean") parts.push(String(v));
    }
    return parts.join(" ");
  } catch {
    return raw;
  }
}

function parseDadosValueEntries(raw: string | null | undefined): Array<{ label: string; value: string }> {
  if (!raw?.trim()) return [];
  try {
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return [];
    const out: Array<{ label: string; value: string }> = [];
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      const label = k.trim();
      if (!label) continue;
      let value = "";
      if (typeof v === "string") value = v.trim();
      else if (typeof v === "number" || typeof v === "boolean") value = String(v);
      if (!value) continue;
      out.push({ label, value });
    }
    return out;
  } catch {
    return [];
  }
}

const MAX_ROWS = 120;

function collectLemmaSurfacesInText(text: string, excluded: Set<string>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const tok of tokenize(text)) {
    if (isStopToken(tok)) continue;
    const lk = lemmaKey(tok);
    if (lk.length < 2 || excluded.has(lk)) continue;
    let set = map.get(lk);
    if (!set) {
      set = new Set<string>();
      map.set(lk, set);
    }
    set.add(tok);
  }
  return map;
}

function collectLemmaSurfacesInKeywords(
  keywords: string | null | undefined,
  excludedLemmas: Set<string>,
  excludedPhrases: Set<string>
): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>();
  for (const phrase of parseKeywordPhrases(keywords)) {
    const cleaned = phrase.trim();
    if (cleaned.length < 2 || isStopToken(cleaned) || isNumericNoisePhrase(cleaned)) continue;
    const phraseNorm = normalizePhrase(cleaned);
    if (!phraseNorm || excludedPhrases.has(phraseNorm)) continue;
    if (excludedLemmas.has(lemmaKey(cleaned))) continue;
    let set = merged.get(phraseNorm);
    if (!set) {
      set = new Set<string>();
      merged.set(phraseNorm, set);
    }
    set.add(cleaned);
  }
  return merged;
}

function collectDadosValueSurfaces(
  dadosJson: string | null | undefined,
  excludedLemmas: Set<string>,
  excludedPhrases: Set<string>
): Map<string, { values: Set<string>; example: { label: string; value: string } | null }> {
  const out = new Map<string, { values: Set<string>; example: { label: string; value: string } | null }>();
  for (const entry of parseDadosValueEntries(dadosJson)) {
    const value = entry.value.trim();
    if (value.length < 2 || isStopToken(value)) continue;
    const phraseNorm = normalizePhrase(value);
    if (!phraseNorm || excludedPhrases.has(phraseNorm)) continue;
    if (excludedLemmas.has(lemmaKey(value))) continue;
    let got = out.get(phraseNorm);
    if (!got) {
      got = { values: new Set<string>(), example: { label: entry.label, value } };
      out.set(phraseNorm, got);
    }
    got.values.add(value);
    if (!got.example) got.example = { label: entry.label, value };
  }
  return out;
}

/**
 * Extrai termos dos memos listados; contagens = **número de memos distintos** (não repetições no texto).
 * Exclui lemas já cobertos pela query (incl. ramos OR) e pelos termos de realce da API.
 */
export function computeSearchSuggestions(
  items: MemoRecentCard[],
  query: string,
  highlightTerms: MemoSearchHighlightTerm[]
): SearchSuggestionRow[] {
  const excludedLemmas = buildExcludedLemmaKeys(query, highlightTerms);
  const excludedPhrases = buildExcludedPhrases(query, highlightTerms);
  type Agg = {
    mediaMemos: Set<number>;
    kwMemos: Set<number>;
    dadosMemos: Set<number>;
    /** Por superfície: em quantos memos essa forma apareceu (no máx. +1 por memo por superfície). */
    surfMemoCount: Map<string, number>;
    dadosExample: { label: string; value: string } | null;
  };
  const aggs = new Map<string, Agg>();

  function getAgg(lk: string): Agg {
    let a = aggs.get(lk);
    if (!a) {
      a = {
        mediaMemos: new Set(),
        kwMemos: new Set(),
        dadosMemos: new Set(),
        surfMemoCount: new Map(),
        dadosExample: null,
      };
      aggs.set(lk, a);
    }
    return a;
  }

  items.forEach((m, idx) => {
    const memoId = Number.isFinite(m.id) ? m.id : idx;
    const mediaMap = collectLemmaSurfacesInText(m.mediaText || "", excludedLemmas);
    const kwMap = collectLemmaSurfacesInKeywords(m.keywords, excludedLemmas, excludedPhrases);
    const dadosMap = collectDadosValueSurfaces(m.dadosEspecificosJson, excludedLemmas, excludedPhrases);
    const allLk = new Set<string>([...mediaMap.keys(), ...kwMap.keys(), ...dadosMap.keys()]);
    for (const lk of allLk) {
      const a = getAgg(lk);
      const surfUnion = new Set<string>();
      const mm = mediaMap.get(lk);
      if (mm?.size) {
        a.mediaMemos.add(memoId);
        for (const s of mm) surfUnion.add(s);
      }
      const km = kwMap.get(lk);
      if (km?.size) {
        a.kwMemos.add(memoId);
        for (const s of km) surfUnion.add(s);
      }
      const dm = dadosMap.get(lk);
      if (dm?.values.size) {
        a.dadosMemos.add(memoId);
        for (const s of dm.values) surfUnion.add(s);
        if (!a.dadosExample && dm.example) a.dadosExample = dm.example;
      }
      for (const s of surfUnion) {
        a.surfMemoCount.set(s, (a.surfMemoCount.get(s) ?? 0) + 1);
      }
    }
  });

  const rows: SearchSuggestionRow[] = [];
  for (const [lk, a] of aggs) {
    let bestTerm = lk;
    let bestN = -1;
    for (const [surf, n] of a.surfMemoCount) {
      if (n > bestN || (n === bestN && surf.length < bestTerm.length)) {
        bestN = n;
        bestTerm = surf;
      }
    }
    const totalMemos = new Set<number>([...a.mediaMemos, ...a.kwMemos, ...a.dadosMemos]);
    rows.push({
      term: bestTerm,
      lemmaKey: lk,
      countMediaText: a.mediaMemos.size,
      countKeywords: a.kwMemos.size,
      countDadosEspecificos: a.dadosMemos.size,
      countTotal: totalMemos.size,
      dadosExample: a.dadosExample ?? undefined,
    });
  }

  rows.sort((x, y) => y.countTotal - x.countTotal || x.term.localeCompare(y.term, "pt"));
  return rows.slice(0, MAX_ROWS);
}
