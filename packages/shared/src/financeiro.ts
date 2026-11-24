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
  | "perda_capital"
  | "ganho_cambial"
  | "perda_cambial";

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
  ganho_cambial: { nome: "Ganho cambial", tipo: "receita" },
  perda_cambial: { nome: "Perda cambial", tipo: "despesa" },
};

/** Moedas com cotação PTAX do Banco Central. O livro fecha em reais; contas em outra moeda guardam também o valor na moeda. */
export const FIN_MOEDAS: { codigo: string; rotulo: string }[] = [
  { codigo: "BRL", rotulo: "Real" },
  { codigo: "USD", rotulo: "Dólar americano" },
  { codigo: "EUR", rotulo: "Euro" },
  { codigo: "GBP", rotulo: "Libra esterlina" },
  { codigo: "CHF", rotulo: "Franco suíço" },
  { codigo: "CAD", rotulo: "Dólar canadense" },
  { codigo: "AUD", rotulo: "Dólar australiano" },
  { codigo: "JPY", rotulo: "Iene" },
];
export const FIN_MOEDA_CODIGOS = FIN_MOEDAS.map((m) => m.codigo);

export type FinMercado = "local" | "exterior";
export const finMercadoPadrao = (moeda: string): FinMercado => (moeda === "BRL" ? "local" : "exterior");

/** Tipos que representam dinheiro ou bens (não grupos de resultado). */
export function finContaEhDinheiro(tipo: FinTipoConta): boolean {
  return tipo === "banco" || tipo === "corretora" || tipo === "cartao" || tipo === "investimento";
}

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
  moeda: string;
  /** Banco, corretora, cartão e investimento: Brasil ou exterior (BDR é local em reais; Avenue é exterior). */
  mercado: FinMercado | null;
  ativo: boolean;
  /** Cartão: dia do fechamento e do vencimento da fatura (sem eles, o cartão não tem fatura). */
  diaFechamento?: number | null;
  diaVencimento?: number | null;
}

