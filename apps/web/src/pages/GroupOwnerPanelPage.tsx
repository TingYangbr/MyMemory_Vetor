import { FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  CreateGroupInviteResponse,
  GroupOwnerPanelResponse,
  MemoContextCategory,
  MemoContextGroupOption,
  MemoContextStructureResponse,
  MemosListaResponse,
  PatchGroupOwnerSettingsResponse,
} from "@mymemory/shared";
import { apiGet, apiPatchJson, apiPostJson } from "../api";
import Header from "../components/Header";
import styles from "./GroupOwnerPanelPage.module.css";

type OwnerTab = "settings" | "invites" | "context" | "consulta";

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
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsOk, setSettingsOk] = useState<string | null>(null);

  // ── Aba Consulta ─────────────────────────────────────────────────────────
  const [consultaGroups, setConsultaGroups] = useState<MemoContextGroupOption[]>([]);
  const [consultaGroupsLoaded, setConsultaGroupsLoaded] = useState(false);
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
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const loadConsultaGroups = useCallback(() => {
    return apiGet<{ groups: MemoContextGroupOption[] }>("/api/memo-context/groups")
      .then((r) => {
        setConsultaGroups(r.groups);
        setConsultaGroupsLoaded(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === "consulta" && !consultaGroupsLoaded) {
      void loadConsultaGroups();
    }
  }, [activeTab, consultaGroupsLoaded, loadConsultaGroups]);

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
      categoryName: consultaCatNome,
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
      setPanel((cur) =>
        cur
          ? {
              ...cur,
              group: res.group,
            }
          : cur
      );
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

  if (groupId == null) {
    return (
      <>
        <Header />
        <div className={styles.shell}>
          <p className={styles.error} role="alert">
            {loadError ?? "Grupo inválido."}
          </p>
          <Link to="/" className={styles.back}>
            ← Início
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className={styles.shell}>
        <Link to="/" className={styles.back}>
          ← Início
        </Link>

        <h1 className={styles.pageTitle}>
          {panel ? panel.group.name : (loadError ? `Grupo #${groupId}` : "Carregando…")}
        </h1>

        {loadError ? (
          <p className={styles.error} role="alert">
            {loadError}
          </p>
        ) : null}

        {panel ? (
          <>
            <div className={styles.tabs} role="tablist" aria-label="Seções do painel" id={tabListId}>
              <button
                type="button"
                role="tab"
                id={`${tabListId}-tab-settings`}
                aria-selected={activeTab === "settings"}
                aria-controls={`${tabListId}-panel-settings`}
                className={`${styles.tab} ${activeTab === "settings" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("settings")}
              >
                Configurações avulsas
              </button>
              <button
                type="button"
                role="tab"
                id={`${tabListId}-tab-invites`}
                aria-selected={activeTab === "invites"}
                aria-controls={`${tabListId}-panel-invites`}
                className={`${styles.tab} ${activeTab === "invites" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("invites")}
              >
                Convites
              </button>
              <button
                type="button"
                role="tab"
                id={`${tabListId}-tab-context`}
                aria-selected={activeTab === "context"}
                aria-controls={`${tabListId}-panel-context`}
                className={`${styles.tab} ${activeTab === "context" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("context")}
              >
                Estrutura do contexto
              </button>
              <button
                type="button"
                role="tab"
                id={`${tabListId}-tab-consulta`}
                aria-selected={activeTab === "consulta"}
                aria-controls={`${tabListId}-panel-consulta`}
                className={`${styles.tab} ${activeTab === "consulta" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("consulta")}
              >
                Consulta de Memos
              </button>
            </div>

            {activeTab === "settings" ? (
              <section
                role="tabpanel"
                id={`${tabListId}-panel-settings`}
                aria-labelledby={`${tabListId}-tab-settings`}
                className={styles.tabPanel}
              >
                <div className={styles.card}>
                  <h2 className={styles.cardTitle}>Configurações avulsas do grupo</h2>
                  {settingsError ? (
                    <p className={styles.error} role="alert">
                      {settingsError}
                    </p>
                  ) : null}
                  {settingsOk ? (
                    <p className={styles.success} role="status">
                      {settingsOk}
                    </p>
                  ) : null}
                  <label className={styles.toggleRow}>
                    <input
                      type="checkbox"
                      checked={panel.group.allowFreeSpecificFieldsWithoutCategoryMatch}
                      disabled={settingsBusy}
                      onChange={(e) =>
                        setPanel((cur) =>
                          cur
                            ? {
                                ...cur,
                                group: {
                                  ...cur.group,
                                  allowFreeSpecificFieldsWithoutCategoryMatch: e.target.checked,
                                },
                              }
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

            {activeTab === "invites" ? (
              <div
                role="tabpanel"
                id={`${tabListId}-panel-invites`}
                aria-labelledby={`${tabListId}-tab-invites`}
                className={styles.tabPanel}
              >
                <section className={styles.card} aria-labelledby="invite-form-title">
                  <h2 id="invite-form-title" className={styles.cardTitle}>
                    Enviar convite
                  </h2>
                  {formError ? (
                    <p className={styles.error} role="alert">
                      {formError}
                    </p>
                  ) : null}
                  {formOk ? (
                    <p className={styles.success} role="status">
                      {formOk}
                    </p>
                  ) : null}
                  <form onSubmit={(e) => void onSubmit(e)}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="invite-email">
                        E-mail do convidado
                      </label>
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
                      <label className={styles.label} htmlFor="invite-role">
                        Perfil no grupo
                      </label>
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
                  <Link
                    to={`/estrutura-memo?ownerGroupId=${panel.group.id}`}
                    className="mm-btn mm-btn--primary"
                  >
                    Abrir estrutura do contexto
                  </Link>
                </div>
              </section>
            ) : null}

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
                      {consultaGroups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.consultaField}>
                    <label htmlFor="consulta-cat">Categoria *</label>
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
                      <option value="">— selecione —</option>
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
                      {consultaGroups.map((g) => (
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
          </>
        ) : null}
      </div>
    </>
  );
}
