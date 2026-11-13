import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { MeResponse, WorkspaceGroupsResponse } from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPostJson } from "../api";
import { useTheme } from "../hooks/useTheme";
import {
  IconAlert,
  IconArrowLeft,
  IconBell,
  IconChevronDown,
  IconCode,
  IconDoc,
  IconFolder,
  IconHelp,
  IconLayers,
  IconLogout,
  IconMoon,
  IconPlus,
  IconSettings,
  IconSun,
  IconSwap,
  IconUpload,
  IconUser,
  IconUsers,
} from "./icons";
import { SinoNotificacoes } from "./SinoNotificacoes";
import styles from "./Header.module.css";

/** Iniciais para o avatar: duas letras do nome, ou do e-mail. */
function initialsOf(me: MeResponse | null): string {
  if (!me) return "";
  const base = (me.name ?? "").trim();
  if (base) {
    const parts = base.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "";
    const b = parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "";
    return (a + b).toUpperCase();
  }
  const mail = (me.email ?? "").trim();
  return mail.slice(0, 2).toUpperCase() || "?";
}

type Props = {
  onMenuAction?: (action: "ajuda") => void;
  /** Incrementar quando o perfil mudar noutro sítio (ex.: PATCH workspace na home). */
  meRefreshKey?: number;
  /** Abre o modal de contexto (só na home, por enquanto). */
  onOpenWorkspacePicker?: () => void;
  /** Admin — edição de `media_settings`: exibe plano ativo no cabeçalho. */
  adminMediaPlan?: { planId: number; planName: string } | null;
  /** Conteúdo central do cabeçalho (abas da home). No celular vira barra fixa no rodapé. */
  center?: ReactNode;
};

