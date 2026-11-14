import { useEffect, useRef, useState } from "react";
import type { PainelGrupoBuscaResponse, PainelGrupoItem } from "@mymemory/shared";
import { apiGet } from "../../api";
import { IconCheck, IconChevronDown, IconSearch } from "../../components/icons";
import { iniciais } from "./util";
import s from "./painel.module.css";

const RECENTES_KEY = "mm.painelGrupo.recentes";
/** Acima disso a caixinha mostra a busca também para o dono. */
const LIMITE_SEM_BUSCA = 8;

type Recente = { id: number; name: string };

function lerRecentes(): Recente[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTES_KEY) ?? "[]") as Recente[];
    return Array.isArray(v) ? v.slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function guardarRecente(g: Recente) {
  try {
    const lista = [g, ...lerRecentes().filter((x) => x.id !== g.id)].slice(0, 5);
    localStorage.setItem(RECENTES_KEY, JSON.stringify(lista));
  } catch {
    /* sem armazenamento: só não lembra os recentes */
  }
}

interface Props {
  /** null = Categorias globais (só admin). */
  grupoId: number | null;
  grupoNome: string;
  sub: string;
  onEscolher: (grupoId: number | null) => void;
}

/**
 * Caixinha "Grupo" do topo do menu. Admin: busca em todos os grupos (nome, dono ou número) e
 * "Categorias globais". Dono: só os grupos dele (com busca se tiver muitos). A trava real é no servidor.
 */
export default function GrupoSeletor({ grupoId, grupoNome, sub, onEscolher }: Props) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<PainelGrupoBuscaResponse | null>(null);
  const [carregando, setCarregando] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const t = window.setTimeout(() => {
      setCarregando(true);
      apiGet<PainelGrupoBuscaResponse>(`/api/painel-grupo/grupos?limite=20&q=${encodeURIComponent(q)}`)
        .then(setRes)
        .catch(() => setRes(null))
        .finally(() => setCarregando(false));
    }, q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [aberto, q]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const escolher = (id: number | null) => {
    setAberto(false);
    setQ("");
    onEscolher(id);
  };

  const isAdmin = res?.isAdmin ?? false;
  const mostrarBusca = isAdmin || (res?.total ?? 0) > LIMITE_SEM_BUSCA || q !== "";
  const recentes = lerRecentes();

  const item = (g: PainelGrupoItem) => (
    <button key={g.id} type="button" className={`${s.gItem} ${g.id === grupoId ? s.gItemOn : ""}`} onClick={() => escolher(g.id)}>
      <span className={s.gAv}>{iniciais(g.name)}</span>
      <span className={s.gTexts}>
        <span className={s.gName}>
          {g.name} <span className={s.gNum}>#{g.id}</span>
        </span>
        <span className={s.gSub}>
          {g.souDono ? "você é dono" : `dono: ${g.donoNome ?? "—"}${g.donoEmail ? ` · ${g.donoEmail}` : ""}`} · {g.membros}{" "}
          {g.membros === 1 ? "pessoa" : "pessoas"}
        </span>
      </span>
      {g.id === grupoId ? <IconCheck style={{ color: "var(--mm-primary)" }} /> : null}
    </button>
  );

  return (
    <div className={s.gWrap} ref={wrapRef}>
      <div className={s.gLabel}>Grupo</div>
      <button type="button" className={s.gBtn} onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        <span className={`${s.gAv} ${grupoId == null ? s.gAvGlobal : ""}`}>{grupoId == null ? "G" : iniciais(grupoNome)}</span>
        <span className={s.gTexts}>
          <span className={s.gName}>
            {grupoNome} {grupoId != null ? <span className={s.gNum}>#{grupoId}</span> : null}
          </span>
          <span className={s.gSub}>{sub}</span>
        </span>
        <IconChevronDown />
      </button>

      {aberto ? (
        <div className={s.gMenu} role="dialog" aria-label="Escolher grupo">
          {res ? (
            <div className={s.gHd}>
              {isAdmin ? `Administrador do sistema · ${res.total} grupo(s)` : "Seus grupos"}
            </div>
          ) : null}
          {mostrarBusca ? (
            <label className={s.gSearch}>
              <IconSearch />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={isAdmin ? "nome do grupo, do dono, e-mail ou nº" : "procurar grupo"}
              />
            </label>
          ) : null}

          {isAdmin && !q && recentes.length > 0 ? (
            <>
              <div className={s.gHd}>Últimos abertos</div>
              {recentes.map((r) => (
                <button key={`r${r.id}`} type="button" className={`${s.gItem} ${r.id === grupoId ? s.gItemOn : ""}`} onClick={() => escolher(r.id)}>
                  <span className={s.gAv}>{iniciais(r.name)}</span>
                  <span className={s.gTexts}>
                    <span className={s.gName}>
                      {r.name} <span className={s.gNum}>#{r.id}</span>
                    </span>
                  </span>
                </button>
              ))}
              <div className={s.gHd}>Todos</div>
            </>
          ) : null}

          {isAdmin && !q ? (
            <button type="button" className={`${s.gItem} ${grupoId == null ? s.gItemOn : ""}`} onClick={() => escolher(null)}>
              <span className={`${s.gAv} ${s.gAvGlobal}`}>G</span>
              <span className={s.gTexts}>
                <span className={s.gName}>Categorias globais</span>
                <span className={s.gSub}>sem grupo · valem para todos os grupos</span>
              </span>
            </button>
          ) : null}

          {carregando && !res ? <div className={s.gNote}>Carregando…</div> : null}
          {res?.grupos.map(item)}
          {res && res.grupos.length === 0 ? <div className={s.gNote}>Nenhum grupo encontrado.</div> : null}
          {res && res.total > res.grupos.length ? (
            <div className={s.gNote}>
              Mostrando {res.grupos.length} de {res.total}. Digite mais para filtrar.
            </div>
          ) : null}
          {res && !isAdmin ? (
            <div className={s.gNote}>Só os grupos em que você é dono. Categorias globais aparecem dentro do grupo, só para leitura.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
