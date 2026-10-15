import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  BatchFileVerifyResult,
  BatchVerifyResponse,
  BatchProcessResponse,
  StorageProvider,
  MeResponse,
  BatchProcessJobStatus,
  BatchProcessStartResponse,
} from "@mymemory/shared";
import { BATCH_FILE_SITUACAO_LABELS } from "@mymemory/shared";
import { apiGet, apiPostJson, apiPostMultipart } from "../api";
import Header from "../components/Header";
import { BatchFilePreviewModal } from "../components/BatchFilePreviewModal";
import styles from "./BatchImportPage.module.css";

interface StorageConfigOption {
  id: number;
  label: string;
  url: string;
  pathPrefix: string | null;
  isDefault: boolean;
}

type IaLevel = "semIA" | "basico" | "completo";

// emBreve: origem em quarentena — aparece desabilitada. OneDrive/Google Drive não têm integração real
// (seletor comum do navegador, grava só o nome do arquivo, memo fica sem vínculo com o original).
const PROVIDER_OPTIONS: { value: StorageProvider; label: string; hint: string; emBreve?: boolean }[] = [
  { value: "LOCAL",        label: "Disco Local",    hint: "Pasta no servidor (ex.: C:\\Documentos)" },
  { value: "REDE",         label: "Rede Local",     hint: "Caminho UNC (ex.: \\\\servidor\\pasta)" },
  { value: "WEBDAV",       label: "WebDAV",         hint: "URL do servidor WebDAV (ex.: http://192.168.1.10:19401)" },
  { value: "ONEDRIVE",     label: "OneDrive",       hint: "Disponível em breve", emBreve: true },
  { value: "GOOGLE_DRIVE", label: "Google Drive",   hint: "Disponível em breve", emBreve: true },
  { value: "URL",          label: "URL Externa",    hint: "Disponível em breve", emBreve: true },
];

const IA_OPTIONS: { value: IaLevel; label: string; desc: string }[] = [
  { value: "semIA",    label: "Sem IA",    desc: "Texto bruto + [Edição Pendente]" },
  { value: "basico",   label: "Básico",    desc: "Palavras-chave + categoria" },
  { value: "completo", label: "Completo",  desc: "Campos estruturados" },
];

const LOCAL_PROVIDERS: StorageProvider[] = ["LOCAL", "REDE", "WEBDAV"];
const UPLOAD_PROVIDERS: StorageProvider[] = ["ONEDRIVE", "GOOGLE_DRIVE"];

