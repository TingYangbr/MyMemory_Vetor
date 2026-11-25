/**
 * Fale comigo → financeiro (etapa 2b). A IA lê a frase junto com as contas, os grupos e o que está em aberto no
 * espaço e devolve UMA proposta (gasto, receita, conta a pagar/receber, conta fixa ou pagamento de algo em aberto).
 * Nada é gravado aqui: a tela mostra a proposta num cartão editável e grava pelas rotas /api/fin/* ao confirmar.
 * A IA só escolhe entre ids que existem; o que ela não souber fica vazio para a pessoa escolher no cartão.
 */
import { precosPapeis } from "./finCotacaoPapelService.js";
import type { FinComandoGravado, FinComandoProposta, FinComandoTipo, FinPapelOpcao, FinPeriodicidade } from "@mymemory/shared";
import { FIN_PERIODICIDADES } from "@mymemory/shared";
import { invokeLLM } from "../lib/invokeLlm.js";
import {
  agenda,
  baixar,
  criarLancamento,
  criarParcelado,
  criarRecorrencia,
  hojeSaoPaulo,
  listarContasComSaldo,
  ultimoLancamentoId,
  type Espaco,
  ocorrenciaNoMes,
  pagarFatura,
  parceladoNoCartao,
} from "./financeiroService.js";
import { obterFinConfig } from "./finConfigService.js";
import { normalizarTicker, registrarOperacaoInvestimento, registrarPosicaoInicial, registrarProvento } from "./finInvestimentosService.js";

const TIPOS: FinComandoTipo[] = ["gasto", "receita", "conta", "fixa", "pagamento", "compra", "venda", "transferencia", "provento", "cambio", "posicao"];
const qtdBr = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
const PERIODICIDADES = FIN_PERIODICIDADES.map((p) => p.valor);

const somarDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function safeJson(text: string): Record<string, unknown> {
  try {
    const t = text.trim();
    const i = t.indexOf("{");
    const k = t.lastIndexOf("}");
    return JSON.parse(i >= 0 && k > i ? t.slice(i, k + 1) : t) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "um", "uma", "os", "as", "ao", "por", "com", "para", "pra", "pro", "dia", "mil", "reais"]);
const palavras = (t: string) =>
  new Set(
    t
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      // 2 letras contam ("XP", "BB", "C6"); preposições e artigos, não
      .filter((w) => w.length >= 2 && !PALAVRAS_VAZIAS.has(w))
  );

/**
 * A IA escolheu um grupo/conta, mas a frase só cita uma palavra que outros também têm ("condomínio" com
 * "Condomínio Granja" e "Condomínio Butantã")? Então é ambíguo: devolve os nomes para a pessoa escolher no cartão.
 * Se a frase tem uma palavra só do escolhido ("Granja"), a escolha vale.
 */
function escolhaAmbigua(id: number | null, lista: { id: number; nome: string }[], frase: string): string[] | null {
  if (id == null) return null;
  const esc = lista.find((x) => x.id === id);
  if (!esc) return null;
  const f = palavras(frase);
  const citadas = [...palavras(esc.nome)].filter((w) => f.has(w));
  if (!citadas.length) return null;
  // Rival só quando tem TODAS as palavras do escolhido que a frase cita: "Conta Itau" dito inteiro não é ambíguo
  // com "Conta XP" nem com "Cartão Itau"; "condomínio" sozinho é com "Condomínio Granja" e "Condomínio Butantã".
  const rivais = lista.filter((x) => x.id !== id && citadas.every((w) => palavras(x.nome).has(w)));
  return rivais.length ? [esc, ...rivais].map((x) => x.nome) : null;
}

