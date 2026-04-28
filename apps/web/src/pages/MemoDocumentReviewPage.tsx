import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type {
  DocumentMemoProcessResponse,
  DocumentMemoReviewLocationState,
  MeResponse,
  MemoCreatedResponse,
} from "@mymemory/shared";
import { USER_IA_USE_LABELS, dedupeMemoKeywordsCommaSeparated } from "@mymemory/shared";
import { apiGetOptional, apiPostJson } from "../api";
import Header from "../components/Header";
import MemoProcessOverlay, {
  DOCUMENT_MEMO_PROCESS_STEPS,
  STANDARD_MEMO_PROCESS_STEPS,
} from "../components/MemoProcessOverlay";
import {
  ReviewHero,
  formatReviewBytes,
  resolveMediaPublicHref,
  reviewFileKindExtension,
} from "../components/MemoReviewChrome";
import { useMemoReviewVoiceAssistant } from "../hooks/useMemoReviewVoiceAssistant";
import styles from "./MemoTextReviewPage.module.css";

function isLocationState(x: unknown): x is DocumentMemoReviewLocationState {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.memoId !== "number" || !(o.groupId === null || typeof o.groupId === "number")) return false;
  if (o.iaUseDocumento === undefined) return true;
  return o.iaUseDocumento === "semIA" || o.iaUseDocumento === "basico" || o.iaUseDocumento === "completo";
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

