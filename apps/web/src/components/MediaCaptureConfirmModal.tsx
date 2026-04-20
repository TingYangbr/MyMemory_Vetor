import { useEffect, useMemo, useState } from "react";
import type { UserIaUseLevel } from "@mymemory/shared";
import IaTextoLevelFieldset from "./IaTextoLevelFieldset";
import styles from "./MediaCaptureConfirmModal.module.css";

export type MediaCaptureConfirmKind = "text" | "url" | "audio" | "video" | "image" | "document";

type Props = {
  open: boolean;
  kind: MediaCaptureConfirmKind;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
  /** Texto capturado (kind === "text") */
  textBody?: string;
  /** Nível de IA para memo em texto (confirmação). */
  textIaUseLevel?: UserIaUseLevel;
  onTextIaUseLevelChange?: (v: UserIaUseLevel) => void;
  /** Nível de IA para imagem (confirmação). */
  imageIaUseLevel?: UserIaUseLevel;
  onImageIaUseLevelChange?: (v: UserIaUseLevel) => void;
  /** Nível de IA para documento (confirmação). */
  documentIaUseLevel?: UserIaUseLevel;
  onDocumentIaUseLevelChange?: (v: UserIaUseLevel) => void;
  /** Nível de IA para áudio (confirmação). */
  audioIaUseLevel?: UserIaUseLevel;
  onAudioIaUseLevelChange?: (v: UserIaUseLevel) => void;
  /** Nível de IA para vídeo (confirmação). */
  videoIaUseLevel?: UserIaUseLevel;
  onVideoIaUseLevelChange?: (v: UserIaUseLevel) => void;
  /** Nível de IA para memo por URL (confirmação). */
  urlIaUseLevel?: UserIaUseLevel;
  onUrlIaUseLevelChange?: (v: UserIaUseLevel) => void;
  /** URL (kind === "url") */
  url?: string;
  /** Arquivo (áudio, vídeo, documento ou imagem) */
  file?: File | null;
  /** URL de objeto para visualização da imagem (opcional; senão cria-se a partir de `file`) */
  imageObjectUrl?: string | null;
  /** Origem do áudio quando conhecida (evita mostrar dados não detetados). */
  audioCaptureSource?: "microfone" | "arquivo";
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatPtBrDateTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString("pt-BR");
  }
}

function documentFormatLabel(file: File): string {
  const n = file.name.toLowerCase();
  const ext = n.includes(".") ? n.slice(n.lastIndexOf(".") + 1) : "";
  const map: Record<string, string> = {
    pdf: "PDF",
    doc: "DOC",
    docx: "DOCX",
    xls: "XLS",
    xlsx: "XLSX",
    txt: "TXT",
    csv: "CSV",
    msg: "MSG",
    eml: "EML",
    dwg: "DWG",
    rtf: "RTF",
    odt: "ODT",
    ods: "ODS",
    ppt: "PPT",
    pptx: "PPTX",
  };
  if (ext && map[ext]) return map[ext];
  if (file.type === "application/pdf") return "PDF";
  return ext ? ext.toUpperCase() : "Documento";
}

const KIND_META: Record<
  MediaCaptureConfirmKind,
  { title: string; hint: string; emoji: string }
> = {
  text: {
    title: "Texto capturado",
    hint: "Em seguida abriremos a tela de revisão (processamento e edição antes de gravar o memo).",
    emoji: "📝",
  },
  url: {
    title: "URL capturada",
    hint: "Em seguida mostramos o andamento do processamento com IA e abrimos a revisão antes de gravar o memo.",
    emoji: "🔗",
  },
  audio: {
    title: "Áudio capturado",
    hint: "Gravação ou arquivo (mp3, webm, m4a…). Em seguida, revisão — com IA: transcrição e sugestões conforme o nível escolhido.",
    emoji: "🎙",
  },
  video: {
    title: "Vídeo capturado",
    hint: "Confirme para enviar. O processamento no servidor segue o nível de IA que escolher abaixo (como nas preferências da conta).",
    emoji: "🎥",
  },
  image: {
    title: "Imagem capturada",
    hint: "Em seguida abriremos a tela de revisão (OCR/descrição por IA conforme seu nível e armazenamento da imagem).",
    emoji: "🖼",
  },
  document: {
    title: "Documento capturado",
    hint: "Confira o tipo e o tamanho. Em seguida, extração do texto e revisão conforme o uso de IA escolhido.",
    emoji: "📄",
  },
};

