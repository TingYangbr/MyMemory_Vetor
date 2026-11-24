import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import janela from "./MemoAlteracaoCartao.module.css";
import type { FinComandoDesfazer, FinComandoProposta, FinComandoTipo, FinPeriodicidade, FinTipoConta } from "@mymemory/shared";
import { FIN_PERIODICIDADES } from "@mymemory/shared";
import { apiDeleteJson, apiPatchJson, apiPostJson } from "../api";

/**
 * Fale comigo → financeiro: cartão com o que a IA entendeu da frase, para conferir, ajustar e gravar.
 * Grava pelas mesmas rotas da tela Contas a pagar e receber (no espaço escolhido no topo). Depois de gravar,
 * oferece Desfazer quando a rota permite (conta/parcelado, conta fixa e pagamento).
 */
const TIPOS: { valor: FinComandoTipo; rotulo: string }[] = [
  { valor: "gasto", rotulo: "Gasto (já pago)" },
  { valor: "receita", rotulo: "Receita (já recebida)" },
  { valor: "conta", rotulo: "Conta a pagar / receber" },
  { valor: "fixa", rotulo: "Conta fixa (todo mês…)" },
  { valor: "pagamento", rotulo: "Pagamento de conta em aberto" },
  { valor: "compra", rotulo: "Compra de ação / papel" },
  { valor: "venda", rotulo: "Venda de ação / papel" },
  { valor: "transferencia", rotulo: "Transferência entre contas" },
  { valor: "provento", rotulo: "Provento (dividendo, JCP, rendimento)" },
];

const ROTULO_DATA: Record<FinComandoTipo, string> = {
  gasto: "Data",
  receita: "Data",
  conta: "Vencimento",
  fixa: "Primeiro vencimento",
  pagamento: "Pago em",
  compra: "Data",
  venda: "Data",
  transferencia: "Data",
  provento: "Data",
};


