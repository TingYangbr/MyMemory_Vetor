/**
 * Controle financeiro — núcleo (docs/desenho-controle-financeiro-promemory.md, seção 13).
 * Motor puro, sem banco: ocorrências de recorrência e parcelas. Reaproveitável no Softing-erp.
 * Datas sempre como texto 'AAAA-MM-DD' (sem fuso).
 */

export type FinTipoConta =
  | "banco"
  | "cartao"
  | "corretora"
  | "investimento"
  | "despesa"
  | "receita"
  | "a_receber"
  | "a_pagar"
  | "patrimonio";

export const FIN_TIPOS_CONTA: { tipo: FinTipoConta; rotulo: string; manual: boolean }[] = [
  { tipo: "banco", rotulo: "Conta bancária / dinheiro", manual: true },
  { tipo: "cartao", rotulo: "Cartão de crédito", manual: true },
  { tipo: "corretora", rotulo: "Caixa da corretora", manual: true },
  { tipo: "investimento", rotulo: "Investimento (papel)", manual: true },
  { tipo: "despesa", rotulo: "Grupo de despesa", manual: true },
  { tipo: "receita", rotulo: "Grupo de receita", manual: true },
  { tipo: "a_receber", rotulo: "Contas a receber", manual: false },
  { tipo: "a_pagar", rotulo: "Contas a pagar", manual: false },
  { tipo: "patrimonio", rotulo: "Saldo inicial", manual: false },
];

/** Contas criadas pelo sistema em cada espaço (escondidas na pessoa física). */
export type FinChaveSistema =
  | "a_receber"
  | "a_pagar"
  | "saldo_inicial"
  | "juros_pagos"
  | "juros_recebidos"
  | "descontos_obtidos"
  | "descontos_concedidos"
  | "ganho_capital"
  | "perda_capital";

export const FIN_CONTAS_SISTEMA: Record<FinChaveSistema, { nome: string; tipo: FinTipoConta }> = {
  a_receber: { nome: "Contas a receber", tipo: "a_receber" },
  a_pagar: { nome: "Contas a pagar", tipo: "a_pagar" },
  saldo_inicial: { nome: "Saldo inicial", tipo: "patrimonio" },
  juros_pagos: { nome: "Juros e multas pagos", tipo: "despesa" },
  juros_recebidos: { nome: "Juros e multas recebidos", tipo: "receita" },
  descontos_obtidos: { nome: "Descontos obtidos", tipo: "receita" },
  descontos_concedidos: { nome: "Descontos concedidos", tipo: "despesa" },
  ganho_capital: { nome: "Ganho na venda de investimentos", tipo: "receita" },
  perda_capital: { nome: "Perda na venda de investimentos", tipo: "despesa" },
};

/** Contas em que o saldo é "quanto tenho" (entradas − saídas). As demais: "quanto devo" ou total do período. */
export function finContaEhAtivo(tipo: FinTipoConta): boolean {
  return tipo === "banco" || tipo === "corretora" || tipo === "investimento" || tipo === "a_receber";
}

export type FinPeriodicidade = "semanal" | "quinzenal" | "mensal" | "bimestral" | "trimestral" | "semestral" | "anual";

export const FIN_PERIODICIDADES: { valor: FinPeriodicidade; rotulo: string }[] = [
  { valor: "semanal", rotulo: "Semanal" },
  { valor: "quinzenal", rotulo: "Quinzenal (14 dias)" },
  { valor: "mensal", rotulo: "Mensal" },
  { valor: "bimestral", rotulo: "Bimestral" },
  { valor: "trimestral", rotulo: "Trimestral" },
  { valor: "semestral", rotulo: "Semestral" },
  { valor: "anual", rotulo: "Anual" },
];

const MESES_POR: Partial<Record<FinPeriodicidade, number>> = {
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};
const DIAS_POR: Partial<Record<FinPeriodicidade, number>> = { semanal: 7, quinzenal: 14 };

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function finDataValida(s: string): boolean {
  const m = RE_DATA.exec(s);
  if (!m) return false;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return me >= 1 && me <= 12 && d >= 1 && d <= ultimoDiaDoMes(a, me);
}

