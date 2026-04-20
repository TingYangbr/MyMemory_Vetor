import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { MemoRecentCard } from "@mymemory/shared";
import { apiDeleteJson, apiGet } from "../api";
import { parseKeywordList, parseMemoDadosEspecificosEntries } from "../memo/memoCardDisplayUtils";
import { MemoDadosEspecificosDisplay } from "../memo/MemoDadosEspecificosDisplay";
import { MemoCardMediaMini } from "../memo/MemoCardMediaMini";
import { MemoCardPrimaryRow } from "../memo/MemoCardPrimaryRow";
import { MemoFilePreviewModal } from "./MemoFilePreviewModal";
import { MemoResultListRow } from "./MemoResultListRow";
import styles from "./RecentMemos.module.css";

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

const RECENT_UI_STORAGE_KEY = "mm_recent_memos_ui_v1";

type RecentViewMode = "list" | "cards";

type RecentUiPersisted = {
  view?: RecentViewMode;
  expanded?: boolean;
};

function loadRecentUiState(): { view: RecentViewMode; expanded: boolean } {
  try {
    const raw = localStorage.getItem(RECENT_UI_STORAGE_KEY);
    if (!raw) return { view: "cards", expanded: true };
    const j = JSON.parse(raw) as RecentUiPersisted;
    const view = j.view === "list" ? "list" : "cards";
    const expanded = j.expanded !== false;
    return { view, expanded };
  } catch {
    return { view: "cards", expanded: true };
  }
}

function saveRecentUiState(view: RecentViewMode, expanded: boolean): void {
  try {
    localStorage.setItem(RECENT_UI_STORAGE_KEY, JSON.stringify({ view, expanded }));
  } catch {
    /* quota / private mode */
  }
}

type Props = {
  refreshKey?: number;
  /** Omitido ou `null` = listar apenas memos pessoais (`groupId` nulo). */
  workspaceGroupId?: number | null;
  /** Usuário autenticado — para mostrar editar / excluir só nos próprios memos. */
  currentUserId?: number | null;
  /** De `/api/me` — ocultar custo/créditos quando `false`. */
  showApiCost?: boolean;
};

/** Garante cartões válidos mesmo com API antiga ou campos em falta (evita crash no refresh). */
function normalizeRecentItem(raw: Record<string, unknown>): MemoRecentCard | null {
  const id = Number(raw.id);
  const mediaType = raw.mediaType;
  if (!Number.isFinite(id) || id < 1 || typeof mediaType !== "string") return null;

  const mediaText =
    typeof raw.mediaText === "string"
      ? raw.mediaText
      : typeof raw.headline === "string"
        ? raw.headline
        : "";
  const headline =
    typeof raw.headline === "string" && raw.headline.trim()
      ? raw.headline
      : mediaText.length > 120
        ? `${mediaText.slice(0, 117)}…`
        : mediaText || mediaType;

  const uid = Number(raw.userId);
  const apiCost = Number(raw.apiCost);
  const usedApiCred = Number(raw.usedApiCred);
  return {
    id,
    mediaType: mediaType as MemoRecentCard["mediaType"],
    headline,
    mediaText,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    mediaWebUrl: typeof raw.mediaWebUrl === "string" ? raw.mediaWebUrl : null,
    hasFile: Boolean(raw.hasFile),
    keywords: typeof raw.keywords === "string" ? raw.keywords : null,
    dadosEspecificosJson:
      typeof raw.dadosEspecificosJson === "string" ? raw.dadosEspecificosJson : null,
    mediaFileUrl: typeof raw.mediaFileUrl === "string" ? raw.mediaFileUrl : null,
    attachmentDisplayName:
      typeof raw.attachmentDisplayName === "string" && raw.attachmentDisplayName.trim()
        ? raw.attachmentDisplayName.trim()
        : null,
    userId: Number.isFinite(uid) ? uid : -1,
    apiCost: Number.isFinite(apiCost) ? apiCost : 0,
    usedApiCred: Number.isFinite(usedApiCred) ? usedApiCred : 0,
  };
}

