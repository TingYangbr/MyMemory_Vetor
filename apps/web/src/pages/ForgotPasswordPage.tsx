import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { apiPostJson } from "../api";
import styles from "./AuthPage.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [mailFailed, setMailFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setMailFailed(false);
    setBusy(true);
    try {
      const res = await apiPostJson<{ message?: string; emailSendFailed?: boolean }>(
        "/api/auth/forgot-password",
        { email: email.trim() }
      );
      const failed = res?.emailSendFailed === true;
      const msg =
        typeof res?.message === "string" && res.message.trim()
          ? res.message.trim()
          : "Se o e-mail existir em nossa base, enviaremos instruções.";
      setMailFailed(failed);
      setMessage(msg);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      try {
        const j = JSON.parse(raw) as { message?: string; hint?: string };
        const parts = [j.message?.trim(), j.hint?.trim()].filter(Boolean);
        setError(parts.length ? parts.join(" — ") : raw);
      } catch {
        setError(raw.trim() || "Não foi possível conectar ao servidor. Confirme se a API está em execução (porta 4000).");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <h1 className={styles.title}>Esqueci a senha</h1>
        <p className={styles.sub}>
          Informe o e-mail da sua conta. Se existir, enviaremos um link para redefinir a senha.
        </p>

        <form onSubmit={(e) => void onSubmit(e)}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="forgot-email">
              E-mail
            </label>
            <input
              id="forgot-email"
              className={styles.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className={styles.actions}>
            <button type="submit" className={`mm-btn mm-btn--primary ${styles.wide}`} disabled={busy}>
              {busy ? "Enviando…" : "Enviar link"}
            </button>
          </div>

          <div className={styles.formFeedback} aria-live="polite">
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            {message && mailFailed ? (
              <div className={styles.warning} role="alert">
                <strong>Falha no envio</strong>
                <p style={{ margin: "0.4rem 0 0" }}>{message}</p>
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem", opacity: 0.95 }}>
                  Confira o terminal da API,{" "}
                  <a href="https://resend.com/emails" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                    resend.com/emails
                  </a>{" "}
                  e se o e-mail está igual ao cadastrado no banco.
                </p>
              </div>
            ) : null}
            {message && !mailFailed ? (
              <p className={styles.success} role="status">
                {message}
              </p>
            ) : null}
          </div>
        </form>

        <div className={styles.links}>
          <Link to="/login">← Voltar ao login</Link>
        </div>
      </div>
    </div>
  );
}
