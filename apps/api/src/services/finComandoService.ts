/**
 * Fale comigo → financeiro (etapa 2b). A IA lê a frase junto com as contas, os grupos e o que está em aberto no
 * espaço e devolve UMA proposta (gasto, receita, conta a pagar/receber, conta fixa ou pagamento de algo em aberto).
 * Nada é gravado aqui: a tela mostra a proposta num cartão editável e grava pelas rotas /api/fin/* ao confirmar.
 * A IA só escolhe entre ids que existem; o que ela não souber fica vazio para a pessoa escolher no cartão.
 */
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
} from "./financeiroService.js";
import { obterFinConfig } from "./finConfigService.js";
import { normalizarTicker, registrarOperacaoInvestimento } from "./finInvestimentosService.js";

const TIPOS: FinComandoTipo[] = ["gasto", "receita", "conta", "fixa", "pagamento", "compra", "venda"];
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

const palavras = (t: string) =>
  new Set(
    t
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
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
  const pe = palavras(esc.nome);
  const citadas = [...pe].filter((w) => f.has(w));
  if (!citadas.length) return null;
  const rivais = lista.filter((x) => x.id !== id && citadas.some((w) => palavras(x.nome).has(w)));
  if (!rivais.length) return null;
  const distingue = citadas.some((w) => rivais.every((r) => !palavras(r.nome).has(w)));
  return distingue ? null : [esc, ...rivais].map((x) => x.nome);
}

