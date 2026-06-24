import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  BatchFileVerifyResult,
  BatchVerifyResponse,
  BatchProcessResponse,
  StorageProvider,
  MeResponse,
} from "@mymemory/shared";
import { BATCH_FILE_SITUACAO_LABELS } from "@mymemory/shared";
import { apiGet, apiPostJson, apiPostMultipart } from "../api";
import Header from "../components/Header";
import styles from "./BatchImportPage.module.css";

type IaLevel = "semIA" | "basico" | "completo";

const PROVIDER_OPTIONS: { value: StorageProvider; label: string; hint: string }[] = [
  { value: "LOCAL",        label: "Disco Local",    hint: "Pasta no servidor (ex.: C:\\Documentos)" },
  { value: "REDE",         label: "Rede Local",     hint: "Caminho UNC (ex.: \\\\servidor\\pasta)" },
  { value: "WEBDAV",       label: "WebDAV",         hint: "URL do servidor WebDAV (ex.: http://192.168.1.10:19401)" },
  { value: "ONEDRIVE",     label: "OneDrive",       hint: "Selecione os arquivos do OneDrive" },
  { value: "GOOGLE_DRIVE", label: "Google Drive",   hint: "Selecione os arquivos do Google Drive" },
  { value: "URL",          label: "URL Externa",    hint: "Disponível em breve" },
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

  useEffect(() => {
    apiGet<MeResponse>("/api/me").then(setMe).catch(() => {});
  }, []);

  const workspaceGroupId = me?.lastWorkspaceGroupId ?? null;
  const workspaceLabel = workspaceGroupId != null ? me?.groupLabel ?? "Grupo" : "Pessoal";

  const [verifyResult, setVerifyResult] = useState<BatchVerifyResponse | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [processResult, setProcessResult] = useState<BatchProcessResponse | null>(null);
  const [processLoading, setProcessLoading] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLocal = LOCAL_PROVIDERS.includes(provider);
  const isUpload = UPLOAD_PROVIDERS.includes(provider);
  const currentHint = PROVIDER_OPTIONS.find(p => p.value === provider)?.hint ?? "";

  const readyFiles = verifyResult?.files.filter(
    f => f.situacao === "pronto" || f.situacao === "suspeito_duplicidade"
  ) ?? [];
  const hasErrors = verifyResult?.files.some(
    f => f.situacao !== "pronto" && f.situacao !== "suspeito_duplicidade"
  ) ?? false;
  const canProcess = readyFiles.length > 0 && !processResult;

  // ── Verificar ─────────────────────────────────────────────────────────────

  async function handleVerify() {
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
      } else if (isUpload) {
        const files = fileInputRef.current?.files;
        if (!files?.length) { setVerifyError("Selecione ao menos um arquivo."); return; }
        const form = new FormData();
        form.append("provider", provider);
        for (const f of Array.from(files)) form.append("files", f);
        setVerifyResult((await apiPostMultipart("/api/memos/batch/verify/upload", form)) as BatchVerifyResponse);
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

  async function handleProcess() {
    if (!verifyResult || !canProcess) return;
    setProcessError(null);
    setProcessResult(null);
    setProcessLoading(true);
    try {
      if (isLocal) {
        const result = await apiPostJson<BatchProcessResponse>(
          "/api/memos/batch/process/local",
          { provider, folderPath: folderPath.trim(), iaLevel, groupId: workspaceGroupId, onlyFileNames: readyFiles.map(f => f.originalFileName) }
        );
        setProcessResult(result);
      } else if (isUpload) {
        const files = fileInputRef.current?.files;
        if (!files?.length) return;
        const form = new FormData();
        form.append("provider", provider);
        form.append("iaLevel", iaLevel);
        form.append("onlyFileNames", JSON.stringify(readyFiles.map(f => f.originalFileName)));
        for (const f of Array.from(files)) {
          if (readyFiles.some(r => r.originalFileName === f.name)) form.append("files", f);
        }
        setProcessResult((await apiPostMultipart("/api/memos/batch/process/upload", form)) as BatchProcessResponse);
      }
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessLoading(false);
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
          <div className={styles.row}>
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
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className={styles.fieldGroupFlex}>
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
                      onChange={e => setFolderPath(e.target.value)}
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
                {processLoading ? "Processando…" : `Processar${readyFiles.length > 0 ? ` (${readyFiles.length})` : ""}`}
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
                {verifyResult.files.filter(f => f.situacao !== "pronto" && f.situacao !== "suspeito_duplicidade").length > 0 && (
                  <span className={styles.countErr}>{verifyResult.files.filter(f => f.situacao !== "pronto" && f.situacao !== "suspeito_duplicidade").length} bloqueados</span>
                )}
              </span>
            </div>

            {verifyResult.files.length === 0 ? (
              <p className={styles.hint}>Nenhum arquivo encontrado na pasta.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Tipo</th>
                      <th>Tamanho</th>
                      <th>Situação</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verifyResult.files.map(f => (
                      <tr key={f.originalFileName}>
                        <td className={styles.nameCell} title={f.fullPath}>{f.originalFileName}</td>
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
    </div>
  );
}
