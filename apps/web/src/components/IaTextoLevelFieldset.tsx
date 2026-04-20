import type { UserIaUseLevel } from "@mymemory/shared";
import { USER_IA_USE_LABELS, USER_IA_USE_LEVELS } from "@mymemory/shared";
import styles from "./IaTextoLevelFieldset.module.css";

type Props = {
  value: UserIaUseLevel;
  onChange: (v: UserIaUseLevel) => void;
  /** Prefixo único para o atributo name dos radios (acessibilidade). */
  idPrefix: string;
};

export default function IaTextoLevelFieldset({ value, onChange, idPrefix }: Props) {
  const name = `${idPrefix}-ia-texto`;
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Uso de IA</legend>
      <p className={styles.hint}>Como o texto será processado antes da tela de revisão.</p>
      <div className={styles.options} role="radiogroup" aria-label="Uso de IA para memo em texto">
        {USER_IA_USE_LEVELS.map((lvl) => (
          <label key={lvl} className={styles.option}>
            <input
              type="radio"
              name={name}
              checked={value === lvl}
              onChange={() => onChange(lvl)}
            />
            <span>{USER_IA_USE_LABELS[lvl]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