export async function montarPropostaFin(input: {
  texto: string;
  userId: number;
  groupId: number | null;
}): Promise<{ proposta: FinComandoProposta; costUsd: number }> {
  const e: Espaco = { groupId: input.groupId, userId: input.userId };
  const hoje = hojeSaoPaulo();
  const contasTodas = (await listarContasComSaldo(e, hoje, hoje)).filter((c) => c.ativo);
  const contas = contasTodas
    .filter((c) => c.tipo === "banco" || c.tipo === "cartao" || c.tipo === "corretora")
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      tipo: c.tipo,
      moeda: c.moeda,
      custoMedio: c.moeda !== "BRL" && c.saldoMoeda && c.saldoMoeda > 0 ? Math.round((c.saldo / c.saldoMoeda) * 1e6) / 1e6 : null,
    }));
  const gruposDespesa = contasTodas.filter((c) => c.tipo === "despesa").map((c) => ({ id: c.id, nome: c.nome }));
  const gruposReceita = contasTodas.filter((c) => c.tipo === "receita").map((c) => ({ id: c.id, nome: c.nome }));
  const nomeConta = new Map(contasTodas.map((c) => [c.id, c.nome]));
  const papeis: FinPapelOpcao[] = contasTodas
    .filter((c) => c.tipo === "investimento")
    .map((c) => ({
      id: c.id,
      ticker: normalizarTicker(c.papel ?? c.nome),
      corretoraId: c.corretoraContaId,
      corretoraNome: c.corretoraContaId != null ? nomeConta.get(c.corretoraContaId) ?? null : null,
      quantidade: Number(c.quantidade ?? 0),
      custoMedio: c.custoMedio ?? null,
      moeda: c.moeda,
      precoAtual: c.precoAtual ?? null,
    }));
  const ag = await agenda(e, somarDias(hoje, -90), somarDias(hoje, 60));
  const abertos = ag.itens
    .filter((i) => i.situacao !== "pago")
    .slice(0, 60)
    .map((i) => ({
      chave: i.chave,
      descricao: i.descricao,
      vencimento: i.vencimento,
      valor: i.valor,
      sentido: i.sentido,
      atrasado: i.situacao === "atraso",
      grupo: i.contaGrupoNome ?? null,
    }));

  const system =
    "Você converte uma frase de controle financeiro pessoal, ou o texto de um documento (boleto, carnê, fatura, contrato, nota), em UMA operação, escolhendo só entre os ids informados. Documento de cobrança = conta a pagar (ou a receber, se for você quem cobra) com o vencimento e as parcelas do documento; descrição = quem cobra e o quê. Recibo ou comprovante de pagamento (\"pagamento confirmado\", \"payment receipt\", \"comprovante\", \"recibo\", \"pago em\") = algo JÁ PAGO: gasto, com data = a data do pagamento e contaId = o cartão/conta usado; só é pagamento se corresponder a um item de em_aberto. Responda só JSON.";
  const user = JSON.stringify(
    {
      frase: input.texto,
      hoje,
      contas_bancos_cartoes: contas,
      grupos_despesa: gruposDespesa,
      grupos_receita: gruposReceita,
      em_aberto: abertos,
      papeis_cadastrados: papeis.map((p) => ({ id: p.id, ticker: p.ticker, corretoraId: p.corretoraId, corretora: p.corretoraNome, quantidade: p.quantidade })),
      tipos: {
        gasto: "despesa já feita (gastei, comprei, paguei algo que não estava em aberto): sai de uma conta/cartão para um grupo de despesa. Compra PARCELADA NO CARTÃO (comprei uma TV de 3.000 em 10x no Nubank) também é gasto: parcelas = 10 e contaId = o cartão (não é conta)",
        receita: "dinheiro recebido que não estava em aberto (recebi, entrou, salário caiu): de um grupo de receita para uma conta",
        conta: "conta a pagar ou a receber futura, única ou parcelada (vence dia 10, em 3x, boleto de…)",
        fixa: "conta que se repete (todo mês, todo dia 5, mensal, semanal, anual) — aluguel, salário, assinatura",
        pagamento: "pagou ou recebeu (passado) algo que JÁ ESTÁ em em_aberto (paguei o aluguel, recebi do Joaquim, paguei a fatura do Itaú = o item 'Fatura <cartão>'). \"Pagamento a fazer\", \"a pagar\", \"vou pagar\" ou data futura NÃO é pagamento: é conta",
        compra: "compra de ação, FII, ETF, BDR ou outro papel (comprei 100 PETR4 a 38,50 na XP): sai da corretora para o papel. NÃO é gasto",
        venda: "venda de papel (vendi 50 ITSA4 a 10,20): sai do papel para a corretora",
        posicao: "posição que a pessoa JÁ TINHA numa data, sem comprar agora (tenho 800 BBDC4 com preço médio 14,25 na Clear em 31/12/2025; minha posição inicial de ITSA4 é 1.000 a 9,80): quantidade + preço médio (em preco); NÃO tira dinheiro da corretora",
        provento: "provento recebido de um papel (recebi 120 de dividendos de PETR4, JCP de ITSA4 de 85, rendimento do HGLG11 de 42): NÃO é receita comum",
        cambio: "compra ou venda de moeda estrangeira entre uma conta em reais e uma em outra moeda (comprei 1.000 dólares a 5,40 na Avenue; mandei 10 mil para a Avenue e chegaram 1.850 dólares; comprei 500 euros em espécie; vendi 500 dólares a 5,60 para o Itaú)",
        transferencia: "dinheiro entre contas suas NA MESMA MOEDA (transferi do Itaú para a XP, mandei para a poupança, apliquei/resgatei na corretora, saque; fatura de cartão é pagamento; reais para dólar é câmbio): sai de uma conta/cartão/corretora e entra em outra. NÃO é gasto nem receita: não tem grupo",
      },
    },
    null,
    2
  );
  const formato = `Retorne {"tipo":"gasto|receita|conta|fixa|pagamento|compra|venda","sentido":"pagar|receber","descricao":"curta, sem o valor","valor":0,"data":"AAAA-MM-DD","parcelas":1,"periodicidade":"${PERIODICIDADES.join("|")}","contaId":null,"grupoId":null,"alvoChave":null,"contaDestinoId":null,"proventoTipo":null,"valorBruto":null,"valorMoeda":null,"cotacao":null,"iof":null,"papelContaId":null,"ticker":null,"quantidade":null,"preco":null,"taxas":null,"contaCitada":null,"grupoCitado":null}
Provento: ticker/papelContaId do papel, valor = o que caiu (líquido), proventoTipo = dividendo|jcp|rendimento|juros (FII = rendimento), valorBruto só se dito (JCP bruto), contaId = a corretora se citada.
Câmbio: contaId = de onde sai, contaDestinoId = para onde vai (uma em reais, outra na moeda; veja "moeda" em contas_bancos_cartoes), valor = reais (o que saiu ou entrou em reais, sem IOF), valorMoeda = quantia na moeda, cotacao se dita, iof em reais se dito.
Transferência: contaId = de onde sai, contaDestinoId = para onde vai (ids de contas_bancos_cartoes), grupoId null.
Compra/venda de papel: contaId = a corretora (conta do tipo corretora citada; "na XP"); papelContaId = id de papeis_cadastrados com esse ticker nessa corretora (senão null e informe ticker, ex.: "Petrobras" = PETR4, "Itaúsa" = ITSA4); quantidade e preco por unidade; valor = valor total só se dito sem preço; taxas só se ditas.
Regras: data = dia do gasto/receita/pagamento, ou o (primeiro) vencimento da conta/fixa; "hoje"/"ontem"/"dia 10" a partir de hoje (dia já passado no mês = mês que vem, para vencimento). Valor em reais, só o número ("2.500" = 2500; "1,5 mil" = 1500). Para pagamento, alvoChave = a chave do item de em_aberto que corresponde (e o valor, se não for dito, o do item); se a frase cita o mês da conta ou a data do pagamento ("o aluguel de setembro", "paguei em 10/09"), escolha o item desse mês; sem mês nem data, o mais antigo em aberto. contaId e grupoId só de ids da lista; sem certeza, null. Cartão citado ("no Nubank", "no cartão") = a conta do tipo cartao com esse nome; citado pelo final ("final 7803", "••••7803") = a conta cujo nome tem esses dígitos (nenhuma ou mais de uma: null). Se a frase servir para mais de um grupo ou conta (ex.: "condomínio" e existem "Condomínio Granja" e "Condomínio Butantã"), use null: a pessoa escolhe.
contaCitada/grupoCitado: quando a frase cita pelo nome um banco, cartão, corretora ou grupo que NÃO está nas listas (ex.: "no Nubank" sem conta Nubank), o nome como foi dito ("Nubank"), e o id fica null. Se o citado existe, ou se nada foi citado, null.`;
  const { text, costUsd } = await invokeLLM({ system, user: `${user}\n\n${formato}`, jsonObject: true, temperature: 0, source: "fin_comando" });
  const j = safeJson(text);

  let tipo: FinComandoTipo = TIPOS.includes(j.tipo as FinComandoTipo) ? (j.tipo as FinComandoTipo) : "gasto";
  // "Conta" paga com cartão de crédito é compra (parcelada) no cartão: entra nas faturas, não é título a pagar
  if (tipo === "conta" && contas.some((c) => c.id === Number(j.contaId) && c.tipo === "cartao")) tipo = "gasto";
  const idValido = (v: unknown, lista: { id: number }[]) => {
    const n = Number(v);
    return Number.isFinite(n) && lista.some((x) => x.id === n) ? n : null;
  };
  let alvo = typeof j.alvoChave === "string" ? abertos.find((a) => a.chave === j.alvoChave) ?? null : null;
  // Pagamento com data citada de outro mês ("paguei o aluguel em 10/09"): a parcela é a do mês informado, como na
  // medição com data (antropometria). Sem data na frase (data = hoje), fica a escolha da IA.
  const dataDita = typeof j.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.data) && j.data !== hoje ? j.data : null;
  if (TIPOS.includes(j.tipo as FinComandoTipo) && j.tipo === "pagamento" && alvo && dataDita && alvo.vencimento.slice(0, 7) !== dataDita.slice(0, 7)) {
    const mes = dataDita.slice(0, 7);
    const m = /^r:(\d+):/.exec(alvo.chave);
    if (m) {
      const oc = await ocorrenciaNoMes(e, Number(m[1]), mes);
      if (oc) {
        const chave = `r:${m[1]}:${oc.referencia}`;
        let item = abertos.find((a) => a.chave === chave);
        if (!item) {
          item = { chave, descricao: oc.descricao, vencimento: oc.referencia, valor: oc.valor, sentido: oc.sentido, atrasado: oc.referencia < hoje, grupo: oc.grupo };
          abertos.unshift(item);
        }
        alvo = item;
      }
    } else {
      // Parcela de título: a do mesmo nome com vencimento no mês informado
      const doMes = abertos.find((a) => a.chave.startsWith("t:") && a.descricao === alvo!.descricao && a.vencimento.slice(0, 7) === mes);
      if (doMes) alvo = doMes;
    }
  }
  // "Pagamento" é baixa de algo que JÁ ESTÁ em aberto. Sem item correspondente (recibo de algo nunca cadastrado,
  // "Payment receipt" do Google Ads), é gasto já pago — ou receita, se for recebimento.
  if (tipo === "pagamento" && !alvo) tipo = j.sentido === "receber" ? "receita" : "gasto";
  const sentido: "pagar" | "receber" =
    tipo === "gasto" || tipo === "compra" ? "pagar" : tipo === "receita" || tipo === "venda" ? "receber" : alvo ? alvo.sentido : j.sentido === "receber" ? "receber" : "pagar";
  const valorBruto = Number(j.valor);
  const valor = Number.isFinite(valorBruto) && valorBruto > 0 ? Math.round(valorBruto * 100) / 100 : alvo?.valor ?? null;
  const data = typeof j.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.data) ? j.data : hoje;
  const parcelas = Math.max(1, Math.min(360, Math.trunc(Number(j.parcelas) || 1)));
  const periodicidade: FinPeriodicidade = PERIODICIDADES.includes(j.periodicidade as FinPeriodicidade)
    ? (j.periodicidade as FinPeriodicidade)
    : "mensal";
  const grupos = sentido === "pagar" ? gruposDespesa : gruposReceita;
  const proposta: FinComandoProposta = {
    tipo,
    sentido,
    descricao: String(j.descricao ?? alvo?.descricao ?? "").trim().slice(0, 200) || (alvo?.descricao ?? "Lançamento"),
    valor,
    data,
    parcelas,
    periodicidade,
    contaId: idValido(j.contaId, contas),
    grupoId: idValido(j.grupoId, grupos),
    alvoChave: tipo === "pagamento" ? alvo?.chave ?? null : null,
    contaDestinoId: tipo === "transferencia" ? idValido(j.contaDestinoId, contas) : null,
    mensagem: "",
    config: await obterFinConfig(e),
    gravado: null,
    opcoes: { contas, gruposDespesa, gruposReceita, abertos, papeis },
  };
  if (tipo === "provento") {
    const tp = ["dividendo", "jcp", "rendimento", "juros"].includes(String(j.proventoTipo)) ? (String(j.proventoTipo) as "dividendo" | "jcp" | "rendimento" | "juros") : "dividendo";
    const bruto = Number(j.valorBruto);
    let papel = papeis.find((p) => p.id === Number(j.papelContaId)) ?? null;
    const ticker = typeof j.ticker === "string" && j.ticker.trim() ? normalizarTicker(j.ticker) : papel?.ticker ?? null;
    if (!papel && ticker) {
      const doTicker = papeis.filter((p) => p.ticker === ticker);
      papel = doTicker.find((p) => p.corretoraId === proposta.contaId) ?? (doTicker.length === 1 ? doTicker[0]! : null);
    }
    proposta.investimento = { papelContaId: papel?.id ?? null, ticker: papel?.ticker ?? ticker, quantidade: null, preco: null, taxas: null };
    proposta.provento = { tipo: tp, valorBruto: Number.isFinite(bruto) && bruto > 0 ? Math.round(bruto * 100) / 100 : null };
    if (papel) proposta.contaId = papel.corretoraId;
    proposta.grupoId = null;
    proposta.descricao = `${{ dividendo: "Dividendos", jcp: "JCP", rendimento: "Rendimentos", juros: "Juros" }[tp]} ${proposta.investimento.ticker ?? ""}`.trim();
  }
  if (tipo === "compra" || tipo === "venda" || tipo === "posicao") {
    // Papel: pelo id escolhido, ou pelo ticker (na corretora citada; sem corretora, a única que tem esse papel)
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    let papel = papeis.find((p) => p.id === Number(j.papelContaId)) ?? null;
    const ticker = typeof j.ticker === "string" && j.ticker.trim() ? normalizarTicker(j.ticker) : papel?.ticker ?? null;
    if (!papel && ticker) {
      const doTicker = papeis.filter((p) => p.ticker === ticker);
      papel = doTicker.find((p) => p.corretoraId === proposta.contaId) ?? (proposta.contaId == null && doTicker.length === 1 ? doTicker[0]! : null);
    }
    if (papel && proposta.contaId == null) proposta.contaId = papel.corretoraId;
    if (papel && proposta.contaId != null && papel.corretoraId !== proposta.contaId) papel = null;
    proposta.investimento = {
      papelContaId: papel?.id ?? null,
      ticker: papel?.ticker ?? ticker,
      quantidade: num(j.quantidade),
      preco: num(j.preco),
      taxas: num(j.taxas),
      precoAtual: papel?.precoAtual ?? null,
    };
    // Papel novo (ainda não está em carteira): busca o preço pelo ticker, só para mostrar no card
    if (!proposta.investimento.precoAtual && proposta.investimento.ticker) {
      const t = proposta.investimento.ticker;
      proposta.investimento.precoAtual = (await precosPapeis([t]).catch(() => new Map())).get(t) ?? null;
    }
    proposta.descricao = `${tipo === "compra" ? "Compra" : tipo === "posicao" ? "Posição inicial" : "Venda"} ${proposta.investimento.ticker ?? ""}`.trim();
    proposta.grupoId = null;
    const v = proposta.investimento;
    if (v.preco != null && v.quantidade != null) proposta.valor = Math.round(v.preco * v.quantidade * 100) / 100;
  }
  // Escolha da IA que a frase não decide: deixa vazio e diz quais combinam
  const duvidas: string[] = [];
  // Citado pelo nome e sem cadastro ("no Nubank" sem conta Nubank): diz que não achou e como resolver
  const citado = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 60) : null);
  const contaCitada = proposta.contaId == null ? citado(j.contaCitada) : null;
  const grupoCitado = proposta.grupoId == null && !["transferencia", "cambio", "compra", "venda", "posicao", "provento"].includes(tipo) ? citado(j.grupoCitado) : null;
  if (contaCitada || grupoCitado) {
    proposta.naoAchados = { conta: contaCitada, grupo: grupoCitado };
    const cfg = proposta.config;
    if (contaCitada) {
      duvidas.push(
        cfg.criarConta
          ? `Não achei a conta "${contaCitada}": escolha uma ou toque em "+ nova conta"`
          : `Não achei a conta "${contaCitada}": escolha uma ou cadastre em Contas a pagar e receber`
      );
    }
    if (grupoCitado) {
      duvidas.push(
        cfg.criarGrupo
          ? `Não achei o grupo "${grupoCitado}": escolha um ou toque em "+ novo grupo"`
          : `Não achei o grupo "${grupoCitado}": escolha um ou cadastre em Contas a pagar e receber`
      );
    }
  }
  const gAmb = escolhaAmbigua(proposta.grupoId, grupos, input.texto);
  if (gAmb) {
    proposta.grupoId = null;
    duvidas.push(`Mais de um grupo combina (${gAmb.join(", ")})`);
  }
  const cAmb = escolhaAmbigua(proposta.contaId, contas, input.texto);
  // Transferência entre moedas diferentes é câmbio
  if (tipo === "transferencia" || tipo === "cambio") {
    const mO = contas.find((c) => c.id === proposta.contaId)?.moeda;
    const mD = contas.find((c) => c.id === proposta.contaDestinoId)?.moeda;
    if (tipo === "transferencia" && mO && mD && mO !== mD) proposta.tipo = "cambio";
  }
  if (proposta.tipo === "cambio") {
    const num = (x: unknown) => {
      const n = Number(x);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    let vm = num(j.valorMoeda);
    const cot = num(j.cotacao);
    let reais = proposta.valor;
    if (reais == null && vm != null && cot != null) reais = Math.round(vm * cot * 100) / 100;
    if (vm == null && reais != null && cot != null) vm = Math.round((reais / cot) * 100) / 100;
    proposta.valor = reais;
    proposta.cambio = { valorMoeda: vm, cotacao: cot, iof: num(j.iof) };
    proposta.grupoId = null;
    if (proposta.contaDestinoId === proposta.contaId) proposta.contaDestinoId = null;
    const dAmb = escolhaAmbigua(proposta.contaDestinoId ?? null, contas, input.texto);
    if (dAmb) {
      proposta.contaDestinoId = null;
      duvidas.push(`Mais de uma conta de destino combina (${dAmb.join(", ")})`);
    }
  }
  if (proposta.tipo === "transferencia") {
    proposta.grupoId = null;
    if (proposta.contaDestinoId === proposta.contaId) proposta.contaDestinoId = null;
    const dAmb = escolhaAmbigua(proposta.contaDestinoId ?? null, contas, input.texto);
    if (dAmb) {
      proposta.contaDestinoId = null;
      duvidas.push(`Mais de uma conta de destino combina (${dAmb.join(", ")})`);
    }
  }
  if (tipo === "venda" && proposta.investimento?.papelContaId && proposta.investimento.quantidade) {
    const pos = papeis.find((p) => p.id === proposta.investimento!.papelContaId)?.quantidade ?? 0;
    if (proposta.investimento.quantidade > pos + 1e-9) duvidas.push(`A posição hoje é ${qtdBr(pos)}: menor que a quantidade vendida`);
  }
  if (cAmb) {
    proposta.contaId = null;
    duvidas.push(`Mais de uma conta combina (${cAmb.join(", ")})`);
  }
  proposta.mensagem = descreverProposta(proposta) + (duvidas.length ? ` ${duvidas.join(". ")}.` : "");
  // "Gravar direto" ligado e nada faltando nem em dúvida: grava já; o cartão abre gravado, com Desfazer
  if (proposta.config.gravarDireto && !duvidas.length && completa(proposta)) {
    try {
      proposta.gravado = await gravarProposta(e, proposta);
      proposta.mensagem = `${proposta.gravado.mensagem} Gravado direto: se algo estiver errado, toque em Desfazer.`;
    } catch (err) {
      proposta.mensagem += ` (Não gravei direto: ${err instanceof Error ? err.message : "erro"}.)`;
    }
  }
  return { proposta, costUsd };
}

