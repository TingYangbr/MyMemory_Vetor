import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiGet, apiPostJson, apiPutJson } from "../api";
import { CHAVE_RELACAO_PENDENTE, type RelacaoPendente } from "./RelacaoAposSalvar";
import { IconBell, IconCalendar } from "./icons";
import styles from "./SinoNotificacoes.module.css";

type SinoAviso = { id: number; avisoId: number; descricao: string; texto: string; quando: string; lido: boolean };
type SinoLembrete = {
  id: string;
  memoId: number;
  categoria: string | null;
  /** Grupo de origem do lembrete. */
  grupo?: string | null;
  titulo: string | null;
  texto: string | null;
  momento: string;
  /** Já no prazo do lembrete (conta no número do sino). */
  noPrazo?: boolean;
};
/** Compromisso que já terminou sem memo de resultado ligado. */
type SinoResultado = {
  memoId: number;
  categoria: string | null;
  grupo?: string | null;
  titulo: string | null;
  texto: string | null;
  momento: string;
};
type PerguntaResultado = "sempre" | "com_pessoas" | "quando_pedir" | "nunca";
type SinoResponse = {
  total: number;
  resultados?: SinoResultado[];
  perguntaResultado?: PerguntaResultado;
  avisosNaoLidos: number;
  lembretesAtivos: number;
  /** Todos os compromissos com lembrete dos próximos 7 dias. */
  lembretesProximos?: number;
  avisos: SinoAviso[];
  lembretes: SinoLembrete[];
};

const INTERVALO_MS = 2 * 60 * 1000;

