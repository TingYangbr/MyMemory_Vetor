import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { MeResponse } from "@mymemory/shared";
import { apiGet, apiGetOptional } from "../api";
import Header from "../components/Header";
import adminStyles from "./AdminPage.module.css";
import styles from "./AdminTabelasPage.module.css";

type Tabela = { nome: string; tipo: "tabela" | "view"; linhas: number | null; bytes?: number | null };

/** 1.234.567 → "1,2 MB" */
function tamanho(b: number | null | undefined): string {
  if (b == null) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${u[i]}`;
}
type Coluna = { nome: string; tipo: string; mascarada: boolean };
type Lote = {
  tabela: string;
  tipo: "tabela" | "view";
  total: number;
  offset: number;
  limite: number;
  criterio: string;
  colunas: Coluna[];
  linhas: Record<string, unknown>[];
};

const LOTE = 1000;
const fmt = (n: number) => n.toLocaleString("pt-BR");
const texto = (v: unknown) => (v == null ? "" : String(v));

/** Compara dois valores da grade: números como números, o resto como texto (vazio por último). */
function comparar(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const na = typeof a === "number" ? a : Number(a);
  const nb = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== "" && String(b).trim() !== "") return na - nb;
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
}

/**
 * Suporte: ver o conteúdo das tabelas do Postgres (só leitura). Escolhe a tabela à esquerda; à direita, os registros
 * em lotes de até 1000 — por padrão os modificados por último primeiro. No lote carregado: filtro por coluna (embaixo
 * do título), busca em tudo, ordenar clicando no título e ver o valor inteiro clicando na célula.
 */
export default function AdminTabelasPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [carregandoMe, setCarregandoMe] = useState(true);
  const [tabelas, setTabelas] = useState<Tabela[]>([]);
  const [filtroTabela, setFiltroTabela] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<"ultima" | "natural">("ultima");
  const [offset, setOffset] = useState(0);
  const [lote, setLote] = useState<Lote | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [ordenar, setOrdenar] = useState<{ coluna: string; desc: boolean } | null>(null);
  const [celula, setCelula] = useState<{ linha: number; coluna: string } | null>(null);
  // Grade como janela: ocupa o que sobra da tela até o rodapé, então a barra de rolagem horizontal (no pé da grade)
  // fica sempre à vista; com o detalhe de uma célula aberto, a grade encolhe para ele caber embaixo.
  const gradeRef = useRef<HTMLDivElement | null>(null);
  const [alturaGrade, setAlturaGrade] = useState<number | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const el = gradeRef.current;
      if (!el) return;
      const topo = el.getBoundingClientRect().top + window.scrollY;
      const reserva = celula ? 220 : 0;
      setAlturaGrade(Math.max(220, window.innerHeight - (topo - window.scrollY) - 16 - reserva));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [lote, celula, carregando, erro]);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me")
      .then((r) => setMe(r.ok ? r.data : null))
      .finally(() => setCarregandoMe(false));
  }, []);

  useEffect(() => {
    if (me?.role !== "admin") return;
    void recarregarLista();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  // Lista de tabelas + tamanho do banco (medido a cada abertura e no botão Medir de novo)
  const [banco, setBanco] = useState<{ bytes: number; medidoEm: string } | null>(null);
  const recarregarLista = useCallback(async () => {
    try {
      const r = await apiGet<{ tabelas: Tabela[]; banco?: { bytes: number; medidoEm: string } }>("/api/admin/tabelas");
      setTabelas(r.tabelas);
      setBanco(r.banco ?? null);
    } catch (e) {
      setErro(String(e));
    }
  }, []);

  const carregar = useCallback(async (nome: string, off: number, ord: "ultima" | "natural") => {
    setCarregando(true); setErro(null); setCelula(null);
    try {
      const r = await apiGet<Lote>(`/api/admin/tabelas/${encodeURIComponent(nome)}?offset=${off}&limite=${LOTE}&ordem=${ord}`);
      setLote(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setLote(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (sel) void carregar(sel, offset, ordem);
  }, [sel, offset, ordem, carregar]);

  const escolher = (nome: string) => {
    setSel(nome); setOffset(0); setFiltros({}); setBusca(""); setOrdenar(null);
  };

  // Filtro, busca e ordem: só no lote carregado (rápido, sem ir ao banco)
  const linhas = useMemo(() => {
    if (!lote) return [];
    const b = busca.trim().toLowerCase();
    const fs = Object.entries(filtros).filter(([, v]) => v.trim());
    let out = lote.linhas.map((l, i) => ({ l, i }));
    if (b) out = out.filter(({ l }) => lote.colunas.some((c) => texto(l[c.nome]).toLowerCase().includes(b)));
    for (const [col, v] of fs) {
      const t = v.trim().toLowerCase();
      out = out.filter(({ l }) => texto(l[col]).toLowerCase().includes(t));
    }
    if (ordenar) {
      out = [...out].sort((x, y) => comparar(x.l[ordenar.coluna], y.l[ordenar.coluna]) * (ordenar.desc ? -1 : 1));
    }
    return out;
  }, [lote, busca, filtros, ordenar]);

  const tabelasVisiveis = tabelas.filter((t) => t.nome.toLowerCase().includes(filtroTabela.trim().toLowerCase()));
  const valorCelula = celula && lote ? lote.linhas[celula.linha]?.[celula.coluna] : undefined;

  if (carregandoMe) {
    return <div className={adminStyles.shell}><Header /><main className={adminStyles.main}><p className="mm-muted">Carregando…</p></main></div>;
  }
  if (!me) {
    return (
      <div className={adminStyles.shell}><Header /><main className={adminStyles.main}>
        <h1 className={adminStyles.title}>Autenticação necessária</h1>
        <Link to="/login" className={adminStyles.back}>Ir ao login</Link>
      </main></div>
    );
  }
  if (me.role !== "admin") {
    return <div className={adminStyles.shell}><Header /><main className={adminStyles.main}><h1 className={adminStyles.title}>Acesso negado</h1></main></div>;
  }

  const fim = lote ? Math.min(lote.offset + lote.linhas.length, lote.total) : 0;
  return (
    <div className={adminStyles.shell}>
      <Header />
      <main className={adminStyles.main} style={{ maxWidth: "none" }}>
        <h1 className={adminStyles.title}>Tabelas do banco</h1>
        <p style={{ margin: "-4px 0 6px", fontSize: 14 }}>
          {banco ? <>Tamanho do banco: <b>{tamanho(banco.bytes)}</b> · </> : null}
          <b>{tabelas.filter((t) => t.tipo === "tabela").length}</b> tabelas e <b>{tabelas.filter((t) => t.tipo === "view").length}</b> views
          {banco ? <span className="mm-muted"> · medido às {new Date(banco.medidoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span> : null}{" "}
          <button type="button" className="mm-btn" style={{ marginLeft: 6 }} onClick={() => void recarregarLista()}>Medir de novo</button>
        </p>
        <p className="mm-muted" style={{ marginTop: -6 }}>
          Só leitura. Senhas, hashes, tokens e chaves aparecem mascarados; textos longos e vetores, resumidos.
        </p>
        <div className={styles.layout}>
          <div className={styles.lista}>
            <div className={styles.filtroLista}>
              <input className="mm-field" placeholder="Filtrar tabelas…" value={filtroTabela} onChange={(e) => setFiltroTabela(e.target.value)} />
            </div>
            {tabelasVisiveis.map((t) => (
              <button key={t.nome} type="button" className={`${styles.itemTabela} ${sel === t.nome ? styles.itemAtivo : ""}`} onClick={() => escolher(t.nome)}>
                <span>{t.nome}{t.tipo === "view" ? " (view)" : ""}</span>
                <span className={styles.contagem} title="Linhas (estimativa do Postgres) · tamanho com índices">
                  {t.linhas != null ? `~${fmt(t.linhas)}` : ""}{t.bytes ? ` · ${tamanho(t.bytes)}` : ""}
                </span>
              </button>
            ))}
          </div>

          <div className={styles.painel}>
            {!sel ? <p className="mm-muted">Escolha uma tabela à esquerda.</p> : null}
            {sel ? (
              <div className={styles.barra}>
                <b>{sel}</b>
                <label>
                  Ordem{" "}
                  <select className="mm-field" value={ordem} onChange={(e) => { setOrdem(e.target.value as "ultima" | "natural"); setOffset(0); }}>
                    <option value="ultima">Última modificação primeiro</option>
                    <option value="natural">Ordem natural</option>
                  </select>
                </label>
                <input className="mm-field" style={{ minWidth: 220 }} placeholder="Buscar em todas as colunas do lote…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                {lote ? (
                  <>
                    <span>
                      {fmt(lote.total ? lote.offset + 1 : 0)}–{fmt(fim)} de {fmt(lote.total)}
                      {busca || Object.values(filtros).some((v) => v.trim()) ? ` · ${fmt(linhas.length)} no filtro` : ""}
                    </span>
                    <button type="button" className="mm-btn" disabled={carregando || lote.offset === 0} onClick={() => setOffset(Math.max(0, offset - LOTE))}>‹ Lote anterior</button>
                    <button type="button" className="mm-btn" disabled={carregando || fim >= lote.total} onClick={() => setOffset(offset + LOTE)}>Próximo lote ›</button>
                    <button type="button" className="mm-btn" disabled={carregando} onClick={() => void carregar(sel, offset, ordem)}>Recarregar</button>
                  </>
                ) : null}
              </div>
            ) : null}
            {lote ? <p className="mm-muted" style={{ fontSize: 12, margin: "0 0 6px" }}>Ordenado no banco por: {lote.criterio}. Filtros, busca e clique no título valem para o lote carregado.</p> : null}
            {erro ? <p className="mm-error">{erro}</p> : null}
            {carregando ? <p className="mm-muted">Carregando…</p> : null}
            {lote && !carregando ? (
              <div className={styles.grade} ref={gradeRef} style={alturaGrade ? { height: alturaGrade, maxHeight: "none" } : undefined}>
                <table>
                  <thead>
                    <tr>
                      {lote.colunas.map((c) => (
                        <th key={c.nome} title={`Ordenar por ${c.nome}`}
                          onClick={() => setOrdenar((o) => (o?.coluna === c.nome ? (o.desc ? null : { coluna: c.nome, desc: true }) : { coluna: c.nome, desc: false }))}>
                          {c.nome}{ordenar?.coluna === c.nome ? (ordenar.desc ? " ▼" : " ▲") : ""}
                          <span className={styles.tipoColuna}>{c.tipo}{c.mascarada ? " · mascarada" : ""}</span>
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {lote.colunas.map((c) => (
                        <th key={c.nome}>
                          <input placeholder="filtrar…" value={filtros[c.nome] ?? ""} onChange={(e) => setFiltros((f) => ({ ...f, [c.nome]: e.target.value }))} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map(({ l, i }) => (
                      <tr key={i}>
                        {lote.colunas.map((c) => {
                          const v = l[c.nome];
                          const ativa = celula?.linha === i && celula.coluna === c.nome;
                          return (
                            <td key={c.nome} className={`${v == null ? styles.nulo : ""} ${ativa ? styles.celulaAtiva : ""}`}
                              title={texto(v).slice(0, 300)} onClick={() => setCelula({ linha: i, coluna: c.nome })}>
                              {v == null ? "null" : texto(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {celula && lote ? (
              <div className={styles.detalhe}>
                <b>{celula.coluna}</b> — linha {fmt(lote.offset + celula.linha + 1)}{" "}
                <button type="button" className="mm-btn" style={{ marginLeft: 8 }} onClick={() => void navigator.clipboard?.writeText(texto(valorCelula))}>Copiar</button>{" "}
                <button type="button" className="mm-btn" onClick={() => setCelula(null)}>Fechar</button>
                <pre>{valorCelula == null ? "null" : (() => {
                  const t = texto(valorCelula);
                  try { return /^[[{]/.test(t.trim()) ? JSON.stringify(JSON.parse(t), null, 2) : t; } catch { return t; }
                })()}</pre>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