/** Todos os campos obrigatórios do tipo vieram identificados. */
function completa(p: FinComandoProposta): boolean {
  switch (p.tipo) {
    case "gasto":
    case "receita":
      return p.valor != null && p.grupoId != null && p.contaId != null;
    case "conta":
    case "fixa":
      return p.valor != null && p.grupoId != null;
    case "transferencia":
      return p.valor != null && p.contaId != null && p.contaDestinoId != null && p.contaId !== p.contaDestinoId;
    case "provento":
      return p.valor != null && !!p.investimento?.papelContaId;
    case "cambio": {
      const o = p.opcoes.contas.find((c) => c.id === p.contaId);
      const d = p.opcoes.contas.find((c) => c.id === p.contaDestinoId);
      return !!o && !!d && o.moeda !== d.moeda && (o.moeda === "BRL" || d.moeda === "BRL") && p.valor != null && p.cambio?.valorMoeda != null;
    }
    case "compra":
    case "venda":
    case "posicao": {
      const i = p.investimento;
      if (!i || p.contaId == null || !i.quantidade || !(i.preco || p.valor)) return false;
      return p.tipo === "venda" ? !!i.papelContaId : !!(i.papelContaId || i.ticker);
    }
    case "pagamento": {
      // Valor diferente do previsto pede decisão (parcial, desconto, excedente): não grava direto
      const a = p.opcoes.abertos.find((x) => x.chave === p.alvoChave);
      // Fatura de cartão: pagar menos é normal (o resto passa para a próxima)
      if (a?.chave.startsWith("f:")) return p.contaId != null;
      return a != null && p.contaId != null && (p.valor == null || Math.abs(p.valor - a.valor) < 0.005);
    }
  }
}

