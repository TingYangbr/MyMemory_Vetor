/**
 * Captura de fala curta para os chips das perguntas salvas: grava até a pessoa parar de falar
 * (~1,5 s de silêncio) e devolve o texto. Desktop usa a Web Speech API; mobile grava com
 * MediaRecorder, detecta o silêncio pelo volume do microfone e transcreve no Whisper.
 */

const SILENCIO_MS = 1500;
const MAX_MS = 10_000;
/** Sem nenhuma fala detectada até aqui → desiste */
const SEM_FALA_MS = 5000;

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

export const VOZ_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

interface SpeechRec extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort?(): void;
  onresult: ((ev: { results: { length: number; [i: number]: { [k: number]: { transcript: string } } } }) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: (() => void) | null;
}

export interface CapturaVoz {
  /** Texto final (vazio se não houve fala) */
  resultado: Promise<string>;
  /** Encerra antes do silêncio (o texto já captado é mantido) */
  parar: () => void;
}

export function vozDisponivel(): boolean {
  if (VOZ_MOBILE) return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export function capturarFalaCurta(onParcial?: (texto: string) => void): CapturaVoz {
  return VOZ_MOBILE ? capturarMobile() : capturarDesktop(onParcial);
}

function capturarDesktop(onParcial?: (texto: string) => void): CapturaVoz {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  let parar = () => {};
  const resultado = new Promise<string>((resolve, reject) => {
    if (!SR) { reject(new Error("Voz não disponível neste navegador. Use Chrome ou Edge.")); return; }
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    let texto = "";
    let encerrado = false;
    let timerSilencio: ReturnType<typeof setTimeout> | null = null;
    const encerrar = () => {
      if (encerrado) return;
      encerrado = true;
      if (timerSilencio) clearTimeout(timerSilencio);
      clearTimeout(timerMax);
      try { rec.stop(); } catch { /* */ }
    };
    const timerMax = setTimeout(encerrar, MAX_MS);
    timerSilencio = setTimeout(encerrar, SEM_FALA_MS);
    rec.onresult = (ev) => {
      let t = "";
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i]![0]!.transcript;
      texto = t.replace(/[.!?,;:]+$/g, "").trim();
      onParcial?.(texto);
      if (timerSilencio) clearTimeout(timerSilencio);
      timerSilencio = setTimeout(encerrar, SILENCIO_MS);
    };
    rec.onerror = (ev: Event) => {
      const code = (ev as Event & { error?: string }).error ?? "";
      if (code === "not-allowed") { encerrado = true; reject(new Error("Microfone bloqueado. Permita o acesso nas configurações do navegador.")); }
      encerrar();
    };
    rec.onend = () => { encerrado = true; if (timerSilencio) clearTimeout(timerSilencio); clearTimeout(timerMax); resolve(texto); };
    parar = encerrar;
    try { rec.start(); } catch { reject(new Error("Não foi possível iniciar o microfone.")); }
  });
  return { resultado, parar: () => parar() };
}

function capturarMobile(): CapturaVoz {
  let parar = () => {};
  const resultado = (async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      throw new Error("Microfone bloqueado. Permita o acesso nas configurações do navegador.");
    }
    const mimeType =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" :
      MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    // Detector de silêncio pelo volume (RMS) do microfone
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = AC ? new AC() : null;
    const analyser = ctx?.createAnalyser();
    if (ctx && analyser) {
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
    }

    const parou = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    const inicio = Date.now();
    let ultimaFala = 0;
    let falou = false;
    const buf = new Float32Array(1024);
    const encerrar = () => { if (recorder.state === "recording") recorder.stop(); };
    parar = encerrar;
    const tick = setInterval(() => {
      const agora = Date.now();
      if (analyser) {
        analyser.getFloatTimeDomainData(buf);
        let soma = 0;
        for (let i = 0; i < buf.length; i++) soma += buf[i]! * buf[i]!;
        if (Math.sqrt(soma / buf.length) > 0.02) { falou = true; ultimaFala = agora; }
      }
      if (agora - inicio > MAX_MS) encerrar();
      else if (falou && agora - ultimaFala > SILENCIO_MS) encerrar();
      else if (!falou && agora - inicio > (analyser ? SEM_FALA_MS : 6000)) encerrar();
    }, 100);

    recorder.start(250);
    await parou;
    clearInterval(tick);
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});

    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size < 1000) return "";
    const form = new FormData();
    form.append("audio", blob, "recording.webm");
    const res = await fetch(`${apiBase}/api/perguntas/transcribe`, { method: "POST", body: form, credentials: "include" });
    if (!res.ok) throw new Error("Falha ao transcrever o áudio.");
    const { text } = (await res.json()) as { text?: string };
    return (text ?? "").replace(/[.!?,;:]+$/g, "").trim();
  })();
  return { resultado, parar: () => parar() };
}
