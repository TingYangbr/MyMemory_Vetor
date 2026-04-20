import type { ReactNode } from "react";
import styles from "./MemoProcessOverlay.module.css";

/** Etapas curtas comuns a todos os tipos de memo em processamento. */
export const STANDARD_MEMO_PROCESS_STEPS = [
  "Capturando e convertendo os dados…",
  "Preparando dados para IA",
  "Processando IA",
  "Aguardando resposta da IA",
] as const;

export const IMAGE_MEMO_PROCESS_STEPS = STANDARD_MEMO_PROCESS_STEPS;
export const TEXT_MEMO_PROCESS_STEPS = STANDARD_MEMO_PROCESS_STEPS;
export const AUDIO_MEMO_PROCESS_STEPS = STANDARD_MEMO_PROCESS_STEPS;
export const VIDEO_MEMO_PROCESS_STEPS = STANDARD_MEMO_PROCESS_STEPS;
export const DOCUMENT_MEMO_PROCESS_STEPS = STANDARD_MEMO_PROCESS_STEPS;

export type MemoProcessOverlayProps = {
  title: string;
  titleId: string;
  hint: string;
  steps: readonly string[];
  activeStepIndex: number;
  onDiscard: () => void;
  /** Visualização opcional (imagem ou trecho de texto). */
  preview?: ReactNode;
  /** Quando há prévia de texto, alinha o bloco ao topo (scroll interno). */
  previewIsText?: boolean;
};

export default function MemoProcessOverlay({
  title,
  titleId,
  hint,
  steps,
  activeStepIndex,
  onDiscard,
  preview,
  previewIsText,
}: MemoProcessOverlayProps) {
  return (
    <div
      className={styles.overlay}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-busy="true"
    >
      <div className={styles.card}>
        <div className={styles.head}>
          <div className={styles.hourglass} aria-hidden>
            ⏳
          </div>
          <div>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <p className={styles.hint}>{hint}</p>
          </div>
        </div>

        {preview ? (
          <div
            className={`${styles.previewWrap}${previewIsText ? ` ${styles.previewWrapAlignStart}` : ""}`}
          >
            {preview}
          </div>
        ) : null}

        <div>
          <p className={styles.stepsTitle}>Etapas</p>
          <ol className={styles.steps}>
            {steps.map((label, i) => (
              <li
                key={`${i}-${label}`}
                className={`${styles.step} ${i === activeStepIndex ? styles.stepActive : ""} ${i < activeStepIndex ? styles.stepDone : ""}`}
              >
                {label}
              </li>
            ))}
          </ol>
          {activeStepIndex === steps.length - 1 ? (
            <p className={styles.liveWaitNote} role="status" aria-live="polite">
              <span className={styles.liveWaitLead} aria-hidden />
              Aguarde mais um pouco…
            </p>
          ) : null}
        </div>

        <div className={styles.actions}>
          <button type="button" className="mm-btn mm-btn--ghost" onClick={onDiscard}>
            Descartar
          </button>
        </div>
      </div>
    </div>
  );
}