export async function montarPropostaFin(input: {
  texto: string;
  userId: number;
  groupId: number | null;
}): Promise<{ proposta: FinComandoProposta; costUsd: number }> {
  const e: Espaco = { groupId: input.groupId, userId: input.userId };
  const hoje = hojeSaoPaulo();
  const contasTodas = (await listarContasComSaldo(e, hoje, hoje)).filter((c) => c.ativo);
  const contas = contasTodas.filter((c) => c.tipo === "banco" || c.tipo === "cartao" || c.tipo === "corretora").map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo }));
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
    }));

  const system =
    "Você converte uma frase de controle financeiro pessoal em UMA operação, escolhendo só entre os ids informados. Responda só JSON.";
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
        gasto: "despesa já feita (gastei, comprei, paguei algo que não estava em aberto): sai de uma conta/cartão para um grupo de despesa",
        receita: "dinheiro recebido que não estava em aberto (recebi, entrou, salário caiu): de um grupo de receita para uma conta",
        conta: "conta a pagar ou a receber futura, única ou parcelada (vence dia 10, em 3x, boleto de…)",
        fixa: "conta que se repete (todo mês, todo dia 5, mensal, semanal, anual) — aluguel, salário, assinatura",
        pagamento: "pagou ou recebeu (passado) algo que JÁ ESTÁ em em_aberto (paguei o aluguel, recebi do Joaquim). \"Pagamento a fazer\", \"a pagar\", \"vou pagar\" ou data futura NÃO é pagamento: é conta",
        compra: "compra de ação, FII, ETF, BDR ou outro papel (comprei 100 PETR4 a 38,50 na XP): sai da corretora para o papel. NÃO é gasto",
        venda: "venda de papel (vendi 50 ITSA4 a 10,20): sai do papel para a corretora",
      },
    },
    null,
    2
  );
  const formato = `Retorne {"tipo":"gasto|receita|conta|fixa|pagamento|compra|venda","sentido":"pagar|receber","descricao":"curta, sem o valor","valor":0,"data":"AAAA-MM-DD","parcelas":1,"periodicidade":"${PERIODICIDADES.join("|")}","contaId":null,"grupoId":null,"alvoChave":null,"papelContaId":null,"ticker":null,"quantidade":null,"preco":null,"taxas":null}
Compra/venda de papel: contaId = a corretora (conta do tipo corretora citada; "na XP"); papelContaId = id de papeis_cadastrados com esse ticker nessa corretora (senão null e informe ticker, ex.: "Petrobras" = PETR4, "Itaúsa" = ITSA4); quantidade e preco por unidade; valor = valor total só se dito sem preço; taxas só se ditas.
Regras: data = dia do gasto/receita/pagamento, ou o (primeiro) vencimento da conta/fixa; "hoje"/"ontem"/"dia 10" a partir de hoje (dia já passado no mês = mês que vem, para vencimento). Valor em reais, só o número ("2.500" = 2500; "1,5 mil" = 1500). Para pagamento, alvoChave = a chave do item de em_aberto que corresponde (e o valor, se não for dito, o do item). contaId e grupoId só de ids da lista; sem certeza, null. Cartão citado ("no Nubank", "no cartão") = a conta do tipo cartao com esse nome. Se a frase servir para mais de um grupo ou conta (ex.: "condomínio" e existem "Condomínio Granja" e "Condomínio Butantã"), use null: a pessoa escolhe.`;
  const { text, costUsd } = await invokeLLM({ system, user: `${user}\n\n${formato}`, jsonObject: true, temperature: 0, source: "fin_comando" });
  const j = safeJson(text);

  const tipo: FinComandoTipo = TIPOS.includes(j.tipo as FinComandoTipo) ? (j.tipo as FinComandoTipo) : "gasto";
  const idValido = (v: unknown, lista: { id: number }[]) => {
    const n = Number(v);
    return Number.isFinite(n) && lista.some((x) => x.id === n) ? n : null;
  };
  const alvo = typeof j.alvoChave === "string" ? abertos.find((a) => a.chave === j.alvoChave) ?? null : null;
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
    mensagem: "",
    config: await obterFinConfig(e),
    gravado: null,
    opcoes: { contas, gruposDespesa, gruposReceita, abertos, papeis },
  };
  if (tipo === "compra" || tipo === "venda") {
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
    };
    proposta.descricao = `${tipo === "compra" ? "Compra" : "Venda"} ${proposta.investimento.ticker ?? ""}`.trim();
    proposta.grupoId = null;
    const v = proposta.investimento;
    if (v.preco != null && v.quantidade != null) proposta.valor = Math.round(v.preco * v.quantidade * 100) / 100;
  }
  // Escolha da IA que a frase não decide: deixa vazio e diz quais combinam
  const duvidas: string[] = [];
  const gAmb = escolhaAmbigua(proposta.grupoId, grupos, input.texto);
  if (gAmb) {
    proposta.grupoId = null;
    duvidas.push(`Mais de um grupo combina (${gAmb.join(", ")})`);
  }
  const cAmb = escolhaAmbigua(proposta.contaId, contas, input.texto);
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
    case "compra":
    case "venda": {
      const i = p.investimento;
      if (!i || p.contaId == null || !i.quantidade || !(i.preco || p.valor)) return false;
      return p.tipo === "compra" ? !!(i.papelContaId || i.ticker) : !!i.papelContaId;
    }
    case "pagamento": {
      // Valor diferente do previsto pede decisão (parcial, desconto, excedente): não grava direto
      const a = p.opcoes.abertos.find((x) => x.chave === p.alvoChave);
      return a != null && p.contaId != null && (p.valor == null || Math.abs(p.valor - a.valor) < 0.005);
    }
  }
}

/** Grava a proposta como o cartão gravaria (mesmas funções das rotas /api/fin/*). */
async function gravarProposta(e: Espaco, p: FinComandoProposta): Promise<FinComandoGravado> {
  const v = p.valor ?? 0;
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
  const corpo = partes[0] === "t" ? { tituloId: Number(partes[1]) } : { recorrenciaId: Number(partes[1]), referencia: partes.slice(2).join(":") };
  const r = await baixar(e, { ...corpo, data: p.data, valorPago: p.valor ?? a.valor, contaPagamentoId: p.contaId! });
  return {
    mensagem: `${a.sentido === "pagar" ? "Pagamento" : "Recebimento"} de "${a.descricao}" gravado.`,
    desfazer: { tipo: "baixa", tituloId: r.tituloId },
  };
}

