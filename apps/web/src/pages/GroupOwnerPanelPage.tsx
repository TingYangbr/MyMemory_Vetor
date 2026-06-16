import { Fragment, FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  CreateGroupInviteResponse,
  DbConnection,
  DbConnectionTestResult,
  GroupOwnerPanelResponse,
  MemoContextCategory,
  MemoContextGroupOption,
  MemoContextStructureResponse,
  MemosListaResponse,
  MeResponse,
  PatchGroupOwnerSettingsResponse,
} from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiPatchJson, apiPostJson, apiPutJson } from "../api";
import Header from "../components/Header";
import styles from "./GroupOwnerPanelPage.module.css";

type OwnerTab = "settings" | "invites" | "context" | "consulta" | "conexoes_bd";

const STATUS_LABELS: Record<string, string> = {
  pending: "pendente",
  accepted: "aceito",
  rejected: "recusado",
  expired: "expirado",
};

const ROLE_LABELS: Record<string, string> = {
  editor: "Editor",
  viewer: "viewer",
  owner: "Owner",
};

const MEDIA_TYPE_PT: Record<string, string> = {
  text: "Texto", audio: "Áudio", image: "Imagem",
  video: "Vídeo", document: "Doc.", url: "URL",
};

function IconPrint() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      />
    </svg>
  );
}

function fmtConsultaCell(key: string, value: unknown): string {
  if (value == null) return "—";
  const s = String(value);
  if (key === "data_registro") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  if (key === "mediaType") return MEDIA_TYPE_PT[s] ?? s;
  if (key === "mediaText") return s.length > 150 ? `${s.slice(0, 150)}…` : s;
  return s || "—";
}

