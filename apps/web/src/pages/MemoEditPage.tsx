import { useCallback, useEffect, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { MeResponse, MemoAuthorEditResponse, PatchMemoResponse } from "@mymemory/shared";
import { dedupeMemoKeywordsCommaSeparated } from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPatchJson } from "../api";
import { useCategoryOptions } from "../hooks/useCategoryOptions";
import Header from "../components/Header";
import { MemoDadosJsonField } from "../memo/MemoDadosJsonField";
import styles from "./MemoEditPage.module.css";

const typeLabel: Record<string, string> = {
  text: "Texto",
  audio: "Áudio",
  image: "Imagem",
  video: "Vídeo",
  document: "Documento",
  url: "URL",
};

/** Evita open redirect: só caminhos relativos internos. */
function safeReturnPath(raw: unknown): string {
  if (raw == null || typeof raw !== "string") return "/";
  const s = raw.trim();
  if (!s.startsWith("/") || s.startsWith("//")) return "/";
  return s;
}

function pathnameOnlyFromDest(destination: string): string {
  const s = destination.trim();
  const q = s.indexOf("?");
  return (q >= 0 ? s.slice(0, q) : s) || "/";
}

/** Volta para a origem (home, busca, …); após salvar, refresca memos recentes só quando a origem é a home. */
function leaveMemoEdit(navigate: NavigateFunction, destination: string, afterSave: boolean) {
  const pathOnly = pathnameOnlyFromDest(destination);
  if (pathOnly === "/buscar") {
    try {
      sessionStorage.setItem("mm_buscar_restore_pending", "1");
    } catch {
      /* */
    }
    navigate(destination, { replace: true });
    return;
  }
  navigate(destination, {
    replace: true,
    state: afterSave && pathOnly === "/" ? { memoSavedAt: Date.now() } : {},
  });
}

function formatMetadataDisplay(raw: string | null): string {
  if (!raw?.trim()) return "";
  try {
    const j = JSON.parse(raw) as unknown;
    return JSON.stringify(j, null, 2);
  } catch {
    return raw;
  }
}

