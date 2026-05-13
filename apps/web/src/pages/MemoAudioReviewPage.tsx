import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { AudioMemoReviewNavState, MeResponse, MemoCreatedResponse } from "@mymemory/shared";
import { USER_IA_USE_LABELS, SEMIA_PLACEHOLDER_PREFIX, dedupeMemoKeywordsCommaSeparated } from "@mymemory/shared";
import { apiGetOptional, apiPostJson } from "../api";
import { useCategoryOptions } from "../hooks/useCategoryOptions";
import Header from "../components/Header";
import { ReviewHero, formatReviewBytes, reviewFileKindExtension } from "../components/MemoReviewChrome";
import { useMemoReviewVoiceAssistant } from "../hooks/useMemoReviewVoiceAssistant";
import styles from "./MemoTextReviewPage.module.css";

const SOURCE_LABELS: Record<AudioMemoReviewNavState["source"], string> = {
  none: "Sem IA / sem transcrição automática",
  speech_basic: "Transcrição + IA básico (uma chamada)",
  speech_full: "Transcrição + IA completo (categoria e subcategorias/campos)",
  speech_segmented: "Transcrição por segmentos temporais + IA (arquivo grande)",
};

const IA_LEVELS = new Set<string>(["semIA", "basico", "completo"]);
const SOURCES = new Set<string>(["none", "speech_basic", "speech_full", "speech_segmented"]);

function parseDadosEntries(raw: string | null | undefined): Array<{ key: string; value: string }> {
  const t = raw?.trim();
  if (!t) return [];
  try {
    const j = JSON.parse(t) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return [];
    const out: Array<{ key: string; value: string }> = [];
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      const key = k.trim();
      if (!key) continue;
      const value =
        v == null ? "" : typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
      out.push({ key, value });
    }
    return out;
  } catch {
    return [];
  }
}

function readStr(o: Record<string, unknown>, k: string, fallback = ""): string {
  const v = o[k];
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  return String(v);
}

