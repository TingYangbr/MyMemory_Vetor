import type { MemoRecentCard } from "@mymemory/shared";
import { attachmentExt, documentVisualKind } from "./memoCardDisplayUtils";
import styles from "./MemoCardRow.module.css";

function IconGlobe({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path
        d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MemoCardTypeGlyph({ m }: { m: MemoRecentCard }) {
  const ext = attachmentExt(m.mediaFileUrl);
  if (m.mediaType === "document") {
    const kind = documentVisualKind(ext);
    if (kind === "mail") {
      return (
        <span className={styles.searchCardGlyphWrapMail} aria-hidden title="E-mail">
          <svg className={styles.searchCardGlyphSvg} viewBox="0 0 24 24" fill="none">
            <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
            <path
              d="M3 7l9 5.5L21 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      );
    }
    const tag = kind === "pdf" ? "PDF" : kind === "word" ? "DOC" : "FILE";
    const cls =
      kind === "pdf"
        ? styles.searchCardDocPdf
        : kind === "word"
          ? styles.searchCardDocWord
          : styles.searchCardDocNeutral;
    return (
      <span className={`${styles.searchCardDocTag} ${cls}`} aria-hidden>
        {tag}
      </span>
    );
  }
  if (m.mediaType === "url") {
    return (
      <span className={styles.searchCardGlyphWrap} aria-hidden>
        <IconGlobe className={styles.searchCardGlyphSvg} />
      </span>
    );
  }
  if (m.mediaType === "text") {
    return (
      <span className={styles.searchCardTextTag} aria-hidden>
        T
      </span>
    );
  }
  if (m.mediaType === "image") {
    return (
      <span className={styles.searchCardGlyphWrap} aria-hidden>
        <svg className={styles.searchCardGlyphSvg} viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
          <circle cx="8.5" cy="10" r="1.5" fill="currentColor" />
          <path
            d="M21 15l-5-5-4 4-3-3-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (m.mediaType === "video") {
    return (
      <span className={styles.searchCardGlyphWrap} aria-hidden>
        <svg className={styles.searchCardGlyphSvg} viewBox="0 0 24 24" fill="none">
          <rect x="2" y="7" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
          <path
            d="M17 10l4-2v8l-4-2v-4z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (m.mediaType === "audio") {
    return (
      <span className={styles.searchCardGlyphWrap} aria-hidden>
        <svg className={styles.searchCardGlyphSvg} viewBox="0 0 24 24" fill="none">
          <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" />
          <path
            d="M15.5 9.5a3 3 0 010 5M17.7 7.3a6 6 0 010 9.4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className={styles.searchCardTextTag} aria-hidden>
      ?
    </span>
  );
}
