import { FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { apiPostJson } from "../api";
import styles from "./AuthPage.module.css";

export default function ResetPasswordPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => search.get("token") ?? "", [search]);

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (password !== password2) {
      setError("As senhas não coincidem.");
      return;
    }
    if (!token) {
      setError("Link inválido. Abra o link recebido por e-mail.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiPostJson<{ message?: string }>("/api/auth/reset-password", {
        token,
        password,
      });
      setSuccess(res.message ?? "Senha atualizada.");
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      try {
        const j = JSON.parse(raw) as { message?: string };
        setError(j.message ?? raw);
      } catch {
        setError(raw);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <h1 className={styles.title}>Nova senha</h1>
        <p className={styles.sub}>Defina uma nova senha (mínimo 8 caracteres).</p>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className={styles.success} role="status">
            {success} Redirecionando ao login…
          </p>
        ) : null}

        {!success ? (
          <form onSubmit={(e) => void onSubmit(e)}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="np1">
                Nova senha
              </label>
              <input
                id="np1"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="np2">
                Repetir senha
              </label>
              <input
                id="np2"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className={styles.actions}>
              <button type="submit" className={`mm-btn mm-btn--primary ${styles.wide}`} disabled={busy}>
                {busy ? "Salvando…" : "Salvar senha"}
              </button>
            </div>
          </form>
        ) : null}

        <div className={styles.links}>
          <Link to="/login">Ir ao login</Link>
        </div>
      </div>
    </div>
  );
}
