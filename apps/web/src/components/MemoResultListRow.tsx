import { Link } from "react-router-dom";
import type { MemoRecentCard } from "@mymemory/shared";
import {
  dadosFilledCounts,
  formatSearchCardDate,
  parseKeywordList,
  searchCardPrimaryLabel,
} from "../memo/memoCardDisplayUtils";
import { MemoCardTypeGlyph } from "../memo/MemoCardTypeGlyph";
import styles from "./RecentMemos.module.css";

function IconPencil({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10"/>
      <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
      <path d="m10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4 5.4-5.4z"/>
    </svg>
  );
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V5h6v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type MemoResultListRowProps = {
  m: MemoRecentCard;
  returnTo: string;
  currentUserId: number | null;
  deletingId: number | null;
  onOpenPreview: (m: MemoRecentCard) => void;
  onRequestDelete: (m: MemoRecentCard) => void;
  noNavigate?: boolean;
  onEdit?: (m: MemoRecentCard) => void;
};

export function MemoResultListRow({
  m,
  returnTo,
  currentUserId,
  deletingId,
  onOpenPreview,
  onRequestDelete,
  noNavigate,
  onEdit,
}: MemoResultListRowProps) {
  const isOwner = currentUserId != null && m.userId > 0 && m.userId === currentUserId;
  const bodyText = m.mediaText ?? "";
  const textLen = bodyText.length;
  const kws = parseKeywordList(m.keywords);
  const { xx, yy } = dadosFilledCounts(m.dadosEspecificosJson);
  const label = searchCardPrimaryLabel(m);
  const dateStr = formatSearchCardDate(m.createdAt);

  return (
    <li className={styles.listItem}>
      <div className={styles.listMain}>
        <button
          type="button"
          className={styles.listGlyphBtn}
          title="Ver ou reproduzir arquivo"
          aria-label={`Visualizar ou reproduzir arquivo do memo ${m.id}`}
          onClick={() => onOpenPreview(m)}
        >
          <MemoCardTypeGlyph m={m} />
        </button>
        <div className={styles.listRow1Rest}>
          {noNavigate ? (
            <a href={`/memo/${m.id}/editar?returnTo=${encodeURIComponent(returnTo)}`} target="_blank" rel="noopener noreferrer" className={styles.listRow1Link} title="Abrir memo em nova aba">
              <span className={styles.listFilename}>{label}</span>
              <time className={styles.listDate} dateTime={m.createdAt}>
                {dateStr}
              </time>
            </a>
          ) : (
            <Link to={`/memo/${m.id}/editar`} state={{ returnTo }} className={styles.listRow1Link} title="Abrir memo">
              <span className={styles.listFilename}>{label}</span>
              <time className={styles.listDate} dateTime={m.createdAt}>
                {dateStr}
              </time>
            </Link>
          )}
        </div>
        <div className={styles.listRow2}>
          {kws.slice(0, 3).map((k) => (
            <span key={k} className={styles.listTag}>{k}</span>
          ))}
          {kws.length > 3 ? (
            <span className={styles.listTagMais} title={kws.slice(3).join(", ")}>+{kws.length - 3}</span>
          ) : null}
          <span className={styles.listRef} title={`${textLen} caracteres · ${kws.length} palavras-chave · dados ${xx}/${yy}`}>#{m.id}</span>
        </div>
      </div>
      {isOwner ? (
        <div className={styles.listIconActions}>
          {noNavigate && onEdit ? (
            <button
              type="button"
              className={styles.listIconBtn}
              title="Editar"
              aria-label={`Editar memo ${m.id}`}
              onClick={() => onEdit(m)}
            >
              <IconPencil className={styles.listIconSvg} />
            </button>
          ) : noNavigate ? (
            <a
              href={`/memo/${m.id}/editar?returnTo=${encodeURIComponent(returnTo)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.listIconBtn}
              title="Editar em nova aba"
              aria-label={`Editar memo ${m.id} em nova aba`}
            >
              <IconPencil className={styles.listIconSvg} />
            </a>
          ) : (
            <Link
              to={`/memo/${m.id}/editar`}
              state={{ returnTo }}
              className={styles.listIconBtn}
              title="Editar"
              aria-label={`Editar memo ${m.id}`}
            >
              <IconPencil className={styles.listIconSvg} />
            </Link>
          )}
          <button
            type="button"
            className={`${styles.listIconBtn} ${styles.listIconBtnDanger}`}
            disabled={deletingId !== null}
            title="Mover para a lixeira"
            aria-label={`Mover memo ${m.id} para a lixeira`}
            onClick={() => onRequestDelete(m)}
          >
            <IconTrash className={styles.listIconSvg} />
          </button>
        </div>
      ) : null}
    </li>
  );
}
