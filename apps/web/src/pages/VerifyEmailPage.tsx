import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiPostJson } from "../api";
import styles from "./AuthPage.module.css";

export default function VerifyEmailPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => search.get("token") ?? "", [search]);
  const nextPath = useMemo(() => {
    const n = search.get("next")?.trim();
    return n && n.startsWith("/") && !n.startsWith("//") ? n : null;
  }, [search]);
  const loginHref = nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login";
  // Com login automático vai direto ao destino (ex.: aceitar o convite); senão, ao login
  const [entrou, setEntrou] = useState(false);
  const destino = entrou ? nextPath ?? "/" : loginHref;

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Link inválido ou incompleto.");
      setDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiPostJson<{ message?: string; loggedIn?: boolean }>("/api/auth/verify-email", { token });
        if (!cancelled) {
          setMessage(res.message ?? "E-mail confirmado.");
          setEntrou(res.loggedIn === true);
          setDone(true);
          setCountdown(res.loggedIn ? 2 : 3);
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        if (!cancelled) {
          try {
            const j = JSON.parse(raw) as { message?: string };
            setError(j.message ?? raw);
          } catch {
            setError(raw);
          }
          setDone(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      navigate(destino, { replace: true });
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, destino, navigate]);

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <h1 className={styles.title}>Confirmar e-mail</h1>
        {!done ? <p className={styles.sub}>Validando o link…</p> : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <div className={styles.success} role="status">
            <p style={{ margin: 0, fontWeight: 600 }}>E-mail confirmado!</p>
            <p style={{ margin: "0.4rem 0 0" }}>
              {entrou
                ? nextPath?.startsWith("/convite/grupo") ? "Entrando no grupo…" : "Entrando…"
                : countdown !== null && countdown > 0
                  ? `Redirecionando para o login em ${countdown}…`
                  : "Redirecionando…"}
            </p>
          </div>
        ) : null}

        {done ? (
          <div className={styles.links}>
            <Link to={destino}>{entrou ? "Continuar" : "Entrar agora"}</Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
