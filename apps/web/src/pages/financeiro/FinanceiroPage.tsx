import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  FIN_MOEDAS,
  FIN_PERIODICIDADES,
  FIN_TIPOS_CONTA,
  type FinAgendaResposta,
  type FinConfig,
  type FinConfigResposta,
  type FinConferencia,
  type FinContaSaldo,
  type FinHistoricoTitulo,
  type FinOcorrenciasRecorrencia,
  type FinItemAgenda,
  type FinLancamento,
  type FinPeriodicidade,
  type FinRecorrencia,
  type FinTipoConta,
} from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiPatchJson, apiPostJson, apiPutJson } from "../../api";
import Header from "../../components/Header";
import { NovoCadastro } from "../../components/FinComandoCartao";
import { IconArrowLeft } from "../../components/icons";
import styles from "./Financeiro.module.css";
import janela from "../../components/MemoAlteracaoCartao.module.css";

/**
 * Controle financeiro — etapa 1 (desenho, seção 13): agenda de contas a pagar e receber (títulos + previsão
 * do motor de recorrência), lançamentos com dois lados, contas e saldos, recorrências. Tela de teste do núcleo,
 * antes dos comandos pela IA.
 */

type Aba = "agenda" | "lancamentos" | "contas" | "recorrencias" | "falecomigo";
type Filtro = "tudo" | "aberto" | "atraso" | "pago";
type Recorrencia = FinRecorrencia & { excecoes: { referencia: string; valor: number | null; pular: boolean }[] };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const emMoeda = (v: number, moeda: string) => v.toLocaleString("pt-BR", { style: "currency", currency: moeda });
const cot = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const ehDinheiro = (t: FinTipoConta) => t === "banco" || t === "corretora" || t === "cartao" || t === "investimento";
const dataBr = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
const num = (s: string) => {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return NaN;
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
};

function msgErro(e: unknown): string {
  const bruto = e instanceof Error ? e.message : String(e);
  try {
    const j = JSON.parse(bruto) as { message?: string };
    if (j.message) return j.message;
  } catch {
    /* texto puro */
  }
  return bruto;
}

