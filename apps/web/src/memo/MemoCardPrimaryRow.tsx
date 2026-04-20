import { Link } from "react-router-dom";
import type { MemoRecentCard } from "@mymemory/shared";
import {
  formatSearchCardDate,
  memoCardHasAttachment,
  searchCardPrimaryLabel,
} from "./memoCardDisplayUtils";
import { MemoCardTypeGlyph } from "./MemoCardTypeGlyph";
import styles from "./MemoCardRow.module.css";

type Props = {
  m: MemoRecentCard;
  apiBase: string;
  /** `state.returnTo` ao consultar memo sem arquivo (ex.: `/`, `/buscar`). */
  returnTo: string;
};

export function MemoCardPrimaryRow({ m, apiBase, returnTo }: Props) {
  const label = searchCardPrimaryLabel(m);
  const dateStr = formatSearchCardDate(m.createdAt);
  const row = (
    <>
      <MemoCardTypeGlyph m={m} />
      <span className={styles.memoCardPrimaryLabel}>{label}</span>
      <time className={styles.memoCardPrimaryDate} dateTime={m.createdAt}>
        {dateStr}
      </time>
    </>
  );

  if (m.mediaType === "url") {
    const canOpenArchivedHtml = Boolean(m.mediaFileUrl?.trim());
    const htmlHref = canOpenArchivedHtml ? `${apiBase}/api/memos/${m.id}/file` : null;
    const webHref = m.mediaWebUrl?.trim() || null;
    return (
      <div className={styles.memoCardUrlBlock}>
        <Link
          to={`/memo/${m.id}/editar`}
          state={{ returnTo }}
          className={`${styles.memoCardPrimary} ${styles.memoCardPrimaryConsult}`}
          title="Consultar memo"
          aria-label={`Consultar: ${label}`}
        >
          {row}
        </Link>
        {(htmlHref || webHref) && (
          <div className={styles.memoCardUrlActions}>
            {htmlHref ? (
              <a
                href={htmlHref}
                className={styles.memoCardUrlAction}
                target="_blank"
                rel="noopener noreferrer"
                title="Abrir página HTML arquivada"
              >
                HTML arquivado
              </a>
            ) : null}
            {webHref ? (
              <a
                href={webHref}
                className={styles.memoCardUrlAction}
                target="_blank"
                rel="noopener noreferrer"
                title="Abrir URL original no site"
              >
                URL original
              </a>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  if (memoCardHasAttachment(m)) {
    return (
      <a
        href={`${apiBase}/api/memos/${m.id}/file`}
        className={styles.memoCardPrimary}
        target="_blank"
        rel="noopener noreferrer"
        title="Abrir ou baixar arquivo"
        aria-label={`Abrir arquivo: ${label}`}
      >
        {row}
      </a>
    );
  }
  return (
    <Link
      to={`/memo/${m.id}/editar`}
      state={{ returnTo }}
      className={`${styles.memoCardPrimary} ${styles.memoCardPrimaryConsult}`}
      title="Consultar memo"
      aria-label={`Consultar: ${label}`}
    >
      {row}
    </Link>
  );
}
