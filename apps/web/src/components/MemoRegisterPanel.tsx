import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiPostJson, apiPostMultipart } from "../api";
import type {
  AudioMemoProcessResponse,
  ImageMemoProcessResponse,
  MemoCreatedResponse,
  PhotoAiUsage,
  TextMemoProcessResponse,
  UserIaUseLevel,
  UserMemoPreferences,
  UserMediaLimitsResponse,
  VideoMemoProcessResponse,
} from "@mymemory/shared";
import { maxBytesForClientUploadKind, photoAiUsageFromUserIaLevel } from "@mymemory/shared";
import MemoProcessOverlay, {
  AUDIO_MEMO_PROCESS_STEPS,
  IMAGE_MEMO_PROCESS_STEPS,
  STANDARD_MEMO_PROCESS_STEPS,
  TEXT_MEMO_PROCESS_STEPS,
  VIDEO_MEMO_PROCESS_STEPS,
} from "./MemoProcessOverlay";
import memoProcessOverlayStyles from "./MemoProcessOverlay.module.css";
import IaTextoLevelFieldset from "./IaTextoLevelFieldset";
import MediaCaptureConfirmModal from "./MediaCaptureConfirmModal";
import styles from "./MemoRegisterPanel.module.css";

function sleepMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort);
  });
}

type Props = {
  onRegistered?: (memo: MemoCreatedResponse) => void;
  /** `null` ou omitido = memos pessoais (sem grupo). */
  workspaceGroupId?: number | null;
  /** Preferências de `/conta/preferencias` (revisão antes da IA + nível IA por tipo). */
  memoPrefs?: Partial<UserMemoPreferences> | null;
  /** Limites de `GET /api/me/media-limits` para validar tamanho antes do envio. */
  mediaLimits?: UserMediaLimitsResponse | null;
  /** Exibe atalho «Buscar memos» centrado no topo do cartão (ex.: página inicial). */
  showBuscarMemosLink?: boolean;
};

const CLIENT_AUDIO_EXT = new Set([
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".opus",
  ".webm",
  ".weba",
  ".m4a",
  ".flac",
  ".aac",
]);

function clientUploadKind(file: File): "image" | "video" | "audio" | "document" {
  const t = file.type.toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  const n = file.name.toLowerCase();
  const ext = n.includes(".") ? n.slice(n.lastIndexOf(".")) : "";
  if (CLIENT_AUDIO_EXT.has(ext)) return "audio";
  return "document";
}

type MemoPrefsResolved = Required<UserMemoPreferences>;

function resolveMemoPrefs(p: Partial<UserMemoPreferences> | null | undefined): MemoPrefsResolved {
  const base: MemoPrefsResolved = {
    confirmEnabled: true,
    soundEnabled: true,
    allowFreeSpecificFieldsWithoutCategoryMatch: false,
    iaUseTexto: "basico",
    iaUseImagem: "basico",
    iaUseVideo: "basico",
    iaUseAudio: "basico",
    iaUseDocumento: "basico",
    iaUseUrl: "basico",
    imageOcrVisionMinConfidence: null,
  };
  if (!p) return base;
  return {
    confirmEnabled: p.confirmEnabled !== false,
    soundEnabled: p.soundEnabled !== false,
    allowFreeSpecificFieldsWithoutCategoryMatch:
      p.allowFreeSpecificFieldsWithoutCategoryMatch ?? base.allowFreeSpecificFieldsWithoutCategoryMatch,
    iaUseTexto: p.iaUseTexto ?? base.iaUseTexto,
    iaUseImagem: p.iaUseImagem ?? base.iaUseImagem,
    iaUseVideo: p.iaUseVideo ?? base.iaUseVideo,
    iaUseAudio: p.iaUseAudio ?? base.iaUseAudio,
    iaUseDocumento: p.iaUseDocumento ?? base.iaUseDocumento,
    iaUseUrl: p.iaUseUrl ?? base.iaUseUrl,
    imageOcrVisionMinConfidence: p.imageOcrVisionMinConfidence ?? base.imageOcrVisionMinConfidence,
  };
}

function iaLevelForUploadKind(kind: ReturnType<typeof clientUploadKind>, p: MemoPrefsResolved): UserIaUseLevel {
  switch (kind) {
    case "image":
      return p.iaUseImagem;
    case "video":
      return p.iaUseVideo;
    case "audio":
      return p.iaUseAudio;
    default:
      return p.iaUseDocumento;
  }
}

function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileExceedsLimitMessage(
  file: File,
  limits: UserMediaLimitsResponse | null | undefined,
  kind: ReturnType<typeof clientUploadKind>
): string | null {
  if (!limits) return null;
  const max = maxBytesForClientUploadKind(limits, kind);
  if (file.size <= max) return null;
  return `Este arquivo tem ${formatFileSize(file.size)}; o máximo permitido para este tipo no seu plano é ${formatFileSize(max)}.`;
}

const IMAGE_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "heic",
  "heif",
  "avif",
  "tif",
  "tiff",
]);

function isImageFile(file: File): boolean {
  const t = file.type.toLowerCase();
  if (t.startsWith("image/")) return true;
  const parts = file.name.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";
  return IMAGE_EXT.has(ext);
}

function pickVideoRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

