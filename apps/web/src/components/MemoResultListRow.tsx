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
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L8 18l-4 1 1-4L16.5 3.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
};

export function MemoResultListRow({
  m,
  returnTo,
  currentUserId,
  deletingId,
  onOpenPreview,
  onRequestDelete,
}: MemoResultListRowProps) {
  const isOwner = currentUserId != null && m.userId > 0 && m.userId === currentUserId;
  const bodyText = m.mediaText ?? "";
  const textLen = bodyText.length;
  const kwCount = parseKeywordList(m.keywords).length;
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
          <Link to={`/memo/${m.id}/editar`} state={{ returnTo }} className={styles.listRow1Link} title="Abrir memo">
            <span className={styles.listFilename}>{label}</span>
            <time className={styles.listDate} dateTime={m.createdAt}>
              {dateStr}
            </time>
          </Link>
        </div>
        <div className={styles.listRow2}>
          <div className={styles.listMetrics}>
            <span className={styles.metricChip}>
              <span className={styles.metricLbl}>Texto</span>
              <span className={styles.metricVal}>{textLen}</span>
            </span>
            <span className={styles.metricChip}>
              <span className={styles.metricLbl}>keywords</span>
              <span className={styles.metricVal}>{kwCount}</span>
            </span>
            <span className={styles.metricChip}>
              <span className={styles.metricLbl}>dados</span>
              <span className={styles.metricVal}>
                {xx}/{yy}
              </span>
            </span>
          </div>
        </div>
      </div>
      {isOwner ? (
        <div className={styles.listIconActions}>
          <Link
            to={`/memo/${m.id}/editar`}
            state={{ returnTo }}
            className={styles.listIconBtn}
            title="Editar"
            aria-label={`Editar memo ${m.id}`}
          >
            <IconPencil className={styles.listIconSvg} />
          </Link>
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
