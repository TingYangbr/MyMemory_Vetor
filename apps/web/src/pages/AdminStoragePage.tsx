import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MemoContextEditorMetaResponse, MemoContextGroupOption } from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiPatchJson, apiPostJson } from "../api";
import Header from "../components/Header";
import adminStyles from "./AdminPage.module.css";
import styles from "./AdminStoragePage.module.css";

interface StorageConfig {
  id: number;
  label: string;
  tipo: string;
  url: string;
  pathPrefix: string | null;
  username: string | null;
  hasPassword: boolean;
  isDefault: boolean;
}

const EMPTY_FORM = { label: "", url: "", pathPrefix: "", username: "", password: "", isDefault: false };

export default function AdminStoragePage() {
  const [groups, setGroups] = useState<MemoContextGroupOption[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [configs, setConfigs] = useState<StorageConfig[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    apiGet<MemoContextEditorMetaResponse>("/api/memo-context/editor-meta")
      .then(r => setGroups(r.allGroups ?? r.ownedGroups))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedGroupId == null) { setConfigs([]); return; }
    setLoadingConfigs(true);
    apiGet<{ configs: StorageConfig[] }>(`/api/admin/groups/${selectedGroupId}/storage-configs`)
      .then(r => setConfigs(r.configs))
      .catch(() => setConfigs([]))
      .finally(() => setLoadingConfigs(false));
  }, [selectedGroupId]);

  function resetForm() {
    setForm(EMPTY_FORM); setEditingId(null); setFormError(null); setTestResult(null);
  }

  function startEdit(cfg: StorageConfig) {
    setEditingId(cfg.id);
    setForm({ label: cfg.label, url: cfg.url, pathPrefix: cfg.pathPrefix ?? "", username: cfg.username ?? "", password: "", isDefault: cfg.isDefault });
    setFormError(null); setTestResult(null);
  }

  async function reloadConfigs() {
    if (selectedGroupId == null) return;
    const r = await apiGet<{ configs: StorageConfig[] }>(`/api/admin/groups/${selectedGroupId}/storage-configs`);
    setConfigs(r.configs);
  }

  async function handleSave() {
    if (selectedGroupId == null) return;
    if (!form.label.trim() || !form.url.trim()) { setFormError("Label e URL são obrigatórios."); return; }
    setSaving(true); setFormError(null);
    try {
      const body = {
        label: form.label.trim(), url: form.url.trim(),
        pathPrefix: form.pathPrefix.trim() || null,
        username: form.username.trim() || null,
        password: form.password || null,
        isDefault: form.isDefault,
      };
      if (editingId != null) {
        await apiPatchJson(`/api/admin/storage-configs/${editingId}`, body);
      } else {
        await apiPostJson(`/api/admin/groups/${selectedGroupId}/storage-configs`, { ...body, tipo: "WEBDAV" });
      }
      await reloadConfigs();
      resetForm();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Remover esta configuração?")) return;
    try {
      await apiDeleteJson(`/api/admin/storage-configs/${id}`);
      await reloadConfigs();
      if (editingId === id) resetForm();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao remover.");
    }
  }

  async function handleTest() {
    if (!form.url.trim()) { setFormError("Informe a URL antes de testar."); return; }
    setTesting(true); setTestResult(null); setFormError(null);
    try {
      const r = await apiPostJson<{ ok: boolean; message: string }>("/api/admin/storage-configs/test-connection", {
        url: form.url.trim(),
        pathPrefix: form.pathPrefix.trim() || null,
        username: form.username.trim() || null,
        password: form.password || null,
      });
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Erro." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className={adminStyles.shell}>
      <Header />
      <main className={`${adminStyles.main} ${adminStyles.mainWide}`}>
        <Link to="/admin" className={adminStyles.back}>← Admin</Link>
        <h1 className={adminStyles.title}>Storage por Grupo</h1>
        <p className={adminStyles.lead}>Configure servidores WebDAV por grupo. Sem configuração, o storage padrão (S3) é usado.</p>

        {/* Seleção de grupo */}
        <div className={styles.section}>
          <label className={styles.label}>Grupo</label>
          <select
            className={styles.select}
            value={selectedGroupId ?? ""}
            onChange={e => { setSelectedGroupId(e.target.value ? Number(e.target.value) : null); resetForm(); }}
          >
            <option value="">Selecione um grupo…</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>

        {selectedGroupId != null && (
          <>
            {/* Lista */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Configurações cadastradas</h2>
              {loadingConfigs ? <p>Carregando…</p> : configs.length === 0 ? (
                <p className={adminStyles.hint}>Nenhuma configuração. S3 usado como padrão.</p>
              ) : (
                <div className={adminStyles.tableWrap}>
                  <table className={`${adminStyles.table} ${styles.table}`}>
                    <thead>
                      <tr>
                        <th>Label</th><th>URL</th><th>Pasta</th><th>Usuário</th><th>Senha</th><th>Padrão</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {configs.map(cfg => (
                        <tr key={cfg.id} className={editingId === cfg.id ? styles.rowEditing : undefined}>
                          <td>{cfg.label}</td>
                          <td className={styles.tdUrl}>{cfg.url}</td>
                          <td>{cfg.pathPrefix ?? "—"}</td>
                          <td>{cfg.username ?? "—"}</td>
                          <td>{cfg.hasPassword ? "••••" : "—"}</td>
                          <td className={styles.tdCenter}>{cfg.isDefault ? "✓" : ""}</td>
                          <td>
                            <button type="button" className={styles.btnEdit} onClick={() => startEdit(cfg)}>Editar</button>
                            <button type="button" className={styles.btnDel} onClick={() => handleDelete(cfg.id)}>Remover</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Formulário */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>{editingId != null ? "Editar configuração" : "Nova configuração WebDAV"}</h2>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Label *</span>
                  <input className={styles.input} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="ex.: Servidor Principal" />
                </label>
                <label className={styles.field}>
                  <span>URL do servidor *</span>
                  <input className={styles.input} value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="http://192.168.1.10:19500" />
                </label>
                <label className={styles.field}>
                  <span>Pasta (path prefix)</span>
                  <input className={styles.input} value={form.pathPrefix} onChange={e => setForm(f => ({ ...f, pathPrefix: e.target.value }))} placeholder="/Mymemory" />
                </label>
                <label className={styles.field}>
                  <span>Usuário</span>
                  <input className={styles.input} value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
                </label>
                <label className={styles.field}>
                  <span>Senha{editingId != null ? " (vazio = manter atual)" : ""}</span>
                  <input className={styles.input} type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                </label>
                <label className={styles.checkboxField}>
                  <input type="checkbox" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} />
                  Usar como padrão para este grupo
                </label>
              </div>

              {formError && <p className={styles.error}>{formError}</p>}
              {testResult && (
                <p className={testResult.ok ? styles.testOk : styles.testErr}>
                  {testResult.ok ? "✓ " : "✗ "}{testResult.message}
                </p>
              )}

              <div className={styles.btnRow}>
                <button type="button" className="mm-btn mm-btn--primary" onClick={handleSave} disabled={saving}>
                  {saving ? "Salvando…" : editingId != null ? "Salvar alterações" : "Criar"}
                </button>
                <button type="button" className="mm-btn mm-btn--secondary" onClick={handleTest} disabled={testing}>
                  {testing ? "Testando…" : "Testar conexão"}
                </button>
                {editingId != null && (
                  <button type="button" className="mm-btn" onClick={resetForm}>Cancelar</button>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
