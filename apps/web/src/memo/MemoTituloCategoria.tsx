import type { MemoRecentCard } from "@mymemory/shared";
import styles from "./MemoTituloCategoria.module.css";

/** Título curto (IA) do memo, ou `null` quando ainda não existe. */
export function tituloCurtoDoMemo(m: MemoRecentCard): string | null {
  const t = m.tituloCurto?.trim();
  return t ? t : null;
}

/** Primeiro nome de quem catalogou (para caber na linha). */
export function autorCurto(m: MemoRecentCard): string | null {
  const n = m.authorName?.trim();
  if (!n) return null;
  return n.split(/\s+/)[0] ?? n;
}

/** Chip da categoria (só aparece se o memo tiver categoria). */
export function MemoCategoriaChip({ m }: { m: MemoRecentCard }) {
  const c = m.category?.trim();
  if (!c) return null;
  return (
    <span className={styles.cat} title={`Categoria: ${c}`}>
      {c}
    </span>
  );
}

/**
 * Linha "Categoria · Título curto" usada nos cartões (vista em cartões).
 * Não renderiza nada quando o memo não tem categoria nem título.
 */
export function MemoTituloCategoria({ m, className }: { m: MemoRecentCard; className?: string }) {
  const titulo = tituloCurtoDoMemo(m);
  const autor = autorCurto(m);
  if (!titulo && !m.category?.trim()) return null;
  return (
    <div className={`${styles.linha} ${styles.cardLinha} ${className ?? ""}`}>
      <MemoCategoriaChip m={m} />
      {titulo ? <span className={styles.titulo}>{titulo}</span> : null}
      {autor ? <span className={styles.autor} title={m.authorName ?? undefined}>por {autor}</span> : null}
    </div>
  );
}

export { styles as memoTituloStyles };
