import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MeResponse, PerguntaModelo } from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiGetOptional, apiPostJson, apiPutJson, avisos as avisosApi } from "../../api";
import { useCategoryOptions } from "../../hooks/useCategoryOptions";
import Header from "../../components/Header";
import { IconArrowLeft, IconBell, IconEdit, IconPin, IconSearch, IconSend, IconTrash } from "../../components/icons";
import { pedirPerguntaAgora } from "../../lib/perguntarAgora";
import styles from "./acompanhar.module.css";

/** Lote 3: Perguntas salvas (novo visual), ao lado da tela antiga /perguntas-salvas. */

type Edicao = { id: number; pergunta: string; anotacoes: string; estrelas: number | null; category: string | null };
type Ordem = "recentes" | "antigas" | "estrelas" | "az";

const SEM_CAT = "__sem__";
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function msgErro(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try { return (JSON.parse(raw) as { message?: string }).message ?? raw; } catch { return raw; }
}

function Estrelas({ n }: { n: number }) {
  return (
    <span className={styles.estrelas} aria-label={`${n} estrela${n > 1 ? "s" : ""}`}>
      {"★".repeat(n)}<span>{"★".repeat(5 - n)}</span>
    </span>
  );
}

export default function PerguntasSalvasNovoPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [modelos, setModelos] = useState<PerguntaModelo[] | null>(null);
  const [comAviso, setComAviso] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<Ordem>("recentes");
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (!r.ok) { navigate("/login"); return; }
      setMe(r.data);
    });
  }, [navigate]);

  const workspaceGroupId = me?.lastWorkspaceGroupId ?? null;
  const categoryOptions = useCategoryOptions(workspaceGroupId);

  const carregar = useCallback(async () => {
    if (!me) return;
    try {
      const gid = workspaceGroupId ? `?workspaceGroupId=${workspaceGroupId}` : "";
      const data = await apiGet<{ modelos: PerguntaModelo[] }>(`/api/pergunta-modelos${gid}`);
      setModelos(data.modelos);
      setErro(null);
    } catch (e) {
      setErro(msgErro(e));
      setModelos([]);
    }
    // Perguntas que já têm "Me avise" ligado (o aviso guarda o texto da pergunta)
    try {
      const av = await avisosApi.listar();
      setComAviso(new Set((av.avisos as { perguntaOriginal?: string }[]).map((a) => norm(a.perguntaOriginal ?? ""))));
    } catch { /* sem avisos: nenhuma etiqueta */ }
  }, [me, workspaceGroupId]);
  useEffect(() => { void carregar(); }, [carregar]);

  const categorias = useMemo(() => {
    const cats = new Map<string, number>();
    for (const m of modelos ?? []) {
      const k = m.category ?? SEM_CAT;
      cats.set(k, (cats.get(k) ?? 0) + 1);
    }
    return [...cats.entries()].sort((a, b) => (a[0] === SEM_CAT ? 1 : b[0] === SEM_CAT ? -1 : a[0].localeCompare(b[0])));
  }, [modelos]);

  const grupos = useMemo(() => {
    const q = norm(busca);
    let lista = (modelos ?? []).filter((m) =>
      (!filtro || (m.category ?? SEM_CAT) === filtro) &&
      (!q || norm(m.pergunta).includes(q) || norm(m.anotacoes ?? "").includes(q))
    );
    lista = [...lista];
    if (ordem === "antigas") lista.reverse();
    else if (ordem === "estrelas") lista.sort((a, b) => (b.estrelas ?? 0) - (a.estrelas ?? 0));
    else if (ordem === "az") lista.sort((a, b) => a.pergunta.localeCompare(b.pergunta));
    const m = new Map<string, PerguntaModelo[]>();
    for (const cat of categorias.map(([c]) => c)) m.set(cat, []);
    for (const p of lista) m.get(p.category ?? SEM_CAT)?.push(p);
    return [...m.entries()].filter(([, v]) => v.length);
  }, [modelos, busca, filtro, ordem, categorias]);

  async function fixar(m: PerguntaModelo) {
    const fixada = !m.fixada;
    setOcupado(m.id);
    try {
      await apiPostJson(`/api/pergunta-modelos/${m.id}/fixar`, { fixada });
      setModelos((prev) => prev?.map((x) => (x.id === m.id ? { ...x, fixada } : x)) ?? null);
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setOcupado(null);
    }
  }

  async function salvar() {
    if (!edicao) return;
    setSalvando(true);
    try {
      const r = await apiPutJson<{ modelo: PerguntaModelo }>(`/api/pergunta-modelos/${edicao.id}`, {
        pergunta: edicao.pergunta.trim(),
        anotacoes: edicao.anotacoes.trim() || null,
        estrelas: edicao.estrelas,
        category: edicao.category,
      });
      setModelos((prev) => prev?.map((x) => (x.id === edicao.id ? { ...r.modelo, fixada: x.fixada } : x)) ?? null);
      setEdicao(null);
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: number) {
    setOcupado(id);
    try {
      await apiDeleteJson(`/api/pergunta-modelos/${id}`);
      setModelos((prev) => prev?.filter((x) => x.id !== id) ?? null);
      if (edicao?.id === id) setEdicao(null);
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setOcupado(null);
      setConfirmar(null);
    }
  }

  const perguntar = (texto: string) => { pedirPerguntaAgora(texto); navigate("/?tab=perguntar"); };
  const rotuloCat = (c: string) => (c === SEM_CAT ? "Sem categoria" : c);

  function renderEdicao(m: PerguntaModelo) {
    if (!edicao) return null;
    const temAviso = comAviso.has(norm(m.pergunta));
    return (
      <div key={m.id} className={styles.qedit}>
        <label className={styles.lbl} htmlFor="ps-pergunta">Pergunta</label>
        <textarea id="ps-pergunta" className={styles.campo} rows={2} value={edicao.pergunta} onChange={(e) => setEdicao({ ...edicao, pergunta: e.target.value })} />
        <label className={styles.lbl} htmlFor="ps-notas" style={{ marginTop: 10 }}>Anotações <span className={styles.muted} style={{ fontWeight: 500 }}>· só para você</span></label>
        <textarea id="ps-notas" className={styles.campo} rows={2} style={{ fontStyle: "italic" }} value={edicao.anotacoes} onChange={(e) => setEdicao({ ...edicao, anotacoes: e.target.value })} placeholder="Opcional" />
        <div className={styles.g2} style={{ marginTop: 10 }}>
          <div>
            <label className={styles.lbl} htmlFor="ps-cat">Categoria</label>
            <select id="ps-cat" className={styles.campo} value={edicao.category ?? ""} onChange={(e) => setEdicao({ ...edicao, category: e.target.value || null })}>
              <option value="">Sem categoria</option>
              {edicao.category && !categoryOptions.some((c) => c.name === edicao.category) ? <option value={edicao.category}>{edicao.category}</option> : null}
              {categoryOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <span className={styles.lbl}>Classificação</span>
            <div className={styles.estrelasGrandes}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={edicao.estrelas != null && n <= edicao.estrelas ? styles.estrelaOn : ""}
                  onClick={() => setEdicao({ ...edicao, estrelas: edicao.estrelas === n ? null : n })}
                  aria-label={`${n} estrela${n > 1 ? "s" : ""}`}
                >★</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px 22px", marginTop: 12, flexWrap: "wrap" }}>
          <span className={styles.setrow}>
            <button type="button" role="switch" aria-checked={!!m.fixada} aria-label="Fixar no Perguntar" className={`${styles.chave} ${m.fixada ? "" : styles.chaveOff}`} disabled={ocupado === m.id} onClick={() => void fixar(m)} />
            Fixar no Perguntar <small>· vira atalho</small>
          </span>
          <span className={styles.setrow}>
            <button
              type="button"
              role="switch"
              aria-checked={temAviso}
              aria-label="Me avise quando a resposta mudar"
              className={`${styles.chave} ${temAviso ? "" : styles.chaveOff}`}
              onClick={() => (temAviso ? navigate("/avisos") : perguntar(m.pergunta))}
            />
            Me avise quando a resposta mudar
            <small>{temAviso ? "· ligado, ajuste em Meus avisos" : "· faz a pergunta; na resposta toque em Me avise"}</small>
          </span>
        </div>
        <div className={styles.dfoot}>
          <button type="button" className="mm-btn mm-btn--ghost" style={{ color: "var(--mm-danger)" }} onClick={() => setConfirmar(m.id)}><IconTrash size={14} /> Excluir</button>
          <span className={styles.sp} />
          <button type="button" className="mm-btn mm-btn--ghost" onClick={() => setEdicao(null)} disabled={salvando}>Cancelar</button>
          <button type="button" className="mm-btn mm-btn--primary" onClick={() => void salvar()} disabled={salvando || !edicao.pergunta.trim()}>{salvando ? "Salvando…" : "Salvar"}</button>
        </div>
        {confirmar === m.id ? renderConfirmar(m.id) : null}
      </div>
    );
  }

  function renderConfirmar(id: number) {
    return (
      <div className={styles.confirma} style={{ marginTop: 8 }}>
        Excluir esta pergunta salva?
        <span className={styles.sp} />
        <button type="button" className="mm-btn mm-btn--ghost" onClick={() => setConfirmar(null)}>Cancelar</button>
        <button type="button" className="mm-btn mm-btn--primary" style={{ background: "var(--mm-danger)", borderColor: "var(--mm-danger)" }} disabled={ocupado === id} onClick={() => void excluir(id)}>
          {ocupado === id ? "Excluindo…" : "Excluir"}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <Header />
      <main className={styles.page}>
        <div className={styles.topo}>
          <button type="button" className={styles.voltar} onClick={() => navigate(-1)} aria-label="Voltar"><IconArrowLeft size={16} /></button>
          <h1>Perguntas salvas</h1>
          <span className={styles.sp} />
        </div>
        <p className={styles.sub}>Perguntas que você usa sempre. As fixadas aparecem como atalho embaixo da caixa do Perguntar.</p>

        <div className={styles.ferramentas}>
          <label className={styles.busca}>
            <IconSearch size={15} />
            <input type="search" placeholder="Buscar nas perguntas e anotações…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
          <select className={styles.ordem} value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordem">
            <option value="recentes">Mais recentes</option>
            <option value="antigas">Mais antigas</option>
            <option value="estrelas">Mais estrelas</option>
            <option value="az">De A a Z</option>
          </select>
        </div>
        {categorias.length > 1 ? (
          <div className={styles.chipsRolam}>
            <button type="button" className={`${styles.chip} ${!filtro ? styles.chipOn : ""}`} onClick={() => setFiltro(null)}>Todas · {modelos?.length ?? 0}</button>
            {categorias.map(([c]) => (
              <button key={c} type="button" className={`${styles.chip} ${filtro === c ? styles.chipOn : ""}`} onClick={() => setFiltro(filtro === c ? null : c)}>{rotuloCat(c)}</button>
            ))}
          </div>
        ) : null}

        {erro ? <p className="mm-error">{erro}</p> : null}
        {modelos === null ? <p className={styles.muted}>Carregando…</p> : null}
        {modelos && !modelos.length ? (
          <div className={styles.vazio}>
            <b>Nenhuma pergunta salva{workspaceGroupId ? " neste grupo" : ""}.</b>
            No Perguntar, toque em Salvar embaixo de uma resposta para guardar a pergunta aqui.
          </div>
        ) : null}
        {modelos && modelos.length > 0 && !grupos.length ? <p className={styles.muted} style={{ marginTop: 14 }}>Nada encontrado com esse filtro.</p> : null}

        {grupos.map(([cat, lista]) => (
          <div key={cat}>
            <div className={styles.qcat}>{rotuloCat(cat)} <i>· {lista.length}</i></div>
            {lista.map((m) => {
              if (edicao?.id === m.id) return renderEdicao(m);
              const temAviso = comAviso.has(norm(m.pergunta));
              const abrir = () => setEdicao({ id: m.id, pergunta: m.pergunta, anotacoes: m.anotacoes ?? "", estrelas: m.estrelas ?? null, category: m.category ?? null });
              return (
                <div key={m.id}>
                  <div className={styles.qrow}>
                    <button
                      type="button"
                      className={`${styles.pin} ${m.fixada ? styles.pinOn : ""}`}
                      title={m.fixada ? "Desafixar do Perguntar" : "Fixar no Perguntar"}
                      aria-label={m.fixada ? "Desafixar do Perguntar" : "Fixar no Perguntar"}
                      aria-pressed={!!m.fixada}
                      disabled={ocupado === m.id}
                      onClick={() => void fixar(m)}
                    >
                      <IconPin size={16} fill={m.fixada ? "currentColor" : "none"} />
                    </button>
                    <button type="button" className={styles.qtexto} onClick={abrir} title="Toque para editar">
                      <b>{m.pergunta}</b>
                      {m.anotacoes ? <em>{m.anotacoes}</em> : null}
                      {m.estrelas || temAviso ? (
                        <span className={styles.badges}>
                          {m.estrelas ? <Estrelas n={m.estrelas} /> : null}
                          {temAviso ? <span className={`${styles.tag} ${styles.tagAviso}`}><IconBell size={11} />Me avise ligado</span> : null}
                        </span>
                      ) : null}
                    </button>
                    <span className={styles.qacoes}>
                      <button type="button" className={`mm-btn mm-btn--primary ${styles.btnPerguntar}`} onClick={() => perguntar(m.pergunta)} title="Perguntar agora" aria-label="Perguntar agora">
                        <IconSend size={14} /><span className={styles.btnTexto}>Perguntar</span>
                      </button>
                      <button type="button" className={styles.ib} title="Editar" aria-label="Editar" onClick={abrir}><IconEdit size={15} /></button>
                      <button type="button" className={`${styles.ib} ${styles.ibPerigo}`} title="Excluir" aria-label="Excluir" onClick={() => setConfirmar(m.id)}><IconTrash size={15} /></button>
                    </span>
                  </div>
                  {confirmar === m.id ? renderConfirmar(m.id) : null}
                </div>
              );
            })}
          </div>
        ))}
        {modelos && modelos.length > 0 ? <p className={styles.rodape}>Toque no texto da pergunta para editar.</p> : null}
      </main>
    </div>
  );
}
