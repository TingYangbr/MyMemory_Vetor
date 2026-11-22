import { useMemo, useState } from "react";
import type { FinComandoProposta, FinComandoTipo, FinPeriodicidade } from "@mymemory/shared";
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
];

const ROTULO_DATA: Record<FinComandoTipo, string> = {
  gasto: "Data",
  receita: "Data",
  conta: "Vencimento",
  fixa: "Primeiro vencimento",
  pagamento: "Pago em",
};

type Desfazer = { tipo: "lote"; lote: string } | { tipo: "recorrencia"; id: number } | { tipo: "baixa"; tituloId: number } | null;

function lerValor(t: string): number | null {
  const s = t.trim().replace(/\s|r\$/gi, "");
  if (!s) return null;
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export default function FinComandoCartao({ proposta }: { proposta: FinComandoProposta }) {
  const [tipo, setTipo] = useState<FinComandoTipo>(proposta.tipo);
  const [sentido, setSentido] = useState<"pagar" | "receber">(proposta.sentido);
  const [descricao, setDescricao] = useState(proposta.descricao);
  const [valor, setValor] = useState(proposta.valor != null ? String(proposta.valor).replace(".", ",") : "");
  const [data, setData] = useState(proposta.data);
  const [parcelas, setParcelas] = useState(String(proposta.parcelas || 1));
  const [periodicidade, setPeriodicidade] = useState<FinPeriodicidade>(proposta.periodicidade);
  const [contaId, setContaId] = useState(proposta.contaId != null ? String(proposta.contaId) : "");
  const [grupoId, setGrupoId] = useState(proposta.grupoId != null ? String(proposta.grupoId) : "");
  const [alvo, setAlvo] = useState(proposta.alvoChave ?? "");
  const [estado, setEstado] = useState<"edicao" | "gravando" | "gravado" | "desfeito">("edicao");
  const [erro, setErro] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<Desfazer>(null);
  const [feito, setFeito] = useState("");

  // Gasto é sempre a pagar; receita, a receber; pagamento segue o item escolhido
  const sentidoEfetivo: "pagar" | "receber" =
    tipo === "gasto" ? "pagar" : tipo === "receita" ? "receber" : tipo === "pagamento"
      ? proposta.opcoes.abertos.find((a) => a.chave === alvo)?.sentido ?? sentido
      : sentido;
  const grupos = sentidoEfetivo === "pagar" ? proposta.opcoes.gruposDespesa : proposta.opcoes.gruposReceita;
  const abertos = useMemo(() => proposta.opcoes.abertos, [proposta]);
  const pedeConta = tipo === "gasto" || tipo === "receita" || tipo === "pagamento" || tipo === "fixa";
  const contaObrigatoria = tipo !== "fixa";
  const pedeGrupo = tipo !== "pagamento";

  async function gravar() {
    setErro(null);
    const v = lerValor(valor);
    const conta = contaId ? Number(contaId) : null;
    const grupo = grupoId ? Number(grupoId) : null;
    if (tipo !== "pagamento" && v == null) return setErro("Informe o valor.");
    if (pedeGrupo && grupo == null) return setErro(sentidoEfetivo === "pagar" ? "Escolha o grupo de despesa." : "Escolha o grupo de receita.");
    if (pedeConta && contaObrigatoria && conta == null) return setErro("Escolha a conta ou o cartão.");
    if (tipo === "pagamento" && !alvo) return setErro("Escolha qual conta em aberto foi paga.");
    setEstado("gravando");
    try {
      if (tipo === "gasto" || tipo === "receita") {
        await apiPostJson("/api/fin/lancamentos", {
          data,
          descricao: descricao.trim() || (tipo === "gasto" ? "Gasto" : "Receita"),
          valor: v,
          contaOrigemId: tipo === "gasto" ? conta : grupo,
          contaDestinoId: tipo === "gasto" ? grupo : conta,
        });
        setDesfazer(null);
        setFeito(`${tipo === "gasto" ? "Gasto" : "Receita"} de ${brl(v!)} gravado. Para apagar, use a aba Lançamentos em Contas a pagar e receber.`);
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
        const corpo =
          partes[0] === "t"
            ? { tituloId: Number(partes[1]) }
            : { recorrenciaId: Number(partes[1]), referencia: partes.slice(2).join(":") };
        const r = await apiPostJson<{ tituloId: number }>("/api/fin/baixas", {
          ...corpo,
          data,
          valorPago: v ?? a.valor,
          contaPagamentoId: conta,
        });
        setDesfazer({ tipo: "baixa", tituloId: r.tituloId });
        setFeito(`${a.sentido === "pagar" ? "Pagamento" : "Recebimento"} de "${a.descricao}" gravado.`);
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

  return (
    <div style={caixa}>
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
          Qual conta em aberto
          <select className="mm-field" value={alvo} onChange={(e) => setAlvo(e.target.value)}>
            <option value="">— escolha —</option>
            {abertos.map((a) => (
              <option key={a.chave} value={a.chave}>
                {a.atrasado ? "⚠ " : ""}{dataBr(a.vencimento)} · {a.descricao} · {brl(a.valor)} ({a.sentido})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label style={rot}>
          Descrição
          <input className="mm-field" value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} />
        </label>
      )}

      <div style={linha}>
        <label style={rot}>
          Valor (R$)
          <input className="mm-field" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
        </label>
        <label style={rot}>
          {ROTULO_DATA[tipo]}
          <input className="mm-field" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        {tipo === "conta" ? (
          <label style={rot}>
            Parcelas
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

      <div style={linha}>
        {pedeGrupo ? (
          <label style={rot}>
            {sentidoEfetivo === "pagar" ? "Grupo de despesa" : "Grupo de receita"}
            <select className="mm-field" value={grupoId} onChange={(e) => setGrupoId(e.target.value)}>
              <option value="">— escolha —</option>
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>{g.nome}</option>
              ))}
            </select>
          </label>
        ) : null}
        {pedeConta ? (
          <label style={rot}>
            {tipo === "receita" || sentidoEfetivo === "receber" ? "Entra em" : "Sai de"}
            {!contaObrigatoria ? " (opcional)" : ""}
            <select className="mm-field" value={contaId} onChange={(e) => setContaId(e.target.value)}>
              <option value="">— escolha —</option>
              {proposta.opcoes.contas.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.tipo === "cartao" ? " (cartão)" : ""}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {erro ? <span className="mm-error">{erro}</span> : null}
      <button
        type="button"
        className="mm-btn mm-btn--primary"
        style={{ justifySelf: "start" }}
        disabled={estado === "gravando"}
        onClick={() => void gravar()}
      >
        {estado === "gravando" ? "Gravando…" : "Gravar"}
      </button>
    </div>
  );
}