/** Grava a proposta como o cartão gravaria (mesmas funções das rotas /api/fin/*). */
async function gravarProposta(e: Espaco, p: FinComandoProposta): Promise<FinComandoGravado> {
  const v = p.valor ?? 0;
  if (p.tipo === "posicao") {
    const i = p.investimento!;
    const r = await registrarPosicaoInicial(e, {
      papelContaId: i.papelContaId, ticker: i.ticker, corretoraId: p.contaId, data: p.data, quantidade: i.quantidade!,
      precoMedio: i.preco, custoTotal: i.preco ? null : p.valor, origem: "falecomigo",
    });
    return { mensagem: `Posição inicial de ${qtdBr(i.quantidade!)} ${r.ticker} (custo ${brl(r.custo)}) gravada.`, desfazer: { tipo: "operacao", id: r.operacaoId } };
  }
  if (p.tipo === "compra" || p.tipo === "venda") {
    const i = p.investimento!;
    const r = await registrarOperacaoInvestimento(e, {
      operacao: p.tipo,
      papelContaId: i.papelContaId,
      ticker: i.ticker,
      corretoraId: p.contaId!,
      data: p.data,
      quantidade: i.quantidade!,
      preco: i.preco,
      valorTotal: i.preco ? null : p.valor,
      taxas: i.taxas,
      origem: "falecomigo",
    });
    return {
      mensagem: `${p.tipo === "compra" ? "Compra" : "Venda"} de ${qtdBr(i.quantidade!)} ${r.ticker} (${brl(r.valorTotal)}) gravada.`,
      desfazer: { tipo: "operacao", id: r.operacaoId },
    };
  }
  const ehCartao = p.opcoes.contas.some((c) => c.id === p.contaId && c.tipo === "cartao");
  if (p.tipo === "gasto" && ehCartao && p.parcelas > 1) {
    const r = await parceladoNoCartao(e, { cartaoId: p.contaId!, grupoId: p.grupoId!, descricao: p.descricao, valorTotal: v, parcelas: p.parcelas, data: p.data });
    return {
      mensagem: `Compra de ${brl(v)} em ${p.parcelas}x de ${brl(Math.round((v / p.parcelas) * 100) / 100)} no cartão gravada (uma parcela em cada fatura).`,
      desfazer: { tipo: "lancamento", id: r.primeiroId },
    };
  }
  if (p.tipo === "gasto" || p.tipo === "receita") {
    const origem = p.tipo === "gasto" ? p.contaId! : p.grupoId!;
    const destino = p.tipo === "gasto" ? p.grupoId! : p.contaId!;
    await criarLancamento(e, { data: p.data, descricao: p.descricao, valor: v, contaOrigemId: origem, contaDestinoId: destino });
    const id = await ultimoLancamentoId(e, { data: p.data, origem, destino });
    return {
      mensagem: `${p.tipo === "gasto" ? "Gasto" : "Receita"} de ${brl(v)} gravado.`,
      desfazer: id != null ? { tipo: "lancamento", id } : null,
    };
  }
  if (p.tipo === "cambio") {
    const o = p.opcoes.contas.find((c) => c.id === p.contaId)!;
    const iof = p.cambio?.iof ?? 0;
    const compra = o.moeda === "BRL";
    // Compra: o IOF/tarifa soma ao custo da moeda; venda: sai do que entrou em reais
    const reais = Math.round((compra ? v + iof : v - iof) * 100) / 100;
    const r = await criarLancamento(e, {
      data: p.data, descricao: p.descricao, valor: reais, valorMoeda: p.cambio!.valorMoeda!, contaOrigemId: p.contaId!, contaDestinoId: p.contaDestinoId!,
    });
    const id = await ultimoLancamentoId(e, { data: p.data, origem: p.contaId!, destino: p.contaDestinoId! });
    const res = r.resultado != null && Math.abs(r.resultado) >= 0.005 ? ` ${r.resultado > 0 ? "Ganho" : "Perda"} cambial de ${brl(Math.abs(r.resultado))}.` : "";
    return { mensagem: `Câmbio de ${brl(reais)} gravado.${res}`, desfazer: id != null ? { tipo: "lancamento", id } : null };
  }
  if (p.tipo === "provento") {
    const r = await registrarProvento(e, {
      papelContaId: p.investimento!.papelContaId,
      tipo: p.provento?.tipo ?? "dividendo",
      data: p.data,
      valor: v,
      valorBruto: p.provento?.valorBruto ?? null,
      origem: "falecomigo",
    });
    return { mensagem: `${p.descricao} de ${brl(v)} gravado.`, desfazer: { tipo: "operacao", id: r.operacaoId } };
  }
  if (p.tipo === "transferencia") {
    const origem = p.contaId!;
    const destino = p.contaDestinoId!;
    await criarLancamento(e, { data: p.data, descricao: p.descricao, valor: v, contaOrigemId: origem, contaDestinoId: destino });
    const id = await ultimoLancamentoId(e, { data: p.data, origem, destino });
    return { mensagem: `Transferência de ${brl(v)} gravada.`, desfazer: id != null ? { tipo: "lancamento", id } : null };
  }
  if (p.tipo === "conta") {
    const r = await criarParcelado(e, {
      sentido: p.sentido,
      descricao: p.descricao,
      valorTotal: v,
      parcelas: p.parcelas,
      primeiroVencimento: p.data,
      periodicidade: "mensal",
      contaGrupoId: p.grupoId!,
    });
    return { mensagem: `Conta a ${p.sentido} de ${brl(v)}${p.parcelas > 1 ? ` em ${p.parcelas}x` : ""} gravada.`, desfazer: { tipo: "lote", lote: r.lote } };
  }
  if (p.tipo === "fixa") {
    const id = await criarRecorrencia(e, {
      sentido: p.sentido,
      descricao: p.descricao,
      valor: v,
      periodicidade: p.periodicidade,
      inicio: p.data,
      contaGrupoId: p.grupoId!,
      contaPagamentoId: p.contaId,
    });
    return { mensagem: `Conta fixa de ${brl(v)} (${p.periodicidade}) gravada.`, desfazer: { tipo: "recorrencia", id } };
  }
  const a = p.opcoes.abertos.find((x) => x.chave === p.alvoChave)!;
  const partes = a.chave.split(":");
  if (partes[0] === "f") {
    const r = await pagarFatura(e, { cartaoId: Number(partes[1]), vencimento: partes[2], data: p.data, valor: p.valor ?? a.valor, contaPagamentoId: p.contaId! });
    return { mensagem: `Pagamento de ${brl(p.valor ?? a.valor)} da "${a.descricao}" gravado.`, desfazer: { tipo: "lancamento", id: r.id } };
  }
  const corpo = partes[0] === "t" ? { tituloId: Number(partes[1]) } : { recorrenciaId: Number(partes[1]), referencia: partes.slice(2).join(":") };
  const r = await baixar(e, { ...corpo, data: p.data, valorPago: p.valor ?? a.valor, contaPagamentoId: p.contaId! });
  return {
    mensagem: `${a.sentido === "pagar" ? "Pagamento" : "Recebimento"} de "${a.descricao}" gravado.`,
    desfazer: { tipo: "baixa", tituloId: r.tituloId },
  };
}