function IconList({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16M4 12h16M4 18h10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCards({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function IconChevronUp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RecentMemos({
  refreshKey = 0,
  workspaceGroupId = null,
  currentUserId = null,
  showApiCost = true,
}: Props) {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search || ""}` || "/";
  const [items, setItems] = useState<MemoRecentCard[]>([]);
  /** Falha ao carregar a lista — não misturar com exclusão (evita apagar o aviso do DELETE quando um GET antigo termina). */
  const [listError, setListError] = useState<string | null>(null);
  /** Falha só do fluxo “mover para lixeira” — mostrada no modal. */
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemoRecentCard | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const initialUi = useRef(loadRecentUiState());
  const [viewMode, setViewMode] = useState<RecentViewMode>(initialUi.current.view);
  const [sectionExpanded, setSectionExpanded] = useState<boolean>(initialUi.current.expanded);
  const [previewMemo, setPreviewMemo] = useState<MemoRecentCard | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    saveRecentUiState(viewMode, sectionExpanded);
  }, [viewMode, sectionExpanded]);

  useEffect(() => {
    if (!previewMemo) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setPreviewMemo(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewMemo]);

  const load = useCallback(() => {
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;
    const q =
      workspaceGroupId != null
        ? `/api/memos/recent?limit=12&groupId=${encodeURIComponent(String(workspaceGroupId))}`
        : "/api/memos/recent?limit=12";
    apiGet<{ items: unknown }>(q, { signal: ac.signal })
      .then((r) => {
        setListError(null);
        const rawList = Array.isArray(r.items) ? r.items : [];
        const next = rawList
          .map((row) => normalizeRecentItem(row as Record<string, unknown>))
          .filter((x): x is MemoRecentCard => x != null);
        setItems(next);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        const t = e instanceof Error ? e.message : "";
        if (t.includes("unauthorized")) setListError("Faça login para ver os memos recentes.");
        else setListError("Não foi possível carregar memos recentes.");
      });
  }, [workspaceGroupId]);

  useEffect(() => {
    load();
    return () => loadAbortRef.current?.abort();
  }, [load, refreshKey]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeletingId(id);
    setDeleteError(null);
    try {
      await apiDeleteJson(`/api/memos/${id}`);
      setItems((prev) => prev.filter((m) => m.id !== id));
      setDeleteTarget(null);
      load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Não foi possível excluir.");
    } finally {
      setDeletingId(null);
    }
  }

  function renderCard(m: MemoRecentCard) {
    const bodyText = m.mediaText ?? m.headline ?? "";
    const isOwner = currentUserId != null && m.userId > 0 && m.userId === currentUserId;
    const kw = parseKeywordList(m.keywords);
    const dadosEntries = parseMemoDadosEspecificosEntries(m.dadosEspecificosJson);
    const longText = bodyText.length > 220;
    const textExpanded = expandedId === m.id;
    const showCostRow = showApiCost && ((m.apiCost ?? 0) > 0 || (m.usedApiCred ?? 0) > 0);

    return (
      <article key={m.id} className={styles.card}>
        <header className={styles.cardTop}>
          <div className={styles.cardTopPrimary}>
            <MemoCardPrimaryRow m={m} apiBase={apiBase} returnTo={returnTo} />
          </div>
          <span className={styles.memoRef}>#{m.id}</span>
        </header>

        {showCostRow ? (
          <p className={styles.costStrip}>
            Custo API (USD): {(m.apiCost ?? 0).toFixed(6)}
            {(m.usedApiCred ?? 0) > 0 ? ` · Créditos: ${(m.usedApiCred ?? 0).toFixed(6)}` : null}
          </p>
        ) : null}

        <MemoCardMediaMini m={m} apiBase={apiBase} />

        <div className={styles.keywordsBlock}>
          <span className={styles.keywordsLabel}>Palavras-chave</span>
          {kw.length ? (
            <ul className={styles.keywordList}>
              {kw.map((k) => (
                <li key={k} className={styles.keywordChip}>
                  {k}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.keywordsEmpty}>Nenhuma — edite o memo para adicionar (separadas por vírgula).</p>
          )}
        </div>

        {dadosEntries?.length ? (
          <div className={styles.keywordsBlock}>
            <span className={styles.keywordsLabel}>Dados específicos</span>
            <p className={styles.dadosPreview}>
              <MemoDadosEspecificosDisplay entries={dadosEntries} />
            </p>
          </div>
        ) : null}

        <div className={styles.textBlock}>
          <p className={textExpanded ? styles.mediaTextFull : styles.mediaTextClamp}>{bodyText}</p>
          {longText && !textExpanded ? (
            <button type="button" className={styles.expandBtn} onClick={() => setExpandedId(m.id)}>
              Ver mais
            </button>
          ) : null}
          {longText && expandedId === m.id ? (
            <button type="button" className={styles.expandBtn} onClick={() => setExpandedId(null)}>
              Ver menos
            </button>
          ) : null}
        </div>

        <div className={styles.actionsRow}>
          <div className={styles.clipActions}>
            <button
              type="button"
              className={`mm-btn mm-btn--ghost ${styles.actionSm}`}
              disabled
              title="Em breve — copiar para outro grupo"
            >
              Copiar
            </button>
            <button
              type="button"
              className={`mm-btn mm-btn--ghost ${styles.actionSm}`}
              disabled
              title="Em breve — recortar / colar entre grupos"
            >
              Recortar
            </button>
          </div>
          {isOwner ? (
            <div className={styles.ownerActions}>
              <Link
                to={`/memo/${m.id}/editar`}
                state={{ returnTo }}
                className={`mm-btn mm-btn--ghost ${styles.actionSm}`}
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
              >
                Editar
              </Link>
              <button
                type="button"
                className={`mm-btn mm-btn--ghost ${styles.actionDanger}`}
                disabled={deletingId !== null}
                onClick={() => {
                  setDeleteError(null);
                  setDeleteTarget(m);
                }}
                aria-label={`Mover memo ${m.id} para a lixeira`}
              >
                Lixeira
              </button>
            </div>
          ) : (
            <p className={styles.notOwnerHint}>Memo de outro membro — somente visualização.</p>
          )}
        </div>
      </article>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="memos-recentes-titulo">
      <div className={styles.head}>
        <div className={styles.headLeft}>
          <span className={styles.accent} aria-hidden />
          <h2 id="memos-recentes-titulo" className={styles.title}>
            Memos recentes
          </h2>
        </div>
        <div className={styles.headTools} role="toolbar" aria-label="Vista dos memos recentes">
          <button
            type="button"
            className={`${styles.viewToggle} ${viewMode === "list" ? styles.viewToggleOn : ""}`}
            aria-pressed={viewMode === "list"}
            aria-label="Vista em lista"
            title="Lista"
            onClick={() => setViewMode("list")}
          >
            <IconList className={styles.viewToggleIcon} />
          </button>
          <button
            type="button"
            className={`${styles.viewToggle} ${viewMode === "cards" ? styles.viewToggleOn : ""}`}
            aria-pressed={viewMode === "cards"}
            aria-label="Vista em cartões"
            title="Cartões"
            onClick={() => setViewMode("cards")}
          >
            <IconCards className={styles.viewToggleIcon} />
          </button>
          <button
            type="button"
            className={styles.viewToggle}
            aria-expanded={sectionExpanded}
            aria-label={sectionExpanded ? "Recolher memos recentes" : "Expandir memos recentes"}
            title={sectionExpanded ? "Recolher" : "Expandir"}
            onClick={() => setSectionExpanded((v) => !v)}
          >
            {sectionExpanded ? (
              <IconChevronUp className={styles.viewToggleIcon} />
            ) : (
              <IconChevronDown className={styles.viewToggleIcon} />
            )}
          </button>
        </div>
      </div>
      {listError ? <p className="mm-error">{listError}</p> : null}
      {sectionExpanded ? (
        viewMode === "cards" ? (
          <div className={styles.grid}>{items.map((m) => renderCard(m))}</div>
        ) : (
          <ul className={styles.list}>
            {items.map((m) => (
              <MemoResultListRow
                key={m.id}
                m={m}
                returnTo={returnTo}
                currentUserId={currentUserId}
                deletingId={deletingId}
                onOpenPreview={setPreviewMemo}
                onRequestDelete={(mm) => {
                  setDeleteError(null);
                  setDeleteTarget(mm);
                }}
              />
            ))}
          </ul>
        )
      ) : null}
      {!listError && sectionExpanded && items.length === 0 ? (
        <p className={`mm-muted ${styles.empty}`}>Nenhum memo ainda — registre um acima.</p>
      ) : null}

      {previewMemo ? (
        <MemoFilePreviewModal
          m={previewMemo}
          apiBase={apiBase}
          returnTo={returnTo}
          onClose={() => setPreviewMemo(null)}
        />
      ) : null}

      {deleteTarget ? (
        <div
          className="mm-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deletingId) {
              setDeleteError(null);
              setDeleteTarget(null);
            }
          }}
        >
          <div
            className={`mm-modal ${styles.confirmDialog}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-memo-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-memo-title" className={styles.confirmTitle}>
              Mover para a lixeira?
            </h3>
            <p className={styles.confirmLead}>
              O registro fica inativo (exclusão lógica). A remoção definitiva em lote é feita pelo administrador
              após consumo de API.
            </p>
            {deleteError ? <p className="mm-error">{deleteError}</p> : null}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className="mm-btn mm-btn--ghost"
                disabled={deletingId !== null}
                onClick={() => {
                  setDeleteError(null);
                  setDeleteTarget(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                disabled={deletingId !== null}
                onClick={() => void confirmDelete()}
              >
                {deletingId ? "Excluindo…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
