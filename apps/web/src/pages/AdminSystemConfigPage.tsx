import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AdminSystemConfigItem, AdminSystemConfigResponse, MeResponse } from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPutJson } from "../api";
import Header from "../components/Header";
import adminStyles from "./AdminPage.module.css";

const THRESHOLD_KEYS = [
  {
    key: "semanticSearchInitialThreshold",
    label: "Limiar inicial de pesquisa semântica",
    hint: "Threshold de similaridade (0–1) com que a busca começa. Padrão: 0.70",
    defaultValue: "0.70",
  },
  {
    key: "semanticSearchMinThreshold",
    label: "Limiar mínimo de pesquisa semântica",
    hint: "Menor threshold permitido após reduções de 10%. Padrão: 0.30",
    defaultValue: "0.30",
  },
] as const;

const BOOL_KEYS = [
  {
    key: "showApiCost",
    label: "Exibir custo de API e créditos na UI",
    hint: 'Quando ativo, memos exibem o custo em USD e créditos gastos na IA. Padrão: ativo (1).',
    defaultValue: "1",
  },
  {
    key: "showLlmTrace",
    label: "Exibir botão de trace LLM (Pergunte ao myMemory)",
    hint: 'Quando ativo, cada resposta da página "Pergunte ao myMemory" exibe um botão discreto para inspecionar as chamadas LLM que geraram a resposta. Padrão: inativo (0).',
    defaultValue: "0",
  },
] as const;

