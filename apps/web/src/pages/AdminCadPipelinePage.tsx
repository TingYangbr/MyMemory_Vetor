import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MeResponse } from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPutJson } from "../api";
import Header from "../components/Header";
import adminStyles from "./AdminPage.module.css";

type CadConfig = { enabled: boolean };

export default function AdminCadPipelinePage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me")
      .then((r) => {
        if (!r.ok) {
          if (r.status === 401) setNeedLogin(true);
          else setLoadErr(`Erro ao carregar o perfil (HTTP ${r.status}).`);
          setLoading(false);
          return;
        }
        setMe(r.data);
        setForbidden(r.data.role !== "admin");
        setLoading(false);
      })
      .catch(() => {
        setLoadErr("Não foi possível conectar à API.");
        setLoading(false);
      });
  }, []);

  const loadConfig = useCallback(() => {
    if (me?.role !== "admin") return Promise.resolve();
    setLoadErr(null);
    return apiGet<CadConfig>("/api/admin/cad-pipeline")
      .then((r) => setEnabled(r.enabled))
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Falha ao carregar."));
  }, [me?.role]);

  useEffect(() => {
    if (me?.role === "admin") void loadConfig();
  }, [me?.role, loadConfig]);

  async function save() {
    setSaving(true);
    setSaveErr(null);
    setSaveOk(false);
    try {
      await apiPutJson("/api/admin/cad-pipeline", { enabled });
      setSaveOk(true);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className={adminStyles.shell}>
        <Header />
        <main className={adminStyles.main}>
          <p className="mm-muted">Carregando…</p>
        </main>
      </div>
    );
  }

  if (needLogin) {
    return (
      <div className={adminStyles.shell}>
        <Header />
        <main className={adminStyles.main}>
          <h1 className={adminStyles.title}>Autenticação necessária</h1>
          <Link to="/login" className={adminStyles.back}>Ir ao login</Link>
        </main>
      </div>
    );
  }

  if (forbidden || me?.role !== "admin") {
    return (
      <div className={adminStyles.shell}>
        <Header />
        <main className={adminStyles.main}>
          <h1 className={adminStyles.title}>Acesso negado</h1>
        </main>
      </div>
    );
  }

  return (
    <div className={adminStyles.shell}>
      <Header />
      <main className={adminStyles.main}>
        <Link to="/admin" className={adminStyles.back}>← Painel admin</Link>
        <h1 className={adminStyles.title}>CAD/BIM — Pipeline IA</h1>
        <p className={adminStyles.lead}>
          Habilita o processamento de arquivos <strong>.ifc</strong> (IFC/BIM). Quando desabilitado,
          o upload é aceito mas o processamento retorna "Formato não suportado neste plano."
        </p>
        {loadErr ? <p className="mm-error">{loadErr}</p> : null}
        <div style={{ marginTop: "1.5rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                setSaveOk(false);
              }}
            />
            Habilitar processamento CAD/BIM (.ifc)
          </label>
        </div>
        <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            type="button"
            className="mm-btn mm-btn--primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
          {saveOk ? <span style={{ color: "var(--mm-green, green)" }}>Guardado.</span> : null}
          {saveErr ? <span className="mm-error">{saveErr}</span> : null}
        </div>
      </main>
    </div>
  );
}
