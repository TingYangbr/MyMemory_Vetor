import { useCallback, useEffect, useState } from "react";
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
  const [editing, setEditing] = useState<{ id: number; pergunta: string; anotacoes: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [showCatFilter, setShowCatFilter] = useState(false);

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
    setEditing({ id: m.id, pergunta: m.pergunta, anotacoes: m.anotacoes ?? "" });
    setSaveErr(null);
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await apiPutJson<{ modelo: PerguntaModelo }>(
        `/api/pergunta-modelos/${editing.id}`,
        { pergunta: editing.pergunta.trim(), anotacoes: editing.anotacoes.trim() || null }
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

  const grouped = modelos.reduce<Record<string, PerguntaModelo[]>>((acc, m) => {
    const key = m.category ?? "Sem categoria";
    (acc[key] ??= []).push(m);
    return acc;
  }, {});
  const groupKeys = Object.keys(grouped).sort((a, b) =>
    a === "Sem categoria" ? 1 : b === "Sem categoria" ? -1 : a.localeCompare(b)
  );
  const showFilterBtn = modelos.length > 6 && groupKeys.length > 1;
  const visibleGroupKeys = filterCat ? groupKeys.filter((k) => k === filterCat) : groupKeys;

  return (
    <div className={styles.shell}>
      <Header />
      <main className={styles.main}>
        <div className={styles.topBar}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <h1 className={styles.title}>Perguntas salvas</h1>
            {showFilterBtn && (
              <button
                type="button"
                className={`${styles.filterBtn}${showCatFilter || filterCat ? ` ${styles.filterBtnActive}` : ""}`}
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
          <button
            type="button"
            className="mm-btn mm-btn--ghost"
            onClick={() => navigate("/perguntar")}
          >← Voltar</button>
        </div>

        {showFilterBtn && showCatFilter && (
          <div className={styles.catFilterBar}>
            <button
              className={`${styles.catChip}${!filterCat ? ` ${styles.catChipActive}` : ""}`}
              onClick={() => setFilterCat(null)}
            >Todas</button>
            {groupKeys.map((cat) => (
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

        {visibleGroupKeys.map((group) => (
          <section key={group} className={styles.group}>
            {group !== "Sem categoria" && (
              <h2 className={styles.groupTitle}>{group}</h2>
            )}
            <ul className={styles.list}>
              {grouped[group]!.map((m) => {
                const isEditing = editing?.id === m.id;
                return (
                  <li key={m.id} className={styles.item}>
                    {isEditing ? (
                      <div className={styles.editBlock}>
                        <textarea
                          className={`mm-field ${styles.editTextarea}`}
                          rows={2}
                          value={editing.pergunta}
                          onChange={(e) => setEditing({ ...editing, pergunta: e.target.value })}
                          placeholder="Pergunta"
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                        />
                        <textarea
                          className={`mm-field ${styles.editTextarea}`}
                          rows={2}
                          value={editing.anotacoes}
                          onChange={(e) => setEditing({ ...editing, anotacoes: e.target.value })}
                          placeholder="Anotações (opcional)"
                        />
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
                        </div>
                      </div>
                    ) : (
                      <div className={styles.viewBlock}>
                        <div className={styles.viewMain}>
                          <div className={styles.perguntaText}>{m.pergunta}</div>
                          {m.anotacoes && (
                            <div className={styles.anotacoesText}>{m.anotacoes}</div>
                          )}
                        </div>
                        <div className={styles.itemActions}>
                          <button
                            type="button"
                            className={`mm-btn mm-btn--ghost ${styles.actionBtn}`}
                            title="Editar"
                            onClick={() => startEdit(m)}
                          >✏</button>
                          <button
                            type="button"
                            className={`mm-btn mm-btn--ghost ${styles.actionBtn} ${styles.deleteBtn}`}
                            title="Excluir"
                            onClick={() => void deleteModelo(m.id)}
                            disabled={deletingId === m.id}
                          >{deletingId === m.id ? "…" : "✕"}</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
