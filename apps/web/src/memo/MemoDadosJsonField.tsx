import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { segmentJsonForSyntaxHighlight } from "./jsonDadosHighlight";
import styles from "./MemoDadosJsonField.module.css";

type Props = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
};

export function MemoDadosJsonField({ id, value, onChange, placeholder, rows = 4 }: Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLPreElement | null>(null);

  const segments = useMemo(() => segmentJsonForSyntaxHighlight(value), [value]);

  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    const m = mirrorRef.current;
    if (!ta || !m) return;
    m.scrollTop = ta.scrollTop;
    m.scrollLeft = ta.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    syncScroll();
  }, [value, segments, syncScroll]);

  const minRows = Math.max(2, rows);
  const rowStyle = { minHeight: `${minRows * 1.45 * 0.82 + 1.35}rem` } as const;

  const syncMirrorHeight = useCallback(() => {
    const ta = taRef.current;
    const m = mirrorRef.current;
    if (!ta || !m) return;
    const h = `${ta.offsetHeight}px`;
    m.style.height = h;
    m.style.minHeight = h;
  }, []);

  useLayoutEffect(() => {
    syncMirrorHeight();
  }, [value, segments, syncMirrorHeight]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const ro = new ResizeObserver(() => syncMirrorHeight());
    ro.observe(ta);
    return () => ro.disconnect();
  }, [syncMirrorHeight]);

  return (
    <div className={styles.wrap}>
      <pre ref={mirrorRef} className={styles.mirror} aria-hidden>
        {segments.map((seg, idx) => (
          <span
            key={idx}
            className={seg.kind === "key" ? styles.hk : seg.kind === "value" ? styles.hv : styles.hn}
          >
            {seg.text}
          </span>
        ))}
        {!value && placeholder ? <span className={styles.ph}>{placeholder}</span> : null}
      </pre>
      <textarea
        ref={taRef}
        id={id}
        className={styles.textarea}
        style={rowStyle}
        rows={rows}
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
      />
    </div>
  );
}
