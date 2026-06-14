import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  MeResponse,
  MemoContextCategory,
  MemoContextStructureResponse,
  MemoRecentCard,
  PerguntaCardHistorico,
  PerguntaLlmTraceEntry,
  PerguntaModelo,
  PerguntaResponse,
  PerguntaResultadoEstruturado,
} from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPatchJson, apiPostJson, apiPutJson, avisos as avisosApi } from "../api";
import Header from "../components/Header";
import { MemoFilePreviewModal } from "../components/MemoFilePreviewModal";
import { MemoResultListRow } from "../components/MemoResultListRow";
import styles from "./PerguntaPage.module.css";

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

const COLUNA_LABELS: Record<string, string> = {
  id: "ID", resumo: "Resumo", keywords: "Keywords",
  mediaType: "Tipo", mediaText: "Conteúdo", mediatext: "Conteúdo",
  data: "Data", createdAt: "Data criação", total: "Total", mes: "Mês",
  category: "Categoria",
  // campos estruturados de domínio — mantidos em português para unificar com dadosEspecificos
  andar: "Andar",
  area_m2: "Área m2",
  area_terreno: "Área Terreno",
  quantos_comodos: "Quantos Cômodos",
  idade_anos: "Idade (anos)",
  interessado_nome: "Interessado nome",
  interessado_telefone: "Interessado telefone",
  regiao: "Região",
  vagas_garagem: "Vagas garagem",
  intencao: "Intenção",
};

const MEDIA_TYPE_LABELS: Record<string, string> = {
  text: "Texto", audio: "Áudio", image: "Imagem",
  video: "Vídeo", document: "Documento", url: "URL",
};

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "$1")          // **negrito**
    .replace(/\*(.+?)\*/gs, "$1")               // *itálico*
    .replace(/`+([^`]+)`+/g, "$1")             // `código`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // [link](url)
    .replace(/^#{1,6}\s+/gm, "")               // # Títulos
    .replace(/^[-*]\s+/gm, "")                 // - listas
    .replace(/^\d+\.\s+/gm, "");               // 1. listas numeradas
}

function normalizeTtsText(text: string): string {
  return text
    // km² antes de m² para evitar match parcial
    .replace(/\bkm²/g,  "quilômetros quadrados")
    .replace(/\bkm2\b/gi, "quilômetros quadrados")
    .replace(/\bcm²/g,  "centímetros quadrados")
    .replace(/\bcm2\b/gi, "centímetros quadrados")
    .replace(/\bm²/g,   "metros quadrados")
    .replace(/\bm2\b/gi, "metros quadrados")
    // cúbicos
    .replace(/\bkm³/g,  "quilômetros cúbicos")
    .replace(/\bkm3\b/gi, "quilômetros cúbicos")
    .replace(/\bcm³/g,  "centímetros cúbicos")
    .replace(/\bcm3\b/gi, "centímetros cúbicos")
    .replace(/\bm³/g,   "metros cúbicos")
    .replace(/\bm3\b/gi, "metros cúbicos")
    // temperatura
    .replace(/(\d)\s*°C/g, "$1 graus Celsius")
    .replace(/(\d)\s*°F/g, "$1 graus Fahrenheit")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function IconTrace({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="16 18 22 12 16 6"/>
      <polyline points="8 6 2 12 8 18"/>
    </svg>
  );
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

function IconLightbulb({ className }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18h6"/>
      <path d="M10 22h4"/>
      <path d="M12 2a7 7 0 0 1 7 7c0 2.386-1.308 4.482-3 5.773V17H8v-2.227C6.308 13.482 5 11.386 5 9a7 7 0 0 1 7-7z"/>
    </svg>
  );
}


function IconRepoIn({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ellipse cx="12" cy="15" rx="8" ry="2.5"/>
      <path d="M4 15v4c0 1.38 3.58 2.5 8 2.5s8-1.12 8-2.5v-4"/>
      <line x1="12" y1="3" x2="12" y2="12"/>
      <polyline points="8 8 12 12 16 8"/>
    </svg>
  );
}

function formatNumericCell(num: number, colName: string): string {
  const col = colName.toLowerCase().replace(/[_\s]+/g, " ");
  if (/\b(dias?|prazos?|atrasos?)\b/.test(col))
    return Math.round(num).toLocaleString("pt-BR");
  if (/\b(taxas?|indices?|índices?|juros|percentual|percent)\b/.test(col))
    return num.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  if (/\b(valores?|vlr|vl|prec[oa]s?|custos?|saldos?|receitas?|despesas?|montantes?)\b/.test(col))
    return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num.toLocaleString("pt-BR");
}

function TabelaEstruturada({ dados, onOpenMemo, loadingCardId }: {
  dados: PerguntaResultadoEstruturado;
  onOpenMemo?: (id: number) => void;
  loadingCardId?: number | null;
}) {
  const [expandedCell, setExpandedCell] = useState<string | null>(null);

  if (!dados.totalLinhas) return null;
  return (
    <>
      {expandedCell ? (
        <div className={styles.cellModalOverlay} onClick={() => setExpandedCell(null)}>
          <div className={styles.cellModal} onClick={(e) => e.stopPropagation()}>
            <p className={styles.cellModalText}>{expandedCell}</p>
          </div>
        </div>
      ) : null}
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
                  const display = (() => {
                    if (col === "mediaType" && typeof val === "string")
                      return MEDIA_TYPE_LABELS[val] ?? val;
                    if (val == null) return "—";
                    if (typeof val === "number" || (typeof val === "string" && val !== "" && !isNaN(Number(val)))) {
                      const num = typeof val === "number" ? val : Number(val);
                      return formatNumericCell(num, col);
                    }
                    return String(val);
                  })();
                  const isLong = display.length > 80;
                  if (col === "id" && onOpenMemo && val != null) {
                    const id = Number(val);
                    return (
                      <td key={col} className={styles.tabelaTd}>
                        <button
                          type="button"
                          className={styles.memoIdBtn}
                          onClick={() => onOpenMemo(id)}
                          disabled={loadingCardId === id}
                          title="Abrir memo"
                        >
                          {loadingCardId === id ? "…" : `#${id}`}
                        </button>
                      </td>
                    );
                  }
                  return (
                    <td
                      key={col}
                      className={`${styles.tabelaTd}${isLong ? ` ${styles.tabelaTdExpandable}` : ""}`}
                      onClick={isLong ? () => setExpandedCell(display) : undefined}
                      title={isLong ? "Clique para ver texto completo" : undefined}
                    >
                      {isLong ? display.slice(0, 80) + "…" : display}
                    </td>
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
    </>
  );
}