function readFiniteNumber(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseGroupId(o: Record<string, unknown>): number | null {
  if (!("groupId" in o)) return null;
  const v = o.groupId;
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Aceita estado vindo do JSON da API (números por vezes como string) e valida enums. */
function parseAudioReviewLocationState(raw: unknown): AudioMemoReviewNavState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const iaLevel = readStr(o, "iaLevel");
  if (!IA_LEVELS.has(iaLevel)) return null;

  const source = readStr(o, "source");
  if (!SOURCES.has(source)) return null;

  const mediaAudioUrl = readStr(o, "mediaAudioUrl").trim();
  if (!mediaAudioUrl) return null;

  const maxSummaryChars = readFiniteNumber(o, "maxSummaryChars");
  const apiCost = readFiniteNumber(o, "apiCost");
  const tamMediaUrl = readFiniteNumber(o, "tamMediaUrl");
  if (maxSummaryChars == null || maxSummaryChars < 0) return null;
  if (apiCost == null || apiCost < 0) return null;
  if (tamMediaUrl == null || tamMediaUrl < 0) return null;

  const pw = o.processingWarning;
  const processingWarning =
    typeof pw === "string" ? pw : pw === null ? null : undefined;

  let dadosEspecificosJson: string | null | undefined;
  if ("dadosEspecificosJson" in o) {
    const d = o.dadosEspecificosJson;
    if (d === null) dadosEspecificosJson = null;
    else if (typeof d === "string") dadosEspecificosJson = d.trim();
  }
  let dadosEspecificosOriginaisJson: string | null | undefined;
  if ("dadosEspecificosOriginaisJson" in o) {
    const d = o.dadosEspecificosOriginaisJson;
    if (d === null) dadosEspecificosOriginaisJson = null;
    else if (typeof d === "string") dadosEspecificosOriginaisJson = d.trim();
  }
  const matchedCategoryId = readFiniteNumber(o, "matchedCategoryId");
  const categoryRaw = o.category;
  const category =
    typeof categoryRaw === "string" && categoryRaw.trim() ? categoryRaw.trim() : categoryRaw === null ? null : undefined;

  return {
    originalText: readStr(o, "originalText"),
    suggestedMediaText: readStr(o, "suggestedMediaText"),
    suggestedKeywords: readStr(o, "suggestedKeywords"),
    maxSummaryChars,
    apiCost,
    iaLevel: iaLevel as AudioMemoReviewNavState["iaLevel"],
    processingWarning,
    dadosEspecificosJson,
    dadosEspecificosOriginaisJson,
    ...(matchedCategoryId != null ? { matchedCategoryId } : {}),
    ...(category !== undefined ? { category } : {}),
    mediaAudioUrl,
    originalFilename: readStr(o, "originalFilename"),
    tamMediaUrl,
    source: source as AudioMemoReviewNavState["source"],
    groupId: parseGroupId(o),
  };
}

export default function MemoAudioReviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = useMemo(() => parseAudioReviewLocationState(location.state), [location.state]);

  const [mediaText, setMediaText] = useState("");
  const [keywords, setKeywords] = useState("");
  const [dadosEntries, setDadosEntries] = useState<Array<{ key: string; value: string }>>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedCategoryName, setSelectedCategoryName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApiCost, setShowApiCost] = useState(true);
  const [usdToCreditsMultiplier, setUsdToCreditsMultiplier] = useState(100);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const kwRef = useRef<HTMLTextAreaElement | null>(null);
  const dadosInputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());

  const updateDadosEntry = useCallback((key: string, value: string) => {
    setDadosEntries(prev => prev.map(e => e.key === key ? { ...e, value } : e));
  }, []);

  useEffect(() => {
    void apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (!r.ok) return;
      if (r.data.showApiCost === false) setShowApiCost(false);
      setSoundEnabled(r.data.soundEnabled !== false);
      const m = r.data.usdToCreditsMultiplier;
      if (typeof m === "number" && Number.isFinite(m) && m > 0) setUsdToCreditsMultiplier(m);
    });
  }, []);

  const categoryOptions = useCategoryOptions(state?.groupId ?? null);

  useEffect(() => {
    if (!selectedCategoryName || selectedCategoryId !== null || categoryOptions.length === 0) return;
    const match = categoryOptions.find((c) => c.name === selectedCategoryName);
    if (match) setSelectedCategoryId(match.id);
  }, [categoryOptions, selectedCategoryName, selectedCategoryId]);

  useEffect(() => {
    if (!state) return;
    const audioText = state.suggestedMediaText;
    setMediaText((!audioText.trim() && state.iaLevel === "semIA")
      ? `${SEMIA_PLACEHOLDER_PREFIX}\nArquivo importado sem processamento de IA.\nNome do arquivo: ${state.originalFilename ?? ""}`
      : audioText);
    setKeywords(dedupeMemoKeywordsCommaSeparated(state.suggestedKeywords));
    setDadosEntries(parseDadosEntries(state.dadosEspecificosJson));
    setSelectedCategoryId(state.matchedCategoryId ?? null);
    setSelectedCategoryName(state.category ?? null);
  }, [state]);

  const overLimit = state != null && mediaText.length > state.maxSummaryChars;

  const onSave = useCallback(async () => {
    if (!state) return;
    if (overLimit) {
      setError(`Texto excede o máximo de ${state.maxSummaryChars} caracteres.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPostJson<MemoCreatedResponse>("/api/memos/audio/confirm", {
        mediaText: mediaText.trim(),
        keywords: keywords.trim(),
        groupId: state.groupId,
        apiCost: state.apiCost,
        originalText: state.originalText,
        iaLevel: state.iaLevel,
        dadosEspecificosJson: dadosEntries.length > 0
          ? JSON.stringify(Object.fromEntries(dadosEntries.map(e => [e.key, e.value])))
          : null,
        dadosEspecificosOriginaisJson: state.dadosEspecificosOriginaisJson ?? null,
        matchedCategoryId: selectedCategoryId,
        category: selectedCategoryName,
        mediaAudioUrl: state.mediaAudioUrl,
        tamMediaUrl: state.tamMediaUrl,
        originalFilename: state.originalFilename,
        source: state.source,
      });
      navigate("/", { replace: true, state: { memoSavedAt: Date.now() } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }, [state, overLimit, mediaText, keywords, dadosEntries, selectedCategoryId, selectedCategoryName, navigate]);

  const voice = useMemoReviewVoiceAssistant({
    soundEnabled,
    active: state != null,
    mediaText,
    setMediaText,
    keywords,
    setKeywords,
    textAreaRef: bodyRef,
    keywordsAreaRef: kwRef,
    onSave,
    canSave: state != null && !busy && !overLimit,
    setError,
    dadosEntries,
    setDadosEntry: updateDadosEntry,
    dadosInputRefs,
  });

  if (!state) {
    return (
      <>
        <Header />
        <div className={styles.page}>
          <p>Nada para revisar. Volte à home e envie um áudio.</p>
        </div>
      </>
    );
  }

  const showTranscriptBlock = state.originalText.trim().length > 0;

  const kindExt = reviewFileKindExtension(state.originalFilename);
  const processFooterSegments: string[] = [];
  if (state.processingWarning?.trim()) processFooterSegments.push(state.processingWarning.trim());
  if (showApiCost) {
    processFooterSegments.push(`Uso de IA: ${USER_IA_USE_LABELS[state.iaLevel]}`);
    processFooterSegments.push(`Pipeline: ${SOURCE_LABELS[state.source] ?? state.source}`);
    processFooterSegments.push(
      `Custo API (USD): ${state.apiCost.toFixed(6)} · Créditos estimados: ${(state.apiCost * usdToCreditsMultiplier).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      })}`
    );
  }
  const processFooterLine = processFooterSegments.join(" · ");

  return (
    <>
      <Header />
      <div className={styles.page}>
        <ReviewHero mediaKind="áudio" kindExtension={kindExt} />

        {voice.voiceBanner}

        <div className={styles.reviewOriginalFileMeta}>
          {state.originalFilename} · {formatReviewBytes(state.tamMediaUrl)} ·{" "}
          {state.originalText.length.toLocaleString("pt-BR")} caracteres (transcrição)
        </div>

        <section className={styles.panel} style={{ marginBottom: "1.25rem" }}>
          <div
            className={styles.originalBox}
            style={{ minHeight: "auto", maxHeight: "none", padding: "0.75rem", background: "#f8fafc", border: "1px solid #e2e8f0" }}
          >
            <audio src={state.mediaAudioUrl} controls preload="metadata" style={{ width: "100%", maxWidth: "520px" }} />
          </div>
        </section>

        {showTranscriptBlock ? (
          <section className={styles.panel} style={{ marginBottom: "1.25rem" }}>
            <h2 className={styles.panelTitle}>Transcrição (referência)</h2>
            <div className={styles.originalBox}>{state.originalText}</div>
          </section>
        ) : null}

      <div className={styles.reviewCategoryRow}>
        <label className={styles.reviewCategoryLabel} htmlFor="memo-audio-review-category">
          Categoria:
        </label>
        <select
          id="memo-audio-review-category"
          className={styles.reviewCategorySelect}
          value={selectedCategoryId ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            if (!val) {
              setSelectedCategoryId(null);
              setSelectedCategoryName(null);
            } else {
              const id = Number(val);
              const cat = categoryOptions.find((c) => c.id === id);
              setSelectedCategoryId(id);
              setSelectedCategoryName(cat?.name ?? null);
            }
          }}
        >
          <option value="">Sem categoria</option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className={styles.grid}>
        <label className={styles.fieldLabel} htmlFor="memo-audio-review-body">
          Texto ou Resumo:
          {voice.memoBodyHint ? <span className={styles.hint}>{voice.memoBodyHint}</span> : null}
          <textarea
            id="memo-audio-review-body"
            ref={bodyRef}
            className={[styles.textarea, voice.textAreaExtraClass].filter(Boolean).join(" ")}
            value={mediaText}
            onChange={(e) => setMediaText(e.target.value)}
            {...voice.voiceTextAreaProps}
          />
          <span className={`${styles.counter} ${overLimit ? styles.counterOver : ""}`}>
            {mediaText.length} / {state.maxSummaryChars} caracteres (máximo do plano/contexto)
          </span>
        </label>

        <label className={styles.fieldLabel} htmlFor="memo-audio-review-kw">
          Palavras-chave
          <span className={styles.hint}>{voice.memoKeywordsHint}</span>
          <textarea
            id="memo-audio-review-kw"
            ref={kwRef}
            className={[styles.keywordsInput, voice.keywordsAreaExtraClass].filter(Boolean).join(" ")}
            rows={2}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            {...voice.voiceKeywordsAreaProps}
            placeholder="ex.: reunião, decisão, cliente"
            autoComplete="off"
          />
          <div className={styles.dadosInlineBox}>
            <div className={styles.dadosInlineTitle}>Dados específicos</div>
            {dadosEntries.length > 0 ? (
              <div id="memo-audio-review-dados" className={styles.dadosList}>
                {dadosEntries.map((it) => (
                  <div key={it.key} className={styles.dadosRow}>
                    <label className={styles.dadosKey} htmlFor={`review-dados-${it.key}`}>{it.key}:</label>
                    <input
                      id={`review-dados-${it.key}`}
                      type="text"
                      className={[styles.dadosValInput, voice.dadosFieldExtraClass(it.key)].filter(Boolean).join(" ")}
                      value={it.value}
                      ref={(el) => { dadosInputRefs.current.set(it.key, el); }}
                      onChange={(e) => updateDadosEntry(it.key, e.target.value)}
                      placeholder="(vazio)"
                      autoComplete="off"
                      {...voice.voiceDadosProps(it.key)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div id="memo-audio-review-dados" className={styles.dadosList}>
                <span className={styles.dadosEmpty}>(vazio)</span>
              </div>
            )}
          </div>
        </label>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {processFooterLine ? <p className={styles.reviewProcessFooterLine}>{processFooterLine}</p> : null}

      <div className={styles.actions}>
        <button type="button" className="mm-btn mm-btn--primary" disabled={busy || overLimit} onClick={() => void onSave()}>
          {busy ? "Salvando…" : "Salvar memo"}
        </button>
        <Link to="/" className="mm-btn mm-btn--ghost">
          Descartar
        </Link>
      </div>
      </div>
    </>
  );
}
