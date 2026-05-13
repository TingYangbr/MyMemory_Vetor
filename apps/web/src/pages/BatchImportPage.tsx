import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  BatchFileVerifyResult,
  BatchVerifyResponse,
  BatchProcessResponse,
  StorageProvider,
} from "@mymemory/shared";
import { STORAGE_PROVIDER_LABELS, BATCH_FILE_SITUACAO_LABELS } from "@mymemory/shared";
import { apiPostJson, apiPostMultipart } from "../api";
import Header from "../components/Header";
import styles from "./BatchImportPage.module.css";

type IaLevel = "semIA" | "basico" | "completo";

const IA_LEVEL_OPTIONS: { value: IaLevel; label: string; desc: string }[] = [
  { value: "semIA", label: "Sem IA", desc: "Cria memo com placeholder — edição manual depois" },
  { value: "basico", label: "Básico", desc: "Extrai texto + palavras-chave + categoria" },
  { value: "completo", label: "Completo", desc: "Extrai texto + campos estruturados" },
];

const LOCAL_PROVIDERS: StorageProvider[] = ["LOCAL", "REDE"];
const UPLOAD_PROVIDERS: StorageProvider[] = ["ONEDRIVE", "GOOGLE_DRIVE"];

function situacaoClass(s: BatchFileVerifyResult["situacao"]): string {
  if (s === "pronto") return styles.ok;
  if (s === "ja_cadastrado") return styles.warn;
  if (s === "suspeito_duplicidade") return styles.warn;
  return styles.err;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function BatchImportPage() {
  const [provider, setProvider] = useState<StorageProvider>("LOCAL");
  const [folderPath, setFolderPath] = useState("");
  const [iaLevel, setIaLevel] = useState<IaLevel>("semIA");
  const [groupId] = useState<number | null>(null);

  const [verifyResult, setVerifyResult] = useState<BatchVerifyResponse | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [processResult, setProcessResult] = useState<BatchProcessResponse | null>(null);
  const [processLoading, setProcessLoading] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [processedCount, setProcessedCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLocalProvider = LOCAL_PROVIDERS.includes(provider);
  const isUploadProvider = UPLOAD_PROVIDERS.includes(provider);

  // ── Verificar ──────────────────────────────────────────────────────────────

  async function handleVerify() {
    setVerifyError(null);
    setVerifyResult(null);
    setProcessResult(null);
    setVerifyLoading(true);
    try {
      if (isLocalProvider) {
        const result = await apiPostJson<BatchVerifyResponse & { folderPath?: string }>(
          "/api/memos/batch/verify/local",
          { provider, folderPath: folderPath.trim(), iaLevel, groupId }
        );
        setVerifyResult(result);
      } else if (isUploadProvider) {
        const files = fileInputRef.current?.files;
        if (!files?.length) {
          setVerifyError("Selecione ao menos um arquivo.");
          return;
        }
        const form = new FormData();
        form.append("provider", provider);
        if (groupId) form.append("groupId", String(groupId));
        for (const f of Array.from(files)) form.append("files", f);
        const result = (await apiPostMultipart("/api/memos/batch/verify/upload", form)) as BatchVerifyResponse;
        setVerifyResult(result);
      } else if (provider === "URL") {
        setVerifyError("Importação por URL: use o formulário de URL (em breve).");
      } else {
        setVerifyError("Provider não suportado para verificação.");
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyLoading(false);
    }
  }

  // ── Processar ──────────────────────────────────────────────────────────────

  async function handleProcess() {
    if (!verifyResult) return;
    const ready = verifyResult.files.filter(
      (f) => f.situacao === "pronto" || f.situacao === "suspeito_duplicidade"
    );
    if (!ready.length) return;

    setProcessError(null);
    setProcessResult(null);
    setProcessLoading(true);
    setProcessedCount(0);
    try {
      if (isLocalProvider) {
        const result = await apiPostJson<BatchProcessResponse>(
          "/api/memos/batch/process/local",
          {
            provider,
            folderPath: folderPath.trim(),
            iaLevel,
            groupId,
            onlyFileNames: ready.map((f) => f.originalFileName),
          }
        );
        setProcessResult(result);
        setProcessedCount(result.totalCreated);
      } else if (isUploadProvider) {
        const files = fileInputRef.current?.files;
        if (!files?.length) return;
        const form = new FormData();
        form.append("provider", provider);
        form.append("iaLevel", iaLevel);
        if (groupId) form.append("groupId", String(groupId));
        form.append("onlyFileNames", JSON.stringify(ready.map((f) => f.originalFileName)));
        for (const f of Array.from(files)) {
          if (ready.some((r) => r.originalFileName === f.name)) {
            form.append("files", f);
          }
        }
        const result = (await apiPostMultipart("/api/memos/batch/process/upload", form)) as BatchProcessResponse;
        setProcessResult(result);
        setProcessedCount(result.totalCreated);
      }
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const readyFiles = verifyResult?.files.filter(
    (f) => f.situacao === "pronto" || f.situacao === "suspeito_duplicidade"
  ) ?? [];

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <div className={styles.header}>
          <h1 className={styles.title}>Importação em Lote</h1>
          <Link to="/" className={styles.backLink}>← Início</Link>
        </div>
        <p className={styles.subtitle}>
          Registre arquivos do OneDrive, Google Drive, rede local ou disco sem copiá-los para a nuvem.
        </p>

        {/* Provider */}
        <section className={styles.section}>
          <label className={styles.label}>Origem dos arquivos</label>
          <div className={styles.providerGrid}>
            {(Object.keys(STORAGE_PROVIDER_LABELS) as StorageProvider[])
              .filter((p) => p !== "S3")
              .map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`${styles.providerBtn} ${provider === p ? styles.providerBtnActive : ""}`}
                  onClick={() => {
                    setProvider(p);
                    setVerifyResult(null);
                    setProcessResult(null);
                  }}
                >
                  {STORAGE_PROVIDER_LABELS[p]}
                </button>
              ))}
          </div>
        </section>

        {/* Endereço / Arquivos */}
        <section className={styles.section}>
          {isLocalProvider && (
            <>
              <label className={styles.label} htmlFor="folderPath">
                Caminho da pasta ({provider === "REDE" ? "ex.: \\\\servidor\\compartilhamento" : "ex.: C:\\Documentos\\Contratos"})
              </label>
              <input
                id="folderPath"
                type="text"
                className={styles.input}
                placeholder={provider === "REDE" ? "\\\\servidor\\pasta" : "C:\\pasta\\subpasta"}
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
              />
            </>
          )}
          {isUploadProvider && (
            <>
              <label className={styles.label} htmlFor="fileInput">
                Selecione os arquivos do {STORAGE_PROVIDER_LABELS[provider]}
              </label>
              <input
                id="fileInput"
                ref={fileInputRef}
                type="file"
                multiple
                className={styles.fileInput}
                onChange={() => {
                  setVerifyResult(null);
                  setProcessResult(null);
                }}
              />
            </>
          )}
          {provider === "URL" && (
            <p className={styles.infoMsg}>Importação por URL disponível em breve.</p>
          )}
        </section>

        {/* Modo IA */}
        <section className={styles.section}>
          <label className={styles.label}>Modo de processamento</label>
          <div className={styles.iaGrid}>
            {IA_LEVEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`${styles.iaBtn} ${iaLevel === opt.value ? styles.iaBtnActive : ""}`}
                onClick={() => setIaLevel(opt.value)}
              >
                <span className={styles.iaBtnLabel}>{opt.label}</span>
                <span className={styles.iaBtnDesc}>{opt.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Botão verificar */}
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={handleVerify}
          disabled={verifyLoading || processLoading || (isLocalProvider && !folderPath.trim())}
        >
          {verifyLoading ? "Verificando…" : "Verificar arquivos"}
        </button>

        {verifyError && <p className={styles.error}>{verifyError}</p>}

        {/* Tabela de verificação */}
        {verifyResult && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Pré-verificação</h2>
            {verifyResult.files.length === 0 ? (
              <p className={styles.infoMsg}>Nenhum arquivo encontrado.</p>
            ) : (
              <div className={styles.tableWrapper}>
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
                    {verifyResult.files.map((f) => (
                      <tr key={f.originalFileName} className={situacaoClass(f.situacao)}>
                        <td className={styles.nameCell} title={f.fullPath}>{f.originalFileName}</td>
                        <td>{f.mediaType ?? "—"}</td>
                        <td>{formatBytes(f.sizeBytes)}</td>
                        <td>
                          <span className={`${styles.badge} ${situacaoClass(f.situacao)}`}>
                            {BATCH_FILE_SITUACAO_LABELS[f.situacao]}
                          </span>
                        </td>
                        <td className={styles.motivoCell}>{f.motivo ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Estimativa de créditos */}
            <div className={styles.creditBar}>
              <span>
                Estimativa de créditos — Sem IA: {verifyResult.creditEstimate.semIA} |
                Básico: {verifyResult.creditEstimate.basico} |
                Completo: {verifyResult.creditEstimate.completo}
              </span>
              {verifyResult.userCurrentCredits != null && (
                <span className={styles.creditBalance}>
                  Saldo atual: {verifyResult.userCurrentCredits}
                </span>
              )}
            </div>

            {/* Botão processar */}
            {readyFiles.length > 0 && !processResult && (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handleProcess}
                disabled={processLoading}
              >
                {processLoading
                  ? `Processando… (${processedCount}/${readyFiles.length})`
                  : `Processar ${readyFiles.length} arquivo${readyFiles.length !== 1 ? "s" : ""} válido${readyFiles.length !== 1 ? "s" : ""}`}
              </button>
            )}
          </section>
        )}

        {processError && <p className={styles.error}>{processError}</p>}

        {/* Resultado */}
        {processResult && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Resultado</h2>
            <div className={styles.resultSummary}>
              <span className={styles.ok}>✓ {processResult.totalCreated} criado{processResult.totalCreated !== 1 ? "s" : ""}</span>
              {processResult.totalErrors > 0 && (
                <span className={styles.err}>✗ {processResult.totalErrors} erro{processResult.totalErrors !== 1 ? "s" : ""}</span>
              )}
            </div>
            {processResult.results.some((r) => !r.ok) && (
              <ul className={styles.errorList}>
                {processResult.results
                  .filter((r) => !r.ok)
                  .map((r) => (
                    <li key={r.originalFileName}>
                      <strong>{r.originalFileName}</strong>: {r.error}
                    </li>
                  ))}
              </ul>
            )}
            <Link to="/" className={styles.primaryBtn} style={{ display: "inline-block", textAlign: "center" }}>
              Ver memos criados →
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}