function TabelaSemantica({ dados_usados, onOpenMemo, loadingCardId }: {
  dados_usados: import("@mymemory/shared").PerguntaMemoUsado[];
  onOpenMemo?: (id: number) => void;
  loadingCardId?: number | null;
}) {
  const [expandedCell, setExpandedCell] = useState<string | null>(null);

  if (dados_usados.length === 0) return null;

  // Coleta todas as chaves de dadosEspecificos em ordem alfabética (união de todas as categorias)
  const extraKeys = Array.from(
    new Set(dados_usados.flatMap((d) => d.dadosEspecificos ? Object.keys(d.dadosEspecificos) : []))
  ).sort();

  const LABELS: Record<string, string> = { memo_id: "ID", mediaType: "Tipo", mediatext: "Conteúdo" };

  function renderCell(val: string) {
    const isLong = val.length > 80;
    return (
      <td
        className={`${styles.tabelaTd}${isLong ? ` ${styles.tabelaTdExpandable}` : ""}`}
        onClick={isLong ? () => setExpandedCell(val) : undefined}
        title={isLong ? "Clique para ver texto completo" : undefined}
      >
        {isLong ? val.slice(0, 80) + "…" : val}
      </td>
    );
  }

  return (
    <>
      {expandedCell ? (
        <div className={styles.cellModalOverlay} onClick={() => setExpandedCell(null)}>
          <div className={styles.cellModal} onClick={(e) => e.stopPropagation()}>
            <p className={styles.cellModalText}>{expandedCell}</p>
          </div>
        </div>
      ) : null}
      <div className={styles.tabelaWrap}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              {["memo_id", "mediaType", "mediatext", ...extraKeys].map((c) => (
                <th key={c} className={styles.tabelaTh}>{LABELS[c] ?? c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dados_usados.map((d, i) => (
              <tr key={i} className={styles.tabelaTr}>
                <td className={styles.tabelaTd}>
                  {onOpenMemo ? (
                    <button
                      type="button"
                      className={styles.memoIdBtn}
                      onClick={() => onOpenMemo(d.memo_id)}
                      disabled={loadingCardId === d.memo_id}
                      title="Abrir memo"
                    >
                      {loadingCardId === d.memo_id ? "…" : `#${d.memo_id}`}
                    </button>
                  ) : `#${d.memo_id}`}
                </td>
                {renderCell(d.mediaType ?? "—")}
                {renderCell(d.mediatext ?? "—")}
                {extraKeys.map((k) => renderCell(d.dadosEspecificos?.[k] != null ? String(d.dadosEspecificos![k]) : "—"))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
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
                <span className={`${styles.traceEntryProvider} ${entry.provider === "sql" ? styles.traceEntryProviderSql : ""}`}>
                  {entry.provider}
                </span>
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

const CHUNK_MS = 4000; // duração de cada chunk enviado ao Whisper (ms)
const IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

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

export default function PerguntaPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [ready, setReady] = useState(false);
  const [pergunta, setPergunta] = useState("");
  const [historico, setHistorico] = useState<PerguntaCardHistorico[]>([]);
  const [respostas, setRespostas] = useState<(PerguntaResponse & { perguntaTexto: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
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
  const [modeloSelectOpen, setModeloSelectOpen] = useState(false);
  const [modelos, setModelos] = useState<PerguntaModelo[]>([]);
  const [modelosLoading, setModelosLoading] = useState(false);
  const [modeloSavedIdx, setModeloSavedIdx] = useState<number | null>(null);
  const [modeloSavingIdx, setModeloSavingIdx] = useState<number | null>(null);
  const [modeloSaveErr, setModeloSaveErr] = useState<string | null>(null);
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);
  const [editingModalModelo, setEditingModalModelo] = useState<{ id: number; pergunta: string; anotacoes: string; estrelas: number | null } | null>(null);
  const [savingModalModelo, setSavingModalModelo] = useState(false);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [showCatFilter, setShowCatFilter] = useState(false);
  const [modalSearchText, setModalSearchText] = useState("");
  const [modalShowSearch, setModalShowSearch] = useState(false);
  const modalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [contextCategories, setContextCategories] = useState<MemoContextCategory[]>([]);
  const [helpHintOpenIdx, setHelpHintOpenIdx] = useState<number | null>(null);
  const [avisoModal, setAvisoModal] = useState<{
    cardIdx: number;
    descricao: string;
    freqTipo: "horas" | "diaria" | "semanal" | "mensal";
    freqHoras: number;
    email: string;
  } | null>(null);
  const [avisoSaving, setAvisoSaving] = useState(false);
  const [avisoSaveErr, setAvisoSaveErr] = useState<string | null>(null);
  const [avisoSavedPergunta, setAvisoSavedPergunta] = useState<string | null>(null);
  const [ttsBusyPergunta, setTtsBusyPergunta] = useState<string | null>(null);
  const ttsBusyRef = useRef<string | null>(null);
  const ttsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRespostasLenRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Filtros
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAuthorId, setFilterAuthorId] = useState<number | null>(null);
  const [filterModal, setFilterModal] = useState<null | "quando" | "quem">(null);
  const [showFilters, setShowFilters] = useState(false);
  const [draftDateFrom, setDraftDateFrom] = useState("");
  const [draftDateTo, setDraftDateTo] = useState("");
  const [draftAuthorId, setDraftAuthorId] = useState<number | null>(null);
  const [authorOptions, setAuthorOptions] = useState<SearchAuthorOption[]>([]);

  // Voz
  const [micState, setMicState] = useState<"idle" | "listening">("idle");
  const recognitionRef     = useRef<{ stop: () => void } | null>(null); // desktop
  const mediaRecorderRef   = useRef<MediaRecorder | null>(null);         // mobile
  const chunkTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningRef       = useRef(false);
  const capturedRef        = useRef("");
  const transcribeQueueRef = useRef<Promise<void>>(Promise.resolve());   // serializa chunks
  const textareaRef        = useRef<HTMLTextAreaElement | null>(null);

  const workspaceGroupId = me?.lastWorkspaceGroupId ?? null;
  const isGroup = workspaceGroupId != null;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [pergunta]);

  // Para a narração ao sair da página
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

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

  useEffect(() => {
    if (!me) return;
    const gid = me.lastWorkspaceGroupId;
    // Espelha o fallback do /api/perguntas: tenta o grupo e, se vier vazio, usa global.
    const fetchStructure = async () => {
      if (gid) {
        const r = await apiGetOptional<MemoContextStructureResponse>(`/api/memo-context/structure?groupId=${gid}`);
        if (r.ok && r.data.categories.length > 0) {
          setContextCategories(r.data.categories);
          return;
        }
      }
      const r = await apiGetOptional<MemoContextStructureResponse>("/api/memo-context/structure");
      if (r.ok) setContextCategories(r.data.categories);
    };
    fetchStructure().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, me?.lastWorkspaceGroupId]);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    // desktop
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    try { rec?.stop?.(); } catch {}
    // mobile
    if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
    const mr = mediaRecorderRef.current;
    if (mr?.state === "recording") mr.stop(); // onstop faz transcrição final + cleanup da stream
    setMicState("idle");
  }, []);

  const startListening = useCallback(async () => {
    setError(null);
    stopListening();
    capturedRef.current = "";
    transcribeQueueRef.current = Promise.resolve();
    setPergunta("");
    listeningRef.current = true;

    // ── MOBILE: MediaRecorder contínuo + Whisper periódico ───────────────────
    if (IS_MOBILE) {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        listeningRef.current = false;
        setError("Microfone bloqueado. Permita o acesso nas configurações do navegador.");
        return;
      }

      const mimeType =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" :
        MediaRecorder.isTypeSupported("audio/webm")             ? "audio/webm" :
        "audio/mp4";

      const allChunks: Blob[] = [];

      // Envia o áudio acumulado completo ao Whisper; substitui o campo com a
      // melhor transcrição disponível até o momento.
      const sendAccumulated = () => {
        if (allChunks.length === 0) return;
        const blob = new Blob(allChunks, { type: mimeType });
        if (blob.size < 1000) return;
        transcribeQueueRef.current = transcribeQueueRef.current.then(async () => {
          try {
            const form = new FormData();
            form.append("audio", blob, "recording.webm");
            const res = await fetch("/api/perguntas/transcribe", {
              method: "POST", body: form, credentials: "include",
            });
            if (!res.ok) return;
            const { text } = await (res.json() as Promise<{ text: string }>);
            if (text?.trim()) {
              capturedRef.current = text.trim();
              setPergunta(text.trim());
            }
          } catch { /* rede — tenta no próximo intervalo */ }
        });
      };

      let recorder: MediaRecorder;
      try { recorder = new MediaRecorder(stream, { mimeType }); } catch {
        stream.getTracks().forEach(t => t.stop());
        listeningRef.current = false;
        setError("Não foi possível iniciar a gravação.");
        return;
      }

      recorder.ondataavailable = (e) => { if (e.data.size > 0) allChunks.push(e.data); };

      recorder.onstop = () => {
        sendAccumulated(); // transcrição final com todo o áudio
        transcribeQueueRef.current.finally(() => {
          stream.getTracks().forEach(t => t.stop());
          mediaRecorderRef.current = null;
        });
      };

      // 500 ms por chunk interno → acumulação suave sem parar o mic
      recorder.start(500);
      mediaRecorderRef.current = recorder;

      // Envia transcrição a cada CHUNK_MS enquanto grava
      chunkTimerRef.current = setInterval(sendAccumulated, CHUNK_MS) as unknown as ReturnType<typeof setTimeout>;

      setMicState("listening");
      return;
    }

    // ── DESKTOP: Web Speech API ───────────────────────────────────────────────
    const SR =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecInstance }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecInstance }).webkitSpeechRecognition;
    if (!SR) {
      listeningRef.current = false;
      setError("Voz não disponível neste navegador. Use Chrome ou Edge.");
      return;
    }

    let rec: SpeechRecInstance;
    try { rec = new SR(); } catch {
      listeningRef.current = false;
      setError("Não foi possível iniciar o microfone.");
      return;
    }
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i]![0]!.transcript;
      setPergunta(stripPunctuation(text.trim()));
    };
    rec.onerror = (ev: Event) => {
      const code = (ev as Event & { error?: string }).error ?? "";
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
    rec.onend = () => { recognitionRef.current = null; setMicState("idle"); };
    recognitionRef.current = rec;
    try {
      rec.start();
      setMicState("listening");
    } catch {
      listeningRef.current = false;
      setError("Não foi possível iniciar o microfone.");
    }
  }, [stopListening]);

  function cancelar() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    capturedRef.current = "";
    stopListening();
    setPergunta("");
    setPendingQuestion(null);
  }

  function novasSessao() {
    cancelar();
    stopTts();
    setHistorico([]);
    setRespostas([]);
    setError(null);
    setPendingQuestion(null);
  }

  async function enviar(opts?: { forcePipe?: "semantica" | "estruturada" | "hibrida"; perguntaOverride?: string; thresholdOverride?: number; forceCategories?: string[] }) {
    stopListening();
    const q = (opts?.perguntaOverride ?? pergunta).trim();
    if (!q || busy) return;
    setError(null);
    setStatusMsg(null);
    setBusy(true);
    setRefazerIdx(null);
    setHelpHintOpenIdx(null);
    setPendingQuestion(q);
    const ac = new AbortController();
    abortControllerRef.current = ac;
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

      const response = await fetch(`${apiBase}/api/perguntas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      if (!response.ok || !response.body) {
        const txt = await response.text().catch(() => "");
        let msg = `HTTP ${response.status}`;
        try { msg = (JSON.parse(txt) as { message?: string }).message ?? msg; } catch { /* */ }
        throw new Error(msg);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let res: PerguntaResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const evt = JSON.parse(line.slice(6)) as { type: string; message?: string; data?: PerguntaResponse };
          if (evt.type === "status") setStatusMsg(evt.message ?? null);
          if (evt.type === "error") throw new Error(evt.message ?? "Erro ao processar a pergunta.");
          if (evt.type === "result" && evt.data) res = evt.data;
        }
      }

      if (!res) throw new Error("Resposta não recebida.");
      const card = { ...res, perguntaTexto: q };
      setRespostas((prev) => [card, ...prev]);
      setHistorico((prev) => [
        ...prev,
        {
          pergunta: q,
          resposta: res!.resposta.resposta,
          pipe: res!.classificacao.pipe,
          dados_usados: res!.resposta.dados_usados.length > 0 ? res!.resposta.dados_usados : undefined,
        },
      ].slice(-5));
      setPergunta("");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const raw = e instanceof Error ? e.message : String(e);
      try { const j = JSON.parse(raw) as { message?: string }; setError(j.message ?? raw); }
      catch { setError(raw || "Não foi possível obter a resposta."); }
    } finally {
      abortControllerRef.current = null;
      setBusy(false);
      setStatusMsg(null);
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

  function stopTts() {
    if (typeof window.speechSynthesis !== "undefined") window.speechSynthesis.cancel();
    if (ttsTimeoutRef.current) { clearTimeout(ttsTimeoutRef.current); ttsTimeoutRef.current = null; }
    ttsBusyRef.current = null;
    setTtsBusyPergunta(null);
  }

  function speakText(key: string, text: string) {
    if (typeof window.speechSynthesis === "undefined") return;
    window.speechSynthesis.cancel();
    if (ttsTimeoutRef.current) { clearTimeout(ttsTimeoutRef.current); ttsTimeoutRef.current = null; }
    ttsBusyRef.current = key;
    setTtsBusyPergunta(key);
    const ttsText = normalizeTtsText(stripMarkdown(text).replace(/\n+/g, " "));
    const u = new SpeechSynthesisUtterance(ttsText);
    u.lang = "pt-BR";
    u.rate = me?.ttsRate ?? 1.0;
    u.onend = () => { ttsBusyRef.current = null; setTtsBusyPergunta(null); };
    u.onerror = () => { ttsBusyRef.current = null; setTtsBusyPergunta(null); };
    ttsTimeoutRef.current = setTimeout(() => {
      ttsTimeoutRef.current = null;
      if (ttsBusyRef.current === key) window.speechSynthesis.speak(u);
    }, 2000);
  }

  function toggleSpeakResposta(key: string, text: string) {
    if (typeof window.speechSynthesis === "undefined") return;
    if (ttsBusyRef.current === key) { stopTts(); return; }
    speakText(key, text);
  }

  // Para TTS ao clicar em qualquer ponto fora do card ativo e do botão de narrar
  useEffect(() => {
    if (!ttsBusyPergunta) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Element;
      if (target.closest("[data-tts-btn]")) return;
      if (target.closest("[data-tts-card-active]")) return;
      stopTts();
    }
    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsBusyPergunta]);

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

  function getCamposForCategories(categorias: string[]): string[] {
    return contextCategories
      .filter((cat) => categorias.includes(cat.name))
      .flatMap((cat) => cat.campos.filter((c) => c.isActive).map((c) => c.name));
  }

  function isSemResposta(r: PerguntaResponse & { perguntaTexto: string }): boolean {
    const noMemos = r.resposta.dados_usados.length === 0;
    const de = r.resposta.dados_estruturados;
    const noRows = Array.isArray(de)
      ? de.every((d) => d.totalLinhas === 0)
      : (de?.totalLinhas ?? 0) === 0;
    if (r.classificacao.pipe === "semantica") return noMemos;
    if (r.classificacao.pipe === "estruturada") return noRows;
    return noMemos && noRows; // hibrida
  }

  function renderPipeLabel(pipe: string) {
    if (pipe === "semantica") return "Semântico";
    if (pipe === "estruturada") return "Estruturado";
    if (pipe === "hibrida") return "Híbrido";
    return pipe;
  }

  async function abrirModeloSelect() {
    setModeloSelectOpen(true);
    setOpenNoteId(null);
    setEditingModalModelo(null);
    setFilterCat(null);
    setShowCatFilter(false);
    setModalSearchText("");
    setModalShowSearch(false);
    setModelosLoading(true);
    try {
      const gid = workspaceGroupId != null ? `?workspaceGroupId=${workspaceGroupId}` : "";
      const data = await apiGet<{ modelos: PerguntaModelo[] }>(`/api/pergunta-modelos${gid}`);
      setModelos(data.modelos);
    } catch { /* silencia */ } finally {
      setModelosLoading(false);
    }
  }

  async function saveModalModelo() {
    if (!editingModalModelo) return;
    setSavingModalModelo(true);
    try {
      const res = await apiPutJson<{ modelo: PerguntaModelo }>(
        `/api/pergunta-modelos/${editingModalModelo.id}`,
        { pergunta: editingModalModelo.pergunta.trim(), anotacoes: editingModalModelo.anotacoes.trim() || null, estrelas: editingModalModelo.estrelas }
      );
      setModelos((prev) => prev.map((m) => (m.id === editingModalModelo.id ? res.modelo : m)));
      setEditingModalModelo(null);
    } catch { /* silencia erros no modal */ } finally {
      setSavingModalModelo(false);
    }
  }

  async function salvarModelo(cardIdx: number) {
    const r = respostas[cardIdx];
    if (!r || modeloSavingIdx === cardIdx || modeloSavedIdx === cardIdx) return;
    const category = r.classificacao.categorias[0] ?? null;
    setModeloSaveErr(null);
    setModeloSavingIdx(cardIdx);
    try {
      await apiPostJson("/api/pergunta-modelos", {
        pergunta: r.perguntaTexto,
        category,
        workspaceGroupId: workspaceGroupId ?? null,
      });
      setModeloSavedIdx(cardIdx);
      setTimeout(() => setModeloSavedIdx((v) => (v === cardIdx ? null : v)), 2000);
    } catch (e) {
      setModeloSaveErr(e instanceof Error ? e.message : "Erro ao salvar pergunta.");
    } finally {
      setModeloSavingIdx(null);
    }
  }


  async function ativarAviso() {
    if (!avisoModal) return;
    const r = respostas[avisoModal.cardIdx];
    if (!r || !r.avisoSnapshot) return;
    setAvisoSaving(true);
    setAvisoSaveErr(null);
    try {
      await avisosApi.criar({
        descricao: avisoModal.descricao,
        perguntaOriginal: r.perguntaTexto,
        pipe: r.classificacao.pipe,
        execucaoSnapshot: r.avisoSnapshot as unknown as Record<string, unknown>,
        frequenciaTipo: avisoModal.freqTipo,
        frequenciaHoras: avisoModal.freqTipo === "horas" ? avisoModal.freqHoras : null,
        canalDestino: avisoModal.email,
        workspaceGroupId: workspaceGroupId ?? null,
      });
      setAvisoSavedPergunta(r.perguntaTexto);
      setAvisoModal(null);
    } catch (e) {
      setAvisoSaveErr(e instanceof Error ? e.message : "Erro ao ativar aviso.");
    } finally {
      setAvisoSaving(false);
    }
  }

  const modeloCatOptions = useMemo(() => {
    if (modelos.length <= 6) return [];
    const cats = new Set<string>();
    let hasSemCat = false;
    for (const m of modelos) {
      if (m.category) cats.add(m.category);
      else hasSemCat = true;
    }
    if (cats.size === 0) return [];
    const sorted = [...cats].sort((a, b) => a.localeCompare(b, "pt"));
    if (hasSemCat) sorted.push("Sem categoria");
    return sorted;
  }, [modelos]);

  const filteredModelos = useMemo(() => {
    let result = modelos;
    if (filterCat) {
      result = filterCat === "Sem categoria"
        ? result.filter((m) => !m.category)
        : result.filter((m) => m.category === filterCat);
    }
    if (modalSearchText.trim()) {
      const q = modalSearchText.toLowerCase();
      result = result.filter(
        (m) => m.pergunta.toLowerCase().includes(q) || (m.anotacoes ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [modelos, filterCat, modalSearchText]);

  if (!ready) {
    if (embedded) return <p className={styles.muted}>Carregando…</p>;
    return (
      <div className={styles.shell}>
        <Header />
        <main className={styles.main}><p className={styles.muted}>Carregando…</p></main>
      </div>
    );
  }

  return (
    <div className={embedded ? styles.embeddedShell : styles.shell}>
      {!embedded && <Header meRefreshKey={0} />}

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
        {!embedded && (
          <div className={styles.topBar}>
            <h1 className={styles.pageTitle}>Pergunte ao myMemory</h1>
            <div className={styles.topBarFilters}>
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
        )}

        <div className={styles.inputArea}>
          <div className={styles.inputRow}>
            <textarea
              ref={textareaRef}
              className={styles.perguntaInput}
              placeholder="Digite sua pergunta ou fale clicando no microfone…"
              value={pergunta}
              onChange={(e) => { setPergunta(e.target.value); }}
              onKeyDown={handleKeyDown}
              rows={3}
              disabled={busy}
            />
            <div className={styles.micWrap}>
              <button
                type="button"
                className={`${styles.micBtn} ${micState === "listening" ? styles.micBtnActive : ""}`}
                onClick={() => {
                  if (micState === "listening") { stopListening(); return; }
                  setPergunta("");
                  void startListening();
                }}
                title={micState === "listening" ? "Parar gravação" : "Clique para falar"}
                disabled={busy}
              >
                {micState === "listening" ? "⏸" : "🎤"}
              </button>
              {(micState !== "idle" || pergunta.trim()) ? (
                <button
                  type="button"
                  className={styles.micCancelBtn}
                  onClick={() => { setPergunta(""); if (micState !== "idle") cancelar(); }}
                  title="Limpar texto"
                  disabled={busy}
                >✕</button>
              ) : null}
            </div>
          </div>
          <div className={styles.inputActions}>
            <div className={styles.inputActionsLeft}>
              {busy ? (
                <button
                  type="button"
                  className={styles.cancelarBtn}
                  onClick={cancelar}
                  title="Limpar e começar de novo"
                >
                  ✕ Cancelar
                </button>
              ) : null}
              {respostas.length > 0 && !busy ? (
                <button
                  type="button"
                  className={styles.novaSessaoBtn}
                  onClick={novasSessao}
                  title="Limpar histórico e começar nova sessão"
                >
                  ↺ Nova sessão
                </button>
              ) : null}
              {!busy && micState === "idle" ? (
                <button
                  type="button"
                  className={styles.carregarModeloBtn}
                  onClick={() => void abrirModeloSelect()}
                  title="Carregar pergunta salva"
                >
                  <IconLightbulb /> Perguntas salvas
                </button>
              ) : null}
            </div>
            {!busy && pergunta.trim() ? (
              <button
                type="button"
                className={styles.perguntarBtn}
                onClick={() => void enviar()}
              >
                Perguntar →
              </button>
            ) : null}
          </div>
          {embedded && showFilters && (
            <div className={styles.filterPopover}>
              {isGroup ? (
                <button
                  type="button"
                  className={`${styles.filterBtn} ${hasQuem ? styles.filterBtnActive : ""}`}
                  onClick={() => { openFilterModal("quem"); setShowFilters(false); }}
                >
                  Quem {hasQuem ? "✓" : ""}
                  {hasQuem ? <span className={styles.filterClear} onClick={(e) => { e.stopPropagation(); clearFilter("quem"); }}>×</span> : null}
                </button>
              ) : null}
              <button
                type="button"
                className={`${styles.filterBtn} ${hasQuando ? styles.filterBtnActive : ""}`}
                onClick={() => { openFilterModal("quando"); setShowFilters(false); }}
              >
                Quando {hasQuando ? "✓" : ""}
                {hasQuando ? <span className={styles.filterClear} onClick={(e) => { e.stopPropagation(); clearFilter("quando"); }}>×</span> : null}
              </button>
            </div>
          )}
        </div>

        {error ? <p className="mm-error" role="alert">{error}</p> : null}
        {modeloSaveErr ? <p className="mm-error" role="alert">Salvar pergunta: {modeloSaveErr}</p> : null}

        {pendingQuestion ? (
          <div className={styles.cards}>
            <article className={`${styles.card} ${styles.cardPending}`}>
              <div className={styles.cardPergunta}>
                <span className={styles.cardPerguntaIcon} aria-hidden>?</span>
                <p className={styles.cardPerguntaText}>{pendingQuestion}</p>
              </div>
              <div className={styles.cardResposta}>
                <div className={styles.searchingIndicator}>
                  <span className={styles.searchingSpinner} aria-hidden />
                  <span className={styles.searchingLabel}>
                    {statusMsg ?? "Pesquisando nos seus memos…"}
                  </span>
                </div>
              </div>
            </article>
          </div>
        ) : null}

        {respostas.length > 0 ? (
          <div className={styles.cards}>
            {respostas.map((r, i) => (
              <article key={i} className={styles.card} {...(ttsBusyPergunta === r.perguntaTexto ? { "data-tts-card-active": "" } : {})}>
                <div className={styles.cardPergunta}>
                  <div className={styles.cardPerguntaMain}>
                    <span className={styles.cardPerguntaIcon} aria-hidden>?</span>
                    <p className={styles.cardPerguntaText}>{r.perguntaTexto}</p>
                  </div>
                  <div className={styles.refazerArea}>
                    {r.classificacao.pipe === "semantica" || (r.classificacao.pipe === "hibrida" && r.aguardaFase2) ? (
                      (() => {
                        const proxLimiar = Math.max(
                          Math.round(((r.limiarUsado ?? 0) - 0.1) * 100) / 100,
                          r.limiarMinimo ?? 0,
                        );
                        const noMinimo = r.limiarUsado != null && r.limiarMinimo != null && r.limiarUsado <= r.limiarMinimo + 0.001;
                        const semResposta = isSemResposta(r);
                        const pipe = r.classificacao.pipe === "hibrida" ? "hibrida" : "semantica";
                        return (
                          <div className={styles.ampliarWrap}>
                            {semResposta ? (
                              <button
                                type="button"
                                className={`${styles.ajudaBtn} ${helpHintOpenIdx === i ? styles.ajudaBtnActive : ""}`}
                                onClick={() => setHelpHintOpenIdx(helpHintOpenIdx === i ? null : i)}
                                title="Dica: como obter respostas"
                              >
                                ?
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={styles.ampliarBtn}
                              disabled={busy || noMinimo}
                              title={noMinimo ? `Limiar mínimo (${Math.round((r.limiarMinimo ?? 0) * 100)}%) já atingido` : `Buscar novamente com limiar ${Math.round(proxLimiar * 100)}%`}
                              onClick={() => void enviar({ forcePipe: pipe, perguntaOverride: r.perguntaTexto, thresholdOverride: proxLimiar, forceCategories: r.classificacao.categorias })}
                            >
                              ↓ Ampliar busca
                            </button>
                          </div>
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
                    ) : isSemResposta(r) ? (
                      <div className={styles.ampliarWrap}>
                        <button
                          type="button"
                          className={`${styles.ajudaBtn} ${helpHintOpenIdx === i ? styles.ajudaBtnActive : ""}`}
                          onClick={() => setHelpHintOpenIdx(helpHintOpenIdx === i ? null : i)}
                          title="Dica: como obter respostas"
                        >
                          ?
                        </button>
                        <button
                          type="button"
                          className={styles.refazerBtn}
                          disabled={busy}
                          onClick={() => void enviar({ forcePipe: "semantica", perguntaOverride: r.perguntaTexto, forceCategories: r.classificacao.categorias })}
                          title="Refazer com busca semântica"
                        >
                          → Semântico
                        </button>
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
                    {(r.classificacao.pipe === "semantica" || (r.classificacao.pipe === "hibrida" && r.aguardaFase2)) && r.limiarInicial != null && r.limiarUsado != null && r.limiarUsado < r.limiarInicial - 0.001 ? (
                      <span
                        className={styles.limiarAmpliadoBadge}
                        title={`Busca ampliada: limiar reduzido de ${Math.round(r.limiarInicial * 100)}% para ${Math.round(r.limiarUsado * 100)}%`}
                      >
                        ↓ Busca ampliada
                      </span>
                    ) : null}
                    {typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined" ? (
                      <button
                        type="button"
                        data-tts-btn
                        className={`${styles.speakerBtn} ${ttsBusyPergunta === r.perguntaTexto ? styles.speakerBtnActive : ""}`}
                        onClick={() => toggleSpeakResposta(r.perguntaTexto, r.resposta.resposta)}
                        aria-pressed={ttsBusyPergunta === r.perguntaTexto}
                        title={ttsBusyPergunta === r.perguntaTexto ? "Parar narração" : "Narrar resposta em voz alta"}
                      >
                        <IconSpeaker />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={styles.modeloBtn}
                      onClick={() => void abrirModeloSelect()}
                      title="Carregar pergunta salva"
                    >
                      <IconLightbulb />
                    </button>
                    <button
                      type="button"
                      className={`${styles.modeloBtn} ${modeloSavedIdx === i ? styles.modeloBtnSaved : ""}`}
                      onClick={() => void salvarModelo(i)}
                      title="Salvar esta pergunta"
                      disabled={modeloSavingIdx === i || modeloSavedIdx === i}
                    >
                      <IconRepoIn />
                    </button>
                    {modeloSavedIdx === i && (
                      <span className={styles.modeloSavedMsg}>Salvo!</span>
                    )}
                  </div>
                  {(r.classificacao.pipe === "semantica" || (r.classificacao.pipe === "hibrida" && r.aguardaFase2)) && r.resposta.dados_usados.length === 0 && r.limiarUsado != null && r.limiarMinimo != null && r.limiarUsado <= r.limiarMinimo + 0.001 ? (
                    <p className={styles.limiarMinimoAviso}>
                      Limiar mínimo de {Math.round(r.limiarMinimo * 100)}% atingido sem memos relevantes encontrados.
                      O limiar inicial e o mínimo são configuráveis em <strong>Admin → Outros → Configurações do sistema</strong>.
                    </p>
                  ) : null}
                  <p className={styles.cardRespostaText}>{stripMarkdown(r.resposta.resposta)}</p>
                  {r.resposta.dados_estruturados ? (
                    Array.isArray(r.resposta.dados_estruturados)
                      ? r.resposta.dados_estruturados.map((d, idx) => (
                          <TabelaEstruturada key={idx} dados={d} onOpenMemo={(id) => void openMemoCard(id)} loadingCardId={loadingCardId} />
                        ))
                      : <TabelaEstruturada dados={r.resposta.dados_estruturados} onOpenMemo={(id) => void openMemoCard(id)} loadingCardId={loadingCardId} />
                  ) : null}
                  {r.classificacao.pipe === "semantica" ? (
                    <TabelaSemantica dados_usados={r.resposta.dados_usados} onOpenMemo={(id) => void openMemoCard(id)} loadingCardId={loadingCardId} />
                  ) : null}
                  {r.resposta.limitacoes.length > 0 ? (
                    <ul className={styles.limitacoes}>
                      {r.resposta.limitacoes.map((l, j) => <li key={j}>{l}</li>)}
                    </ul>
                  ) : null}
                  {me?.showApiCost !== false && r.apiCost > 0 ? (
                    <p className={styles.apiCostLine}>
                      Custo de API: ${r.apiCost.toFixed(6)} — Créditos: {(r.apiCost * 100).toFixed(6)}
                    </p>
                  ) : null}
                  {me?.showLlmTrace && r.timings && r.timings.length > 0 ? (
                    <details className={styles.memosDetails}>
                      <summary className={styles.memosSummary}>
                        Tempo: {((r.timings[0]?.durationMs ?? 0) / 1000).toFixed(1)}s (ver etapas)
                      </summary>
                      <ul className={styles.memosList}>
                        {r.timings.map((t, j) => (
                          <li key={j} className={styles.memosItem} style={{ justifyContent: "space-between" }}>
                            <span style={j === 0 ? { fontWeight: 600 } : undefined}>{t.label}</span>
                            <span style={{ fontVariantNumeric: "tabular-nums", marginLeft: "0.75rem" }}>
                              {(t.durationMs / 1000).toFixed(2)}s
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
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
                      title={`Ver trace de ${r.llmTrace.length} chamada(s) desta resposta`}
                    >
                      <IconTrace /> {r.llmTrace.length}
                    </button>
                  ) : null}
                </div>
                {r.sugestaoAviso && r.avisoSnapshot ? (
                  avisoSavedPergunta === r.perguntaTexto ? (
                    <div className={styles.avisoSugestao}>
                      <span className={styles.avisoSugestaoCheck}>✓</span>
                      <span className={styles.avisoSugestaoText}>Aviso ativado.</span>
                      <a href="/avisos" className={styles.avisoLink}>Meus Avisos →</a>
                    </div>
                  ) : (
                    <div className={styles.avisoSugestao}>
                      <span className={styles.avisoSugestaoIcon} aria-hidden>🔔</span>
                      <span className={styles.avisoSugestaoText}>{r.sugestaoAviso}</span>
                      <button
                        type="button"
                        className={styles.avisoSugestaoBtn}
                        onClick={() => setAvisoModal({
                          cardIdx: i,
                          descricao: r.sugestaoAviso!.length > 500
                            ? r.sugestaoAviso!.slice(0, 497) + "…"
                            : r.sugestaoAviso!,
                          freqTipo: "diaria",
                          freqHoras: 1,
                          email: me?.email ?? "",
                        })}
                      >
                        Configurar aviso ▸
                      </button>
                    </div>
                  )
                ) : null}
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

      {modeloSelectOpen ? (
        <div className={styles.modeloModalOverlay} onClick={() => setModeloSelectOpen(false)}>
          <div className={styles.modeloModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modeloModalHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span className={styles.modeloModalTitle}>Perguntas salvas</span>
                <button
                  type="button"
                  className={`${styles.modeloFilterBtn}${modalShowSearch || modalSearchText ? ` ${styles.modeloFilterBtnActive}` : ""}`}
                  title={modalShowSearch ? "Fechar busca" : "Buscar por texto"}
                  onClick={() => {
                    if (modalShowSearch) {
                      setModalShowSearch(false);
                      setModalSearchText("");
                    } else {
                      setModalShowSearch(true);
                      setTimeout(() => modalSearchInputRef.current?.focus(), 50);
                    }
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  {modalSearchText && <span className={styles.modeloFilterDot} />}
                </button>
                {modeloCatOptions.length > 1 && (
                  <button
                    type="button"
                    className={`${styles.modeloFilterBtn}${showCatFilter || filterCat ? ` ${styles.modeloFilterBtnActive}` : ""}`}
                    title="Filtrar por categoria"
                    onClick={() => setShowCatFilter((v) => !v)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                    </svg>
                    {filterCat && <span className={styles.modeloFilterDot} />}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button
                  type="button"
                  className={styles.modeloModalClose}
                  style={{ fontSize: "0.75rem", padding: "0.1rem 0.4rem", opacity: 0.7 }}
                  title="Editar perguntas salvas"
                  onClick={() => { setModeloSelectOpen(false); navigate("/perguntas-salvas"); }}
                ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{display:"inline",verticalAlign:"middle",marginRight:"3px"}}><path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4 5.4-5.4z"/></svg>Editar</button>
                <button type="button" className={styles.modeloModalClose} onClick={() => setModeloSelectOpen(false)}>×</button>
              </div>
            </div>
            {modalShowSearch && (
              <div className={styles.modeloSearchBar}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--mm-text-muted,#94a3b8)", flexShrink: 0 }}>
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  ref={modalSearchInputRef}
                  type="text"
                  className={styles.modeloSearchInput}
                  placeholder="Buscar na pergunta ou anotações…"
                  value={modalSearchText}
                  onChange={(e) => setModalSearchText(e.target.value)}
                />
                {modalSearchText && (
                  <button
                    type="button"
                    className={styles.modeloSearchClear}
                    onClick={() => setModalSearchText("")}
                    title="Limpar"
                  >×</button>
                )}
              </div>
            )}
            {showCatFilter && modeloCatOptions.length > 1 && (
              <div className={styles.modeloCatFilterBar}>
                <button
                  className={`${styles.modeloCatChip}${!filterCat ? ` ${styles.modeloCatChipActive}` : ""}`}
                  onClick={() => setFilterCat(null)}
                >Todas</button>
                {modeloCatOptions.map((cat) => (
                  <button
                    key={cat}
                    className={`${styles.modeloCatChip}${filterCat === cat ? ` ${styles.modeloCatChipActive}` : ""}`}
                    onClick={() => setFilterCat(filterCat === cat ? null : cat)}
                  >{cat}</button>
                ))}
              </div>
            )}
            {modelosLoading ? (
              <p className={styles.modeloModalEmpty}>Carregando…</p>
            ) : modelos.length === 0 ? (
              <p className={styles.modeloModalEmpty}>Nenhuma pergunta salva{workspaceGroupId ? " neste grupo" : ""}.</p>
            ) : filteredModelos.length === 0 ? (
              <p className={styles.modeloModalEmpty}>Nenhuma pergunta nesta categoria.</p>
            ) : (
              <ul className={styles.modeloList}>
                {filteredModelos.map((m) => (
                  <li key={m.id} className={styles.modeloItem}>
                    {editingModalModelo?.id === m.id ? (
                      <div className={styles.modeloInlineEdit}>
                        <textarea
                          className={styles.modeloInlineTextarea}
                          value={editingModalModelo.pergunta}
                          rows={2}
                          onChange={(e) => setEditingModalModelo({ ...editingModalModelo, pergunta: e.target.value })}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                        />
                        <textarea
                          className={styles.modeloInlineTextarea}
                          value={editingModalModelo.anotacoes}
                          rows={1}
                          placeholder="Anotações (opcional)"
                          onChange={(e) => setEditingModalModelo({ ...editingModalModelo, anotacoes: e.target.value })}
                          style={{ fontStyle: "italic", fontSize: "0.78rem" }}
                        />
                        <div className={styles.modeloInlineStarRow}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              className={`${styles.modeloInlineStar}${editingModalModelo.estrelas !== null && n <= editingModalModelo.estrelas ? ` ${styles.modeloInlineStarOn}` : ""}`}
                              onClick={() => setEditingModalModelo({ ...editingModalModelo, estrelas: editingModalModelo.estrelas === n ? null : n })}
                              title={`${n} estrela${n > 1 ? "s" : ""}`}
                            >★</button>
                          ))}
                        </div>
                        <div className={styles.modeloInlineActions}>
                          <button
                            type="button"
                            className={styles.modeloInlineSave}
                            onClick={() => void saveModalModelo()}
                            disabled={savingModalModelo || !editingModalModelo.pergunta.trim()}
                          >{savingModalModelo ? "…" : "Salvar"}</button>
                          <button
                            type="button"
                            className={styles.modeloInlineCancel}
                            onClick={() => setEditingModalModelo(null)}
                          >Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className={styles.modeloItemRow}>
                          <button
                            type="button"
                            className={styles.modeloItemBtn}
                            onClick={() => { setPergunta(m.pergunta); setModeloSelectOpen(false); }}
                          >
                            {(m.category || m.estrelas) ? (
                              <span className={styles.modeloItemMeta}>
                                {m.category ? <span className={styles.modeloItemCat}>{m.category}</span> : null}
                                {m.estrelas ? <span className={styles.modeloItemStars}>{"★".repeat(m.estrelas)}</span> : null}
                              </span>
                            ) : null}
                            <span className={styles.modeloItemText}>{m.pergunta}</span>
                          </button>
                          <button
                            type="button"
                            className={styles.modeloItemEditBtn}
                            title="Editar"
                            onClick={(e) => { e.stopPropagation(); setEditingModalModelo({ id: m.id, pergunta: m.pergunta, anotacoes: m.anotacoes ?? "", estrelas: m.estrelas ?? null }); }}
                          ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4 5.4-5.4z"/></svg></button>
                          {m.anotacoes ? (
                            <button
                              type="button"
                              className={styles.modeloItemInfoBtn}
                              title={openNoteId === m.id ? "Fechar orientação" : "Ver orientação"}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenNoteId(openNoteId === m.id ? null : m.id);
                              }}
                            >
                              <span className={styles.modeloItemInfoBadge}>i</span>
                            </button>
                          ) : null}
                        </div>
                        {openNoteId === m.id && m.anotacoes ? (
                          <div className={styles.modeloItemNoteExpanded}>
                            {m.anotacoes}
                          </div>
                        ) : null}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {avisoModal ? (
        <div className={styles.filterOverlay} onClick={() => { if (!avisoSaving) setAvisoModal(null); }}>
          <div className={styles.filterModal} style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.filterModalTitle}>Configurar aviso</h3>
            <label className={styles.filterLabel}>
              Descrição
              <input
                type="text"
                className={styles.filterInput}
                value={avisoModal.descricao}
                maxLength={500}
                onChange={(e) => setAvisoModal({ ...avisoModal, descricao: e.target.value })}
              />
            </label>
            <div className={styles.filterLabel}>
              Frequência
              <div className={styles.avisoFreqRow}>
                {([1, 2, 3, 6, 12] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`${styles.freqChip}${avisoModal.freqTipo === "horas" && avisoModal.freqHoras === h ? ` ${styles.freqChipActive}` : ""}`}
                    onClick={() => setAvisoModal({ ...avisoModal, freqTipo: "horas", freqHoras: h })}
                  >
                    {h}h
                  </button>
                ))}
                {(["diaria", "semanal", "mensal"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`${styles.freqChip}${avisoModal.freqTipo === t ? ` ${styles.freqChipActive}` : ""}`}
                    onClick={() => setAvisoModal({ ...avisoModal, freqTipo: t })}
                  >
                    {t === "diaria" ? "Diária" : t === "semanal" ? "Semanal" : "Mensal"}
                  </button>
                ))}
              </div>
            </div>
            <label className={styles.filterLabel}>
              E-mail
              <input
                type="email"
                className={styles.filterInput}
                value={avisoModal.email}
                onChange={(e) => setAvisoModal({ ...avisoModal, email: e.target.value })}
              />
            </label>
            {avisoSaveErr ? <p className="mm-error" style={{ margin: 0 }}>{avisoSaveErr}</p> : null}
            <div className={styles.filterActions}>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                disabled={avisoSaving || !avisoModal.descricao.trim() || !avisoModal.email.trim()}
                onClick={() => void ativarAviso()}
              >
                {avisoSaving ? "Ativando…" : "Ativar aviso"}
              </button>
              <button
                type="button"
                className="mm-btn"
                disabled={avisoSaving}
                onClick={() => setAvisoModal(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {helpHintOpenIdx !== null && respostas[helpHintOpenIdx] ? (() => {
        const rHelp = respostas[helpHintOpenIdx]!;
        const botaoSemantico = rHelp.classificacao.pipe === "semantica"
          ? <strong>Ampliar busca</strong>
          : <strong>→ Semântico</strong>;
        const categoriaDetectada = rHelp.classificacao.categorias.length > 0;
        let mensagem: React.ReactNode;
        if (categoriaDetectada) {
          const campos = getCamposForCategories(rHelp.classificacao.categorias);
          const termos = campos.length > 0 ? campos.join(", ") : rHelp.classificacao.categorias.join(", ");
          mensagem = <>
            Para trazer respostas semânticas clique no {botaoSemantico} e para trazer respostas com dados estruturados re-formule sua pergunta e use os termos como: <strong>{termos}</strong>.
          </>;
        } else {
          const todasCategorias = contextCategories.filter((c) => c.isActive).map((c) => c.name).join(", ");
          mensagem = <>
            Para eu responder com semântica clique no {botaoSemantico} e para responder com dados estruturados mencione uma das categorias previstas no sistema: <strong>{todasCategorias || "nenhuma categoria cadastrada"}</strong>.
          </>;
        }
        return (
          <div className={styles.ajudaModalOverlay} onClick={() => setHelpHintOpenIdx(null)}>
            <div className={styles.ajudaModalBox}>
              <p className={styles.ajudaModalText}>{mensagem}</p>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
