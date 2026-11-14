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
import { IconArrowLeft, IconChat, IconPlus, IconSearch, IconUser } from "../components/icons";
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
  return <IconChat size={17} />;
}

function IconBuscar() {
  return <IconSearch size={17} />;
}

function IconCatalogar() {
  return <IconPlus size={17} />;
}

/** Duas letras para o ícone do espaço: iniciais de duas palavras ou as duas primeiras letras. */
function iniciaisDoNome(nome: string): string {
  const partes = nome.trim().split(/[\s_-]+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return (partes[0] ?? "?").slice(0, 2).toUpperCase();
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

  /** Aviso rápido depois de gravar pela nova revisão ("Memo salvo em Agenda (100%)"); some sozinho. */
  const [avisoSalvo, setAvisoSalvo] = useState<string | null>(null);
  useEffect(() => {
    const st = location.state as { memoSavedAt?: number; memoAviso?: string } | undefined;
    if (st?.memoSavedAt) {
      setRefreshKey((k) => k + 1);
      if (st.memoAviso) setAvisoSalvo(st.memoAviso);
      navigate(".", { replace: true, state: {} });
    }
  }, [location.state, navigate]);
  useEffect(() => {
    if (!avisoSalvo) return;
    const t = window.setTimeout(() => setAvisoSalvo(null), 3500);
    return () => window.clearTimeout(t);
  }, [avisoSalvo]);

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
            <IconArrowLeft size={16} /> Voltar
          </button>
          <h1 className={styles.pickerTitle}>Escolha um espaço de memos</h1>
          <p className={styles.pickerSub}>Cada espaço tem seus próprios memos, perguntas e permissões.</p>
        </div>

        {workspaceErr ? (
          <p className="mm-error" role="alert">
            {workspaceErr}
          </p>
        ) : null}

        {workspaceLoading ? <p className={styles.pickerMuted}>Carregando grupos…</p> : null}

        <div className={styles.pickerGrid}>
          {workspaceGroups.map((g, idx) => {
            const active = workspaceGroupId === g.id;
            const descTrim = g.description?.trim() ?? "";
            return (
              <article
                key={g.id}
                className={`${styles.pickerCard} ${active ? styles.pickerCardActive : ""}`}
                aria-current={active ? "true" : undefined}
              >
                <div className={styles.pickerCardHead}>
                  <span className={`${styles.pickerAvatar} ${styles[`pickerAvatar${idx % 4}`]}`} aria-hidden>
                    {iniciaisDoNome(g.name)}
                  </span>
                  <div className={styles.pickerCardInfo}>
                    <h2 className={styles.pickerCardTitle}>{g.name}</h2>
                    <p className={styles.pickerCardDesc}>
                      {descTrim || `Ref. #${g.id}`}
                    </p>
                    {!g.isOwner && g.subscriptionOwnerEmail ? (
                      <p className={styles.pickerOwnerHint}>Dono: {g.subscriptionOwnerEmail}</p>
                    ) : null}
                  </div>
                  {active ? <span className={styles.pickerAtual}>Atual</span> : null}
                </div>
                <div className={styles.pickerCardActions}>
                  <span className={styles.pickerRole}>{g.isOwner ? "Dono" : "Membro"}</span>
                  {g.isOwner ? (
                    <Link
                      to={`/grupo/${g.id}/painel`}
                      className={styles.pickerAdminLink}
                      onClick={() => setWorkspacePicker(false)}
                    >
                      Administrar
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className={`mm-btn mm-btn--primary ${styles.pickerCardBtn}`}
                    disabled={workspaceSaving}
                    onClick={() => void selectWorkspace(g.id)}
                  >
                    Abrir
                  </button>
                </div>
              </article>
            );
          })}

          <article
            className={`${styles.pickerCard} ${personalActive ? styles.pickerCardActive : ""}`}
            aria-current={personalActive ? "true" : undefined}
          >
            <div className={styles.pickerCardHead}>
              <span className={`${styles.pickerAvatar} ${styles.pickerAvatarPessoal}`} aria-hidden>
                <IconUser size={18} />
              </span>
              <div className={styles.pickerCardInfo}>
                <h2 className={styles.pickerCardTitle}>Meus memos pessoais</h2>
                <p className={styles.pickerCardDesc}>Só você vê</p>
              </div>
              {personalActive ? <span className={styles.pickerAtual}>Atual</span> : null}
            </div>
            <div className={styles.pickerCardActions}>
              <button
                type="button"
                className={`mm-btn mm-btn--primary ${styles.pickerCardBtn}`}
                disabled={workspaceSaving}
                onClick={() => void selectWorkspace(null)}
              >
                Abrir
              </button>
            </div>
          </article>

          <div className={styles.pickerNovo}>
            <Link to="/grupo/novo" className={styles.pickerNovoLink}>
              <IconPlus size={16} /> Criar novo grupo
            </Link>
            <Link to="/grupo/entrar" className={styles.pickerNovoSub}>
              ou entrar com um código de convite
            </Link>
          </div>
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

  const tabBar = (
    <div className={styles.tabBar} role="tablist" aria-label="Seções">
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
        className={`${styles.tab} ${tab === "registrar" ? styles.tabActive : ""}`}
        onClick={() => handleTabChange("registrar")}
        aria-selected={tab === "registrar"}
        role="tab"
        title="Catalogar novo memo"
      >
        <IconCatalogar />
        Catalogar
      </button>
    </div>
  );

  return (
    <div className={styles.shell}>
      <Header
        meRefreshKey={meRefreshKey}
        onOpenWorkspacePicker={() => setWorkspacePicker(true)}
        onMenuAction={(a) => {
          if (a === "ajuda") window.alert("Ajuda — conteúdo definido na parte 1 / admin.");
        }}
        center={workspacePicker ? undefined : tabBar}
      />
      {workspacePicker ? (
        renderWorkspacePicker()
      ) : (
        <main className={styles.main}>
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
      {avisoSalvo ? (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            zIndex: 60,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            background: "#10201e",
            color: "#fff",
            borderRadius: 12,
            padding: "11px 18px 11px 12px",
            boxShadow: "0 12px 30px rgba(16,32,30,.25)",
            fontWeight: 700,
            fontSize: 14,
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          <span
            aria-hidden
            style={{ width: 24, height: 24, borderRadius: "50%", background: "#15803d", display: "grid", placeItems: "center", flex: "none" }}
          >
            ✓
          </span>
          {avisoSalvo}
        </div>
      ) : null}
    </div>
  );
}
