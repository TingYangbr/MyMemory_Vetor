import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";

import reviewStyles from "../pages/MemoTextReviewPage.module.css";

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

function getSpeechRecognitionCtor(): (new () => SpeechRecInstance) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecInstance;
    webkitSpeechRecognition?: new () => SpeechRecInstance;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function normalizeVoice(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Palavra de atenção no reconhecimento (não listar variantes na UI — só comandos em cápsulas).
 * Aceita "my memory", "mymemory", variações sem acento.
 */
function hasWake(n: string): boolean {
  const x = normalizeVoice(n);
  return (
    /\bmymemory\b/.test(x) ||
    /\bmy memory\b/.test(x) ||
    /\bmai memory\b/.test(x) ||
    /\bmy memoria\b/.test(x)
  );
}

function stripWakePhrases(raw: string): string {
  return raw
    .replace(/\bmy\s*memory\b/gi, "")
    .replace(/\bmymemory\b/gi, "")
    .replace(/\bmai\s*memory\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

type EditTarget = "none" | "text" | "keywords";

export interface UseMemoReviewVoiceAssistantOptions {
  soundEnabled: boolean;
  /** Página pronta para revisar (ex.: não em loading de documento). */
  active: boolean;
  mediaText: string;
  setMediaText: Dispatch<SetStateAction<string>>;
  keywords: string;
  setKeywords: Dispatch<SetStateAction<string>>;
  textAreaRef: RefObject<HTMLTextAreaElement | null>;
  keywordsAreaRef: RefObject<HTMLTextAreaElement | null>;
  onSave: () => void | Promise<void>;
  canSave: boolean;
  setError: Dispatch<SetStateAction<string | null>>;
}

export interface UseMemoReviewVoiceAssistantResult {
  voiceBanner: ReactNode | null;
  /** Anexar à className do textarea do corpo do memo. */
  textAreaExtraClass: string;
  /** Anexar à className do textarea de keywords. */
  keywordsAreaExtraClass: string;
  /** Combinar com onFocus/onBlur do textarea do corpo (clique = modo edição voz). */
  voiceTextAreaProps: { onFocus: () => void; onBlur: () => void };
  /** Combinar com onFocus/onBlur do textarea de keywords. */
  voiceKeywordsAreaProps: { onFocus: () => void; onBlur: () => void };
  /** Sugestão sob «Texto ou Resumo» (edição ou narração conforme preferências). */
  memoBodyHint: string;
  /** Sugestão sob «Palavras-chave» (voz vs só teclado). */
  memoKeywordsHint: string;
  srAvailable: boolean;
}

type VoiceBannerChips =
  | { kind: "message"; text: string }
  | { kind: "chips"; commands: string[]; faleMyMemoryPrefix?: boolean }
  | { kind: "editHintText" }
  | { kind: "editHintKeywords" };

function buildReviewVoiceChips(
  editTarget: EditTarget,
  listeningPaused: boolean,
  soundEnabled: boolean,
  localMicOn: boolean
): VoiceBannerChips {
  if (!soundEnabled) {
    return {
      kind: "message",
      text: "Voz desactivada nas preferências — active «Som / voz» nas definições para usar o microfone aqui.",
    };
  }
  if (!localMicOn) {
    return { kind: "message", text: "Ligue o interruptor da voz para o microfone ouvir comandos." };
  }
  if (listeningPaused) {
    return { kind: "chips", commands: ["continuar", "ouvir", "retomar", "ativar"] };
  }
  if (editTarget === "text") {
    return { kind: "editHintText" };
  }
  if (editTarget === "keywords") {
    return { kind: "editHintKeywords" };
  }
  return {
    kind: "chips",
    faleMyMemoryPrefix: true,
    commands: [
      "salvar",
      "encerrar",
      "resumir",
      "editar texto",
      "descrever",
      "palavras-chave",
      "keywords",
      "pausar",
    ],
  };
}

function VoiceReviewMicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.31 6-6.72h-1.7z" />
    </svg>
  );
}

function insertAtCursor(
  el: HTMLTextAreaElement | null,
  value: string,
  chunk: string
): { next: string; caret: number } {
  const c = chunk.trim();
  if (!c) return { next: value, caret: el?.selectionStart ?? value.length };
  if (!el) {
    const sep = value.length > 0 && !/\s$/.test(value) ? " " : "";
    const next = value + sep + c;
    return { next, caret: next.length };
  }
  const start = typeof el.selectionStart === "number" ? el.selectionStart : value.length;
  const end = typeof el.selectionEnd === "number" ? el.selectionEnd : value.length;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const sep = before.length > 0 && !/\s$/.test(before) && !/^\s/.test(c) ? " " : "";
  const ins = sep + c;
  const next = before + ins + after;
  return { next, caret: (before + ins).length };
}

function appendKeywordChunks(setKeywords: Dispatch<SetStateAction<string>>, chunks: string[]) {
  const clean = chunks.map((s) => s.trim()).filter(Boolean);
  if (!clean.length) return;
  setKeywords((prev) => {
    const parts = prev
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const x of clean) {
      if (!parts.some((p) => p.toLowerCase() === x.toLowerCase())) parts.push(x);
    }
    return parts.join(", ");
  });
}

