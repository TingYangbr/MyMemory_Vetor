import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { MeResponse } from "@mymemory/shared";
import { apiGet, apiGetOptional, avisos as avisosApi } from "../../api";
import Header from "../../components/Header";
import {
  IconArrowLeft,
  IconBell,
  IconCalendar,
  IconChat,
  IconChevronDown,
  IconEdit,
  IconEye,
  IconHistory,
  IconInfo,
  IconMail,
  IconRefresh,
  IconSend,
  IconTrash,
  IconX,
} from "../../components/icons";
import { pedirPerguntaAgora } from "../../lib/perguntarAgora";
import styles from "./acompanhar.module.css";

/** Lote 3: Meus avisos e lembretes (novo visual), ao lado da tela antiga /avisos. */

type FreqTipo = "horas" | "diaria" | "semanal" | "mensal";

interface AvisoRow {
  id: number;
  descricao: string;
  perguntaOriginal: string;
  frequenciaTipo: FreqTipo;
  frequenciaHoras: number | null;
  canalDestino: string;
  proximaExecucao: string | null;
  status: "ativo" | "pausado";
  createdAt: string;
  ultimoaviso: string | null;
  ultimoavisotexto: string | null;
  textoRespostaInicial: string | null;
}

interface HistoricoItem {
  id: number;
  enviadoEm?: string;
  enviadoem?: string;
  texto: string;
}

interface Lembrete {
  id: string;
  memoId: number;
  categoria: string | null;
  titulo: string | null;
  texto: string | null;
  momento: string;
  hora: string;
  noPrazo: boolean;
  envios: { enviarEm: string; situacao: "agendado" | "enviado" | "ignorado" }[];
}

function freqTexto(tipo: FreqTipo, horas: number | null): string {
  if (tipo === "horas") return `a cada ${horas ?? 1} hora${(horas ?? 1) !== 1 ? "s" : ""}`;
  if (tipo === "diaria") return "todo dia";
  if (tipo === "semanal") return "toda semana";
  return "todo mês";
}

function dataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86_400_000);
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === hoje.toDateString()) return `hoje ${hm}`;
  if (d.toDateString() === ontem.toDateString()) return `ontem ${hm}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hm}`;
}