function mesDe(ref: string): { de: string; ate: string; rotulo: string } {
  const [a, m] = ref.split("-").map(Number);
  const ult = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  const rotulo = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return { de: `${a}-${mm}-01`, ate: `${a}-${mm}-${String(ult).padStart(2, "0")}`, rotulo };
}
function somarMes(ref: string, d: number): string {
  const [a, m] = ref.split("-").map(Number);
  const t = a * 12 + (m - 1) + d;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

const rotuloTipo = (t: FinTipoConta) => FIN_TIPOS_CONTA.find((x) => x.tipo === t)?.rotulo ?? t;

export default function FinanceiroPage() {
  const navigate = useNavigate();
  const [aba, setAba] = useState<Aba>("agenda");
  const [hoje, setHoje] = useState<string | null>(null);
  const [mes, setMes] = useState<string | null>(null);
  const [agenda, setAgenda] = useState<FinAgendaResposta | null>(null);
  const [contas, setContas] = useState<FinContaSaldo[]>([]);
  const [lancs, setLancs] = useState<FinLancamento[]>([]);
  const [recs, setRecs] = useState<Recorrencia[]>([]);
  const [conf, setConf] = useState<FinConferencia | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    apiGet<{ hoje: string }>("/api/fin/espaco")
      .then((r) => { setHoje(r.hoje); setMes(r.hoje.slice(0, 7)); })
      .catch((e) => {
        if (msgErro(e).includes("unauthorized")) navigate("/login");
        else setErro(msgErro(e));
      });
  }, [navigate]);

  const periodo = useMemo(() => (mes ? mesDe(mes) : null), [mes]);

  const carregar = useCallback(async () => {
    if (!periodo) return;
    const qs = `de=${periodo.de}&ate=${periodo.ate}`;
    try {
      const [a, c, l, r, cf] = await Promise.all([
        apiGet<FinAgendaResposta>(`/api/fin/agenda?${qs}`),
        apiGet<{ contas: FinContaSaldo[] }>(`/api/fin/contas?${qs}`),
        apiGet<{ lancamentos: FinLancamento[] }>(`/api/fin/lancamentos?${qs}`),
        apiGet<{ recorrencias: Recorrencia[] }>(`/api/fin/recorrencias`),
        apiGet<FinConferencia>(`/api/fin/conferencia`),
      ]);
      setAgenda(a); setContas(c.contas); setLancs(l.lancamentos); setRecs(r.recorrencias); setConf(cf);
    } catch (e) {
      setErro(msgErro(e));
    }
  }, [periodo]);
  useEffect(() => { void carregar(); }, [carregar]);

  /** Executa uma ação, mostra erro/aviso e recarrega. */
  const agir = useCallback(async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setOcupado(true); setErro(null); setAviso(null);
    try {
      await fn();
      if (ok) setAviso(ok);
      await carregar();
      return true;
    } catch (e) {
      setErro(msgErro(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }, [carregar]);

  const ativas = contas.filter((c) => c.ativo);
  const ctx: Ctx = { contas: ativas, todas: contas, hoje: hoje ?? "", agir, ocupado, recarregar: carregar };

  return (
    <div className={styles.shell}>
      <Header />
      <main className={styles.page}>
        <div className={styles.topo}>
          <button type="button" className={styles.voltar} onClick={() => navigate("/")} title="Voltar" aria-label="Voltar">
            <IconArrowLeft size={18} />
          </button>
          <h1>Contas a pagar e receber</h1>
          <span className={styles.sp} />
          {periodo && mes ? (
            <span className={styles.mes}>
              <button type="button" className={styles.btn} onClick={() => setMes(somarMes(mes, -1))} aria-label="Mês anterior">◀</button>
              <b>{periodo.rotulo}</b>
              <button type="button" className={styles.btn} onClick={() => setMes(somarMes(mes, 1))} aria-label="Próximo mês">▶</button>
            </span>
          ) : null}
        </div>
        <p className={styles.sub}>Cada lançamento grava de onde sai e para onde vai. Também dá para lançar pelo Fale comigo ("paguei o aluguel", "gastei 80 no mercado").</p>

        {erro ? <div className={styles.erro}>{erro}</div> : null}
        {aviso ? <div className={styles.ok}>{aviso}</div> : null}

        {agenda ? (
          <div className={styles.totais}>
            <div className={styles.total}><small>A pagar no mês</small><b>{brl(agenda.totais.pagarPrevisto)}</b></div>
            <div className={styles.total}><small>A receber no mês</small><b>{brl(agenda.totais.receberPrevisto)}</b></div>
            <div className={`${styles.total} ${agenda.totais.pagarAtraso ? styles.totalAtraso : ""}`}><small>Em atraso (pagar)</small><b>{brl(agenda.totais.pagarAtraso)}</b></div>
            <div className={`${styles.total} ${agenda.totais.receberAtraso ? styles.totalAtraso : ""}`}><small>Em atraso (receber)</small><b>{brl(agenda.totais.receberAtraso)}</b></div>
            <div className={styles.total}><small>Pago / recebido no mês</small><b>{brl(agenda.totais.pago)} / {brl(agenda.totais.recebido)}</b></div>
          </div>
        ) : null}

        <div className={styles.tabs} role="tablist">
          {([
            ["agenda", "Previstos"],
            ["lancamentos", "Lançamentos"],
            ["contas", "Contas e saldos"],
            ["recorrencias", "Recorrências"],
            ["falecomigo", "Fale comigo"],
          ] as [Aba, string][]).map(([k, r]) => (
            <button key={k} type="button" role="tab" aria-selected={aba === k} className={`${styles.tab} ${aba === k ? styles.tabOn : ""}`} onClick={() => setAba(k)}>
              {r}
            </button>
          ))}
        </div>

        {!agenda ? <div className={styles.vazio}>Carregando…</div> : null}
        {agenda && aba === "agenda" ? <AbaAgenda ctx={ctx} agenda={agenda} /> : null}
        {agenda && aba === "lancamentos" ? <AbaLancamentos ctx={ctx} lancs={lancs} /> : null}
        {agenda && aba === "contas" ? <AbaContas ctx={ctx} conf={conf} /> : null}
        {agenda && aba === "recorrencias" ? <AbaRecorrencias ctx={ctx} recs={recs} /> : null}
        {agenda && aba === "falecomigo" ? <AbaFaleComigo /> : null}
      </main>
    </div>
  );
}

interface Ctx {
  contas: FinContaSaldo[];
  todas: FinContaSaldo[];
  hoje: string;
  agir: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
  ocupado: boolean;
  /** Recarrega contas e listas (ex.: depois de cadastrar um grupo pelo "+ novo grupo"). */
  recarregar: () => Promise<void>;
}

const maisLink: React.CSSProperties = {
  border: "none", background: "none", padding: 0, marginLeft: 6, color: "var(--mm-primary, #0d9488)",
  cursor: "pointer", fontSize: 12, textDecoration: "underline",
};

function SelConta(props: { valor: string; onChange: (v: string) => void; contas: FinContaSaldo[]; tipos?: FinTipoConta[]; vazio?: string; soReal?: boolean }) {
  const lista = props.contas.filter((c) => (!props.tipos || props.tipos.includes(c.tipo)) && (!props.soReal || c.moeda === "BRL"));
  return (
    <select value={props.valor} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">{props.vazio ?? "— escolha —"}</option>
      {lista.map((c) => (
        <option key={c.id} value={c.id}>{c.nome}{c.moeda !== "BRL" ? ` · ${c.moeda}` : ""}{props.tipos?.length === 1 ? "" : ` (${rotuloTipo(c.tipo)})`}</option>
      ))}
    </select>
  );
}

/* ---------------- Agenda ---------------- */

function AbaAgenda({ ctx, agenda }: { ctx: Ctx; agenda: FinAgendaResposta }) {
  const [filtro, setFiltro] = useState<Filtro>("tudo");
  const [novo, setNovo] = useState<"recorrencia" | "parcelado" | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const itens = agenda.itens.filter((i) =>
    filtro === "tudo" ? true : filtro === "aberto" ? i.situacao === "previsto" || i.situacao === "confirmado" : i.situacao === filtro
  );
  return (
    <>
      <div className={styles.barra}>
        {([["tudo", "Tudo"], ["aberto", "A vencer"], ["atraso", "Em atraso"], ["pago", "Pago"]] as [Filtro, string][]).map(([k, r]) => (
          <button key={k} type="button" className={`${styles.chip} ${filtro === k ? styles.chipOn : ""}`} onClick={() => setFiltro(k)}>{r}</button>
        ))}
        <span className={styles.sp} />
        <button type="button" className={styles.btn} onClick={() => setNovo(novo === "recorrencia" ? null : "recorrencia")}>+ Recorrente</button>
        <button type="button" className={styles.btn} onClick={() => setNovo(novo === "parcelado" ? null : "parcelado")}>+ Parcelado / a prazo</button>
      </div>
      {novo === "recorrencia" ? <FormRecorrencia ctx={ctx} fechar={() => setNovo(null)} /> : null}
      {novo === "parcelado" ? <FormParcelado ctx={ctx} fechar={() => setNovo(null)} /> : null}
      <div className={styles.lista}>
        {itens.length === 0 ? <div className={styles.vazio}>Nada neste mês.</div> : null}
        {itens.map((i) => (
          <ItemAgenda key={i.chave} ctx={ctx} i={i} aberto={aberto === i.chave} abrir={(v) => setAberto(v ? i.chave : null)} />
        ))}
      </div>
      <p className={styles.dica} style={{ marginTop: 10 }}>
        "Previsto" vem das recorrências e não está gravado: o título nasce quando você paga ou recebe. Parcelados já existem como títulos ("confirmado").
      </p>
    </>
  );
}

function ItemAgenda({ ctx, i, aberto, abrir }: { ctx: Ctx; i: FinItemAgenda; aberto: boolean; abrir: (v: boolean) => void }) {
  const [modo, setModo] = useState<"baixa" | "excecao" | null>(null);
  const [historico, setHistorico] = useState(false);
  const pagar = i.sentido === "pagar";
  const tag =
    i.situacao === "atraso" ? <span className={`${styles.tag} ${styles.tagAtraso}`}>em atraso</span>
    : i.situacao === "pago" ? <span className={`${styles.tag} ${styles.tagPago}`}>{pagar ? "pago" : "recebido"} {dataBr(i.quitadoEm)}</span>
    : i.situacao === "confirmado" ? <span className={`${styles.tag} ${styles.tagConfirmado}`}>confirmado</span>
    : <span className={styles.tag}>previsto</span>;
  const abrirModo = (m: "baixa" | "excecao") => { setModo(m); abrir(true); };
  return (
    <div className={styles.linha}>
      <span className={styles.data}>{dataBr(i.vencimento)}</span>
      <div className={styles.desc}>
        <b>{i.descricao}</b>
        {i.parcela ? ` ${i.parcela}/${i.parcelas}` : ""}
        {tag}
        <small>{pagar ? "Pagamento" : "Recebimento"} · {i.contaGrupoNome}{i.recorrenciaId ? " · recorrente" : ""}</small>
        <div className={styles.acoes}>
          {i.tituloId != null ? (
            <button type="button" className={styles.link} onClick={() => setHistorico(true)}>Histórico</button>
          ) : null}
          {i.situacao !== "pago" ? (
            <button type="button" className={styles.link} onClick={() => abrirModo("baixa")}>{pagar ? "Pagar" : "Receber"}</button>
          ) : (
            <button type="button" className={`${styles.link} ${styles.linkPerigo}`} disabled={ctx.ocupado}
              onClick={() => { if (confirm("Desfazer este pagamento? Os lançamentos dele são apagados.")) void ctx.agir(() => apiDeleteJson(`/api/fin/baixas/${i.tituloId}`), "Pagamento desfeito."); }}>
              Desfazer pagamento
            </button>
          )}
          {i.origem === "recorrencia" ? (
            <>
              <button type="button" className={styles.link} onClick={() => abrirModo("excecao")}>Outro valor neste mês</button>
              <button type="button" className={styles.link} disabled={ctx.ocupado}
                onClick={() => void ctx.agir(() => apiPutJson(`/api/fin/recorrencias/${i.recorrenciaId}/excecoes/${i.referencia}`, { pular: true }), "Este mês foi pulado.")}>
                Pular este mês
              </button>
            </>
          ) : null}
          {i.lote && i.situacao !== "pago" ? (
            <button type="button" className={`${styles.link} ${styles.linkPerigo}`} disabled={ctx.ocupado}
              onClick={() => { if (confirm(`Excluir o parcelamento "${i.descricao}" inteiro (todas as parcelas)?`)) void ctx.agir(() => apiDeleteJson(`/api/fin/parcelados/${i.lote}`), "Parcelamento excluído."); }}>
              Excluir parcelamento
            </button>
          ) : null}
        </div>
        {aberto && modo === "baixa" ? <FormBaixa ctx={ctx} i={i} fechar={() => abrir(false)} /> : null}
        {aberto && modo === "excecao" ? <FormExcecao ctx={ctx} i={i} fechar={() => abrir(false)} /> : null}
        {historico && i.tituloId != null ? <HistoricoTitulo tituloId={i.tituloId} fechar={() => setHistorico(false)} /> : null}
      </div>
      <span className={`${styles.valor} ${pagar ? styles.valorPagar : styles.valorReceber}`}>
        {brl(i.situacao === "pago" ? i.valorPago ?? i.valor : i.valor)}
      </span>
    </div>
  );
}

const TIPO_LANC: Record<FinHistoricoTitulo["lancamentos"][number]["tipo"], string> = {
  registro: "registro",
  pagamento: "pagamento",
  excedente: "excedente",
  juros: "juros/multa",
  desconto: "desconto",
};

/** Janela com tudo o que aconteceu com um título: original, saldos de pagamento parcial e lançamentos. */
function HistoricoTitulo({ tituloId, fechar }: { tituloId: number; fechar: () => void }) {
  const [h, setH] = useState<FinHistoricoTitulo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    apiGet<FinHistoricoTitulo>(`/api/fin/titulos/${tituloId}/historico`).then(setH).catch((e) => setErro(msgErro(e)));
  }, [tituloId]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [fechar]);
  const pagar = h?.sentido !== "receber";
  const cel: React.CSSProperties = { padding: "4px 6px", borderBottom: "1px solid var(--mm-border-muted)", textAlign: "left", fontSize: 13 };
  const num_: React.CSSProperties = { ...cel, textAlign: "right", whiteSpace: "nowrap" };
  return createPortal(
    <div className={janela.overlay} onClick={fechar}>
      <div className={janela.cartao} role="dialog" aria-label="Histórico do título" style={{ width: "min(720px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className={janela.topo}>
          <div>
            <b>Histórico do título</b>
            {h ? <div className={janela.id}>{h.descricao} · {pagar ? "Pagamento" : "Recebimento"}{h.grupo ? ` · ${h.grupo}` : ""}</div> : null}
          </div>
          <button type="button" className={janela.fechar} onClick={fechar} aria-label="Fechar">×</button>
        </div>
        {erro ? <div className={styles.erro}>{erro}</div> : null}
        {!h && !erro ? <div className={janela.carregando}>Carregando…</div> : null}
        {h ? (
          <>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, fontSize: 14 }}>
              <span>Valor original <b>{brl(h.valorOriginal)}</b></span>
              <span>{pagar ? "Pago" : "Recebido"} <b>{brl(h.pago)}</b></span>
              <span>Em aberto <b style={{ color: h.emAberto > 0 ? "var(--mm-danger)" : undefined }}>{brl(h.emAberto)}</b></span>
            </div>
            <div style={{ fontWeight: 600, margin: "8px 0 4px" }}>Títulos</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={cel}>Vencimento</th><th style={cel}>Descrição</th><th style={num_}>Valor</th><th style={cel}>Situação</th><th style={num_}>Pago</th><th style={cel}>Conta</th>
                </tr></thead>
                <tbody>
                  {h.titulos.map((t) => (
                    <tr key={t.id}>
                      <td style={cel}>{dataBr(t.vencimento)}</td>
                      <td style={cel}>
                        {t.descricao}{t.parcela ? ` ${t.parcela}/${t.parcelas}` : ""}
                        {t.saldoDe ? <small style={{ display: "block", color: "var(--mm-muted)" }}>saldo de pagamento parcial</small> : null}
                        {t.memoId ? <a href={`/memo/${t.memoId}/editar`} style={{ display: "block", fontSize: 12 }}>ver comprovante</a> : null}
                      </td>
                      <td style={num_}>{brl(t.valor)}</td>
                      <td style={cel}>{t.situacao === "quitado" ? `${pagar ? "pago" : "recebido"} ${dataBr(t.quitadoEm)}` : "em aberto"}</td>
                      <td style={num_}>{t.valorPago != null ? brl(t.valorPago) : ""}</td>
                      <td style={cel}>{t.contaPagamento ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontWeight: 600, margin: "14px 0 4px" }}>Lançamentos</div>
            {h.lancamentos.length === 0 ? <div className={styles.vazio}>Nenhum lançamento ainda.</div> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={cel}>Data</th><th style={cel}>Tipo</th><th style={cel}>Descrição</th><th style={cel}>Saiu de</th><th style={cel}>Foi para</th><th style={num_}>Valor</th>
                  </tr></thead>
                  <tbody>
                    {h.lancamentos.map((l) => (
                      <tr key={l.id}>
                        <td style={cel}>{dataBr(l.data)}</td>
                        <td style={cel}>{TIPO_LANC[l.tipo]}</td>
                        <td style={cel}>
                          {l.descricao}
                          {l.memoId ? <a href={`/memo/${l.memoId}/editar`} style={{ display: "block", fontSize: 12 }}>ver comprovante</a> : null}
                        </td>
                        <td style={cel}>{l.saiuDe}</td>
                        <td style={cel}>{l.foiPara}</td>
                        <td style={num_}>{brl(l.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {h.lancamentos.some((l) => l.tipo === "registro") ? (
              <p className={styles.dica} style={{ marginTop: 8 }}>"Registro" é o lançamento da compra/venda a prazo: faz a despesa ou receita nascer na data da compra, pelo valor de todas as parcelas, contra Contas a pagar/receber. O dinheiro só sai no pagamento.</p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

function FormBaixa({ ctx, i, fechar }: { ctx: Ctx; i: FinItemAgenda; fechar: () => void }) {
  const pagar = i.sentido === "pagar";
  const [data, setData] = useState(ctx.hoje);
  const [valor, setValor] = useState(String(i.valor).replace(".", ","));
  const [conta, setConta] = useState(i.contaPagamentoId ? String(i.contaPagamentoId) : "");
  const salvar = async () => {
    const ok = await ctx.agir(
      () => apiPostJson("/api/fin/baixas", {
        tituloId: i.tituloId, recorrenciaId: i.tituloId ? null : i.recorrenciaId, referencia: i.tituloId ? null : i.referencia,
        data, valorPago: num(valor), contaPagamentoId: Number(conta),
      }),
      pagar ? "Pagamento registrado." : "Recebimento registrado."
    );
    if (ok) fechar();
  };
  return (
    <div className={styles.form} style={{ marginTop: 8 }}>
      <div className={styles.grade}>
        <label className={styles.campo}>Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
        <label className={styles.campo}>Valor {pagar ? "pago" : "recebido"}<input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
        <label className={styles.campo}>{pagar ? "Saiu de" : "Entrou em"}
          <SelConta valor={conta} onChange={setConta} contas={ctx.contas} tipos={pagar ? ["banco", "corretora", "cartao"] : ["banco", "corretora"]} soReal />
        </label>
      </div>
      {i.tituloId && num(valor) !== i.valor ? (
        <p className={styles.dica}>A diferença vai para {num(valor) > i.valor ? "juros e multas" : "descontos"}.</p>
      ) : null}
      <div className={styles.formAcoes}>
        <button type="button" className={styles.btn} onClick={fechar}>Cancelar</button>
        <button type="button" className={`${styles.btn} ${styles.btnP}`} disabled={ctx.ocupado || !conta || !(num(valor) > 0)} onClick={() => void salvar()}>
          Confirmar
        </button>
      </div>
    </div>
  );
}

function FormExcecao({ ctx, i, fechar }: { ctx: Ctx; i: FinItemAgenda; fechar: () => void }) {
  const [valor, setValor] = useState(String(i.valor).replace(".", ","));
  const salvar = async () => {
    if (await ctx.agir(() => apiPutJson(`/api/fin/recorrencias/${i.recorrenciaId}/excecoes/${i.referencia}`, { valor: num(valor) }), "Valor deste mês alterado.")) fechar();
  };
  return (
    <div className={styles.form} style={{ marginTop: 8 }}>
      <label className={styles.campo}>Valor só em {dataBr(i.referencia)}<input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
      <div className={styles.formAcoes}>
        <button type="button" className={styles.btn} onClick={fechar}>Cancelar</button>
        <button type="button" className={`${styles.btn} ${styles.btnP}`} disabled={ctx.ocupado || !(num(valor) > 0)} onClick={() => void salvar()}>Salvar</button>
      </div>
    </div>
  );
}

function FormRecorrencia({ ctx, fechar }: { ctx: Ctx; fechar: () => void }) {
  const [sentido, setSentido] = useState<"pagar" | "receber">("pagar");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [periodicidade, setPeriodicidade] = useState<FinPeriodicidade>("mensal");
  const [inicio, setInicio] = useState(ctx.hoje);
  const [fim, setFim] = useState("");
  const [grupo, setGrupo] = useState("");
  const [conta, setConta] = useState("");
  const [novo, setNovo] = useState<"grupo" | "conta" | null>(null);
  const salvar = async () => {
    const ok = await ctx.agir(() => apiPostJson("/api/fin/recorrencias", {
      sentido, descricao, valor: num(valor), periodicidade, inicio, fim: fim || null,
      contaGrupoId: Number(grupo), contaPagamentoId: conta ? Number(conta) : null,
    }), "Recorrência criada. Os vencimentos aparecem como previstos.");
    if (ok) fechar();
  };
  return (
    <div className={styles.form}>
      <h3 className={styles.formTitulo}>Nova recorrência (prazo indeterminado)</h3>
      <div className={styles.grade}>
        <label className={styles.campo}>Tipo
          <select value={sentido} onChange={(e) => { setSentido(e.target.value as "pagar" | "receber"); setGrupo(""); setConta(""); }}>
            <option value="pagar">A pagar</option><option value="receber">A receber</option>
          </select>
        </label>
        <label className={styles.campo}>Descrição<input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Aluguel, salário…" /></label>
        <label className={styles.campo}>Valor<input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
        <label className={styles.campo}>Periodicidade
          <select value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value as FinPeriodicidade)}>
            {FIN_PERIODICIDADES.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
          </select>
        </label>
        <label className={styles.campo}>Primeiro vencimento<input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
        <label className={styles.campo}>Termina em (opcional)<input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></label>
        <label className={styles.campo}>
          <span>Grupo de {sentido === "pagar" ? "despesa" : "receita"}
            <button type="button" style={maisLink} onClick={(e) => { e.preventDefault(); setNovo("grupo"); }}>+ novo grupo</button>
          </span>
          <SelConta valor={grupo} onChange={setGrupo} contas={ctx.contas} tipos={sentido === "pagar" ? ["despesa"] : ["receita"]} />
        </label>
        <label className={styles.campo}>
          <span>{sentido === "pagar" ? "Paga normalmente por" : "Recebe normalmente em"} (opcional)
            <button type="button" style={maisLink} onClick={(e) => { e.preventDefault(); setNovo("conta"); }}>+ nova conta</button>
          </span>
          <SelConta valor={conta} onChange={setConta} contas={ctx.contas} tipos={sentido === "pagar" ? ["banco", "corretora", "cartao"] : ["banco", "corretora"]} vazio="— nenhuma —" soReal />
        </label>
      </div>
      {novo ? (
        <NovoCadastro
          qual={novo}
          sentido={sentido}
          onFechar={() => setNovo(null)}
          onCriado={(c) => {
            const qual = novo;
            setNovo(null);
            void ctx.recarregar().then(() => (qual === "grupo" ? setGrupo(String(c.id)) : setConta(String(c.id))));
          }}
        />
      ) : null}
      <p className={styles.dica}>Nada é gravado adiantado: o motor calcula os vencimentos.</p>
      <div className={styles.formAcoes}>
        <button type="button" className={styles.btn} onClick={fechar}>Cancelar</button>
        <button type="button" className={`${styles.btn} ${styles.btnP}`} disabled={ctx.ocupado || !descricao.trim() || !(num(valor) > 0) || !grupo || !inicio} onClick={() => void salvar()}>Criar</button>
      </div>
    </div>
  );
}

function FormParcelado({ ctx, fechar }: { ctx: Ctx; fechar: () => void }) {
  const [sentido, setSentido] = useState<"pagar" | "receber">("pagar");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [parcelas, setParcelas] = useState("1");
  const [primeiro, setPrimeiro] = useState(ctx.hoje);
  const [competencia, setCompetencia] = useState(ctx.hoje);
  const [grupo, setGrupo] = useState("");
  const [novoGrupo, setNovoGrupo] = useState(false);
  const n = Math.max(1, Math.floor(Number(parcelas) || 1));
  const salvar = async () => {
    const ok = await ctx.agir(() => apiPostJson("/api/fin/parcelados", {
      sentido, descricao, valorTotal: num(valor), parcelas: n, primeiroVencimento: primeiro,
      contaGrupoId: Number(grupo), dataCompetencia: competencia,
    }), `${n} título(s) gravado(s).`);
    if (ok) fechar();
  };
  return (
    <div className={styles.form}>
      <h3 className={styles.formTitulo}>Parcelado ou a prazo (prazo determinado)</h3>
      <div className={styles.grade}>
        <label className={styles.campo}>Tipo
          <select value={sentido} onChange={(e) => { setSentido(e.target.value as "pagar" | "receber"); setGrupo(""); }}>
            <option value="pagar">A pagar (compra)</option><option value="receber">A receber (venda)</option>
          </select>
        </label>
        <label className={styles.campo}>Descrição<input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Geladeira, IPTU…" /></label>
        <label className={styles.campo}>Valor total<input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
        <label className={styles.campo}>Parcelas<input type="number" min={1} max={360} value={parcelas} onChange={(e) => setParcelas(e.target.value)} /></label>
        <label className={styles.campo}>1º vencimento<input type="date" value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} /></label>
        <label className={styles.campo}>Data da {sentido === "pagar" ? "compra" : "venda"}<input type="date" value={competencia} onChange={(e) => setCompetencia(e.target.value)} /></label>
        <label className={styles.campo}>
          <span>Grupo de {sentido === "pagar" ? "despesa" : "receita"}
            <button type="button" style={maisLink} onClick={(e) => { e.preventDefault(); setNovoGrupo(true); }}>+ novo grupo</button>
          </span>
          <SelConta valor={grupo} onChange={setGrupo} contas={ctx.contas} tipos={sentido === "pagar" ? ["despesa"] : ["receita"]} />
        </label>
        {novoGrupo ? (
          <NovoCadastro qual="grupo" sentido={sentido} onFechar={() => setNovoGrupo(false)}
            onCriado={(c) => { setNovoGrupo(false); void ctx.recarregar().then(() => setGrupo(String(c.id))); }} />
        ) : null}
      </div>
      {num(valor) > 0 ? <p className={styles.dica}>{n}x de cerca de {brl(num(valor) / n)}, mensais. A {sentido === "pagar" ? "despesa" : "receita"} entra na data da {sentido === "pagar" ? "compra" : "venda"}.</p> : null}
      <div className={styles.formAcoes}>
        <button type="button" className={styles.btn} onClick={fechar}>Cancelar</button>
        <button type="button" className={`${styles.btn} ${styles.btnP}`} disabled={ctx.ocupado || !descricao.trim() || !(num(valor) > 0) || !grupo} onClick={() => void salvar()}>Gravar títulos</button>
      </div>
    </div>
  );
}

/* ---------------- Lançamentos ---------------- */

function AbaLancamentos({ ctx, lancs }: { ctx: Ctx; lancs: FinLancamento[] }) {
  const [novo, setNovo] = useState<"lanc" | "venda" | null>(null);
  return (
    <>
      <div className={styles.barra}>
        <span className={styles.dica}>Débito, cartão, fatura, transferência, aplicação, dividendo, desdobramento.</span>
        <span className={styles.sp} />
        <button type="button" className={styles.btn} onClick={() => setNovo(novo === "lanc" ? null : "lanc")}>+ Lançamento</button>
        <button type="button" className={styles.btn} onClick={() => setNovo(novo === "venda" ? null : "venda")}>Venda de investimento</button>
      </div>
      {novo === "lanc" ? <FormLancamento ctx={ctx} fechar={() => setNovo(null)} /> : null}
      {novo === "venda" ? <FormVenda ctx={ctx} fechar={() => setNovo(null)} /> : null}
      <div className={styles.lista}>
        {lancs.length === 0 ? <div className={styles.vazio}>Nenhum lançamento neste mês.</div> : null}
        {lancs.map((l) => (
          <div key={l.id} className={styles.linha}>
            <span className={styles.data}>{dataBr(l.data)}</span>
            <div className={styles.desc}>
              <b>{l.descricao}</b>
              {l.registro ? <span className={`${styles.tag} ${styles.tagConfirmado}`} title="Compra/venda a prazo: a despesa ou receita nasce aqui, contra Contas a pagar/receber. O dinheiro só sai no pagamento.">registro</span> : null}
              <small>{l.contaOrigemNome} → {l.contaDestinoNome}{l.quantidade ? ` · qtd ${l.quantidade > 0 ? "+" : ""}${l.quantidade}${l.preco ? ` a ${l.moeda ? emMoeda(l.preco, l.moeda) : brl(l.preco)}` : ""}` : ""}</small>
              {l.moeda && l.valorMoeda != null ? <small>{emMoeda(l.valorMoeda, l.moeda)}{l.cotacao ? ` · cotação ${cot(l.cotacao)}` : ""}</small> : null}
              {!l.tituloId && !l.registro ? (
                <div className={styles.acoes}>
                  <button type="button" className={`${styles.link} ${styles.linkPerigo}`} disabled={ctx.ocupado}
                    onClick={() => { if (confirm("Excluir este lançamento?")) void ctx.agir(() => apiDeleteJson(`/api/fin/lancamentos/${l.id}`), "Lançamento excluído."); }}>
                    Excluir
                  </button>
                </div>
              ) : null}
            </div>
            <span className={styles.valor}>{brl(l.valor)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function FormLancamento({ ctx, fechar }: { ctx: Ctx; fechar: () => void }) {
  const [data, setData] = useState(ctx.hoje);
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [valorMoeda, setValorMoeda] = useState("");
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [qtd, setQtd] = useState("");
  const [cotacao, setCotacao] = useState<{ data: string; valor: number } | null>(null);
  const livres = ctx.todas.filter((c) => c.ativo && c.tipo !== "a_pagar" && c.tipo !== "a_receber");
  const o = livres.find((c) => String(c.id) === origem);
  const d = livres.find((c) => String(c.id) === destino);
  const temInvest = o?.tipo === "investimento" || d?.tipo === "investimento";
  // Moedas (13.10): qual valor pedir depende de onde sai e para onde vai
  const moeda = o && o.moeda !== "BRL" ? o.moeda : d && d.moeda !== "BRL" ? d.moeda : null;
  const caso: "real" | "cambioIda" | "entradaCotacao" | "saidaCusto" | "cambioVolta" | null =
    !o || !d ? null
    : !moeda ? "real"
    : o.moeda === "BRL" ? (ehDinheiro(o.tipo) ? "cambioIda" : "entradaCotacao")
    : d.moeda === "BRL" && ehDinheiro(d.tipo) ? "cambioVolta" : "saidaCusto";
  const pedeReais = caso === "real" || caso === "cambioIda" || caso === "cambioVolta" || caso === "entradaCotacao";
  useEffect(() => {
    if (!moeda) { setCotacao(null); return; }
    apiGet<{ cotacao: { data: string; valor: number } | null }>(`/api/fin/cotacao?moeda=${moeda}&data=${data}`)
      .then((r) => setCotacao(r.cotacao)).catch(() => setCotacao(null));
  }, [moeda, data]);
  const salvar = async () => {
    let msg = "Lançamento gravado.";
    const ok = await ctx.agir(async () => {
      const r = await apiPostJson<{ valor: number; resultado: number | null }>("/api/fin/lancamentos", {
        data, descricao,
        valor: pedeReais && valor ? num(valor) : caso === "real" ? 0 : null,
        valorMoeda: moeda && valorMoeda ? num(valorMoeda) : null,
        contaOrigemId: Number(origem), contaDestinoId: Number(destino),
        quantidade: temInvest && qtd ? num(qtd) : null,
      });
      if (caso === "saidaCusto") msg = `Lançamento gravado: ${brl(r.valor)} pelo custo médio.`;
      if (caso === "entradaCotacao" && !valor) msg = `Lançamento gravado: ${brl(r.valor)} pela cotação PTAX.`;
      if (r.resultado != null) msg = `Câmbio gravado: ${r.resultado >= 0 ? "ganho" : "perda"} cambial de ${brl(Math.abs(r.resultado))}.`;
    }, undefined);
    if (ok) { fechar(); alert(msg); }
  };
  const vm = num(valorMoeda);
  const vr = num(valor);
  return (
    <div className={styles.form}>
      <h3 className={styles.formTitulo}>Novo lançamento</h3>
      <div className={styles.grade}>
        <label className={styles.campo}>Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
        <label className={styles.campo}>Descrição<input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Mercado, fatura, remessa…" /></label>
        <label className={styles.campo}>De onde sai<SelConta valor={origem} onChange={setOrigem} contas={livres} /></label>
        <label className={styles.campo}>Para onde vai<SelConta valor={destino} onChange={setDestino} contas={livres} /></label>
        {moeda ? (
          <label className={styles.campo}>Valor em {moeda}<input inputMode="decimal" value={valorMoeda} onChange={(e) => setValorMoeda(e.target.value)} /></label>
        ) : null}
        {pedeReais ? (
          <label className={styles.campo}>
            {caso === "cambioIda" ? "Quanto saiu em reais" : caso === "cambioVolta" ? "Quanto entrou em reais" : caso === "entradaCotacao" ? "Valor em reais (opcional)" : "Valor"}
            <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={caso === "entradaCotacao" ? "vazio = cotação PTAX" : ""} />
          </label>
        ) : null}
        {temInvest ? <label className={styles.campo}>Quantidade<input inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} /></label> : null}
      </div>
      {moeda ? (
        <p className={styles.dica}>
          {cotacao ? `PTAX do ${moeda}: ${cot(cotacao.valor)} em ${dataBr(cotacao.data)}. ` : `Sem cotação do ${moeda} para esta data. `}
          {caso === "cambioIda" && vm > 0 && vr > 0 ? `Cotação desta operação: ${cot(vr / vm)}. ` : ""}
          {caso === "saidaCusto" ? `Sai pelo custo médio em reais de ${o?.nome}. ` : ""}
          {caso === "cambioVolta" ? "Sai pelo custo médio; a diferença para o que entrou em reais vira ganho ou perda cambial. " : ""}
        </p>
      ) : (
        <p className={styles.dica}>
          Exemplos: mercado no débito = Itaú → Alimentação; no cartão = Nubank → Alimentação; fatura = Itaú → Nubank;
          compra de ação = Corretora → PETR4 (com quantidade); desdobramento = PETR4 → PETR4, valor 0, quantidade a mais;
          remessa para o exterior = Itaú → conta em dólar.
        </p>
      )}
      <div className={styles.formAcoes}>
        <button type="button" className={styles.btn} onClick={fechar}>Cancelar</button>
        <button type="button" className={`${styles.btn} ${styles.btnP}`} disabled={ctx.ocupado || !origem || !destino} onClick={() => void salvar()}>Gravar</button>
      </div>
    </div>
  );
}

function FormVenda({ ctx, fechar }: { ctx: Ctx; fechar: () => void }) {
  const [papel, setPapel] = useState("");
  const [destino, setDestino] = useState("");
  const [data, setData] = useState(ctx.hoje);
  const [qtd, setQtd] = useState("");
  const [valor, setValor] = useState("");
  const salvar = async () => {
    let msg = "";
    const ok = await ctx.agir(async () => {
      const r = await apiPostJson<{ custo: number; resultado: number; moeda: string }>("/api/fin/investimentos/venda", {
        contaPapelId: Number(papel), contaDestinoId: Number(destino), data, quantidade: num(qtd), valorTotal: num(valor),
      });
      msg = `Venda gravada: custo ${emMoeda(r.custo, r.moeda)}, ${r.resultado >= 0 ? "ganho" : "perda"} de ${emMoeda(Math.abs(r.resultado), r.moeda)}.`;
    });
    if (ok) { fechar(); if (msg) alert(msg); }
  };
  const p = ctx.contas.find((c) => String(c.id) === papel);
  return (
    <div className={styles.form}>
      <h3 className={styles.formTitulo}>Venda de investimento</h3>
      <div className={styles.grade}>
        <label className={styles.campo}>Papel<SelConta valor={papel} onChange={setPapel} contas={ctx.contas} tipos={["investimento"]} /></label>
        <label className={styles.campo}>Recebe em<SelConta valor={destino} onChange={setDestino} contas={ctx.contas.filter((c) => !p || c.moeda === p.moeda)} tipos={["corretora", "banco"]} /></label>
        <label className={styles.campo}>Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
        <label className={styles.campo}>Quantidade<input inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} /></label>
        <label className={styles.campo}>Valor total da venda{p && p.moeda !== "BRL" ? ` (${p.moeda})` : ""}<input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
      </div>
      {p ? (
        <p className={styles.dica}>
          Posição: {p.quantidade ?? 0} · custo médio {p.moeda !== "BRL" && p.custoMedioMoeda != null ? `${emMoeda(p.custoMedioMoeda, p.moeda)} (${p.custoMedio != null ? brl(p.custoMedio) : "—"})` : p.custoMedio != null ? brl(p.custoMedio) : "—"}.
          A diferença para o custo vira ganho ou perda{p.moeda !== "BRL" ? `, em ${p.moeda}, convertida em reais pela cotação do dia` : ""}. Recebe numa conta em {p.moeda}.
        </p>
      ) : null}
      <div className={styles.formAcoes}>
        <button type="button" className={styles.btn} onClick={fechar}>Cancelar</button>
        <button type="button" className={`${styles.btn} ${styles.btnP}`} disabled={ctx.ocupado || !papel || !destino || !(num(qtd) > 0) || !(num(valor) > 0)} onClick={() => void salvar()}>Gravar venda</button>
      </div>
    </div>
  );
}

/* ---------------- Contas ---------------- */

const ORDEM_TIPOS: FinTipoConta[] = ["banco", "cartao", "corretora", "investimento", "a_receber", "a_pagar", "receita", "despesa", "patrimonio"];

function AbaContas({ ctx, conf }: { ctx: Ctx; conf: FinConferencia | null }) {
  const [nova, setNova] = useState(false);
  return (
    <>
      <div className={styles.barra}>
        {conf ? (
          <span className={styles.dica} style={{ color: conf.ok ? "var(--mm-success)" : "var(--mm-danger)" }}>
            {conf.ok ? "✓ Contas a pagar e a receber conferem com os títulos em aberto." : `⚠ Não confere: a pagar ${brl(conf.aPagarSaldo)} × títulos ${brl(conf.aPagarTitulos)}; a receber ${brl(conf.aReceberSaldo)} × títulos ${brl(conf.aReceberTitulos)}.`}
          </span>
        ) : null}
        <span className={styles.sp} />
        <button type="button" className={styles.btn} onClick={() => setNova(!nova)}>+ Conta</button>
      </div>
      {nova ? <FormConta ctx={ctx} fechar={() => setNova(false)} /> : null}
      {ORDEM_TIPOS.map((t) => {
        const lista = ctx.todas.filter((c) => c.tipo === t);
        if (!lista.length) return null;
        const periodo = t === "despesa" || t === "receita";
        return (
          <div key={t}>
            <div className={styles.secao}>{rotuloTipo(t)}{periodo ? " — total do mês" : t === "cartao" || t === "a_pagar" ? " — quanto deve" : " — saldo (em reais)"}</div>
            <div className={styles.lista}>
              {lista.map((c) => (
                <div key={c.id} className={styles.linha} style={{ opacity: c.ativo ? 1 : 0.55 }}>
                  <span className={styles.data}>{c.papel ?? ""}</span>
                  <div className={styles.desc}>
                    <b>{c.nome}</b>{c.moeda !== "BRL" ? <span className={styles.tag}>{c.moeda}</span> : null}{c.mercado === "exterior" ? <span className={styles.tag}>exterior</span> : null}{c.ativo ? "" : <span className={styles.tag}>inativa</span>}
                    {c.tipo === "investimento" ? (
                      <small>
                        Quantidade {c.quantidade ?? 0} · custo médio {c.moeda !== "BRL" && c.custoMedioMoeda != null ? `${emMoeda(c.custoMedioMoeda, c.moeda)} (${c.custoMedio != null ? brl(c.custoMedio) : "—"})` : c.custoMedio != null ? brl(c.custoMedio) : "—"}
                      </small>
                    ) : null}
                    {c.moeda !== "BRL" && c.saldoMoeda != null ? (
                      <small>
                        {emMoeda(c.saldoMoeda, c.moeda)} · custo {brl(c.saldo)}
                        {c.valorHoje != null && c.cotacao ? ` · hoje ${brl(c.valorHoje)} (cotação ${cot(c.cotacao.valor)} em ${dataBr(c.cotacao.data)}; ${c.valorHoje - c.saldo >= 0 ? "+" : "−"}${brl(Math.abs(c.valorHoje - c.saldo))} de variação cambial)` : ""}
                      </small>
                    ) : null}
                    {!c.chave ? (
                      <div className={styles.acoes}>
                        <button type="button" className={styles.link} disabled={ctx.ocupado}
                          onClick={() => { const nome = prompt("Novo nome da conta:", c.nome); if (nome && nome.trim()) void ctx.agir(() => apiPatchJson(`/api/fin/contas/${c.id}`, { nome })); }}>
                          Renomear
                        </button>
                        <button type="button" className={styles.link} disabled={ctx.ocupado}
                          onClick={() => void ctx.agir(() => apiPatchJson(`/api/fin/contas/${c.id}`, { ativo: !c.ativo }))}>
                          {c.ativo ? "Desativar" : "Reativar"}
                        </button>
                        {c.mercado ? (
                          <button type="button" className={styles.link} disabled={ctx.ocupado}
                            onClick={() => void ctx.agir(() => apiPatchJson(`/api/fin/contas/${c.id}`, { mercado: c.mercado === "exterior" ? "local" : "exterior" }))}>
                            {c.mercado === "exterior" ? "Marcar como Brasil" : "Marcar como exterior"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <span className={styles.valor}>{brl(c.saldo)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function FormConta({ ctx, fechar }: { ctx: Ctx; fechar: () => void }) {
  const [tipo, setTipo] = useState<FinTipoConta>("banco");
  const [nome, setNome] = useState("");
  const [papel, setPapel] = useState("");
  const [corretora, setCorretora] = useState("");
  const [saldo, setSaldo] = useState("");
  const [saldoReais, setSaldoReais] = useState("");
  const [moeda, setMoeda] = useState("BRL");
  const [mercado, setMercado] = useState<"local" | "exterior">("local");
  const [dataSaldo, setDataSaldo] = useState(ctx.hoje);
  const comSaldo = tipo === "banco" || tipo === "corretora" || tipo === "cartao";
  const comMoeda = ehDinheiro(tipo);
  const salvar = async () => {
    const ok = await ctx.agir(() => apiPostJson("/api/fin/contas", {
      tipo, nome: nome || (tipo === "investimento" ? papel.toUpperCase() : ""),
      papel: tipo === "investimento" ? papel : null,
      corretoraContaId: tipo === "investimento" && corretora ? Number(corretora) : null,
      moeda: comMoeda ? moeda : "BRL",
      mercado: comMoeda ? mercado : null,
      saldoInicial: comSaldo && saldo ? num(saldo) : null, dataSaldo: comSaldo && saldo ? dataSaldo : null,
      saldoInicialReais: comSaldo && saldo && moeda !== "BRL" && saldoReais ? num(saldoReais) : null,
    }), "Conta criada.");
    if (ok) fechar();
  };
  return (
    <div className={styles.form}>
      <h3 className={styles.formTitulo}>Nova conta</h3>
      <div className={styles.grade}>
        <label className={styles.campo}>Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as FinTipoConta)}>
            {FIN_TIPOS_CONTA.filter((t) => t.manual).map((t) => <option key={t.tipo} value={t.tipo}>{t.rotulo}</option>)}
          </select>
        </label>
        {tipo === "investimento" ? (
          <>
            <label className={styles.campo}>Papel (ticker)<input value={papel} onChange={(e) => setPapel(e.target.value)} placeholder="PETR4, Tesouro IPCA 2035…" /></label>
            <label className={styles.campo}>Corretora<SelConta valor={corretora} onChange={setCorretora} contas={ctx.contas} tipos={["corretora", "banco"]} vazio="— nenhuma —" /></label>
          </>
        ) : null}
        {comMoeda ? (
          <label className={styles.campo}>Moeda
            <select value={moeda} onChange={(e) => { setMoeda(e.target.value); setMercado(e.target.value === "BRL" ? "local" : "exterior"); }}>
              {FIN_MOEDAS.map((m) => <option key={m.codigo} value={m.codigo}>{m.codigo} — {m.rotulo}</option>)}
            </select>
          </label>
        ) : null}
        {comMoeda ? (
          <label className={styles.campo}>Mercado
            <select value={mercado} onChange={(e) => setMercado(e.target.value as "local" | "exterior")}>
              <option value="local">Brasil</option>
              <option value="exterior">Exterior</option>
            </select>
          </label>
        ) : null}
        <label className={styles.campo}>Nome{tipo === "investimento" ? " (opcional)" : ""}<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={tipo === "investimento" ? "PETR4 – Clear" : ""} /></label>
        {comSaldo ? (
          <>
            <label className={styles.campo}>{tipo === "cartao" ? "Dívida atual (opcional)" : "Saldo atual (opcional)"}{moeda !== "BRL" ? ` em ${moeda}` : ""}<input inputMode="decimal" value={saldo} onChange={(e) => setSaldo(e.target.value)} /></label>
            <label className={styles.campo}>Saldo em<input type="date" value={dataSaldo} onChange={(e) => setDataSaldo(e.target.value)} /></label>
            {moeda !== "BRL" && saldo ? (
              <label className={styles.campo}>Quanto custou em reais (opcional)<input inputMode="decimal" value={saldoReais} onChange={(e) => setSaldoReais(e.target.value)} placeholder="vazio = cotação PTAX da data" /></label>
            ) : null}
          </>
        ) : null}
      </div>
      {comMoeda ? <p className={styles.dica}>Mercado: segue a moeda, mas pode trocar — BDR e fundo cambial são do Brasil em reais; Avenue e Nomad são exterior.</p> : null}
      {tipo === "investimento" ? <p className={styles.dica}>Uma conta por papel em cada corretora. A posição atual entra como lançamento: de Saldo inicial → este papel, com a quantidade.</p> : null}
      <div className={styles.formAcoes}>
        <button type="button" className={styles.btn} onClick={fechar}>Cancelar</button>
        <button type="button" className={`${styles.btn} ${styles.btnP}`} disabled={ctx.ocupado || !(nome.trim() || (tipo === "investimento" && papel.trim()))} onClick={() => void salvar()}>Criar</button>
      </div>
    </div>
  );
}

/* ---------------- Recorrências ---------------- */

function AbaRecorrencias({ ctx, recs }: { ctx: Ctx; recs: Recorrencia[] }) {
  const [ver, setVer] = useState<number | null>(null);
  const [nova, setNova] = useState(false);
  const per = (p: FinPeriodicidade) => FIN_PERIODICIDADES.find((x) => x.valor === p)?.rotulo.toLowerCase() ?? p;
  return (
    <>
      <div className={styles.barra}>
        <span className={styles.dica}>Reajuste e encerramento valem só para os vencimentos ainda não pagos.</span>
        <span className={styles.sp} />
        <button type="button" className={styles.btn} onClick={() => setNova(!nova)}>+ Recorrente</button>
      </div>
      {nova ? <FormRecorrencia ctx={ctx} fechar={() => setNova(false)} /> : null}
      <div className={styles.lista}>
        {recs.length === 0 ? <div className={styles.vazio}>Nenhuma recorrência.</div> : null}
        {recs.map((r) => (
          <div key={r.id} className={styles.linha} style={{ opacity: r.ativo ? 1 : 0.55 }}>
            <span className={styles.data}>{r.sentido === "pagar" ? "Pagamento" : "Recebimento"}</span>
            <div className={styles.desc}>
              <b>{r.descricao}</b>{r.ativo ? "" : <span className={styles.tag}>encerrada</span>}
              <small>{per(r.periodicidade)} desde {dataBr(r.inicio)}{r.fim ? ` até ${dataBr(r.fim)}` : ""} · {r.contaGrupoNome}</small>
              {r.excecoes.length ? (
                <small>
                  Exceções: {r.excecoes.map((x) => (
                    <span key={x.referencia}>
                      {dataBr(x.referencia)} {x.pular ? "pulado" : brl(x.valor ?? 0)}{" "}
                      <button type="button" className={styles.link} disabled={ctx.ocupado}
                        onClick={() => void ctx.agir(() => apiPutJson(`/api/fin/recorrencias/${r.id}/excecoes/${x.referencia}`, { remover: true }))}>
                        desfazer
                      </button>{"  "}
                    </span>
                  ))}
                </small>
              ) : null}
              <div className={styles.acoes}>
                <button type="button" className={styles.link} onClick={() => setVer(r.id)}>Ocorrências</button>
                <button type="button" className={styles.link} disabled={ctx.ocupado}
                  onClick={() => { const v = prompt("Novo valor (vale para os vencimentos ainda não pagos):", String(r.valor).replace(".", ",")); if (v && num(v) > 0) void ctx.agir(() => apiPatchJson(`/api/fin/recorrencias/${r.id}`, { valor: num(v) }), "Valor reajustado."); }}>
                  Reajustar
                </button>
                <button type="button" className={styles.link} disabled={ctx.ocupado}
                  onClick={() => { const f = prompt("Último vencimento (AAAA-MM-DD). Vazio = sem fim:", r.fim ?? ctx.hoje); if (f !== null) void ctx.agir(() => apiPatchJson(`/api/fin/recorrencias/${r.id}`, { fim: f.trim() || null }), "Fim alterado."); }}>
                  Definir fim
                </button>
                <button type="button" className={`${styles.link} ${r.ativo ? styles.linkPerigo : ""}`} disabled={ctx.ocupado}
                  onClick={() => void ctx.agir(() => apiPatchJson(`/api/fin/recorrencias/${r.id}`, { ativo: !r.ativo }))}>
                  {r.ativo ? "Encerrar" : "Reativar"}
                </button>
              </div>
            </div>
            <span className={`${styles.valor} ${r.sentido === "pagar" ? styles.valorPagar : styles.valorReceber}`}>{brl(r.valor)}</span>
          </div>
        ))}
      </div>
      {ver != null ? <OcorrenciasRecorrencia id={ver} fechar={() => setVer(null)} /> : null}
    </>
  );
}

const SIT_OCORR: Record<FinOcorrenciasRecorrencia["itens"][number]["situacao"], string> = {
  pago: "pago",
  aberto: "em aberto (título)",
  atraso: "em atraso",
  previsto: "previsto",
  pulado: "pulado",
};

/** Janela com o que a recorrência já gerou em contas a pagar/receber e os próximos vencimentos. */
function OcorrenciasRecorrencia({ id, fechar }: { id: number; fechar: () => void }) {
  const [o, setO] = useState<FinOcorrenciasRecorrencia | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [historico, setHistorico] = useState<number | null>(null);
  useEffect(() => {
    apiGet<FinOcorrenciasRecorrencia>(`/api/fin/recorrencias/${id}/ocorrencias`).then(setO).catch((e) => setErro(msgErro(e)));
  }, [id]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && historico == null) fechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [fechar, historico]);
  const pagar = o?.sentido !== "receber";
  const cel: React.CSSProperties = { padding: "4px 6px", borderBottom: "1px solid var(--mm-border-muted)", textAlign: "left", fontSize: 13 };
  const num_: React.CSSProperties = { ...cel, textAlign: "right", whiteSpace: "nowrap" };
  const cor = (s: string) =>
    s === "pago" ? "var(--mm-primary, #0d9488)" : s === "atraso" ? "var(--mm-danger)" : s === "pulado" ? "var(--mm-muted)" : undefined;
  return createPortal(
    <div className={janela.overlay} onClick={fechar}>
      <div className={janela.cartao} role="dialog" aria-label="Ocorrências da recorrência" style={{ width: "min(720px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className={janela.topo}>
          <div>
            <b>Ocorrências da recorrência</b>
            {o ? <div className={janela.id}>{o.descricao} · {pagar ? "Pagamento" : "Recebimento"} · {pagar ? "pago" : "recebido"} até hoje {brl(o.pago)}</div> : null}
          </div>
          <button type="button" className={janela.fechar} onClick={fechar} aria-label="Fechar">×</button>
        </div>
        {erro ? <div className={styles.erro}>{erro}</div> : null}
        {!o && !erro ? <div className={janela.carregando}>Carregando…</div> : null}
        {o ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={cel}>Vencimento</th><th style={num_}>Valor</th><th style={cel}>Situação</th><th style={num_}>Pago</th><th style={cel}>Conta</th><th style={cel} />
              </tr></thead>
              <tbody>
                {o.itens.map((i) => (
                  <tr key={i.referencia}>
                    <td style={cel}>{dataBr(i.referencia)}</td>
                    <td style={num_}>{brl(i.valor)}{i.excecao ? <small style={{ display: "block", color: "var(--mm-muted)" }}>outro valor neste mês</small> : null}</td>
                    <td style={{ ...cel, color: cor(i.situacao) }}>{SIT_OCORR[i.situacao]}{i.quitadoEm ? ` ${dataBr(i.quitadoEm)}` : ""}</td>
                    <td style={num_}>{i.valorPago != null ? brl(i.valorPago) : ""}</td>
                    <td style={cel}>{i.contaPagamento ?? ""}</td>
                    <td style={cel}>
                      {i.tituloId != null ? <button type="button" className={styles.link} onClick={() => setHistorico(i.tituloId)}>Histórico</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.dica} style={{ marginTop: 8 }}>
              "Pago" e "em aberto (título)" já estão gravados em contas a pagar/receber; "previsto" e "em atraso" são só a previsão da regra (o título nasce quando você paga).
            </p>
          </div>
        ) : null}
        {historico != null ? <HistoricoTitulo tituloId={historico} fechar={() => setHistorico(null)} /> : null}
      </div>
    </div>,
    document.body
  );
}

/* ---------------- Fale comigo (ajustes) ---------------- */

/** Como o Fale comigo grava no financeiro deste espaço. No grupo, só o dono muda. */
function AbaFaleComigo() {
  const [cfg, setCfg] = useState<FinConfigResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    apiGet<FinConfigResposta>("/api/fin/config").then(setCfg).catch((e) => setErro(msgErro(e)));
  }, []);

  async function mudar(campo: keyof FinConfig, valor: boolean) {
    setErro(null);
    setSalvo(false);
    try {
      setCfg(await apiPatchJson<FinConfigResposta>("/api/fin/config", { [campo]: valor }));
      setSalvo(true);
    } catch (e) {
      setErro(msgErro(e));
    }
  }

  if (!cfg) return erro ? <div className={styles.erro}>{erro}</div> : <div className={styles.vazio}>Carregando…</div>;
  const itens: [keyof FinConfig, string, string][] = [
    ["gravarDireto", "Gravar sem confirmar quando estiver completo",
      "Se a frase trouxer tudo (valor, grupo, conta…) sem dúvida, grava na hora e o cartão já vem gravado, com Desfazer. Faltando algo, o cartão abre para conferir."],
    ["criarGrupo", "Cadastrar grupo de despesa/receita pelo cartão",
      "Mostra \"+ novo grupo\" ao lado do grupo no cartão, para cadastrar na hora o que ainda não existe."],
    ["criarConta", "Cadastrar conta ou cartão pelo cartão",
      "Mostra \"+ nova conta\" ao lado da conta no cartão (banco, cartão de crédito ou corretora)."],
  ];
  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 640 }}>
      <p className={styles.sub}>Como as frases de dinheiro do Fale comigo (gastei, paguei, vence dia 10…) gravam aqui.</p>
      {itens.map(([k, titulo, desc]) => (
        <label key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: cfg.podeEditar ? "pointer" : "default" }}>
          <input type="checkbox" checked={cfg[k]} disabled={!cfg.podeEditar} onChange={(e) => void mudar(k, e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <b>{titulo}</b>
            <br />
            <small style={{ color: "var(--mm-muted)" }}>{desc}</small>
          </span>
        </label>
      ))}
      {!cfg.podeEditar ? <small style={{ color: "var(--mm-muted)" }}>Só o dono do grupo muda estes ajustes.</small> : null}
      {erro ? <div className={styles.erro}>{erro}</div> : null}
      {salvo ? <div className={styles.ok}>Salvo.</div> : null}
    </div>
  );
}
