import { useMemo, useState } from "react";
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
];

const ROTULO_DATA: Record<FinComandoTipo, string> = {
  gasto: "Data",
  receita: "Data",
  conta: "Vencimento",
  fixa: "Primeiro vencimento",
  pagamento: "Pago em",
};


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
  const [estado, setEstado] = useState<"edicao" | "gravando" | "gravado" | "desfeito" | "cancelado">(proposta.gravado ? "gravado" : "edicao");
  const [erro, setErro] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<FinComandoDesfazer>(proposta.gravado?.desfazer ?? null);
  const [feito, setFeito] = useState(proposta.gravado?.mensagem ?? "");
  // Opções do cartão (crescem quando a pessoa cadastra um grupo ou uma conta na hora)
  const [contasOpc, setContasOpc] = useState(proposta.opcoes.contas);
  const [gruposDesp, setGruposDesp] = useState(proposta.opcoes.gruposDespesa);
  const [gruposRec, setGruposRec] = useState(proposta.opcoes.gruposReceita);
  const [novo, setNovo] = useState<null | "grupo" | "conta">(null);

  // Gasto é sempre a pagar; receita, a receber; pagamento segue o item escolhido
  const sentidoEfetivo: "pagar" | "receber" =
    tipo === "gasto" ? "pagar" : tipo === "receita" ? "receber" : tipo === "pagamento"
      ? proposta.opcoes.abertos.find((a) => a.chave === alvo)?.sentido ?? sentido
      : sentido;
  const grupos = sentidoEfetivo === "pagar" ? gruposDesp : gruposRec;
  const cfg = proposta.config ?? { gravarDireto: false, criarGrupo: false, criarConta: false };
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
      else if (desfazer.tipo === "lancamento") await apiDeleteJson(`/api/fin/lancamentos/${desfazer.id}`);
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
          <select className="mm-field" style={falta(!alvo)} value={alvo} onChange={(e) => setAlvo(e.target.value)}>
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
          <input className="mm-field" style={falta(tipo !== "pagamento" && lerValor(valor) == null)} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
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
            {tipo === "receita" || sentidoEfetivo === "receber" ? "Entra em" : "Sai de"}
            {!contaObrigatoria ? " (opcional)" : ""}
            <select className="mm-field" style={falta(contaObrigatoria && !contaId)} value={contaId} onChange={(e) => setContaId(e.target.value)}>
              <option value="">— escolha —</option>
              {contasOpc.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.tipo === "cartao" ? " (cartão)" : ""}</option>
              ))}
            </select>
            {cfg.criarConta ? (
              <button type="button" style={maisLink} onClick={() => setNovo("conta")}>+ nova conta</button>
            ) : null}
          </label>
        ) : null}
      </div>

      {novo ? (
        <NovoCadastro
          qual={novo}
          sentido={sentidoEfetivo}
          onFechar={() => setNovo(null)}
          onCriado={(c) => {
            if (c.tipo === "despesa") setGruposDesp((l) => [...l, { id: c.id, nome: c.nome }]);
            else if (c.tipo === "receita") setGruposRec((l) => [...l, { id: c.id, nome: c.nome }]);
            else setContasOpc((l) => [...l, { id: c.id, nome: c.nome, tipo: c.tipo }]);
            if (c.tipo === "despesa" || c.tipo === "receita") setGrupoId(String(c.id));
            else setContaId(String(c.id));
            setNovo(null);
          }}
        />
      ) : null}

      {erro ? <span className="mm-error">{erro}</span> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="mm-btn mm-btn--primary"
          disabled={estado === "gravando"}
          onClick={() => void gravar()}
        >
          {estado === "gravando" ? "Gravando…" : "Gravar"}
        </button>
        <button type="button" className="mm-btn" disabled={estado === "gravando"} onClick={() => setEstado("cancelado")}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Janela para cadastrar na hora um grupo de despesa/receita ou uma conta/cartão (ajuste do Fale comigo). */
function NovoCadastro(props: {
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
