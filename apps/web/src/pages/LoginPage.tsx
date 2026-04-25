import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiPostJson } from "../api";
import styles from "./AuthPage.module.css";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const afterLogin = useMemo(() => safeNext(searchParams.get("next")), [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    setResendMsg(null);
    setBusy(true);
    try {
      await apiPostJson("/api/auth/login", { email, password });
      navigate(afterLogin, { replace: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      try {
        const j = JSON.parse(raw) as { message?: string; error?: string };
        setErrorCode(j.error ?? null);
        setError(j.message ?? raw);
      } catch {
        setError(raw || "Não foi possível entrar.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onResendVerification() {
    setResendBusy(true);
    setResendMsg(null);
    try {
      const res = await apiPostJson<{ message?: string }>("/api/auth/resend-verification", {
        email,
        ...(afterLogin && afterLogin !== "/" ? { next: afterLogin } : {}),
      });
      setResendMsg(res.message ?? "E-mail de confirmação reenviado.");
    } catch {
      setResendMsg("Não foi possível reenviar. Tente novamente.");
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <h1 className={styles.title}>Entrar</h1>
        <p className={styles.sub}>Use o e-mail e a senha da sua conta MyMemory.</p>

        {error ? (
          <div className={styles.error} role="alert">
            <p style={{ margin: 0 }}>{error}</p>
            {errorCode === "email_not_verified" ? (
              <p style={{ margin: "0.65rem 0 0", fontSize: "0.92rem" }}>
                {resendMsg ? (
                  resendMsg
                ) : (
                  <button
                    type="button"
                    onClick={() => void onResendVerification()}
                    disabled={resendBusy}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", color: "inherit", fontSize: "inherit" }}
                  >
                    {resendBusy ? "Enviando…" : "Reenviar e-mail de confirmação"}
                  </button>
                )}
              </p>
            ) : null}
          </div>
        ) : null}

        <form onSubmit={(e) => void onSubmit(e)}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="login-email">
              E-mail
            </label>
            <input
              id="login-email"
              className={styles.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="login-password">
              Senha
            </label>
            <input
              id="login-password"
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className={styles.actions}>
            <button type="submit" className={`mm-btn mm-btn--primary ${styles.wide}`} disabled={busy}>
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </div>
        </form>

        <div className={styles.links}>
          <Link to={afterLogin !== "/" ? `/select-plan?next=${encodeURIComponent(afterLogin)}` : "/select-plan"}>
            Criar conta
          </Link>
          <Link to="/esqueci-senha">Esqueci a senha</Link>
        </div>
      </div>
    </div>
  );
}
