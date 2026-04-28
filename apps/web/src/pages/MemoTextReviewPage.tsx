import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { MeResponse, MemoCreatedResponse, TextMemoReviewNavState } from "@mymemory/shared";
import { USER_IA_USE_LABELS, dedupeMemoKeywordsCommaSeparated } from "@mymemory/shared";
import { apiGetOptional, apiPostJson } from "../api";
import Header from "../components/Header";
import { ReviewFileStrip, ReviewHero, urlFileLabel } from "../components/MemoReviewChrome";
import { useMemoReviewVoiceAssistant } from "../hooks/useMemoReviewVoiceAssistant";
import styles from "./MemoTextReviewPage.module.css";

function isReviewState(x: unknown): x is TextMemoReviewNavState {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (
    typeof o.originalText !== "string" ||
    typeof o.suggestedMediaText !== "string" ||
    typeof o.suggestedKeywords !== "string" ||
    typeof o.maxSummaryChars !== "number" ||
    typeof o.apiCost !== "number" ||
    typeof o.iaLevel !== "string" ||
    (o.groupId !== null && typeof o.groupId !== "number")
  ) {
    return false;
  }
  if (o.mediaWebUrl != null && typeof o.mediaWebUrl !== "string") return false;
  if (o.mediaDocumentUrl != null && typeof o.mediaDocumentUrl !== "string") return false;
  return true;
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

export default function MemoTextReviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = useMemo(() => (isReviewState(location.state) ? location.state : null), [location.state]);

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
    if (!state) {
      return;
    }
    setMediaText(state.suggestedMediaText);
    setKeywords(dedupeMemoKeywordsCommaSeparated(state.suggestedKeywords));
    setDadosEspecificosJson(
      typeof state.dadosEspecificosJson === "string" ? state.dadosEspecificosJson.trim() : ""
    );
  }, [state]);

  const overLimit = state != null && mediaText.length > state.maxSummaryChars;

  const onSave = useCallback(async () => {
    if (!state) return;
    if (overLimit || !mediaText.trim()) {
      setError(overLimit ? `Texto excede o máximo de ${state.maxSummaryChars} caracteres.` : "Informe o texto do memo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const href = state.mediaWebUrl?.trim();
      if (href) {
        await apiPostJson<MemoCreatedResponse>("/api/memos/url/confirm", {
          mediaWebUrl: href,
          mediaDocumentUrl:
            typeof state.mediaDocumentUrl === "string" && state.mediaDocumentUrl.trim()
              ? state.mediaDocumentUrl.trim()
              : null,
          mediaText: mediaText.trim(),
          keywords: keywords.trim(),
          groupId: state.groupId,
          apiCost: state.apiCost,
          originalText: state.originalText,
          iaLevel: state.iaLevel,
          dadosEspecificosJson:
            dadosEspecificosJson.trim() ? dadosEspecificosJson.trim() : null,
          dadosEspecificosOriginaisJson: state.dadosEspecificosOriginaisJson ?? null,
          matchedCategoryId: state.matchedCategoryId ?? null,
          category: state.category ?? null,
        });
      } else {
        await apiPostJson<MemoCreatedResponse>("/api/memos/text/confirm", {
          mediaText: mediaText.trim(),
          keywords: keywords.trim(),
          groupId: state.groupId,
          apiCost: state.apiCost,
          originalText: state.originalText,
          iaLevel: state.iaLevel,
          dadosEspecificosJson:
            dadosEspecificosJson.trim()
              ? dadosEspecificosJson.trim()
              : null,
          dadosEspecificosOriginaisJson: state.dadosEspecificosOriginaisJson ?? null,
          matchedCategoryId: state.matchedCategoryId ?? null,
          category: state.category ?? null,
        });
      }
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
    canSave: state != null && !busy && !overLimit && mediaText.trim().length > 0,
    setError,
  });

  if (!state) {
    return (
      <>
        <Header />
        <div className={styles.page}>
          <p>Nada para revisar. Volte à home e envie um memo em texto ou por URL.</p>
        </div>
      </>
    );
  }

  const href = state.mediaWebUrl?.trim() ?? "";
  const isUrl = Boolean(href);
  const stripLeft = isUrl ? urlFileLabel(href) : "memo-texto.txt";
  const stripRight = isUrl
    ? `${state.suggestedMediaText.length.toLocaleString("pt-BR")} caracteres (texto extraído)`
    : `${state.originalText.length.toLocaleString("pt-BR")} caracteres`;
  const dadosPreview = formatDadosEspecificosPreview(dadosEspecificosJson);
  const dadosEntries = parseDadosEntries(dadosEspecificosJson);

  const processFooterSegments: string[] = [];
  if (state.processingWarning?.trim()) processFooterSegments.push(state.processingWarning.trim());
  if (showApiCost) {
    processFooterSegments.push(`Uso de IA: ${USER_IA_USE_LABELS[state.iaLevel]}`);
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
        <ReviewHero mediaKind={isUrl ? "URL" : "texto"} />
        <ReviewFileStrip left={stripLeft} right={stripRight} />

        {voice.voiceBanner}

        <section className={styles.panel} style={{ marginBottom: "1.25rem" }}>
          {isUrl ? (
            <div className={styles.urlOriginalBox}>
              <a href={href} target="_blank" rel="noreferrer">
                {href}
              </a>
            </div>
          ) : (
            <div className={styles.originalBox}>{state.originalText}</div>
          )}
        </section>

      <div className={styles.grid}>
        <label className={styles.fieldLabel} htmlFor="memo-review-body">
          Texto ou Resumo:
          {voice.memoBodyHint ? <span className={styles.hint}>{voice.memoBodyHint}</span> : null}
          <textarea
            id="memo-review-body"
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

        <label className={styles.fieldLabel} htmlFor="memo-review-kw">
          Palavras-chave
          <span className={styles.hint}>{voice.memoKeywordsHint}</span>
          <textarea
            id="memo-review-kw"
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
              <div id="memo-review-dados" className={styles.dadosList}>
                {dadosEntries.map((it) => (
                  <div key={it.key} className={styles.dadosRow}>
                    <span className={styles.dadosKey}>{it.key}:</span>
                    <span className={styles.dadosVal}>{it.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div id="memo-review-dados" className={styles.dadosList}>
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