export default function GroupOwnerPanelPage() {
  const { groupId: groupIdStr } = useParams<{ groupId: string }>();
  const tabListId = useId();
  const groupId = useMemo(() => {
    const n = Number(groupIdStr);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [groupIdStr]);

  const [activeTab, setActiveTab] = useState<OwnerTab>("settings");
  const [panel, setPanel] = useState<GroupOwnerPanelResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // breadcrumb
  const [me, setMe] = useState<MeResponse | null>(null);
  const [ownedGroups, setOwnedGroups] = useState<MemoContextGroupOption[]>([]);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsOk, setSettingsOk] = useState<string | null>(null);

  // ── Aba Consulta ─────────────────────────────────────────────────────────
  const [consultaCatGroupId, setConsultaCatGroupId] = useState<number | null>(null);
  const [consultaFiltroGroupId, setConsultaFiltroGroupId] = useState<number | null>(null);
  const [consultaCategorias, setConsultaCategorias] = useState<MemoContextCategory[]>([]);
  const [consultaCatNome, setConsultaCatNome] = useState<string>("");
  const [consultaDataInicio, setConsultaDataInicio] = useState<string>("");
  const [consultaDataFim, setConsultaDataFim] = useState<string>("");
  const [pendingCampoFiltros, setPendingCampoFiltros] = useState<Record<string, string>>({});
  const [consultaSortKey, setConsultaSortKey] = useState<string>("data_registro");
  const [consultaSortDir, setConsultaSortDir] = useState<"asc" | "desc">("desc");
  const [consultaOffset, setConsultaOffset] = useState<number>(0);
  const [consultaResult, setConsultaResult] = useState<MemosListaResponse | null>(null);
  const [consultaLoading, setConsultaLoading] = useState<boolean>(false);
  const [consultaErr, setConsultaErr] = useState<string | null>(null);

  // ── Aba Conexões BD ─────────────────────────────────────────────────────
  const emptyDbConn = (): Partial<DbConnection> & { password: string } => ({
    nome: "", descricao: null, host: "", port: 1433, database: "",
    username: "", password: "", encrypt: 0, trustServerCertificate: 1,
  });
  const [dbConns, setDbConns] = useState<DbConnection[]>([]);
  const [dbConnsLoading, setDbConnsLoading] = useState(false);
  const [dbConnsErr, setDbConnsErr] = useState<string | null>(null);
  const [dbConnForm, setDbConnForm] = useState<Partial<DbConnection> & { password: string }>(emptyDbConn());
  const [dbConnEditing, setDbConnEditing] = useState<number | null>(null);
  const [dbConnSaving, setDbConnSaving] = useState(false);
  const [dbConnSaveOk, setDbConnSaveOk] = useState(false);
  const [dbConnTestResults, setDbConnTestResults] = useState<Record<number, DbConnectionTestResult>>({});
  const [dbConnTesting, setDbConnTesting] = useState<Set<number>>(new Set());

  // ── Load panel + me + owned groups on mount ───────────────────────────────
  useEffect(() => {
    if (groupId == null) {
      setLoadError("Grupo inválido.");
      setPanel(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadError(null);
      try {
        const data = await apiGet<GroupOwnerPanelResponse>(`/api/groups/${groupId}/owner-panel`);
        if (!cancelled) setPanel(data);
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        if (!cancelled) {
          try {
            const j = JSON.parse(raw) as { message?: string };
            setLoadError(j.message ?? raw);
          } catch {
            setLoadError(raw || "Não foi possível carregar o painel.");
          }
          setPanel(null);
        }
      }
    })();

    // user info and owned groups (non-blocking)
    apiGet<MeResponse>("/api/me")
      .then((r) => { if (!cancelled) setMe(r); })
      .catch(() => {});
    apiGet<{ groups: MemoContextGroupOption[] }>("/api/memo-context/groups")
      .then((r) => { if (!cancelled) setOwnedGroups(r.groups); })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [groupId]);

  // ── Load DB connections when tab is active ───────────────────────────────
  const loadDbConns = useCallback(() => {
    if (!groupId) return;
    setDbConnsLoading(true);
    setDbConnsErr(null);
    apiGet<{ connections: DbConnection[] }>(`/api/groups/${groupId}/db-connections`)
      .then((r) => setDbConns(r.connections))
      .catch((e) => setDbConnsErr(e instanceof Error ? e.message : "Falha ao carregar conexões."))
      .finally(() => setDbConnsLoading(false));
  }, [groupId]);

  useEffect(() => {
    if (activeTab === "conexoes_bd") void loadDbConns();
  }, [activeTab, loadDbConns]);

  function cancelEditDbConn() {
    setDbConnEditing(null);
    setDbConnForm(emptyDbConn());
    setDbConnSaveOk(false);
  }

  async function saveDbConn() {
    if (!groupId) return;
    setDbConnSaving(true);
    setDbConnsErr(null);
    setDbConnSaveOk(false);
    try {
      if (dbConnEditing == null) {
        await apiPostJson<{ id: number }>(`/api/groups/${groupId}/db-connections`, {
          nome: dbConnForm.nome ?? "",
          descricao: dbConnForm.descricao ?? null,
          host: dbConnForm.host ?? "",
          port: dbConnForm.port ?? 1433,
          database: dbConnForm.database ?? "",
          username: dbConnForm.username ?? "",
          password: dbConnForm.password,
          encrypt: dbConnForm.encrypt ?? 0,
          trustServerCertificate: dbConnForm.trustServerCertificate ?? 1,
        });
      } else {
        await apiPutJson(`/api/groups/${groupId}/db-connections/${dbConnEditing}`, {
          nome: dbConnForm.nome,
          descricao: dbConnForm.descricao ?? null,
          host: dbConnForm.host,
          port: dbConnForm.port,
          database: dbConnForm.database,
          username: dbConnForm.username,
          ...(dbConnForm.password ? { password: dbConnForm.password } : {}),
          encrypt: dbConnForm.encrypt ?? 0,
          trustServerCertificate: dbConnForm.trustServerCertificate ?? 1,
        });
      }
      setDbConnSaveOk(true);
      setDbConnEditing(null);
      setDbConnForm(emptyDbConn());
      loadDbConns();
    } catch (e) {
      setDbConnsErr(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setDbConnSaving(false);
    }
  }

  async function deleteDbConn(id: number, nome: string) {
    if (!groupId) return;
    if (!window.confirm(`Desativar a conexão "${nome}"?`)) return;
    try {
      await apiDeleteJson<{ ok: boolean }>(`/api/groups/${groupId}/db-connections/${id}`);
      loadDbConns();
    } catch (e) {
      setDbConnsErr(e instanceof Error ? e.message : "Erro ao desativar.");
    }
  }

  async function testDbConn(id: number) {
    if (!groupId) return;
    setDbConnTesting((prev) => new Set([...prev, id]));
    setDbConnTestResults((prev) => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const result = await apiPostJson<DbConnectionTestResult>(`/api/groups/${groupId}/db-connections/${id}/test`, {});
      setDbConnTestResults((prev) => ({ ...prev, [id]: result }));
    } catch (e) {
      setDbConnTestResults((prev) => ({ ...prev, [id]: { ok: false, message: e instanceof Error ? e.message : "Erro" } }));
    } finally {
      setDbConnTesting((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }

  // ── Load categories when consulta tab or cat-group changes ────────────────
  useEffect(() => {
    if (activeTab !== "consulta") return;
    const qs = consultaCatGroupId != null ? `?groupId=${consultaCatGroupId}` : "";
    apiGet<MemoContextStructureResponse>(`/api/memo-context/structure${qs}`)
      .then((s) => {
        setConsultaCategorias(s.categories.filter((c) => c.isActive === 1));
        setConsultaCatNome("");
        setConsultaResult(null);
        setPendingCampoFiltros({});
      })
      .catch(() => setConsultaCategorias([]));
  }, [activeTab, consultaCatGroupId]);

  const handleConsultar = useCallback((opts?: { offset?: number; sortKey?: string; sortDir?: "asc" | "desc" }) => {
    if (consultaFiltroGroupId == null) return;
    const newOffset = opts?.offset ?? 0;
    const newSortKey = opts?.sortKey ?? consultaSortKey;
    const newSortDir = opts?.sortDir ?? consultaSortDir;
    setConsultaLoading(true);
    setConsultaErr(null);
    return apiPostJson<MemosListaResponse>("/api/memo-context/memos-lista", {
      categoryName: consultaCatNome || "",
      contextGroupId: consultaCatGroupId,
      workspaceGroupId: consultaFiltroGroupId,
      dataInicio: consultaDataInicio || null,
      dataFim: consultaDataFim || null,
      campoFiltros: pendingCampoFiltros,
      sortKey: newSortKey,
      sortDir: newSortDir,
      limit: 50,
      offset: newOffset,
    })
      .then((r) => {
        setConsultaResult(r);
        setConsultaOffset(newOffset);
        setConsultaSortKey(newSortKey);
        setConsultaSortDir(newSortDir);
      })
      .catch((e) => {
        const raw = e instanceof Error ? e.message : String(e);
        try {
          const j = JSON.parse(raw) as { message?: string };
          setConsultaErr(j.message ?? raw);
        } catch {
          setConsultaErr(raw || "Erro ao consultar.");
        }
      })
      .finally(() => setConsultaLoading(false));
  }, [consultaCatNome, consultaCatGroupId, consultaFiltroGroupId, consultaDataInicio, consultaDataFim, pendingCampoFiltros, consultaSortKey, consultaSortDir]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (groupId == null) return;
    setFormError(null);
    setFormOk(null);
    setBusy(true);
    try {
      const res = await apiPostJson<CreateGroupInviteResponse>(`/api/groups/${groupId}/invites`, {
        email: email.trim(),
        role,
      });
      if (res.emailSendFailed) {
        setFormOk(res.message ?? "Convite registrado; verifique o envio do e-mail.");
      } else {
        setFormOk("Convite enviado. O destinatário receberá um e-mail com o link para entrar no grupo.");
      }
      setEmail("");
      const data = await apiGet<GroupOwnerPanelResponse>(`/api/groups/${groupId}/owner-panel`);
      setPanel(data);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      try {
        const j = JSON.parse(raw) as { message?: string };
        setFormError(j.message ?? raw);
      } catch {
        setFormError(raw || "Não foi possível enviar o convite.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSaveSettings() {
    if (groupId == null || !panel) return;
    setSettingsBusy(true);
    setSettingsError(null);
    setSettingsOk(null);
    try {
      const res = await apiPatchJson<PatchGroupOwnerSettingsResponse>(
        `/api/groups/${groupId}/owner-settings`,
        {
          allowFreeSpecificFieldsWithoutCategoryMatch:
            panel.group.allowFreeSpecificFieldsWithoutCategoryMatch,
        }
      );
      setPanel((cur) => cur ? { ...cur, group: res.group } : cur);
      setSettingsOk("Configurações do grupo guardadas.");
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      try {
        const j = JSON.parse(raw) as { message?: string };
        setSettingsError(j.message ?? raw);
      } catch {
        setSettingsError(raw || "Não foi possível salvar as configurações do grupo.");
      }
    } finally {
      setSettingsBusy(false);
    }
  }

  const ownerLabel = me?.name ?? me?.email ?? null;

  if (groupId == null) {
    return (
      <>
        <Header />
        <div className={styles.shell}>
          <p className={styles.error} role="alert">
            {loadError ?? "Grupo inválido."}
          </p>
          <Link to="/" className={styles.back}>← Início</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className={styles.shell}>

        {/* ── Top navigation bar ── */}
        <div className={styles.topBar}>
          <Link to="/" className={styles.back}>← Início</Link>
          {ownedGroups.length > 0 && (
            <span className={styles.groupsNav}>
              {ownerLabel ? `Grupos de ${ownerLabel}: ` : "Meus grupos: "}
              {ownedGroups.map((g, i) => (
                <Fragment key={g.id}>
                  {i > 0 && <span className={styles.groupsSep}> · </span>}
                  <Link
                    to={`/groups/${g.id}/owner-panel`}
                    className={g.id === groupId ? styles.groupNavActive : styles.groupNavLink}
                  >
                    {g.name}
                  </Link>
                </Fragment>
              ))}
            </span>
          )}
        </div>

        <h1 className={styles.pageTitle}>
          {panel ? panel.group.name : (loadError ? `Grupo #${groupId}` : "Carregando…")}
        </h1>

        {loadError ? (
          <p className={styles.error} role="alert">{loadError}</p>
        ) : null}

        {panel ? (
          <>
            <div className={styles.tabs} role="tablist" aria-label="Seções do painel" id={tabListId}>
              <button
                type="button" role="tab"
                id={`${tabListId}-tab-settings`}
                aria-selected={activeTab === "settings"}
                aria-controls={`${tabListId}-panel-settings`}
                className={`${styles.tab} ${activeTab === "settings" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("settings")}
              >
                Configurações avulsas
              </button>
              <button
                type="button" role="tab"
                id={`${tabListId}-tab-invites`}
                aria-selected={activeTab === "invites"}
                aria-controls={`${tabListId}-panel-invites`}
                className={`${styles.tab} ${activeTab === "invites" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("invites")}
              >
                Convites
              </button>
              <button
                type="button" role="tab"
                id={`${tabListId}-tab-context`}
                aria-selected={activeTab === "context"}
                aria-controls={`${tabListId}-panel-context`}
                className={`${styles.tab} ${activeTab === "context" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("context")}
              >
                Estrutura do contexto
              </button>
              <button
                type="button" role="tab"
                id={`${tabListId}-tab-consulta`}
                aria-selected={activeTab === "consulta"}
                aria-controls={`${tabListId}-panel-consulta`}
                className={`${styles.tab} ${activeTab === "consulta" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("consulta")}
              >
                Consulta de Memos
              </button>
              <button
                type="button" role="tab"
                id={`${tabListId}-tab-conexoes_bd`}
                aria-selected={activeTab === "conexoes_bd"}
                aria-controls={`${tabListId}-panel-conexoes_bd`}
                className={`${styles.tab} ${activeTab === "conexoes_bd" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("conexoes_bd")}
              >
                Conexões BD
              </button>
            </div>

            {/* ── Settings ── */}
            {activeTab === "settings" ? (
              <section
                role="tabpanel"
                id={`${tabListId}-panel-settings`}
                aria-labelledby={`${tabListId}-tab-settings`}
                className={styles.tabPanel}
              >
                <div className={styles.card}>
                  <h2 className={styles.cardTitle}>Configurações avulsas do grupo</h2>
                  {settingsError ? <p className={styles.error} role="alert">{settingsError}</p> : null}
                  {settingsOk ? <p className={styles.success} role="status">{settingsOk}</p> : null}
                  <label className={styles.toggleRow}>
                    <input
                      type="checkbox"
                      checked={panel.group.allowFreeSpecificFieldsWithoutCategoryMatch}
                      disabled={settingsBusy}
                      onChange={(e) =>
                        setPanel((cur) =>
                          cur
                            ? { ...cur, group: { ...cur.group, allowFreeSpecificFieldsWithoutCategoryMatch: e.target.checked } }
                            : cur
                        )
                      }
                    />
                    <span className={styles.toggleLabel}>
                      Permitir dados específicos livres sem correspondência de categoria
                      <span className={styles.toggleHint}>
                        Vale para memos deste grupo. Quando ligado, o pipeline de texto pode devolver
                        <code> dados específicos </code>
                        mesmo sem match de categoria/campos no catálogo.
                      </span>
                    </span>
                  </label>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className="mm-btn mm-btn--primary"
                      disabled={settingsBusy}
                      onClick={() => void onSaveSettings()}
                    >
                      {settingsBusy ? "Salvando…" : "Salvar configurações"}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {/* ── Invites ── */}
            {activeTab === "invites" ? (
              <div
                role="tabpanel"
                id={`${tabListId}-panel-invites`}
                aria-labelledby={`${tabListId}-tab-invites`}
                className={styles.tabPanel}
              >
                <section className={styles.card} aria-labelledby="invite-form-title">
                  <h2 id="invite-form-title" className={styles.cardTitle}>Enviar convite</h2>
                  {formError ? <p className={styles.error} role="alert">{formError}</p> : null}
                  {formOk ? <p className={styles.success} role="status">{formOk}</p> : null}
                  <form onSubmit={(e) => void onSubmit(e)}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="invite-email">E-mail do convidado</label>
                      <input
                        id="invite-email"
                        className={styles.input}
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                      <p className={styles.hint}>Pode ser alguém com ou sem conta MyMemory.</p>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="invite-role">Perfil no grupo</label>
                      <select
                        id="invite-role"
                        className={styles.select}
                        value={role}
                        onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
                      >
                        <option value="editor">Editor — pode criar e editar memos</option>
                        <option value="viewer">viewer — só consulta</option>
                      </select>
                    </div>
                    <div className={styles.actions}>
                      <button type="submit" className="mm-btn mm-btn--primary" disabled={busy}>
                        {busy ? "Enviando…" : "Enviar convite"}
                      </button>
                    </div>
                  </form>
                </section>

                <div className={styles.inviteTableWrap}>
                  <h2 className={styles.inviteTableTitle}>Convites recentes</h2>
                  {panel.invites.length === 0 ? (
                    <p className={styles.sub} style={{ margin: 0 }}>
                      Ainda não há convites cadastrados para este grupo.
                    </p>
                  ) : (
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>E-mail</th>
                          <th>Perfil</th>
                          <th>Status</th>
                          <th>Expira em</th>
                        </tr>
                      </thead>
                      <tbody>
                        {panel.invites.map((inv) => (
                          <tr key={inv.id}>
                            <td>{inv.email}</td>
                            <td>{ROLE_LABELS[inv.role] ?? inv.role}</td>
                            <td>
                              <span
                                className={
                                  inv.status === "pending"
                                    ? styles.statusPending
                                    : inv.status === "accepted"
                                      ? styles.statusAccepted
                                      : styles.statusOther
                                }
                              >
                                {STATUS_LABELS[inv.status] ?? inv.status}
                              </span>
                            </td>
                            <td>{new Date(inv.expiresAt).toLocaleString("pt-BR")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ) : null}

            {/* ── Context structure ── */}
            {activeTab === "context" ? (
              <section
                role="tabpanel"
                id={`${tabListId}-panel-context`}
                aria-labelledby={`${tabListId}-tab-context`}
                className={styles.tabPanel}
              >
                <div className={styles.card}>
                  <h2 className={styles.cardTitle}>Estrutura do contexto deste grupo</h2>
                  <p className={styles.sub} style={{ marginBottom: "0.75rem" }}>
                    Esta opção abre o editor de estrutura contextual com o grupo fixo em <strong>{panel.group.name}</strong>.
                    Nesse modo você só edita este grupo — sem grupo vazio e sem grupos de outros owners.
                  </p>
                  <Link to={`/estrutura-memo?ownerGroupId=${panel.group.id}`} className="mm-btn mm-btn--primary">
                    Abrir estrutura do contexto
                  </Link>
                </div>
              </section>
            ) : null}

            {/* ── Consulta de Memos ── */}
            {activeTab === "consulta" ? (
              <section
                role="tabpanel"
                id={`${tabListId}-panel-consulta`}
                aria-labelledby={`${tabListId}-tab-consulta`}
                className={styles.tabPanel}
              >
                <div className={styles.consultaFilters}>
                  <div className={styles.consultaField}>
                    <label htmlFor="consulta-cat-group">Grupo de categorias</label>
                    <select
                      id="consulta-cat-group"
                      value={consultaCatGroupId ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setConsultaCatGroupId(v === "" ? null : Number(v));
                        setConsultaResult(null);
                        setConsultaOffset(0);
                      }}
                    >
                      <option value="">Global (sem grupo)</option>
                      {ownedGroups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.consultaField}>
                    <label htmlFor="consulta-cat">Categoria</label>
                    <select
                      id="consulta-cat"
                      value={consultaCatNome}
                      onChange={(e) => {
                        setConsultaCatNome(e.target.value);
                        setConsultaResult(null);
                        setConsultaOffset(0);
                        setPendingCampoFiltros({});
                      }}
                    >
                      <option value="">— todas —</option>
                      {consultaCategorias.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.consultaField}>
                    <label htmlFor="consulta-filtro-group">Grupo de memos *</label>
                    <select
                      id="consulta-filtro-group"
                      value={consultaFiltroGroupId ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setConsultaFiltroGroupId(v === "" ? null : Number(v));
                        setConsultaResult(null);
                        setConsultaOffset(0);
                      }}
                    >
                      <option value="">— selecione —</option>
                      {ownedGroups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.consultaField}>
                    <label htmlFor="consulta-inicio">Data início</label>
                    <input
                      id="consulta-inicio"
                      type="date"
                      value={consultaDataInicio}
                      onChange={(e) => setConsultaDataInicio(e.target.value)}
                    />
                  </div>

                  <div className={styles.consultaField}>
                    <label htmlFor="consulta-fim">Data fim</label>
                    <input
                      id="consulta-fim"
                      type="date"
                      value={consultaDataFim}
                      onChange={(e) => setConsultaDataFim(e.target.value)}
                    />
                  </div>

                  <button
                    type="button"
                    className="mm-btn mm-btn--primary"
                    disabled={consultaFiltroGroupId == null || consultaLoading}
                    onClick={() => void handleConsultar()}
                  >
                    {consultaLoading ? "A consultar…" : "Consultar"}
                  </button>
                  {consultaResult ? (
                    <button
                      type="button"
                      className={styles.printBtn}
                      title="Imprimir / salvar como PDF"
                      aria-label="Imprimir relatório da consulta"
                      onClick={() => window.print()}
                    >
                      <IconPrint />
                    </button>
                  ) : null}
                </div>

                {consultaErr ? <p className={styles.error}>{consultaErr}</p> : null}

                {consultaResult ? (
                  <>
                    <p className={styles.consultaMeta}>
                      {consultaResult.totalLinhas} registro(s).
                      {consultaResult.totalLinhas > 50
                        ? ` Exibindo ${consultaOffset + 1}–${Math.min(consultaOffset + 50, consultaResult.totalLinhas)}.`
                        : ""}
                    </p>
                    <div className={styles.consultaTableWrap}>
                      <table className={styles.consultaTable}>
                        <thead>
                          <tr>
                            {consultaResult.colunas.map((col) => (
                              <th
                                key={col.key}
                                className={styles.consultaThSort}
                                onClick={() => {
                                  const newDir =
                                    consultaSortKey === col.key && consultaSortDir === "asc" ? "desc" : "asc";
                                  void handleConsultar({ sortKey: col.key, sortDir: newDir, offset: 0 });
                                }}
                              >
                                {col.label}{" "}
                                {consultaSortKey === col.key ? (
                                  <span className={styles.sortArrow}>{consultaSortDir === "asc" ? "▲" : "▼"}</span>
                                ) : (
                                  <span className={styles.sortArrowInactive}>⇅</span>
                                )}
                              </th>
                            ))}
                          </tr>
                          <tr className={styles.consultaFilterRow}>
                            {consultaResult.colunas.map((col) => (
                              <th key={col.key}>
                                <input
                                  className={styles.consultaColFilter}
                                  value={pendingCampoFiltros[col.key] ?? ""}
                                  onChange={(e) =>
                                    setPendingCampoFiltros((prev) => ({ ...prev, [col.key]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void handleConsultar({ offset: 0 });
                                  }}
                                  placeholder="filtrar…"
                                />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {consultaResult.linhas.length === 0 ? (
                            <tr>
                              <td colSpan={consultaResult.colunas.length} className={styles.consultaEmpty}>
                                Nenhum resultado.
                              </td>
                            </tr>
                          ) : (
                            consultaResult.linhas.map((row, i) => (
                              <tr key={i} className={i % 2 === 0 ? styles.consultaRowEven : styles.consultaRowOdd}>
                                {consultaResult.colunas.map((col) => (
                                  <td key={col.key} className={styles.consultaTd}>
                                    {fmtConsultaCell(col.key, row[col.key])}
                                  </td>
                                ))}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    {consultaResult.totalLinhas > 50 ? (
                      <div className={styles.consultaPaginacao}>
                        <button
                          type="button"
                          className="mm-btn mm-btn--ghost"
                          disabled={consultaOffset === 0 || consultaLoading}
                          onClick={() => void handleConsultar({ offset: Math.max(0, consultaOffset - 50) })}
                        >
                          ← Anterior
                        </button>
                        <span className={styles.consultaMeta}>
                          {consultaOffset + 1}–{Math.min(consultaOffset + 50, consultaResult.totalLinhas)} de{" "}
                          {consultaResult.totalLinhas}
                        </span>
                        <button
                          type="button"
                          className="mm-btn mm-btn--ghost"
                          disabled={consultaOffset + 50 >= consultaResult.totalLinhas || consultaLoading}
                          onClick={() => void handleConsultar({ offset: consultaOffset + 50 })}
                        >
                          Próximo →
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : consultaLoading ? (
                  <p className={styles.loading}>A consultar…</p>
                ) : null}
              </section>
            ) : null}

            {/* ── Conexões BD ── */}
            {activeTab === "conexoes_bd" ? (
              <section
                role="tabpanel"
                id={`${tabListId}-panel-conexoes_bd`}
                aria-labelledby={`${tabListId}-tab-conexoes_bd`}
                className={styles.tabPanel}
              >
                <p style={{ marginBottom: "1rem", color: "#64748b", fontSize: "0.9rem" }}>
                  Conexões SQL Server para os query templates do seu grupo. A senha não é exibida após salvar.
                </p>

                {dbConnsErr ? <p className="mm-error" style={{ marginBottom: "1rem" }}>{dbConnsErr}</p> : null}
                {dbConnSaveOk ? <p style={{ color: "green", marginBottom: "1rem" }}>Salvo com sucesso.</p> : null}

                {/* Formulário */}
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "0.75rem", padding: "1rem", marginBottom: "1.5rem" }}>
                  <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700 }}>
                    {dbConnEditing != null ? "Editar conexão" : "Nova conexão"}
                  </h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                    {[
                      { label: "Nome *", key: "nome", placeholder: "Ex: ERP SQL Server", maxW: "" },
                      { label: "Descrição", key: "descricao", placeholder: "Opcional", maxW: "" },
                      { label: "Host *", key: "host", placeholder: "servidor.dominio.com", maxW: "" },
                    ].map(({ label, key, placeholder, maxW }) => (
                      <label key={key} style={{ display: "flex", flexDirection: "column", gap: "0.25rem", flex: "1 1 200px", maxWidth: maxW || undefined }}>
                        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{label}</span>
                        <input
                          className="mm-field"
                          value={(dbConnForm[key as keyof typeof dbConnForm] as string) ?? ""}
                          placeholder={placeholder}
                          onChange={(e) => setDbConnForm((p) => ({ ...p, [key]: e.target.value || (key === "descricao" ? null : e.target.value) }))}
                        />
                      </label>
                    ))}
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", maxWidth: "100px" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Porta</span>
                      <input className="mm-field" type="number" value={dbConnForm.port ?? 1433} onChange={(e) => setDbConnForm((p) => ({ ...p, port: Number(e.target.value) }))} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", flex: "1 1 200px" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Banco de dados *</span>
                      <input className="mm-field" value={dbConnForm.database ?? ""} placeholder="NomeDoBanco" onChange={(e) => setDbConnForm((p) => ({ ...p, database: e.target.value }))} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", flex: "1 1 160px" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Usuário *</span>
                      <input className="mm-field" value={dbConnForm.username ?? ""} placeholder="sa" onChange={(e) => setDbConnForm((p) => ({ ...p, username: e.target.value }))} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", flex: "1 1 200px" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{dbConnEditing != null ? "Senha (vazio = manter)" : "Senha *"}</span>
                      <input className="mm-field" type="password" value={dbConnForm.password} autoComplete="new-password" onChange={(e) => setDbConnForm((p) => ({ ...p, password: e.target.value }))} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
                      <input type="checkbox" checked={dbConnForm.encrypt === 1} onChange={(e) => setDbConnForm((p) => ({ ...p, encrypt: e.target.checked ? 1 : 0 }))} />
                      <span style={{ fontSize: "0.85rem" }}>Criptografar</span>
                    </label>
                    <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
                      <input type="checkbox" checked={dbConnForm.trustServerCertificate === 1} onChange={(e) => setDbConnForm((p) => ({ ...p, trustServerCertificate: e.target.checked ? 1 : 0 }))} />
                      <span style={{ fontSize: "0.85rem" }}>Confiar no certificado</span>
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                    <button
                      type="button"
                      className="mm-btn mm-btn--primary"
                      disabled={dbConnSaving || !(
                        dbConnForm.nome?.trim() &&
                        dbConnForm.host?.trim() &&
                        dbConnForm.database?.trim() &&
                        dbConnForm.username?.trim() &&
                        (dbConnEditing != null || !!dbConnForm.password)
                      )}
                      onClick={() => void saveDbConn()}
                    >
                      {dbConnSaving ? "Salvando…" : dbConnEditing != null ? "Atualizar" : "Criar"}
                    </button>
                    {dbConnEditing != null ? (
                      <button type="button" className="mm-btn mm-btn--ghost" onClick={cancelEditDbConn}>Cancelar</button>
                    ) : null}
                  </div>
                </div>

                {/* Lista */}
                {dbConnsLoading ? (
                  <p style={{ color: "#64748b" }}>Carregando…</p>
                ) : dbConns.length === 0 ? (
                  <p style={{ color: "#94a3b8" }}>Nenhuma conexão cadastrada para este grupo.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {dbConns.map((c) => {
                      const testResult = dbConnTestResults[c.id];
                      const testing = dbConnTesting.has(c.id);
                      return (
                        <div key={c.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "0.75rem", padding: "0.9rem 1rem" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                              <strong style={{ fontSize: "0.95rem" }}>{c.nome}</strong>
                              <span style={{ fontSize: "0.8rem", color: "#64748b" }}>{c.host}:{c.port} / {c.database} — {c.username}</span>
                              {c.descricao ? <span style={{ fontSize: "0.78rem", color: "#94a3b8", fontStyle: "italic" }}>{c.descricao}</span> : null}
                            </div>
                            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                              <button type="button" className="mm-btn mm-btn--ghost" disabled={testing} onClick={() => void testDbConn(c.id)}>
                                {testing ? "Testando…" : "Testar"}
                              </button>
                              <button type="button" className="mm-btn mm-btn--ghost" onClick={() => { setDbConnEditing(c.id); setDbConnForm({ ...c, password: "" }); setDbConnSaveOk(false); }}>
                                Editar
                              </button>
                              <button type="button" className="mm-btn mm-btn--ghost" style={{ color: "#dc2626" }} onClick={() => void deleteDbConn(c.id, c.nome)}>
                                Desativar
                              </button>
                            </div>
                          </div>
                          {testResult ? (
                            <div style={{ marginTop: "0.4rem", fontSize: "0.82rem", color: testResult.ok ? "green" : "#dc2626" }}>
                              {testResult.ok ? `✓ ${testResult.message}${testResult.latencyMs != null ? ` (${testResult.latencyMs}ms)` : ""}` : `✗ ${testResult.message}`}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
