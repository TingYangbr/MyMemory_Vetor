import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { MeResponse, WorkspaceGroupsResponse } from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPostJson } from "../api";
import styles from "./Header.module.css";

type Props = {
  onMenuAction?: (action: "ajuda") => void;
  /** Incrementar quando o perfil mudar noutro sítio (ex.: PATCH workspace na home). */
  meRefreshKey?: number;
  /** Abre o modal de contexto (só na home, por enquanto). */
  onOpenWorkspacePicker?: () => void;
  /** Admin — edição de `media_settings`: exibe plano ativo no cabeçalho. */
  adminMediaPlan?: { planId: number; planName: string } | null;
};

export default function Header({
  onMenuAction,
  meRefreshKey = 0,
  onOpenWorkspacePicker,
  adminMediaPlan = null,
}: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const showInicioLink = pathname !== "/";
  const [me, setMe] = useState<MeResponse | null>(null);
  const [ownerPanelGroupId, setOwnerPanelGroupId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const { versionLabel, versionTitle } = useMemo(() => {
    const iso = typeof __APP_BUILD_ISO__ === "string" ? __APP_BUILD_ISO__.trim() : "";
    const sha = typeof __GIT_COMMIT_SHORT__ === "string" ? __GIT_COMMIT_SHORT__.trim() : "";
    const d = iso ? new Date(iso) : null;
    const ok = d && !Number.isNaN(d.getTime());
    const when = ok
      ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
      : iso || "dev";
    const line = sha ? `${when} · ${sha}` : when;
    const title = [iso && ok ? `Build: ${iso}` : null, sha ? `Commit: ${sha}` : null].filter(Boolean).join(" · ") || line;
    return { versionLabel: line, versionTitle: title };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiGetOptional<MeResponse>("/api/me");
        if (cancelled) return;
        if (r.ok) {
          setMe(r.data);
          setErr(null);
          return;
        }
        setMe(null);
        if (r.status === 401) {
          setErr(null);
          return;
        }
        let msg = `Não foi possível carregar o perfil (HTTP ${r.status}).`;
        if (r.bodyText) {
          try {
            const j = JSON.parse(r.bodyText) as { message?: string };
            if (j.message) msg = j.message;
          } catch {
            /* manter msg genérica */
          }
        }
        setErr(msg);
      } catch {
        if (!cancelled) {
          setMe(null);
          setErr("Não foi possível conectar à API. Confirme se o servidor está em execução.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    if (!me || me.lastWorkspaceGroupId == null) {
      setOwnerPanelGroupId(null);
      return;
    }
    void apiGet<WorkspaceGroupsResponse>("/api/me/workspace-groups")
      .then((data) => {
        if (cancelled) return;
        const current = data.groups.find((g) => g.id === me.lastWorkspaceGroupId);
        setOwnerPanelGroupId(current?.isOwner ? current.id : null);
      })
      .catch(() => {
        if (!cancelled) setOwnerPanelGroupId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [me]);

  async function logout() {
    setMenuOpen(false);
    try {
      await apiPostJson("/api/auth/logout", {});
    } catch {
      /* cookie pode já estar ausente */
    }
    setMe(null);
    navigate("/login");
  }

  return (
    <header className={styles.header}>
      <div className={styles.row1}>
        <div className={styles.row1Left}>
          <Link to="/" className={styles.brand} aria-label="myMemory — início">
            <span className={styles.logo}>
              <img
                className={styles.logoImg}
                src="/mymemory-logo.png"
                width={512}
                height={512}
                alt=""
                decoding="async"
              />
            </span>
            <div className={styles.title}>myMemory</div>
          </Link>
        </div>
        <div className={styles.row1Right}>
          <div className={styles.user}>
            {err ? (
              <span className="mm-error">{err}</span>
            ) : me ? (
              <>
                {me.email ?? me.name ?? `Usuário #${me.id}`}
                {me.emailVerified === false ? (
                  <span className={styles.verifyHint} title="Confirme o e-mail para usar todos os recursos">
                    {" "}
                    (e-mail pendente)
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.row2}>
        <div className={styles.row2Left}>
          <div className={styles.version} title={versionTitle}>
            {versionLabel}
          </div>
        </div>
        <div className={styles.row2Right}>
          {showInicioLink ? (
            <Link to="/" className={styles.inicioLink}>
              ← Início
            </Link>
          ) : null}
          {adminMediaPlan ? (
            <div
              className={styles.workspaceChipStatic}
              role="note"
              title={`Plano de assinatura em edição (planId ${adminMediaPlan.planId}): ${adminMediaPlan.planName}`}
            >
              <span className={styles.workspaceChipIcon} aria-hidden>
                📋
              </span>
              <span className={styles.workspaceChipLabel}>{adminMediaPlan.planName}</span>
            </div>
          ) : null}
          {me ? (
            onOpenWorkspacePicker ? (
              <button
                type="button"
                className={styles.workspaceChip}
                aria-haspopup="dialog"
                aria-label={`Contexto de trabalho: ${me.groupLabel ?? "Pessoal"}. Clique para alterar.`}
                onClick={() => {
                  setMenuOpen(false);
                  onOpenWorkspacePicker();
                }}
              >
                <span className={styles.workspaceChipIcon} aria-hidden>
                  {me.lastWorkspaceGroupId == null ? "👤" : "👥"}
                </span>
                <span className={styles.workspaceChipLabel}>{me.groupLabel ?? "Pessoal"}</span>
                <span className={styles.workspaceChipChevron} aria-hidden>
                  ▾
                </span>
              </button>
            ) : (
              <div
                className={styles.workspaceChipStatic}
                role="status"
                title={`Contexto de trabalho: ${me.groupLabel ?? "Pessoal"}. Para alterar, vá à página inicial (Início) e use o seletor de grupo.`}
              >
                <span className={styles.workspaceChipIcon} aria-hidden>
                  {me.lastWorkspaceGroupId == null ? "👤" : "👥"}
                </span>
                <span className={styles.workspaceChipLabel}>{me.groupLabel ?? "Pessoal"}</span>
              </div>
            )
          ) : null}
          <div className={styles.menuWrap}>
            <button
              type="button"
              className={styles.hamburger}
              aria-expanded={menuOpen}
              aria-label="Menu"
              onClick={() => setMenuOpen((o) => !o)}
            >
              ☰
            </button>
            {menuOpen ? (
              <ul className={styles.dropdown} role="menu">
                {me?.role === "admin" ? (
                  <>
                    <li>
                      <Link
                        to="/admin"
                        role="menuitem"
                        className={styles.dropdownLink}
                        onClick={() => setMenuOpen(false)}
                      >
                        <span aria-hidden>⚙</span> Painel admin
                      </Link>
                    </li>
                    <li>
                      <Link
                        to="/admin/midia"
                        role="menuitem"
                        className={styles.dropdownLink}
                        onClick={() => setMenuOpen(false)}
                      >
                        <span aria-hidden>📁</span> Mídia por plano
                      </Link>
                    </li>
                    <li>
                      <Link
                        to="/admin/documento-ia"
                        role="menuitem"
                        className={styles.dropdownLink}
                        onClick={() => setMenuOpen(false)}
                      >
                        <span aria-hidden>📄</span> Documento IA (roteamento)
                      </Link>
                    </li>
                    <li>
                      <Link
                        to="/admin/llm-prompt"
                        role="menuitem"
                        className={styles.dropdownLink}
                        onClick={() => setMenuOpen(false)}
                      >
                        <span aria-hidden>🧠</span> Último prompt LLM
                      </Link>
                    </li>
                  </>
                ) : null}
                {ownerPanelGroupId != null ? (
                  <li>
                    <Link
                      to={`/grupo/${ownerPanelGroupId}/painel`}
                      role="menuitem"
                      className={styles.dropdownLink}
                      onClick={() => setMenuOpen(false)}
                    >
                      <span aria-hidden>👥</span> Painel do owner
                    </Link>
                  </li>
                ) : null}
                {me?.memoContextAccess ? (
                  <li>
                    <Link
                      to="/estrutura-memo"
                      role="menuitem"
                      className={styles.dropdownLink}
                      onClick={() => setMenuOpen(false)}
                    >
                      <span aria-hidden>📐</span> Estrutura contextual
                    </Link>
                  </li>
                ) : null}
                {me ? (
                  <li>
                    <Link
                      to="/conta/preferencias"
                      role="menuitem"
                      className={styles.dropdownLink}
                      onClick={() => setMenuOpen(false)}
                    >
                      <span aria-hidden>📋</span> Minha conta
                    </Link>
                  </li>
                ) : null}
                {me ? (
                  <li>
                    <Link
                      to="/grupo/novo"
                      role="menuitem"
                      className={styles.dropdownLink}
                      onClick={() => setMenuOpen(false)}
                    >
                      <span aria-hidden>➕</span> Criar novo grupo
                    </Link>
                  </li>
                ) : null}
                {me && onOpenWorkspacePicker ? (
                  <li>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenWorkspacePicker();
                      }}
                    >
                      <span aria-hidden>👥</span> Grupo: {me.groupLabel ?? "Pessoal"}
                    </button>
                  </li>
                ) : null}
                <li>
                  <button type="button" role="menuitem" onClick={() => onMenuAction?.("ajuda")}>
                    <span aria-hidden>❓</span> Ajuda
                  </button>
                </li>
              </ul>
            ) : null}
          </div>
          {me ? (
            <button type="button" className={styles.logoutBtn} onClick={() => void logout()}>
              Sair
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