function haQuanto(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "";
  const min = Math.round(ms / 60_000);
  if (min < 60) return min <= 1 ? "agora" : `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return dataHora(iso);
}

/** Tira o ⚠️ do começo e os ** de negrito do texto do aviso. */
function textoLimpo(t: string): string {
  return t.replace(/^⚠️?\s*/u, "").replace(/\*\*([^*]+)\*\*/g, "$1").trim();
}

function msgErro(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try { return (JSON.parse(raw) as { message?: string }).message ?? raw; } catch { return raw; }
}

// ─── Painel do aviso: histórico + ajustes ────────────────────────────────────

function AvisoPainel(props: { aviso: AvisoRow; onFechar: () => void; onSalvo: (a: AvisoRow) => void }) {
  const navigate = useNavigate();
  const a = props.aviso;
  const [freq, setFreq] = useState<FreqTipo>(a.frequenciaTipo);
  const [horas, setHoras] = useState<number>(a.frequenciaHoras ?? 4);
  const [email, setEmail] = useState(a.canalDestino);
  const [hist, setHist] = useState<HistoricoItem[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const carregarHist = useCallback(async () => {
    try {
      const r = await apiGet<{ aviso: { historico: HistoricoItem[] } }>(`/api/avisos/${a.id}`);
      setHist(r.aviso.historico ?? []);
    } catch {
      setHist([]);
    }
  }, [a.id]);
  useEffect(() => { void carregarHist(); }, [carregarHist]);

  const mudou = freq !== a.frequenciaTipo || (freq === "horas" && horas !== (a.frequenciaHoras ?? 4)) || email.trim() !== a.canalDestino;

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      await avisosApi.atualizar(a.id, {
        frequenciaTipo: freq,
        frequenciaHoras: freq === "horas" ? horas : null,
        canalDestino: email.trim(),
      });
      props.onSalvo({ ...a, frequenciaTipo: freq, frequenciaHoras: freq === "horas" ? horas : null, canalDestino: email.trim() });
    } catch (e) {
      setMsg({ ok: false, texto: msgErro(e) });
    } finally {
      setSalvando(false);
    }
  }

  async function verificarAgora() {
    setVerificando(true);
    setMsg(null);
    try {
      const r = await avisosApi.executar(a.id);
      setMsg(r.mudanca
        ? { ok: true, texto: "A resposta mudou: o aviso foi enviado e entrou no histórico." }
        : { ok: true, texto: "Verificado agora: a resposta não mudou." });
      if (r.mudanca) void carregarHist();
    } catch (e) {
      setMsg({ ok: false, texto: msgErro(e) });
    } finally {
      setVerificando(false);
    }
  }

  return (
    <div className={styles.overlay} role="presentation" onClick={(e) => { if (e.target === e.currentTarget) props.onFechar(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={a.descricao}>
        <div className={styles.dh}>
          <span className={styles.avIc}><IconBell size={18} /></span>
          <div>
            <h2>{a.descricao}</h2>
            <p>Ligado em {new Date(a.createdAt).toLocaleDateString("pt-BR")}</p>
          </div>
          <span className={styles.sp} />
          <button type="button" className={styles.ib} onClick={props.onFechar} aria-label="Fechar"><IconX size={15} /></button>
        </div>

        <span className={styles.lbl}>Pergunta</span>
        <div className={styles.leitura} style={{ marginBottom: 8 }}>{a.perguntaOriginal}</div>
        <button
          type="button"
          className="mm-btn mm-btn--ghost"
          onClick={() => { pedirPerguntaAgora(a.perguntaOriginal); navigate("/?tab=perguntar"); }}
        >
          <IconSend size={14} /> Abrir no Perguntar
        </button>

        <div className={styles.sec}>Configuração</div>
        <span className={styles.lbl}>Verificar</span>
        <div className={styles.chips} style={{ marginBottom: 10 }}>
          <button type="button" className={`${styles.chip} ${freq === "horas" ? styles.chipOn : ""}`} onClick={() => setFreq("horas")}>
            a cada
            <input
              className={styles.horas}
              type="number"
              min={1}
              max={12}
              value={horas}
              onClick={(e) => { e.stopPropagation(); setFreq("horas"); }}
              onChange={(e) => setHoras(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
              aria-label="Horas"
            />
            horas
          </button>
          {(["diaria", "semanal", "mensal"] as FreqTipo[]).map((t) => (
            <button key={t} type="button" className={`${styles.chip} ${freq === t ? styles.chipOn : ""}`} onClick={() => setFreq(t)}>
              {freqTexto(t, null)}
            </button>
          ))}
        </div>
        <label className={styles.lbl} htmlFor="aviso-email">Enviar e-mail para</label>
        <input id="aviso-email" className={styles.campo} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <p className={styles.muted} style={{ fontSize: 12, margin: "4px 0 0" }}>Seu e-mail ou o de alguém do grupo.</p>

        <div className={styles.sec}>Histórico{hist ? ` · ${hist.length} aviso${hist.length !== 1 ? "s" : ""}` : ""}</div>
        {hist === null ? (
          <p className={styles.muted}>Carregando…</p>
        ) : (
          <div className={styles.tl}>
            {hist.map((h) => (
              <div key={h.id} className={styles.tlItem}>
                <b>{dataHora(h.enviadoEm ?? h.enviadoem)}</b>
                {textoLimpo(h.texto)}
              </div>
            ))}
            {a.textoRespostaInicial ? (
              <div className={`${styles.tlItem} ${styles.tlIni}`}>
                <b>{new Date(a.createdAt).toLocaleDateString("pt-BR")} · resposta quando você ligou</b>
                {textoLimpo(a.textoRespostaInicial).slice(0, 1200)}
              </div>
            ) : null}
            {!hist.length && !a.textoRespostaInicial ? <div className={`${styles.tlItem} ${styles.tlIni}`}>Ainda não mudou desde que você ligou o aviso.</div> : null}
          </div>
        )}

        {msg ? <p className={msg.ok ? styles.ok : styles.erro} role="status">{msg.texto}</p> : null}
        <div className={styles.dfoot}>
          <button type="button" className="mm-btn mm-btn--ghost" disabled={verificando} onClick={() => void verificarAgora()}>
            <IconRefresh size={14} /> {verificando ? "Verificando…" : "Verificar agora"}
          </button>
          <span className={styles.sp} />
          <button type="button" className="mm-btn mm-btn--ghost" onClick={props.onFechar}>Cancelar</button>
          <button type="button" className="mm-btn mm-btn--primary" disabled={!mudou || salvando || !email.trim()} onClick={() => void salvar()}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </aside>
    </div>
  );
}

// ─── Aba Lembretes ───────────────────────────────────────────────────────────

const DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIA_SEMANA_LONGO = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function rotuloDia(d: Date): string {
  const hoje = new Date();
  const amanha = new Date(hoje.getTime() + 86_400_000);
  const dm = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (d.toDateString() === hoje.toDateString()) return `Hoje · ${DIA_SEMANA[d.getDay()]} ${dm}`;
  if (d.toDateString() === amanha.toDateString()) return `Amanhã · ${DIA_SEMANA[d.getDay()]} ${dm}`;
  return `${DIA_SEMANA_LONGO[d.getDay()]} · ${dm}`;
}

function textoEnvio(l: Lembrete): string {
  const agora = Date.now();
  const enviado = [...l.envios].reverse().find((e) => e.situacao === "enviado");
  const proximo = l.envios.find((e) => e.situacao === "agendado" && new Date(e.enviarEm).getTime() > agora);
  if (proximo) return `E-mail ${dataHora(proximo.enviarEm)}`;
  if (enviado) return `E-mail enviado ${dataHora(enviado.enviarEm)}`;
  return "Lembrete por e-mail";
}

function AbaLembretes(props: { onTotal: (n: number) => void }) {
  const navigate = useNavigate();
  const [dias, setDias] = useState(7);
  const [itens, setItens] = useState<Lembrete[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { onTotal } = props;

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    apiGet<{ lembretes: Lembrete[] }>(`/api/lembretes/meus?dias=${dias}`)
      .then((r) => { if (vivo) { setItens(r.lembretes); setErro(null); if (dias === 7) onTotal(r.lembretes.length); } })
      .catch((e) => { if (vivo) setErro(msgErro(e)); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [dias, onTotal]);

  const grupos = useMemo(() => {
    const m = new Map<string, { rotulo: string; itens: Lembrete[] }>();
    for (const l of itens ?? []) {
      const d = new Date(l.momento);
      const k = d.toDateString();
      if (!m.has(k)) m.set(k, { rotulo: rotuloDia(d), itens: [] });
      m.get(k)!.itens.push(l);
    }
    return [...m.values()];
  }, [itens]);

  return (
    <>
      {erro ? <p className="mm-error">{erro}</p> : null}
      {itens === null ? <p className={styles.muted}>Carregando…</p> : null}
      {itens && !itens.length ? (
        <div className={styles.vazio}><b>Nenhum compromisso nos próximos {dias} dias.</b>Quando uma agenda sua for catalogada, ela aparece aqui.</div>
      ) : null}
      {grupos.map((g) => (
        <div key={g.rotulo}>
          <div className={styles.dia}>{g.rotulo}</div>
          {g.itens.map((l) => {
            const d = new Date(l.momento);
            return (
              <div key={l.id} className={`${styles.lem} ${l.noPrazo ? styles.lemPrazo : ""}`}>
                <span className={styles.lemH}>
                  {l.hora ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : <span style={{ fontSize: 12 }}>dia todo</span>}
                  <small style={{ display: "block", fontSize: 11, color: "var(--mm-muted)", fontWeight: 600 }}>{DIA_SEMANA[d.getDay()]}</small>
                </span>
                <div style={{ minWidth: 0 }}>
                  <b>{l.titulo ?? (l.texto ? `${l.texto.slice(0, 70)}${l.texto.length > 70 ? "…" : ""}` : `Memo #${l.memoId}`)}</b>{" "}
                  {l.categoria ? <span className={styles.tag}>{l.categoria}</span> : null}
                  <p>{textoEnvio(l)}</p>
                </div>
                <button type="button" className={styles.ib} title="Abrir o memo" aria-label="Abrir o memo" onClick={() => navigate(`/memo/${l.memoId}/editar`)}>
                  <IconEye size={15} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
      {itens ? (
        <div className={styles.mais}>
          <button type="button" className="mm-btn mm-btn--ghost" disabled={carregando || dias >= 365} onClick={() => setDias((d) => Math.min(365, d + 7))}>
            {carregando ? "Carregando…" : <>Mais: ver os próximos 7 dias <IconChevronDown size={14} /></>}
          </button>
        </div>
      ) : null}
      <div className={styles.banner}>
        <IconInfo size={16} />
        <div>
          Você recebe lembrete dos compromissos em que seu e-mail aparece. <b>Quem decide quais categorias mandam lembrete, e com quanta antecedência, é o dono do grupo</b>, em Administrar grupo › Categorias.
        </div>
      </div>
    </>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function AvisosNovoPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const aba = params.get("aba") === "lembretes" ? "lembretes" : "avisos";
  const [me, setMe] = useState<MeResponse | null>(null);
  const [avisos, setAvisos] = useState<AvisoRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [confirmar, setConfirmar] = useState<number | null>(null);
  const [aberto, setAberto] = useState<AvisoRow | null>(null);
  const [totalLembretes, setTotalLembretes] = useState<number | null>(null);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (!r.ok) { navigate("/login"); return; }
      setMe(r.data);
    });
  }, [navigate]);

  const carregar = useCallback(async () => {
    try {
      const data = await avisosApi.listar();
      setAvisos(data.avisos as unknown as AvisoRow[]);
      setErro(null);
    } catch (e) {
      setErro(msgErro(e));
      setAvisos([]);
    }
  }, []);
  useEffect(() => { if (me) void carregar(); }, [me, carregar]);

  // O número da aba Lembretes aparece mesmo com a aba Avisos aberta
  useEffect(() => {
    if (!me || aba === "lembretes") return;
    apiGet<{ lembretes: unknown[] }>("/api/lembretes/meus?dias=7")
      .then((r) => setTotalLembretes(r.lembretes.length))
      .catch(() => {});
  }, [me, aba]);

  const onTotalLembretes = useCallback((n: number) => setTotalLembretes(n), []);

  function trocarAba(nova: "avisos" | "lembretes") {
    const p = new URLSearchParams(params);
    if (nova === "avisos") p.delete("aba"); else p.set("aba", nova);
    setParams(p, { replace: true });
  }

  async function alternar(a: AvisoRow) {
    setOcupado(a.id);
    const status = a.status === "ativo" ? "pausado" : "ativo";
    try {
      await avisosApi.atualizar(a.id, { status });
      setAvisos((prev) => prev?.map((x) => (x.id === a.id ? { ...x, status } : x)) ?? null);
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setOcupado(null);
    }
  }

  async function excluir(id: number) {
    setOcupado(id);
    try {
      await avisosApi.excluir(id);
      setAvisos((prev) => prev?.filter((x) => x.id !== id) ?? null);
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setOcupado(null);
      setConfirmar(null);
    }
  }

  return (
    <div className={styles.shell}>
      <Header />
      <main className={styles.page}>
        <div className={styles.topo}>
          <button type="button" className={styles.voltar} onClick={() => navigate(-1)} aria-label="Voltar"><IconArrowLeft size={16} /></button>
          <h1>Meus avisos e lembretes</h1>
          <span className={styles.sp} />
          <button type="button" className={styles.antiga} onClick={() => navigate("/avisos")}>Ver a tela antiga</button>
        </div>
        <p className={styles.sub}>Avisos: o proMemory refaz uma pergunta sua e avisa quando a resposta muda. Lembretes: compromissos que chegam até você.</p>

        <div className={styles.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={aba === "avisos"} className={`${styles.tab} ${aba === "avisos" ? styles.tabOn : ""}`} onClick={() => trocarAba("avisos")}>
            <IconBell size={15} /> Avisos {avisos ? <span className={styles.tabN}>{avisos.length}</span> : null}
          </button>
          <button type="button" role="tab" aria-selected={aba === "lembretes"} className={`${styles.tab} ${aba === "lembretes" ? styles.tabOn : ""}`} onClick={() => trocarAba("lembretes")}>
            <IconCalendar size={15} /> Lembretes {totalLembretes != null ? <span className={styles.tabN}>{totalLembretes}</span> : null}
          </button>
        </div>

        {erro ? <p className="mm-error">{erro}</p> : null}

        {aba === "lembretes" ? (
          me ? <AbaLembretes onTotal={onTotalLembretes} /> : null
        ) : avisos === null ? (
          <p className={styles.muted}>Carregando…</p>
        ) : avisos.length === 0 ? (
          <div className={styles.vazio}>
            <b>Você ainda não tem avisos.</b>
            Faça uma pergunta no Perguntar e toque em <b style={{ display: "inline", fontSize: "inherit" }}>Me avise</b> na resposta.
            <div style={{ marginTop: 12 }}>
              <button type="button" className="mm-btn mm-btn--primary" onClick={() => navigate("/?tab=perguntar")}>Fazer uma pergunta</button>
            </div>
          </div>
        ) : (
          <>
            {avisos.map((a) => {
              const ligado = a.status === "ativo";
              const ultimo = a.ultimoavisotexto;
              return (
                <div key={a.id} className={`${styles.aviso} ${ligado ? "" : styles.avisoOff}`}>
                  <span className={`${styles.avIc} ${ligado ? "" : styles.avIcOff}`}><IconBell size={18} /></span>
                  <div style={{ minWidth: 0 }}>
                    <p className={styles.avT}>{a.descricao}</p>
                    <div className={styles.avQ}><IconChat size={13} style={{ verticalAlign: -2 }} /> "{a.perguntaOriginal}"</div>
                    {ultimo ? (
                      <button type="button" className={styles.ultima} onClick={() => setAberto(a)} title="Ver o histórico">
                        <small>Última mudança · {haQuanto(a.ultimoaviso)}</small>
                        {textoLimpo(ultimo).slice(0, 400)}
                      </button>
                    ) : (
                      <div className={`${styles.ultima} ${styles.ultimaNada}`}>Ainda não mudou desde que você ligou o aviso.</div>
                    )}
                    <div className={styles.meta}>
                      <span><IconRefresh size={13} />Verifica {freqTexto(a.frequenciaTipo, a.frequenciaHoras)}</span>
                      <span><IconMail size={13} />{a.canalDestino}</span>
                      <span>Próxima: {ligado ? dataHora(a.proximaExecucao) : "pausado"}</span>
                    </div>
                  </div>
                  <div className={styles.avR}>
                    <span className={`${styles.st} ${ligado ? "" : styles.stOff}`}>
                      {ligado ? "Ligado" : "Pausado"}
                      <button
                        type="button"
                        className={`${styles.chave} ${ligado ? "" : styles.chaveOff}`}
                        role="switch"
                        aria-checked={ligado}
                        aria-label={ligado ? "Pausar aviso" : "Ligar aviso"}
                        disabled={ocupado === a.id}
                        onClick={() => void alternar(a)}
                      />
                    </span>
                    <span className={styles.ibtns}>
                      <button type="button" className={styles.ib} title="Histórico e ajustes" aria-label="Histórico e ajustes" onClick={() => setAberto(a)}><IconHistory size={15} /></button>
                      <button type="button" className={styles.ib} title="Editar" aria-label="Editar" onClick={() => setAberto(a)}><IconEdit size={15} /></button>
                      <button type="button" className={`${styles.ib} ${styles.ibPerigo}`} title="Excluir" aria-label="Excluir" onClick={() => setConfirmar(a.id)}><IconTrash size={15} /></button>
                    </span>
                  </div>
                  {confirmar === a.id ? (
                    <div className={styles.confirma}>
                      Excluir este aviso? O histórico também some.
                      <span className={styles.sp} />
                      <button type="button" className="mm-btn mm-btn--ghost" onClick={() => setConfirmar(null)}>Cancelar</button>
                      <button type="button" className="mm-btn mm-btn--primary" style={{ background: "var(--mm-danger)", borderColor: "var(--mm-danger)" }} disabled={ocupado === a.id} onClick={() => void excluir(a.id)}>
                        {ocupado === a.id ? "Excluindo…" : "Excluir"}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <p className={styles.rodape}>Para criar um aviso, faça a pergunta no <b>Perguntar</b> e toque em <b>Me avise</b> na resposta.</p>
          </>
        )}
      </main>

      {aberto ? (
        <AvisoPainel
          aviso={aberto}
          onFechar={() => setAberto(null)}
          onSalvo={(a) => { setAvisos((prev) => prev?.map((x) => (x.id === a.id ? a : x)) ?? null); setAberto(null); }}
        />
      ) : null}
    </div>
  );
}
