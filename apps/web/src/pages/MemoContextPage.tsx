import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  MeResponse,
  MemoContextCategory,
  MemoContextEditorMetaResponse,
  MemoContextMediaType,
  OperadorSql,
  QueryCategoria,
  QueryCategoriaParam,
  QueryCategoriaParamTipo,
} from "@mymemory/shared";
import { OPERADORES_SQL } from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiGetOptional, apiPatchJson, apiPostJson } from "../api";
import Header from "../components/Header";
import styles from "./MemoContextPage.module.css";

const CATEGORY_MEDIA_SELECT: { value: MemoContextMediaType | ""; label: string }[] = [
  { value: "", label: "Qualquer mídia" },
  { value: "text", label: "Texto" },
  { value: "audio", label: "Áudio" },
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "document", label: "Documento" },
  { value: "url", label: "URL" },
];

const MEDIA_FILTER: { value: MemoContextMediaType | ""; label: string }[] = [
  { value: "", label: "Todas as mídias" },
  ...CATEGORY_MEDIA_SELECT.filter((x) => x.value !== ""),
];

function mediaLabel(m: MemoContextMediaType | null): string {
  if (!m) return "Qualquer mídia";
  return CATEGORY_MEDIA_SELECT.find((x) => x.value === m)?.label ?? m;
}

function structureQueryPath(scopeGroupId: number | null, mediaFilter: MemoContextMediaType | null): string {
  const p = new URLSearchParams();
  if (scopeGroupId != null) p.set("groupId", String(scopeGroupId));
  if (mediaFilter != null) p.set("mediaType", mediaFilter);
  const s = p.toString();
  return `/api/memo-context/structure${s ? `?${s}` : ""}`;
}

const PT_SORT = "pt";

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, PT_SORT, { sensitivity: "base" }));
}

/** Categorias A–Z; subcategorias e campos também A–Z; queries A–Z; params por ordem. */
function sortStructureForDisplay(cats: MemoContextCategory[]): MemoContextCategory[] {
  return sortByName(cats).map((c) => ({
    ...c,
    subcategories: sortByName(c.subcategories),
    campos: sortByName(c.campos),
    queries: [...(c.queries ?? [])]
      .sort((a, b) => a.nome.localeCompare(b.nome, PT_SORT, { sensitivity: "base" }))
      .map((q) => ({
        ...q,
        params: [...q.params].sort((a, b) => a.ordem - b.ordem || a.id - b.id),
      })),
  }));
}

type ModalKind =
  | "none"
  | "category"
  | "categoryEdit"
  | "sub"
  | "campo"
  | "campoEdit"
  | "query"
  | "queryEdit"
  | "queryParam"
  | "queryParamEdit";