/** Frase curta do que vai ser gravado (e do que falta escolher no cartão). */
export function descreverProposta(p: FinComandoProposta): string {
  const conta = p.opcoes.contas.find((c) => c.id === p.contaId)?.nome;
  const grupo = [...p.opcoes.gruposDespesa, ...p.opcoes.gruposReceita].find((g) => g.id === p.grupoId)?.nome;
  const v = p.valor != null ? brl(p.valor) : "valor a informar";
  const falta: string[] = [];
  let o = "";
  switch (p.tipo) {
    case "gasto":
      o = `Gasto de ${v} em ${grupo ?? "?"}${conta ? `, ${conta}` : ""}, ${dataBr(p.data)}`;
      if (!grupo) falta.push("o grupo de despesa");
      if (!conta) falta.push("de qual conta ou cartão saiu");
      break;
    case "receita":
      o = `Receita de ${v} (${grupo ?? "?"})${conta ? ` em ${conta}` : ""}, ${dataBr(p.data)}`;
      if (!grupo) falta.push("o grupo de receita");
      if (!conta) falta.push("em qual conta entrou");
      break;
    case "conta":
      o = `Conta a ${p.sentido} "${p.descricao}" de ${v}${p.parcelas > 1 ? ` em ${p.parcelas}x` : ""}, vencimento ${dataBr(p.data)}${grupo ? ` (${grupo})` : ""}`;
      if (!grupo) falta.push(p.sentido === "pagar" ? "o grupo de despesa" : "o grupo de receita");
      break;
    case "fixa":
      o = `Conta fixa a ${p.sentido} "${p.descricao}" de ${v}, ${p.periodicidade}, a partir de ${dataBr(p.data)}${grupo ? ` (${grupo})` : ""}`;
      if (!grupo) falta.push(p.sentido === "pagar" ? "o grupo de despesa" : "o grupo de receita");
      break;
    case "compra":
    case "venda": {
      const i = p.investimento;
      const tk = i?.ticker ?? "?";
      const novo = p.tipo === "compra" && i && !i.papelContaId && i.ticker ? " (papel novo nesta corretora: será cadastrado)" : "";
      o = `${p.tipo === "compra" ? "Compra" : "Venda"} de ${i?.quantidade != null ? qtdBr(i.quantidade) : "?"} ${tk}` +
        `${i?.preco != null ? ` a ${brl(i.preco)}` : ""}${p.valor != null ? ` (${brl(p.valor)})` : ""}${conta ? ` na ${conta}` : ""}, ${dataBr(p.data)}${novo}`;
      if (!i?.ticker) falta.push("o papel");
      if (!i?.quantidade) falta.push("a quantidade");
      if (!i?.preco && p.valor == null) falta.push("o preço");
      if (!conta) falta.push("a corretora");
      if (p.tipo === "venda" && i?.ticker && !i.papelContaId) falta.push(`qual ${i.ticker} (não há esse papel nesta corretora)`);
      return `${o}.${falta.length ? ` Falta escolher: ${falta.join(", ")}.` : ""} Confira no cartão e toque em Gravar.`;
    }
    case "pagamento": {
      const a = p.opcoes.abertos.find((x) => x.chave === p.alvoChave);
      o = a
        ? `${p.sentido === "pagar" ? "Pagamento" : "Recebimento"} de "${a.descricao}" (venc. ${dataBr(a.vencimento)}), ${v}${conta ? `, ${conta}` : ""}, em ${dataBr(p.data)}`
        : `${p.sentido === "pagar" ? "Pagamento" : "Recebimento"} de ${v}`;
      if (!a) falta.push("qual conta em aberto foi paga");
      if (!conta) falta.push(p.sentido === "pagar" ? "de qual conta saiu" : "em qual conta entrou");
      break;
    }
  }
  if (p.valor == null) falta.push("o valor");
  return `${o}.${falta.length ? ` Falta escolher: ${falta.join(", ")}.` : ""} Confira no cartão e toque em Gravar.`;
}