function partes(s: string): [number, number, number] {
  const m = RE_DATA.exec(s);
  if (!m) throw new Error(`data_invalida: ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function fmt(a: number, m: number, d: number): string {
  return `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function ultimoDiaDoMes(a: number, m: number): number {
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Soma meses mantendo o dia de origem; dia 31 em mês curto vira o último dia do mês. */
export function finSomarMeses(data: string, meses: number, diaOrigem?: number): string {
  const [a, m, d] = partes(data);
  const total = a * 12 + (m - 1) + meses;
  const na = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const dia = Math.min(diaOrigem ?? d, ultimoDiaDoMes(na, nm));
  return fmt(na, nm, dia);
}

export function finSomarDias(data: string, dias: number): string {
  const [a, m, d] = partes(data);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** n-ésima ocorrência (0 = a própria data de início). */
export function finOcorrenciaN(inicio: string, periodicidade: FinPeriodicidade, n: number): string {
  const meses = MESES_POR[periodicidade];
  if (meses != null) return finSomarMeses(inicio, meses * n, partes(inicio)[2]);
  return finSomarDias(inicio, (DIAS_POR[periodicidade] ?? 30) * n);
}

export interface FinRegraRecorrencia {
  inicio: string;
  fim: string | null;
  periodicidade: FinPeriodicidade;
}

/**
 * Datas de referência (vencimentos) da regra dentro de [de, ate], inclusive.
 * A referência é a identidade da ocorrência: o título nascido dela guarda essa data,
 * mesmo que o pagamento aconteça em outro dia.
 */
export function finOcorrencias(regra: FinRegraRecorrencia, de: string, ate: string, limite = 1000): string[] {
  const out: string[] = [];
  const fimEfetivo = regra.fim && regra.fim < ate ? regra.fim : ate;
  for (let n = 0; n < 100_000 && out.length < limite; n++) {
    const d = finOcorrenciaN(regra.inicio, regra.periodicidade, n);
    if (d > fimEfetivo) break;
    if (d >= de) out.push(d);
  }
  return out;
}

export interface FinParcela {
  parcela: number;
  vencimento: string;
  valor: number;
}

/** Divide em centavos; a diferença do arredondamento fica na 1ª parcela. */
export function finGerarParcelas(
  valorTotal: number,
  parcelas: number,
  primeiroVencimento: string,
  periodicidade: FinPeriodicidade = "mensal"
): FinParcela[] {
  const centavos = Math.round(valorTotal * 100);
  const n = Math.max(1, Math.floor(parcelas));
  const base = Math.floor(centavos / n);
  const resto = centavos - base * n;
  return Array.from({ length: n }, (_, i) => ({
    parcela: i + 1,
    vencimento: finOcorrenciaN(primeiroVencimento, periodicidade, i),
    valor: (base + (i === 0 ? resto : 0)) / 100,
  }));
}

/* ---------- Tipos da API ---------- */

export interface FinConta {
  id: number;
  nome: string;
  tipo: FinTipoConta;
  chave: FinChaveSistema | null;
  papel: string | null;
  corretoraContaId: number | null;
  ativo: boolean;
}

export interface FinContaSaldo extends FinConta {
  /** Banco/investimento/a receber: quanto tem. Cartão/a pagar: quanto deve. Despesa/receita: total do período. */
  saldo: number;
  quantidade: number | null;
  custoMedio: number | null;
}

export interface FinRecorrencia {
  id: number;
  sentido: "pagar" | "receber";
  descricao: string;
  valor: number;
  periodicidade: FinPeriodicidade;
  inicio: string;
  fim: string | null;
  contaGrupoId: number;
  contaGrupoNome: string;
  contaPagamentoId: number | null;
  ativo: boolean;
}

export type FinSituacaoAgenda = "previsto" | "confirmado" | "atraso" | "pago";

export interface FinItemAgenda {
  /** "t:<id>" para título, "r:<recorrenciaId>:<referencia>" para ocorrência ainda sem título. */
  chave: string;
  origem: "titulo" | "recorrencia";
  situacao: FinSituacaoAgenda;
  sentido: "pagar" | "receber";
  descricao: string;
  vencimento: string;
  valor: number;
  contaGrupoNome: string | null;
  tituloId: number | null;
  recorrenciaId: number | null;
  referencia: string | null;
  parcela: number | null;
  parcelas: number | null;
  lote: string | null;
  quitadoEm: string | null;
  valorPago: number | null;
  contaPagamentoId: number | null;
}

export interface FinAgendaResposta {
  de: string;
  ate: string;
  hoje: string;
  itens: FinItemAgenda[];
  totais: {
    pagarPrevisto: number;
    receberPrevisto: number;
    pagarAtraso: number;
    receberAtraso: number;
    pago: number;
    recebido: number;
  };
}

export interface FinLancamento {
  id: number;
  data: string;
  descricao: string;
  valor: number;
  contaOrigemId: number;
  contaOrigemNome: string;
  contaDestinoId: number;
  contaDestinoNome: string;
  quantidade: number | null;
  preco: number | null;
  tituloId: number | null;
}

export interface FinConferencia {
  aReceberSaldo: number;
  aReceberTitulos: number;
  aPagarSaldo: number;
  aPagarTitulos: number;
  ok: boolean;
}
