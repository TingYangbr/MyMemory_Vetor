import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { MemoCreatedResponse, MeResponse, VideoMemoReviewNavState } from "@mymemory/shared";
import { USER_IA_USE_LABELS, dedupeMemoKeywordsCommaSeparated } from "@mymemory/shared";
import { apiGetOptional, apiPostJson } from "../api";
import Header from "../components/Header";
import { ReviewHero, formatReviewBytes, reviewFileKindExtension } from "../components/MemoReviewChrome";
import { useMemoReviewVoiceAssistant } from "../hooks/useMemoReviewVoiceAssistant";
import styles from "./MemoTextReviewPage.module.css";

const SOURCE_LABELS: Record<VideoMemoReviewNavState["source"], string> = {
  none: "Sem IA / sem transcrição automática",
  video_basic: "Transcrição + IA básico (uma chamada, prompt de vídeo)",
  video_full: "Transcrição + IA completo (categoria e subcategorias/campos)",
  video_segmented: "Transcrição por segmentos temporais + IA (arquivo grande)",
  video_vision_basic: "Pouca fala (≤ limiar texto) — fotogramas + IA básico (uma chamada)",
  video_vision_full: "Pouca fala (≤ limiar texto) — fotogramas + IA completo (duas chamadas)",
};

const IA_LEVELS = new Set<string>(["semIA", "basico", "completo"]);
const SOURCES = new Set<string>([
  "none",
  "video_basic",
  "video_full",
  "video_segmented",
  "video_vision_basic",
  "video_vision_full",
]);

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

function parseVideoReviewLocationState(raw: unknown): VideoMemoReviewNavState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const iaLevel = readStr(o, "iaLevel");
  if (!IA_LEVELS.has(iaLevel)) return null;

  const source = readStr(o, "source");
  if (!SOURCES.has(source)) return null;

  const mediaVideoUrl = readStr(o, "mediaVideoUrl").trim();
  if (!mediaVideoUrl) return null;

  const maxSummaryChars = readFiniteNumber(o, "maxSummaryChars");
  const apiCost = readFiniteNumber(o, "apiCost");
  const tamMediaUrl = readFiniteNumber(o, "tamMediaUrl");
  if (maxSummaryChars == null || maxSummaryChars < 0) return null;
  if (apiCost == null || apiCost < 0) return null;
  if (tamMediaUrl == null || tamMediaUrl < 0) return null;

  const pw = o.processingWarning;
  const processingWarning =
    typeof pw === "string" ? pw : pw === null ? null : undefined;

  const textImagemMin = readFiniteNumber(o, "textImagemMin");

  return {
    originalText: readStr(o, "originalText"),
    suggestedMediaText: readStr(o, "suggestedMediaText"),
    suggestedKeywords: readStr(o, "suggestedKeywords"),
    maxSummaryChars,
    apiCost,
    iaLevel: iaLevel as VideoMemoReviewNavState["iaLevel"],
    processingWarning,
    mediaVideoUrl,
    originalFilename: readStr(o, "originalFilename"),
    tamMediaUrl,
    source: source as VideoMemoReviewNavState["source"],
    groupId: parseGroupId(o),
    ...(textImagemMin != null && textImagemMin >= 0 ? { textImagemMin } : {}),
  };
}

export default function MemoVideoReviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = useMemo(() => parseVideoReviewLocationState(location.state), [location.state]);

  const [mediaText, setMediaText] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApiCost, setShowApiCost] = useState(true);
  const [usdToCreditsMultiplier, setUsdToCreditsMultiplier] = useState(100);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const kwRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (!r.ok) return;
      if (r.data.showApiCost === false) setShowApiCost(false);
      setSoundEnabled(r.data.soundEnabled !== false);
      const m = r.data.usdToCreditsMultiplier;
      if (typeof m === "number" && Number.isFinite(m) && m > 0) setUsdToCreditsMultiplier(m);
    });
  }, []);

  useEffect(() => {
    if (!state) return;
    setMediaText(state.suggestedMediaText);
    setKeywords(dedupeMemoKeywordsCommaSeparated(state.suggestedKeywords));
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
      await apiPostJson<MemoCreatedResponse>("/api/memos/video/confirm", {
        mediaText: mediaText.trim(),
        keywords: keywords.trim(),
        groupId: state.groupId,
        apiCost: state.apiCost,
        originalText: state.originalText,
        iaLevel: state.iaLevel,
        mediaVideoUrl: state.mediaVideoUrl,
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
  }, [state, overLimit, mediaText, keywords, navigate]);

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
  });

  if (!state) {
    return (
      <>
        <Header />
        <div className={styles.page}>
          <p>Nada para revisar. Volte à home e envie um vídeo.</p>
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
        <ReviewHero mediaKind="vídeo" kindExtension={kindExt} />

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
            <video src={state.mediaVideoUrl} controls playsInline preload="metadata" style={{ width: "100%", maxWidth: "520px" }} />
          </div>
        </section>

        {showTranscriptBlock ? (
          <section className={styles.panel} style={{ marginBottom: "1.25rem" }}>
            <h2 className={styles.panelTitle}>Texto transcrito do vídeo (referência)</h2>
            <div className={styles.originalBox}>{state.originalText}</div>
          </section>
        ) : null}

        <div className={styles.grid}>
          <label className={styles.fieldLabel} htmlFor="memo-video-review-body">
            Texto ou Resumo:
            {voice.memoBodyHint ? <span className={styles.hint}>{voice.memoBodyHint}</span> : null}
            <textarea
              id="memo-video-review-body"
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

          <label className={styles.fieldLabel} htmlFor="memo-video-review-kw">
            Palavras-chave
            <span className={styles.hint}>{voice.memoKeywordsHint}</span>
            <textarea
              id="memo-video-review-kw"
              ref={kwRef}
              className={[styles.keywordsInput, voice.keywordsAreaExtraClass].filter(Boolean).join(" ")}
              rows={2}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              {...voice.voiceKeywordsAreaProps}
              placeholder="ex.: reunião, decisão, cliente"
              autoComplete="off"
            />
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
