import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type {
  MeResponse,
  MemoCreatedResponse,
  PatchWorkspaceResponse,
  UserMediaLimitsResponse,
  WorkspaceGroupItem,
  WorkspaceGroupsResponse,
} from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPatchJson } from "../api";
import Header from "../components/Header";
import MemoRegisterPanel from "../components/MemoRegisterPanel";
import RecentMemos from "../components/RecentMemos";
import PerguntaPage from "./PerguntaPage";
import MemoSearchPage from "./MemoSearchPage";
import styles from "./HomePage.module.css";

type HomeTab = "perguntar" | "buscar" | "registrar";
const TAB_KEY = "mm_home_tab";

function getInitialTab(params: URLSearchParams): HomeTab {
  const p = params.get("tab");
  if (p === "buscar" || p === "perguntar" || p === "registrar") return p;
  const s = localStorage.getItem(TAB_KEY);
  if (s === "buscar" || s === "perguntar" || s === "registrar") return s as HomeTab;
  return "perguntar";
}

function IconPerguntar() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="7" r="4"/>
      <path d="M3 21v-1a7 7 0 0 1 10.5-6.1"/>
      <path d="M17.5 13a2.5 2.5 0 0 1 2.5 2.5c0 1.1-.7 2.04-1.7 2.4L18 19"/>
      <circle cx="18" cy="21" r=".75" fill="currentColor" stroke="none"/>
    </svg>
  );
}

function IconBuscar() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <circle cx="10.5" cy="14.5" r="2.5"/>
      <line x1="12.5" y1="16.5" x2="15" y2="19"/>
    </svg>
  );
}