export default function Header({
  onMenuAction,
  meRefreshKey = 0,
  onOpenWorkspacePicker,
  adminMediaPlan = null,
  center,
}: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const showInicioLink = pathname !== "/";
  const [me, setMe] = useState<MeResponse | null>(null);
  // Aviso de créditos de IA do mês acima do limite do plano (por enquanto não bloqueia)
  const [creditos, setCreditos] = useState<{ usados: number; limite: number | null; excedido: boolean } | null>(null);
  useEffect(() => {
    if (!me) { setCreditos(null); return; }
    let cancelado = false;
    apiGetOptional<{ usados: number; limite: number | null; excedido: boolean }>("/api/me/creditos")
      .then((r) => { if (!cancelado) setCreditos(r.ok ? r.data : null); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [me]);
  const [ownerPanelGroupId, setOwnerPanelGroupId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();

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

  // Fecha o menu ao clicar fora ou com Esc
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Com abas no rodapé (celular), o conteúdo precisa de espaço extra embaixo
  const hasCenter = center != null;
  useEffect(() => {
    if (!hasCenter) return;
    document.body.classList.add("mm-has-bottom-nav");
    return () => document.body.classList.remove("mm-has-bottom-nav");
  }, [hasCenter]);

  const isAdmin = me?.role === "admin";
  const hasAdminSection = isAdmin || ownerPanelGroupId != null || !!me?.memoContextAccess;
  const groupLabel = me?.groupLabel ?? "Pessoal";
  const isPersonal = me?.lastWorkspaceGroupId == null;
  const close = () => setMenuOpen(false);

  const workspaceIcon = isPersonal ? <IconUser size={14} /> : <IconUsers size={14} />;
  const workspaceKind = isPersonal ? "Pessoal" : "Grupo";

  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <div className={styles.left}>
          <Link to="/" className={styles.brand} aria-label="proMemory — início">
            <span className={styles.logo}>
              <img className={styles.logoImg} src="/mymemory-logo.png" width={512} height={512} alt="" decoding="async" />
            </span>
            <span className={styles.title}>
              <span className={styles.titlePro}>pro</span>
              <span className={styles.titleMemory}>Memory</span>
            </span>
          </Link>
          {showInicioLink ? (
            <Link to="/" className={styles.inicioLink} title="Voltar ao início">
              <IconArrowLeft size={14} />
              <span>Início</span>
            </Link>
          ) : null}
          {adminMediaPlan ? (
            <div
              className={styles.workspaceChipStatic}
              role="note"
              title={`Plano de assinatura em edição (planId ${adminMediaPlan.planId}): ${adminMediaPlan.planName}`}
            >
              <span className={styles.workspaceChipIcon} aria-hidden>
                <IconDoc size={14} />
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
                aria-label={`Espaço de trabalho: ${groupLabel} (${workspaceKind}). Clique para trocar.`}
                title={`${workspaceKind}: ${groupLabel}. Clique para trocar.`}
                onClick={() => {
                  close();
                  onOpenWorkspacePicker();
                }}
              >
                <span className={styles.workspaceChipIcon}>{workspaceIcon}</span>
                <span className={styles.workspaceChipLabel}>{groupLabel}</span>
                <span className={styles.workspaceChipKind}>· {workspaceKind}</span>
                <IconChevronDown size={14} className={styles.workspaceChipChevron} />
              </button>
            ) : (
              <div
                className={styles.workspaceChipStatic}
                role="status"
                title={`${workspaceKind}: ${groupLabel}. Para trocar, volte ao início e use o seletor de grupo.`}
              >
                <span className={styles.workspaceChipIcon}>{workspaceIcon}</span>
                <span className={styles.workspaceChipLabel}>{groupLabel}</span>
              </div>
            )
          ) : null}
        </div>

        {hasCenter ? <nav className={styles.center}>{center}</nav> : <div className={styles.spacer} />}

        <div className={styles.right}>
          {err ? <span className={`mm-error ${styles.err}`}>{err}</span> : null}
          {creditos?.excedido ? (
            <Link
              to="/conta/preferencias?tab=uso"
              className={styles.creditosExcedidos}
              title={`Créditos de IA do mês: ${creditos.usados.toLocaleString("pt-BR")} de ${creditos.limite?.toLocaleString("pt-BR")} do plano. Por enquanto o uso continua liberado.`}
            >
              <IconAlert size={14} />
              <span className={styles.creditosText}>Créditos excedidos</span>
            </Link>
          ) : null}
          {me ? <SinoNotificacoes /> : null}
          <div className={styles.menuWrap} ref={menuRef}>
            <button
              type="button"
              className={styles.avatarBtn}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Menu da conta"
              title={me ? (me.email ?? me.name ?? "Minha conta") : "Menu"}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {me ? initialsOf(me) : <IconUser size={16} />}
            </button>
            {menuOpen ? (
              <div className={styles.dropdown} role="menu">
                {me ? (
                  <div className={styles.menuHead}>
                    <span className={styles.menuAvatar} aria-hidden>
                      {initialsOf(me)}
                    </span>
                    <span className={styles.menuWho}>
                      <b>{me.name ?? me.email ?? `Usuário #${me.id}`}</b>
                      {me.name && me.email ? <small>{me.email}</small> : null}
                      {me.emailVerified === false ? (
                        <small className={styles.verifyHint} title="Confirme o e-mail para usar todos os recursos">
                          e-mail pendente de confirmação
                        </small>
                      ) : null}
                    </span>
                  </div>
                ) : null}

                {me ? (
                  <div className={styles.menuGroup}>
                    <div className={styles.menuLabel}>Conta</div>
                    <Link to="/conta/preferencias" role="menuitem" className={styles.item} onClick={close}>
                      <IconUser /> Minha conta
                    </Link>
                    <Link to="/avisos" role="menuitem" className={styles.item} onClick={close}>
                      <IconBell /> Meus avisos e lembretes
                    </Link>
                    <Link to="/importar-lote" role="menuitem" className={styles.item} onClick={close}>
                      <IconUpload /> Importar em lote
                    </Link>
                    {onOpenWorkspacePicker ? (
                      <button
                        type="button"
                        role="menuitem"
                        className={styles.item}
                        onClick={() => {
                          close();
                          onOpenWorkspacePicker();
                        }}
                      >
                        <IconSwap /> Trocar espaço <span className={styles.itemHint}>{groupLabel}</span>
                      </button>
                    ) : null}
                    <Link to="/grupo/novo" role="menuitem" className={styles.item} onClick={close}>
                      <IconPlus /> Criar novo grupo
                    </Link>
                  </div>
                ) : null}

                {hasAdminSection ? (
                  <div className={styles.menuGroup}>
                    <div className={styles.menuLabel}>Administração</div>
                    {ownerPanelGroupId != null ? (
                      <Link to={`/grupo/${ownerPanelGroupId}/painel`} role="menuitem" className={styles.item} onClick={close}>
                        <IconUsers /> Painel do owner
                      </Link>
                    ) : null}
                    {me?.memoContextAccess ? (
                      <Link to="/estrutura-memo" role="menuitem" className={styles.item} onClick={close}>
                        <IconLayers /> Estrutura contextual
                      </Link>
                    ) : null}
                    {isAdmin ? (
                      <>
                        <Link to="/admin" role="menuitem" className={styles.item} onClick={close}>
                          <IconSettings /> Painel admin
                        </Link>
                        <Link to="/admin/midia" role="menuitem" className={styles.item} onClick={close}>
                          <IconFolder /> Mídia por plano
                        </Link>
                        <Link to="/admin/documento-ia" role="menuitem" className={styles.item} onClick={close}>
                          <IconDoc /> Documento IA (roteamento)
                        </Link>
                        <Link to="/admin/llm-prompt" role="menuitem" className={styles.item} onClick={close}>
                          <IconCode /> Último prompt LLM
                        </Link>
                      </>
                    ) : null}
                  </div>
                ) : null}

                <div className={styles.menuGroup}>
                  <button type="button" role="menuitem" className={styles.item} onClick={toggleTheme}>
                    {theme === "dark" ? <IconSun /> : <IconMoon />}
                    {theme === "dark" ? "Tema claro" : "Tema escuro"}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.item}
                    onClick={() => {
                      close();
                      onMenuAction?.("ajuda");
                    }}
                  >
                    <IconHelp /> Ajuda
                  </button>
                  {me ? (
                    <button type="button" role="menuitem" className={`${styles.item} ${styles.itemDanger}`} onClick={() => void logout()}>
                      <IconLogout /> Sair
                    </button>
                  ) : (
                    <Link to="/login" role="menuitem" className={styles.item} onClick={close}>
                      <IconLogout /> Entrar
                    </Link>
                  )}
                </div>
                <div className={styles.menuFoot} title={versionTitle}>
                  Versão publicada em {versionLabel}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
