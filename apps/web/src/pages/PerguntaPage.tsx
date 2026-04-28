import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  MeResponse,
  MemoRecentCard,
  PerguntaCardHistorico,
  PerguntaLlmTraceEntry,
  PerguntaResponse,
  PerguntaResultadoEstruturado,
} from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPatchJson, apiPostJson } from "../api";
import Header from "../components/Header";
import { MemoFilePreviewModal } from "../components/MemoFilePreviewModal";
import { MemoResultListRow } from "../components/MemoResultListRow";
import styles from "./PerguntaPage.module.css";

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

const COLUNA_LABELS: Record<string, string> = {
  id: "ID", resumo: "Resumo", keywords: "Keywords",
  mediaType: "Tipo", data: "Data", total: "Total", mes: "Mês",
};

const MEDIA_TYPE_LABELS: Record<string, string> = {
  text: "Texto", audio: "Áudio", image: "Imagem",
  video: "Vídeo", document: "Documento", url: "URL",
};

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/gs, "$1")
    .replace(/\*(.*?)\*/gs, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1");
}

function IconSpeaker({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TabelaEstruturada({ dados }: { dados: PerguntaResultadoEstruturado }) {
  if (!dados.totalLinhas) return null;
  return (
    <div className={styles.tabelaWrap}>
      <table className={styles.tabela}>
        <thead>
          <tr>
            {dados.colunas.map((col) => (
              <th key={col} className={styles.tabelaTh}>{COLUNA_LABELS[col] ?? col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dados.linhas.map((linha, i) => (
            <tr key={i} className={styles.tabelaTr}>
              {dados.colunas.map((col) => {
                const val = linha[col];
                const display =
                  col === "mediaType" && typeof val === "string"
                    ? (MEDIA_TYPE_LABELS[val] ?? val)
                    : val == null ? "—" : String(val);
                return (
                  <td key={col} className={styles.tabelaTd}>{display}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {dados.totalLinhas > dados.linhas.length ? (
        <p className={styles.tabelaRodape}>
          Mostrando {dados.linhas.length} de {dados.totalLinhas} registros.
        </p>
      ) : null}
    </div>
  );
}

function tryPrettifyJson(text: string): string {
  const t = text.trim();
  const i = t.indexOf("{");
  const k = t.lastIndexOf("}");
  if (i >= 0 && k > i) {
    try {
      const parsed = JSON.parse(t.slice(i, k + 1)) as unknown;
      const pretty = JSON.stringify(parsed, null, 2);
      return t.slice(0, i) + pretty + t.slice(k + 1);
    } catch { /* não é JSON válido */ }
  }
  return text;
}

function LlmTraceModal({
  trace,
  pergunta,
  onClose,
}: {
  trace: PerguntaLlmTraceEntry[];
  pergunta: string;
  onClose: () => void;
}) {
  return (
    <div className={styles.traceOverlay} onClick={onClose}>
      <div className={styles.traceModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.traceHeader}>
          <span className={styles.traceTitle}>LLM Trace</span>
          <span className={styles.traceSubtitle} title={pergunta}>"{pergunta}"</span>
          <button type="button" className={styles.traceCloseBtn} onClick={onClose} title="Fechar">×</button>
        </div>
        <div className={styles.traceBody}>
          {trace.length === 0 ? (
            <p className={styles.traceEmpty}>Nenhuma chamada LLM registrada para esta resposta.</p>
          ) : trace.map((entry, idx) => (
            <div key={idx} className={styles.traceEntry}>
              <div className={styles.traceEntryHeader}>
                <span className={styles.traceEntryIndex}>#{idx + 1}</span>
                <span className={styles.traceEntrySource}>{entry.source}</span>
                <span className={styles.traceEntryModel}>{entry.model}</span>
                <span className={styles.traceEntryProvider}>{entry.provider}</span>
              </div>
              <div className={styles.traceMessages}>
                {entry.messages.map((msg, mi) => (
                  <div
                    key={mi}
                    className={`${styles.traceMessage} ${
                      msg.role === "system" ? styles.traceRoleSystem
                      : msg.role === "user" ? styles.traceRoleUser
                      : styles.traceRoleAssistant
                    }`}
                  >
                    <div className={styles.traceMessageRole}>{msg.role}</div>
                    <pre className={styles.traceMessageContent}>{tryPrettifyJson(msg.content)}</pre>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const SILENCE_MS = 3000;

type SearchAuthorOption = { id: number; name: string | null; email: string | null };

interface SpeechRecInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: {
    resultIndex: number;
    results: { length: number; [i: number]: { isFinal: boolean; [k: number]: { transcript: string } } };
  }) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: (() => void) | null;
}

function stripPunctuation(t: string): string {
  return t.replace(/[.!?,;:]+$/g, "").trim();
}

export default function PerguntaPage() {
  const navigate = useNavigate();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [ready, setReady] = useState(false);
  const [pergunta, setPergunta] = useState("");
  const [historico, setHistorico] = useState<PerguntaCardHistorico[]>([]);
  const [respostas, setRespostas] = useState<(PerguntaResponse & { perguntaTexto: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refazerIdx, setRefazerIdx] = useState<number | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [cardMemo, setCardMemo] = useState<MemoRecentCard | null>(null);
  const [filePreviewMemo, setFilePreviewMemo] = useState<MemoRecentCard | null>(null);
  const [loadingCardId, setLoadingCardId] = useState<number | null>(null);
  const [memoEditMode, setMemoEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [editDados, setEditDados] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [traceModal, setTraceModal] = useState<{ trace: PerguntaLlmTraceEntry[]; pergunta: string } | null>(null);
  const [ttsBusyPergunta, setTtsBusyPergunta] = useState<string | null>(null);
  const ttsBusyRef = useRef<string | null>(null);
  const prevRespostasLenRef = useRef(0);

  // Filtros
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAuthorId, setFilterAuthorId] = useState<number | null>(null);
  const [filterModal, setFilterModal] = useState<null | "quando" | "quem">(null);
  const [draftDateFrom, setDraftDateFrom] = useState("");
  const [draftDateTo, setDraftDateTo] = useState("");
  const [draftAuthorId, setDraftAuthorId] = useState<number | null>(null);
  const [authorOptions, setAuthorOptions] = useState<SearchAuthorOption[]>([]);

  // Voz
  const [micState, setMicState] = useState<"idle" | "listening" | "done">("idle");
  const [voiceAutoSubmitText, setVoiceAutoSubmitText] = useState<string | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceSessionRef = useRef(0);
  const voiceTranscriptRef = useRef("");
  const voiceHadResultRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const workspaceGroupId = me?.lastWorkspaceGroupId ?? null;
  const isGroup = workspaceGroupId != null;

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (r.ok) {
        setMe(r.data);
        setReady(true);
        return;
      }
      if (r.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      setReady(true);
    }).catch(() => setReady(true));
  }, [navigate]);

  useEffect(() => {
    if (!isGroup) return;
    apiGetOptional<{ authors: SearchAuthorOption[] }>("/api/memos/search-authors?groupId=" + workspaceGroupId)
      .then((r) => { if (r.ok) setAuthorOptions(r.data.authors); })
      .catch(() => {});
  }, [isGroup, workspaceGroupId]);

  // Auto-submit após timeout de silêncio: usa estado para evitar closure stale
  useEffect(() => {
    if (!voiceAutoSubmitText) return;
    setVoiceAutoSubmitText(null);
    void enviar({ perguntaOverride: voiceAutoSubmitText });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceAutoSubmitText]);

  const stopListening = useCallback((toState: "idle" | "done" = "idle") => {
    voiceSessionRef.current = 0;
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    try { rec?.stop?.(); } catch { /* já parado */ }
    setMicState(toState);
  }, []);

  const startListening = useCallback(() => {
    const SR =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecInstance }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecInstance }).webkitSpeechRecognition;
    if (!SR) { setError("Voz não disponível neste navegador. Use Chrome ou Edge."); return; }

    setError(null);
    stopListening();
    voiceHadResultRef.current = false;
    voiceTranscriptRef.current = "";
    const sessionId = ++voiceSessionRef.current;

    let rec: SpeechRecInstance;
    try { rec = new SR(); } catch {
      voiceSessionRef.current = 0;
      setError("Não foi possível iniciar o reconhecimento de voz.");
      return;
    }

    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (ev) => {
      if (voiceSessionRef.current !== sessionId) return;
      let display = "";
      for (let i = 0; i < ev.results.length; i++) display += ev.results[i]![0]!.transcript;
      const t = stripPunctuation(display);
      if (t) {
        voiceTranscriptRef.current = t;
        voiceHadResultRef.current = true;
        setPergunta(t);
      }
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        silenceTimerRef.current = null;
        if (voiceSessionRef.current !== sessionId) return;
        const transcript = voiceTranscriptRef.current;
        stopListening("idle");
        if (transcript) setVoiceAutoSubmitText(transcript);
      }, SILENCE_MS);
    };

    rec.onerror = (ev: Event) => {
      const code = (ev as Event & { error?: string }).error ?? "";
      if (voiceSessionRef.current !== sessionId) return;
      const map: Record<string, string> = {
        "not-allowed": "Microfone bloqueado. Permita o acesso nas configurações do navegador.",
        "no-speech": "Não foi detectada fala. Tente de novo.",
        network: "Erro de rede no reconhecimento de voz.",
      };
      const msg = map[code];
      if (msg) setError(msg);
      else if (code && code !== "aborted") setError(`Voz: ${code}`);
      stopListening();
    };

    rec.onend = () => {
      if (voiceSessionRef.current !== sessionId) return;
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      recognitionRef.current = null;
      voiceSessionRef.current = 0;
      setMicState("done");
    };

    recognitionRef.current = rec;
    setMicState("listening");
    try { rec.start(); } catch {
      voiceSessionRef.current = 0;
      recognitionRef.current = null;
      setMicState("idle");
      setError("Não foi possível iniciar o microfone.");
    }
  }, [stopListening]);

  async function enviar(opts?: { forcePipe?: "semantica" | "estruturada" | "hibrida"; perguntaOverride?: string; thresholdOverride?: number; forceCategories?: string[] }) {
    const q = (opts?.perguntaOverride ?? pergunta).trim();
    if (!q || busy) return;
    setError(null);
    setBusy(true);
    setRefazerIdx(null);
    setPendingQuestion(q);
    try {
      const body: Record<string, unknown> = {
        pergunta: q,
        workspaceGroupId: workspaceGroupId ?? null,
        filtros: {
          autorId: filterAuthorId,
          dataInicio: filterDateFrom || null,
          dataFim: filterDateTo || null,
        },
        contextoSessao: historico,
      };
      if (opts?.forcePipe) body.forcePipe = opts.forcePipe;
      if (opts?.thresholdOverride != null) body.thresholdOverride = opts.thresholdOverride;
      if (opts?.forceCategories) body.forceCategories = opts.forceCategories;
      const res = await apiPostJson<PerguntaResponse>("/api/perguntas", body);
      const card = { ...res, perguntaTexto: q };
      setRespostas((prev) => [card, ...prev]);
      setHistorico((prev) => [
        ...prev,
        { pergunta: q, resposta: res.resposta.resposta, pipe: res.classificacao.pipe },
      ].slice(-5));
      setPergunta("");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      try { const j = JSON.parse(raw) as { message?: string }; setError(j.message ?? raw); }
      catch { setError(raw || "Não foi possível obter a resposta."); }
    } finally {
      setBusy(false);
      setPendingQuestion(null);
    }
  }

  async function openMemoCard(id: number) {
    if (loadingCardId === id) return;
    setLoadingCardId(id);
    try {
      const card = await apiGet<MemoRecentCard>(`/api/memos/${id}/card`);
      setCardMemo(card);
    } catch {
      /* silencioso — memo pode não estar mais acessível */
    } finally {
      setLoadingCardId(null);
    }
  }

  function speakText(key: string, text: string) {
    if (typeof window.speechSynthesis === "undefined") return;
    window.speechSynthesis.cancel();
    ttsBusyRef.current = key;
    setTtsBusyPergunta(key);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    u.onend = () => { ttsBusyRef.current = null; setTtsBusyPergunta(null); };
    u.onerror = () => { ttsBusyRef.current = null; setTtsBusyPergunta(null); };
    window.speechSynthesis.speak(u);
  }

  function toggleSpeakResposta(key: string, text: string) {
    if (typeof window.speechSynthesis === "undefined") return;
    if (ttsBusyRef.current === key) {
      window.speechSynthesis.cancel();
      ttsBusyRef.current = null;
      setTtsBusyPergunta(null);
      return;
    }
    speakText(key, text);
  }

  // Auto-narrar a resposta mais recente quando soundEnabled
  useEffect(() => {
    const prev = prevRespostasLenRef.current;
    prevRespostasLenRef.current = respostas.length;
    if (respostas.length > prev && me?.soundEnabled && respostas[0]) {
      const r = respostas[0];
      speakText(r.perguntaTexto, r.resposta.resposta);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respostas.length]);

  function handleCloseMemoCard() {
    setCardMemo(null);
    setMemoEditMode(false);
  }

  function handleOpenMemoEdit(m: MemoRecentCard) {
    setEditText(m.mediaText ?? "");
    setEditKeywords(m.keywords ?? "");
    setEditDados(m.dadosEspecificosJson ?? "");
    setEditError(null);
    setMemoEditMode(true);
  }

  async function handleSaveMemoEdit() {
    if (!cardMemo) return;
    setEditBusy(true);
    setEditError(null);
    try {
      await apiPatchJson<unknown>(`/api/memos/${cardMemo.id}`, {
        mediaText: editText.trim(),
        keywords: editKeywords.trim() || null,
        dadosEspecificosJson: editDados.trim() || null,
      });
      setCardMemo({ ...cardMemo, mediaText: editText.trim(), keywords: editKeywords.trim() || null, dadosEspecificosJson: editDados.trim() || null });
      setMemoEditMode(false);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setEditBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); }
  }

  function openFilterModal(modal: "quando" | "quem") {
    setDraftDateFrom(filterDateFrom);
    setDraftDateTo(filterDateTo);
    setDraftAuthorId(filterAuthorId);
    setFilterModal(modal);
  }

  function applyFilter() {
    if (filterModal === "quando") {
      setFilterDateFrom(draftDateFrom);
      setFilterDateTo(draftDateTo);
    } else if (filterModal === "quem") {
      setFilterAuthorId(draftAuthorId);
    }
    setFilterModal(null);
  }

  function clearFilter(which: "quando" | "quem") {
    if (which === "quando") { setFilterDateFrom(""); setFilterDateTo(""); }
    else { setFilterAuthorId(null); }
  }

  const hasQuando = !!(filterDateFrom || filterDateTo);
  const hasQuem = filterAuthorId != null;

  function renderPipeLabel(pipe: string) {
    if (pipe === "semantica") return "Semântico";
    if (pipe === "estruturada") return "Estruturado";
    if (pipe === "hibrida") return "Híbrido";
    return pipe;
  }

  if (!ready) {
    return (
      <div className={styles.shell}>
        <Header />
        <main className={styles.main}><p className={styles.muted}>Carregando…</p></main>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <Header meRefreshKey={0} />

      {filterModal ? (
        <div className={styles.filterOverlay} onClick={() => setFilterModal(null)}>
          <div className={styles.filterModal} onClick={(e) => e.stopPropagation()}>
            {filterModal === "quando" ? (
              <>
                <h3 className={styles.filterModalTitle}>Filtrar por período</h3>
                <label className={styles.filterLabel}>
                  De
                  <input type="date" className={styles.filterInput} value={draftDateFrom} onChange={(e) => setDraftDateFrom(e.target.value)} />
                </label>
                <label className={styles.filterLabel}>
                  Até
                  <input type="date" className={styles.filterInput} value={draftDateTo} onChange={(e) => setDraftDateTo(e.target.value)} />
                </label>
              </>
            ) : (
              <>
                <h3 className={styles.filterModalTitle}>Filtrar por autor</h3>
                <div className={styles.authorList}>
                  <label className={styles.authorOption}>
                    <input type="radio" name="author" checked={draftAuthorId === null} onChange={() => setDraftAuthorId(null)} />
                    Todos
                  </label>
                  {authorOptions.map((a) => (
                    <label key={a.id} className={styles.authorOption}>
                      <input type="radio" name="author" checked={draftAuthorId === a.id} onChange={() => setDraftAuthorId(a.id)} />
                      {a.name ?? a.email ?? `#${a.id}`}
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className={styles.filterActions}>
              <button type="button" className="mm-btn mm-btn--primary" onClick={applyFilter}>Aplicar</button>
              <button type="button" className="mm-btn" onClick={() => setFilterModal(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : null}

      <main className={styles.main}>
        <div className={styles.topBar}>
          <h1 className={styles.pageTitle}>Pergunte ao myMemory</h1>
          <div className={styles.filters}>
            {isGroup ? (
              <button
                type="button"
                className={`${styles.filterBtn} ${hasQuem ? styles.filterBtnActive : ""}`}
                onClick={() => openFilterModal("quem")}
              >
                Quem {hasQuem ? "✓" : ""}
                {hasQuem ? (
                  <span className={styles.filterClear} onClick={(e) => { e.stopPropagation(); clearFilter("quem"); }} title="Limpar">×</span>
                ) : null}
              </button>
            ) : null}
            <button
              type="button"
              className={`${styles.filterBtn} ${hasQuando ? styles.filterBtnActive : ""}`}
              onClick={() => openFilterModal("quando")}
            >
              Quando {hasQuando ? "✓" : ""}
              {hasQuando ? (
                <span className={styles.filterClear} onClick={(e) => { e.stopPropagation(); clearFilter("quando"); }} title="Limpar">×</span>
              ) : null}
            </button>
          </div>
        </div>

        <div className={styles.inputArea}>
          <textarea
            ref={textareaRef}
            className={styles.perguntaInput}
            placeholder="Digite sua pergunta ou fale clicando no microfone abaixo…"
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            disabled={busy}
          />
          <div className={styles.inputActions}>
            <button
              type="button"
              className={`${styles.micBtn} ${micState === "listening" ? styles.micBtnActive : ""}`}
              onClick={() => micState === "listening" ? stopListening("done") : startListening()}
              title={micState === "listening" ? "Clique para parar" : "Clique para falar"}
              disabled={busy}
            >
              {micState === "listening" ? "⏹ Parar" : "🎤 Falar"}
            </button>
            <button
              type="button"
              className="mm-btn mm-btn--primary"
              onClick={() => void enviar()}
              disabled={busy || !pergunta.trim()}
            >
              {busy ? "Processando…" : "Perguntar"}
            </button>
          </div>
        </div>

        {error ? <p className="mm-error" role="alert">{error}</p> : null}

        {pendingQuestion ? (
          <div className={styles.cards}>
            <article className={`${styles.card} ${styles.cardPending}`}>
              <div className={styles.cardPergunta}>
                <span className={styles.cardPerguntaIcon} aria-hidden>❓</span>
                <p className={styles.cardPerguntaText}>{pendingQuestion}</p>
              </div>
              <div className={styles.cardResposta}>
                <div className={styles.searchingIndicator}>
                  <span className={styles.searchingSpinner} aria-hidden />
                  <span className={styles.searchingLabel}>Pesquisando nos seus memos…</span>
                </div>
              </div>
            </article>
          </div>
        ) : null}

        {respostas.length > 0 ? (
          <div className={styles.cards}>
            {respostas.map((r, i) => (
              <article key={i} className={styles.card}>
                <div className={styles.cardPergunta}>
                  <span className={styles.cardPerguntaIcon} aria-hidden>❓</span>
                  <p className={styles.cardPerguntaText}>{r.perguntaTexto}</p>
                  <div className={styles.refazerArea}>
                    {r.classificacao.pipe === "semantica" ? (
                      (() => {
                        const proxLimiar = Math.max(
                          Math.round(((r.limiarUsado ?? 0) - 0.1) * 100) / 100,
                          r.limiarMinimo ?? 0,
                        );
                        const noMinimo = r.limiarUsado != null && r.limiarMinimo != null && r.limiarUsado <= r.limiarMinimo + 0.001;
                        return (
                          <button
                            type="button"
                            className={styles.ampliarBtn}
                            disabled={busy || noMinimo}
                            title={noMinimo ? `Limiar mínimo (${Math.round((r.limiarMinimo ?? 0) * 100)}%) já atingido` : `Buscar novamente com limiar ${Math.round(proxLimiar * 100)}%`}
                            onClick={() => void enviar({ forcePipe: "semantica", perguntaOverride: r.perguntaTexto, thresholdOverride: proxLimiar, forceCategories: r.classificacao.categorias })}
                          >
                            ↓ Ampliar busca
                          </button>
                        );
                      })()
                    ) : refazerIdx === i ? (
                      <div className={styles.refazerPipes}>
                        {(["semantica", "estruturada", "hibrida"] as const).map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`${styles.refazerPipeBtn} ${r.classificacao.pipe === p ? styles.refazerPipeCurrent : ""}`}
                            disabled={busy || r.classificacao.pipe === p}
                            onClick={() => void enviar({ forcePipe: p, perguntaOverride: r.perguntaTexto })}
                          >
                            {renderPipeLabel(p)}
                          </button>
                        ))}
                        <button type="button" className={styles.refazerClose} onClick={() => setRefazerIdx(null)} title="Cancelar">×</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={styles.refazerBtn}
                        disabled={busy}
                        onClick={() => setRefazerIdx(i)}
                        title="Refazer com outro pipe"
                      >
                        ↺ Refazer
                      </button>
                    )}
                  </div>
                </div>
                <div className={styles.cardResposta}>
                  <div className={styles.cardRespostaMeta}>
                    <span className={`${styles.pipeBadge} ${styles[`pipe_${r.classificacao.pipe}`]}`}>
                      {renderPipeLabel(r.classificacao.pipe)}
                    </span>
                    <span className={`${styles.scopeBadge} ${r.classificacao.escopo_sugerido === "contexto_sessao" ? styles.scopeContexto : styles.scopeGlobal}`}>
                      {r.classificacao.escopo_sugerido === "contexto_sessao" ? "No contexto" : "Global"}
                    </span>
                    {r.classificacao.pipe === "semantica" && r.limiarUsado != null ? (
                      r.resposta.dados_usados.length > 0 ? (
                        <span
                          className={styles.confianca}
                          title={`Similaridade máxima dos memos citados / Limiar utilizado (mín. configurado: ${Math.round((r.limiarMinimo ?? 0) * 100)}%)`}
                        >
                          {Math.round(r.resposta.confianca_estimada * 100)}/{Math.round(r.limiarUsado * 100)}%
                        </span>
                      ) : (
                        <span
                          className={styles.confianca}
                          title={`Nenhum memo encontrado acima do limiar (mín. configurado: ${Math.round((r.limiarMinimo ?? 0) * 100)}%)`}
                        >
                          —/{Math.round(r.limiarUsado * 100)}%
                        </span>
                      )
                    ) : (
                      <span className={styles.confianca}>
                        Confiança: {Math.round(r.resposta.confianca_estimada * 100)}%
                      </span>
                    )}
                    {r.classificacao.pipe === "semantica" && r.limiarInicial != null && r.limiarUsado != null && r.limiarUsado < r.limiarInicial - 0.001 ? (
                      <span
                        className={styles.limiarAmpliadoBadge}
                        title={`Busca ampliada automaticamente: limiar reduzido de ${Math.round(r.limiarInicial * 100)}% para ${Math.round(r.limiarUsado * 100)}%`}
                      >
                        ↓ Busca ampliada
                      </span>
                    ) : null}
                    {r.aguardaFase2 ? (
                      <span className={styles.fase2Badge}>Em desenvolvimento</span>
                    ) : null}
                    {typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined" ? (
                      <button
                        type="button"
                        className={`${styles.speakerBtn} ${ttsBusyPergunta === r.perguntaTexto ? styles.speakerBtnActive : ""}`}
                        onClick={() => toggleSpeakResposta(r.perguntaTexto, r.resposta.resposta)}
                        aria-pressed={ttsBusyPergunta === r.perguntaTexto}
                        title={ttsBusyPergunta === r.perguntaTexto ? "Parar narração" : "Narrar resposta em voz alta"}
                      >
                        <IconSpeaker />
                      </button>
                    ) : null}
                  </div>
                  {r.classificacao.pipe === "semantica" && r.resposta.dados_usados.length === 0 && r.limiarUsado != null && r.limiarMinimo != null && r.limiarUsado <= r.limiarMinimo + 0.001 ? (
                    <p className={styles.limiarMinimoAviso}>
                      Limiar mínimo de {Math.round(r.limiarMinimo * 100)}% atingido sem memos relevantes encontrados.
                      O limiar inicial e o mínimo são configuráveis em <strong>Admin → Outros → Configurações do sistema</strong>.
                    </p>
                  ) : null}
                  <p className={styles.cardRespostaText}>{stripMarkdown(r.resposta.resposta)}</p>
                  {r.resposta.dados_estruturados ? (
                    <TabelaEstruturada dados={r.resposta.dados_estruturados} />
                  ) : null}
                  {r.resposta.limitacoes.length > 0 ? (
                    <ul className={styles.limitacoes}>
                      {r.resposta.limitacoes.map((l, j) => <li key={j}>{l}</li>)}
                    </ul>
                  ) : null}
                  {r.resposta.dados_usados.length > 0 ? (
                    <details className={styles.memosDetails}>
                      <summary className={styles.memosSummary}>
                        {r.resposta.dados_usados.length} memo(s) utilizado(s)
                      </summary>
                      <ul className={styles.memosList}>
                        {r.resposta.dados_usados.map((d, j) => (
                          <li key={j} className={styles.memosItem}>
                            <button
                              type="button"
                              className={styles.memoIdBtn}
                              onClick={() => void openMemoCard(d.memo_id)}
                              disabled={loadingCardId === d.memo_id}
                              title="Abrir memo"
                            >
                              {loadingCardId === d.memo_id ? "…" : `Memo #${d.memo_id}`}
                            </button>
                            {d.trecho_usado ? <span className={styles.memoTrecho}>"{d.trecho_usado}"</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {me?.showLlmTrace && r.llmTrace && r.llmTrace.length > 0 ? (
                    <button
                      type="button"
                      className={styles.traceBtn}
                      onClick={() => setTraceModal({ trace: r.llmTrace!, pergunta: r.perguntaTexto })}
                      title={`Ver ${r.llmTrace.length} chamada(s) LLM desta resposta`}
                    >
                      &#123;&#125; {r.llmTrace.length} LLM call{r.llmTrace.length !== 1 ? "s" : ""}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.emptyHint}>As respostas aparecerão aqui. Faça sua primeira pergunta!</p>
        )}
      </main>

      {cardMemo ? (
        <div className={styles.memoCardOverlay} onClick={handleCloseMemoCard}>
          <div className={styles.memoCardModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.memoCardHeader}>
              <button
                type="button"
                className={styles.memoCardBack}
                onClick={() => memoEditMode ? setMemoEditMode(false) : handleCloseMemoCard()}
              >
                {memoEditMode ? "← Cancelar" : "← Voltar"}
              </button>
              {memoEditMode ? (
                <button
                  type="button"
                  className={styles.memoCardSaveBtn}
                  disabled={editBusy || !editText.trim()}
                  onClick={() => void handleSaveMemoEdit()}
                >
                  {editBusy ? "Salvando…" : "Salvar"}
                </button>
              ) : (
                <span className={styles.memoCardId}>Memo #{cardMemo.id}</span>
              )}
            </div>
            <div className={styles.memoCardBody}>
              {memoEditMode ? (
                <div className={styles.memoEditForm}>
                  <label className={styles.memoEditLabel}>
                    Texto
                    <textarea
                      className={styles.memoEditTextarea}
                      rows={8}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                    />
                  </label>
                  <label className={styles.memoEditLabel}>
                    Palavras-chave
                    <textarea
                      className={styles.memoEditTextarea}
                      rows={2}
                      value={editKeywords}
                      onChange={(e) => setEditKeywords(e.target.value)}
                      placeholder="ex.: reunião, projeto"
                    />
                  </label>
                  <label className={styles.memoEditLabel}>
                    Dados específicos (JSON)
                    <textarea
                      className={styles.memoEditTextarea}
                      rows={3}
                      value={editDados}
                      onChange={(e) => setEditDados(e.target.value)}
                      placeholder='ex.: {"telefone":"(11) 99999-9999"}'
                    />
                  </label>
                  {editError ? <p className={styles.memoEditError}>{editError}</p> : null}
                </div>
              ) : (
                <ul className={styles.memoCardList}>
                  <MemoResultListRow
                    m={cardMemo}
                    returnTo="/perguntar"
                    currentUserId={me?.id ?? null}
                    deletingId={null}
                    onOpenPreview={(m) => { setFilePreviewMemo(m); setCardMemo(null); }}
                    onRequestDelete={() => {}}
                    noNavigate={true}
                    onEdit={handleOpenMemoEdit}
                  />
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {filePreviewMemo ? (
        <MemoFilePreviewModal
          m={filePreviewMemo}
          apiBase={apiBase}
          returnTo="/perguntar"
          onClose={() => setFilePreviewMemo(null)}
        />
      ) : null}

      {traceModal ? (
        <LlmTraceModal
          trace={traceModal.trace}
          pergunta={traceModal.pergunta}
          onClose={() => setTraceModal(null)}
        />
      ) : null}
    </div>
  );
}