export default function MemoEditPage() {
  const { id: idParam } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const stateReturnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  const queryReturnTo = new URLSearchParams(location.search).get("returnTo");
  const cancelTo = safeReturnPath(stateReturnTo ?? queryReturnTo);
  const memoId = Number(idParam);
  const validId = Number.isFinite(memoId) && memoId > 0;

  const [memo, setMemo] = useState<MemoAuthorEditResponse | null>(null);
  const [mediaText, setMediaText] = useState("");
  const [keywords, setKeywords] = useState("");
  const [dadosEspecificosJson, setDadosEspecificosJson] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedCategoryName, setSelectedCategoryName] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApiCost, setShowApiCost] = useState(true);
  const [credMult, setCredMult] = useState(100);
  const [showStorageModal, setShowStorageModal] = useState(false);

  const loadMemo = useCallback(() => {
    if (!validId) {
      setLoadErr("Identificador de memo inválido.");
      return;
    }
    setLoadErr(null);
    apiGet<MemoAuthorEditResponse>(`/api/memos/${memoId}`)
      .then((m) => {
        setMemo(m);
        setMediaText(m.mediaText ?? "");
        setKeywords(dedupeMemoKeywordsCommaSeparated(m.keywords ?? ""));
        setDadosEspecificosJson(m.dadosEspecificosJson ?? "");
        setSelectedCategoryName(m.category ?? null);
        setSelectedCategoryId(null);
      })
      .catch((e) => {
        const t = e instanceof Error ? e.message : "";
        if (t.includes("403") || t.includes("forbidden")) {
          setLoadErr("Você não tem permissão para editar este memo.");
        } else if (t.includes("404") || t.includes("not_found")) {
          setLoadErr("Memo não encontrado.");
        } else {
          setLoadErr("Não foi possível carregar o memo.");
        }
        setMemo(null);
      });
  }, [memoId, validId]);

  useEffect(() => {
    loadMemo();
  }, [loadMemo]);

  const categoryOptions = useCategoryOptions(memo?.groupId ?? null);

  useEffect(() => {
    if (!selectedCategoryName || selectedCategoryId !== null || categoryOptions.length === 0) return;
    const match = categoryOptions.find((c) => c.name === selectedCategoryName);
    if (match) setSelectedCategoryId(match.id);
  }, [categoryOptions, selectedCategoryName, selectedCategoryId]);

  useEffect(() => {
    void apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (!r.ok) return;
      if (r.data.showApiCost === false) setShowApiCost(false);
      const m = r.data.usdToCreditsMultiplier;
      if (typeof m === "number" && Number.isFinite(m) && m > 0) setCredMult(m);
    });
  }, []);

  const onSave = async () => {
    if (!validId || !mediaText.trim()) {
      setError("Informe o texto do memo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPatchJson<PatchMemoResponse>(`/api/memos/${memoId}`, {
        mediaText: mediaText.trim(),
        keywords: keywords.trim() || null,
        dadosEspecificosJson: dadosEspecificosJson.trim() || null,
        category: selectedCategoryName,
      });
      leaveMemoEdit(navigate, cancelTo, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  };

  if (!validId) {
    return (
      <>
        <Header />
        <div className={styles.page}>
          <p>Memo inválido.</p>
        </div>
      </>
    );
  }

  if (loadErr) {
    return (
      <>
        <Header />
        <div className={styles.page}>
          <p>{loadErr}</p>
        </div>
      </>
    );
  }

  if (!memo) {
    return (
      <>
        <Header />
        <div className={styles.page}>
          <p>Carregando…</p>
        </div>
      </>
    );
  }

  const metaStr = formatMetadataDisplay(memo.mediaMetadata);
  const hasCost = memo.apiCost > 0 || memo.usedApiCred > 0;
  const creditsDisplay =
    memo.usedApiCred > 0
      ? memo.usedApiCred.toFixed(6)
      : memo.apiCost > 0
        ? (Math.round(memo.apiCost * credMult * 1e6) / 1e6).toFixed(6)
        : null;

  return (
    <>
      <Header />
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Editar memo #{memo.id}</h1>
            <p className={styles.meta}>
              Tipo: {typeLabel[memo.mediaType] ?? memo.mediaType}
              {memo.createdAt
                ? ` · Criado em ${new Date(memo.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
                : null}
              {showApiCost && hasCost ? (
                <>
                  {" "}
                  · Custo API (USD): {memo.apiCost.toFixed(6)}
                  {creditsDisplay ? ` · Créditos: ${creditsDisplay}` : null}
                  {memo.usedApiCred <= 0 && memo.apiCost > 0 ? " (estimativa pelo fator atual)" : null}
                </>
              ) : null}
            </p>
          </div>
          {memo.storageProvider && (
            <button
              type="button"
              className={styles.storageBadge}
              onClick={() => setShowStorageModal(true)}
              title="Ver local de armazenamento"
            >
              {memo.storageProvider}
            </button>
          )}
        </header>

        {showStorageModal && (
          <div className={styles.modalOverlay} onClick={() => setShowStorageModal(false)}>
            <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
              <h3 className={styles.modalTitle}>Armazenamento do arquivo</h3>
              <dl className={styles.modalDl}>
                <dt>Provedor</dt>
                <dd>{memo.storageProvider ?? "—"}</dd>
                {memo.originalFileName && <><dt>Arquivo original</dt><dd>{memo.originalFileName}</dd></>}
                {memo.externalFileRef && <><dt>Localização</dt><dd className={styles.modalUrl}>{memo.externalFileRef}</dd></>}
              </dl>
              <button type="button" className={styles.modalClose} onClick={() => setShowStorageModal(false)}>Fechar</button>
            </div>
          </div>
        )}

      <section className={`${styles.panel} ${styles.gridFullWidth}`} style={{ marginBottom: "1.25rem" }}>
        <h2 className={styles.panelTitle}>Metadados do arquivo / registro</h2>
        <p className={styles.hint}>Coluna mediaMetadata (somente leitura).</p>
        {metaStr ? <pre className={styles.metadataPre}>{metaStr}</pre> : <p className={styles.metadataEmpty}>Nenhum metadado gravado.</p>}
      </section>

      <div className={styles.grid}>
        <label className={`${styles.fieldLabel} ${styles.gridFullWidth}`} htmlFor="memo-edit-body">
          Texto do memo
          <span className={styles.hint}>Corpo principal (coluna mediaText).</span>
          <textarea
            id="memo-edit-body"
            className={styles.textarea}
            value={mediaText}
            onChange={(e) => setMediaText(e.target.value)}
          />
        </label>

        <label className={`${styles.fieldLabel} ${styles.gridFullWidth}`} htmlFor="memo-edit-kw">
          Palavras-chave
          <span className={styles.hint}>Separe por vírgula.</span>
          <textarea
            id="memo-edit-kw"
            className={styles.keywordsInput}
            rows={2}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="ex.: reunião, projeto"
            autoComplete="off"
          />
        </label>

        <label className={`${styles.fieldLabel} ${styles.gridFullWidth}`} htmlFor="memo-edit-category">
          Categoria
          <span className={styles.hint}>Categoria do memo (opcional).</span>
          <select
            id="memo-edit-category"
            className={styles.categorySelect}
            value={selectedCategoryId ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) {
                setSelectedCategoryId(null);
                setSelectedCategoryName(null);
              } else {
                const id = Number(val);
                const cat = categoryOptions.find((c) => c.id === id);
                setSelectedCategoryId(id);
                setSelectedCategoryName(cat?.name ?? null);
              }
            }}
          >
            <option value="">Sem categoria</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className={`${styles.fieldLabel} ${styles.gridFullWidth}`} htmlFor="memo-edit-dados">
          Dados específicos
          <span className={styles.hint}>JSON de campos específicos (chave: valor). Chaves em cinza, valores em verde.</span>
          <MemoDadosJsonField
            id="memo-edit-dados"
            rows={4}
            value={dadosEspecificosJson}
            onChange={setDadosEspecificosJson}
            placeholder='ex.: {"CNPJ Emitente":"76.500.180/0001-32"}'
          />
        </label>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.actions}>
        <button type="button" className="mm-btn mm-btn--primary" disabled={busy || !mediaText.trim()} onClick={() => void onSave()}>
          {busy ? "Salvando…" : "Salvar alterações"}
        </button>
        <button type="button" className="mm-btn mm-btn--ghost" onClick={() => leaveMemoEdit(navigate, cancelTo, false)}>
          Cancelar
        </button>
      </div>
      </div>
    </>
  );
}
