import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { IndividualPlanOption, IndividualPlansResponse } from "@mymemory/shared";
import { apiGet, apiPostJson } from "../api";
import styles from "./AuthPage.module.css";
import { tokenDoConvite, useConviteGrupo } from "../lib/conviteGrupo";

function formatBrl(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextForApi = useMemo(() => {
    const n = searchParams.get("next")?.trim();
    if (n && n.startsWith("/") && !n.startsWith("//")) return n;
    return undefined;
  }, [searchParams]);
  const selectPlanHref = nextForApi
    ? `/select-plan?next=${encodeURIComponent(nextForApi)}`
    : "/select-plan";
  const loginHref = nextForApi ? `/login?next=${encodeURIComponent(nextForApi)}` : "/login";
  const inviteToken = useMemo(() => {
    const t = searchParams.get("inviteToken")?.trim();
    return t || undefined;
  }, [searchParams]);
  const [email, setEmail] = useState("");
  // Cadastro aberto pelo convite de grupo: e-mail do convite já preenchido e travado
  const convite = useConviteGrupo(tokenDoConvite(nextForApi));
  const emailTravado = convite?.status === "pending" && !convite.temConta;
  useEffect(() => {
    if (emailTravado && convite) setEmail(convite.email);
  }, [emailTravado, convite]);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [planId, setPlanId] = useState<number | null>(null);
  const [chosenPlan, setChosenPlan] = useState<IndividualPlanOption | null>(null);
  const [planGate, setPlanGate] = useState<"loading" | "ok" | "redirect">("loading");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mailFailed, setMailFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailTaken, setEmailTaken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const raw = searchParams.get("planId");
    const pid = raw ? Number(raw) : NaN;
    if (!Number.isFinite(pid) || pid < 1) {
      setPlanGate("redirect");
      const n = searchParams.get("next")?.trim();
      const q =
        n && n.startsWith("/") && !n.startsWith("//") ? `?next=${encodeURIComponent(n)}` : "";
      navigate(`/select-plan${q}`, { replace: true });
      return;
    }
    (async () => {
      try {
        const data = await apiGet<IndividualPlansResponse>("/api/auth/individual-plans");
        if (cancelled) return;
        const list = data.plans ?? [];
        const chosen = list.find((p) => p.id === pid);
        if (!chosen) {
          setPlanGate("redirect");
          navigate("/select-plan", { replace: true });
          return;
        }
        setPlanId(pid);
        setChosenPlan(chosen);
        setPlanGate("ok");
      } catch {
        if (!cancelled) {
          setPlanGate("redirect");
          navigate("/select-plan", { replace: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setMailFailed(false);
    setEmailTaken(false);
    if (planId == null) {
      setError("Plano inválido. Volte à seleção de planos.");
      return;
    }
    setBusy(true);
    try {
      const body: { email: string; password: string; planId: number; name?: string; next?: string; inviteToken?: string } = {
        email,
        password,
        planId,
      };
      if (name.trim()) body.name = name.trim();
      if (nextForApi) body.next = nextForApi;
      if (inviteToken) body.inviteToken = inviteToken;
      const res = await apiPostJson<{ message?: string; emailSendFailed?: boolean }>(
        "/api/auth/register",
        body
      );
      setMailFailed(res.emailSendFailed === true);
      setSuccess(res.message ?? "Conta criada. Verifique seu e-mail.");
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      try {
        const j = JSON.parse(raw) as { message?: string; error?: string };
        if (j.error === "email_taken") {
          setEmailTaken(true);
          setError(j.message ?? raw);
        } else {
          setError(j.message ?? raw);
        }
      } catch {
        setError(raw || "Não foi possível cadastrar.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (planGate === "loading" || planGate === "redirect") {
    return (
      <div className={styles.shell}>
        <div className={styles.card}>
          <p className={styles.sub}>Carregando…</p>
          <div className={styles.links}>
            <Link to="/select-plan">Escolher plano</Link>
          </div>
        </div>
      </div>
    );
  }

  const priceLabel =
    chosenPlan && chosenPlan.price > 0 ? `${formatBrl(chosenPlan.price)}/mês` : "Grátis";

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <h1 className={styles.title}>{success && !mailFailed ? "Confirme seu e-mail" : "Criar conta"}</h1>
        {!success ? (
          <p className={styles.sub}>
            Plano <strong>{chosenPlan?.name}</strong> ({priceLabel}) · <Link to={selectPlanHref}>Alterar plano</Link>
          </p>
        ) : null}

        {emailTravado && convite && !success ? (
          <div className={styles.success} role="note">
            Convite para o grupo <strong>{convite.groupName}</strong> no proMemory. Crie sua conta com{" "}
            <strong>{convite.email}</strong>: depois de confirmar o e-mail, você já entra no grupo.
          </div>
        ) : null}

        {error ? (
          <div className={styles.error} role="alert">
            <p style={{ margin: 0 }}>{error}</p>
            {emailTaken ? (
              <p style={{ margin: "0.65rem 0 0", fontSize: "0.92rem" }}>
                <Link to={loginHref}>Entrar</Link>
                {" · "}
                <Link to="/esqueci-senha">Esqueci a senha</Link>
              </p>
            ) : null}
          </div>
        ) : null}
        {success && mailFailed ? (
          <div className={styles.warning} role="alert">
            <strong>E-mail não enviado</strong>
            <p style={{ margin: "0.4rem 0 0" }}>{success}</p>
            <ul>
              <li>No painel da Resend (Emails → Logs), veja se o envio foi rejeitado.</li>
              <li>O domínio do remetente ({`EMAIL_FROM`}) precisa estar verificado na Resend.</li>
              <li>Confira spam/lixeira e a aba Promoções (Gmail).</li>
              <li>
                Com a API em dev, abra{" "}
                <a href="/api/debug/mail" style={{ color: "inherit" }}>
                  /api/debug/mail
                </a>{" "}
                e o terminal da API (mensagem{" "}
                <code style={{ fontSize: "0.8em" }}>[mail] Verificação aceita pelo Resend</code>).
              </li>
            </ul>
          </div>
        ) : null}
        {success && !mailFailed ? (
          <div className={styles.success} role="status">
            <p style={{ margin: 0 }}>
              Enviamos um link para <strong>{email}</strong>. Clique nele para ativar sua conta
              {emailTravado && convite ? <> e entrar no grupo <strong>{convite.groupName}</strong></> : null}.
            </p>
            <p style={{ margin: "0.45rem 0 0", fontSize: "0.82rem", opacity: 0.9 }}>
              Não chegou? Veja o spam.
            </p>
          </div>
        ) : null}

        {!success ? (
          <form onSubmit={(e) => void onSubmit(e)}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="reg-name">
                Nome
              </label>
              <input
                id="reg-name"
                className={styles.input}
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="reg-email">
                E-mail
              </label>
              <input
                id="reg-email"
                className={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={emailTravado}
                title={emailTravado ? "E-mail do convite — a conta precisa ser criada com ele" : undefined}
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="reg-password">
                Senha
              </label>
              <input
                id="reg-password"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div className={styles.actions}>
              <button type="submit" className={`mm-btn mm-btn--primary ${styles.wide}`} disabled={busy}>
                {busy ? "Cadastrando…" : "Cadastrar"}
              </button>
            </div>
          </form>
        ) : null}

        <div className={styles.links}>
          {success
            ? <Link to={loginHref}>Já confirmei meu e-mail → Entrar</Link>
            : <Link to={loginHref}>← Já tenho conta — entrar</Link>
          }
        </div>
      </div>
    </div>
  );
}
