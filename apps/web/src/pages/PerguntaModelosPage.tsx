import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MeResponse, PerguntaModelo } from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiGetOptional, apiPutJson } from "../api";
import Header from "../components/Header";
import styles from "./PerguntaModelosPage.module.css";

export default function PerguntaModelosPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [modelos, setModelos] = useState<PerguntaModelo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; pergunta: string; anotacoes: string; estrelas: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [showCatFilter, setShowCatFilter] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (!r.ok) { navigate("/login"); return; }
      setMe(r.data);
    });
  }, [navigate]);

  const workspaceGroupId = me?.lastWorkspaceGroupId ?? null;

  const load = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    setError(null);
    try {
      const gid = workspaceGroupId ? `?workspaceGroupId=${workspaceGroupId}` : "";
      const data = await apiGet<{ modelos: PerguntaModelo[] }>(`/api/pergunta-modelos${gid}`);
      setModelos(data.modelos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar perguntas.");
    } finally {
      setLoading(false);
    }
  }, [me, workspaceGroupId]);

  useEffect(() => { void load(); }, [load]);

  function startEdit(m: PerguntaModelo) {
    setEditing({ id: m.id, pergunta: m.pergunta, anotacoes: m.anotacoes ?? "", estrelas: m.estrelas ?? null });
    setSaveErr(null);
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await apiPutJson<{ modelo: PerguntaModelo }>(
        `/api/pergunta-modelos/${editing.id}`,
        { pergunta: editing.pergunta.trim(), anotacoes: editing.anotacoes.trim() || null, estrelas: editing.estrelas }
      );
      setModelos((prev) => prev.map((m) => (m.id === editing.id ? res.modelo : m)));
      setEditing(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteModelo(id: number) {
    if (!confirm("Excluir esta pergunta salva?")) return;
    setDeletingId(id);
    try {
      await apiDeleteJson(`/api/pergunta-modelos/${id}`);
      setModelos((prev) => prev.filter((m) => m.id !== id));
      if (editing?.id === id) setEditing(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao excluir.");
    } finally {
      setDeletingId(null);
    }
  }

  const catOptions = useMemo(
    () => Array.from(new Set(modelos.map((m) => m.category).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [modelos]
  );
  const showFilterBtn = modelos.length > 5 && catOptions.length > 1;

  const filteredModelos = useMemo(() => {
    let result = filterCat ? modelos.filter((m) => m.category === filterCat) : modelos;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter(
        (m) => m.pergunta.toLowerCase().includes(q) || (m.anotacoes ?? "").toLowerCase().includes(q)
      );
    }
    return sortAsc ? [...result].reverse() : result;
  }, [modelos, filterCat, searchText, sortAsc]);

  function toggleSearch() {
    if (showSearch) {
      setShowSearch(false);
      setSearchText("");
    } else {
      setShowSearch(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }

  return (
    <div className={styles.shell}>
      <Header />
      <main className={styles.main}>
        <div className={styles.topBar}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <h1 className={styles.title}>Perguntas salvas</h1>
            <button
              type="button"
              className={`${styles.iconBtn}${showSearch || searchText ? ` ${styles.iconBtnActive}` : ""}`}
              title={showSearch ? "Fechar busca" : "Buscar por texto"}
              onClick={toggleSearch}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              {searchText && <span className={styles.filterDot} />}
            </button>
            {showFilterBtn && (
              <button
                type="button"
                className={`${styles.iconBtn}${showCatFilter || filterCat ? ` ${styles.iconBtnActive}` : ""}`}
                title="Filtrar por categoria"
                onClick={() => setShowCatFilter((v) => !v)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
                {filterCat && <span className={styles.filterDot} />}
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <button
              type="button"
              className={`${styles.iconBtn}${sortAsc ? ` ${styles.iconBtnActive}` : ""}`}
              title={sortAsc ? "Ordem: mais antigas primeiro — clique para inverter" : "Ordem: mais recentes primeiro — clique para inverter"}
              onClick={() => setSortAsc((v) => !v)}
            >
              {sortAsc ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
                </svg>
              )}
            </button>
            <button
              type="button"
              className="mm-btn mm-btn--ghost"
              onClick={() => navigate("/perguntar")}
            >← Voltar</button>
          </div>
        </div>

        {showSearch && (
          <div className={styles.searchBar}>
            <svg className={styles.searchBarIcon} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              className={styles.searchInput}
              placeholder="Buscar na pergunta ou anotações…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            {searchText && (
              <button
                type="button"
                className={styles.searchClearBtn}
                onClick={() => setSearchText("")}
                title="Limpar busca"
              >×</button>
            )}
          </div>
        )}

        {showFilterBtn && showCatFilter && (
          <div className={styles.catFilterBar}>
            <button
              className={`${styles.catChip}${!filterCat ? ` ${styles.catChipActive}` : ""}`}
              onClick={() => setFilterCat(null)}
            >Todas</button>
            {catOptions.map((cat) => (
              <button
                key={cat}
                className={`${styles.catChip}${filterCat === cat ? ` ${styles.catChipActive}` : ""}`}
                onClick={() => setFilterCat(filterCat === cat ? null : cat)}
              >{cat}</button>
            ))}
          </div>
        )}

        {loading && <p className={styles.muted}>Carregando…</p>}
        {error && <p className={styles.errorMsg}>{error}</p>}

        {!loading && modelos.length === 0 && (
          <p className={styles.muted}>Nenhuma pergunta salva{workspaceGroupId ? " neste grupo" : ""}.</p>
        )}

        {filteredModelos.length > 0 && (
          <ul className={styles.list}>
            {filteredModelos.map((m) => {
              const isEditing = editing?.id === m.id;
              return (
                <li key={m.id} className={styles.item}>
                  <div className={styles.itemTop}>
                    {m.category ? <span className={styles.itemCat}>{m.category}</span> : null}
                    {m.estrelas && !isEditing ? <span className={styles.itemStars}>{"★".repeat(m.estrelas)}</span> : null}
                  </div>
                  {isEditing ? (
                    <div className={styles.editBlock}>
                      <textarea
                        className={`mm-field ${styles.editTextarea}`}
                        rows={2}
                        value={editing.pergunta}
                        onChange={(e) => setEditing({ ...editing, pergunta: e.target.value })}
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                      />
                      <textarea
                        className={`mm-field ${styles.editTextarea}`}
                        rows={2}
                        value={editing.anotacoes}
                        onChange={(e) => setEditing({ ...editing, anotacoes: e.target.value })}
                        placeholder="Anotações (opcional)"
                        style={{ fontStyle: "italic", fontSize: "0.82rem" }}
                      />
                      <div className={styles.editStarRow}>
                        <span className={styles.editStarLabel}>Classificação:</span>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            className={`${styles.starBtn}${editing.estrelas !== null && n <= editing.estrelas ? ` ${styles.starBtnOn}` : ""}`}
                            onClick={() => setEditing({ ...editing, estrelas: editing.estrelas === n ? null : n })}
                            title={`${n} estrela${n > 1 ? "s" : ""}`}
                          >★</button>
                        ))}
                      </div>
                      {saveErr && <p className={styles.errorMsg}>{saveErr}</p>}
                      <div className={styles.editActions}>
                        <button
                          type="button"
                          className="mm-btn mm-btn--primary"
                          onClick={() => void saveEdit()}
                          disabled={saving || !editing.pergunta.trim()}
                        >{saving ? "Salvando…" : "Salvar"}</button>
                        <button
                          type="button"
                          className="mm-btn mm-btn--ghost"
                          onClick={() => setEditing(null)}
                          disabled={saving}
                        >Cancelar</button>
                        <button
                          type="button"
                          className={`mm-btn mm-btn--ghost ${styles.deleteBtn}`}
                          title="Excluir"
                          onClick={() => void deleteModelo(m.id)}
                          disabled={deletingId === m.id}
                          style={{ marginLeft: "auto" }}
                        >{deletingId === m.id ? "…" : "✕"}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p
                        className={styles.perguntaText}
                        onClick={() => startEdit(m)}
                        title="Clique para editar"
                      >{m.pergunta}</p>
                      {m.anotacoes && (
                        <p
                          className={styles.anotacoesText}
                          onClick={() => startEdit(m)}
                          title="Clique para editar"
                        >{m.anotacoes}</p>
                      )}
                      <button
                        type="button"
                        className={styles.deleteFloatBtn}
                        onClick={() => void deleteModelo(m.id)}
                        title="Excluir"
                        disabled={deletingId === m.id}
                      >{deletingId === m.id ? "…" : "✕"}</button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