/** Frase curta do que vai ser gravado (e do que falta escolher no cartão). */
/**
 * Frase curta do cartão: o que será registrado e onde ("O gasto de R$ 80,00 será registrado em Alimentação, saindo do
 * Nubank."). Faltando algo: "Preencha os dados em destaque." (os campos em vermelho no cartão).
 */
export function descreverProposta(p: FinComandoProposta): string {
  const conta = p.opcoes.contas.find((c) => c.id === p.contaId)?.nome;
  const grupo = [...p.opcoes.gruposDespesa, ...p.opcoes.gruposReceita].find((g) => g.id === p.grupoId)?.nome;
  const v = p.valor != null ? ` de ${brl(p.valor)}` : "";
  let falta = p.valor == null && p.tipo !== "pagamento";
  let o = "";
  switch (p.tipo) {
    case "gasto":
      o = `O gasto${v}${p.parcelas > 1 ? ` em ${p.parcelas}x` : ""} será registrado ${grupo ? `em ${grupo}` : "nas despesas"}${conta ? `, saindo de ${conta}` : ""}` +
        (p.parcelas > 1 && p.opcoes.contas.some((c) => c.id === p.contaId && c.tipo === "cartao") ? " (uma parcela em cada fatura)" : "");
      falta ||= !grupo || !conta;
      break;
    case "receita":
      o = `A receita${v} será registrada ${grupo ? `em ${grupo}` : "nas receitas"}${conta ? `, entrando em ${conta}` : ""}`;
      falta ||= !grupo || !conta;
      break;
    case "cambio": {
      const or = p.opcoes.contas.find((c) => c.id === p.contaId);
      const de = p.opcoes.contas.find((c) => c.id === p.contaDestinoId);
      const moeda = or?.moeda && or.moeda !== "BRL" ? or.moeda : de?.moeda ?? "";
      const vm = p.cambio?.valorMoeda;
      const qtd = vm != null && moeda && moeda !== "BRL" ? `${vm.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moeda}` : "a moeda";
      const iof = p.cambio?.iof ?? 0;
      if (or?.moeda === "BRL") {
        const total = p.valor != null ? p.valor + iof : null;
        o = `A compra de ${qtd}${total != null ? ` por ${brl(total)}` : ""}${iof ? ` (IOF/tarifa de ${brl(iof)} incluído no custo)` : ""}` +
          `${total != null && vm ? `, cotação efetiva ${(total / vm).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}` : ""} sairá ${or ? `de ${or.nome}` : ""}${de ? ` para ${de.nome}` : ""}`;
      } else {
        const recebe = p.valor != null ? p.valor - iof : null;
        const ganho = recebe != null && vm && or?.custoMedio ? recebe - vm * or.custoMedio : null;
        o = `A venda de ${qtd}${recebe != null ? ` por ${brl(recebe)}` : ""} sairá ${or ? `de ${or.nome}` : ""}${de ? ` para ${de.nome}` : ""}` +
          (ganho != null ? ` (${ganho >= 0 ? "ganho" : "perda"} cambial estimado de ${brl(Math.abs(ganho))}, pelo custo médio)` : "");
      }
      falta ||= !or || !de || vm == null;
      break;
    }
    case "provento":
      o = `${p.descricao}${v} será registrado${conta ? ` na ${conta}` : ""} (não muda o preço médio)`;
      falta ||= !p.investimento?.papelContaId;
      break;
    case "transferencia": {
      const dest = p.opcoes.contas.find((c) => c.id === p.contaDestinoId)?.nome;
      o = `A transferência${v} sairá ${conta ? `de ${conta}` : "de uma conta"} para ${dest ?? "outra conta"} (não entra em gastos)`;
      falta ||= !conta || !dest;
      break;
    }
    case "conta":
      o = `A conta a ${p.sentido} "${p.descricao}"${v}${p.parcelas > 1 ? ` em ${p.parcelas}x` : ""} será registrada com vencimento em ${dataBr(p.data)}${grupo ? `, em ${grupo}` : ""}`;
      falta ||= !grupo;
      break;
    case "fixa":
      o = `A conta fixa "${p.descricao}"${v} (${p.periodicidade}) será registrada a partir de ${dataBr(p.data)}${grupo ? `, em ${grupo}` : ""}`;
      falta ||= !grupo;
      break;
    case "posicao": {
      const i = p.investimento;
      const qtd = i?.quantidade != null ? `${qtdBr(i.quantidade)} ` : "";
      o = `A posição inicial de ${qtd}${i?.ticker ?? "papel"}${i?.preco != null ? ` a ${brl(i.preco)} (preço médio)` : ""} em ${dataBr(p.data)} será registrada${conta ? ` na ${conta}` : ""}, sem mexer no caixa da corretora`;
      falta = !i?.ticker || !i?.quantidade || (!i?.preco && p.valor == null) || !conta;
      break;
    }
    case "compra":
    case "venda": {
      const i = p.investimento;
      const qtd = i?.quantidade != null ? `${qtdBr(i.quantidade)} ` : "";
      o = `A ${p.tipo} de ${qtd}${i?.ticker ?? "papel"}${i?.preco != null ? ` a ${brl(i.preco)}` : ""} será registrada${conta ? ` na ${conta}` : ""}` +
        (p.tipo === "compra" && i && !i.papelContaId && i.ticker ? " (papel novo nesta corretora: será cadastrado)" : "");
      falta = !i?.ticker || !i?.quantidade || (!i?.preco && p.valor == null) || !conta || (p.tipo === "venda" && !!i?.ticker && !i.papelContaId);
      break;
    }
    case "pagamento": {
      const a = p.opcoes.abertos.find((x) => x.chave === p.alvoChave);
      const nome = p.sentido === "pagar" ? "O pagamento" : "O recebimento";
      o = a
        ? `${nome} de "${a.descricao}"${v} será registrado em ${dataBr(p.data)}${conta ? `, ${p.sentido === "pagar" ? "saindo de" : "entrando em"} ${conta}` : ""}`
        : `${nome}${v} será registrado`;
      falta ||= !a || !conta;
      break;
    }
  }
  return `${o}.${falta ? " Preencha os dados em destaque." : ""}`;
}