function splitKeywordTranscript(transcript: string): string[] {
  const parts = transcript
    .split(/\bvirgula\b|\bvírgula\b/gi)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [transcript.trim()].filter(Boolean);
}

export function useMemoReviewVoiceAssistant(
  options: UseMemoReviewVoiceAssistantOptions
): UseMemoReviewVoiceAssistantResult {
  const optsRef = useRef(options);
  optsRef.current = options;

  const [editTarget, setEditTarget] = useState<EditTarget>("none");
  const [listeningPaused, setListeningPaused] = useState(false);
  const [localMicOn, setLocalMicOn] = useState(true);
  const [srAvailable] = useState(() => Boolean(getSpeechRecognitionCtor()));

  const recRef = useRef<SpeechRecInstance | null>(null);
  const wantListenRef = useRef(false);
  const sessionRef = useRef(0);
  const editTargetRef = useRef<EditTarget>("none");
  const listeningPausedRef = useRef(false);
  const blurClearTimerRef = useRef<number | null>(null);

  const liveId = useId();
  const toggleId = useId();
  const [heardInterim, setHeardInterim] = useState("");
  const [heardFinal, setHeardFinal] = useState("");

  useEffect(() => {
    editTargetRef.current = editTarget;
  }, [editTarget]);
  useEffect(() => {
    listeningPausedRef.current = listeningPaused;
  }, [listeningPaused]);

  const stopRec = useCallback(() => {
    wantListenRef.current = false;
    sessionRef.current++;
    const r = recRef.current;
    recRef.current = null;
    try {
      r?.stop?.();
    } catch {
      /* */
    }
  }, []);

  const clearBlurTimer = useCallback(() => {
    if (blurClearTimerRef.current !== null) {
      window.clearTimeout(blurClearTimerRef.current);
      blurClearTimerRef.current = null;
    }
  }, []);

  const scheduleBlurClearEditTarget = useCallback(() => {
    clearBlurTimer();
    blurClearTimerRef.current = window.setTimeout(() => {
      blurClearTimerRef.current = null;
      const a = document.activeElement;
      const o = optsRef.current;
      if (a !== o.textAreaRef.current && a !== o.keywordsAreaRef.current) {
        setEditTarget("none");
      }
    }, 90);
  }, [clearBlurTimer]);

  const onTextAreaVoiceFocus = useCallback(() => {
    clearBlurTimer();
    setEditTarget("text");
  }, [clearBlurTimer]);

  const onTextAreaVoiceBlur = useCallback(() => {
    scheduleBlurClearEditTarget();
  }, [scheduleBlurClearEditTarget]);

  const onKeywordsVoiceFocus = useCallback(() => {
    clearBlurTimer();
    setEditTarget("keywords");
  }, [clearBlurTimer]);

  const onKeywordsVoiceBlur = useCallback(() => {
    scheduleBlurClearEditTarget();
  }, [scheduleBlurClearEditTarget]);

  useEffect(() => () => clearBlurTimer(), [clearBlurTimer]);

  const startRec = useCallback(() => {
    const SR = getSpeechRecognitionCtor();
    if (!SR) return;
    stopRec();
    wantListenRef.current = true;
    const sid = ++sessionRef.current;
    let rec: SpeechRecInstance;
    try {
      rec = new SR();
    } catch {
      wantListenRef.current = false;
      optsRef.current.setError("Não foi possível iniciar o reconhecimento de voz.");
      return;
    }
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    recRef.current = rec;

    rec.onresult = (ev) => {
      if (sessionRef.current !== sid || !wantListenRef.current) return;
      const o = optsRef.current;
      let interimPiece = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const line = ev.results[i]!;
        const piece = line[0]?.transcript ?? "";
        if (!line.isFinal) {
          interimPiece += piece;
          continue;
        }
        const chunk = piece.trim();
        if (!chunk) continue;
        setHeardInterim("");
        setHeardFinal(chunk);
        void processFinalUtterance(chunk, o);
      }
      const iTrim = interimPiece.trim();
      if (iTrim) setHeardInterim(iTrim);
    };

    rec.onerror = (ev) => {
      if (sessionRef.current !== sid) return;
      const cur = optsRef.current;
      const code = (ev as Event & { error?: string }).error ?? "";
      const map: Record<string, string> = {
        "not-allowed": "Microfone negado. Permita o acesso nas configurações do navegador.",
        "no-speech": "",
        aborted: "",
        network: "Erro de rede no reconhecimento de voz.",
        "service-not-allowed": "Serviço de voz indisponível.",
      };
      const msg = map[code];
      if (msg) cur.setError(msg);
      else if (code && code !== "aborted" && code !== "no-speech") cur.setError(`Voz: ${code}`);
    };

    rec.onend = () => {
      if (sessionRef.current !== sid || !wantListenRef.current) return;
      recRef.current = null;
      window.setTimeout(() => {
        if (sessionRef.current !== sid || !wantListenRef.current) return;
        try {
          const next = new SR();
          next.lang = "pt-BR";
          next.continuous = true;
          next.interimResults = true;
          next.onresult = rec.onresult;
          next.onerror = rec.onerror;
          next.onend = rec.onend;
          recRef.current = next;
          next.start();
        } catch {
          /* */
        }
      }, 160);
    };

    const o = optsRef.current;
    try {
      rec.start();
    } catch {
      sessionRef.current++;
      recRef.current = null;
      wantListenRef.current = false;
      o.setError("Não foi possível iniciar o microfone.");
    }
  }, [stopRec]);

  function processFinalUtterance(chunk: string, o: UseMemoReviewVoiceAssistantOptions) {
    const n = normalizeVoice(chunk);
    const wake = hasWake(chunk);
    const et = editTargetRef.current;
    const paused = listeningPausedRef.current;

    if (paused) {
      if (
        wake &&
        (n.includes("continuar") || n.includes("ouvir") || n.includes("ativar") || n.includes("retomar"))
      ) {
        setListeningPaused(false);
      }
      return;
    }

    if (wake && (n.includes("pausar") || n.includes("parar ouvir") || n.includes("silencio"))) {
      setListeningPaused(true);
      return;
    }

    if (et === "text") {
      if (wake && (n.includes("sair") || /\bok\b/.test(n))) {
        setEditTarget("none");
        return;
      }
      if (wake && (n.includes("salvar") || n.includes("encerrar") || n.includes("terminar") || n.includes("finalizar"))) {
        if (o.canSave) void o.onSave();
        return;
      }
      const toInsert = wake ? stripWakePhrases(chunk) : chunk;
      if (!toInsert.trim()) return;
      o.setMediaText((prev) => {
        const { next, caret } = insertAtCursor(o.textAreaRef.current, prev, toInsert);
        queueMicrotask(() => {
          const el = o.textAreaRef.current;
          if (el) {
            el.focus();
            try {
              el.setSelectionRange(caret, caret);
            } catch {
              /* */
            }
          }
        });
        return next;
      });
      return;
    }

    if (et === "keywords") {
      if (wake && (n.includes("sair") || /\bok\b/.test(n))) {
        setEditTarget("none");
        return;
      }
      if (wake && (n.includes("salvar") || n.includes("encerrar") || n.includes("terminar") || n.includes("finalizar"))) {
        if (o.canSave) void o.onSave();
        return;
      }
      const textBit = wake ? stripWakePhrases(chunk) : chunk;
      if (!textBit.trim()) return;

      const pieces = splitKeywordTranscript(textBit);
      appendKeywordChunks(o.setKeywords, pieces.length ? pieces : [textBit.trim()]);

      queueMicrotask(() => {
        o.keywordsAreaRef.current?.focus();
      });
      return;
    }

    /* idle */
    if (!wake) return;

    if (n.includes("salvar") || n.includes("encerrar") || n.includes("terminar") || n.includes("finalizar")) {
      if (o.canSave) void o.onSave();
      return;
    }

    if (
      n.includes("resumir") ||
      n.includes("editar texto") ||
      n.includes("descrever") ||
      (n.includes("editar") && n.includes("texto"))
    ) {
      setEditTarget("text");
      queueMicrotask(() => {
        const el = o.textAreaRef.current;
        el?.focus();
        if (el && (el.selectionStart ?? 0) >= o.mediaText.length) {
          try {
            el.setSelectionRange(o.mediaText.length, o.mediaText.length);
          } catch {
            /* */
          }
        }
      });
      return;
    }

    if ((n.includes("palavra") && n.includes("chave")) || n.includes("keywords")) {
      setEditTarget("keywords");
      queueMicrotask(() => o.keywordsAreaRef.current?.focus());
    }
  }

  const enabled =
    options.soundEnabled &&
    options.active &&
    srAvailable &&
    localMicOn &&
    typeof window !== "undefined";

  useEffect(() => {
    if (!enabled) {
      stopRec();
      clearBlurTimer();
      setListeningPaused(false);
      setHeardInterim("");
      setHeardFinal("");
      setEditTarget("none");
      return;
    }
    startRec();
    return () => {
      stopRec();
    };
  }, [enabled, startRec, stopRec, clearBlurTimer]);

  const listeningLive =
    Boolean(enabled) && !listeningPaused && options.soundEnabled && localMicOn;
  const micStandbyOff = !options.soundEnabled || !localMicOn;
  const micPausedUi = listeningPaused && options.soundEnabled && localMicOn;
  const micWrapClass = listeningLive
    ? reviewStyles.voiceReviewMicWrapListening
    : micPausedUi
      ? reviewStyles.voiceReviewMicWrapPaused
      : micStandbyOff
        ? reviewStyles.voiceReviewMicWrapOff
        : "";

  let voiceBanner: ReactNode | null = null;
  if (options.active) {
    if (!srAvailable) {
      voiceBanner = (
        <div className={reviewStyles.voiceReviewBanner} role="status">
          <strong>Voz na revisão:</strong> reconhecimento não disponível neste navegador (experimente Chrome ou Edge).
        </div>
      );
    } else {
      const heardNow = heardInterim || heardFinal;
      const heardIsLive = Boolean(heardInterim);
      const voiceChips = buildReviewVoiceChips(
        editTarget,
        listeningPaused,
        options.soundEnabled,
        localMicOn
      );
      voiceBanner = (
        <div
          className={`${reviewStyles.voiceReviewBanner} ${listeningPaused ? reviewStyles.voiceReviewBannerPaused : ""}`}
          role="region"
          aria-label="Assistente de voz na revisão"
        >
          <div className={reviewStyles.voiceReviewTopRow}>
            <label className={reviewStyles.voiceReviewToggle} htmlFor={toggleId}>
              <input
                id={toggleId}
                type="checkbox"
                role="switch"
                className={reviewStyles.voiceReviewToggleInput}
                checked={localMicOn}
                disabled={!options.soundEnabled}
                aria-label="Activar ou desactivar o microfone na revisão"
                onChange={(e) => {
                  if (!options.soundEnabled) return;
                  const on = e.target.checked;
                  setLocalMicOn(on);
                  if (!on) {
                    setEditTarget("none");
                    setListeningPaused(false);
                  }
                }}
              />
              <span className={reviewStyles.voiceReviewToggleTrack} aria-hidden />
              <span className={reviewStyles.voiceReviewToggleLabel}>Voz</span>
            </label>
            <div
              className={`${reviewStyles.voiceReviewMicWrap}${micWrapClass ? ` ${micWrapClass}` : ""}`}
              aria-hidden
            >
              <VoiceReviewMicIcon className={reviewStyles.voiceReviewMicIcon} />
            </div>
            {voiceChips.kind === "chips" ? (
              <div className={reviewStyles.voiceReviewChipsInline}>
                {voiceChips.faleMyMemoryPrefix ? (
                  <span className={reviewStyles.voiceReviewWakePrefix}>
                    Fale <strong>MyMemory</strong>
                    <span className={reviewStyles.voiceReviewWakePlus} aria-hidden>
                      +
                    </span>
                  </span>
                ) : null}
                {voiceChips.commands.map((c) => (
                  <span key={c} className={reviewStyles.voiceReviewChip}>
                    {c}
                  </span>
                ))}
              </div>
            ) : voiceChips.kind === "editHintText" ? (
              <div className={reviewStyles.voiceReviewChipsInline}>
                <span className={reviewStyles.voiceReviewEditHintMain}>Narrar e/ou descrever o memo</span>
              </div>
            ) : voiceChips.kind === "editHintKeywords" ? (
              <div className={`${reviewStyles.voiceReviewChipsInline} ${reviewStyles.voiceReviewEditHintRow}`}>
                <span className={reviewStyles.voiceReviewEditHintText}>Fale as palavras pausadamente ou fale</span>
                <span className={reviewStyles.voiceReviewChip}>vírgula</span>
                <span className={reviewStyles.voiceReviewEditHintText}>para separar as palavras</span>
              </div>
            ) : null}
          </div>
          {voiceChips.kind === "message" ? (
            <p className={reviewStyles.voiceReviewBlockedMsg}>{voiceChips.text}</p>
          ) : null}
          {heardNow ? (
            <p
              id={liveId}
              className={heardIsLive ? reviewStyles.voiceReviewHeardInterim : reviewStyles.voiceReviewHeardFinal}
              aria-live="polite"
            >
              {heardNow}
            </p>
          ) : null}
        </div>
      );
    }
  }

  return {
    voiceBanner,
    textAreaExtraClass:
      editTarget === "text" && !listeningPaused && localMicOn && options.soundEnabled
        ? reviewStyles.voiceReviewFieldPulse
        : "",
    keywordsAreaExtraClass:
      editTarget === "keywords" && !listeningPaused && localMicOn && options.soundEnabled
        ? reviewStyles.voiceReviewFieldPulse
        : "",
    voiceTextAreaProps: { onFocus: onTextAreaVoiceFocus, onBlur: onTextAreaVoiceBlur },
    voiceKeywordsAreaProps: { onFocus: onKeywordsVoiceFocus, onBlur: onKeywordsVoiceBlur },
    memoBodyHint: !options.active
      ? ""
      : options.soundEnabled
        ? "Narrar o texto"
        : "Editar o texto/resumo abaixo",
    memoKeywordsHint: options.soundEnabled
      ? "Falar as palavras pausadamente"
      : "Digitar palavras chaves separados por vírgula",
    srAvailable,
  };
}
