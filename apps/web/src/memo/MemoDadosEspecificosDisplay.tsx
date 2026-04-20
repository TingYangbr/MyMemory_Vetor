import type { ReactNode } from "react";
import type { MemoDadosEspecificosEntry } from "./memoCardDisplayUtils";
import styles from "./MemoDadosEspecificosDisplay.module.css";

type Props = {
  entries: MemoDadosEspecificosEntry[] | null;
  /** Ex.: realce de busca por termo */
  formatSegment?: (text: string) => ReactNode;
  className?: string;
};

export function MemoDadosEspecificosDisplay({ entries, formatSegment, className }: Props) {
  if (!entries?.length) return null;
  const fmt = formatSegment ?? ((t: string) => t);
  return (
    <span className={[styles.wrap, className].filter(Boolean).join(" ")}>
      {entries.map((e, i) => (
        <span key={`${e.key}-${i}`} className={styles.pair}>
          {i > 0 ? <span className={styles.sep}> · </span> : null}
          <span className={styles.label}>{fmt(e.key)}</span>
          {e.value ? (
            <>
              {": "}
              <strong className={styles.value}>{fmt(e.value)}</strong>
            </>
          ) : null}
        </span>
      ))}
    </span>
  );
}