export default function MemoDocumentReviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locState = useMemo(() => (isLocationState(location.state) ? location.state : null), [location.state]);

  const [processResult, setProcessResult] = useState<DocumentMemoProcessResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [docProcessPhaseIdx, setDocProcessPhaseIdx] = useState(0);
  const docProcessAbortRef = useRef<AbortController | null>(null);

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
    if (!locState) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    docProcessAbortRef.current = ac;
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    void apiPostJson<DocumentMemoProcessResponse>(
      "/api/memos/document/process",
      {
        memoId: locState.memoId,
        groupId: locState.groupId,
        iaUseDocumento: locState.iaUseDocumento,
      },
      { signal: ac.signal }
    )
      .then((out) => {
        if (cancelled) return;
        setProcessResult(out);
        setMediaText(out.suggestedMediaText);
        setKeywords(dedupeMemoKeywordsCommaSeparated(out.suggestedKeywords));
        setDadosEspecificosJson(
          typeof out.dadosEspecificosJson === "string" ? out.dadosEspecificosJson.trim() : ""
        );
      })
      .catch((e) => {
        if (cancelled) return;
        const aborted =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError");
        if (aborted) {
          setLoadErr("Processamento cancelado.");
          return;
        }
        setLoadErr(e instanceof Error ? e.message : "Falha ao processar documento.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
      docProcessAbortRef.current = null;
    };
  }, [locState]);

  useEffect(() => {
    if (!locState || !loading) return;
    setDocProcessPhaseIdx(0);
    const id = window.setInterval(() => {
      setDocProcessPhaseIdx((i) => Math.min(i + 1, STANDARD_MEMO_PROCESS_STEPS.length - 1));
    }, 4200);
    return () => window.clearInterval(id);
  }, [locState, loading]);

  const overLimit =
    processResult != null && mediaText.length > processResult.maxSummaryChars;

  const onSave = useCallback(async () => {
    if (!processResult || !locState) return;
    if (overLimit || !mediaText.trim()) {
      setError(
        overLimit
          ? `Texto excede o máximo de ${processResult.maxSummaryChars} caracteres.`
          : "Informe o texto do memo."
      );
      return;
    }
    const st = processResult;
    setBusy(true);
    setError(null);
    try {
      await apiPostJson<MemoCreatedResponse>("/api/memos/document/confirm", {
        memoId: st.memoId,
        mediaText: mediaText.trim(),
        keywords: keywords.trim(),
        dadosEspecificosJson: dadosEspecificosJson.trim() ? dadosEspecificosJson.trim() : null,
        dadosEspecificosOriginaisJson: st.dadosEspecificosOriginaisJson ?? null,
        matchedCategoryId: st.matchedCategoryId ?? null,
        category: st.category ?? null,
        groupId: locState.groupId,
        apiCost: st.apiCost,
        originalText: st.originalText,
        iaLevel: st.iaLevel,
        mediaDocumentUrl: st.mediaDocumentUrl,
        tamMediaUrl: st.tamMediaUrl,
        originalFilename: st.originalFilename,
        mime: st.mime,
        pipelineUsed: st.pipelineUsed,
      });
      navigate("/", { replace: true, state: { memoSavedAt: Date.now() } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }, [overLimit, mediaText, keywords, dadosEspecificosJson, locState, processResult, navigate]);

  const voice = useMemoReviewVoiceAssistant({
    soundEnabled,
    active: Boolean(processResult),
    mediaText,
    setMediaText,
    keywords,
    setKeywords,
    textAreaRef: bodyRef,
    keywordsAreaRef: kwRef,
    onSave,
    canSave: Boolean(processResult) && !busy && !overLimit && mediaText.trim().length > 0,
    setError,
  });

  if (!locState) {
    return (
      <>
        <Header />
        <div className={styles.page}>
          <p>Nada para revisar. Envie um documento na home (com IA ativa).</p>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <MemoProcessOverlay
        title="Processando o documento"
        titleId="doc-process-title"
        hint="Não feche a página nem use «Descartar»."
        steps={DOCUMENT_MEMO_PROCESS_STEPS}
        activeStepIndex={docProcessPhaseIdx}
        onDiscard={() => {
          docProcessAbortRef.current?.abort();
          navigate("/", { replace: true });
        }}
      />
    );
  }

  if (loadErr || !processResult) {
    return (
      <>
        <Header />
        <div className={styles.page}>
          <p className="mm-error">{loadErr ?? "Erro desconhecido."}</p>
        </div>
      </>
    );
  }

  const state = processResult;
  const docHref = resolveMediaPublicHref(state.mediaDocumentUrl);
  const kindExt = reviewFileKindExtension(state.originalFilename);
  const dadosPreview = formatDadosEspecificosPreview(dadosEspecificosJson);
  const dadosEntries = parseDadosEntries(dadosEspecificosJson);

  const processFooterSegments: string[] = [];
  if (state.processingWarning?.trim()) processFooterSegments.push(state.processingWarning.trim());
  if (showApiCost) {
    processFooterSegments.push(`Uso de IA: ${USER_IA_USE_LABELS[state.iaLevel]}`);
    processFooterSegments.push(`Pipeline: ${state.pipelineUsed}`);
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
        <ReviewHero mediaKind="documento" kindExtension={kindExt} />

        {voice.voiceBanner}

        <div className={styles.reviewOriginalFileMeta}>
          {state.originalFilename} · {formatReviewBytes(state.tamMediaUrl)} · {state.mime} ·{" "}
          <code>{state.pipelineUsed}</code>
        </div>

        <p style={{ margin: "0 0 0.85rem", fontSize: "0.9rem" }}>
          <a href={docHref} target="_blank" rel="noreferrer">
            Abrir documento original
          </a>
        </p>

        {state.pipelineUsed === "skip_extract" ? (
          <section className={styles.panel} style={{ marginBottom: "1.25rem" }}>
            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--color-warning, #b45309)" }}>
              Arquivo binário sem extração de texto disponível. Preencha o resumo e as palavras-chave manualmente abaixo.
            </p>
          </section>
        ) : (
          <section className={styles.panel} style={{ marginBottom: "1.25rem" }}>
            <div className={styles.originalBox}>{state.originalText || "—"}</div>
          </section>
        )}

      <div className={styles.grid}>
        <label className={styles.fieldLabel} htmlFor="memo-doc-review-body">
          Texto ou Resumo:
          {voice.memoBodyHint ? <span className={styles.hint}>{voice.memoBodyHint}</span> : null}
          <textarea
            id="memo-doc-review-body"
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

        <label className={styles.fieldLabel} htmlFor="memo-doc-review-kw">
          Palavras-chave
          <span className={styles.hint}>{voice.memoKeywordsHint}</span>
          <textarea
            id="memo-doc-review-kw"
            ref={kwRef}
            className={[styles.keywordsInput, voice.keywordsAreaExtraClass].filter(Boolean).join(" ")}
            rows={2}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            {...voice.voiceKeywordsAreaProps}
            placeholder="ex.: contrato, fornecedor"
            autoComplete="off"
          />
          <div className={styles.dadosInlineBox}>
            <div className={styles.dadosInlineTitle}>Dados específicos</div>
            {dadosEntries.length > 0 ? (
              <div id="memo-doc-review-dados" className={styles.dadosList}>
                {dadosEntries.map((it) => (
                  <div key={it.key} className={styles.dadosRow}>
                    <span className={styles.dadosKey}>{it.key}:</span>
                    <span className={styles.dadosVal}>{it.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div id="memo-doc-review-dados" className={styles.dadosList}>
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
