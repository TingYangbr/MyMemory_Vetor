import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ConvitePendente, MeResponse } from "@mymemory/shared";
import Header from "../components/Header";
import { apiGet, apiGetOptional } from "../api";
import styles from "./AuthPage.module.css";

/**
 * Entrar num grupo existente — lote 4 do redesenho. Só se entra por convite: a tela mostra o e-mail
 * para passar ao dono do grupo e os convites pendentes para esse e-mail.
 */
export default function GroupJoinPlaceholderPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [convites, setConvites] = useState<ConvitePendente[] | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    void apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (r.ok) setEmail(r.data.email ?? null);
    });
    apiGet<{ convites: ConvitePendente[] }>("/api/me/convites")
      .then((r) => setConvites(r.convites))
      .catch(() => setConvites([]));
  }, []);

  async function copiar() {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* navegador sem permissão de área de transferência: o e-mail continua visível */
    }
  }

  return (
    <>
      <Header />
      <div style={{ padding: "2rem 1rem 3rem", display: "flex", justifyContent: "center" }}>
        <div className={styles.card} style={{ margin: 0, maxWidth: 520 }}>
          <h1 className={styles.title}>Entrar num grupo existente</h1>
          <p className={styles.sub}>Só se entra num grupo por convite. Peça ao dono do grupo que convide o seu e-mail:</p>
          <div className={styles.planoBox}>
            <span className={styles.planoNome}>{email ?? "…"}</span>
            <button type="button" className="mm-btn" onClick={() => void copiar()} disabled={!email}>
              {copiado ? "Copiado ✓" : "Copiar"}
            </button>
          </div>
          <p className={styles.sub}>O convite chega por e-mail. Também aparece aqui quando você abrir esta tela.</p>

          <h2 className={styles.label} style={{ margin: "0.5rem 0 0.6rem", fontSize: "0.9rem" }}>
            Convites esperando você
          </h2>
          {convites == null ? <p className={styles.sub}>Carregando…</p> : null}
          {convites != null && convites.length === 0 ? (
            <p className={styles.sub} style={{ marginBottom: 0 }}>
              Nenhum convite pendente para este e-mail.
            </p>
          ) : null}
          {convites?.map((c) => (
            <div
              key={c.token}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.8rem 0.9rem",
                marginBottom: "0.6rem",
                border: "1px solid var(--mm-border)",
                borderRadius: 10,
              }}
            >
              <span style={{ flex: 1, fontSize: "0.92rem" }}>
                <strong>{c.groupName}</strong>
                {c.inviterName ? (
                  <>
                    <br />
                    <span style={{ color: "var(--mm-muted)", fontSize: "0.82rem" }}>convite de {c.inviterName}</span>
                  </>
                ) : null}
              </span>
              <Link to={`/convite/grupo?token=${encodeURIComponent(c.token)}`} className="mm-btn mm-btn--primary">
                Ver convite
              </Link>
            </div>
          ))}

          <div className={styles.divisor} />
          <p className={styles.rodape}>
            Quer um grupo seu? <Link to="/grupo/novo">Criar grupo</Link>
          </p>
        </div>
      </div>
    </>
  );
}