export interface FinContaSaldo extends FinConta {
  /** Banco/investimento/a receber: quanto tem. Cartão/a pagar: quanto deve. Despesa/receita: total do período. */
  saldo: number;
  quantidade: number | null;
  custoMedio: number | null;
  /** Só contas em outra moeda: saldo na moeda, custo médio na moeda (investimento) e valor hoje pela cotação. */
  saldoMoeda: number | null;
  custoMedioMoeda: number | null;
  cotacao: { data: string; valor: number } | null;
  valorHoje: number | null;
  /** Papel da B3 em reais: preço atual (brapi ou digitado), valor de mercado e resultado não realizado. */
  precoAtual?: { preco: number; em: string; fonte: "brapi" | "manual" } | null;
  valorMercado?: number | null;
  resultadoNaoRealizado?: number | null;
  /** Proventos recebidos nos últimos 12 meses (dividendos, JCP, rendimentos). */
  proventos12m?: number | null;
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
  /** "t:<id>" título, "r:<recorrenciaId>:<referencia>" ocorrência sem título, "f:<cartaoId>:<vencimento>" fatura. */
  chave: string;
  origem: "titulo" | "recorrencia" | "fatura";
  /** Fatura: o cartão. */
  cartaoId?: number | null;
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

/** O que uma recorrência já gerou (títulos pagos/abertos) e os próximos vencimentos previstos. */
export interface FinOcorrenciasRecorrencia {
  descricao: string;
  sentido: "pagar" | "receber";
  itens: {
    referencia: string;
    valor: number;
    /** pago = virou título quitado; aberto = título gravado em aberto; atraso/previsto = ainda só previsão; pulado = exceção. */
    situacao: "pago" | "aberto" | "atraso" | "previsto" | "pulado";
    quitadoEm: string | null;
    valorPago: number | null;
    contaPagamento: string | null;
    tituloId: number | null;
    /** Valor diferente do da regra neste mês (exceção). */
    excecao: boolean;
  }[];
  pago: number;
}

/** Histórico de um título: o original, os saldos de pagamento parcial e todos os lançamentos feitos sobre eles. */
export interface FinHistoricoTitulo {
  sentido: "pagar" | "receber";
  descricao: string;
  grupo: string | null;
  /** Valor do título antes dos pagamentos parciais (soma da cadeia original + saldos). */
  valorOriginal: number;
  pago: number;
  emAberto: number;
  titulos: {
    id: number;
    descricao: string;
    valor: number;
    vencimento: string;
    situacao: "aberto" | "quitado";
    quitadoEm: string | null;
    valorPago: number | null;
    contaPagamento: string | null;
    parcela: number | null;
    parcelas: number | null;
    /** Título de onde este saldo nasceu (pagamento parcial). */
    saldoDe: number | null;
    memoId: number | null;
  }[];
  lancamentos: {
    id: number;
    data: string;
    descricao: string;
    valor: number;
    saiuDe: string;
    foiPara: string;
    /** registro = nascimento da compra/venda a prazo (todas as parcelas); os demais vêm do pagamento. */
    tipo: "registro" | "pagamento" | "excedente" | "juros" | "desconto";
    tituloId: number | null;
    memoId: number | null;
  }[];
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
  valorMoeda: number | null;
  moeda: string | null;
  cotacao: number | null;
  /** Registro da compra/venda a prazo (despesa/receita contra Contas a pagar/receber): não é movimento de dinheiro. */
  registro?: boolean;
  /** Lançamento de cartão: vencimento da fatura em que caiu. */
  fatura?: string | null;
  /** Conferido com o extrato do banco (veio de um extrato ou foi ligado a uma linha dele). */
  conferido?: boolean;
}

/** O que fazer com uma linha do extrato. */
export type FinExtratoAcao = "ligar" | "baixar" | "novo" | "ignorar";

export interface FinExtratoItem {
  /** Identificação da linha no banco (FITID do OFX). */
  fitid: string;
  data: string;
  /** Com sinal: negativo = saiu da conta; positivo = entrou. */
  valor: number;
  descricao: string;
  /** importado/ignorado: já tratado antes; existe: já lançado (liga); baixa: paga uma conta em aberto; novo: lançar. */
  situacao: "importado" | "ignorado" | "existe" | "baixa" | "novo";
  lancamentoId?: number | null;
  lancamentoDescricao?: string | null;
  alvoChave?: string | null;
  alvoDescricao?: string | null;
  /** Sugestão para "novo": grupo ou conta do outro lado (pelo histórico da mesma descrição). */
  contraContaId?: number | null;
}

export interface FinExtratoPrevia {
  contaId: number;
  conta: string;
  inicio: string | null;
  fim: string | null;
  /** Saldo final informado pelo banco no arquivo, e o calculado pelo proMemory na mesma data. */
  saldoBanco: number | null;
  saldoEm: string | null;
  saldoSistema: number | null;
  itens: FinExtratoItem[];
}

export interface FinExtratoDecisao {
  fitid: string;
  data: string;
  valor: number;
  descricao: string;
  acao: FinExtratoAcao;
  lancamentoId?: number | null;
  alvoChave?: string | null;
  contraContaId?: number | null;
}

/** Uma fatura de cartão: as compras, estornos e pagamentos dela. */
export interface FinFatura {
  cartaoId: number;
  cartao: string;
  /** Vencimento (identifica a fatura). */
  vencimento: string;
  fechamento: string | null;
  compras: number;
  /** Saldo que veio da fatura anterior (positivo = dívida; negativo = crédito). */
  anterior: number;
  pago: number;
  emAberto: number;
  itens: {
    id: number;
    data: string;
    descricao: string;
    valor: number;
    /** compra: entra na fatura; estorno: abate; pagamento: quita. */
    tipo: "compra" | "estorno" | "pagamento";
    contraparte: string;
    /** Mudada de fatura à mão. */
    manual: boolean;
  }[];
}

export interface FinConferencia {
  aReceberSaldo: number;
  aReceberTitulos: number;
  aPagarSaldo: number;
  aPagarTitulos: number;
  ok: boolean;
}

/** Fale comigo → financeiro (etapa 2b): o que o comando quer gravar. */
export type FinComandoTipo = "gasto" | "receita" | "conta" | "fixa" | "pagamento" | "compra" | "venda" | "transferencia" | "provento" | "cambio";

export type FinTipoProvento = "dividendo" | "jcp" | "rendimento" | "juros";

/** Papel já cadastrado no espaço (conta de investimento), com a posição de hoje. */
export interface FinPapelOpcao {
  id: number;
  ticker: string;
  corretoraId: number | null;
  corretoraNome: string | null;
  quantidade: number;
  custoMedio: number | null;
  moeda: string;
  /** Preço atual (brapi ou digitado) e quando, para mostrar no card. */
  precoAtual?: { preco: number; em: string; fonte: "brapi" | "manual" } | null;
}

/** Compra/venda de papel no cartão do Fale comigo. A corretora é o contaId da proposta. */
export interface FinComandoInvestimento {
  /** Conta do papel quando já existe nesta corretora; senão o ticker (cadastrado ao gravar a compra). */
  papelContaId: number | null;
  ticker: string | null;
  quantidade: number | null;
  preco: number | null;
  taxas: number | null;
  /** Preço atual do papel (inclusive de papel novo, pelo ticker), só para mostrar. */
  precoAtual?: { preco: number; em: string; fonte: "brapi" | "manual" } | null;
}

/**
 * Proposta montada pela IA a partir da frase ("gastei 80 no mercado no Nubank", "conta de luz de 300 vence dia 10",
 * "aluguel de 2.500 todo dia 5", "paguei o aluguel"). A tela mostra num cartão editável e só grava ao confirmar,
 * pelas mesmas rotas da tela Contas a pagar e receber.
 */
/** Ajustes do Fale comigo → financeiro, por espaço (grupo ou pessoal). */
export interface FinConfig {
  /** Grava sem pedir confirmação quando todos os campos obrigatórios vierem identificados, sem dúvida. */
  gravarDireto: boolean;
  /** O cartão mostra "+ novo" ao lado do grupo de despesa/receita, para cadastrar na hora. */
  criarGrupo: boolean;
  /** O cartão mostra "+ nova" ao lado da conta/cartão, para cadastrar na hora. */
  criarConta: boolean;
  /** Lembrete de vencimento: no sino e por e-mail (contas a pagar/receber, faturas, recorrentes). */
  lembreteAtivo: boolean;
  /** Quantos dias antes do vencimento avisar (0 = no dia). Ex.: [3, 0]. */
  lembreteDias: number[];
  /** Manda e-mail (de manhã) além do sino. */
  lembreteEmail: boolean;
  /** No grupo, quem recebe (sino e e-mail): o dono, todos os membros ou os escolhidos. No pessoal, sempre o próprio. */
  lembreteQuem: "dono" | "membros" | "escolhidos";
  /** Membros escolhidos (ids), quando lembreteQuem = "escolhidos". */
  lembreteMembros: number[];
  /** E-mails a mais, separados por vírgula (só e-mail). */
  lembreteEmails: string;
}

export interface FinConfigResposta extends FinConfig {
  /** Pode mudar os ajustes (dono do grupo, admin, ou o próprio usuário no espaço pessoal). */
  podeEditar: boolean;
  /** No grupo: os membros, para escolher quem recebe o lembrete. */
  membros?: { id: number; nome: string; email: string | null; dono: boolean }[];
}

export type FinComandoDesfazer =
  | { tipo: "lote"; lote: string }
  | { tipo: "recorrencia"; id: number }
  | { tipo: "baixa"; tituloId: number }
  | { tipo: "lancamento"; id: number }
  | { tipo: "operacao"; id: number }
  | null;

export interface FinComandoGravado {
  mensagem: string;
  desfazer: FinComandoDesfazer;
}

export interface FinComandoProposta {
  tipo: FinComandoTipo;
  sentido: "pagar" | "receber";
  descricao: string;
  valor: number | null;
  /** Data do gasto/receita/pagamento, ou o (primeiro) vencimento da conta/fixa. AAAA-MM-DD. */
  data: string;
  /** Conta a pagar/receber: 1 = à vista; 2+ = parcelado. */
  parcelas: number;
  periodicidade: FinPeriodicidade;
  /** Banco, cartão ou corretora (de onde sai / para onde entra). */
  contaId: number | null;
  /** Grupo de despesa ou de receita. */
  grupoId: number | null;
  /** Transferência: para onde vai (contaId = de onde sai). */
  contaDestinoId?: number | null;
  /** Provento: tipo e, no JCP, o valor bruto (antes do IR retido), se dito. */
  provento?: { tipo: FinTipoProvento; valorBruto: number | null } | null;
  /**
   * Câmbio (contaId → contaDestinoId, uma em reais e a outra em moeda): valor = reais (sem o IOF), valorMoeda = quantia
   * na moeda, cotação se dita, IOF/tarifa em reais (na compra soma ao custo da moeda; na venda sai do que entrou).
   */
  cambio?: { valorMoeda: number | null; cotacao: number | null; iof: number | null } | null;
  /** Pagamento: item em aberto da agenda ("t:<id>" ou "r:<recorrenciaId>:<referencia>"). */
  alvoChave: string | null;
  /** Compra/venda de papel (contaId = corretora; valor = valor total, se dito). */
  investimento?: FinComandoInvestimento | null;
  mensagem: string;
  /** Ajustes do Fale comigo neste espaço (gravar direto, criar grupo/conta pelo cartão). */
  config: FinConfig;
  /** Já gravado direto (cartão completo e "gravar direto" ligado): o cartão abre no estado gravado. */
  gravado?: FinComandoGravado | null;
  opcoes: {
    /** moeda e custo médio em reais por unidade (contas em moeda), para o câmbio. */
    contas: { id: number; nome: string; tipo: FinTipoConta; moeda?: string; custoMedio?: number | null }[];
    gruposDespesa: { id: number; nome: string }[];
    gruposReceita: { id: number; nome: string }[];
    abertos: { chave: string; descricao: string; vencimento: string; valor: number; sentido: "pagar" | "receber"; atrasado: boolean; grupo?: string | null }[];
    papeis?: FinPapelOpcao[];
  };
}