function lerValor(t: string): number | null {
  const s = t.trim().replace(/\s|r\$/gi, "");
  if (!s) return null;
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Quantidade: aceita "100", "1.000" (milhar) e "0,5". */
function lerQtd(t: string): number | null {
  const s = t.trim().replace(/\s/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export default function FinComandoCartao({
  proposta,
  onGravado,
  onCancelar,
  embutido = false,
}: {
  proposta: FinComandoProposta;
  /** Já está dentro de uma janela (Catalogar): não abre outra por cima. */
  embutido?: boolean;
  /** Chamado uma vez quando grava (o Catalogar liga o memo do documento ao que foi gravado). */
  onGravado?: (desfazer: FinComandoDesfazer) => void;
  onCancelar?: () => void;
}) {
  const [tipo, setTipo] = useState<FinComandoTipo>(proposta.tipo);
  const [sentido, setSentido] = useState<"pagar" | "receber">(proposta.sentido);
  const [descricao, setDescricao] = useState(proposta.descricao);
  const [valor, setValor] = useState(proposta.valor != null ? String(proposta.valor).replace(".", ",") : "");
  const [data, setData] = useState(proposta.data);
  const [parcelas, setParcelas] = useState(String(proposta.parcelas || 1));
  const [periodicidade, setPeriodicidade] = useState<FinPeriodicidade>(proposta.periodicidade);
  const [contaId, setContaId] = useState(proposta.contaId != null ? String(proposta.contaId) : "");
  const [destinoId, setDestinoId] = useState(proposta.contaDestinoId != null ? String(proposta.contaDestinoId) : "");
  const [grupoId, setGrupoId] = useState(proposta.grupoId != null ? String(proposta.grupoId) : "");
  const [alvo, setAlvo] = useState(proposta.alvoChave ?? "");
  const [estado, setEstado] = useState<"edicao" | "gravando" | "gravado" | "desfeito" | "cancelado">(proposta.gravado ? "gravado" : "edicao");
  // Janela por cima da tela, como o registro novo de memo; fechada pelo ×/fora, reabre pelo botão na resposta
  const [aberto, setAberto] = useState(true);
  const avisou = useRef(false);
  const [erro, setErro] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<FinComandoDesfazer>(proposta.gravado?.desfazer ?? null);
  useEffect(() => {
    if (estado === "gravado" && !avisou.current) {
      avisou.current = true;
      onGravado?.(desfazer);
    }
    if (estado === "cancelado") onCancelar?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  const [feito, setFeito] = useState(proposta.gravado?.mensagem ?? "");
  // Opções do cartão (crescem quando a pessoa cadastra um grupo ou uma conta na hora)
  const [contasOpc, setContasOpc] = useState(proposta.opcoes.contas);
  const [gruposDesp, setGruposDesp] = useState(proposta.opcoes.gruposDespesa);
  const [gruposRec, setGruposRec] = useState(proposta.opcoes.gruposReceita);
  const [novo, setNovo] = useState<null | "grupo" | "conta" | "excedente">(null);
  // Pagamento com valor diferente do previsto: o que fazer com a diferença
  const [decMenor, setDecMenor] = useState<"" | "parcial" | "quitar">("");
  const [decMaior, setDecMaior] = useState<"" | "quitar" | "grupo">("");
  const [excGrupoId, setExcGrupoId] = useState("");
  // Compra/venda de papel: papel ("novo" = ticker digitado, cadastrado ao gravar a compra), quantidade, preço, taxas
  const inv0 = proposta.investimento;
  const [papelSel, setPapelSel] = useState(inv0?.papelContaId != null ? String(inv0.papelContaId) : inv0?.ticker ? "novo" : "");
  const [tickerNovo, setTickerNovo] = useState(inv0?.papelContaId == null ? inv0?.ticker ?? "" : "");
  const [qtd, setQtd] = useState(inv0?.quantidade != null ? String(inv0.quantidade).replace(".", ",") : "");
  const precoIni = inv0?.preco ?? (inv0?.quantidade && proposta.valor ? Math.round((proposta.valor / inv0.quantidade) * 1e6) / 1e6 : null);
  const [preco, setPreco] = useState(precoIni != null ? String(precoIni).replace(".", ",") : "");
  const [taxas, setTaxas] = useState(inv0?.taxas != null ? String(inv0.taxas).replace(".", ",") : "");
  const [provTipo, setProvTipo] = useState<"dividendo" | "jcp" | "rendimento" | "juros">(proposta.provento?.tipo ?? "dividendo");
  const [provBruto, setProvBruto] = useState(proposta.provento?.valorBruto != null ? String(proposta.provento.valorBruto).replace(".", ",") : "");

  // Gasto é sempre a pagar; receita, a receber; pagamento segue o item escolhido
  const sentidoEfetivo: "pagar" | "receber" =
    tipo === "gasto" ? "pagar" : tipo === "receita" ? "receber" : tipo === "pagamento"
      ? proposta.opcoes.abertos.find((a) => a.chave === alvo)?.sentido ?? sentido
      : sentido;
  const grupos = sentidoEfetivo === "pagar" ? gruposDesp : gruposRec;
  const cfg = proposta.config ?? { gravarDireto: false, criarGrupo: false, criarConta: false };
  const abertos = useMemo(() => proposta.opcoes.abertos, [proposta]);
  const ehInv = tipo === "compra" || tipo === "venda";
  const ehProv = tipo === "provento";
  const ehTransf = tipo === "transferencia";
  const pedeConta = tipo === "gasto" || tipo === "receita" || tipo === "pagamento" || tipo === "fixa" || ehInv || ehTransf;
  const contaObrigatoria = tipo !== "fixa";
  const pedeGrupo = tipo !== "pagamento" && !ehInv && !ehTransf && !ehProv;
  // Papéis da corretora escolhida (sem corretora: todos)
  const papeisOpc = (proposta.opcoes.papeis ?? []).filter((x) => !contaId || x.corretoraId === Number(contaId));
  const papelItem = papelSel && papelSel !== "novo" ? (proposta.opcoes.papeis ?? []).find((x) => x.id === Number(papelSel)) ?? null : null;
  const qtdNum = lerQtd(qtd);
  const precoNum = lerValor(preco);
  const taxasNum = lerValor(taxas) ?? 0;
  const totalInv = qtdNum != null && precoNum != null ? Math.round((qtdNum * precoNum + (tipo === "compra" ? taxasNum : -taxasNum)) * 100) / 100 : null;
  const papelFalta = ehInv && !(papelItem || (tipo === "compra" && papelSel === "novo" && tickerNovo.trim()));
  const vendeMais = tipo === "venda" && papelItem != null && qtdNum != null && qtdNum > papelItem.quantidade + 1e-9;

  // Pagamento: compara o valor informado com o previsto do item em aberto
  const alvoItem = tipo === "pagamento" ? abertos.find((a) => a.chave === alvo) ?? null : null;
  const valorInf = lerValor(valor) ?? alvoItem?.valor ?? null;
  const dif = alvoItem && valorInf != null ? Math.round((valorInf - alvoItem.valor) * 100) / 100 : 0;
  // Fatura de cartão: pagar menos ou mais só muda o saldo da próxima fatura — nada a decidir
  const ehFaturaAlvo = alvoItem?.chave.startsWith("f:") ?? false;
  const pagouMenos = dif < 0 && !ehFaturaAlvo;
  const pagouMais = dif > 0 && !ehFaturaAlvo;
  const contaEhCartao = contasOpc.some((c) => String(c.id) === contaId && c.tipo === "cartao");
  const parcCartao = tipo === "gasto" && contaEhCartao ? Math.max(1, Math.min(48, Math.trunc(Number(parcelas) || 1))) : 1;
  const ehRecorrencia = alvoItem?.chave.startsWith("r:") ?? false;
  const valorPendente = (pagouMenos && !decMenor) || (pagouMais && (!decMaior || (decMaior === "grupo" && !excGrupoId)));

  async function gravar() {
    setErro(null);
    const v = lerValor(valor);
    const conta = contaId ? Number(contaId) : null;
    const grupo = grupoId ? Number(grupoId) : null;
    if (ehProv) {
      if (!papelItem) return setErro("Escolha o papel.");
      if (!(lerValor(valor) ?? 0)) return setErro("Informe o valor recebido.");
      setEstado("gravando");
      try {
        const r = await apiPostJson<{ operacaoId: number; ticker: string }>("/api/fin/investimentos/provento", {
          papelContaId: papelItem.id, tipo: provTipo, data, valor: lerValor(valor), valorBruto: lerValor(provBruto), origem: "falecomigo",
        });
        setDesfazer({ tipo: "operacao", id: r.operacaoId });
        setFeito(`Provento de ${brl(lerValor(valor)!)} de ${r.ticker} gravado.`);
        setEstado("gravado");
      } catch (e) {
        setEstado("edicao");
        setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
      }
      return;
    }
    if (ehInv) {
      if (conta == null) return setErro("Escolha a corretora.");
      if (papelFalta) return setErro(tipo === "venda" ? "Escolha o papel vendido." : "Escolha o papel ou digite o ticker.");
      if (qtdNum == null) return setErro("Informe a quantidade.");
      if (precoNum == null) return setErro("Informe o preço.");
      if (vendeMais) return setErro(`A posição é ${papelItem!.quantidade}: não dá para vender ${qtdNum}.`);
      setEstado("gravando");
      try {
        const r = await apiPostJson<{ operacaoId: number; ticker: string; valorTotal: number; como: string }>("/api/fin/investimentos/operacoes", {
          operacao: tipo,
          papelContaId: papelItem?.id ?? null,
          ticker: papelItem ? papelItem.ticker : tickerNovo.trim(),
          corretoraId: conta,
          data,
          quantidade: qtdNum,
          preco: precoNum,
          taxas: taxasNum || null,
          origem: "falecomigo",
        });
        setDesfazer({ tipo: "operacao", id: r.operacaoId });
        setFeito(`${tipo === "compra" ? "Compra" : "Venda"} de ${qtd} ${r.ticker} (${brl(r.valorTotal)}) gravada.`);
        setEstado("gravado");
      } catch (e) {
        setEstado("edicao");
        setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
      }
      return;
    }
    if (tipo !== "pagamento" && v == null) return setErro("Informe o valor.");
    if (pedeGrupo && grupo == null) return setErro(sentidoEfetivo === "pagar" ? "Escolha o grupo de despesa." : "Escolha o grupo de receita.");
    if (pedeConta && contaObrigatoria && conta == null) return setErro("Escolha a conta ou o cartão.");
    if (tipo === "pagamento" && !alvo) return setErro("Escolha qual conta em aberto foi paga.");
    if (tipo === "pagamento" && pagouMenos && !decMenor) return setErro("Pagou menos que o previsto: escolha Parcial ou Quitar assim mesmo.");
    if (tipo === "pagamento" && pagouMais && !decMaior) return setErro("Pagou mais que o previsto: escolha Quitar assim mesmo ou o grupo do excedente.");
    if (tipo === "pagamento" && pagouMais && decMaior === "grupo" && !excGrupoId) return setErro("Escolha o grupo do excedente.");
    if (ehTransf && (destinoId === "" || destinoId === contaId)) return setErro("Escolha para qual conta vai (diferente da de origem).");
    setEstado("gravando");
    try {
      if (ehTransf) {
        const r = await apiPostJson<{ id?: number | null }>("/api/fin/lancamentos", {
          data,
          descricao: descricao.trim() || "Transferência",
          valor: v,
          contaOrigemId: conta,
          contaDestinoId: Number(destinoId),
        });
        setDesfazer(r.id != null ? { tipo: "lancamento", id: r.id } : null);
        setFeito(`Transferência de ${brl(v!)} gravada.`);
      } else if (tipo === "gasto" && parcCartao > 1) {
        const r = await apiPostJson<{ lote: string; primeiroId: number }>("/api/fin/cartao/parcelado", {
          cartaoId: conta, grupoId: grupo, descricao: descricao.trim() || "Compra no cartão", valorTotal: v, parcelas: parcCartao, data,
        });
        setDesfazer({ tipo: "lancamento", id: r.primeiroId });
        setFeito(`Compra de ${brl(v!)} em ${parcCartao}x no cartão gravada (uma parcela em cada fatura).`);
      } else if (tipo === "gasto" || tipo === "receita") {
        const r = await apiPostJson<{ id?: number | null }>("/api/fin/lancamentos", {
          data,
          descricao: descricao.trim() || (tipo === "gasto" ? "Gasto" : "Receita"),
          valor: v,
          contaOrigemId: tipo === "gasto" ? conta : grupo,
          contaDestinoId: tipo === "gasto" ? grupo : conta,
        });
        setDesfazer(r.id != null ? { tipo: "lancamento", id: r.id } : null);
        setFeito(`${tipo === "gasto" ? "Gasto" : "Receita"} de ${brl(v!)} gravado.`);
      } else if (tipo === "conta") {
        const n = Math.max(1, Math.min(360, Math.trunc(Number(parcelas) || 1)));
        const r = await apiPostJson<{ lote: string }>("/api/fin/parcelados", {
          sentido: sentidoEfetivo,
          descricao: descricao.trim() || "Conta",
          valorTotal: v,
          parcelas: n,
          primeiroVencimento: data,
          periodicidade: "mensal",
          contaGrupoId: grupo,
        });
        setDesfazer({ tipo: "lote", lote: r.lote });
        setFeito(`Conta a ${sentidoEfetivo} de ${brl(v!)}${n > 1 ? ` em ${n}x` : ""} gravada.`);
      } else if (tipo === "fixa") {
        const r = await apiPostJson<{ id: number }>("/api/fin/recorrencias", {
          sentido: sentidoEfetivo,
          descricao: descricao.trim() || "Conta fixa",
          valor: v,
          periodicidade,
          inicio: data,
          contaGrupoId: grupo,
          contaPagamentoId: conta,
        });
        setDesfazer({ tipo: "recorrencia", id: r.id });
        setFeito(`Conta fixa de ${brl(v!)} (${periodicidade}) gravada.`);
      } else {
        const a = abertos.find((x) => x.chave === alvo)!;
        const partes = a.chave.split(":");
        if (partes[0] === "f") {
          const r = await apiPostJson<{ id: number }>("/api/fin/faturas/pagamento", {
            cartaoId: Number(partes[1]), vencimento: partes[2], data, valor: v ?? a.valor, contaPagamentoId: conta,
          });
          setDesfazer({ tipo: "lancamento", id: r.id });
          setFeito(`Pagamento de ${brl(v ?? a.valor)} da "${a.descricao}" gravado.` + (v != null && v < a.valor ? ` Os ${brl(a.valor - v)} restantes passam para a próxima fatura.` : ""));
          setEstado("gravado");
          return;
        }
        const corpo =
          partes[0] === "t"
            ? { tituloId: Number(partes[1]) }
            : { recorrenciaId: Number(partes[1]), referencia: partes.slice(2).join(":") };
        const parcial = pagouMenos && decMenor === "parcial";
        const r = await apiPostJson<{ tituloId: number; saldoTituloId?: number | null }>("/api/fin/baixas", {
          ...corpo,
          data,
          valorPago: v ?? a.valor,
          contaPagamentoId: conta,
          modo: parcial ? "parcial" : "quitar",
          excedenteGrupoId: pagouMais && decMaior === "grupo" ? Number(excGrupoId) : null,
        });
        setDesfazer({ tipo: "baixa", tituloId: r.tituloId });
        setFeito(
          `${a.sentido === "pagar" ? "Pagamento" : "Recebimento"} de "${a.descricao}" gravado.` +
            (parcial ? ` Ficou ${brl(-dif)} em aberto (saldo), mesmo vencimento.` : "")
        );
      }
      setEstado("gravado");
    } catch (e) {
      setEstado("edicao");
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
    }
  }

  async function desfazerAgora() {
    if (!desfazer) return;
    try {
      if (desfazer.tipo === "lote") await apiDeleteJson(`/api/fin/parcelados/${desfazer.lote}`);
      else if (desfazer.tipo === "lancamento") await apiDeleteJson(`/api/fin/lancamentos/${desfazer.id}`);
      else if (desfazer.tipo === "operacao") await apiDeleteJson(`/api/fin/investimentos/operacoes/${desfazer.id}`);
      else if (desfazer.tipo === "recorrencia") await apiPatchJson(`/api/fin/recorrencias/${desfazer.id}`, { ativo: false });
      else await apiDeleteJson(`/api/fin/baixas/${desfazer.tituloId}`);
      setEstado("desfeito");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível desfazer.");
    }
  }

  const caixa: React.CSSProperties = {
    border: "1px solid var(--mm-border)",
    borderRadius: 10,
    padding: "10px 12px",
    marginTop: 8,
    display: "grid",
    gap: 8,
    background: "var(--mm-card)",
  };
  const linha: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" };
  const rot: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2, fontSize: 12, color: "var(--mm-muted)", minWidth: 120, flex: "1 1 140px" };

  // Contorno vermelho nos campos obrigatórios ainda vazios (o que a IA não conseguiu identificar)
  const falta = (vazio: boolean): React.CSSProperties | undefined =>
    vazio ? { borderColor: "var(--mm-danger)", boxShadow: "0 0 0 1px var(--mm-danger)" } : undefined;
  // ...e o rótulo diz o que falta (o contorno sozinho passa despercebido no celular)
  const marca = (vazio: boolean) =>
    vazio ? <span style={{ color: "var(--mm-danger)", fontWeight: 600 }}> · preencher</span> : null;

  const maisLink: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: "2px 0",
    fontSize: 12,
    color: "var(--mm-muted)",
    textDecoration: "underline",
    cursor: "pointer",
    alignSelf: "flex-start",
  };

  if (estado === "cancelado") {
    return (
      <div style={caixa} role="status">
        <span>Cancelado: nada foi gravado.</span>
      </div>
    );
  }

  if (estado === "gravado" || estado === "desfeito") {
    return (
      <div style={caixa} role="status">
        <span>{estado === "gravado" ? `✓ ${feito}` : "Desfeito: nada ficou gravado."}</span>
        {estado === "gravado" && desfazer ? (
          <button type="button" className="mm-btn" style={{ justifySelf: "start" }} onClick={() => void desfazerAgora()}>
            ↶ Desfazer
          </button>
        ) : null}
        {erro ? <span className="mm-error">{erro}</span> : null}
      </div>
    );
  }

  const titulo = `Finanças · ${TIPOS.find((t) => t.valor === tipo)?.rotulo ?? "lançamento"}`;
  const conteudo = (
    <div style={embutido ? caixa : { display: "grid", gap: 8 }}>
      {/* Mesmo padrão do registro novo de memo: título, Salvar e Cancelar no topo */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ marginRight: "auto" }}>{titulo}</strong>
        <button type="button" className="mm-btn mm-btn--primary" disabled={estado === "gravando"} onClick={() => void gravar()}>
          {estado === "gravando" ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" className="mm-btn mm-btn--ghost" disabled={estado === "gravando"} onClick={() => setEstado("cancelado")}>
          Cancelar
        </button>
      </div>
      {/* A frase da proposta fica dentro do cartão: some quando grava */}
      <span style={{ fontSize: 14 }}>{proposta.mensagem}</span>
      <div style={linha}>
        <label style={rot}>
          O que é
          <select className="mm-field" value={tipo} onChange={(e) => setTipo(e.target.value as FinComandoTipo)}>
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>{t.rotulo}</option>
            ))}
          </select>
        </label>
        {tipo === "conta" || tipo === "fixa" ? (
          <label style={rot}>
            Sentido
            <select className="mm-field" value={sentido} onChange={(e) => setSentido(e.target.value as "pagar" | "receber")}>
              <option value="pagar">A pagar</option>
              <option value="receber">A receber</option>
            </select>
          </label>
        ) : null}
      </div>

      {tipo === "pagamento" ? (
        <label style={rot}>
          <span>Qual conta em aberto{marca(!alvo)}</span>
          <select className="mm-field" style={falta(!alvo)} value={alvo} onChange={(e) => setAlvo(e.target.value)}>
            <option value="">— escolha —</option>
            {abertos.map((a) => (
              <option key={a.chave} value={a.chave}>
                {a.atrasado ? "⚠ " : ""}{dataBr(a.vencimento)} · {a.descricao} · {brl(a.valor)} ({a.sentido})
              </option>
            ))}
          </select>
          {(() => {
            const it = abertos.find((a) => a.chave === alvo);
            if (!it) return null;
            return (
              <div style={{ ...rot, marginTop: 8 }}>
                <span>{it.sentido === "pagar" ? "Grupo de despesa" : "Grupo de receita"} (da conta em aberto)</span>
                <input
                  className="mm-field"
                  readOnly
                  tabIndex={-1}
                  value={it.grupo ?? "—"}
                  title="Vem da conta em aberto: a despesa/receita já foi registrada nesse grupo. Para mudar, altere a conta ou a recorrência."
                  style={{ background: "#fef9c3", color: "#422006", cursor: "default" }}
                />
              </div>
            );
          })()}
        </label>
      ) : ehProv ? (
        <div style={linha}>
          <label style={rot}>
            <span>Papel{marca(!papelItem)}</span>
            <select className="mm-field" style={falta(!papelItem)} value={papelSel} onChange={(e) => setPapelSel(e.target.value)}>
              <option value="">— escolha —</option>
              {(proposta.opcoes.papeis ?? []).map((x) => (
                <option key={x.id} value={x.id}>{x.ticker}{x.corretoraNome ? ` · ${x.corretoraNome}` : ""}</option>
              ))}
            </select>
          </label>
          <label style={rot}>
            <span>Tipo</span>
            <select className="mm-field" value={provTipo} onChange={(e) => setProvTipo(e.target.value as typeof provTipo)}>
              <option value="dividendo">Dividendo</option>
              <option value="jcp">JCP</option>
              <option value="rendimento">Rendimento (FII)</option>
              <option value="juros">Juros</option>
            </select>
          </label>
          {provTipo === "jcp" ? (
            <label style={rot}>
              <span>Valor bruto (opcional, antes do IR)</span>
              <input className="mm-field" inputMode="decimal" value={provBruto} onChange={(e) => setProvBruto(e.target.value)} />
            </label>
          ) : null}
        </div>
      ) : ehInv ? (
        <div style={linha}>
          <label style={rot}>
            <span>Papel{marca(papelFalta)}</span>
            <select className="mm-field" style={falta(papelFalta)} value={papelSel} onChange={(e) => setPapelSel(e.target.value)}>
              <option value="">— escolha —</option>
              {papeisOpc.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.ticker} · {x.quantidade.toLocaleString("pt-BR")} un{x.corretoraNome && !contaId ? ` · ${x.corretoraNome}` : ""}
                </option>
              ))}
              {tipo === "compra" ? <option value="novo">Outro (papel novo)…</option> : null}
            </select>
            {papelItem ? (
              <small style={{ color: vendeMais ? "var(--mm-danger)" : "var(--mm-muted)" }}>
                Posição: {papelItem.quantidade.toLocaleString("pt-BR")}
                {papelItem.custoMedio != null ? ` · custo médio ${brl(papelItem.custoMedio)}` : ""}
                {vendeMais ? " · menor que a quantidade vendida" : ""}
              </small>
            ) : null}
          </label>
          {papelSel === "novo" ? (
            <label style={rot}>
              <span>Ticker{marca(!tickerNovo.trim())}</span>
              <input className="mm-field" style={falta(!tickerNovo.trim())} value={tickerNovo} maxLength={30} placeholder="PETR4"
                onChange={(e) => setTickerNovo(e.target.value.toUpperCase())} />
            </label>
          ) : null}
        </div>
      ) : (
        <label style={rot}>
          Descrição
          <input className="mm-field" value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} />
        </label>
      )}

      {ehInv ? (
        <div style={linha}>
          <label style={rot}>
            <span>Quantidade{marca(qtdNum == null || vendeMais)}</span>
            <input className="mm-field" style={falta(qtdNum == null || vendeMais)} inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} />
          </label>
          <label style={rot}>
            <span>Preço (R$){marca(precoNum == null)}</span>
            <input className="mm-field" style={falta(precoNum == null)} inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="0,00" />
          </label>
          <label style={rot}>
            Taxas (opcional)
            <input className="mm-field" inputMode="decimal" value={taxas} onChange={(e) => setTaxas(e.target.value)} placeholder="0,00" />
          </label>
          <label style={rot}>
            Data
            <input className="mm-field" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
          <span style={{ alignSelf: "center", fontSize: 13 }}>
            {totalInv != null ? `${tipo === "compra" ? "Custo" : "Líquido"}: ${brl(totalInv)}` : ""}
          </span>
        </div>
      ) : null}

      <div style={{ ...linha, display: ehInv ? "none" : "flex" }}>
        <label style={rot}>
          <span>Valor (R$){marca((tipo !== "pagamento" && lerValor(valor) == null) || valorPendente)}</span>
          <input className="mm-field" style={falta((tipo !== "pagamento" && lerValor(valor) == null) || valorPendente)} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
        </label>
        <label style={rot}>
          {ROTULO_DATA[tipo]}
          <input className="mm-field" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        {tipo === "conta" || (tipo === "gasto" && contaEhCartao) ? (
          <label style={rot}>
            Parcelas{tipo === "gasto" ? " (no cartão)" : ""}
            <input className="mm-field" type="number" min={1} max={360} value={parcelas} onChange={(e) => setParcelas(e.target.value)} />
          </label>
        ) : null}
        {tipo === "fixa" ? (
          <label style={rot}>
            Repete
            <select className="mm-field" value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value as FinPeriodicidade)}>
              {FIN_PERIODICIDADES.map((p) => (
                <option key={p.valor} value={p.valor}>{p.rotulo}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {alvoItem && (pagouMenos || pagouMais) ? (
        <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
          <span style={{ color: valorPendente ? "var(--mm-danger)" : "var(--mm-muted)" }}>
            {pagouMenos
              ? `Pagou ${brl(-dif)} a menos que o previsto (${brl(alvoItem.valor)}).`
              : `Pagou ${brl(dif)} a mais que o previsto (${brl(alvoItem.valor)}).`}
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {pagouMenos ? (
              <>
                <button type="button" className={`mm-btn${decMenor === "parcial" ? " mm-btn--primary" : ""}`} onClick={() => setDecMenor("parcial")}>
                  Parcial: fica {brl(-dif)} em aberto
                </button>
                <button type="button" className={`mm-btn${decMenor === "quitar" ? " mm-btn--primary" : ""}`} onClick={() => setDecMenor("quitar")}>
                  Quitar assim mesmo (desconto)
                </button>
              </>
            ) : (
              <>
                <button type="button" className={`mm-btn${decMaior === "quitar" ? " mm-btn--primary" : ""}`} onClick={() => setDecMaior("quitar")}>
                  {ehRecorrencia ? "Quitar assim mesmo (a conta veio maior)" : "Quitar assim mesmo (juros/multa)"}
                </button>
                <button type="button" className={`mm-btn${decMaior === "grupo" ? " mm-btn--primary" : ""}`} onClick={() => setDecMaior("grupo")}>
                  Lançar o excedente em um grupo…
                </button>
              </>
            )}
          </div>
          {pagouMais && decMaior === "grupo" ? (
            <label style={rot}>
              <span>{sentidoEfetivo === "pagar" ? "Grupo de despesa do excedente" : "Grupo de receita do excedente"}{marca(!excGrupoId)}</span>
              <select className="mm-field" style={falta(!excGrupoId)} value={excGrupoId} onChange={(e) => setExcGrupoId(e.target.value)}>
                <option value="">— escolha (ex.: Juros e multas) —</option>
                {(sentidoEfetivo === "pagar" ? gruposDesp : gruposRec).map((g) => (
                  <option key={g.id} value={g.id}>{g.nome}</option>
                ))}
              </select>
              {cfg.criarGrupo ? (
                <button type="button" style={maisLink} onClick={() => setNovo("excedente")}>+ novo grupo</button>
              ) : null}
            </label>
          ) : null}
        </div>
      ) : null}

      <div style={linha}>
        {pedeGrupo ? (
          <label style={rot}>
            <span>{sentidoEfetivo === "pagar" ? "Grupo de despesa" : "Grupo de receita"}{marca(!grupoId)}</span>
            <select className="mm-field" style={falta(!grupoId)} value={grupoId} onChange={(e) => setGrupoId(e.target.value)}>
              <option value="">— escolha —</option>
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>{g.nome}</option>
              ))}
            </select>
            {cfg.criarGrupo ? (
              <button type="button" style={maisLink} onClick={() => setNovo("grupo")}>+ novo grupo</button>
            ) : null}
          </label>
        ) : null}
        {pedeConta ? (
          <label style={rot}>
            <span>
              {ehInv ? "Corretora" : tipo === "receita" || sentidoEfetivo === "receber" ? "Entra em" : "Sai de"}
              {!contaObrigatoria ? " (opcional)" : ""}
              {marca(contaObrigatoria && !contaId)}
            </span>
            <select className="mm-field" style={falta(contaObrigatoria && !contaId)} value={contaId} onChange={(e) => setContaId(e.target.value)}>
              <option value="">— escolha —</option>
              {contasOpc.filter((c) => !ehInv || c.tipo !== "cartao").map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.tipo === "cartao" ? " (cartão)" : ""}</option>
              ))}
            </select>
            {cfg.criarConta ? (
              <button type="button" style={maisLink} onClick={() => setNovo("conta")}>+ nova conta</button>
            ) : null}
          </label>
        ) : null}
        {ehTransf ? (
          <label style={rot}>
            <span>Vai para{marca(!destinoId || destinoId === contaId)}</span>
            <select className="mm-field" style={falta(!destinoId || destinoId === contaId)} value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
              <option value="">— escolha —</option>
              {contasOpc.filter((c) => String(c.id) !== contaId).map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.tipo === "cartao" ? " (cartão)" : ""}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {novo ? (
        <NovoCadastro
          qual={novo === "excedente" ? "grupo" : novo}
          sentido={sentidoEfetivo}
          onFechar={() => setNovo(null)}
          onCriado={(c) => {
            if (c.tipo === "despesa") setGruposDesp((l) => [...l, { id: c.id, nome: c.nome }]);
            else if (c.tipo === "receita") setGruposRec((l) => [...l, { id: c.id, nome: c.nome }]);
            else setContasOpc((l) => [...l, { id: c.id, nome: c.nome, tipo: c.tipo }]);
            if (novo === "excedente") setExcGrupoId(String(c.id));
            else if (c.tipo === "despesa" || c.tipo === "receita") setGrupoId(String(c.id));
            else setContaId(String(c.id));
            setNovo(null);
          }}
        />
      ) : null}

      {erro ? <span className="mm-error">{erro}</span> : null}
    </div>
  );

  if (embutido) return conteudo;
  return (
    <>
      <button type="button" className="mm-btn" style={{ marginTop: 8 }} onClick={() => setAberto(true)}>
        Conferir e salvar o lançamento
      </button>
      {aberto
        ? createPortal(
            <div className={janela.overlay} onClick={() => estado !== "gravando" && setAberto(false)}>
              <div className={janela.cartao} role="dialog" aria-label={titulo} style={{ width: "min(640px, 100%)" }} onClick={(e) => e.stopPropagation()}>
                {conteudo}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/** Janela para cadastrar na hora um grupo de despesa/receita ou uma conta/cartão (Fale comigo e telas do financeiro). */
export function NovoCadastro(props: {
  qual: "grupo" | "conta";
  sentido: "pagar" | "receber";
  onFechar: () => void;
  onCriado: (c: { id: number; nome: string; tipo: FinTipoConta }) => void;
}) {
  const [nome, setNome] = useState("");
  const [tipoConta, setTipoConta] = useState<FinTipoConta>("banco");
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const tipo: FinTipoConta = props.qual === "grupo" ? (props.sentido === "pagar" ? "despesa" : "receita") : tipoConta;

  async function criar() {
    if (!nome.trim()) return setErro("Informe o nome.");
    setGravando(true);
    setErro(null);
    try {
      const r = await apiPostJson<{ conta: { id: number; nome: string; tipo: FinTipoConta } }>("/api/fin/contas", { nome: nome.trim(), tipo });
      props.onCriado(r.conta);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Não foi possível cadastrar.";
      try {
        setErro((JSON.parse(m) as { message?: string }).message ?? m);
      } catch {
        setErro(m);
      }
      setGravando(false);
    }
  }

  const rotulo: React.CSSProperties = { display: "grid", gap: 2, fontSize: 12, color: "var(--mm-muted)" };
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "grid", placeItems: "center", zIndex: 1000, padding: 16 }}
      onClick={props.onFechar}
    >
      <div
        style={{ background: "var(--mm-card)", border: "1px solid var(--mm-border)", borderRadius: 12, padding: 16, width: "min(360px, 100%)", display: "grid", gap: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <b>{props.qual === "grupo" ? (props.sentido === "pagar" ? "Novo grupo de despesa" : "Novo grupo de receita") : "Nova conta ou cartão"}</b>
        <label style={rotulo}>
          Nome
          <input
            className="mm-field"
            autoFocus
            value={nome}
            maxLength={120}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void criar();
            }}
          />
        </label>
        {props.qual === "conta" ? (
          <label style={rotulo}>
            Tipo
            <select className="mm-field" value={tipoConta} onChange={(e) => setTipoConta(e.target.value as FinTipoConta)}>
              <option value="banco">Banco</option>
              <option value="cartao">Cartão de crédito</option>
              <option value="corretora">Corretora</option>
            </select>
          </label>
        ) : null}
        {erro ? <span className="mm-error">{erro}</span> : null}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="mm-btn mm-btn--primary" disabled={gravando} onClick={() => void criar()}>
            {gravando ? "Cadastrando…" : "Cadastrar"}
          </button>
          <button type="button" className="mm-btn" disabled={gravando} onClick={props.onFechar}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
