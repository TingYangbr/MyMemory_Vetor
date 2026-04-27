import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  MeResponse,
  PerguntaCardHistorico,
  PerguntaResponse,
} from "@mymemory/shared";
import { apiGetOptional, apiPostJson } from "../api";
import Header from "../components/Header";
import styles from "./PerguntaPage.module.css";

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
        stopListening("done");
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

  async function enviar() {
    const q = pergunta.trim();
    if (!q || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await apiPostJson<PerguntaResponse>("/api/perguntas", {
        pergunta: q,
        workspaceGroupId: workspaceGroupId ?? null,
        filtros: {
          autorId: filterAuthorId,
          dataInicio: filterDateFrom || null,
          dataFim: filterDateTo || null,
        },
        contextoSessao: historico,
      });
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

        {respostas.length > 0 ? (
          <div className={styles.cards}>
            {respostas.map((r, i) => (
              <article key={i} className={styles.card}>
                <div className={styles.cardPergunta}>
                  <span className={styles.cardPerguntaIcon} aria-hidden>❓</span>
                  <p className={styles.cardPerguntaText}>{r.perguntaTexto}</p>
                </div>
                <div className={styles.cardResposta}>
                  <div className={styles.cardRespostaMeta}>
                    <span className={`${styles.pipeBadge} ${styles[`pipe_${r.classificacao.pipe}`]}`}>
                      {renderPipeLabel(r.classificacao.pipe)}
                    </span>
                    <span className={styles.confianca}>
                      Confiança: {Math.round(r.resposta.confianca_estimada * 100)}%
                    </span>
                    {r.aguardaFase2 ? (
                      <span className={styles.fase2Badge}>Em desenvolvimento</span>
                    ) : null}
                  </div>
                  <p className={styles.cardRespostaText}>{r.resposta.resposta}</p>
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
                            <span className={styles.memoId}>Memo #{d.memo_id}</span>
                            {d.trecho_usado ? <span className={styles.memoTrecho}>"{d.trecho_usado}"</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.emptyHint}>As respostas aparecerão aqui. Faça sua primeira pergunta!</p>
        )}
      </main>
    </div>
  );
}
