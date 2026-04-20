import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MeResponse } from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPutJson } from "../api";
import Header from "../components/Header";
import adminStyles from "./AdminPage.module.css";
import styles from "./AdminDocumentAiPage.module.css";

type RoutingGet = { json: string; usingDefaults: boolean };

export default function AdminDocumentAiPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [usingDefaults, setUsingDefaults] = useState(false);
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

  const loadRouting = useCallback(() => {
    if (me?.role !== "admin") return Promise.resolve();
    setLoadErr(null);
    return apiGet<RoutingGet>("/api/admin/document-ai-routing")
      .then((r) => {
        setJsonText(r.json);
        setUsingDefaults(r.usingDefaults);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Falha ao carregar."));
  }, [me?.role]);

  useEffect(() => {
    if (me?.role === "admin") void loadRouting();
  }, [me?.role, loadRouting]);

  async function save() {
    setSaving(true);
    setSaveErr(null);
    setSaveOk(false);
    try {
      await apiPutJson("/api/admin/document-ai-routing", { documentRoutingJson: jsonText });
      setSaveOk(true);
      await loadRouting();
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
          <Link to="/login" className={adminStyles.back}>
            Ir ao login
          </Link>
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
      <main className={`${adminStyles.main} ${adminStyles.mainWide}`}>
        <Link to="/admin" className={adminStyles.back}>
          ← Painel admin
        </Link>
        <h1 className={adminStyles.title}>Documento — roteamento IA</h1>
        <p className={adminStyles.lead}>
          Coluna <code className={adminStyles.tableToolbarCode}>ai_config.documentRoutingJson</code> na operação{" "}
          <code className={adminStyles.tableToolbarCode}>memo_document_ia</code>. Define regras <strong>preprocess</strong>{" "}
          (ordem importa: primeira que coincidir) com pipelines <code>extract_utf8_text</code>,{" "}
          <code>extract_pdf_text</code>, <code>extract_msg_text</code> (Outlook .msg),{" "}
          <code>extract_eml_text</code> (e-mail .eml / Gmail), <code>extract_docx_text</code> (Word .docx) ou{" "}
          <code>unsupported</code>. O
          bloco <code>providers</code> é referência para
          integrações futuras (input direto OpenAI/Gemini).
        </p>
        {usingDefaults ? (
          <p className="mm-muted">
            A base ainda não tem JSON gravado — o texto abaixo é o default mesclado (salvar persiste no banco).
          </p>
        ) : null}
        {loadErr ? <p className="mm-error">{loadErr}</p> : null}
        <textarea
          className={styles.jsonArea}
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            setSaveOk(false);
          }}
          spellCheck={false}
          aria-label="JSON de roteamento de documentos"
        />
        <div className={styles.actions}>
          <button type="button" className="mm-btn mm-btn--primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Salvando…" : "Salvar JSON"}
          </button>
          {saveOk ? <span className={styles.ok}>Guardado.</span> : null}
          {saveErr ? <span className="mm-error">{saveErr}</span> : null}
        </div>
      </main>
    </div>
  );
}
