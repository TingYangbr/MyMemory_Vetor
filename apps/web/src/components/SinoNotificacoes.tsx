import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { apiGet, apiPostJson } from "../api";
import { IconBell, IconCalendar } from "./icons";
import styles from "./SinoNotificacoes.module.css";

type SinoAviso = { id: number; avisoId: number; descricao: string; texto: string; quando: string; lido: boolean };
type SinoLembrete = {
  id: string;
  memoId: number;
  categoria: string | null;
  titulo: string | null;
  texto: string | null;
  momento: string;
};
type SinoResponse = {
  total: number;
  avisosNaoLidos: number;
  lembretesAtivos: number;
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
  const [aba, setAba] = useState<"avisos" | "lembretes">("avisos");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

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

  const abrir = () => {
    if (aberto) {
      setAberto(false);
      return;
    }
    setAberto(true);
    // Abre na aba que tem novidade
    if (dados && dados.avisosNaoLidos === 0 && dados.lembretesAtivos > 0) setAba("lembretes");
    else setAba("avisos");
    // Abrir o painel zera os avisos (os itens continuam destacados enquanto o painel estiver aberto)
    if (dados && dados.avisosNaoLidos > 0) {
      apiPostJson("/api/sino/lido", {})
        .then(() =>
          setDados((cur) => (cur ? { ...cur, total: cur.lembretesAtivos, avisosNaoLidos: 0 } : cur))
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
              Lembretes{dados?.lembretesAtivos ? ` · ${dados.lembretesAtivos}` : ""}
            </button>
          </div>

          <div className={styles.lista}>
            {aba === "avisos" ? (
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
                  Perguntar para acompanhar.
                </p>
              )
            ) : dados?.lembretes.length ? (
              dados.lembretes.map((l) => (
                <Link key={l.id} to={`/memo/${l.memoId}/editar`} className={styles.item}>
                  <span className={`${styles.ic} ${styles.icLembrete}`} aria-hidden>
                    <IconCalendar size={16} />
                  </span>
                  <span className={styles.corpo}>
                    <b>{l.categoria ? `${l.categoria}: ` : "Lembrete: "}{l.titulo ?? (l.texto ?? "").slice(0, 60)}</b>
                    <p>{quandoCompromisso(l.momento)}</p>
                  </span>
                  <small className={styles.quando}>agendado</small>
                </Link>
              ))
            ) : (
              <p className={styles.vazio}>Nenhum compromisso com lembrete pela frente.</p>
            )}
          </div>

          <Link to="/avisos" className={styles.rodape}>
            Abrir "Meus avisos e lembretes" para configurar
          </Link>
        </div>
      ) : null}
    </div>
  );
}