export default function AdminSystemConfigPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [items, setItems] = useState<AdminSystemConfigItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<string, "ok" | "err">>({});

  useEffect(() => {
    void apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (!r.ok) { if (r.status === 401) navigate("/login"); else setLoadErr("Sem acesso."); setLoading(false); return; }
      if (r.data.role !== "admin") { setLoadErr("Acesso restrito a administradores."); setLoading(false); return; }
      apiGet<AdminSystemConfigResponse>("/api/admin/system-config")
        .then((cfg) => {
          setItems(cfg.items);
          const init: Record<string, string> = {};
          for (const k of THRESHOLD_KEYS) {
            const found = cfg.items.find((i) => i.configkey === k.key);
            init[k.key] = found ? found.configvalue : k.defaultValue;
          }
          for (const k of BOOL_KEYS) {
            const found = cfg.items.find((i) => i.configkey === k.key);
            init[k.key] = found ? found.configvalue : k.defaultValue;
          }
          const fatorFound = cfg.items.find((i) => i.configkey === "fatorCredCost");
          init["fatorCredCost"] = fatorFound ? fatorFound.configvalue : "100";
          setDrafts(init);
        })
        .catch((e) => setLoadErr(e instanceof Error ? e.message : "Erro ao carregar config."))
        .finally(() => setLoading(false));
    }).catch(() => { setLoadErr("Erro de rede."); setLoading(false); });
  }, [navigate]);

  async function saveThreshold(key: string) {
    const value = drafts[key]?.trim();
    if (!value) return;
    const n = Number.parseFloat(value.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0 || n > 1) {
      setSaveStatus((s) => ({ ...s, [key]: "err" }));
      return;
    }
    await commitSave(key, String(n));
  }

  async function saveFator() {
    const value = drafts["fatorCredCost"]?.trim();
    if (!value) return;
    const n = Number.parseFloat(value.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      setSaveStatus((s) => ({ ...s, fatorCredCost: "err" }));
      return;
    }
    await commitSave("fatorCredCost", String(n));
  }

  async function commitSave(key: string, value: string) {
    setSaving(key);
    setSaveStatus((s) => ({ ...s, [key]: undefined as unknown as "ok" }));
    try {
      await apiPutJson(`/api/admin/system-config/${key}`, { value });
      setSaveStatus((s) => ({ ...s, [key]: "ok" }));
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.configkey === key);
        const updated = { configkey: key, configvalue: value, description: null, updatedat: new Date().toISOString() };
        return idx >= 0 ? prev.map((i, x) => (x === idx ? updated : i)) : [...prev, updated];
      });
    } catch {
      setSaveStatus((s) => ({ ...s, [key]: "err" }));
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <div><Header /><main style={{ padding: "2rem" }}>Carregando…</main></div>;
  if (loadErr) return <div><Header /><main style={{ padding: "2rem" }}><p className="mm-error">{loadErr}</p><Link to="/admin" className="mm-btn">← Voltar</Link></main></div>;

  return (
    <div>
      <Header meRefreshKey={0} />
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <Link to="/admin" className="mm-btn">← Admin</Link>
          <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>
            Configurações do sistema
          </h1>
        </div>

        <section className={adminStyles.panel}>
          <h2 className={adminStyles.tableToolbarLabel} style={{ marginBottom: "1rem" }}>
            Pesquisa semântica — limiares
          </h2>
          <p className="mm-muted" style={{ marginBottom: "1.25rem", fontSize: "0.88rem" }}>
            Quando a busca semântica retorna vazio, o sistema reduz o limiar em 10% a cada tentativa até o mínimo configurado.
            Valores entre 0.01 e 1.00.
          </p>

          {THRESHOLD_KEYS.map((k) => (
            <div key={k.key} style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.3rem" }}>
                {k.label}
              </label>
              <p style={{ margin: "0 0 0.45rem", fontSize: "0.8rem", color: "var(--mm-text-muted, #64748b)" }}>{k.hint}</p>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="number"
                  className="mm-field"
                  min="0.01"
                  max="1"
                  step="0.05"
                  style={{ width: 110 }}
                  value={drafts[k.key] ?? k.defaultValue}
                  onChange={(e) => setDrafts((d) => ({ ...d, [k.key]: e.target.value }))}
                />
                <button
                  type="button"
                  className="mm-btn mm-btn--primary"
                  disabled={saving === k.key}
                  onClick={() => void saveThreshold(k.key)}
                >
                  {saving === k.key ? "Salvando…" : "Salvar"}
                </button>
                {saveStatus[k.key] === "ok" && <span style={{ color: "var(--mm-accent, #0d9488)", fontSize: "0.85rem" }}>✓ Salvo</span>}
                {saveStatus[k.key] === "err" && <span style={{ color: "#ef4444", fontSize: "0.85rem" }}>Valor inválido (0.01–1.00)</span>}
              </div>
            </div>
          ))}
        </section>

        <section className={adminStyles.panel} style={{ marginTop: "1.5rem" }}>
          <h2 className={adminStyles.tableToolbarLabel} style={{ marginBottom: "1rem" }}>
            Outros
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {/* fatorCredCost */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr auto",
              gap: "0.75rem 1.5rem", alignItems: "start",
              padding: "1rem 0", borderBottom: "1px solid var(--mm-border, #e2e8f0)",
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.2rem" }}>
                  Multiplicador USD → créditos
                  <code style={{ marginLeft: "0.4rem", fontSize: "0.75rem", fontWeight: 400, background: "var(--mm-surface-alt, #f1f5f9)", padding: "0.1rem 0.35rem", borderRadius: 4 }}>fatorCredCost</code>
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--mm-text-muted, #64748b)", lineHeight: 1.45 }}>
                  Multiplica o custo em USD para calcular créditos consumidos exibidos na UI. Padrão: 100.
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", alignItems: "flex-end", minWidth: 200 }}>
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  <input
                    type="number"
                    className="mm-field"
                    min="0.001"
                    step="1"
                    style={{ width: 90 }}
                    value={drafts["fatorCredCost"] ?? "100"}
                    onChange={(e) => setDrafts((d) => ({ ...d, fatorCredCost: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="mm-btn mm-btn--primary"
                    disabled={saving === "fatorCredCost"}
                    onClick={() => void saveFator()}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {saving === "fatorCredCost" ? "Salvando…" : "Salvar"}
                  </button>
                </div>
                {saveStatus["fatorCredCost"] === "ok" && <span style={{ color: "var(--mm-accent, #0d9488)", fontSize: "0.8rem" }}>✓ Salvo</span>}
                {saveStatus["fatorCredCost"] === "err" && <span style={{ color: "#ef4444", fontSize: "0.8rem" }}>Número positivo obrigatório</span>}
              </div>
            </div>

            {/* BOOL_KEYS */}
            {BOOL_KEYS.map((k, idx) => (
              <div key={k.key} style={{
                display: "grid", gridTemplateColumns: "1fr auto",
                gap: "0.75rem 1.5rem", alignItems: "start",
                padding: "1rem 0",
                borderBottom: idx < BOOL_KEYS.length - 1 ? "1px solid var(--mm-border, #e2e8f0)" : undefined,
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.2rem" }}>
                    {k.label}
                    <code style={{ marginLeft: "0.4rem", fontSize: "0.75rem", fontWeight: 400, background: "var(--mm-surface-alt, #f1f5f9)", padding: "0.1rem 0.35rem", borderRadius: 4 }}>{k.key}</code>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--mm-text-muted, #64748b)", lineHeight: 1.45 }}>{k.hint}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", alignItems: "flex-end", minWidth: 200 }}>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <select
                      className="mm-field"
                      style={{ width: 110 }}
                      value={drafts[k.key] ?? k.defaultValue}
                      onChange={(e) => setDrafts((d) => ({ ...d, [k.key]: e.target.value }))}
                    >
                      <option value="1">Ativo (1)</option>
                      <option value="0">Inativo (0)</option>
                    </select>
                    <button
                      type="button"
                      className="mm-btn mm-btn--primary"
                      disabled={saving === k.key}
                      onClick={() => void commitSave(k.key, drafts[k.key] ?? k.defaultValue)}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {saving === k.key ? "Salvando…" : "Salvar"}
                    </button>
                  </div>
                  {saveStatus[k.key] === "ok" && <span style={{ color: "var(--mm-accent, #0d9488)", fontSize: "0.8rem" }}>✓ Salvo</span>}
                  {saveStatus[k.key] === "err" && <span style={{ color: "#ef4444", fontSize: "0.8rem" }}>Erro ao salvar</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={adminStyles.panel} style={{ marginTop: "1.5rem" }}>
          <h2 className={adminStyles.tableToolbarLabel} style={{ marginBottom: "0.75rem" }}>
            Todos os valores (system_config)
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
            <thead>
              <tr>
                {["Chave", "Valor", "Atualizado em"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "0.35rem 0.5rem", borderBottom: "2px solid var(--mm-border, #e2e8f0)", color: "var(--mm-text-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.configkey} style={{ borderBottom: "1px solid var(--mm-border, #e2e8f0)" }}>
                  <td style={{ padding: "0.4rem 0.5rem", fontFamily: "monospace" }}>{item.configkey}</td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>{item.configvalue}</td>
                  <td style={{ padding: "0.4rem 0.5rem", color: "var(--mm-text-muted)" }}>
                    {new Date(item.updatedat).toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={3} style={{ padding: "0.75rem 0.5rem", color: "var(--mm-text-muted)" }}>Nenhuma configuração encontrada.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
