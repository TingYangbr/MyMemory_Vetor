import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { IndividualPlanOption, IndividualPlansResponse } from "@mymemory/shared";
import { apiGet } from "../api";
import styles from "./SelectPlanPage.module.css";

function formatBrl(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function sortPlansByPrice(plans: IndividualPlanOption[]): IndividualPlanOption[] {
  return [...plans].sort((a, b) => a.price - b.price || a.id - b.id);
}

function isPopularPlan(plan: IndividualPlanOption, index: number, sorted: IndividualPlanOption[]): boolean {
  if (/básico|basico/i.test(plan.name.trim())) return true;
  const n = sorted.length;
  if (n === 1) return true;
  if (n >= 3) return index === Math.floor(n / 2);
  if (n === 2) return index === 1;
  return false;
}

function planFeatures(p: IndividualPlanOption): string[] {
  const lines: string[] = [
    `${p.maxMemos} memos pessoais`,
    `${p.maxStorageGB} GB de armazenamento`,
    "Participar de grupos ilimitados",
  ];
  if (p.durationDays != null && p.durationDays > 0) {
    lines.push(`Válido por ${p.durationDays} dias`);
  }
  return lines;
}

function priceLine(p: IndividualPlanOption): { main: string; suffix: string } {
  if (p.price <= 0) {
    return { main: "Grátis", suffix: "" };
  }
  return { main: `${formatBrl(p.price)}`, suffix: "/mês" };
}

export default function SelectPlanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextSuffix = useMemo(() => {
    const n = searchParams.get("next")?.trim();
    if (n && n.startsWith("/") && !n.startsWith("//")) {
      return `&next=${encodeURIComponent(n)}`;
    }
    return "";
  }, [searchParams]);
  const [plans, setPlans] = useState<IndividualPlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiGet<IndividualPlansResponse>("/api/auth/individual-plans");
        if (!cancelled) setPlans(data.plans ?? []);
      } catch {
        if (!cancelled) {
          setError("Não foi possível carregar os planos. Tente de novo em instantes.");
          setPlans([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(() => sortPlansByPrice(plans), [plans]);

  function choosePlan(planId: number) {
    navigate(`/cadastro?planId=${encodeURIComponent(String(planId))}${nextSuffix}`);
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <Link to="/login" className={styles.brand} aria-label="myMemory — área de login">
          <img src="/mymemory-logo.png" alt="" width={36} height={36} />
          <span>myMemory</span>
        </Link>
        <nav className={styles.topLinks} aria-label="Conta">
          <Link to="/login">Entrar</Link>
        </nav>
      </header>

      <main className={styles.main}>
        <div className={styles.head}>
          <h1 className={styles.title}>Escolha seu Plano</h1>
          <p className={styles.subtitle}>
            Selecione o plano individual que melhor atende suas necessidades
          </p>
        </div>

        {loading ? <p className={styles.loading}>Carregando planos…</p> : null}
        {error ? (
          <p className={styles.errorBox} role="alert">
            {error}
          </p>
        ) : null}

        {!loading && !error && sorted.length === 0 ? (
          <p className={styles.errorBox} role="status">
            Nenhum plano individual disponível no momento. Contacte o suporte.
          </p>
        ) : null}

        {!loading && sorted.length > 0 ? (
          <div className={styles.grid}>
            {sorted.map((p, index) => {
              const popular = isPopularPlan(p, index, sorted);
              const { main, suffix } = priceLine(p);
              const feats = planFeatures(p);
              return (
                <article
                  key={p.id}
                  className={`${styles.card} ${popular ? styles.cardPopular : ""}`}
                >
                  {popular ? <span className={styles.badge}>Mais Popular</span> : null}
                  <h2 className={styles.planName}>{p.name}</h2>
                  <div className={styles.price}>
                    {main}
                    {suffix ? <span className={styles.priceSuffix}> {suffix}</span> : null}
                  </div>
                  <ul className={styles.features}>
                    {feats.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {popular ? (
                    <button
                      type="button"
                      className={styles.ctaPrimary}
                      onClick={() => choosePlan(p.id)}
                    >
                      Escolher plano
                    </button>
                  ) : (
                    <button type="button" className={styles.ctaLink} onClick={() => choosePlan(p.id)}>
                      Escolher plano
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        ) : null}

        <footer className={styles.footerNote}>
          <p>Todos os planos incluem acesso completo às funcionalidades de memos pessoais.</p>
          <p>Para criar grupos compartilhados, você precisará de um plano de grupo adicional.</p>
        </footer>
      </main>
    </div>
  );
}
