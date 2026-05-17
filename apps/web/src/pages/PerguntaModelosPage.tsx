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

  return (
    <div className={styles.shell}>
      <Header />
      <main className={styles.main}>
        <div className={styles.topBar}>
          <h1 className={styles.title}>Perguntas salvas</h1>
          <button
            type="button"
            className="mm-btn mm-btn--ghost"
            onClick={() => navigate("/perguntar")}
          >← Voltar</button>
        </div>

        {loading && <p className={styles.muted}>Carregando…</p>}
        {error && <p className={styles.errorMsg}>{error}</p>}

        {!loading && modelos.length === 0 && (
          <p className={styles.muted}>Nenhuma pergunta salva{workspaceGroupId ? " neste grupo" : ""}.</p>
        )}

        {groupKeys.map((group) => (
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
                        <label className={styles.fieldLabel}>Pergunta</label>
                        <textarea
                          className={`mm-field ${styles.editTextarea}`}
                          rows={3}
                          value={editing.pergunta}
                          onChange={(e) => setEditing({ ...editing, pergunta: e.target.value })}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                        />
                        <label className={styles.fieldLabel}>Anotações</label>
                        <textarea
                          className={`mm-field ${styles.editTextarea}`}
                          rows={3}
                          value={editing.anotacoes}
                          onChange={(e) => setEditing({ ...editing, anotacoes: e.target.value })}
                          placeholder="Notas relevantes sobre esta pergunta…"
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
                        <div className={styles.perguntaText}>{m.pergunta}</div>
                        {m.anotacoes && (
                          <div className={styles.anotacoesText}>{m.anotacoes}</div>
                        )}
                        <div className={styles.itemActions}>
                          <button
                            type="button"
                            className="mm-btn mm-btn--ghost"
                            onClick={() => startEdit(m)}
                          >✏ Editar</button>
                          <button
                            type="button"
                            className={`mm-btn mm-btn--ghost ${styles.deleteBtn}`}
                            onClick={() => void deleteModelo(m.id)}
                            disabled={deletingId === m.id}
                          >{deletingId === m.id ? "…" : "Excluir"}</button>
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
