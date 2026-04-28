import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ImageMemoReviewNavState, MeResponse, MemoCreatedResponse } from "@mymemory/shared";
import { USER_IA_USE_LABELS, dedupeMemoKeywordsCommaSeparated } from "@mymemory/shared";
import { apiGetOptional, apiPostJson } from "../api";
import Header from "../components/Header";
import {
  ReviewHero,
  ReviewImageLightboxThumb,
  formatReviewBytes,
  reviewFileKindExtension,
} from "../components/MemoReviewChrome";
import { useMemoReviewVoiceAssistant } from "../hooks/useMemoReviewVoiceAssistant";
import styles from "./MemoTextReviewPage.module.css";

const SOURCE_LABELS: Record<ImageMemoReviewNavState["source"], string> = {
  none: "Sem IA / sem extração automática",
  ocr_text: "Texto lido na imagem (fluxo como memo texto)",
  vision_basic: "Descrição visual (básico)",
  vision_full: "Descrição visual + processamento completo",
};

function isImageReviewState(x: unknown): x is ImageMemoReviewNavState {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const tessOk =
    !("tesseractConfidence" in o) ||
    typeof o.tesseractConfidence === "number" ||
    o.tesseractConfidence === null;
  const visionOk =
    !("imageOcrVisionMinConfidence" in o) ||
    typeof o.imageOcrVisionMinConfidence === "number" ||
    o.imageOcrVisionMinConfidence === null;
  const textImagemMinOk =
    !("textImagemMin" in o) ||
    (typeof o.textImagemMin === "number" && Number.isFinite(o.textImagemMin) && o.textImagemMin >= 0);
  return (
    typeof o.originalText === "string" &&
    typeof o.suggestedMediaText === "string" &&
    typeof o.suggestedKeywords === "string" &&
    typeof o.maxSummaryChars === "number" &&
    typeof o.apiCost === "number" &&
    typeof o.iaLevel === "string" &&
    typeof o.mediaImageUrl === "string" &&
    typeof o.originalFilename === "string" &&
    typeof o.tamMediaUrl === "number" &&
    typeof o.source === "string" &&
    (o.groupId === null || typeof o.groupId === "number") &&
    tessOk &&
    visionOk &&
    textImagemMinOk
  );
}

function formatDadosEspecificosPreview(raw: string | null | undefined): string {
  const t = raw?.trim();
  if (!t) return "";
  try {
    const j = JSON.parse(t) as unknown;
    return JSON.stringify(j, null, 2);
  } catch {
    return t;
  }
}

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
      out.push({ key, value: value || "—" });
    }
    return out;
  } catch {
    return [];
  }
}

