import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { CreateGroupResponse, GroupPlanOption, GroupPlansResponse, MeResponse } from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPostJson } from "../api";
import flowStyles from "./GroupFlowPlaceholder.module.css";
import planStyles from "./SelectPlanPage.module.css";
import authStyles from "./AuthPage.module.css";

function formatBrl(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function sortPlans(plans: GroupPlanOption[]): GroupPlanOption[] {
  return [...plans].sort((a, b) => a.price - b.price || a.id - b.id);
}

function priceLine(p: GroupPlanOption): { main: string; suffix: string } {
  if (p.price <= 0) return { main: "Sem cobrança (por enquanto)", suffix: "" };
  return { main: formatBrl(p.price), suffix: "/mês" };
}

function groupPlanFeatures(p: GroupPlanOption): string[] {
  const lines: string[] = [
    `${p.maxMemos} memos do grupo`,
    `${p.maxStorageGB} GB de armazenamento`,
  ];
  if (p.maxMembers != null && p.maxMembers > 0) {
    lines.push(`Até ${p.maxMembers} membros`);
  } else if (p.maxMembers == null) {
    lines.push("Membros conforme plano");
  }
  if (p.durationDays != null && p.durationDays > 0) {
    lines.push(`Ciclo de ${p.durationDays} dias (renovação manual até integrar pagamento)`);
  }
  return lines;
}

export default function GroupCreatePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const planIdRaw = searchParams.get("planId");
  const planId = planIdRaw ? Number(planIdRaw) : NaN;
  const hasValidPlan = Number.isFinite(planId) && planId > 0;

  const [me, setMe] = useState<MeResponse | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [plans, setPlans] = useState<GroupPlanOption[]>([]);
  const [plansLoading, setPlansLoading] = useState(!hasValidPlan);
  const [plansErr, setPlansErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGetOptional<MeResponse>("/api/me");
      if (cancelled) return;
      if (!r.ok) {
        if (r.status === 401) {
          navigate(`/login?next=${encodeURIComponent("/grupo/novo")}`, { replace: true });
          return;
        }
        setMe(null);
        setAuthReady(true);
        return;
      }
      setMe(r.data);
      setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (!authReady || me == null || hasValidPlan) return;
    let cancelled = false;
    (async () => {
      setPlansLoading(true);
      setPlansErr(null);
      try {
        const data = await apiGet<GroupPlansResponse>("/api/group-plans");
        if (!cancelled) setPlans(data.plans ?? []);
      } catch {
        if (!cancelled) {
          setPlansErr("Não foi possível carregar os planos de grupo.");
          setPlans([]);
        }
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, me, hasValidPlan]);

  const sorted = useMemo(() => sortPlans(plans), [plans]);

  function selectPlan(id: number) {
    setSearchParams({ planId: String(id) });
  }

  function clearPlan() {
    setSearchParams({});
    setSubmitErr(null);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!hasValidPlan) return;
    setSubmitErr(null);
    setSubmitting(true);
    try {
      await apiPostJson<CreateGroupResponse>("/api/groups", {
        planId,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      navigate("/?escolherEspaco=1", { replace: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Não foi possível criar o grupo.";
      try {
        const j = JSON.parse(raw) as { message?: string; error?: string };
        const msg = j.message ?? raw;
        setSubmitErr(msg);
        if (j.error === "duplicate_group_name") {
          window.alert(msg);
        }
      } catch {
        setSubmitErr(raw);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!authReady) {
    return (
      <div className={planStyles.shell}>
        <p className={flowStyles.text}>Verificando sessão…</p>
      </div>
    );
  }

  if (!me) {
    return (
      <div className={planStyles.shell}>
        <main className={planStyles.main}>
          <p className={flowStyles.text}>Não foi possível carregar o perfil. Tente voltar ao início.</p>
          <Link to="/" className={flowStyles.back}>
            ← Início
          </Link>
        </main>
      </div>
    );
  }

  if (!hasValidPlan) {
    return (
      <div className={planStyles.shell}>
        <header className={planStyles.topBar}>
          <Link to="/" className={planStyles.brand} aria-label="proMemory — início">
            <img src="/mymemory-logo.png" alt="" width={36} height={36} />
            <span>proMemory</span>
          </Link>
          <nav className={planStyles.topLinks}>
            <Link to="/">Início</Link>
          </nav>
        </header>

        <main className={planStyles.main}>
          <div className={planStyles.head}>
            <h1 className={planStyles.title}>Novo grupo</h1>
            <p className={planStyles.subtitle}>
              Um espaço para dividir memos e perguntas com a família, sócios ou equipe. Primeiro, escolha o plano do grupo.
            </p>
          </div>

          {plansLoading ? <p className={planStyles.loading}>Carregando planos…</p> : null}
          {plansErr ? (
            <p className={planStyles.errorBox} role="alert">
              {plansErr}
            </p>
          ) : null}

          {!plansLoading && !plansErr && sorted.length === 0 ? (
            <p className={planStyles.errorBox} role="status">
              Nenhum plano de grupo ativo. Peça a um administrador para criar um plano tipo &quot;group&quot; no painel
              admin.
            </p>
          ) : null}

          {!plansLoading && sorted.length > 0 ? (
            <div className={planStyles.grid}>
              {sorted.map((p) => {
                const { main, suffix } = priceLine(p);
                const feats = groupPlanFeatures(p);
                return (
                  <article key={p.id} className={planStyles.card}>
                    <h2 className={planStyles.planName}>{p.name}</h2>
                    <div className={planStyles.price}>
                      {main}
                      {suffix ? <span className={planStyles.priceSuffix}> {suffix}</span> : null}
                    </div>
                    <ul className={planStyles.features}>
                      {feats.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <button type="button" className={planStyles.ctaPrimary} onClick={() => selectPlan(p.id)}>
                      Escolher
                    </button>
                  </article>
                );
              })}
            </div>
          ) : null}

          <footer className={planStyles.footerNote}>
            <p>Depois de escolher o plano, você dá um nome ao grupo e passa a ser o dono dele.</p>
          </footer>
        </main>
      </div>
    );
  }

  return (
    <div className={planStyles.shell}>
      <header className={planStyles.topBar}>
        <Link to="/" className={planStyles.brand} aria-label="proMemory — início">
          <img src="/mymemory-logo.png" alt="" width={36} height={36} />
          <span>proMemory</span>
        </Link>
        <nav className={planStyles.topLinks} aria-label="Navegação">
          <Link
            to="/grupo/novo"
            onClick={() => {
              setSubmitErr(null);
              setName("");
              setDescription("");
            }}
          >
            ← Outro plano
          </Link>
        </nav>
      </header>

      <main className={planStyles.main} style={{ maxWidth: 560 }}>
        <form onSubmit={(e) => void submitCreate(e)} className={authStyles.card} style={{ maxWidth: "none" }}>
          <h1 className={authStyles.title}>Novo grupo</h1>
          <p className={authStyles.sub}>Um espaço para dividir memos e perguntas com a família, sócios ou equipe. Você será o dono.</p>
          <div className={authStyles.planoBox}>
            <div>
              <span className={authStyles.planoRotulo}>Plano do grupo</span>
              <span className={authStyles.planoNome}>{sorted.find((p) => p.id === planId)?.name ?? `Plano #${planId}`}</span>
            </div>
            <button type="button" className={authStyles.linkInline} onClick={clearPlan} disabled={submitting} style={{ background: "none", border: 0, cursor: "pointer", font: "inherit", fontSize: "0.85rem" }}>
              Trocar
            </button>
          </div>
          <div className={authStyles.field}>
            <label className={authStyles.label} htmlFor="g-name">
              Nome do grupo
            </label>
            <input
              id="g-name"
              className={authStyles.input}
              required
              maxLength={255}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex.: Família Yang"
            />
          </div>
          <div className={authStyles.field}>
            <label className={authStyles.label} htmlFor="g-desc">
              Para que serve <span style={{ fontWeight: 500, color: "var(--mm-muted)" }}>(opcional)</span>
            </label>
            <textarea
              id="g-desc"
              className={authStyles.input}
              rows={4}
              maxLength={8000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ex.: Agenda, contas e documentos da casa"
            />
          </div>

          {submitErr ? <p className={authStyles.error}>{submitErr}</p> : null}

          <div className={authStyles.actions}>
            <button type="submit" className={`mm-btn mm-btn--primary ${authStyles.wide}`} disabled={submitting || !name.trim()}>
              {submitting ? "Criando…" : "Criar grupo"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