function situacaoBadgeClass(s: BatchFileVerifyResult["situacao"]): string {
  if (s === "pronto") return styles.badgeOk;
  if (s === "ja_cadastrado" || s === "suspeito_duplicidade") return styles.badgeWarn;
  return styles.badgeErr;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function BatchImportPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [provider, setProvider] = useState<StorageProvider>("LOCAL");
  const [folderPath, setFolderPath] = useState("");
  const [iaLevel, setIaLevel] = useState<IaLevel>("semIA");
  const [webdavConfigs, setWebdavConfigs] = useState<StorageConfigOption[]>([]);
  const [selectedWebdavId, setSelectedWebdavId] = useState<number | null>(null);

  useEffect(() => {
    apiGet<MeResponse>("/api/me").then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    if (me) setIaLevel(me.iaUseDocumento ?? me.iaUseTexto ?? "semIA");
  }, [me]);

  const workspaceGroupId = me?.lastWorkspaceGroupId ?? null;
  const workspaceLabel = workspaceGroupId != null ? me?.groupLabel ?? "Grupo" : "Pessoal";

  // Carrega configs WebDAV do grupo ativo quando WEBDAV é selecionado
  useEffect(() => {
    if (provider !== "WEBDAV" || workspaceGroupId == null) {
      setWebdavConfigs([]);
      setSelectedWebdavId(null);
      return;
    }
    apiGet<{ configs: StorageConfigOption[] }>(`/api/groups/${workspaceGroupId}/storage-configs`)
      .then(res => {
        const webdav = res.configs;
        setWebdavConfigs(webdav);
        const def = webdav.find(c => c.isDefault) ?? webdav[0] ?? null;
        setSelectedWebdavId(def?.id ?? null);
        if (def) {
          const base = def.url.replace(/\/$/, "");
          const prefix = def.pathPrefix?.trim() ?? "";
          const sep = prefix && !prefix.startsWith("/") ? "/" : "";
          setFolderPath(prefix ? `${base}${sep}${prefix}` : base);
        }
      })
      .catch(() => {});
  }, [provider, workspaceGroupId]);

  const [verifyResult, setVerifyResult] = useState<BatchVerifyResponse | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [hideJaCadastrado, setHideJaCadastrado] = useState(true);
  const [previewFile, setPreviewFile] = useState<BatchFileVerifyResult | null>(null);

  const [processResult, setProcessResult] = useState<BatchProcessResponse | null>(null);
  const [processLoading, setProcessLoading] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processProgress, setProcessProgress] = useState<{ done: number; total: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLocal = LOCAL_PROVIDERS.includes(provider);
  const isUpload = UPLOAD_PROVIDERS.includes(provider);
  const currentHint = PROVIDER_OPTIONS.find(p => p.value === provider)?.hint ?? "";

  // Importáveis (pronto/suspeito) e, entre eles, os marcados com tic (todos marcados por padrão após Verificar)
  const importableFiles = verifyResult?.files.filter(
    f => f.situacao === "pronto" || f.situacao === "suspeito_duplicidade"
  ) ?? [];
  const readyFiles = importableFiles.filter(f => selected.has(f.fullPath));
  const allSelected = importableFiles.length > 0 && readyFiles.length === importableFiles.length;
  const hasErrors = verifyResult?.files.some(
    f => f.situacao !== "pronto" && f.situacao !== "suspeito_duplicidade"
  ) ?? false;
  const canProcess = readyFiles.length > 0 && !processResult;

  // ── Verificar ─────────────────────────────────────────────────────────────

  /** Marca com tic todos os arquivos importáveis (pronto/suspeito) de um resultado de verificação. */
  function selectAllImportable(result: BatchVerifyResponse) {
    setSelected(new Set(
      result.files
        .filter(f => f.situacao === "pronto" || f.situacao === "suspeito_duplicidade")
        .map(f => f.fullPath)
    ));
  }

  function toggleFile(fullPath: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(importableFiles.map(f => f.fullPath)));
  }

  async function handleVerify() {
    setSelected(new Set());
    setVerifyError(null);
    setVerifyResult(null);
    setProcessResult(null);
    setVerifyLoading(true);
    try {
      if (isLocal) {
        const result = await apiPostJson<BatchVerifyResponse>(
          "/api/memos/batch/verify/local",
          { provider, folderPath: folderPath.trim(), iaLevel, groupId: workspaceGroupId }
        );
        setVerifyResult(result);
        selectAllImportable(result);
      } else if (isUpload) {
        const files = fileInputRef.current?.files;
        if (!files?.length) { setVerifyError("Selecione ao menos um arquivo."); return; }
        const form = new FormData();
        form.append("provider", provider);
        for (const f of Array.from(files)) form.append("files", f);
        const result = (await apiPostMultipart("/api/memos/batch/verify/upload", form)) as BatchVerifyResponse;
        setVerifyResult(result);
        selectAllImportable(result);
      } else {
        setVerifyError("Provider não suportado para verificação.");
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyLoading(false);
    }
  }

  // ── Processar ─────────────────────────────────────────────────────────────

  /**
   * O servidor processa em segundo plano (evita o timeout de 120 s do proxy). Aqui só acompanhamos
   * o progresso; falha transitória de rede na consulta não derruba o lote, que continua no servidor.
   */
  async function waitForJob(jobId: string, total: number): Promise<BatchProcessResponse> {
    let falhasSeguidas = 0;
    for (;;) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const st = await apiGet<BatchProcessJobStatus>(`/api/memos/batch/process/status/${jobId}`);
        falhasSeguidas = 0;
        setProcessProgress({ done: st.processed, total: st.totalRequested || total });
        if (st.finished) return st;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("job_not_found")) {
          throw new Error(
            "O servidor perdeu o acompanhamento deste lote (provável reinício). Rode Verificar de novo: o que já foi importado aparece como \"Já cadastrado\"."
          );
        }
        if (++falhasSeguidas >= 15) throw new Error("Sem resposta do servidor ao acompanhar o lote. Rode Verificar para ver o que já foi importado.");
      }
    }
  }

  async function handleProcess() {
    if (!verifyResult || !canProcess) return;
    setProcessError(null);
    setProcessResult(null);
    setProcessProgress(null);
    setProcessLoading(true);
    try {
      let start: BatchProcessStartResponse | null = null;
      if (isLocal) {
        start = await apiPostJson<BatchProcessStartResponse>(
          "/api/memos/batch/process/local",
          { provider, folderPath: folderPath.trim(), iaLevel, groupId: workspaceGroupId, onlyFileNames: readyFiles.map(f => f.originalFileName), onlyFullPaths: readyFiles.map(f => f.fullPath) }
        );
      } else if (isUpload) {
        const files = fileInputRef.current?.files;
        if (!files?.length) return;
        const form = new FormData();
        form.append("provider", provider);
        form.append("iaLevel", iaLevel);
        if (workspaceGroupId != null) form.append("groupId", String(workspaceGroupId));
        form.append("onlyFileNames", JSON.stringify(readyFiles.map(f => f.originalFileName)));
        for (const f of Array.from(files)) {
          if (readyFiles.some(r => r.originalFileName === f.name)) form.append("files", f);
        }
        start = (await apiPostMultipart("/api/memos/batch/process/upload", form)) as BatchProcessStartResponse;
      }
      if (start) {
        setProcessProgress({ done: 0, total: start.totalRequested });
        setProcessResult(await waitForJob(start.jobId, start.totalRequested));
      }
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessLoading(false);
      setProcessProgress(null);
    }
  }

  const busy = verifyLoading || processLoading;

  return (
    <div className={styles.shell}>
      <Header />
      <main className={styles.main}>

        {/* ── Cabeçalho ── */}
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.title}>Importação em Lote</h1>
            <p className={styles.subtitle}>
              Registre arquivos externos sem copiá-los para a nuvem.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
            <Link to="/" className={styles.backLink}>← Início</Link>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted, #888)" }}>
              Destino: <strong>{workspaceLabel}</strong>
            </span>
          </div>
        </div>

        {/* ── Card de configuração ── */}
        <div className={styles.card}>

          {/* Linha 1: Origem + caminho/arquivos */}
          <div className={`${styles.row} ${styles.rowTop}`}>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="provider">Origem</label>
              <select
                id="provider"
                className={styles.select}
                value={provider}
                onChange={e => {
                  setProvider(e.target.value as StorageProvider);
                  setVerifyResult(null);
                  setProcessResult(null);
                }}
              >
                {PROVIDER_OPTIONS.map(o => (
                  <option key={o.value} value={o.value} disabled={o.emBreve}>
                    {o.emBreve ? `${o.label} (em breve)` : o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.fieldGroupFlex}>
              {isLocal && provider === "WEBDAV" && webdavConfigs.length > 0 && (
                <>
                  <label className={styles.label} htmlFor="webdavConfig">Servidor WebDAV</label>
                  <select
                    id="webdavConfig"
                    className={styles.select}
                    value={selectedWebdavId ?? ""}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === "") {
                        setSelectedWebdavId(null);
                        setFolderPath("");
                      } else {
                        const id = Number(val);
                        setSelectedWebdavId(id);
                        const cfg = webdavConfigs.find(c => c.id === id);
                        if (cfg) {
                          const base = cfg.url.replace(/\/$/, "");
                          const prefix = cfg.pathPrefix?.trim() ?? "";
                          const sep = prefix && !prefix.startsWith("/") ? "/" : "";
                          setFolderPath(prefix ? `${base}${sep}${prefix}` : base);
                        }
                      }
                      setVerifyResult(null);
                      setProcessResult(null);
                    }}
                  >
                    <option value="">— Digitar manualmente —</option>
                    {webdavConfigs.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </>
              )}
              {isLocal && (
                <>
                  <label className={styles.label} htmlFor="folderPath">Caminho da pasta</label>
                  <div className={styles.inputWithHint}>
                    <input
                      id="folderPath"
                      type="text"
                      className={styles.input}
                      placeholder={currentHint}
                      value={folderPath}
                      onChange={e => { setFolderPath(e.target.value); setVerifyResult(null); setProcessResult(null); }}
                    />
                  </div>
                </>
              )}
              {isUpload && (
                <>
                  <label className={styles.label} htmlFor="fileInput">Arquivos</label>
                  <input
                    id="fileInput"
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className={styles.fileInput}
                    onChange={() => { setVerifyResult(null); setProcessResult(null); }}
                  />
                  <span className={styles.hint}>{currentHint}</span>
                </>
              )}
              {!isLocal && !isUpload && (
                <p className={styles.hint}>{currentHint}</p>
              )}
            </div>
          </div>

          {/* Linha 2: Modo IA + botões */}
          <div className={styles.row}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Modo de processamento</label>
              <div className={styles.iaRow}>
                {IA_OPTIONS.map(opt => (
                  <label key={opt.value} className={`${styles.iaOption} ${iaLevel === opt.value ? styles.iaOptionActive : ""}`}>
                    <input
                      type="radio"
                      name="iaLevel"
                      value={opt.value}
                      checked={iaLevel === opt.value}
                      onChange={() => setIaLevel(opt.value)}
                      className={styles.iaRadio}
                    />
                    <span className={styles.iaLabel}>{opt.label}</span>
                    <span className={styles.iaDesc}>{opt.desc}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.btnGroup}>
              <button
                type="button"
                className={styles.btnVerify}
                onClick={handleVerify}
                disabled={busy || (isLocal && !folderPath.trim())}
              >
                {verifyLoading ? "Verificando…" : "Verificar"}
              </button>
              <button
                type="button"
                className={canProcess && !hasErrors ? styles.btnProcessOk : canProcess ? styles.btnProcessWarn : styles.btnProcessDisabled}
                onClick={handleProcess}
                disabled={!canProcess || busy}
              >
                {processLoading ? (processProgress ? `Processando ${processProgress.done}/${processProgress.total}…` : "Processando…") : `Processar${readyFiles.length > 0 ? ` (${readyFiles.length})` : ""}`}
              </button>
            </div>
          </div>

          {(verifyError || processError) && (
            <p className={styles.error}>{verifyError ?? processError}</p>
          )}
        </div>

        {/* ── Tabela de verificação ── */}
        {verifyResult && (
          <div className={styles.card}>
            <div className={styles.tableHead}>
              <span className={styles.tableTitle}>Pré-verificação</span>
              <span className={styles.tableSummary}>
                <span className={styles.countOk}>{verifyResult.files.filter(f => f.situacao === "pronto").length} prontos</span>
                {verifyResult.files.filter(f => f.situacao === "suspeito_duplicidade").length > 0 && (
                  <span className={styles.countWarn}>{verifyResult.files.filter(f => f.situacao === "suspeito_duplicidade").length} suspeitos</span>
                )}
                {verifyResult.files.filter(f => f.situacao === "ja_cadastrado").length > 0 && (
                  <span className={styles.countWarn}>{verifyResult.files.filter(f => f.situacao === "ja_cadastrado").length} já cadastrados</span>
                )}
                {verifyResult.files.filter(f => f.situacao !== "pronto" && f.situacao !== "suspeito_duplicidade" && f.situacao !== "ja_cadastrado").length > 0 && (
                  <span className={styles.countErr}>{verifyResult.files.filter(f => f.situacao !== "pronto" && f.situacao !== "suspeito_duplicidade" && f.situacao !== "ja_cadastrado").length} bloqueados</span>
                )}
                <label className={styles.filterToggle}>
                  <input
                    type="checkbox"
                    checked={hideJaCadastrado}
                    onChange={e => setHideJaCadastrado(e.target.checked)}
                  />
                  Ocultar já cadastrados
                </label>
              </span>
            </div>

            {verifyResult.files.length === 0 ? (
              <p className={styles.hint}>Nenhum arquivo encontrado na pasta.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = readyFiles.length > 0 && !allSelected; }}
                          onChange={toggleAll}
                          disabled={importableFiles.length === 0 || busy}
                          title={allSelected ? "Desmarcar todos" : "Marcar todos"}
                          aria-label="Marcar ou desmarcar todos os arquivos importáveis"
                        />
                      </th>
                      <th>Nome</th>
                      <th>Tipo</th>
                      <th>Tamanho</th>
                      <th>Situação</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verifyResult.files.filter(f => !(hideJaCadastrado && f.situacao === "ja_cadastrado")).map(f => (
                      <tr key={f.fullPath}>
                        <td>
                          {(f.situacao === "pronto" || f.situacao === "suspeito_duplicidade") && (
                            <input
                              type="checkbox"
                              checked={selected.has(f.fullPath)}
                              onChange={() => toggleFile(f.fullPath)}
                              disabled={busy || !!processResult}
                              aria-label={`Importar ${f.originalFileName}`}
                            />
                          )}
                        </td>
                        <td className={styles.nameCell} title={f.fullPath}>
                          {isLocal ? (
                            <button
                              type="button"
                              className={styles.nameLink}
                              onClick={() => setPreviewFile(f)}
                              title="Clique para visualizar"
                            >
                              {f.originalFileName}
                            </button>
                          ) : (
                            f.originalFileName
                          )}
                        </td>
                        <td>{f.mediaType ?? "—"}</td>
                        <td>{formatBytes(f.sizeBytes)}</td>
                        <td><span className={`${styles.badge} ${situacaoBadgeClass(f.situacao)}`}>{BATCH_FILE_SITUACAO_LABELS[f.situacao]}</span></td>
                        <td className={styles.motivoCell}>{f.motivo ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className={styles.creditBar}>
              <span>Estimativa — Sem IA: <strong>{verifyResult.creditEstimate.semIA}</strong> · Básico: <strong>{verifyResult.creditEstimate.basico}</strong> · Completo: <strong>{verifyResult.creditEstimate.completo}</strong> créditos</span>
            </div>
          </div>
        )}

        {/* ── Resultado do processamento ── */}
        {processResult && (
          <div className={styles.card}>
            <div className={styles.resultBar}>
              <span className={styles.resultOk}>✓ {processResult.totalCreated} criado{processResult.totalCreated !== 1 ? "s" : ""}</span>
              {processResult.totalErrors > 0 && (
                <span className={styles.resultErr}>✗ {processResult.totalErrors} erro{processResult.totalErrors !== 1 ? "s" : ""}</span>
              )}
              <Link to="/" className={styles.resultLink}>Ver memos →</Link>
            </div>
            {processResult.results.some(r => !r.ok) && (
              <ul className={styles.errorList}>
                {processResult.results.filter(r => !r.ok).map(r => (
                  <li key={r.originalFileName}><strong>{r.originalFileName}</strong>: {r.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}

      </main>

      {previewFile && isLocal ? (
        <BatchFilePreviewModal
          file={previewFile}
          provider={provider}
          onClose={() => setPreviewFile(null)}
        />
      ) : null}
    </div>
  );
}