function IconCatalogar() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="currentColor"/>
      <path d="M12 16.5V7.5M8.5 11l3.5-3.5 3.5 3.5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [ready, setReady] = useState(false);
  const [gateErr, setGateErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [workspacePicker, setWorkspacePicker] = useState(false);
  const [workspaceGroups, setWorkspaceGroups] = useState<WorkspaceGroupItem[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceErr, setWorkspaceErr] = useState<string | null>(null);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [meRefreshKey, setMeRefreshKey] = useState(0);
  const [mediaLimits, setMediaLimits] = useState<UserMediaLimitsResponse | null>(null);
  const [tab, setTab] = useState<HomeTab>(() => getInitialTab(searchParams));

  function handleTabChange(t: HomeTab) {
    setTab(t);
    localStorage.setItem(TAB_KEY, t);
  }

  const workspaceGroupId = me?.lastWorkspaceGroupId ?? null;

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me")
      .then((r) => {
        if (r.ok) {
          setMe(r.data);
          setGateErr(null);
          setReady(true);
          return;
        }
        if (r.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        let msg = `Não foi possível validar a sessão (HTTP ${r.status}).`;
        if (r.bodyText) {
          try {
            const j = JSON.parse(r.bodyText) as { message?: string };
            if (j.message) msg = j.message;
          } catch {
            /* */
          }
        }
        setMe(null);
        setGateErr(msg);
        setReady(true);
      })
      .catch(() => {
        setMe(null);
        setGateErr("Não foi possível conectar à API.");
        setReady(true);
      });
  }, [navigate]);

  useEffect(() => {
    if (!me) {
      setMediaLimits(null);
      return;
    }
    const q = workspaceGroupId != null ? `?groupId=${workspaceGroupId}` : "";
    apiGet<UserMediaLimitsResponse>(`/api/me/media-limits${q}`)
      .then((data) => setMediaLimits(data))
      .catch(() => setMediaLimits(null));
  }, [me, workspaceGroupId, meRefreshKey]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (searchParams.get("escolherEspaco") === "1") {
      setWorkspacePicker(true);
      next.delete("escolherEspaco");
      changed = true;
    }
    const tabParam = searchParams.get("tab");
    if (tabParam === "buscar" || tabParam === "perguntar" || tabParam === "registrar") {
      handleTabChange(tabParam);
      next.delete("tab");
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const onRegistered = useCallback((_memo: MemoCreatedResponse) => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const st = location.state as { memoSavedAt?: number } | undefined;
    if (st?.memoSavedAt) {
      setRefreshKey((k) => k + 1);
      navigate(".", { replace: true, state: {} });
    }
  }, [location.state, navigate]);

  const loadWorkspaceGroups = useCallback(() => {
    setWorkspaceLoading(true);
    setWorkspaceErr(null);
    apiGet<WorkspaceGroupsResponse>("/api/me/workspace-groups")
      .then((r) => setWorkspaceGroups(r.groups ?? []))
      .catch(() => {
        setWorkspaceErr("Não foi possível carregar os grupos.");
        setWorkspaceGroups([]);
      })
      .finally(() => setWorkspaceLoading(false));
  }, []);

  useEffect(() => {
    if (!workspacePicker) return;
    loadWorkspaceGroups();
  }, [workspacePicker, loadWorkspaceGroups]);

  async function selectWorkspace(groupId: number | null) {
    if (!me) return;
    setWorkspaceSaving(true);
    setWorkspaceErr(null);
    try {
      const res = await apiPatchJson<PatchWorkspaceResponse>("/api/me/workspace", { groupId });
      setMe((prev) =>
        prev
          ? {
              ...prev,
              lastWorkspaceGroupId: res.lastWorkspaceGroupId,
              groupLabel: res.groupLabel,
            }
          : null
      );
      setWorkspacePicker(false);
      setRefreshKey((k) => k + 1);
      setMeRefreshKey((k) => k + 1);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      try {
        const j = JSON.parse(raw) as { message?: string };
        setWorkspaceErr(j.message ?? raw);
      } catch {
        setWorkspaceErr(raw || "Não foi possível alterar o contexto.");
      }
    } finally {
      setWorkspaceSaving(false);
    }
  }

  function renderWorkspacePicker() {
    if (!me) return null;
    const personalActive = workspaceGroupId == null;

    return (
      <main className={styles.pickerMain}>
        <div className={styles.pickerHead}>
          <button
            type="button"
            className={styles.pickerBack}
            onClick={() => setWorkspacePicker(false)}
            aria-label="Voltar"
          >
            ← Voltar
          </button>
          <h1 className={styles.pickerTitle}>Selecione Qual espaço de Memos Quer acessar?</h1>
        </div>

        {workspaceErr ? (
          <p className="mm-error" role="alert">
            {workspaceErr}
          </p>
        ) : null}

        {workspaceLoading ? <p className={styles.pickerMuted}>Carregando grupos…</p> : null}

        <div className={styles.pickerGrid}>
          <article
            className={`${styles.pickerCard} ${personalActive ? styles.pickerCardActive : ""}`}
            aria-current={personalActive ? "true" : undefined}
          >
            <div className={styles.pickerCardHead}>
              <h2 className={styles.pickerCardTitle}>
                <span className={styles.pickerCardTitleIcon} aria-hidden>
                  👤
                </span>{" "}
                Meus Memos Pessoais
              </h2>
              <p className={styles.pickerCardDesc}>Trabalhe com seus memos pessoais</p>
            </div>
            <button
              type="button"
              className={`mm-btn mm-btn--primary ${styles.pickerCardBtn}`}
              disabled={workspaceSaving}
              onClick={() => void selectWorkspace(null)}
            >
              Clique Aqui
            </button>
          </article>

          {workspaceGroups.map((g) => {
            const active = workspaceGroupId === g.id;
            const descTrim = g.description?.trim() ?? "";
            return (
              <article
                key={g.id}
                className={`${styles.pickerCard} ${active ? styles.pickerCardActive : ""}`}
                aria-current={active ? "true" : undefined}
              >
                <div className={styles.pickerCardHead}>
                  <h2 className={styles.pickerCardTitle}>
                    <span className={styles.pickerCardTitleIcon} aria-hidden>
                      👥
                    </span>{" "}
                    <span className={styles.pickerCardTitleName}>{g.name}</span>
                    {descTrim ? (
                      <span className={styles.pickerCardTitleSuffix}>
                        {" "}
                        — {descTrim}
                      </span>
                    ) : null}
                  </h2>
                  {!g.isOwner && g.subscriptionOwnerEmail ? (
                    <p className={styles.pickerOwnerHint}>Dono: {g.subscriptionOwnerEmail}</p>
                  ) : null}
                  {!descTrim ? <p className={styles.pickerIdHint}>Ref. #{g.id}</p> : null}
                </div>
                <div className={styles.pickerCardActions}>
                  <button
                    type="button"
                    className={`mm-btn mm-btn--primary ${styles.pickerCardBtn}`}
                    disabled={workspaceSaving}
                    onClick={() => void selectWorkspace(g.id)}
                  >
                    Clique Aqui
                  </button>
                  {g.isOwner ? (
                    <Link
                      to={`/grupo/${g.id}/painel`}
                      className={`mm-btn ${styles.pickerOwnerLink}`}
                      onClick={() => setWorkspacePicker(false)}
                    >
                      Painel do owner
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        <div className={styles.pickerBottomBar}>
          <Link
            to="/grupo/novo"
            className={`mm-btn mm-btn--primary ${styles.pickerCta} ${styles.pickerBottomBtn}`}
          >
            Criar novo grupo
          </Link>
          <Link
            to="/grupo/entrar"
            className={`mm-btn ${styles.pickerCtaSecondary} ${styles.pickerBottomBtn}`}
          >
            <span className={styles.pickerCtaLead} aria-hidden>
              &gt;{" "}
            </span>
            Entrar em outro Grupo
          </Link>
          <button
            type="button"
            className={`mm-btn ${styles.pickerBottomBtn} ${styles.pickerCancelBtn}`}
            disabled={workspaceSaving}
            onClick={() => setWorkspacePicker(false)}
          >
            Cancelar
          </button>
        </div>
      </main>
    );
  }

  if (!ready) {
    return (
      <div className={styles.shell}>
        <Header
          meRefreshKey={meRefreshKey}
          onOpenWorkspacePicker={() => setWorkspacePicker(true)}
          onMenuAction={(a) => {
            if (a === "ajuda") window.alert("Ajuda — conteúdo definido na parte 1 / admin.");
          }}
        />
        <main className={styles.main}>
          <p className={styles.workspaceHint}>Carregando…</p>
        </main>
      </div>
    );
  }

  if (gateErr || !me) {
    return (
      <div className={styles.shell}>
        <Header
          meRefreshKey={meRefreshKey}
          onOpenWorkspacePicker={() => setWorkspacePicker(true)}
          onMenuAction={(a) => {
            if (a === "ajuda") window.alert("Ajuda — conteúdo definido na parte 1 / admin.");
          }}
        />
        <main className={styles.main}>
          <p className="mm-error" role="alert">
            {gateErr ?? "Não foi possível abrir a aplicação. Volte ao login."}
          </p>
          <p className={styles.workspaceHint}>
            <Link to="/login">Ir para o login</Link>
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <Header
        meRefreshKey={meRefreshKey}
        onOpenWorkspacePicker={() => setWorkspacePicker(true)}
        onMenuAction={(a) => {
          if (a === "ajuda") window.alert("Ajuda — conteúdo definido na parte 1 / admin.");
        }}
      />
      {workspacePicker ? (
        renderWorkspacePicker()
      ) : (
        <main className={styles.main}>
          <div className={styles.tabBar}>
            <button
              type="button"
              className={`${styles.tab} ${tab === "perguntar" ? styles.tabActive : ""}`}
              onClick={() => handleTabChange("perguntar")}
              aria-selected={tab === "perguntar"}
              role="tab"
            >
              <IconPerguntar />
              Perguntar
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === "buscar" ? styles.tabActive : ""}`}
              onClick={() => handleTabChange("buscar")}
              aria-selected={tab === "buscar"}
              role="tab"
            >
              <IconBuscar />
              Buscar
            </button>
            <button
              type="button"
              className={`${styles.tab} ${styles.tabIcon} ${styles.tabIconCatalogar} ${tab === "registrar" ? styles.tabActive : ""}`}
              onClick={() => handleTabChange("registrar")}
              aria-selected={tab === "registrar"}
              role="tab"
              title="Catalogar novo memo"
            >
              <IconCatalogar />
              Catalogar
            </button>
          </div>

          <div style={{ display: tab === "perguntar" ? "" : "none" }}>
            <PerguntaPage embedded />
          </div>
          <div style={{ display: tab === "buscar" ? "" : "none" }}>
            <MemoSearchPage embedded />
          </div>
          <div style={{ display: tab === "registrar" ? "" : "none" }}>
            <MemoRegisterPanel
              onRegistered={onRegistered}
              workspaceGroupId={workspaceGroupId}
              mediaLimits={mediaLimits}
              memoPrefs={{
                confirmEnabled: me.confirmEnabled,
                soundEnabled: me.soundEnabled,
                iaUseTexto: me.iaUseTexto,
                iaUseImagem: me.iaUseImagem,
                iaUseVideo: me.iaUseVideo,
                iaUseAudio: me.iaUseAudio,
                iaUseDocumento: me.iaUseDocumento,
                iaUseUrl: me.iaUseUrl,
              }}
              showBuscarMemosLink={false}
            />
            <hr className={styles.divider} aria-hidden />
            <RecentMemos
              refreshKey={refreshKey}
              workspaceGroupId={workspaceGroupId}
              currentUserId={typeof me.id === "number" ? me.id : null}
              showApiCost={me.showApiCost !== false}
            />
          </div>
        </main>
      )}
    </div>
  );
}
