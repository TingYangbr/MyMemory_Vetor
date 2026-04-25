import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { AcceptGroupInviteResponse, MeResponse } from "@mymemory/shared";
import { apiGetOptional, apiPatchJson, apiPostJson } from "../api";
import styles from "./AuthPage.module.css";

function inviteReturnPath(token: string): string {
  return `/convite/grupo?token=${encodeURIComponent(token)}`;
}

export default function GroupInviteAcceptPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => (searchParams.get("token") ?? "").trim(), [searchParams]);

  const [phase, setPhase] = useState<"loading" | "guest" | "working" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPhase("error");
      setError("Link incompleto ou sem token.");
      return;
    }

    let cancelled = false;
    (async () => {
      const meR = await apiGetOptional<MeResponse>("/api/me");
      if (cancelled) return;
      if (!meR.ok) {
        setPhase("guest");
        return;
      }
      setPhase("working");
      setError(null);
      setErrorCode(null);
      try {
        const res = await apiPostJson<AcceptGroupInviteResponse>("/api/group-invites/accept", { token });
        try {
          await apiPatchJson("/api/me/workspace", { groupId: res.groupId });
        } catch {
          if (!cancelled) navigate("/?escolherEspaco=1", { replace: true });
          return;
        }
        if (!cancelled) navigate("/", { replace: true });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        let code: string | null = null;
        let msg = raw;
        try {
          const j = JSON.parse(raw) as { message?: string; error?: string };
          code = j.error ?? null;
          msg = j.message ?? raw;
        } catch {
          /* manter msg */
        }
        if (!cancelled) {
          setPhase("error");
          setError(msg);
          setErrorCode(code);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  const returnPath = token ? inviteReturnPath(token) : "/convite/grupo";
  const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;
  const planHref = `/select-plan?next=${encodeURIComponent(returnPath)}`;

  if (!token) {
    return (
      <div className={styles.shell}>
        <div className={styles.card}>
          <h1 className={styles.title}>Convite de grupo</h1>
          <p className={styles.error} role="alert">
            {error}
          </p>
          <div className={styles.links}>
            <Link to="/">Início</Link>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "loading" || phase === "working") {
    return (
      <div className={styles.shell}>
        <div className={styles.card}>
          <h1 className={styles.title}>Convite de grupo</h1>
          <p className={styles.sub}>
            {phase === "working" ? "Aceitando o convite…" : "Verificando a sessão…"}
          </p>
        </div>
      </div>
    );
  }

  if (phase === "guest") {
    return (
      <div className={styles.shell}>
        <div className={styles.card}>
          <h1 className={styles.title}>Convite de grupo</h1>
          <p className={styles.sub}>
            Para aceitar, entre com a conta do <strong>mesmo e-mail</strong> que recebeu o convite. Se ainda não
            tem conta, crie uma e escolha um plano individual; depois de confirmar o e-mail e entrar, abra de novo
            o link do convite (ou use o atalho abaixo após o login).
          </p>
          <div className={styles.links} style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            <Link to={loginHref} className="mm-btn mm-btn--primary">
              Entrar
            </Link>
            <Link to={planHref}>Criar conta — escolher plano</Link>
            <Link to="/">Início</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <h1 className={styles.title}>Convite de grupo</h1>
        <p className={styles.error} role="alert">
          {error}
        </p>
        {errorCode === "needs_individual_plan" ? (
          <p className={styles.sub}>
            Você precisa de uma assinatura individual ativa para participar de grupos. Escolha um plano, conclua o
            cadastro e volte a este passo.
          </p>
        ) : null}
        <div className={styles.links} style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {errorCode === "needs_individual_plan" ? (
            <Link to={planHref} className="mm-btn mm-btn--primary">
              Escolher plano individual
            </Link>
          ) : null}
          <Link to={loginHref}>Entrar</Link>
          <Link to={planHref}>Criar conta</Link>
          <Link to="/">Início</Link>
        </div>
      </div>
    </div>
  );
}
