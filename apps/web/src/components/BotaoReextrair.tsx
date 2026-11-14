import { useEffect, useState } from "react";
import type { TextMemoProcessResponse } from "@mymemory/shared";
import { apiPostJson } from "../api";
import styles from "../pages/MemoTextReviewPage.module.css";

/**
 * Revisão do Catalogar: quando o usuário troca a categoria no combo, oferece ↻ Re-processar —
 * a IA refaz resumo, palavras-chave e campos a partir do texto já extraído, só com a categoria escolhida.
 * Aparece só quando a categoria escolhida difere daquela dos campos atuais.
 */
export default function BotaoReextrair(props: {
  texto: string;
  groupId: number | null | undefined;
  categoryId: number | null;
  /** Categoria usada na extração dos campos que estão na tela. */
  categoriaExtraidaId: number | null;
  maxSummaryChars?: number;
  disabled?: boolean;
  onResultado: (r: TextMemoProcessResponse, categoryId: number) => void;
  /** Avisa a página enquanto reextrai (a página suspende o microfone). */
  onOcupado?: (ocupado: boolean) => void;
  /** Não mostrar o aviso "Você alterou a categoria." (a página já tem o seu). */
  semAviso?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { categoryId } = props;
  useEffect(() => setErro(null), [categoryId]);
  if (categoryId == null || categoryId === props.categoriaExtraidaId || !props.texto.trim()) {
    return erro ? <span className={`mm-error ${styles.reextrairErro}`}>{erro}</span> : null;
  }

  const reextrair = async () => {
    setBusy(true);
    props.onOcupado?.(true);
    setErro(null);
    try {
      const r = await apiPostJson<TextMemoProcessResponse>("/api/memos/reextrair", {
        texto: props.texto,
        groupId: props.groupId ?? null,
        categoryId,
        maxSummaryChars: props.maxSummaryChars && props.maxSummaryChars > 0 ? props.maxSummaryChars : undefined,
      });
      props.onResultado(r, categoryId);
    } catch (e) {
      let msg = e instanceof Error ? e.message : "Falha ao re-processar.";
      try {
        msg = (JSON.parse(msg) as { message?: string }).message || msg;
      } catch {
        /* mensagem já em texto */
      }
      setErro(msg);
    } finally {
      setBusy(false);
      props.onOcupado?.(false);
    }
  };

  return (
    <>
      {props.semAviso ? null : <span className={styles.reextrairAviso}>Você alterou a categoria.</span>}
      <button
        type="button"
        className={styles.reextrairBtn}
        onClick={() => void reextrair()}
        disabled={busy || props.disabled}
        title="Re-processar com a nova categoria: a IA refaz resumo, palavras-chave e dados específicos (substitui o que estiver na tela)"
      >
        {busy ? "Re-processando…" : "↻ Re-processar"}
      </button>
      {erro ? <span className={`mm-error ${styles.reextrairErro}`}>{erro}</span> : null}
    </>
  );
}
