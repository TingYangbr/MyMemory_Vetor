/** Lembretes: regra configurada numa categoria que envia e-mail antes da data/hora de cada item. */

export type LembreteOrigem = "memos" | "erp";

/** autor = quem registrou o memo; grupo = todos os membros; owner = owner do grupo; email = e-mails fixos */
export type LembreteDestinatarioTipo = "autor" | "grupo" | "owner" | "email";

export interface LembreteRegra {
  id: number;
  categoryId: number;
  origem: LembreteOrigem;
  ativo: boolean;
  /** Campo do memo com a data do compromisso (ex.: "Data Agenda") */
  campoData: string;
  /** Campo do memo com o horário (ex.: "Horario"); null = usa horarioPadrao */
  campoHorario: string | null;
  /** Antecedências padrão em minutos (ex.: [1440, 60] = 1 dia e 1 hora antes) */
  antecedenciasMin: number[];
  destinatarioTipo: LembreteDestinatarioTipo;
  /** E-mails fixos separados por vírgula quando destinatarioTipo = "email" */
  destinatarioValor: string | null;
  /** Campos opcionais do memo que sobrepõem o padrão (vazios → padrão da regra) */
  campoAntecedencia: string | null;
  campoDestinatario: string | null;
  campoLembrete: string | null;
  /** Texto opcional com {Campo}, {categoria}, {data}, {hora}, {antecedencia} */
  modeloTexto: string | null;
  /** HH:MM usado quando o memo não tem horário */
  horarioPadrao: string;
  /** Memos da importação em lote geram lembrete quando o memo não diz nada */
  lembrarImportados: boolean;
  /** De quantos em quantos minutos o robô verifica esta regra */
  intervaloMin: number;
  ultimaExecucao: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LembreteRegraInput = Omit<LembreteRegra, "id" | "categoryId" | "origem" | "ultimaExecucao" | "createdAt" | "updatedAt">;

/** Item da prévia: lembrete que será (ou já foi) enviado para um memo. */
export interface LembretePreviaItem {
  memoId: number;
  /** Data/hora do compromisso, ISO */
  momentoAlvo: string;
  antecedenciaMin: number;
  /** Quando o lembrete sai (momentoAlvo − antecedência), ISO */
  enviarEm: string;
  destinatarios: string[];
  situacao: "agendado" | "enviado" | "ignorado";
  observacao: string | null;
  resumo: string;
}

export interface LembretePreviaResponse {
  itens: LembretePreviaItem[];
  /** Memos da categoria cuja data não pôde ser lida */
  semDataReconhecida: number;
}

export const LEMBRETE_ANTECEDENCIAS_OPCOES: { min: number; rotulo: string }[] = [
  { min: 15, rotulo: "15 min" },
  { min: 30, rotulo: "30 min" },
  { min: 60, rotulo: "1 hora" },
  { min: 120, rotulo: "2 horas" },
  { min: 1440, rotulo: "1 dia" },
  { min: 2880, rotulo: "2 dias" },
  { min: 10080, rotulo: "1 semana" },
];

export const LEMBRETE_INTERVALOS_MIN = [5, 15, 30, 60] as const;

/** "1 dia e 1 hora", "30 min" — para e-mail e tela. */
export function formatarAntecedencia(min: number): string {
  const partes: string[] = [];
  let resto = Math.max(0, Math.round(min));
  const semanas = Math.floor(resto / 10080);
  if (semanas) { partes.push(`${semanas} semana${semanas > 1 ? "s" : ""}`); resto -= semanas * 10080; }
  const dias = Math.floor(resto / 1440);
  if (dias) { partes.push(`${dias} dia${dias > 1 ? "s" : ""}`); resto -= dias * 1440; }
  const horas = Math.floor(resto / 60);
  if (horas) { partes.push(`${horas} hora${horas > 1 ? "s" : ""}`); resto -= horas * 60; }
  if (resto) partes.push(`${resto} min`);
  return partes.length ? partes.join(" e ") : "na hora";
}
