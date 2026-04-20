import { useCallback, useEffect, useState, type ReactNode } from "react";
import styles from "../pages/MemoTextReviewPage.module.css";

export const REVIEW_PAGE_TITLE = "Revisar memo antes de gravar";

export type ReviewMediaKind =
  | "texto"
  | "URL"
  | "imagem"
  | "áudio"
  | "vídeo"
  | "documento";

export function formatReviewBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function resolveMediaPublicHref(href: string): string {
  const t = href.trim();
  if (!t) return "#";
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  if (t.startsWith("/")) return `${window.location.origin}${t}`;
  return `${window.location.origin}/${t}`;
}

export function urlFileLabel(url: string): string {
  try {
    const u = new URL(url.trim());
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length > 0) return decodeURIComponent(last);
    return u.hostname || "link";
  } catch {
    return "link";
  }
}

/** Extensão do arquivo com ponto, ex. `.msg`, ou `null` se não houver. */
export function reviewFileKindExtension(filename: string): string | null {
  const t = filename.trim();
  const i = t.lastIndexOf(".");
  if (i < 1 || i >= t.length - 1) return null;
  const ext = t.slice(i).toLowerCase();
  if (ext.length > 16) return null;
  return ext;
}

export function ReviewHero({
  mediaKind,
  kindExtension,
}: {
  mediaKind: ReviewMediaKind;
  /** Ex.: `.msg` ou `msg` — aparece como «documento .msg» no subtítulo. */
  kindExtension?: string | null;
}) {
  const raw = kindExtension?.trim();
  const dotExt =
    raw && raw.length > 0 ? (raw.startsWith(".") ? raw : `.${raw}`) : null;
  const kindDisplay = dotExt ? `${mediaKind} ${dotExt}` : mediaKind;
  return (
    <header className={styles.reviewHero}>
      <h1 className={styles.reviewHeroTitle}>
        {REVIEW_PAGE_TITLE}{" "}
        <span className={styles.reviewHeroKind}>({kindDisplay})</span>
      </h1>
    </header>
  );
}

export function ReviewFileStrip({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className={styles.fileMetaRow} role="group" aria-label="Arquivo e dados do original">
      <span className={styles.fileMetaLeft}>{left}</span>
      <span className={styles.fileMetaRight}>{right}</span>
    </div>
  );
}

/** Miniatura clicável → lightbox (imagem). */
export function ReviewImageLightboxThumb({ src, alt = "Imagem original" }: { src: string; alt?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        className={styles.reviewThumbButton}
        onClick={() => setOpen(true)}
        aria-label="Ampliar imagem"
      >
        <img src={src} alt="" className={styles.reviewThumbImg} />
        <span className={styles.reviewThumbHint}>Clique para ampliar</span>
      </button>
      {open ? (
        <div className={styles.imageLightboxOverlay} role="presentation" onClick={close}>
          <div
            className={styles.imageLightboxDialog}
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            onClick={(e) => e.stopPropagation()}
          >
            <img src={src} alt={alt} className={styles.imageLightboxImg} />
            <button type="button" className="mm-btn mm-btn--ghost" onClick={close}>
              Fechar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
