import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  DbConnection,
  DbConnectionListResponse,
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

/** Categorias A–Z; subcategorias e campos também A–Z; queries A–Z; params A–Z. */
function sortStructureForDisplay(cats: MemoContextCategory[]): MemoContextCategory[] {
  return sortByName(cats).map((c) => ({
    ...c,
    subcategories: sortByName(c.subcategories),
    campos: sortByName(c.campos),
    queries: [...(c.queries ?? [])]
      .sort((a, b) => a.nome.localeCompare(b.nome, PT_SORT, { sensitivity: "base" }))
      .map((q) => ({
        ...q,
        params: [...q.params].sort((a, b) => a.campo.localeCompare(b.campo, PT_SORT, { sensitivity: "base" })),
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
  const [modalQueryConexaoId, setModalQueryConexaoId] = useState<number | null>(null);
  const [dbConnOptions, setDbConnOptions] = useState<DbConnection[]>([]);
  const [syntaxResult, setSyntaxResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [syntaxBusy, setSyntaxBusy] = useState(false);

  // Param modal state
  const [modalParamId, setModalParamId] = useState<number | null>(null);
  const [modalParamCampo, setModalParamCampo] = useState("");
  const [modalParamTipo, setModalParamTipo] = useState<QueryCategoriaParamTipo>("string");
  const [modalParamObrigatorio, setModalParamObrigatorio] = useState(1);
  const [modalParamOperadorSql, setModalParamOperadorSql] = useState<string>("=");
  const [modalParamNormalizar, setModalParamNormalizar] = useState(0);
  const [modalParamOrdem, setModalParamOrdem] = useState(0);

  const [modalSaveError, setModalSaveError] = useState<string | null>(null);
  const [modalSaveBusy, setModalSaveBusy] = useState(false);

  const [pendingAutoParams, setPendingAutoParams] = useState<{
    campo: string;
    tipo: QueryCategoriaParamTipo;
    obrigatorio: number;
    operadorSql: string;
    normalizar: number;
    ordem: number;
  }[]>([]);

  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<number>>(() => new Set());

  // ── Clone modal ─────────────────────────────────────────────────────────────
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloneGlobalCats, setCloneGlobalCats] = useState<MemoContextCategory[]>([]);
  const [cloneCatsLoading, setCloneCatsLoading] = useState(false);
  const [cloneSelected, setCloneSelected] = useState<Set<number>>(new Set());
  const [cloneTargetGroupId, setCloneTargetGroupId] = useState<number | null>(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneResult, setCloneResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const openCloneModal = () => {
    setCloneSelected(new Set());
    setCloneTargetGroupId(null);
    setCloneResult(null);
    setCloneCatsLoading(true);
    setCloneModalOpen(true);
    apiGet<{ categories: MemoContextCategory[] }>(structureQueryPath(null, null))
      .then((r) => setCloneGlobalCats(sortStructureForDisplay(r.categories)))
      .catch(() => setCloneGlobalCats([]))
      .finally(() => setCloneCatsLoading(false));
  };

  const submitClone = () => {
    if (cloneSelected.size === 0 || cloneTargetGroupId == null) return;
    setCloneBusy(true);
    setCloneResult(null);
    apiPostJson<{ ok: boolean; cloned: { originalId: number; newId: number; name: string }[] }>(
      "/api/admin/memo-context/clone-categories",
      { categoryIds: Array.from(cloneSelected), targetGroupId: cloneTargetGroupId }
    )
      .then((r) => {
        setCloneResult({ ok: true, msg: `${r.cloned.length} categoria(s) clonada(s) com sucesso.` });
        void loadStructure();
      })
      .catch((e) => {
        const raw = e instanceof Error ? e.message : String(e);
        try { setCloneResult({ ok: false, msg: (JSON.parse(raw) as { message?: string }).message ?? raw }); }
        catch { setCloneResult({ ok: false, msg: raw }); }
      })
      .finally(() => setCloneBusy(false));
  };

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

  const groupOptionsForClone = useMemo(
    () => groupOptions.filter((g) => g.id !== null) as { id: number; name: string }[],
    [groupOptions]
  );

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
    setPendingAutoParams([]);
    setModalSaveError(null);
    setModalSaveBusy(false);
    setSyntaxResult(null);
    setSyntaxBusy(false);
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

  const loadDbConnOptions = () => {
    const isAdmin = editorMeta?.isAdmin ?? false;
    const url = !isAdmin && scopeGroupId
      ? `/api/groups/${scopeGroupId}/db-connections`
      : "/api/admin/db-connections";
    apiGet<DbConnectionListResponse>(url)
      .then((r) => setDbConnOptions(r.connections.filter((c) => c.isActive === 1)))
      .catch(() => setDbConnOptions([]));
  };

  function extrairParamsDoSql() {
    const sql = modalQuerySentencaSql;
    const SYSTEM_PARAMS = new Set(["userid", "groupid", "categoryid"]);
    // Match :param (PostgreSQL) and @param (MSSQL), excluding @@system variables
    const re = /(?<!:):([a-zA-Z][a-zA-Z0-9_]*)|(?<!@)@([a-zA-Z][a-zA-Z0-9_]*)/g;
    const seen = new Set<string>();
    const extracted: typeof pendingAutoParams = [];
    let ordem = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const name = (m[1] ?? m[2]).toLowerCase();
      if (SYSTEM_PARAMS.has(name) || seen.has(name)) continue;
      seen.add(name);
      const before = sql.slice(0, m.index).trimEnd();
      let operadorSql: string = "=";
      if (/\bNOT\s+IN\s*\(\s*$/i.test(before))        operadorSql = "NOT IN";
      else if (/\bIN\s*\(\s*$/i.test(before))          operadorSql = "IN";
      else if (/\bI?LIKE\s+$/i.test(before))           operadorSql = "LIKE";
      else if (/>=\s*$/.test(before))                  operadorSql = ">=";
      else if (/<=\s*$/.test(before))                  operadorSql = "<=";
      else if (/[<>!]=?\s*$/.test(before) && !/>=$/.test(before) && !/<=$/.test(before)) {
        if (/!=\s*$|<>\s*$/.test(before)) operadorSql = "!=";
        else if (/>\s*$/.test(before))    operadorSql = ">";
        else if (/<\s*$/.test(before))    operadorSql = "<";
      }
      let tipo: QueryCategoriaParamTipo = "string";
      if (/^(id$|.*_id$|userid|groupid)/.test(name))              tipo = "number";
      else if (/data|date|lancamento|vencimento|emissao/.test(name)) tipo = "date";
      extracted.push({ campo: name, tipo, obrigatorio: 0, operadorSql, normalizar: 0, ordem: ordem++ });
    }
    setPendingAutoParams(extracted);
  }

  const openNewQuery = (cid: number) => {
    resetModalState();
    setModalCategoryId(cid);
    setModalQueryNome("");
    setModalQueryDescricao("");
    setModalQuerySentencaSql("");
    setModalQueryConexaoId(null);
    loadDbConnOptions();
    setModal("query");
  };

  const openEditQuery = (q: QueryCategoria) => {
    resetModalState();
    setModalQueryId(q.id);
    setModalQueryNome(q.nome);
    setModalQueryDescricao(q.descricao ?? "");
    setModalQuerySentencaSql(q.sentencaSql);
    setModalQueryConexaoId(q.conexaoId ?? null);
    loadDbConnOptions();
    setModal("queryEdit");
  };

  const checkSyntax = async () => {
    if (!modalQueryConexaoId) {
      setSyntaxResult({ ok: false, message: "Verificação disponível apenas para conexões SQL Server externas." });
      return;
    }
    setSyntaxBusy(true);
    setSyntaxResult(null);
    try {
      const isAdmin = editorMeta?.isAdmin ?? false;
      const syntaxUrl = !isAdmin && scopeGroupId
        ? `/api/groups/${scopeGroupId}/db-connections/${modalQueryConexaoId}/syntax-check`
        : `/api/admin/db-connections/${modalQueryConexaoId}/syntax-check`;
      const res = await apiPostJson<{ ok: boolean; message: string }>(
        syntaxUrl,
        { sentencaSql: modalQuerySentencaSql }
      );
      setSyntaxResult(res);
    } catch (e) {
      setSyntaxResult({ ok: false, message: e instanceof Error ? e.message : "Erro ao verificar." });
    } finally {
      setSyntaxBusy(false);
    }
  };

  function toParamName(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }

  function gerarQueryPadrao() {
    if (modalCategoryId == null) return;
    const cat = categories.find((c) => c.id === modalCategoryId);
    if (!cat) return;

    const activeCampos = cat.campos.filter((c) => c.isActive === 1);
    const catNameSafe = cat.name.replace(/'/g, "''");

    const whereParts: string[] = [
      "  m.isactive = 1",
      `  AND m.category = '${catNameSafe}'`,
      "  AND (",
      "    (:groupId IS NOT NULL AND m.groupid = :groupId)",
      "    OR (:groupId IS NULL AND m.groupid IS NULL AND m.userid = :userId)",
      "  )",
    ];

    for (const campo of activeCampos) {
      const p = toParamName(campo.name);
      if (!p) continue;
      whereParts.push(
        `  AND (:${p} IS NULL OR m.dadosespecificosjson::jsonb->>'${campo.name}' ILIKE :${p})`
      );
    }

    const campoSelects = activeCampos
      .map((campo) => {
        const alias = toParamName(campo.name) || `campo_${campo.id}`;
        return `  m.dadosespecificosjson::jsonb->>'${campo.name}' AS ${alias},`;
      })
      .join("\n");

    const sql = [
      "SELECT",
      "  m.id,",
      "  m.mediatype,",
      "  m.mediatext,",
      "  m.keywords,",
      "  m.category,",
      ...(campoSelects ? [campoSelects] : []),
      "  m.createdat",
      "FROM memos m",
      "WHERE",
      ...whereParts,
      "ORDER BY m.createdat DESC",
      "LIMIT 50",
    ].join("\n");

    const params: typeof pendingAutoParams = [
      { campo: "groupId", tipo: "number", obrigatorio: 0, operadorSql: "=", normalizar: 0, ordem: 0 },
      { campo: "userId",  tipo: "number", obrigatorio: 0, operadorSql: "=", normalizar: 0, ordem: 1 },
    ];
    activeCampos.forEach((campo, i) => {
      const p = toParamName(campo.name);
      if (!p) return;
      params.push({
        campo: p,
        tipo: "string",
        obrigatorio: 0,
        operadorSql: "LIKE",
        normalizar: campo.normalizedTerms ? 1 : 0,
        ordem: i + 2,
      });
    });

    setModalQueryNome(`Query padrão — ${cat.name}`);
    setModalQueryDescricao(`Query padrão para categoria "${cat.name}". Adapte os filtros conforme necessário.`);
    setModalQuerySentencaSql(sql);
    setPendingAutoParams(params);
  }

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
    setModalSaveError(null);
    if (!isQueryParamModal) {
      if (!modalName.trim()) { setModalSaveError("O campo Nome é obrigatório."); return; }
    } else if (modal === "query" || modal === "queryEdit") {
      if (!modalQueryNome.trim()) { setModalSaveError("O campo Nome da query é obrigatório."); return; }
      if (!modalQuerySentencaSql.trim()) { setModalSaveError("A sentença SQL é obrigatória."); return; }
    } else {
      if (!modalParamCampo.trim()) { setModalSaveError("O campo nome do parâmetro é obrigatório."); return; }
    }
    setModalSaveBusy(true);
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
        const { id: newQueryId } = await apiPostJson<{ id: number }>(
          `/api/memo-context/categories/${modalCategoryId}/queries`,
          {
            nome: modalQueryNome.trim(),
            descricao: modalQueryDescricao.trim() || null,
            sentencaSql: modalQuerySentencaSql.trim(),
            conexaoId: modalQueryConexaoId ?? null,
          }
        );
        for (const p of pendingAutoParams) {
          await apiPostJson(`/api/memo-context/queries/${newQueryId}/params`, p);
        }
      } else if (modal === "queryEdit" && modalQueryId != null) {
        await apiPatchJson(`/api/memo-context/queries/${modalQueryId}`, {
          nome: modalQueryNome.trim(),
          descricao: modalQueryDescricao.trim() || null,
          sentencaSql: modalQuerySentencaSql.trim(),
          conexaoId: modalQueryConexaoId ?? null,
        });
        const existingParamNames = new Set(
          categories.flatMap((c) => c.queries)
            .find((q) => q.id === modalQueryId)
            ?.params.map((p) => p.campo.toLowerCase()) ?? []
        );
        for (const p of pendingAutoParams) {
          if (!existingParamNames.has(p.campo.toLowerCase())) {
            await apiPostJson(`/api/memo-context/queries/${modalQueryId}/params`, p);
          }
        }
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
      setModalSaveError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setModalSaveBusy(false);
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
          {editorMeta?.isAdmin ? (
            <button
              type="button"
              className="mm-btn mm-btn--ghost"
              onClick={openCloneModal}
            >
              Clonar categorias para grupo
            </button>
          ) : null}
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
            if (e.target === e.currentTarget && modal !== "query" && modal !== "queryEdit") {
              setModal("none");
              resetModalState();
            }
          }}
        >
          <div
            className={`mm-modal${(modal === "query" || modal === "queryEdit") ? ` ${styles.sqlModal}` : ""}`}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
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
                  <textarea
                    id="mod-q-desc"
                    className="mm-field"
                    rows={4}
                    style={{ resize: "vertical" }}
                    value={modalQueryDescricao}
                    onChange={(e) => setModalQueryDescricao(e.target.value)}
                  />
                </div>
                <div className={styles.modalField}>
                  <label htmlFor="mod-q-sql">Sentença SQL</label>
                  <div className={styles.gerarQueryRow}>
                    {modal === "query" ? (
                      <button
                        type="button"
                        className="mm-btn mm-btn--ghost"
                        onClick={gerarQueryPadrao}
                        title="Gera SELECT padrão com filtros de groupId, userId, category e campos da categoria"
                      >
                        ✦ Gerar Query padrão
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="mm-btn mm-btn--ghost"
                      onClick={extrairParamsDoSql}
                      disabled={!modalQuerySentencaSql.trim()}
                      title="Detecta :param e @param no SQL e gera parâmetros automaticamente"
                    >
                      ⚡ Extrair parâmetros
                    </button>
                    {pendingAutoParams.length > 0 ? (
                      <span className={styles.gerarQueryHint}>
                        {pendingAutoParams.length} parâm. {modal === "queryEdit" ? "adicionados ao salvar" : "criados ao salvar"}
                      </span>
                    ) : null}
                  </div>
                  <textarea
                    id="mod-q-sql"
                    className="mm-field"
                    rows={18}
                    style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.78rem", resize: "vertical", minHeight: "18rem", whiteSpace: "pre-wrap", overflowWrap: "break-word", width: "100%" }}
                    value={modalQuerySentencaSql}
                    onChange={(e) => { setModalQuerySentencaSql(e.target.value); setPendingAutoParams([]); setSyntaxResult(null); }}
                    placeholder="SELECT * FROM tabela WHERE campo = :campo"
                  />
                  <div className={styles.syntaxCheckRow}>
                    <button
                      type="button"
                      className="mm-btn mm-btn--ghost"
                      onClick={checkSyntax}
                      disabled={syntaxBusy || !modalQuerySentencaSql.trim()}
                    >
                      {syntaxBusy ? "Verificando…" : "✓ Verificar sintaxe"}
                    </button>
                    {syntaxResult ? (
                      <span className={syntaxResult.ok ? styles.syntaxOk : styles.syntaxErr}>
                        {syntaxResult.ok ? "✓ " : "✗ "}{syntaxResult.message}
                      </span>
                    ) : null}
                  </div>
                  <p className={styles.fieldHelpSmall}>
                    Use <code>:nome_param</code> como placeholder para os parâmetros definidos abaixo.
                  </p>
                </div>
                <div className={styles.modalField}>
                  <label htmlFor="mod-q-conexao">Conexão BD externa</label>
                  <select
                    id="mod-q-conexao"
                    className="mm-field"
                    value={modalQueryConexaoId ?? ""}
                    onChange={(e) => setModalQueryConexaoId(e.target.value === "" ? null : Number(e.target.value))}
                  >
                    <option value="">— PostgreSQL interno (padrão) —</option>
                    {dbConnOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome} ({c.host}:{c.port}/{c.database})</option>
                    ))}
                  </select>
                  <p className={styles.fieldHelpSmall}>
                    Deixe em branco para usar o banco interno. Selecione uma conexão SQL Server para executar o query externamente.
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
                      <option value="lista_texto">lista_texto</option>
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

            {modalSaveError ? (
              <p className={styles.modalSaveError}>{modalSaveError}</p>
            ) : null}
            <div className={styles.rowActions}>
              <button
                type="button"
                className="mm-btn mm-btn--ghost"
                disabled={modalSaveBusy}
                onClick={() => {
                  setModal("none");
                  resetModalState();
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                disabled={modalSaveBusy}
                onClick={() => void submitModal()}
              >
                {modalSaveBusy ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cloneModalOpen ? (
        <div
          className="mm-modal-overlay"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget && !cloneBusy) { setCloneModalOpen(false); } }}
        >
          <div className="mm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "680px", width: "100%" }}>
            <h3 className={styles.cardTitle}>Clonar categorias globais para grupo</h3>
            <p className="mm-muted" style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
              Selecione as categorias globais a clonar e o grupo destino. As queries serão copiadas sem conexão BD (configure depois no grupo destino).
            </p>

            {/* Seletor de grupo destino */}
            <div style={{ marginBottom: "1rem" }}>
              <label htmlFor="clone-group" style={{ display: "block", fontWeight: 600, marginBottom: "0.3rem", fontSize: "0.875rem" }}>
                Grupo destino
              </label>
              <select
                id="clone-group"
                className="mm-field"
                value={cloneTargetGroupId === null ? "" : String(cloneTargetGroupId)}
                onChange={(e) => setCloneTargetGroupId(e.target.value === "" ? null : Number(e.target.value))}
                disabled={cloneBusy}
              >
                <option value="">— Selecione o grupo —</option>
                {groupOptionsForClone.map((g) => (
                  <option key={g.id} value={String(g.id)}>[{g.id}] {g.name}</option>
                ))}
              </select>
            </div>

            {/* Tabela de categorias globais */}
            {cloneCatsLoading ? (
              <p className="mm-muted">Carregando categorias…</p>
            ) : cloneGlobalCats.length === 0 ? (
              <p className="mm-muted">Nenhuma categoria global encontrada.</p>
            ) : (
              <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "0.4rem 0.6rem", textAlign: "left", borderBottom: "2px solid var(--mm-border, #e0e0e0)" }}>
                        <input
                          type="checkbox"
                          checked={cloneSelected.size === cloneGlobalCats.length && cloneGlobalCats.length > 0}
                          onChange={(e) => setCloneSelected(e.target.checked ? new Set(cloneGlobalCats.map((c) => c.id)) : new Set())}
                          title="Selecionar todas"
                        />
                      </th>
                      <th style={{ padding: "0.4rem 0.6rem", textAlign: "left", borderBottom: "2px solid var(--mm-border, #e0e0e0)" }}>Nome</th>
                      <th style={{ padding: "0.4rem 0.6rem", textAlign: "left", borderBottom: "2px solid var(--mm-border, #e0e0e0)" }}>Mídia</th>
                      <th style={{ padding: "0.4rem 0.6rem", textAlign: "right", borderBottom: "2px solid var(--mm-border, #e0e0e0)" }}>Campos</th>
                      <th style={{ padding: "0.4rem 0.6rem", textAlign: "right", borderBottom: "2px solid var(--mm-border, #e0e0e0)" }}>Queries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cloneGlobalCats.map((cat) => (
                      <tr key={cat.id} style={{ cursor: "pointer" }} onClick={() => setCloneSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
                        return next;
                      })}>
                        <td style={{ padding: "0.35rem 0.6rem" }}>
                          <input type="checkbox" checked={cloneSelected.has(cat.id)} onChange={() => {}} onClick={(e) => e.stopPropagation()} readOnly />
                        </td>
                        <td style={{ padding: "0.35rem 0.6rem", fontWeight: cloneSelected.has(cat.id) ? 600 : undefined }}>{cat.name}</td>
                        <td style={{ padding: "0.35rem 0.6rem", color: "var(--mm-muted, #666)" }}>{mediaLabel(cat.mediaType ?? null)}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right" }}>{cat.campos.length}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right" }}>{(cat.queries ?? []).length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {cloneResult ? (
              <p style={{ marginBottom: "0.75rem", color: cloneResult.ok ? "var(--color-success, green)" : "var(--color-danger, #c00)", fontWeight: 600 }}>
                {cloneResult.msg}
              </p>
            ) : null}

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button type="button" className="mm-btn mm-btn--ghost" disabled={cloneBusy} onClick={() => setCloneModalOpen(false)}>
                {cloneResult?.ok ? "Fechar" : "Cancelar"}
              </button>
              {!cloneResult?.ok ? (
                <button
                  type="button"
                  className="mm-btn mm-btn--primary"
                  disabled={cloneBusy || cloneSelected.size === 0 || cloneTargetGroupId == null}
                  onClick={submitClone}
                >
                  {cloneBusy ? "Clonando…" : `Clonar ${cloneSelected.size > 0 ? `(${cloneSelected.size})` : "selecionadas"}`}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
