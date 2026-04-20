import { FormEvent, useEffect, useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  CreateGroupInviteResponse,
  GroupOwnerPanelResponse,
  PatchGroupOwnerSettingsResponse,
} from "@mymemory/shared";
import { apiGet, apiPatchJson, apiPostJson } from "../api";
import Header from "../components/Header";
import styles from "./GroupOwnerPanelPage.module.css";

type OwnerTab = "settings" | "invites" | "context";

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

        <header className={styles.panelHeader}>
          <p className={styles.panelKicker}>Painel do owner</p>
          {panel ? (
            <>
              <h1 className={styles.panelTitle}>{panel.group.name}</h1>
              {panel.group.description ? (
                <p className={styles.panelDesc}>{panel.group.description}</p>
              ) : null}
              <p className={styles.panelMeta}>
                Ref. <code>#{panel.group.id}</code> — convites e demais ações deste painel valem para{" "}
                <strong>este</strong> grupo (útil quando você gerencia vários grupos).
              </p>
            </>
          ) : (
            <>
              <h1 className={styles.panelTitle}>Grupo #{groupId}</h1>
              <p className={styles.panelMeta}>
                {!loadError ? "Carregando dados do grupo…" : "Não foi possível carregar os dados deste grupo."}
              </p>
            </>
          )}
        </header>

        {loadError ? (
          <p className={styles.error} role="alert">
            {loadError}
          </p>
        ) : null}

        {panel ? (
          <>
            <p className={styles.sub}>
              Você está a gerir o grupo <strong>{panel.group.name}</strong>. Use a barra de opções para convites,
              configurações avulsas e estrutura do contexto deste grupo.
            </p>
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
                <p className={styles.sub}>
                  Os convites abaixo são para o grupo <strong>{panel.group.name}</strong>. Quem já tem conta entra e
                  aceita o convite; quem é novo cria conta, escolhe plano individual e, após confirmar o e-mail,
                  entra no grupo.
                </p>

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
          </>
        ) : null}
      </div>
    </>
  );
}
