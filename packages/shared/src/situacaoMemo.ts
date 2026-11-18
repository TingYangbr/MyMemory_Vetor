/**
 * Situação dos memos de categoria atualizável — um vocabulário só, no memo e no item da lista.
 *
 * Dois tipos de categoria (uma pergunta ao ligar "Atualizável"):
 *  - "afazer": algo a fazer ou a acontecer (Agenda, To-do, Lista de compras, Contas a pagar)
 *      → Pendente ☐ · Concluído ☑ · Cancelado ☒
 *  - "registro": um registro que vale (Regras, Despesas, Operações de investimento)
 *      → Válido · Cancelado
 *
 * O valor gravado é sempre Pendente/Válido, Concluído ou Cancelado (as regras de "encerrado"
 * olham conclu…/cancel…). O "Concluído" pode aparecer com o nome da categoria (Comprado, Pago,
 * Realizado), só na tela. Memos antigos com "Ativo" (ou vazio) contam como abertos.
 */

export type TipoSituacao = "afazer" | "registro";
export type EstadoSituacao = "aberto" | "concluido" | "cancelado";

export interface RotulosSituacao {
  aberto: string;
  concluido: string;
  cancelado: string;
  /** Estados que a categoria oferece, na ordem dos botões. */
  opcoes: EstadoSituacao[];
}

export const SIMBOLO_SITUACAO: Record<EstadoSituacao, string> = { aberto: "☐", concluido: "☑", cancelado: "☒" };

const sem = (s: string) =>
  s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().trim();

export function tipoSituacao(v: string | null | undefined): TipoSituacao {
  return v === "registro" ? "registro" : "afazer";
}

export function rotulosSituacao(tipo: string | null | undefined, rotuloConcluido?: string | null): RotulosSituacao {
  const t = tipoSituacao(tipo);
  return {
    aberto: t === "registro" ? "Válido" : "Pendente",
    concluido: rotuloConcluido?.trim() || "Concluído",
    cancelado: "Cancelado",
    opcoes: t === "registro" ? ["aberto", "cancelado"] : ["aberto", "concluido", "cancelado"],
  };
}

/** Estado de um valor gravado: Concluído → concluido; Cancelado → cancelado; o resto (Pendente, Ativo, Válido, vazio) → aberto. */
export function estadoDaSituacao(valor: string | null | undefined): EstadoSituacao {
  const v = sem(valor ?? "");
  if (v.startsWith("conclu")) return "concluido";
  if (v.startsWith("cancel")) return "cancelado";
  return "aberto";
}

/** Valor gravado para um estado. */
export function valorDaSituacao(estado: EstadoSituacao, tipo: string | null | undefined): string {
  if (estado === "concluido") return "Concluído";
  if (estado === "cancelado") return "Cancelado";
  return tipoSituacao(tipo) === "registro" ? "Válido" : "Pendente";
}

/** Nome mostrado na tela para um valor gravado ("Concluído" na Lista de compras → "Comprado"). */
export function rotuloDaSituacao(valor: string | null | undefined, rotulos: RotulosSituacao): string {
  return rotulos[estadoDaSituacao(valor)];
}

/**
 * Estado a partir do que foi dito ou escolhido: o valor, o nome da categoria ("Comprado", "Pago")
 * ou um verbo comum ("comprei", "paguei", "fui", "desisti", "reabrir"). null = não reconhecido.
 */
export function estadoDoDito(dito: string | null | undefined, rotulos?: RotulosSituacao): EstadoSituacao | null {
  const v = sem(dito ?? "");
  if (!v) return null;
  if (rotulos) {
    for (const e of ["aberto", "concluido", "cancelado"] as EstadoSituacao[]) {
      if (sem(rotulos[e]) === v) return e;
    }
  }
  if (/^(cancel|desist|anul|estorn|revog|nao vai|descart)/.test(v)) return "cancelado";
  if (/^(ativ|pendent|abert|reabr|reativ|valid|vigent|volt|em aberto|a fazer)/.test(v)) return "aberto";
  if (/^(conclu|feit|realiz|compr|pag|receb|termin|finaliz|encerr|entreg|fui|fiz|aconteceu|ok\b)/.test(v)) return "concluido";
  return null;
}

/** Valores do campo de situação (padrões) para o tipo. */
export function padroesSituacao(tipo: string | null | undefined): string {
  return tipoSituacao(tipo) === "registro" ? "Válido, Cancelado" : "Pendente, Concluído, Cancelado";
}

/** Descrição do campo de situação para a IA. */
export function descricaoCampoSituacao(tipo: string | null | undefined): string {
  return tipoSituacao(tipo) === "registro"
    ? "Situação do registro: Válido (vale) ou Cancelado (lançado errado, estornado, revogado). Registro novo: Válido, salvo se o texto disser que foi cancelado."
    : "Situação: Pendente (a fazer, ainda vai acontecer), Concluído (feito, aconteceu, comprado, pago) ou Cancelado (não vai acontecer). Registro novo: Pendente, salvo se o texto disser que já aconteceu ou foi cancelado.";
}
