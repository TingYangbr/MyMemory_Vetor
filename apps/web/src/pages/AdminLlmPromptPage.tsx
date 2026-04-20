import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AdminLlmLastPromptResponse, MeResponse } from "@mymemory/shared";
import { apiGet, apiGetOptional } from "../api";
import Header from "../components/Header";
import adminStyles from "./AdminPage.module.css";
import styles from "./AdminLlmPromptPage.module.css";

export default function AdminLlmPromptPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [data, setData] = useState<AdminLlmLastPromptResponse["trace"]>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  const loadTrace = useCallback(() => {
    if (me?.role !== "admin") return Promise.resolve();
    setLoadErr(null);
    setRefreshing(true);
    return apiGet<AdminLlmLastPromptResponse>("/api/admin/llm-last-prompt")
      .then((r) => setData(r.trace))
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Falha ao carregar."))
      .finally(() => setRefreshing(false));
  }, [me?.role]);

  useEffect(() => {
    if (me?.role === "admin") void loadTrace();
  }, [me?.role, loadTrace]);

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
        <h1 className={adminStyles.title}>Último prompt LLM</h1>
        <p className={adminStyles.lead}>
          Mostra fielmente o último payload enviado para a API LLM (mensagens <code>system</code> e <code>user</code>) e
          a resposta <code>assistant</code>. Este registo é só em memória da API e perde-se ao reiniciar.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className="mm-btn mm-btn--primary"
            disabled={refreshing}
            onClick={() => void loadTrace()}
          >
            {refreshing ? "Atualizando…" : "Atualizar"}
          </button>
          {data ? (
            <span className={styles.meta}>
              {data.provider} · {data.model} · {new Date(data.createdAt).toLocaleString("pt-BR")}
            </span>
          ) : null}
        </div>

        {loadErr ? <p className="mm-error">{loadErr}</p> : null}
        {!data ? (
          <p className="mm-muted">
            Ainda não há chamada LLM registrada nesta instância da API. Execute um processamento e clique em atualizar.
          </p>
        ) : (
          <div className={styles.blocks}>
            {data.messages.map((m, idx) => (
              <section key={`${m.role}-${idx}`} className={styles.block}>
                <h2 className={styles.blockTitle}>{m.role}</h2>
                <textarea className={styles.codeArea} value={m.content} readOnly spellCheck={false} />
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