export default function MemoRegisterPanel({
  onRegistered,
  workspaceGroupId = null,
  memoPrefs = null,
  mediaLimits = null,
  showBuscarMemosLink = false,
}: Props) {
  const navigate = useNavigate();
  const prefs = useMemo(() => resolveMemoPrefs(memoPrefs), [memoPrefs]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const photoVideoRef = useRef<HTMLVideoElement>(null);
  const photoStreamRef = useRef<MediaStream | null>(null);

  const videoRecordPreviewRef = useRef<HTMLVideoElement>(null);
  const videoRecordStreamRef = useRef<MediaStream | null>(null);
  const videoMediaRecRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<BlobPart[]>([]);
  const videoDiscardRef = useRef(false);

  const [photoCamOpen, setPhotoCamOpen] = useState(false);
  const [photoCamLoading, setPhotoCamLoading] = useState(false);

  const [videoCamOpen, setVideoCamOpen] = useState(false);
  const [videoCamLoading, setVideoCamLoading] = useState(false);
  const [videoRecState, setVideoRecState] = useState<"idle" | "recording" | "paused">("idle");
  const [videoPauseSupported, setVideoPauseSupported] = useState(false);
  const [imageIaUseLevel, setImageIaUseLevel] = useState<UserIaUseLevel>("basico");
  const [documentIaUseLevel, setDocumentIaUseLevel] = useState<UserIaUseLevel>("basico");
  const [audioIaUseLevel, setAudioIaUseLevel] = useState<UserIaUseLevel>("basico");
  const [videoIaUseLevel, setVideoIaUseLevel] = useState<UserIaUseLevel>("basico");

  const [textOpen, setTextOpen] = useState(false);
  const [textValue, setTextValue] = useState("");
  const [textIaUseLevel, setTextIaUseLevel] = useState<UserIaUseLevel>("basico");
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlIaUseLevel, setUrlIaUseLevel] = useState<UserIaUseLevel>("basico");

  const [pendingTextConfirm, setPendingTextConfirm] = useState<string | null>(null);
  const [pendingUrlConfirm, setPendingUrlConfirm] = useState<string | null>(null);
  const [pendingBinaryConfirm, setPendingBinaryConfirm] = useState<{
    file: File;
    variant: "audio" | "video" | "document";
    audioSource?: "microfone" | "arquivo";
  } | null>(null);
  const [pendingImageFileConfirm, setPendingImageFileConfirm] = useState<File | null>(null);
  const [pendingCameraPipeline, setPendingCameraPipeline] = useState<{
    file: File;
    thumbUrl: string;
  } | null>(null);

  /** Object URL da prévia durante `POST /api/memos/image/process` — overlay em tela cheia. */
  const [imageProcessPreviewUrl, setImageProcessPreviewUrl] = useState<string | null>(null);
  const [imageProcessPhaseIdx, setImageProcessPhaseIdx] = useState(0);
  const imageProcessAbortRef = useRef<AbortController | null>(null);

  const [audioProcessPreviewUrl, setAudioProcessPreviewUrl] = useState<string | null>(null);
  const [audioProcessPhaseIdx, setAudioProcessPhaseIdx] = useState(0);
  const audioProcessAbortRef = useRef<AbortController | null>(null);
  const audioProcessIntervalRef = useRef<number | null>(null);
  const audioProcessPhaseIdxRef = useRef(0);

  const [videoProcessPreviewUrl, setVideoProcessPreviewUrl] = useState<string | null>(null);
  const [videoProcessPhaseIdx, setVideoProcessPhaseIdx] = useState(0);
  const videoProcessAbortRef = useRef<AbortController | null>(null);

  /** Texto em processamento (`POST /api/memos/text/process`) — overlay em tela cheia. */
  const [textProcessBody, setTextProcessBody] = useState<string | null>(null);
  const [textProcessPhaseIdx, setTextProcessPhaseIdx] = useState(0);
  const textProcessAbortRef = useRef<AbortController | null>(null);

  /** URL em processamento (`POST /api/memos/url/process`) — overlay em tela cheia. */
  const [urlProcessUrl, setUrlProcessUrl] = useState<string | null>(null);
  const [urlProcessPhaseIdx, setUrlProcessPhaseIdx] = useState(0);
  const urlProcessAbortRef = useRef<AbortController | null>(null);

  const [audioRecModalOpen, setAudioRecModalOpen] = useState(false);
  const [audioRecStatus, setAudioRecStatus] = useState<"starting" | "recording" | "paused">("starting");
  const [audioPauseSupported, setAudioPauseSupported] = useState(false);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const audioDiscardRef = useRef(false);
  const audioAbortStartingRef = useRef(false);
  const uploadFile = useCallback(
    async (
      file: File,
      options?: {
        aiUsage?: PhotoAiUsage;
        note?: string;
        suppressGlobalError?: boolean;
        /** Só documento: nível escolhido na confirmação (ou fluxo sem modal). */
        documentIaLevel?: UserIaUseLevel;
      }
    ) => {
      setBusy(true);
      if (!options?.suppressGlobalError) setError(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const kind = clientUploadKind(file);
        let levelForUpload = iaLevelForUploadKind(kind, prefs);
        if (kind === "document" && options?.documentIaLevel != null) {
          levelForUpload = options.documentIaLevel;
        }
        const aiUsage =
          options?.aiUsage !== undefined
            ? options.aiUsage
            : photoAiUsageFromUserIaLevel(levelForUpload);
        fd.append("aiUsage", aiUsage);
        if (options?.note !== undefined && options.note.length > 0) fd.append("note", options.note);
        if (workspaceGroupId != null) fd.append("groupId", String(workspaceGroupId));
        const memo = (await apiPostMultipart("/api/memos/upload", fd)) as MemoCreatedResponse;
        const docIa =
          kind === "document" && options?.documentIaLevel != null
            ? options.documentIaLevel
            : prefs.iaUseDocumento;
        const docIaReview =
          memo.mediaType === "document" && aiUsage !== "none" && docIa !== "semIA";
        if (docIaReview) {
          navigate("/revisao/memo-documento", {
            state: {
              memoId: memo.id,
              groupId: workspaceGroupId ?? null,
              iaUseDocumento: docIa,
            },
          });
          return;
        }
        onRegistered?.(memo);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Falha no envio.";
        if (!options?.suppressGlobalError) setError(msg);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [onRegistered, workspaceGroupId, prefs, navigate]
  );

  const processImageThenReview = useCallback(
    async (file: File, iaOverride?: UserIaUseLevel, opts?: { previewUrl?: string | null }) => {
      const ac = new AbortController();
      imageProcessAbortRef.current = ac;
      const previewUrl = opts?.previewUrl ?? URL.createObjectURL(file);
      setImageProcessPreviewUrl(previewUrl);
      setImageProcessPhaseIdx(0);
      setBusy(true);
      setError(null);
      const level = iaOverride ?? imageIaUseLevel;
      let navigatedOk = false;
      try {
        const fd = new FormData();
        fd.append("iaUseImagem", level);
        if (workspaceGroupId != null) fd.append("groupId", String(workspaceGroupId));
        fd.append("file", file);
        const out = (await apiPostMultipart("/api/memos/image/process", fd, {
          signal: ac.signal,
        })) as ImageMemoProcessResponse;
        navigate("/revisao/memo-imagem", {
          state: { ...out, groupId: workspaceGroupId ?? null },
        });
        navigatedOk = true;
      } catch (e) {
        const aborted =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError");
        if (aborted) {
          setError(
            "O processamento foi interrompido. Se não tocou em «Descartar», pode ser tempo limite da rede ou do proxy em desenvolvimento — imagens grandes com OCR e IA podem demorar vários minutos. Tente de novo ou use foto mais pequena."
          );
        } else {
          setError(e instanceof Error ? e.message : "Falha ao processar imagem.");
        }
      } finally {
        imageProcessAbortRef.current = null;
        setPendingImageFileConfirm(null);
        setPendingCameraPipeline(null);
        if (!navigatedOk) {
          if (previewUrl.startsWith("blob:")) {
            try {
              URL.revokeObjectURL(previewUrl);
            } catch {
              /* */
            }
          }
          setImageProcessPreviewUrl(null);
          setBusy(false);
        }
      }
    },
    [navigate, workspaceGroupId, imageIaUseLevel]
  );

  const processAudioThenReview = useCallback(
    async (file: File, iaOverride?: UserIaUseLevel) => {
      const ac = new AbortController();
      audioProcessAbortRef.current = ac;
      const previewUrl = URL.createObjectURL(file);
      setAudioProcessPreviewUrl(previewUrl);
      setAudioProcessPhaseIdx(0);
      setBusy(true);
      setError(null);
      const level = iaOverride ?? audioIaUseLevel;
      let navigatedOk = false;
      try {
        const fd = new FormData();
        fd.append("iaUseAudio", level);
        if (workspaceGroupId != null) fd.append("groupId", String(workspaceGroupId));
        fd.append("file", file);
        const out = (await apiPostMultipart("/api/memos/audio/process", fd, {
          signal: ac.signal,
        })) as AudioMemoProcessResponse;
        if (ac.signal.aborted) return;

        if (audioProcessIntervalRef.current) {
          clearInterval(audioProcessIntervalRef.current);
          audioProcessIntervalRef.current = null;
        }

        if (level === "completo") {
          const lastIdx = STANDARD_MEMO_PROCESS_STEPS.length - 1;
          try {
            let idx = audioProcessPhaseIdxRef.current;
            while (idx < lastIdx) {
              if (ac.signal.aborted) {
                setError("Processamento cancelado.");
                return;
              }
              idx += 1;
              setAudioProcessPhaseIdx(idx);
              audioProcessPhaseIdxRef.current = idx;
              await sleepMs(520, ac.signal);
            }
            if (ac.signal.aborted) {
              setError("Processamento cancelado.");
              return;
            }
            await sleepMs(750, ac.signal);
          } catch (inner) {
            const aborted =
              inner instanceof DOMException && inner.name === "AbortError";
            if (aborted) {
              setError("Processamento cancelado.");
              return;
            }
            throw inner;
          }
        }

        if (ac.signal.aborted) {
          setError("Processamento cancelado.");
          return;
        }

        navigate("/revisao/memo-audio", {
          state: { ...out, groupId: workspaceGroupId ?? null },
        });
        navigatedOk = true;
      } catch (e) {
        const aborted =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError");
        if (aborted) {
          setError("Processamento cancelado.");
        } else {
          setError(e instanceof Error ? e.message : "Falha ao processar áudio.");
        }
      } finally {
        audioProcessAbortRef.current = null;
        setPendingBinaryConfirm(null);
        const blobUrl = previewUrl;
        queueMicrotask(() => {
          if (blobUrl.startsWith("blob:")) {
            try {
              URL.revokeObjectURL(blobUrl);
            } catch {
              /* */
            }
          }
        });
        if (!navigatedOk) {
          setAudioProcessPreviewUrl(null);
          setBusy(false);
        }
      }
    },
    [navigate, workspaceGroupId, audioIaUseLevel]
  );

  const processVideoThenReview = useCallback(
    async (file: File, iaOverride?: UserIaUseLevel) => {
      const ac = new AbortController();
      videoProcessAbortRef.current = ac;
      const previewUrl = URL.createObjectURL(file);
      setVideoProcessPreviewUrl(previewUrl);
      setVideoProcessPhaseIdx(0);
      setBusy(true);
      setError(null);
      const level = iaOverride ?? videoIaUseLevel;
      let navigatedOk = false;
      try {
        const fd = new FormData();
        fd.append("iaUseVideo", level);
        if (workspaceGroupId != null) fd.append("groupId", String(workspaceGroupId));
        fd.append("file", file);
        const out = (await apiPostMultipart("/api/memos/video/process", fd, {
          signal: ac.signal,
        })) as VideoMemoProcessResponse;
        navigate("/revisao/memo-video", {
          state: { ...out, groupId: workspaceGroupId ?? null },
        });
        navigatedOk = true;
      } catch (e) {
        const aborted =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError");
        if (aborted) {
          setError(
            "O processamento foi interrompido. Se não tocou em «Descartar», pode ser tempo limite da rede ou do proxy — vídeos com transcrição e IA podem demorar. Tente de novo ou use um arquivo menor."
          );
        } else {
          setError(e instanceof Error ? e.message : "Falha ao processar vídeo.");
        }
      } finally {
        videoProcessAbortRef.current = null;
        setPendingBinaryConfirm(null);
        const blobUrl = previewUrl;
        queueMicrotask(() => {
          if (blobUrl.startsWith("blob:")) {
            try {
              URL.revokeObjectURL(blobUrl);
            } catch {
              /* */
            }
          }
        });
        if (!navigatedOk) {
          setVideoProcessPreviewUrl(null);
          setBusy(false);
        }
      }
    },
    [navigate, workspaceGroupId, videoIaUseLevel]
  );

  useEffect(() => {
    audioProcessPhaseIdxRef.current = audioProcessPhaseIdx;
  }, [audioProcessPhaseIdx]);

  useEffect(() => {
    if (imageProcessPreviewUrl == null) return;
    setImageProcessPhaseIdx(0);
    /** Intervalo mais longo que texto/áudio: o servidor pode ficar vários minutos na última etapa sem falha. */
    const id = window.setInterval(() => {
      setImageProcessPhaseIdx((i) => Math.min(i + 1, STANDARD_MEMO_PROCESS_STEPS.length - 1));
    }, 9000);
    return () => window.clearInterval(id);
  }, [imageProcessPreviewUrl]);

  useEffect(() => {
    if (textProcessBody == null) return;
    setTextProcessPhaseIdx(0);
    const id = window.setInterval(() => {
      setTextProcessPhaseIdx((i) => Math.min(i + 1, STANDARD_MEMO_PROCESS_STEPS.length - 1));
    }, 4200);
    return () => window.clearInterval(id);
  }, [textProcessBody]);

  useEffect(() => {
    if (urlProcessUrl == null) return;
    setUrlProcessPhaseIdx(0);
    const id = window.setInterval(() => {
      setUrlProcessPhaseIdx((i) => Math.min(i + 1, STANDARD_MEMO_PROCESS_STEPS.length - 1));
    }, 4200);
    return () => window.clearInterval(id);
  }, [urlProcessUrl]);

  useEffect(() => {
    if (audioProcessPreviewUrl == null) {
      if (audioProcessIntervalRef.current) {
        clearInterval(audioProcessIntervalRef.current);
        audioProcessIntervalRef.current = null;
      }
      return;
    }
    setAudioProcessPhaseIdx(0);
    audioProcessPhaseIdxRef.current = 0;
    const id = window.setInterval(() => {
      setAudioProcessPhaseIdx((i) => Math.min(i + 1, STANDARD_MEMO_PROCESS_STEPS.length - 1));
    }, 4200);
    audioProcessIntervalRef.current = id;
    return () => {
      clearInterval(id);
      if (audioProcessIntervalRef.current === id) {
        audioProcessIntervalRef.current = null;
      }
    };
  }, [audioProcessPreviewUrl]);

  useEffect(() => {
    if (videoProcessPreviewUrl == null) return;
    setVideoProcessPhaseIdx(0);
    const id = window.setInterval(() => {
      setVideoProcessPhaseIdx((i) => Math.min(i + 1, STANDARD_MEMO_PROCESS_STEPS.length - 1));
    }, 7500);
    return () => window.clearInterval(id);
  }, [videoProcessPreviewUrl]);

  const discardImageProcessing = useCallback(() => {
    imageProcessAbortRef.current?.abort();
  }, []);

  const discardAudioProcessing = useCallback(() => {
    audioProcessAbortRef.current?.abort();
  }, []);

  const discardVideoProcessing = useCallback(() => {
    videoProcessAbortRef.current?.abort();
  }, []);

  const discardTextProcessing = useCallback(() => {
    textProcessAbortRef.current?.abort();
  }, []);

  const discardUrlProcessing = useCallback(() => {
    urlProcessAbortRef.current?.abort();
  }, []);

  /** Processa URL (IA no servidor) e abre a página de revisão antes de gravar. */
  const processUrlThenReview = useCallback(
    async (href: string, iaOverride?: UserIaUseLevel) => {
      const t = href.trim();
      if (!looksLikeUrl(t)) {
        setError("Informe uma URL http(s) válida.");
        return;
      }
      const ac = new AbortController();
      urlProcessAbortRef.current = ac;
      setUrlProcessUrl(t);
      setUrlProcessPhaseIdx(0);
      setBusy(true);
      setError(null);
      setUrlOpen(false);
      const level = iaOverride ?? urlIaUseLevel;
      let navigatedOk = false;
      try {
        const out = await apiPostJson<TextMemoProcessResponse>(
          "/api/memos/url/process",
          {
            mediaWebUrl: t,
            groupId: workspaceGroupId ?? null,
            iaUseUrl: level,
          },
          { signal: ac.signal }
        );
        navigate("/revisao/memo-texto", {
          state: { ...out, groupId: workspaceGroupId ?? null },
        });
        navigatedOk = true;
        setUrlValue("");
      } catch (e) {
        const aborted =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError");
        if (aborted) {
          setError("Processamento cancelado.");
        } else {
          setError(e instanceof Error ? e.message : "Falha ao processar URL.");
        }
      } finally {
        urlProcessAbortRef.current = null;
        setPendingUrlConfirm(null);
        if (!navigatedOk) {
          setUrlProcessUrl(null);
          setBusy(false);
        }
      }
    },
    [navigate, workspaceGroupId, urlIaUseLevel]
  );

  const handleFileFromDropzone = useCallback(
    (file: File) => {
      setError(null);
      const kindForLimit: ReturnType<typeof clientUploadKind> = isImageFile(file) ? "image" : clientUploadKind(file);
      const limitMsg = fileExceedsLimitMessage(file, mediaLimits, kindForLimit);
      if (limitMsg) {
        setError(limitMsg);
        return;
      }
      if (isImageFile(file)) {
        if (!prefs.confirmEnabled) {
          void processImageThenReview(file, prefs.iaUseImagem);
          return;
        }
        setImageIaUseLevel(prefs.iaUseImagem);
        setPendingImageFileConfirm(file);
        return;
      }
      if (!prefs.confirmEnabled) {
        const k0 = clientUploadKind(file);
        if (k0 === "audio") {
          void processAudioThenReview(file, prefs.iaUseAudio);
          return;
        }
        if (k0 === "video") {
          void processVideoThenReview(file, prefs.iaUseVideo);
          return;
        }
        void uploadFile(file);
        return;
      }
      const k = clientUploadKind(file);
      const variant = k === "audio" ? "audio" : k === "video" ? "video" : "document";
      if (variant === "document") setDocumentIaUseLevel(prefs.iaUseDocumento);
      if (variant === "audio") setAudioIaUseLevel(prefs.iaUseAudio);
      if (variant === "video") setVideoIaUseLevel(prefs.iaUseVideo);
      setPendingBinaryConfirm({
        file,
        variant,
        audioSource: variant === "audio" ? "arquivo" : undefined,
      });
    },
    [
      uploadFile,
      prefs.confirmEnabled,
      prefs.iaUseImagem,
      prefs.iaUseDocumento,
      prefs.iaUseAudio,
      prefs.iaUseVideo,
      mediaLimits,
      processImageThenReview,
      processAudioThenReview,
      processVideoThenReview,
    ]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const file = e.dataTransfer.files?.[0];
      if (file) {
        handleFileFromDropzone(file);
        return;
      }
      const uri = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
      if (uri && looksLikeUrl(uri)) {
        const trimmed = uri.trim();
        if (prefs.confirmEnabled) {
          setUrlIaUseLevel(prefs.iaUseUrl);
          setPendingUrlConfirm(trimmed);
          return;
        }
        void processUrlThenReview(trimmed, prefs.iaUseUrl);
      }
    },
    [handleFileFromDropzone, prefs.iaUseUrl, prefs.confirmEnabled, processUrlThenReview]
  );

  const closeAudioRecorderModal = useCallback(() => {
    if (busy) return;
    if (audioRecStatus === "starting") {
      audioAbortStartingRef.current = true;
      setAudioRecModalOpen(false);
      setAudioRecStatus("starting");
      return;
    }
    if (audioRecStatus === "recording" || audioRecStatus === "paused") {
      audioDiscardRef.current = true;
      const mr = mediaRecRef.current;
      if (mr && mr.state !== "inactive") {
        mr.stop();
      } else {
        audioDiscardRef.current = false;
        const s = audioStreamRef.current;
        s?.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
        mediaRecRef.current = null;
        setAudioRecModalOpen(false);
        setAudioRecStatus("starting");
        setAudioPauseSupported(false);
      }
    }
  }, [busy, audioRecStatus]);

  const finalizeAudioRecording = useCallback(() => {
    if ((audioRecStatus !== "recording" && audioRecStatus !== "paused") || busy) return;
    const mr = mediaRecRef.current;
    if (!mr || mr.state === "inactive") return;
    audioDiscardRef.current = false;
    mr.stop();
  }, [audioRecStatus, busy]);

  const pauseAudioRecording = useCallback(() => {
    const mr = mediaRecRef.current;
    if (!mr || mr.state !== "recording") return;
    try {
      mr.pause();
      setAudioRecStatus("paused");
    } catch {
      setError("Não foi possível pausar a gravação.");
    }
  }, []);

  const resumeAudioRecording = useCallback(() => {
    const mr = mediaRecRef.current;
    if (!mr || mr.state !== "paused") return;
    try {
      mr.resume();
      setAudioRecStatus("recording");
    } catch {
      setError("Não foi possível continuar a gravação.");
    }
  }, []);

  const openAudioRecorderModal = useCallback(async () => {
    setError(null);
    audioAbortStartingRef.current = false;
    audioDiscardRef.current = false;
    setAudioRecModalOpen(true);
    setAudioRecStatus("starting");
    setAudioPauseSupported(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (audioAbortStartingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        setAudioRecModalOpen(false);
        setAudioRecStatus("starting");
        return;
      }
      audioStreamRef.current = stream;
      audioChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecRef.current = mr;
      setAudioPauseSupported(typeof mr.pause === "function" && typeof mr.resume === "function");
      mr.ondataavailable = (ev) => {
        if (ev.data.size) audioChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        const discard = audioDiscardRef.current;
        audioDiscardRef.current = false;
        const stopped = mr.stream;
        stopped.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
        mediaRecRef.current = null;
        setAudioRecModalOpen(false);
        setAudioRecStatus("starting");
        setAudioPauseSupported(false);
        if (discard) {
          audioChunksRef.current = [];
          return;
        }
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        if (!blob.size) {
          setError("Nenhum áudio gravado. Tente novamente.");
          return;
        }
        const ext = blob.type.includes("mp4") || blob.type.includes("m4a") ? "m4a" : "webm";
        const file = new File([blob], `gravacao-${Date.now()}.${ext}`, { type: blob.type });
        const limMsg = fileExceedsLimitMessage(file, mediaLimits, "audio");
        if (limMsg) {
          setError(limMsg);
          return;
        }
        if (!prefs.confirmEnabled) {
          void processAudioThenReview(file, prefs.iaUseAudio);
          return;
        }
        setAudioIaUseLevel(prefs.iaUseAudio);
        setPendingBinaryConfirm({ file, variant: "audio", audioSource: "microfone" });
      };
      mr.start(250);
      setAudioRecStatus("recording");
    } catch {
      setError("Microfone indisponível ou permissão negada.");
      setAudioRecModalOpen(false);
      setAudioRecStatus("starting");
      setAudioPauseSupported(false);
    }
  }, [processAudioThenReview, prefs.confirmEnabled, prefs.iaUseAudio, mediaLimits]);

  /** Processa texto (IA conforme preferências no servidor) e abre a página de revisão antes de gravar. */
  const processTextThenReview = useCallback(
    async (body: string, iaOverride?: UserIaUseLevel) => {
      const t = body.trim();
      if (!t) return;
      const ac = new AbortController();
      textProcessAbortRef.current = ac;
      setTextProcessBody(t);
      setTextProcessPhaseIdx(0);
      setBusy(true);
      setError(null);
      setTextOpen(false);
      const level = iaOverride ?? textIaUseLevel;
      let navigatedOk = false;
      try {
        const out = await apiPostJson<TextMemoProcessResponse>(
          "/api/memos/text/process",
          {
            mediaText: t,
            groupId: workspaceGroupId ?? null,
            iaUseTexto: level,
          },
          { signal: ac.signal }
        );
        navigate("/revisao/memo-texto", {
          state: { ...out, groupId: workspaceGroupId ?? null },
        });
        navigatedOk = true;
        setTextValue("");
      } catch (e) {
        const aborted =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError");
        if (aborted) {
          setError("Processamento cancelado.");
        } else {
          setError(e instanceof Error ? e.message : "Falha ao processar texto.");
        }
      } finally {
        textProcessAbortRef.current = null;
        setPendingTextConfirm(null);
        if (!navigatedOk) {
          setTextProcessBody(null);
          setBusy(false);
        }
      }
    },
    [navigate, workspaceGroupId, textIaUseLevel]
  );

  const closeTextModal = () => {
    if (!busy) setTextOpen(false);
  };

  const closeUrlModal = () => {
    if (!busy) setUrlOpen(false);
  };

  const stopPhotoStream = useCallback(() => {
    const stream = photoStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      photoStreamRef.current = null;
    }
    const v = photoVideoRef.current;
    if (v) v.srcObject = null;
  }, []);

  const closePhotoCamera = useCallback(() => {
    if (busy) return;
    stopPhotoStream();
    setPhotoCamOpen(false);
    setPhotoCamLoading(false);
    setImageIaUseLevel(prefs.iaUseImagem);
  }, [busy, stopPhotoStream, prefs.iaUseImagem]);

  const stopVideoRecordStream = useCallback(() => {
    const mr = videoMediaRecRef.current;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
    }
    videoMediaRecRef.current = null;
    videoChunksRef.current = [];
    const stream = videoRecordStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      videoRecordStreamRef.current = null;
    }
    const v = videoRecordPreviewRef.current;
    if (v) v.srcObject = null;
  }, []);

  const closeVideoCamera = useCallback(() => {
    if (busy) return;
    if (videoRecState === "recording" || videoRecState === "paused") {
      videoDiscardRef.current = true;
      const mr = videoMediaRecRef.current;
      if (mr && mr.state !== "inactive") mr.stop();
      else {
        videoDiscardRef.current = false;
        stopVideoRecordStream();
        setVideoCamOpen(false);
        setVideoRecState("idle");
        setVideoPauseSupported(false);
      }
      return;
    }
    stopVideoRecordStream();
    setVideoCamOpen(false);
    setVideoRecState("idle");
    setVideoPauseSupported(false);
    setVideoIaUseLevel(prefs.iaUseVideo);
  }, [busy, videoRecState, stopVideoRecordStream, prefs.iaUseVideo]);

  const openVideoRecordCamera = useCallback(async () => {
    setError(null);
    setVideoCamLoading(true);
    setVideoPauseSupported(false);
    try {
      if (typeof MediaRecorder === "undefined") {
        setError("Gravação de vídeo não suportada neste navegador.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: true,
      });
      videoRecordStreamRef.current = stream;
      setVideoRecState("idle");
      setVideoCamOpen(true);
    } catch {
      setError("Câmera ou microfone indisponível, ou permissão negada.");
    } finally {
      setVideoCamLoading(false);
    }
  }, []);

  const startVideoRecording = useCallback(() => {
    const stream = videoRecordStreamRef.current;
    if (!stream) return;
    const mime = pickVideoRecorderMimeType();
    try {
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      setVideoPauseSupported(typeof mr.pause === "function" && typeof mr.resume === "function");
      videoDiscardRef.current = false;
      videoChunksRef.current = [];
      videoMediaRecRef.current = mr;
      mr.ondataavailable = (ev) => {
        if (ev.data.size) videoChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        const discard = videoDiscardRef.current;
        videoDiscardRef.current = false;
        const stoppedStream = mr.stream;
        stoppedStream.getTracks().forEach((t) => t.stop());
        videoRecordStreamRef.current = null;
        videoMediaRecRef.current = null;
        const v = videoRecordPreviewRef.current;
        if (v) v.srcObject = null;
        setVideoRecState("idle");
        setVideoCamOpen(false);
        setVideoPauseSupported(false);
        if (discard) return;
        const blob = new Blob(videoChunksRef.current, { type: mr.mimeType || "video/webm" });
        videoChunksRef.current = [];
        if (!blob.size) {
          setError("Nenhum dado gravado. Tente novamente.");
          return;
        }
        const ext = blob.type.includes("mp4") ? "mp4" : "webm";
        const file = new File([blob], `gravacao-video-${Date.now()}.${ext}`, { type: blob.type });
        const vLim = fileExceedsLimitMessage(file, mediaLimits, "video");
        if (vLim) {
          setError(vLim);
          return;
        }
        if (!prefs.confirmEnabled) {
          void processVideoThenReview(file, prefs.iaUseVideo);
          return;
        }
        setVideoIaUseLevel(prefs.iaUseVideo);
        setPendingBinaryConfirm({ file, variant: "video" });
      };
      mr.start(250);
      setVideoRecState("recording");
    } catch {
      videoMediaRecRef.current = null;
      videoChunksRef.current = [];
      setVideoPauseSupported(false);
      setError("Não foi possível iniciar a gravação de vídeo neste dispositivo.");
    }
  }, [processVideoThenReview, prefs.confirmEnabled, prefs.iaUseVideo, mediaLimits]);

  const stopVideoRecordingAndUpload = useCallback(() => {
    const mr = videoMediaRecRef.current;
    if (!mr || mr.state === "inactive") return;
    videoDiscardRef.current = false;
    mr.stop();
  }, []);

  const pauseVideoRecording = useCallback(() => {
    const mr = videoMediaRecRef.current;
    if (!mr || mr.state !== "recording") return;
    try {
      mr.pause();
      setVideoRecState("paused");
    } catch {
      setError("Não foi possível pausar a gravação de vídeo.");
    }
  }, []);

  const resumeVideoRecording = useCallback(() => {
    const mr = videoMediaRecRef.current;
    if (!mr || mr.state !== "paused") return;
    try {
      mr.resume();
      setVideoRecState("recording");
    } catch {
      setError("Não foi possível continuar a gravação de vídeo.");
    }
  }, []);

  const openPhotoCamera = useCallback(async () => {
    setError(null);
    setImageIaUseLevel(prefs.iaUseImagem);
    setPhotoCamLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      photoStreamRef.current = stream;
      setPhotoCamOpen(true);
    } catch {
      setError("Câmera indisponível ou permissão negada.");
    } finally {
      setPhotoCamLoading(false);
    }
  }, [prefs.iaUseImagem]);

  useEffect(() => {
    if (!photoCamOpen) return;
    const v = photoVideoRef.current;
    const stream = photoStreamRef.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    void v.play().catch(() => {
      setError("Não foi possível iniciar a visualização da câmera.");
    });
    return () => {
      v.srcObject = null;
    };
  }, [photoCamOpen]);

  useEffect(() => {
    if (!videoCamOpen) return;
    const v = videoRecordPreviewRef.current;
    const stream = videoRecordStreamRef.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    void v.play().catch(() => {
      setError("Não foi possível iniciar a visualização da câmera.");
    });
    return () => {
      v.srcObject = null;
    };
  }, [videoCamOpen]);

  const capturePhoto = useCallback(() => {
    const v = photoVideoRef.current;
    if (!v || v.readyState < 2) {
      setError("Aguarde a câmera estabilizar antes de capturar.");
      return;
    }
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!w || !h) {
      setError("Resolução da câmera indisponível. Tente novamente.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Não foi possível processar a imagem.");
      return;
    }
    ctx.drawImage(v, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Não foi possível capturar a imagem.");
          return;
        }
        stopPhotoStream();
        setPhotoCamOpen(false);
        const file = new File([blob], `foto-${Date.now()}.jpg`, { type: "image/jpeg" });
        const imgLim = fileExceedsLimitMessage(file, mediaLimits, "image");
        if (imgLim) {
          setError(imgLim);
          return;
        }
        if (!prefs.confirmEnabled) {
          void processImageThenReview(file, prefs.iaUseImagem);
          return;
        }
        const thumbUrl = URL.createObjectURL(blob);
        setPendingCameraPipeline({ file, thumbUrl });
      },
      "image/jpeg",
      0.92
    );
  }, [stopPhotoStream, prefs.confirmEnabled, prefs.iaUseImagem, mediaLimits, processImageThenReview]);

  const captureConfirmOpen = useMemo(
    () =>
      pendingTextConfirm != null ||
      pendingUrlConfirm != null ||
      pendingBinaryConfirm != null ||
      pendingImageFileConfirm != null ||
      pendingCameraPipeline != null ||
      imageProcessPreviewUrl != null ||
      audioProcessPreviewUrl != null ||
      videoProcessPreviewUrl != null ||
      textProcessBody != null ||
      urlProcessUrl != null,
    [
      pendingTextConfirm,
      pendingUrlConfirm,
      pendingBinaryConfirm,
      pendingImageFileConfirm,
      pendingCameraPipeline,
      imageProcessPreviewUrl,
      audioProcessPreviewUrl,
      videoProcessPreviewUrl,
      textProcessBody,
      urlProcessUrl,
    ]
  );

  const confirmPendingImageFileCapture = useCallback(() => {
    const f = pendingImageFileConfirm;
    if (!f) return;
    const lim = fileExceedsLimitMessage(f, mediaLimits, "image");
    if (lim) {
      setError(lim);
      return;
    }
    const previewUrl = URL.createObjectURL(f);
    const level = imageIaUseLevel;
    setPendingImageFileConfirm(null);
    void processImageThenReview(f, level, { previewUrl });
  }, [pendingImageFileConfirm, mediaLimits, processImageThenReview, imageIaUseLevel]);

  const cancelPendingImageFileCapture = useCallback(() => {
    setPendingImageFileConfirm(null);
  }, []);

  const confirmPendingCameraCapture = useCallback(() => {
    const p = pendingCameraPipeline;
    if (!p) return;
    const lim = fileExceedsLimitMessage(p.file, mediaLimits, "image");
    if (lim) {
      setError(lim);
      return;
    }
    const { file, thumbUrl } = p;
    const level = imageIaUseLevel;
    setPendingCameraPipeline(null);
    void processImageThenReview(file, level, { previewUrl: thumbUrl });
  }, [pendingCameraPipeline, mediaLimits, processImageThenReview, imageIaUseLevel]);

  const cancelPendingCameraCapture = useCallback(() => {
    const p = pendingCameraPipeline;
    if (p?.thumbUrl) URL.revokeObjectURL(p.thumbUrl);
    setPendingCameraPipeline(null);
  }, [pendingCameraPipeline]);

  const confirmPendingBinary = useCallback(() => {
    const p = pendingBinaryConfirm;
    if (!p) return;
    const lim = fileExceedsLimitMessage(p.file, mediaLimits, p.variant);
    if (lim) {
      setError(lim);
      return;
    }
    // Não limpar pendingBinaryConfirm aqui — mantém o modal de confirmação visível
    // durante o processamento, evitando flash do formulário principal.
    // Para áudio/vídeo: limpo no finally de processAudioThenReview/processVideoThenReview.
    // Para documento: limpo no finally do wrapper abaixo.
    if (p.variant === "audio") {
      void processAudioThenReview(p.file, audioIaUseLevel);
      return;
    }
    if (p.variant === "video") {
      void processVideoThenReview(p.file, videoIaUseLevel);
      return;
    }
    // Documento (PDF, DOCX…): uploadFile não tem overlay de processamento,
    // então o modal de confirmação fica visível (botões desativados por busy=true)
    // cobrindo o formulário durante o upload.
    void (async () => {
      try {
        await uploadFile(p.file, { documentIaLevel: documentIaUseLevel });
      } catch {
        // Erro já tratado internamente por uploadFile (chama setError).
      } finally {
        setPendingBinaryConfirm(null);
      }
    })();
  }, [
    pendingBinaryConfirm,
    documentIaUseLevel,
    audioIaUseLevel,
    videoIaUseLevel,
    uploadFile,
    mediaLimits,
    processAudioThenReview,
    processVideoThenReview,
  ]);

  const cancelPendingBinary = useCallback(() => {
    setPendingBinaryConfirm(null);
  }, []);

  useEffect(() => {
    return () => {
      const pStream = photoStreamRef.current;
      pStream?.getTracks().forEach((t) => t.stop());
      photoStreamRef.current = null;
      const vrStream = videoRecordStreamRef.current;
      vrStream?.getTracks().forEach((t) => t.stop());
      videoRecordStreamRef.current = null;
      const aStream = audioStreamRef.current;
      aStream?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    };
  }, []);

  return (
    <section className="mm-panel" aria-labelledby="registrar-memo-titulo">
      {showBuscarMemosLink ? (
        <div className={styles.buscarRow}>
          <Link to="/buscar" className={styles.buscarMemosBtn}>
            <span className={styles.buscarMemosIcon} aria-hidden>
              🔍
            </span>
            Buscar memos
          </Link>
        </div>
      ) : null}
      <div className={styles.panelHead}>
        <div className={styles.panelHeadText}>
          <h2 id="registrar-memo-titulo" className={styles.title}>
            Registrar nova Memória
          </h2>
        </div>
      </div>

      <div
        className={`mm-dropzone ${drag ? "mm-dropzone--active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <p className={styles.dropzoneTitle}>
          <strong>Selecionar arquivo</strong> ou <strong>arraste para cá</strong>
        </p>
        <button
          type="button"
          className={`mm-btn mm-btn--primary ${styles.dropBtn}`}
          disabled={busy || captureConfirmOpen}
          onClick={() => fileInputRef.current?.click()}
        >
          Abrir seletor de arquivo
        </button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileFromDropzone(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="mm-icon-grid">
        <button
          type="button"
          className="mm-icon-action"
          disabled={
            busy || photoCamLoading || videoCamOpen || videoCamLoading || audioRecModalOpen || captureConfirmOpen
          }
          onClick={() => void openPhotoCamera()}
        >
          <span className={styles.iconEmoji} aria-hidden>
            📷
          </span>
          {photoCamLoading ? "Abrindo câmera…" : "Foto (câmera)"}
        </button>

        <button
          type="button"
          className={`mm-icon-action ${
            videoRecState === "recording" || videoRecState === "paused" ? "mm-recording-pulse" : ""
          }`}
          disabled={
            busy ||
            videoCamLoading ||
            photoCamOpen ||
            photoCamLoading ||
            audioRecModalOpen ||
            videoCamOpen ||
            captureConfirmOpen
          }
          onClick={() => void openVideoRecordCamera()}
        >
          <span className={styles.iconEmoji} aria-hidden>
            🎥
          </span>
          {videoCamLoading ? "Abrindo câmera…" : "Vídeo (câmera)"}
        </button>

        <button
          type="button"
          className="mm-icon-action"
          disabled={
            busy ||
            videoCamOpen ||
            (videoRecState === "recording" || videoRecState === "paused") ||
            photoCamOpen ||
            photoCamLoading ||
            audioRecModalOpen ||
            captureConfirmOpen
          }
          onClick={() => void openAudioRecorderModal()}
        >
          <span className={styles.iconEmoji} aria-hidden>
            🎙
          </span>
          Gravar áudio
        </button>

        <label className="mm-icon-action">
          <span className={styles.iconEmoji} aria-hidden>
            📎
          </span>
          Documento / arquivo
          <input
            ref={docInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.msg,.eml,.dwg,.rtf,.odt,.ods,.ppt,.pptx,application/*,text/*,image/*"
            disabled={busy || captureConfirmOpen}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileFromDropzone(f);
              e.target.value = "";
            }}
          />
        </label>

        <button
          type="button"
          className="mm-icon-action"
          disabled={busy || captureConfirmOpen}
          onClick={() => {
            setTextIaUseLevel(prefs.iaUseTexto);
            setTextOpen(true);
          }}
        >
          <span className={styles.iconEmoji} aria-hidden>
            📝
          </span>
          Texto
        </button>

        <button
          type="button"
          className="mm-icon-action"
          disabled={busy || captureConfirmOpen}
          onClick={() => {
            setUrlIaUseLevel(prefs.iaUseUrl);
            setUrlOpen(true);
          }}
        >
          <span className={styles.iconEmoji} aria-hidden>
            🔗
          </span>
          URL
        </button>
      </div>

      {error ? <p className="mm-error">{error}</p> : null}
      {      busy &&
      imageProcessPreviewUrl == null &&
      textProcessBody == null &&
      urlProcessUrl == null &&
      audioProcessPreviewUrl == null &&
      videoProcessPreviewUrl == null ? (
        <p className={styles.processing}>Processando…</p>
      ) : null}

      {textOpen ? (
        <div
          className="mm-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeTextModal();
          }}
        >
          <div
            className={`mm-modal ${styles.textMemoModal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="text-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="text-modal-title" className={styles.modalTitle}>
              Memo em texto
            </h3>
            <textarea
              className="mm-field"
              rows={12}
              style={{ width: "100%", resize: "vertical", minHeight: "220px" }}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="Digite o conteúdo do memo…"
            />
            <IaTextoLevelFieldset
              idPrefix="text-memo-type"
              value={textIaUseLevel}
              onChange={setTextIaUseLevel}
            />
            <div className={styles.modalActions}>
              <button type="button" className="mm-btn mm-btn--ghost" onClick={closeTextModal}>
                Cancelar
              </button>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                disabled={busy || !textValue.trim()}
                onClick={() => {
                  const t = textValue.trim();
                  if (!t) return;
                  if (prefs.confirmEnabled) {
                    setPendingTextConfirm(t);
                    setTextOpen(false);
                  } else {
                    void processTextThenReview(t);
                  }
                }}
              >
                {prefs.confirmEnabled ? "Prosseguir" : "Continuar para revisão"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {urlOpen ? (
        <div
          className="mm-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeUrlModal();
          }}
        >
          <div
            className="mm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="url-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="url-modal-title" className={styles.modalTitle}>
              Memo por URL
            </h3>
            <p className={`mm-muted ${styles.modalLead}`}>
              Cole o endereço (http/https). Arrastar da barra do navegador para a área tracejada também funciona em
              alguns browsers.
            </p>
            <input
              className="mm-field"
              type="url"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              placeholder="https://…"
            />
            <IaTextoLevelFieldset
              idPrefix="url-memo-type"
              value={urlIaUseLevel}
              onChange={setUrlIaUseLevel}
            />
            <div className={styles.modalActions}>
              <button type="button" className="mm-btn mm-btn--ghost" onClick={closeUrlModal}>
                Cancelar
              </button>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                disabled={busy || !urlValue.trim()}
                onClick={() => {
                  const u = urlValue.trim();
                  if (!looksLikeUrl(u)) {
                    setError("Informe uma URL http(s) válida.");
                    return;
                  }
                  if (prefs.confirmEnabled) {
                    setPendingUrlConfirm(u);
                    setUrlOpen(false);
                  } else {
                    void processUrlThenReview(u, urlIaUseLevel);
                  }
                }}
              >
                {prefs.confirmEnabled ? "Prosseguir" : "Continuar para revisão"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {audioRecModalOpen ? (
        <div
          className="mm-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAudioRecorderModal();
          }}
        >
          <div
            className={`mm-modal ${styles.cameraModal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="audio-record-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="audio-record-modal-title" className={styles.modalTitle}>
              Gravar áudio
            </h3>
            {audioRecStatus === "starting" ? (
              <p className={`mm-muted ${styles.modalLead}`}>Habilitando o microfone…</p>
            ) : audioRecStatus === "paused" ? (
              <p className={`mm-muted ${styles.modalLead}`}>
                Gravação em <strong>pausa</strong>. Ao continuar, o novo áudio será <strong>emendado</strong> ao que já
                foi capturado. Ao finalizar, tudo vira um único arquivo.
              </p>
            ) : (
              <p className={`mm-muted ${styles.modalLead}`}>
                Gravando. Use <strong>Pausar</strong> para interromper sem perder o trecho já gravado;{" "}
                <strong>Continuar</strong> retoma na mesma faixa. Finalize quando terminar.
              </p>
            )}
            <div className={styles.audioRecStage}>
              {audioRecStatus === "starting" ? (
                <div className={styles.audioRecStarting} aria-live="polite">
                  <span className={styles.audioRecStartingDot} aria-hidden />
                  <span className={styles.audioRecStartingLabel}>Preparando…</span>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.audioRecStopBtn}
                    disabled={busy}
                    aria-label="Finalizar gravação e enviar memo"
                    onClick={finalizeAudioRecording}
                  >
                    <span
                      className={
                        audioRecStatus === "paused"
                          ? `${styles.audioRecDot} ${styles.audioRecDotPaused}`
                          : styles.audioRecDot
                      }
                      aria-hidden
                    />
                    <span
                      className={
                        audioRecStatus === "paused"
                          ? `${styles.audioRecMic} ${styles.audioRecMicPaused}`
                          : styles.audioRecMic
                      }
                      aria-hidden
                    >
                      🎙
                    </span>
                  </button>
                  <p className={styles.audioRecHint}>
                    Clique na <strong>bola</strong> ou no <strong>microfone</strong> acima para{" "}
                    <strong>finalizar</strong>, juntar todos os trechos e registrar o memo.
                  </p>
                  {audioPauseSupported ? (
                    <div className={styles.audioRecPauseRow}>
                      {audioRecStatus === "recording" ? (
                        <button
                          type="button"
                          className={`mm-btn mm-btn--ghost ${styles.audioRecPauseBtn}`}
                          disabled={busy}
                          onClick={pauseAudioRecording}
                        >
                          Pausar
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="mm-btn mm-btn--primary"
                          disabled={busy}
                          onClick={resumeAudioRecording}
                        >
                          Continuar gravação
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className={styles.audioRecPauseUnsupported}>
                      Este navegador não oferece pausa na gravação; use finalizar de uma vez ou cancele.
                    </p>
                  )}
                </>
              )}
            </div>
            <div className={styles.modalActions}>
              <button type="button" className="mm-btn mm-btn--ghost" disabled={busy} onClick={closeAudioRecorderModal}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {videoCamOpen ? (
        <div
          className="mm-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeVideoCamera();
          }}
        >
          <div
            className={`mm-modal ${styles.cameraModal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="video-record-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="video-record-modal-title" className={styles.modalTitle}>
              Gravar vídeo
            </h3>
            <p className={`mm-muted ${styles.modalLead}`}>
              {videoRecState === "idle" ? (
                <>
                  Enquadre a cena e inicie a gravação. O áudio é capturado junto. Arquivos de vídeo já existentes podem
                  ser enviados pela área de arrastar ou por <strong>Abrir seletor de arquivo</strong>.
                </>
              ) : videoRecState === "paused" ? (
                <>
                  Gravação em <strong>pausa</strong>. Ao continuar, o novo trecho será <strong>emendado</strong> ao já
                  gravado. <strong>Parar e registrar</strong> gera um único vídeo.
                </>
              ) : (
                <>
                  Gravando. Use <strong>Pausar</strong> para interromper sem perder o que já foi capturado;{" "}
                  <strong>Continuar</strong> retoma na mesma gravação. <strong>Parar e registrar</strong> envia o memo,{" "}
                  ou <strong>Cancelar</strong> descarta.
                </>
              )}
            </p>
            <div className={styles.cameraPreviewWrap}>
              <video ref={videoRecordPreviewRef} className={styles.cameraVideo} playsInline muted autoPlay />
              {videoRecState === "paused" ? (
                <div className={styles.videoRecPausedOverlay} aria-live="polite">
                  Pausa
                </div>
              ) : null}
            </div>
            {videoRecState === "recording" || videoRecState === "paused" ? (
              <>
                {videoPauseSupported ? (
                  <div className={styles.audioRecPauseRow}>
                    {videoRecState === "recording" ? (
                      <button type="button" className="mm-btn mm-btn--ghost" disabled={busy} onClick={pauseVideoRecording}>
                        Pausar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="mm-btn mm-btn--primary"
                        disabled={busy}
                        onClick={resumeVideoRecording}
                      >
                        Continuar gravação
                      </button>
                    )}
                  </div>
                ) : (
                  <p className={styles.audioRecPauseUnsupported}>
                    Este navegador pode não suportar pausa em vídeo; use Parar e registrar ou Cancelar.
                  </p>
                )}
              </>
            ) : null}
            <div className={styles.modalActions}>
              <button type="button" className="mm-btn mm-btn--ghost" disabled={busy} onClick={closeVideoCamera}>
                Cancelar
              </button>
              {videoRecState === "recording" || videoRecState === "paused" ? (
                <button
                  type="button"
                  className="mm-btn mm-btn--primary"
                  disabled={busy}
                  onClick={stopVideoRecordingAndUpload}
                >
                  Parar e registrar
                </button>
              ) : (
                <button type="button" className="mm-btn mm-btn--primary" disabled={busy} onClick={startVideoRecording}>
                  Iniciar gravação
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {photoCamOpen ? (
        <div
          className="mm-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePhotoCamera();
          }}
        >
          <div
            className={`mm-modal ${styles.cameraModal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="camera-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="camera-modal-title" className={styles.modalTitle}>
              Capturar foto
            </h3>
            <p className={`mm-muted ${styles.modalLead}`}>
              Enquadre o assunto e toque em <strong>Tirar foto</strong> para registrar o memo.
              {!prefs.confirmEnabled ? (
                <>
                  {" "}
                  O nível de IA segue suas <strong>preferências</strong> (sem tela de revisão).
                </>
              ) : null}
            </p>
            <div className={styles.cameraPreviewWrap}>
              <video ref={photoVideoRef} className={styles.cameraVideo} playsInline muted autoPlay />
            </div>

            {prefs.confirmEnabled ? (
              <IaTextoLevelFieldset
                idPrefix="photo-camera"
                value={imageIaUseLevel}
                onChange={setImageIaUseLevel}
              />
            ) : null}

            <div className={styles.modalActions}>
              <button type="button" className="mm-btn mm-btn--ghost" disabled={busy} onClick={closePhotoCamera}>
                Cancelar
              </button>
              <button type="button" className="mm-btn mm-btn--primary" disabled={busy} onClick={capturePhoto}>
                Tirar foto
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingTextConfirm != null ? (
        <MediaCaptureConfirmModal
          open
          kind="text"
          textBody={pendingTextConfirm}
          textIaUseLevel={textIaUseLevel}
          onTextIaUseLevelChange={setTextIaUseLevel}
          onCancel={() => {
            setPendingTextConfirm(null);
            setTextOpen(true);
          }}
          onConfirm={() => {
            const t = pendingTextConfirm;
            if (t == null) return;
            void processTextThenReview(t, textIaUseLevel);
          }}
          busy={busy && textProcessBody == null}
        />
      ) : null}

      {pendingUrlConfirm != null ? (
        <MediaCaptureConfirmModal
          open
          kind="url"
          url={pendingUrlConfirm}
          urlIaUseLevel={urlIaUseLevel}
          onUrlIaUseLevelChange={setUrlIaUseLevel}
          onCancel={() => {
            setPendingUrlConfirm(null);
            setUrlOpen(true);
          }}
          onConfirm={() => {
            const u = pendingUrlConfirm;
            if (u == null) return;
            void processUrlThenReview(u, urlIaUseLevel);
          }}
          busy={busy && urlProcessUrl == null}
        />
      ) : null}

      {pendingBinaryConfirm ? (
        <MediaCaptureConfirmModal
          open
          kind={
            pendingBinaryConfirm.variant === "document"
              ? "document"
              : pendingBinaryConfirm.variant === "audio"
                ? "audio"
                : "video"
          }
          file={pendingBinaryConfirm.file}
          audioCaptureSource={
            pendingBinaryConfirm.variant === "audio" ? pendingBinaryConfirm.audioSource : undefined
          }
          documentIaUseLevel={
            pendingBinaryConfirm.variant === "document" ? documentIaUseLevel : undefined
          }
          onDocumentIaUseLevelChange={
            pendingBinaryConfirm.variant === "document" ? setDocumentIaUseLevel : undefined
          }
          audioIaUseLevel={pendingBinaryConfirm.variant === "audio" ? audioIaUseLevel : undefined}
          onAudioIaUseLevelChange={pendingBinaryConfirm.variant === "audio" ? setAudioIaUseLevel : undefined}
          videoIaUseLevel={pendingBinaryConfirm.variant === "video" ? videoIaUseLevel : undefined}
          onVideoIaUseLevelChange={pendingBinaryConfirm.variant === "video" ? setVideoIaUseLevel : undefined}
          onCancel={cancelPendingBinary}
          onConfirm={confirmPendingBinary}
          busy={
            busy &&
            (pendingBinaryConfirm.variant === "audio"
              ? audioProcessPreviewUrl == null
              : pendingBinaryConfirm.variant === "video"
                ? videoProcessPreviewUrl == null
                : true)
          }
        />
      ) : null}

      {pendingImageFileConfirm ? (
        <MediaCaptureConfirmModal
          open
          kind="image"
          file={pendingImageFileConfirm}
          imageIaUseLevel={imageIaUseLevel}
          onImageIaUseLevelChange={setImageIaUseLevel}
          onCancel={cancelPendingImageFileCapture}
          onConfirm={confirmPendingImageFileCapture}
          busy={busy && imageProcessPreviewUrl == null}
        />
      ) : null}

      {pendingCameraPipeline ? (
        <MediaCaptureConfirmModal
          open
          kind="image"
          file={pendingCameraPipeline.file}
          imageObjectUrl={pendingCameraPipeline.thumbUrl}
          imageIaUseLevel={imageIaUseLevel}
          onImageIaUseLevelChange={setImageIaUseLevel}
          onCancel={cancelPendingCameraCapture}
          onConfirm={confirmPendingCameraCapture}
          busy={busy && imageProcessPreviewUrl == null}
        />
      ) : null}

      {(imageProcessPreviewUrl != null ||
        audioProcessPreviewUrl != null ||
        videoProcessPreviewUrl != null ||
        textProcessBody != null ||
        urlProcessUrl != null) ? (
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10040,
            background: "#0f172a",
          }}
        />
      ) : null}

      {imageProcessPreviewUrl != null ? (
        <MemoProcessOverlay
          title="Processando a imagem"
          titleId="img-process-title"
          hint="Não feche a página nem use «Descartar»."
          steps={IMAGE_MEMO_PROCESS_STEPS}
          activeStepIndex={imageProcessPhaseIdx}
          onDiscard={discardImageProcessing}
          preview={<img className={memoProcessOverlayStyles.preview} src={imageProcessPreviewUrl} alt="" />}
        />
      ) : null}

      {audioProcessPreviewUrl != null ? (
        <MemoProcessOverlay
          title="Processando o áudio"
          titleId="audio-process-title"
          hint="Não feche a página nem use «Descartar»."
          steps={AUDIO_MEMO_PROCESS_STEPS}
          activeStepIndex={audioProcessPhaseIdx}
          onDiscard={discardAudioProcessing}
          preview={
            <audio
              className={memoProcessOverlayStyles.preview}
              src={audioProcessPreviewUrl}
              controls
              preload="metadata"
              style={{ width: "100%" }}
            />
          }
        />
      ) : null}

      {videoProcessPreviewUrl != null ? (
        <MemoProcessOverlay
          title="Processando o vídeo"
          titleId="video-process-title"
          hint="Não feche a página nem use «Descartar»."
          steps={VIDEO_MEMO_PROCESS_STEPS}
          activeStepIndex={videoProcessPhaseIdx}
          onDiscard={discardVideoProcessing}
          preview={
            <video
              className={memoProcessOverlayStyles.preview}
              src={videoProcessPreviewUrl}
              controls
              playsInline
              preload="metadata"
              style={{ width: "100%" }}
            />
          }
        />
      ) : null}

      {textProcessBody != null ? (
        <MemoProcessOverlay
          title="Processando o texto"
          titleId="text-process-title"
          hint="Não feche a página nem use «Descartar»."
          steps={TEXT_MEMO_PROCESS_STEPS}
          activeStepIndex={textProcessPhaseIdx}
          onDiscard={discardTextProcessing}
          previewIsText
          preview={
            <pre className={memoProcessOverlayStyles.textPreview}>
              {textProcessBody.length > 600 ? `${textProcessBody.slice(0, 600)}…` : textProcessBody}
            </pre>
          }
        />
      ) : null}

      {urlProcessUrl != null ? (
        <MemoProcessOverlay
          title="Processando a URL"
          titleId="url-process-title"
          hint="Não feche a página nem use «Descartar»."
          steps={TEXT_MEMO_PROCESS_STEPS}
          activeStepIndex={urlProcessPhaseIdx}
          onDiscard={discardUrlProcessing}
          previewIsText
          preview={
            <pre className={memoProcessOverlayStyles.textPreview}>
              {urlProcessUrl.length > 600 ? `${urlProcessUrl.slice(0, 600)}…` : urlProcessUrl}
            </pre>
          }
        />
      ) : null}
    </section>
  );
}