function useImageNaturalSize(file: File | null | undefined, open: boolean): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!open || !file) {
      setSize(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setSize({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      setSize(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file, open]);
  return size;
}

function useMediaDurationSec(
  file: File | null | undefined,
  open: boolean,
  mediaKind: "audio" | "video"
): number | null | undefined {
  const [sec, setSec] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (!open || !file) {
      setSec(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    const el = document.createElement(mediaKind);
    el.preload = "metadata";
    let done = false;
    const dispose = () => {
      if (done) return;
      done = true;
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
    };
    el.onloadedmetadata = () => {
      const d = el.duration;
      setSec(Number.isFinite(d) ? Math.max(0, Math.round(d)) : null);
      dispose();
    };
    el.onerror = () => {
      setSec(null);
      dispose();
    };
    el.src = url;
    return () => dispose();
  }, [file, open, mediaKind]);
  return sec;
}

function audioFormatHint(file: File): string {
  const n = file.name.toLowerCase();
  if (n.includes(".")) {
    const ext = n.slice(n.lastIndexOf(".") + 1);
    if (ext === "opus") return "Opus";
    if (ext) return `.${ext}`;
  }
  const t = file.type.toLowerCase();
  if (t.includes("webm")) return "WebM";
  if (t.includes("opus")) return "Opus";
  if (t.includes("mp4") || t.includes("m4a")) return "MP4/M4A";
  if (t.includes("mpeg") || t.includes("mp3")) return "MP3";
  if (t.includes("ogg")) return "OGG";
  if (t.includes("wav")) return "WAV";
  return "áudio";
}

function audioOriginLabel(source: "microfone" | "arquivo" | undefined): string {
  if (source === "microfone") return "Microfone";
  if (source === "arquivo") return "Arquivo";
  return "Microfone ou arquivo";
}

export default function MediaCaptureConfirmModal({
  open,
  kind,
  onCancel,
  onConfirm,
  busy = false,
  textBody = "",
  textIaUseLevel,
  onTextIaUseLevelChange,
  imageIaUseLevel,
  onImageIaUseLevelChange,
  documentIaUseLevel,
  onDocumentIaUseLevelChange,
  audioIaUseLevel,
  onAudioIaUseLevelChange,
  videoIaUseLevel,
  onVideoIaUseLevelChange,
  urlIaUseLevel,
  onUrlIaUseLevelChange,
  url: urlProp = "",
  file = null,
  imageObjectUrl = null,
  audioCaptureSource,
}: Props) {
  const meta = KIND_META[kind];
  const charCount = textBody.length;
  const imgDims = useImageNaturalSize(kind === "image" ? file ?? undefined : undefined, open);
  const audioDur = useMediaDurationSec(kind === "audio" ? file ?? undefined : undefined, open, "audio");
  const videoDur = useMediaDurationSec(kind === "video" ? file ?? undefined : undefined, open, "video");

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || kind !== "image") {
      setPreviewUrl(null);
      return;
    }
    if (imageObjectUrl) {
      setPreviewUrl(imageObjectUrl);
      return;
    }
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [open, kind, file, imageObjectUrl]);

  const summaryLine = useMemo(() => {
    if (!file) return "";
    if (kind === "audio") {
      const parts = [`${audioOriginLabel(audioCaptureSource)} (${audioFormatHint(file)})`];
      if (audioDur === undefined) parts.push("…");
      else if (audioDur !== null) parts.push(`${audioDur} seg.`);
      parts.push(formatFileSize(file.size));
      return parts.join(" — ");
    }
    if (kind === "video") {
      const parts: string[] = [];
      if (videoDur === undefined) parts.push("…");
      else if (videoDur !== null) parts.push(`${videoDur} seg.`);
      parts.push(formatFileSize(file.size));
      return parts.join(" — ");
    }
    if (kind === "image") {
      if (!imgDims) return formatFileSize(file.size);
      return `${imgDims.w} × ${imgDims.h} — ${formatFileSize(file.size)}`;
    }
    if (kind === "document") {
      return `${documentFormatLabel(file)} — ${formatPtBrDateTime(file.lastModified)} — ${formatFileSize(file.size)}`;
    }
    return formatFileSize(file.size);
  }, [file, kind, audioDur, videoDur, imgDims, audioCaptureSource]);

  if (!open) return null;

  return (
    <div
      className="mm-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className={`mm-modal ${styles.dialog}${kind === "text" ? ` ${styles.dialogTextWide}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-capture-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.iconWrap} aria-hidden>
            {meta.emoji}
          </span>
          <div className={styles.titleBlock}>
            <h2 id="media-capture-confirm-title" className={styles.title}>
              {meta.title}
            </h2>
            <p className={styles.subtitle}>{meta.hint}</p>
          </div>
        </div>

        <div className={styles.body}>
          {kind === "text" ? (
            <>
              <div className={styles.previewCard}>
                <pre className={styles.textScroll}>{textBody || "(vazio)"}</pre>
              </div>
              <p className={styles.charBadge}>
                {charCount} {charCount === 1 ? "caractere" : "caracteres"}
              </p>
              {textIaUseLevel != null && onTextIaUseLevelChange ? (
                <IaTextoLevelFieldset
                  idPrefix="text-memo-confirm"
                  value={textIaUseLevel}
                  onChange={onTextIaUseLevelChange}
                />
              ) : null}
            </>
          ) : null}

          {kind === "url" ? (
            <>
              <div className={styles.previewCard}>
                <p className={styles.urlMono}>{urlProp || "—"}</p>
              </div>
              {urlIaUseLevel != null && onUrlIaUseLevelChange ? (
                <IaTextoLevelFieldset
                  idPrefix="url-memo-confirm"
                  value={urlIaUseLevel}
                  onChange={onUrlIaUseLevelChange}
                />
              ) : null}
            </>
          ) : null}

          {kind === "image" && previewUrl ? (
            <div className={styles.previewCard}>
              <div className={styles.imagePreviewWrap}>
                <img className={styles.imagePreview} src={previewUrl} alt="Visualização da imagem" />
              </div>
              <div className={styles.metaStrip}>
                {imgDims ? (
                  <span className={styles.metaChip}>
                    {imgDims.w} × {imgDims.h}
                  </span>
                ) : (
                  <span className={styles.charBadge}>Lendo dimensões…</span>
                )}
                {file ? <span>{formatFileSize(file.size)}</span> : null}
              </div>
            </div>
          ) : null}

          {kind === "image" && !previewUrl && file ? (
            <p className={styles.loadingStrip}>Preparando visualização…</p>
          ) : null}

          {kind === "image" && imageIaUseLevel != null && onImageIaUseLevelChange ? (
            <IaTextoLevelFieldset
              idPrefix="image-memo-confirm"
              value={imageIaUseLevel}
              onChange={onImageIaUseLevelChange}
            />
          ) : null}

          {(kind === "audio" || kind === "video" || kind === "document") && file ? (
            <div className={styles.previewCard}>
              <div className={styles.metaStrip} style={{ borderTop: "none", background: "#f8fafc" }}>
                <span className={styles.summaryPrimary}>{summaryLine}</span>
              </div>
              <p className={styles.fileNameMuted}>{file.name}</p>
            </div>
          ) : null}

          {kind === "document" && documentIaUseLevel != null && onDocumentIaUseLevelChange ? (
            <IaTextoLevelFieldset
              idPrefix="document-memo-confirm"
              value={documentIaUseLevel}
              onChange={onDocumentIaUseLevelChange}
            />
          ) : null}

          {kind === "audio" && audioIaUseLevel != null && onAudioIaUseLevelChange ? (
            <IaTextoLevelFieldset
              idPrefix="audio-memo-confirm"
              value={audioIaUseLevel}
              onChange={onAudioIaUseLevelChange}
            />
          ) : null}

          {kind === "video" && videoIaUseLevel != null && onVideoIaUseLevelChange ? (
            <IaTextoLevelFieldset
              idPrefix="video-memo-confirm"
              value={videoIaUseLevel}
              onChange={onVideoIaUseLevelChange}
            />
          ) : null}

          {kind === "audio" && file && audioDur === undefined ? (
            <p className={styles.charBadge}>Calculando duração…</p>
          ) : null}
          {kind === "video" && file && videoDur === undefined ? (
            <p className={styles.charBadge}>Calculando duração…</p>
          ) : null}
        </div>

        <div className={styles.actions}>
          <button type="button" className="mm-btn mm-btn--ghost" disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="mm-btn mm-btn--primary" disabled={busy} onClick={onConfirm}>
            Prosseguir
          </button>
        </div>
      </div>
    </div>
  );
}