export default function MemoContextPage() {
  const [searchParams] = useSearchParams();
  const ownerGroupIdLocked = useMemo(() => {
    const raw = searchParams.get("ownerGroupId");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [searchParams]);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editorMeta, setEditorMeta] = useState<MemoContextEditorMetaResponse | null>(null);
  const [scopeGroupId, setScopeGroupId] = useState<number | null>(ownerGroupIdLocked);
  const [mediaFilter, setMediaFilter] = useState<MemoContextMediaType | "">("");
  const [categories, setCategories] = useState<MemoContextCategory[]>([]);
  const [canEditStructure, setCanEditStructure] = useState(false);
  const [loading, setLoading] = useState(true);
  const [structureLoading, setStructureLoading] = useState(false);

  const [modal, setModal] = useState<ModalKind>("none");
  const [editCategory, setEditCategory] = useState<MemoContextCategory | null>(null);
  const [modalCategoryId, setModalCategoryId] = useState<number | null>(null);
  const [modalCampoId, setModalCampoId] = useState<number | null>(null);
  const [modalName, setModalName] = useState("");
  const [modalDesc, setModalDesc] = useState("");
  const [modalMedia, setModalMedia] = useState<MemoContextMediaType | "">("");
  const [modalNormalizedTerms, setModalNormalizedTerms] = useState("");

  // Query modal state
  const [modalQueryId, setModalQueryId] = useState<number | null>(null);
  const [modalQueryNome, setModalQueryNome] = useState("");
  const [modalQueryDescricao, setModalQueryDescricao] = useState("");
  const [modalQuerySentencaSql, setModalQuerySentencaSql] = useState("");

  // Param modal state
  const [modalParamId, setModalParamId] = useState<number | null>(null);
  const [modalParamCampo, setModalParamCampo] = useState("");
  const [modalParamTipo, setModalParamTipo] = useState<QueryCategoriaParamTipo>("string");
  const [modalParamObrigatorio, setModalParamObrigatorio] = useState(1);
  const [modalParamOperadorSql, setModalParamOperadorSql] = useState<string>("=");
  const [modalParamNormalizar, setModalParamNormalizar] = useState(0);
  const [modalParamOrdem, setModalParamOrdem] = useState(0);

  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<number>>(() => new Set());

  const sortedCategories = useMemo(() => sortStructureForDisplay(categories), [categories]);

  const toggleCategoryExpanded = useCallback((id: number) => {
    setExpandedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAllCategories = useCallback(() => {
    setExpandedCategoryIds(new Set(sortedCategories.map((c) => c.id)));
  }, [sortedCategories]);

  const collapseAllCategories = useCallback(() => {
    setExpandedCategoryIds(new Set());
  }, []);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me")
      .then((r) => {
        if (!r.ok) {
          setMe(null);
          if (r.status === 401) setLoadErr("Faça login para acessar esta página.");
          else setLoadErr(`Erro ao carregar o perfil (HTTP ${r.status}).`);
          setLoading(false);
          return;
        }
        setMe(r.data);
        setForbidden(!r.data.memoContextAccess);
        setLoading(false);
      })
      .catch(() => setLoadErr("Não foi possível conectar à API."));
  }, []);

  const loadEditorMeta = useCallback(async () => {
    const m = await apiGet<MemoContextEditorMetaResponse>("/api/memo-context/editor-meta");
    setEditorMeta(m);
  }, []);

  useEffect(() => {
    if (!me?.memoContextAccess) return;
    void loadEditorMeta().catch(() => setLoadErr("Não foi possível carregar os grupos para o editor."));
  }, [me?.memoContextAccess, loadEditorMeta]);

  useEffect(() => {
    if (ownerGroupIdLocked == null) return;
    setScopeGroupId(ownerGroupIdLocked);
  }, [ownerGroupIdLocked]);

  const loadStructure = useCallback(async () => {
    setStructureLoading(true);
    setLoadErr(null);
    try {
      const mf = mediaFilter === "" ? null : mediaFilter;
      const r = await apiGet<{ categories: MemoContextCategory[]; capabilities: { canEditStructure: boolean } }>(
        structureQueryPath(scopeGroupId, mf)
      );
      setCategories(r.categories);
      setCanEditStructure(r.capabilities.canEditStructure);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Falha ao carregar estrutura.");
    } finally {
      setStructureLoading(false);
    }
  }, [scopeGroupId, mediaFilter]);

  useEffect(() => {
    if (!me?.memoContextAccess || !editorMeta) return;
    void loadStructure();
  }, [me?.memoContextAccess, editorMeta, loadStructure]);

  const groupOptions = useMemo(() => {
    const opts: { id: number | null; name: string }[] = [{ id: null, name: "Grupo vazio" }];
    if (!editorMeta) return opts;
    const list = editorMeta.isAdmin && editorMeta.allGroups ? editorMeta.allGroups : editorMeta.ownedGroups;
    for (const g of list) opts.push({ id: g.id, name: g.name });
    return opts;
  }, [editorMeta]);

  const ownerLockedGroupAllowed = useMemo(() => {
    if (ownerGroupIdLocked == null) return true;
    if (!editorMeta) return true;
    return editorMeta.ownedGroups.some((g) => g.id === ownerGroupIdLocked) || editorMeta.isAdmin;
  }, [ownerGroupIdLocked, editorMeta]);

  function resetModalState() {
    setEditCategory(null);
    setModalCampoId(null);
    setModalQueryId(null);
    setModalParamId(null);
  }

  const openNewCategory = () => {
    resetModalState();
    setModalName("");
    setModalDesc("");
    setModalMedia("");
    setModalCategoryId(null);
    setModalNormalizedTerms("");
    setModal("category");
  };

  const openEditCategory = (c: MemoContextCategory) => {
    setEditCategory(c);
    setModalName(c.name);
    setModalDesc(c.description ?? "");
    setModalMedia(c.mediaType ?? "");
    setModalCategoryId(c.id);
    setModalCampoId(null);
    setModalQueryId(null);
    setModalParamId(null);
    setModalNormalizedTerms("");
    setModal("categoryEdit");
  };

  const openNewSub = (cid: number) => {
    resetModalState();
    setModalCategoryId(cid);
    setModalName("");
    setModalDesc("");
    setModalNormalizedTerms("");
    setModal("sub");
  };

  const openNewCampo = (cid: number) => {
    resetModalState();
    setModalCategoryId(cid);
    setModalName("");
    setModalDesc("");
    setModalNormalizedTerms("");
    setModal("campo");
  };

  const openEditCampo = (catId: number, campo: MemoContextCategory["campos"][number]) => {
    resetModalState();
    setModalCategoryId(catId);
    setModalCampoId(campo.id);
    setModalName(campo.name);
    setModalDesc(campo.description ?? "");
    setModalNormalizedTerms(campo.normalizedTerms ?? "");
    setModal("campoEdit");
  };

  const openNewQuery = (cid: number) => {
    resetModalState();
    setModalCategoryId(cid);
    setModalQueryNome("");
    setModalQueryDescricao("");
    setModalQuerySentencaSql("");
    setModal("query");
  };

  const openEditQuery = (q: QueryCategoria) => {
    resetModalState();
    setModalQueryId(q.id);
    setModalQueryNome(q.nome);
    setModalQueryDescricao(q.descricao ?? "");
    setModalQuerySentencaSql(q.sentencaSql);
    setModal("queryEdit");
  };

  const openNewQueryParam = (qid: number) => {
    resetModalState();
    setModalQueryId(qid);
    setModalParamCampo("");
    setModalParamTipo("string");
    setModalParamObrigatorio(1);
    setModalParamOperadorSql("=");
    setModalParamNormalizar(0);
    setModalParamOrdem(0);
    setModal("queryParam");
  };

  const openEditQueryParam = (p: QueryCategoriaParam) => {
    resetModalState();
    setModalQueryId(p.queryId);
    setModalParamId(p.id);
    setModalParamCampo(p.campo);
    setModalParamTipo(p.tipo);
    setModalParamObrigatorio(p.obrigatorio);
    setModalParamOperadorSql(p.operadorSql);
    setModalParamNormalizar(p.normalizar);
    setModalParamOrdem(p.ordem);
    setModal("queryParamEdit");
  };

  const isQueryParamModal =
    modal === "query" || modal === "queryEdit" || modal === "queryParam" || modal === "queryParamEdit";

  const submitModal = async () => {
    if (!isQueryParamModal) {
      if (!modalName.trim()) return;
    } else if (modal === "query" || modal === "queryEdit") {
      if (!modalQueryNome.trim()) return;
    } else {
      if (!modalParamCampo.trim()) return;
    }
    try {
      const name = modalName.trim();
      if (modal === "category") {
        await apiPostJson("/api/memo-context/categories", {
          groupId: scopeGroupId,
          name,
          description: modalDesc.trim() || null,
          mediaType: modalMedia === "" ? null : modalMedia,
        });
      } else if (modal === "categoryEdit" && editCategory) {
        await apiPatchJson(`/api/memo-context/categories/${editCategory.id}`, {
          name,
          description: modalDesc.trim() || null,
          mediaType: modalMedia === "" ? null : modalMedia,
        });
      } else if (modal === "sub" && modalCategoryId != null) {
        await apiPostJson(`/api/memo-context/categories/${modalCategoryId}/subcategories`, {
          name,
          description: modalDesc.trim() || null,
        });
      } else if (modal === "campo" && modalCategoryId != null) {
        await apiPostJson(`/api/memo-context/categories/${modalCategoryId}/campos`, {
          name,
          description: modalDesc.trim() || null,
          normalizedTerms: modalNormalizedTerms.trim() || null,
        });
      } else if (modal === "campoEdit" && modalCampoId != null) {
        await apiPatchJson(`/api/memo-context/campos/${modalCampoId}`, {
          name,
          description: modalDesc.trim() || null,
          normalizedTerms: modalNormalizedTerms.trim() || null,
        });
      } else if (modal === "query" && modalCategoryId != null) {
        await apiPostJson(`/api/memo-context/categories/${modalCategoryId}/queries`, {
          nome: modalQueryNome.trim(),
          descricao: modalQueryDescricao.trim() || null,
          sentencaSql: modalQuerySentencaSql.trim(),
        });
      } else if (modal === "queryEdit" && modalQueryId != null) {
        await apiPatchJson(`/api/memo-context/queries/${modalQueryId}`, {
          nome: modalQueryNome.trim(),
          descricao: modalQueryDescricao.trim() || null,
          sentencaSql: modalQuerySentencaSql.trim(),
        });
      } else if (modal === "queryParam" && modalQueryId != null) {
        await apiPostJson(`/api/memo-context/queries/${modalQueryId}/params`, {
          campo: modalParamCampo.trim(),
          tipo: modalParamTipo,
          obrigatorio: modalParamObrigatorio,
          operadorSql: modalParamOperadorSql,
          normalizar: modalParamNormalizar,
          ordem: modalParamOrdem,
        });
      } else if (modal === "queryParamEdit" && modalParamId != null) {
        await apiPatchJson(`/api/memo-context/queries-params/${modalParamId}`, {
          campo: modalParamCampo.trim(),
          tipo: modalParamTipo,
          obrigatorio: modalParamObrigatorio,
          operadorSql: modalParamOperadorSql,
          normalizar: modalParamNormalizar,
          ordem: modalParamOrdem,
        });
      }
      setModal("none");
      resetModalState();
      await loadStructure();
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Falha ao salvar.");
    }
  };

  const confirmDelete = (msg: string, path: string) => {
    if (!window.confirm(msg)) return;
    void (async () => {
      try {
        await apiDeleteJson(path);
        await loadStructure();
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : "Falha ao excluir.");
      }
    })();
  };

  if (loadErr && !me) {
    return (
      <div className={styles.shell}>
        <Header />
        <main className={styles.main}>
          <p className="mm-error">{loadErr}</p>
          <Link to="/login" className={styles.back}>
            Ir ao login
          </Link>
        </main>
      </div>
    );
  }

  if (forbidden || (me && !me.memoContextAccess)) {
    return (
      <div className={styles.shell}>
        <Header />
        <main className={styles.main}>
          <h1 className={styles.cardTitle}>Acesso negado</h1>
          <p className="mm-muted">Apenas administradores ou donos de grupo podem acessar a estrutura contextual.</p>
        </main>
      </div>
    );
  }

  if (!ownerLockedGroupAllowed) {
    return (
      <div className={styles.shell}>
        <Header />
        <main className={styles.main}>
          <h1 className={styles.cardTitle}>Acesso negado</h1>
          <p className="mm-muted">
            Este atalho de owner só permite editar grupos dos quais você é dono.
          </p>
          {ownerGroupIdLocked != null ? (
            <Link to={`/grupo/${ownerGroupIdLocked}/painel`} className={styles.back}>
              Voltar ao painel do owner
            </Link>
          ) : null}
        </main>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <Header />
      <main className={styles.main}>
        <h1 className={styles.pageTitle}>Estrutura contextual</h1>
        {ownerGroupIdLocked != null ? (
          <p className={styles.sortHint}>
            Modo owner: escopo fixo no grupo <code>#{ownerGroupIdLocked}</code>.
          </p>
        ) : null}
        {ownerGroupIdLocked != null ? (
          <div style={{ marginBottom: "0.85rem" }}>
            <Link to={`/grupo/${ownerGroupIdLocked}/painel`} className="mm-btn mm-btn--ghost">
              ← Voltar ao painel do owner
            </Link>
          </div>
        ) : null}

        <p className={styles.sortHint}>
          Categorias, subcategorias e campos aparecem por ordem alfabética (A–Z). Clique em ▶ para ver subcategorias,
          campos e queries de cada categoria.
        </p>

        <div className={styles.filtersRow}>
          {ownerGroupIdLocked == null ? (
            <div className={styles.groupField}>
              <label htmlFor="ctx-group">Grupo</label>
              <select
                id="ctx-group"
                className={styles.groupSelect}
                value={scopeGroupId === null ? "" : String(scopeGroupId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setScopeGroupId(v === "" ? null : Number(v));
                }}
                disabled={loading || !editorMeta}
              >
                {groupOptions.map((g) => (
                  <option key={g.id === null ? "empty" : g.id} value={g.id === null ? "" : String(g.id)}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className={styles.groupField}>
            <label htmlFor="ctx-media">Tipo de mídia (filtro)</label>
            <select
              id="ctx-media"
              className={styles.groupSelect}
              value={mediaFilter}
              onChange={(e) => setMediaFilter(e.target.value as MemoContextMediaType | "")}
            >
              {MEDIA_FILTER.map((o) => (
                <option key={o.label} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!canEditStructure ? (
          <p className={styles.readOnlyBanner}>
            Só visualização: você pode mudar o filtro de mídia para explorar, mas não gravar alterações neste escopo. Para
            editar, selecione um grupo do qual você é dono (administradores podem editar o grupo vazio e qualquer grupo).
          </p>
        ) : null}

        <div className={styles.newCatRow}>
          {sortedCategories.length > 0 ? (
            <div className={styles.hierarchyToolbar}>
              <button type="button" className={`mm-btn mm-btn--ghost ${styles.hierarchyToolbarBtn}`} onClick={expandAllCategories}>
                Expandir todas
              </button>
              <button type="button" className={`mm-btn mm-btn--ghost ${styles.hierarchyToolbarBtn}`} onClick={collapseAllCategories}>
                Recolher todas
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="mm-btn mm-btn--primary"
            disabled={!canEditStructure || structureLoading}
            onClick={openNewCategory}
          >
            + Nova categoria
          </button>
        </div>

        {loadErr ? <p className="mm-error">{loadErr}</p> : null}
        {structureLoading ? <p className="mm-muted">Carregando…</p> : null}

        {!structureLoading && sortedCategories.length === 0 ? (
          <p className={styles.empty}>Nenhuma categoria neste filtro.</p>
        ) : null}

        <div className={styles.hierarchy}>
          {sortedCategories.map((cat) => {
            const expanded = expandedCategoryIds.has(cat.id);
            const detailsId = `ctx-cat-${cat.id}-details`;
            return (
            <section key={cat.id} className={styles.catSection}>
              <div className={styles.catLine}>
                <button
                  type="button"
                  className={styles.catToggle}
                  onClick={() => toggleCategoryExpanded(cat.id)}
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  title={expanded ? "Recolher" : "Expandir subcategorias, campos e queries"}
                >
                  <span className={styles.catChevron} aria-hidden>
                    {expanded ? "▼" : "▶"}
                  </span>
                </button>
                <span className={styles.catName}>{cat.name}</span>
                <span className={styles.catMeta}>
                  {mediaLabel(cat.mediaType)}
                  {cat.description ? ` — ${cat.description}` : ""}
                </span>
                <span className={styles.lineActions}>
                  {canEditStructure ? (
                    <>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        title="Editar categoria"
                        aria-label="Editar categoria"
                        onClick={() => openEditCategory(cat)}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        title="Excluir categoria"
                        aria-label="Excluir categoria"
                        onClick={() =>
                          confirmDelete(`Excluir a categoria "${cat.name}"?`, `/api/memo-context/categories/${cat.id}`)
                        }
                      >
                        🗑
                      </button>
                    </>
                  ) : null}
                </span>
              </div>

              {expanded ? (
              <div className={styles.nested} id={detailsId}>
                {/* Subcategorias */}
                <div className={styles.subBlock}>
                  <div className={styles.subHead}>
                    <span className={styles.subHeadLabel}>Subcategorias</span>
                    {canEditStructure ? (
                      <button type="button" className={`mm-btn mm-btn--ghost ${styles.subHeadBtn}`} onClick={() => openNewSub(cat.id)}>
                        + Nova subcategoria
                      </button>
                    ) : null}
                  </div>
                  <ul className={styles.itemList}>
                    {cat.subcategories.map((s) => (
                      <li key={s.id} className={styles.itemLine}>
                        <span>{s.name}</span>
                        {canEditStructure ? (
                          <span className={styles.lineActions}>
                            <button
                              type="button"
                              className={styles.iconBtn}
                              title="Editar"
                              aria-label={`Editar ${s.name}`}
                              onClick={() => {
                                const n = window.prompt("Nome da subcategoria", s.name);
                                if (n == null || !n.trim()) return;
                                void apiPatchJson(`/api/memo-context/subcategories/${s.id}`, { name: n.trim() }).then(
                                  () => loadStructure(),
                                  (e) => setLoadErr(e instanceof Error ? e.message : "Erro")
                                );
                              }}
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                              title="Excluir"
                              aria-label={`Excluir ${s.name}`}
                              onClick={() =>
                                confirmDelete(`Excluir subcategoria "${s.name}"?`, `/api/memo-context/subcategories/${s.id}`)
                              }
                            >
                              🗑
                            </button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Campos a extrair */}
                <div className={styles.subBlock}>
                  <div className={styles.subHead}>
                    <span className={styles.subHeadLabel}>Campos a extrair</span>
                    {canEditStructure ? (
                      <button type="button" className={`mm-btn mm-btn--ghost ${styles.subHeadBtn}`} onClick={() => openNewCampo(cat.id)}>
                        + Novo campo
                      </button>
                    ) : null}
                  </div>
                  <ul className={styles.itemList}>
                    {cat.campos.map((c) => (
                      <li key={c.id} className={styles.itemLine}>
                        <span>
                          {c.name}
                          {c.normalizedTerms?.trim()
                            ? ` · padrões: ${c.normalizedTerms}`
                            : ""}
                        </span>
                        {canEditStructure ? (
                          <span className={styles.lineActions}>
                            <button
                              type="button"
                              className={styles.iconBtn}
                              title="Editar"
                              aria-label={`Editar ${c.name}`}
                              onClick={() => openEditCampo(cat.id, c)}
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                              title="Excluir"
                              aria-label={`Excluir ${c.name}`}
                              onClick={() =>
                                confirmDelete(`Excluir campo "${c.name}"?`, `/api/memo-context/campos/${c.id}`)
                              }
                            >
                              🗑
                            </button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Queries SQL */}
                <div className={styles.subBlock}>
                  <div className={styles.subHead}>
                    <span className={styles.subHeadLabel}>Queries SQL</span>
                    {canEditStructure ? (
                      <button type="button" className={`mm-btn mm-btn--ghost ${styles.subHeadBtn}`} onClick={() => openNewQuery(cat.id)}>
                        + Nova query
                      </button>
                    ) : null}
                  </div>
                  {cat.queries.length === 0 ? (
                    <p className={styles.queryEmpty}>Nenhuma query configurada.</p>
                  ) : (
                    <div className={styles.queryList}>
                      {cat.queries.map((q) => (
                        <div key={q.id} className={styles.queryItem}>
                          <div className={styles.queryItemHead}>
                            <div className={styles.queryItemInfo}>
                              <span className={styles.queryItemNome}>{q.nome}</span>
                              {q.descricao ? <span className={styles.queryItemDesc}>{q.descricao}</span> : null}
                              <code className={styles.queryItemSql}>
                                {q.sentencaSql.length > 140 ? `${q.sentencaSql.slice(0, 140)}…` : q.sentencaSql}
                              </code>
                            </div>
                            {canEditStructure ? (
                              <span className={styles.lineActions}>
                                <button
                                  type="button"
                                  className={styles.iconBtn}
                                  title="Editar query"
                                  onClick={() => openEditQuery(q)}
                                >
                                  ✎
                                </button>
                                <button
                                  type="button"
                                  className={`mm-btn mm-btn--ghost ${styles.subHeadBtn}`}
                                  title="Adicionar parâmetro"
                                  onClick={() => openNewQueryParam(q.id)}
                                >
                                  + Param
                                </button>
                                <button
                                  type="button"
                                  className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                                  title="Excluir query"
                                  onClick={() =>
                                    confirmDelete(`Excluir query "${q.nome}"?`, `/api/memo-context/queries/${q.id}`)
                                  }
                                >
                                  🗑
                                </button>
                              </span>
                            ) : null}
                          </div>

                          {q.params.length > 0 ? (
                            <table className={styles.paramsTable}>
                              <thead>
                                <tr>
                                  <th>Campo</th>
                                  <th>Tipo</th>
                                  <th>Obrig.</th>
                                  <th>Operador SQL</th>
                                  <th>Normalizar</th>
                                  <th>Ordem</th>
                                  {canEditStructure ? <th></th> : null}
                                </tr>
                              </thead>
                              <tbody>
                                {q.params.map((p) => (
                                  <tr key={p.id}>
                                    <td>{p.campo}</td>
                                    <td>{p.tipo}</td>
                                    <td>{p.obrigatorio ? "Sim" : "Não"}</td>
                                    <td><code>{p.operadorSql}</code></td>
                                    <td>{p.normalizar ? "Sim" : "Não"}</td>
                                    <td>{p.ordem}</td>
                                    {canEditStructure ? (
                                      <td className={styles.paramActions}>
                                        <button
                                          type="button"
                                          className={styles.iconBtn}
                                          title="Editar parâmetro"
                                          onClick={() => openEditQueryParam(p)}
                                        >
                                          ✎
                                        </button>
                                        <button
                                          type="button"
                                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                                          title="Excluir parâmetro"
                                          onClick={() =>
                                            confirmDelete(
                                              `Excluir parâmetro "${p.campo}"?`,
                                              `/api/memo-context/queries-params/${p.id}`
                                            )
                                          }
                                        >
                                          🗑
                                        </button>
                                      </td>
                                    ) : null}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className={styles.queryEmpty}>Nenhum parâmetro.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              ) : null}
            </section>
            );
          })}
        </div>
      </main>

      {modal !== "none" ? (
        <div
          className="mm-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setModal("none");
              resetModalState();
            }
          }}
        >
          <div className="mm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.cardTitle}>
              {modal === "category" && "Nova categoria"}
              {modal === "categoryEdit" && "Editar categoria"}
              {modal === "sub" && "Nova subcategoria"}
              {modal === "campo" && "Novo campo"}
              {modal === "campoEdit" && "Editar campo"}
              {modal === "query" && "Nova query SQL"}
              {modal === "queryEdit" && "Editar query SQL"}
              {modal === "queryParam" && "Novo parâmetro"}
              {modal === "queryParamEdit" && "Editar parâmetro"}
            </h3>

            {/* Campos: categoria */}
            {(modal === "category" || modal === "categoryEdit") && (
              <div className={styles.modalField}>
                <label htmlFor="mod-media">Mídia da categoria</label>
                <select
                  id="mod-media"
                  className="mm-field"
                  value={modalMedia}
                  onChange={(e) => setModalMedia(e.target.value as MemoContextMediaType | "")}
                >
                  {CATEGORY_MEDIA_SELECT.map((o) => (
                    <option key={o.label} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className={styles.fieldHelpSmall}>Vazio = qualquer mídia; preenchido = só esse tipo.</p>
              </div>
            )}
            {!isQueryParamModal && (
              <>
                <div className={styles.modalField}>
                  <label htmlFor="mod-name">Nome</label>
                  <input id="mod-name" className="mm-field" value={modalName} onChange={(e) => setModalName(e.target.value)} />
                </div>
                <div className={styles.modalField}>
                  <label htmlFor="mod-desc">Descrição</label>
                  <textarea
                    id="mod-desc"
                    className="mm-field"
                    rows={3}
                    value={modalDesc}
                    onChange={(e) => setModalDesc(e.target.value)}
                  />
                </div>
              </>
            )}
            {(modal === "campo" || modal === "campoEdit") ? (
              <div className={styles.modalField}>
                <label htmlFor="mod-terms">Termos padronizados (vírgula)</label>
                <input
                  id="mod-terms"
                  className="mm-field"
                  value={modalNormalizedTerms}
                  onChange={(e) => setModalNormalizedTerms(e.target.value)}
                  placeholder="Ex.: pago, pendente, cancelado"
                />
                <p className={styles.fieldHelpSmall}>
                  Opcional. A IA tentará aproximar o valor extraído para um destes padrões.
                </p>
              </div>
            ) : null}

            {/* Campos: query */}
            {(modal === "query" || modal === "queryEdit") ? (
              <>
                <div className={styles.modalField}>
                  <label htmlFor="mod-q-nome">Nome da query</label>
                  <input
                    id="mod-q-nome"
                    className="mm-field"
                    value={modalQueryNome}
                    onChange={(e) => setModalQueryNome(e.target.value)}
                  />
                </div>
                <div className={styles.modalField}>
                  <label htmlFor="mod-q-desc">Descrição</label>
                  <input
                    id="mod-q-desc"
                    className="mm-field"
                    value={modalQueryDescricao}
                    onChange={(e) => setModalQueryDescricao(e.target.value)}
                  />
                </div>
                <div className={styles.modalField}>
                  <label htmlFor="mod-q-sql">Sentença SQL</label>
                  <textarea
                    id="mod-q-sql"
                    className="mm-field"
                    rows={6}
                    style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.82rem" }}
                    value={modalQuerySentencaSql}
                    onChange={(e) => setModalQuerySentencaSql(e.target.value)}
                    placeholder="SELECT * FROM tabela WHERE campo = :campo"
                  />
                  <p className={styles.fieldHelpSmall}>
                    Use <code>:nome_param</code> como placeholder para os parâmetros definidos abaixo.
                  </p>
                </div>
              </>
            ) : null}

            {/* Campos: parâmetro */}
            {(modal === "queryParam" || modal === "queryParamEdit") ? (
              <>
                <div className={styles.modalField}>
                  <label htmlFor="mod-p-campo">Campo (nome do parâmetro)</label>
                  <input
                    id="mod-p-campo"
                    className="mm-field"
                    value={modalParamCampo}
                    onChange={(e) => setModalParamCampo(e.target.value)}
                    placeholder="ex.: status, data_inicio"
                  />
                </div>
                <div className={styles.modalParamGrid}>
                  <div className={styles.modalField}>
                    <label htmlFor="mod-p-tipo">Tipo</label>
                    <select
                      id="mod-p-tipo"
                      className="mm-field"
                      value={modalParamTipo}
                      onChange={(e) => setModalParamTipo(e.target.value as QueryCategoriaParamTipo)}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="date">date</option>
                      <option value="boolean">boolean</option>
                    </select>
                  </div>
                  <div className={styles.modalField}>
                    <label htmlFor="mod-p-op">Operador SQL</label>
                    <select
                      id="mod-p-op"
                      className="mm-field"
                      value={modalParamOperadorSql}
                      onChange={(e) => setModalParamOperadorSql(e.target.value as OperadorSql)}
                    >
                      {OPERADORES_SQL.map((op) => (
                        <option key={op} value={op}>{op}</option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.modalField}>
                    <label htmlFor="mod-p-ordem">Ordem</label>
                    <input
                      id="mod-p-ordem"
                      type="number"
                      min={0}
                      className="mm-field"
                      value={modalParamOrdem}
                      onChange={(e) => setModalParamOrdem(Math.max(0, Number(e.target.value)))}
                    />
                  </div>
                </div>
                <div className={styles.paramCheckboxRow}>
                  <label className={styles.paramCheckboxLabel}>
                    <input
                      type="checkbox"
                      checked={modalParamObrigatorio === 1}
                      onChange={(e) => setModalParamObrigatorio(e.target.checked ? 1 : 0)}
                    />
                    Obrigatório
                  </label>
                  <label className={styles.paramCheckboxLabel}>
                    <input
                      type="checkbox"
                      checked={modalParamNormalizar === 1}
                      onChange={(e) => setModalParamNormalizar(e.target.checked ? 1 : 0)}
                    />
                    Normalizar valor
                  </label>
                </div>
              </>
            ) : null}

            <div className={styles.rowActions}>
              <button
                type="button"
                className="mm-btn mm-btn--ghost"
                onClick={() => {
                  setModal("none");
                  resetModalState();
                }}
              >
                Cancelar
              </button>
              <button type="button" className="mm-btn mm-btn--primary" onClick={() => void submitModal()}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