/** "há 2 h", "ontem", "12/11" */
function tempoAtras(isoStr: string): string {
  const d = new Date(isoStr);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  if (h < 48) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Já passou: compromisso com hora antes de agora; conta do financeiro com vencimento antes de hoje. */
function atrasado(l: { memoId: number; momento: string; categoria: string | null }): boolean {
  if (!l.memoId) return /atrasad/i.test(l.categoria ?? "");
  return new Date(l.momento).getTime() < Date.now();
}

/** "hoje, 10:00", "amanhã, 10:00", "sex 15/11, 10:00" */
function quandoCompromisso(isoStr: string): string {
  const d = new Date(isoStr);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const hoje = new Date();
  const amanha = new Date();
  amanha.setDate(hoje.getDate() + 1);
  if (d.toDateString() === hoje.toDateString()) return `hoje, ${hora}`;
  if (d.toDateString() === amanha.toDateString()) return `amanhã, ${hora}`;
  const dia = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  return `${dia}, ${hora}`;
}

/** Sino do cabeçalho: número de avisos não lidos + lembretes do período, e painel com os itens. */
export function SinoNotificacoes() {
  const [dados, setDados] = useState<SinoResponse | null>(null);
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<"avisos" | "lembretes" | "resultados">("avisos");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const resultados = dados?.resultados ?? [];

  const carregar = useCallback(() => {
    apiGet<SinoResponse>("/api/sino")
      .then(setDados)
      .catch(() => {
        /* sino é opcional: sem rede ou API antiga, só não mostra número */
      });
  }, []);

  useEffect(() => {
    carregar();
    const t = window.setInterval(carregar, INTERVALO_MS);
    return () => window.clearInterval(t);
  }, [carregar]);

  // Fecha ao trocar de página ou clicar fora
  useEffect(() => setAberto(false), [location.pathname]);
  useEffect(() => {
    if (!aberto) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAberto(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [aberto]);

  /** "Registrar": abre o Catalogar já ligado ao compromisso (ao salvar, liga e conclui). */
  const registrarResultado = (memoId: number) => {
    const pendente: RelacaoPendente = { destinoId: memoId, tipo: "resultado", concluir: true, quando: Date.now() };
    try {
      sessionStorage.setItem(CHAVE_RELACAO_PENDENTE, JSON.stringify(pendente));
    } catch {
      /* sem sessionStorage: o Catalogar abre sem a ligação */
    }
    setAberto(false);
    navigate("/?tab=registrar");
    window.dispatchEvent(new CustomEvent("mm:abrir-catalogar"));
    // Sai da lista na hora; ao salvar, a ligação o remove de vez (se desistir, volta na próxima leitura)
    setDados((cur) =>
      cur ? { ...cur, total: Math.max(0, cur.total - 1), resultados: (cur.resultados ?? []).filter((r) => r.memoId !== memoId) } : cur
    );
  };

  /** "Não precisa": não pergunta mais por este compromisso. */
  const dispensarResultado = (memoId: number) => {
    setDados((cur) =>
      cur ? { ...cur, total: Math.max(0, cur.total - 1), resultados: (cur.resultados ?? []).filter((r) => r.memoId !== memoId) } : cur
    );
    apiPostJson(`/api/sino/resultado/${memoId}/dispensar`, {}).catch(() => carregar());
  };

  const mudarPreferencia = (valor: PerguntaResultado) => {
    setDados((cur) => (cur ? { ...cur, perguntaResultado: valor } : cur));
    apiPutJson("/api/sino/pergunta-resultado", { valor })
      .then(() => carregar())
      .catch(() => carregar());
  };

  const abrir = () => {
    if (aberto) {
      setAberto(false);
      return;
    }
    setAberto(true);
    // Abre na aba que tem novidade
    if (dados && dados.avisosNaoLidos === 0 && (dados.resultados?.length ?? 0) > 0) setAba("resultados");
    else if (dados && dados.avisosNaoLidos === 0 && (dados.lembretesProximos ?? dados.lembretesAtivos) > 0) setAba("lembretes");
    else setAba("avisos");
    // Abrir o painel zera os avisos (os itens continuam destacados enquanto o painel estiver aberto)
    if (dados && dados.avisosNaoLidos > 0) {
      apiPostJson("/api/sino/lido", {})
        .then(() =>
          setDados((cur) => (cur ? { ...cur, total: cur.lembretesAtivos + (cur.resultados?.length ?? 0), avisosNaoLidos: 0 } : cur))
        )
        .catch(() => {});
    }
  };

  const total = dados?.total ?? 0;
  const rotulo = total > 0 ? `Avisos e lembretes: ${total} novo(s)` : "Avisos e lembretes";

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.btn} ${aberto ? styles.btnAberto : ""}`}
        aria-label={rotulo}
        title={rotulo}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        onClick={abrir}
      >
        <IconBell size={18} />
        {total > 0 ? <span className={styles.badge}>{total > 99 ? "99+" : total}</span> : null}
      </button>

      {aberto ? (
        <div className={styles.pop} role="dialog" aria-label="Avisos e lembretes">
          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={aba === "avisos"}
              className={`${styles.tab} ${aba === "avisos" ? styles.tabOn : ""}`}
              onClick={() => setAba("avisos")}
            >
              Avisos{dados?.avisos.length ? ` · ${dados.avisos.filter((a) => !a.lido).length || dados.avisos.length}` : ""}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={aba === "lembretes"}
              className={`${styles.tab} ${aba === "lembretes" ? styles.tabOn : ""}`}
              onClick={() => setAba("lembretes")}
            >
              Lembretes{dados?.lembretes.length ? ` · ${dados.lembretes.length}` : ""}
            </button>
            {resultados.length ? (
              <button
                type="button"
                role="tab"
                aria-selected={aba === "resultados"}
                className={`${styles.tab} ${aba === "resultados" ? styles.tabOn : ""}`}
                onClick={() => setAba("resultados")}
              >
                Reuniões · {resultados.length}
              </button>
            ) : null}
          </div>

          <div className={styles.lista}>
            {aba === "resultados" ? (
              resultados.length ? (
                resultados.map((r) => (
                  <div key={r.memoId} className={`${styles.item} ${styles.naoLido}`}>
                    <span className={`${styles.ic} ${styles.icLembrete}`} aria-hidden>
                      <IconCalendar size={16} />
                    </span>
                    <span className={styles.corpo}>
                      {r.grupo ? <span className={styles.grupo} title={`Do grupo ${r.grupo}`}>{r.grupo}</span> : null}
                      <b>Terminou: {r.titulo ?? (r.texto ?? "").slice(0, 60)}</b>
                      <p>{quandoCompromisso(r.momento)} · Registrar o resultado?</p>
                      <span style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                        <button type="button" className="mm-btn mm-btn--primary" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => registrarResultado(r.memoId)}>
                          📝 Registrar
                        </button>
                        <button type="button" className="mm-btn mm-btn--ghost" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => dispensarResultado(r.memoId)}>
                          Não precisa
                        </button>
                      </span>
                    </span>
                  </div>
                ))
              ) : (
                <p className={styles.vazio}>Nenhuma reunião esperando o resultado.</p>
              )
            ) : aba === "avisos" ? (
              dados?.avisos.length ? (
                dados.avisos.map((a) => (
                  <Link key={a.id} to="/avisos" className={`${styles.item} ${a.lido ? "" : styles.naoLido}`}>
                    <span className={`${styles.ic} ${styles.icAviso}`} aria-hidden>
                      <IconBell size={16} />
                    </span>
                    <span className={styles.corpo}>
                      <b>Resposta mudou: {a.descricao}</b>
                      <p>{a.texto}</p>
                    </span>
                    <small className={styles.quando}>{tempoAtras(a.quando)}</small>
                  </Link>
                ))
              ) : (
                <p className={styles.vazio}>
                  Nenhuma mudança nas perguntas monitoradas nos últimos 30 dias. Use "Me avise" numa resposta do
                  Fale comigo para acompanhar.
                </p>
              )
            ) : dados?.lembretes.length ? (
              dados.lembretes.map((l) => (
                <Link key={l.id} to={l.memoId ? `/memo/${l.memoId}/editar` : "/financeiro"} className={`${styles.item} ${l.noPrazo ? styles.naoLido : ""}`}>
                  <span className={`${styles.ic} ${styles.icLembrete}`} aria-hidden>
                    <IconCalendar size={16} />
                  </span>
                  <span className={styles.corpo}>
                    {l.grupo ? <span className={styles.grupo} title={`Do grupo ${l.grupo}`}>{l.grupo}</span> : null}
                    <b>{l.categoria ? `${l.categoria}: ` : "Lembrete: "}{l.titulo ?? (l.texto ?? "").slice(0, 60)}</b>
                    {/* Conta do financeiro (sem memo): o texto já diz quando vence, sem hora */}
                    <p>{l.memoId ? quandoCompromisso(l.momento) : l.texto ?? ""}</p>
                  </span>
                  <small className={styles.quando} style={atrasado(l) ? { color: "var(--mm-danger)" } : undefined}>
                    {atrasado(l) ? "atrasado" : l.noPrazo ? "em breve" : "agendado"}
                  </small>
                </Link>
              ))
            ) : (
              <p className={styles.vazio}>Nenhum compromisso com lembrete nos próximos 7 dias.</p>
            )}
          </div>

          <div className={styles.rodape} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <label htmlFor="sino-pergunta-resultado" style={{ fontSize: 12.5 }}>Perguntar o resultado das reuniões:</label>
            <select
              id="sino-pergunta-resultado"
              className="mm-field"
              style={{ fontSize: 12.5, padding: "2px 6px", width: "auto" }}
              value={dados?.perguntaResultado ?? "sempre"}
              onChange={(e) => mudarPreferencia(e.target.value as PerguntaResultado)}
            >
              <option value="sempre">sempre</option>
              <option value="com_pessoas">só com outras pessoas</option>
              <option value="quando_pedir">só quando a agenda pedir</option>
              <option value="nunca">nunca</option>
            </select>
          </div>
          <Link to="/avisos" className={styles.rodape}>
            Abrir "Meus avisos e lembretes" para configurar
          </Link>
        </div>
      ) : null}
    </div>
  );
}
