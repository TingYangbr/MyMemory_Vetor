import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  MeResponse,
  SubscriptionAdminRow,
  SubscriptionsAdminResponse,
  SubscriptionMemberRow,
  SubscriptionMembersResponse,
} from "@mymemory/shared";
import { apiGet, apiGetOptional } from "../api";
import Header from "../components/Header";
import adminStyles from "./AdminPage.module.css";

const STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  expired: "Expirado",
  canceled: "Cancelado",
};

const STATUS_COLOR: Record<string, string> = {
  active: "var(--mm-success, #16a34a)",
  expired: "var(--mm-text-muted, #64748b)",
  canceled: "var(--mm-danger, #dc2626)",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("pt-BR"); } catch { return iso; }
}

function fmtUsd(v: number): string {
  return `$${v.toFixed(4)}`;
}

type MembersState = SubscriptionMemberRow[] | "loading" | { error: string };

export default function AdminSubscriptionsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rows, setRows] = useState<SubscriptionAdminRow[]>([]);
  const [filterType, setFilterType] = useState<"" | "individual" | "group">("");
  const [filterStatus, setFilterStatus] = useState<"" | "active" | "expired" | "canceled">("active");
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [membersCache, setMembersCache] = useState<Record<number, MembersState>>({});

  useEffect(() => {
    void apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (!r.ok) { if (r.status === 401) navigate("/login"); else setLoadErr("Sem acesso."); setLoading(false); return; }
      if (r.data.role !== "admin") { setLoadErr("Acesso restrito a administradores."); setLoading(false); return; }
      load("active", "");
    }).catch(() => { setLoadErr("Erro de rede."); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  function load(status: string, type: string) {
    setLoading(true);
    setLoadErr(null);
    setExpandedIds(new Set());
    setMembersCache({});
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (type) qs.set("type", type);
    apiGet<SubscriptionsAdminResponse>(`/api/admin/subscriptions?${qs.toString()}`)
      .then((r) => setRows(r.rows))
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Erro ao carregar."))
      .finally(() => setLoading(false));
  }

  function applyFilters() {
    load(filterStatus, filterType);
  }

  function fetchMembers(subscriptionId: number) {
    setMembersCache((prev) => ({ ...prev, [subscriptionId]: "loading" }));
    apiGet<SubscriptionMembersResponse>(`/api/admin/subscriptions/${subscriptionId}/members`)
      .then((r) => setMembersCache((prev) => ({ ...prev, [subscriptionId]: r.members })))
      .catch((e) => setMembersCache((prev) => ({
        ...prev,
        [subscriptionId]: { error: e instanceof Error ? e.message : "Erro ao carregar membros." },
      })));
  }

  function toggleExpand(subscriptionId: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(subscriptionId)) {
        next.delete(subscriptionId);
      } else {
        next.add(subscriptionId);
        if (!membersCache[subscriptionId]) fetchMembers(subscriptionId);
      }
      return next;
    });
  }

  const q = search.trim().toLowerCase();
  const displayed = q
    ? rows.filter((r) =>
        String(r.groupId ?? "").includes(q) ||
        (r.groupName ?? "").toLowerCase().includes(q) ||
        (r.ownerEmail ?? "").toLowerCase().includes(q) ||
        (r.ownerName ?? "").toLowerCase().includes(q) ||
        r.planName.toLowerCase().includes(q) ||
        (r.groupAccessCode ?? "").toLowerCase().includes(q)
      )
    : rows;

  if (loadErr && !loading) return (
    <div><Header />
      <main style={{ padding: "2rem" }}>
        <p className="mm-error">{loadErr}</p>
        <Link to="/admin" className="mm-btn">← Voltar</Link>
      </main>
    </div>
  );

  return (
    <div>
      <Header meRefreshKey={0} />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <Link to="/admin" className="mm-btn">← Admin</Link>
          <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Assinaturas</h1>
        </div>

        {/* Filtros */}
        <div className={adminStyles.panel} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.2rem", fontWeight: 600 }}>Tipo</label>
            <select className="mm-field" value={filterType} onChange={(e) => setFilterType(e.target.value as typeof filterType)}>
              <option value="">Todos</option>
              <option value="group">Grupo</option>
              <option value="individual">Individual</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.2rem", fontWeight: 600 }}>Status</label>
            <select className="mm-field" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}>
              <option value="">Todos</option>
              <option value="active">Ativo</option>
              <option value="expired">Expirado</option>
              <option value="canceled">Cancelado</option>
            </select>
          </div>
          <button type="button" className="mm-btn mm-btn--primary" onClick={applyFilters} disabled={loading}>
            {loading ? "Carregando…" : "Filtrar"}
          </button>
          <div style={{ marginLeft: "auto" }}>
            <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.2rem", fontWeight: 600 }}>Busca rápida</label>
            <input
              className="mm-field"
              type="text"
              placeholder="nome, email, groupId, código…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 220 }}
            />
          </div>
        </div>

        {loadErr ? <p className="mm-error">{loadErr}</p> : null}

        <div style={{ overflowX: "auto" }}>
          <table className={adminStyles.table} style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ whiteSpace: "nowrap" }}>ID</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Plano</th>
                <th style={{ whiteSpace: "nowrap" }}>Grupo / Proprietário</th>
                <th style={{ whiteSpace: "nowrap" }}>groupId</th>
                <th style={{ whiteSpace: "nowrap" }}>Código</th>
                <th style={{ textAlign: "right" }}>Membros</th>
                <th style={{ textAlign: "right" }}>Memos</th>
                <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Custo IA</th>
                <th style={{ whiteSpace: "nowrap" }}>Início</th>
                <th style={{ whiteSpace: "nowrap" }}>Vencimento</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} style={{ padding: "1rem", textAlign: "center", color: "var(--mm-text-muted)" }}>Carregando…</td></tr>
              ) : displayed.length === 0 ? (
                <tr><td colSpan={12} style={{ padding: "1rem", textAlign: "center", color: "var(--mm-text-muted)" }}>Nenhuma assinatura encontrada.</td></tr>
              ) : displayed.map((r) => {
                const isGroup = r.type === "group";
                const isExpanded = expandedIds.has(r.subscriptionId);
                const membersState = membersCache[r.subscriptionId];
                return (
                  <Fragment key={r.subscriptionId}>
                    <tr
                      onClick={isGroup ? () => toggleExpand(r.subscriptionId) : undefined}
                      style={{ cursor: isGroup ? "pointer" : undefined }}
                      title={isGroup ? (isExpanded ? "Clique para recolher membros" : "Clique para ver membros") : undefined}
                    >
                      <td style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                        {isGroup && (
                          <span style={{ marginRight: "0.35rem", fontSize: "0.7rem", color: "var(--mm-text-muted)" }}>
                            {isExpanded ? "▼" : "▶"}
                          </span>
                        )}
                        {r.subscriptionId}
                      </td>
                      <td>{isGroup ? "Grupo" : "Individual"}</td>
                      <td style={{ color: STATUS_COLOR[r.status] ?? undefined, fontWeight: 600 }}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </td>
                      <td>{r.planName}</td>
                      <td>
                        {isGroup ? (
                          <>
                            <span style={{ fontWeight: 600 }}>{r.groupName ?? "—"}</span>
                            <br />
                            <span style={{ fontSize: "0.8rem", color: "var(--mm-text-muted)" }}>
                              {r.ownerName ?? r.ownerEmail ?? `userId ${r.ownerId}`}
                            </span>
                          </>
                        ) : (
                          <>
                            <span>{r.ownerName ?? "—"}</span>
                            <br />
                            <span style={{ fontSize: "0.8rem", color: "var(--mm-text-muted)" }}>{r.ownerEmail ?? `userId ${r.ownerId}`}</span>
                          </>
                        )}
                      </td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.groupId ?? "—"}</td>
                      <td><code style={{ fontSize: "0.8rem" }}>{r.groupAccessCode ?? "—"}</code></td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.memberCount}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.memoCount}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUsd(r.apiCostUsd)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.startDate)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.endDate)}</td>
                    </tr>

                    {isGroup && isExpanded && (
                      <tr>
                        <td colSpan={12} style={{ padding: 0, background: "var(--mm-bg-alt, #f5f5f5)" }}>
                          {membersState === "loading" ? (
                            <div style={{ padding: "0.6rem 2rem", color: "var(--mm-text-muted)", fontSize: "0.875rem" }}>
                              Carregando membros…
                            </div>
                          ) : membersState && typeof membersState === "object" && "error" in membersState ? (
                            <div style={{ padding: "0.6rem 2rem", color: "var(--mm-danger, #c0392b)", fontSize: "0.875rem" }}>
                              {membersState.error}
                            </div>
                          ) : Array.isArray(membersState) ? (
                            <div style={{ padding: "0.5rem 2rem 0.75rem" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                                <thead>
                                  <tr style={{ borderBottom: "1px solid var(--mm-border, #e2e2e2)" }}>
                                    <th style={{ textAlign: "left", padding: "0.3rem 0.5rem", fontWeight: 600 }}>Membro</th>
                                    <th style={{ textAlign: "left", padding: "0.3rem 0.5rem", fontWeight: 600 }}>Email</th>
                                    <th style={{ whiteSpace: "nowrap", padding: "0.3rem 0.5rem", fontWeight: 600 }}>Entrou em</th>
                                    <th style={{ textAlign: "right", padding: "0.3rem 0.5rem", fontWeight: 600 }}>Memos</th>
                                    <th style={{ textAlign: "right", whiteSpace: "nowrap", padding: "0.3rem 0.5rem", fontWeight: 600 }}>Custo IA</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {membersState.length === 0 ? (
                                    <tr>
                                      <td colSpan={5} style={{ padding: "0.5rem", color: "var(--mm-text-muted)" }}>
                                        Nenhum membro neste grupo.
                                      </td>
                                    </tr>
                                  ) : membersState.map((m) => (
                                    <tr key={m.userId} style={{ borderBottom: "1px solid var(--mm-border, #e2e2e2)" }}>
                                      <td style={{ padding: "0.3rem 0.5rem" }}>{m.userName ?? `userId ${m.userId}`}</td>
                                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--mm-text-muted)" }}>{m.userEmail ?? "—"}</td>
                                      <td style={{ whiteSpace: "nowrap", padding: "0.3rem 0.5rem" }}>{fmtDate(m.joinedAt)}</td>
                                      <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", fontVariantNumeric: "tabular-nums" }}>{m.memoCount}</td>
                                      <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", fontVariantNumeric: "tabular-nums" }}>{fmtUsd(m.apiCostUsd)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && displayed.length > 0 ? (
          <p className="mm-muted" style={{ marginTop: "0.5rem", fontSize: "0.83rem" }}>
            {displayed.length} assinatura(s) exibida(s){q ? " (filtradas)" : ""}.
            Linhas de grupo são clicáveis para expandir membros.
            Custo IA = soma acumulada de <code>api_usage_logs</code> no contexto desta assinatura (sem filtro de período).
          </p>
        ) : null}
      </main>
    </div>
  );
}
