/**
 * Exemplos do Fale comigo (botão 💡 Exemplos): frases prontas por categoria modelo. Só aparecem as das categorias
 * habilitadas no grupo (comparadas pelo nome). A primeira frase de cada categoria é a "principal" (vista sem abrir
 * "Ver mais"). Categoria criada pelo grupo, sem frases aqui, não entra.
 */
export interface ExemplosCategoria {
  /** Rótulo curto mostrado acima das frases. */
  titulo: string;
  /** A categoria do grupo combina pelo nome (sem acento, minúsculo). */
  combina: (nomeNormalizado: string) => boolean;
  frases: string[];
}

const normalizar = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().trim();

export const EXEMPLOS_FALE_COMIGO: ExemplosCategoria[] = [
  {
    titulo: "Finanças – gastos",
    combina: (n) => n.startsWith("financas pessoais") && n.includes("gastos"),
    frases: [
      "Gastei 85 no mercado no Itaú",
      "Quanto gastei com mercado este mês?",
      "Comprei uma TV de 3.000 em 10x no Itaú",
      "Transferi 2 mil do Itaú para a poupança",
      "Qual o % de cada grupo nos meus gastos do mês?",
      "Quanto gastei em novembro comparado com outubro?",
    ],
  },
  {
    titulo: "Finanças – a pagar e receber",
    combina: (n) => n.startsWith("financas pessoais") && n.includes("pagar"),
    frases: [
      "O que tenho para pagar esta semana?",
      "Conta de luz de 180 todo dia 10",
      "Paguei a conta de luz",
      "Quanto devo no cartão?",
      "Qual o valor da fatura de dezembro?",
    ],
  },
  {
    titulo: "Finanças – saldos e investimentos",
    combina: (n) => n.startsWith("financas pessoais") && (n.includes("saldo") || n.includes("invest")),
    frases: [
      "Quanto valem minhas ações hoje?",
      "Comprei 100 ações da PETR4 a 38,50",
      "Recebi 120 de dividendos da ITSA4",
      "Qual a cotação da CYRE3?",
      "Quanto recebi de dividendos em 2026?",
      "Qual meu saldo em cada conta?",
    ],
  },
  {
    titulo: "Agenda",
    combina: (n) => n.startsWith("agenda"),
    frases: [
      "Marcar reunião com Carlos sexta às 15h por 1 hora",
      "Adiar reunião com Carlos para as 16h",
      "Qual minha agenda amanhã?",
      "Ligar para o contador segunda às 9h",
    ],
  },
  {
    titulo: "Lista de compras",
    combina: (n) => n.includes("lista") || n.includes("compras"),
    frases: [
      "Incluir 2 kg de feijão e leite na lista",
      "Comprei o feijão",
      "Repete a última lista de compras",
      "O que falta comprar?",
    ],
  },
  {
    titulo: "Antropometria",
    combina: (n) => n.startsWith("antropometr"),
    frases: [
      "Peso 80,6 kg, IMC 26,1, gordura 28%, visceral 9",
      "Como evoluiu meu peso nos últimos 30 dias?",
      "Quanto perdi de peso desde o começo do mês?",
    ],
  },
];

/** Exemplos das categorias habilitadas (na ordem acima; cada grupo de exemplos aparece uma vez). */
export function exemplosDasCategorias(nomesCategorias: string[]): ExemplosCategoria[] {
  const nomes = nomesCategorias.map(normalizar);
  return EXEMPLOS_FALE_COMIGO.filter((ex) => nomes.some((n) => ex.combina(n)));
}