export default function MemoImageReviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = useMemo(() => (isImageReviewState(location.state) ? location.state : null), [location.state]);

  const [mediaText, setMediaText] = useState("");
  const [keywords, setKeywords] = useState("");
  const [dadosEspecificosJson, setDadosEspecificosJson] = useState("");
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
    setDadosEspecificosJson(
      typeof state.dadosEspecificosJson === "string" ? state.dadosEspecificosJson.trim() : ""
    );
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
      await apiPostJson<MemoCreatedResponse>("/api/memos/image/confirm", {
        mediaText: mediaText.trim(),
        keywords: keywords.trim(),
        dadosEspecificosJson: dadosEspecificosJson.trim() || null,
        groupId: state.groupId,
        apiCost: state.apiCost,
        originalText: state.originalText,
        iaLevel: state.iaLevel,
        dadosEspecificosOriginaisJson: state.dadosEspecificosOriginaisJson ?? null,
        matchedCategoryId: state.matchedCategoryId ?? null,
        category: state.category ?? null,
        mediaImageUrl: state.mediaImageUrl,
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
  }, [state, overLimit, mediaText, keywords, dadosEspecificosJson, navigate]);

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
          <p>Nada para revisar. Volte à home e envie uma imagem.</p>
        </div>
      </>
    );
  }

  const textImagemMinApplied =
    typeof state.textImagemMin === "number" && Number.isFinite(state.textImagemMin)
      ? state.textImagemMin
      : 100;
  /** Texto OCR só é referência editável quando o backend usou o ramo texto ou OCR acima do limiar (sem visão como principal). */
  const showOriginalTextReference =
    state.source === "ocr_text" ||
    (state.source === "none" && state.originalText.trim().length > textImagemMinApplied);

  const tessConf =
    "tesseractConfidence" in state && (typeof state.tesseractConfidence === "number" || state.tesseractConfidence === null)
      ? state.tesseractConfidence
      : undefined;
  const visionLimit =
    "imageOcrVisionMinConfidence" in state &&
    (typeof state.imageOcrVisionMinConfidence === "number" || state.imageOcrVisionMinConfidence === null)
      ? state.imageOcrVisionMinConfidence
      : undefined;
  const tesseractConfAsideText = (() => {
    if (tessConf === undefined) return "";
    const lim =
      typeof visionLimit === "number" && visionLimit >= 1 && visionLimit <= 100 ? visionLimit : null;
    const valPart = tessConf === null ? "n/d" : String(Math.round(tessConf));
    return lim != null ? `${valPart}/${lim}` : valPart;
  })();
  const showTesseractConfAside =
    showApiCost && state.iaLevel !== "semIA" && tessConf !== undefined && tesseractConfAsideText.length > 0;

  const kindExt = reviewFileKindExtension(state.originalFilename);

  const processFooterSegments: string[] = [];
  if (state.processingWarning?.trim()) processFooterSegments.push(state.processingWarning.trim());
  if (showTesseractConfAside) {
    processFooterSegments.push(`Confiança Tesseract (anterior): ${tesseractConfAsideText}`);
  }
  if (showApiCost) {
    processFooterSegments.push(`Uso de IA: ${USER_IA_USE_LABELS[state.iaLevel]}`);
    processFooterSegments.push(`Origem do texto: ${SOURCE_LABELS[state.source] ?? state.source}`);
    processFooterSegments.push(
      `Custo API (USD): ${state.apiCost.toFixed(6)} · Créditos estimados: ${(state.apiCost * usdToCreditsMultiplier).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      })}`
    );
  }
  const processFooterLine = processFooterSegments.join(" · ");
  const dadosPreview = formatDadosEspecificosPreview(dadosEspecificosJson);
  const dadosEntries = parseDadosEntries(dadosEspecificosJson);

  return (
    <>
      <Header />
      <div className={styles.page}>
        <ReviewHero mediaKind="imagem" kindExtension={kindExt} />

        {voice.voiceBanner}

        <div className={styles.reviewOriginalFileMeta}>
          {state.originalFilename} · {formatReviewBytes(state.tamMediaUrl)}
          {showOriginalTextReference ? (
            <>
              {" · "}
              {state.originalText.length.toLocaleString("pt-BR")} caracteres (texto de referência OCR)
            </>
          ) : null}
        </div>

        <section className={styles.panel} style={{ marginBottom: "1.25rem" }}>
          <ReviewImageLightboxThumb src={state.mediaImageUrl} alt={`Imagem: ${state.originalFilename}`} />
        </section>

        {showOriginalTextReference ? (
          <section className={styles.panel} style={{ marginBottom: "1.25rem" }}>
            <div className={styles.originalBox}>{state.originalText}</div>
          </section>
        ) : null}

      <div className={styles.grid}>
        <label className={styles.fieldLabel} htmlFor="memo-image-review-body">
          Texto ou Resumo:
          {voice.memoBodyHint ? <span className={styles.hint}>{voice.memoBodyHint}</span> : null}
          <textarea
            id="memo-image-review-body"
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

        <label className={styles.fieldLabel} htmlFor="memo-image-review-kw">
          Palavras-chave
          <span className={styles.hint}>{voice.memoKeywordsHint}</span>
          <textarea
            id="memo-image-review-kw"
            ref={kwRef}
            className={[styles.keywordsInput, voice.keywordsAreaExtraClass].filter(Boolean).join(" ")}
            rows={2}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            {...voice.voiceKeywordsAreaProps}
            placeholder="ex.: reunião, projeto, cliente X"
            autoComplete="off"
          />
          <div className={styles.dadosInlineBox}>
            <div className={styles.dadosInlineTitle}>Dados específicos</div>
            {dadosEntries.length > 0 ? (
              <div id="memo-image-review-dados" className={styles.dadosList}>
                {dadosEntries.map((it) => (
                  <div key={it.key} className={styles.dadosRow}>
                    <span className={styles.dadosKey}>{it.key}:</span>
                    <span className={styles.dadosVal}>{it.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div id="memo-image-review-dados" className={styles.dadosList}>
                <span className={styles.dadosEmpty}>{dadosPreview || "(vazio)"}</span>
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
