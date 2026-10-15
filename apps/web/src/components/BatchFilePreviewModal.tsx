import { useEffect, useId, useState } from "react";
import type { BatchFileVerifyResult, StorageProvider } from "@mymemory/shared";
import styles from "./BatchFilePreviewModal.module.css";

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".oga", ".opus", ".m4a", ".flac", ".aac"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".m4v"]);
const FRAME_EXT = new Set([".pdf", ".txt", ".csv", ".md"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Visualização de um arquivo da pré-verificação da Importação em Lote (ainda não é memo).
 * PDF, imagem, áudio, vídeo e texto abrem aqui dentro; Word/Excel/etc. só oferecem download —
 * o navegador não renderiza esses formatos.
 */
export function BatchFilePreviewModal({
  file,
  provider,
  onClose,
}: {
  file: BatchFileVerifyResult;
  provider: StorageProvider;
  onClose: () => void;
}) {
  const titleId = useId();
  const ext = extOf(file.originalFileName);
  const kind = IMAGE_EXT.has(ext) ? "image" : AUDIO_EXT.has(ext) ? "audio" : VIDEO_EXT.has(ext) ? "video" : FRAME_EXT.has(ext) ? "frame" : "download";

  const query = `provider=${encodeURIComponent(provider)}&path=${encodeURIComponent(file.fullPath)}`;
  const inlineHref = `${apiBase}/api/memos/batch/preview?${query}`;
  const downloadHref = `${inlineHref}&download=1`;

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(kind !== "download");
  const [error, setError] = useState<string | null>(null);

  // Busca o arquivo como blob: erros da API viram mensagem legível (em vez do JSON cru dentro do
  // iframe) e o mesmo cookie de sessão é enviado.
  useEffect(() => {
    if (kind === "download") return;
    const ac = new AbortController();
    let url: string | null = null;
    setLoading(true);
    setError(null);
    fetch(inlineHref, { credentials: "include", signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try { msg = ((await res.json()) as { message?: string }).message ?? msg; } catch { /* corpo não-JSON */ }
          throw new Error(msg);
        }
        return res.blob();
      })
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => {
      ac.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [inlineHref, kind]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  let body;
  if (kind === "download") {
    body = (
      <div className={styles.downloadBox}>
        <p>
          O navegador não consegue mostrar arquivos <strong>{ext || "desse tipo"}</strong> dentro da página.
        </p>
        <a className={styles.primaryBtn} href={downloadHref}>Baixar para abrir</a>
      </div>
    );
  } else if (loading) {
    body = <p className={styles.state}>Carregando arquivo…</p>;
  } else if (error || !objectUrl) {
    body = <p className={styles.stateErr}>Não foi possível abrir o arquivo: {error ?? "resposta vazia"}</p>;
  } else if (kind === "image") {
    body = <img className={styles.img} src={objectUrl} alt={file.originalFileName} />;
  } else if (kind === "audio") {
    body = <audio className={styles.audio} src={objectUrl} controls />;
  } else if (kind === "video") {
    body = <video className={styles.video} src={objectUrl} controls playsInline />;
  } else {
    body = <iframe className={styles.frame} src={objectUrl} title={file.originalFileName} />;
  }

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.headText}>
            <h2 id={titleId} className={styles.title} title={file.fullPath}>{file.originalFileName}</h2>
            <span className={styles.meta}>{formatBytes(file.sizeBytes)}</span>
          </div>
          <div className={styles.headActions}>
            {kind !== "download" && objectUrl ? (
              <a className={styles.linkBtn} href={objectUrl} target="_blank" rel="noopener noreferrer">
                Abrir em outra aba
              </a>
            ) : null}
            {kind !== "download" ? <a className={styles.linkBtn} href={downloadHref}>Baixar</a> : null}
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fechar">×</button>
          </div>
        </div>
        <div className={styles.body}>{body}</div>
      </div>
    </div>
  );
}
