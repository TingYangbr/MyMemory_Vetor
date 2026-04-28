import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type {
  MeResponse,
  PatchMePreferencesResponse,
  UserIaUseLevel,
  UserMemoPreferences,
  UserUsageDashboardResponse,
  UserUsageMetric,
} from "@mymemory/shared";
import { USER_IA_USE_LABELS, USER_IA_USE_LEVELS } from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPatchJson } from "../api";
import Header from "../components/Header";
import styles from "./UserPreferencesPage.module.css";

function prefsFromMe(me: MeResponse): UserMemoPreferences {
  return {
    confirmEnabled: me.confirmEnabled !== false,
    soundEnabled: me.soundEnabled !== false,
    allowFreeSpecificFieldsWithoutCategoryMatch:
      me.allowFreeSpecificFieldsWithoutCategoryMatch === true,
    iaUseTexto: me.iaUseTexto ?? "basico",
    iaUseImagem: me.iaUseImagem ?? "basico",
    iaUseVideo: me.iaUseVideo ?? "basico",
    iaUseAudio: me.iaUseAudio ?? "basico",
    iaUseDocumento: me.iaUseDocumento ?? "basico",
    iaUseUrl: me.iaUseUrl ?? "basico",
    imageOcrVisionMinConfidence: me.imageOcrVisionMinConfidence ?? null,
  };
}

function pctUsed(used: number, limit: number | null): number {
  if (limit == null || limit <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, (used / limit) * 100);
}

function fmtLimit(n: number | null, decimals: number): string {
  if (n == null) return "—";
  return decimals === 0 ? String(Math.round(n)) : n.toFixed(decimals);
}

function UsageMetricRow(input: {
  icon: string;
  label: string;
  metric: UserUsageMetric;
  valueDecimals: number;
  limitDecimals: number;
  unitSuffix?: string;
}) {
  const { icon, label, metric, valueDecimals, limitDecimals, unitSuffix = "" } = input;
  const pct = pctUsed(metric.used, metric.limit);
  const pctLabel =
    metric.limit != null && metric.limit > 0 ? `${Math.round(pct)}%` : metric.used > 0 ? "—" : "0%";
  const usedStr = fmtLimit(metric.used, valueDecimals);
  const limStr = fmtLimit(metric.limit, limitDecimals);
  return (
    <div className={styles.usageRow}>
      <div className={styles.usageRowTop}>
        <span className={styles.usageRowLeft}>
          <span className={styles.usageIcon} aria-hidden>
            {icon}
          </span>
          <span className={styles.usageLabel}>{label}</span>
        </span>
        <span className={styles.usageMeta}>
          {usedStr} / {limStr}
          {unitSuffix} ({pctLabel})
        </span>
      </div>
      <div className={styles.usageBar} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={styles.usageBarFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function UserPreferencesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "uso" ? "uso" : "prefs";

  const setTab = useCallback(
    (t: "prefs" | "uso") => {
      if (t === "prefs") setSearchParams({}, { replace: true });
      else setSearchParams({ tab: "uso" }, { replace: true });
    },
    [setSearchParams]
  );

  const [ready, setReady] = useState(false);
  const [meProfile, setMeProfile] = useState<MeResponse | null>(null);
  const [prefs, setPrefs] = useState<UserMemoPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [hasPrefsColumns, setHasPrefsColumns] = useState<boolean | null>(null);

  const [usage, setUsage] = useState<UserUsageDashboardResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageErr, setUsageErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGetOptional<MeResponse>("/api/me");
      if (cancelled) return;
      if (!r.ok) {
        if (r.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setErr(`Não foi possível carregar o perfil (HTTP ${r.status}).`);
        setReady(true);
        return;
      }
      setMeProfile(r.data);
      setPrefs(prefsFromMe(r.data));
      setHasPrefsColumns(r.data.iaUseTexto !== undefined);
      setErr(null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (tab !== "uso" || !ready) return;
    let cancelled = false;
    setUsageLoading(true);
    setUsageErr(null);
    void apiGet<UserUsageDashboardResponse>("/api/me/usage")
      .then((data) => {
        if (!cancelled) setUsage(data);
      })
      .catch((e) => {
        if (!cancelled) setUsageErr(e instanceof Error ? e.message : "Falha ao carregar utilização.");
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, ready]);

  const updatePref = useCallback(<K extends keyof UserMemoPreferences>(key: K, value: UserMemoPreferences[K]) => {
    setPrefs((p) => (p ? { ...p, [key]: value } : p));
    setOkMsg(null);
  }, []);

  const save = useCallback(async () => {
    if (!prefs) return;
    setSaving(true);
    setErr(null);
    setOkMsg(null);
    try {
      const body: Partial<UserMemoPreferences> = hasPrefsColumns
        ? prefs
        : { soundEnabled: prefs.soundEnabled };
      const res = await apiPatchJson<PatchMePreferencesResponse>("/api/me/preferences", body);
      setPrefs(res.preferences);
      setOkMsg("Preferências guardadas.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao salvar.";
      setErr(msg);
    } finally {
      setSaving(false);
    }
  }, [prefs, hasPrefsColumns]);

  if (!ready || !prefs) {
    return (
      <>
        <Header />
        <main className={styles.wrap}>
          <p className="mm-muted">{err ?? "Carregando…"}</p>
        </main>
      </>
    );
  }

  return (
    <>
      <Header meRefreshKey={0} />
      <main className={`${styles.wrap} ${tab === "uso" ? styles.wrapWide : ""}`}>
        <h1 className={styles.title}>Minha conta</h1>

        <div className={styles.tabs} role="tablist" aria-label="Secções da conta">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "prefs"}
            className={`${styles.tab} ${tab === "prefs" ? styles.tabActive : ""}`}
            onClick={() => setTab("prefs")}
          >
            Preferências de memo
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "uso"}
            className={`${styles.tab} ${tab === "uso" ? styles.tabActive : ""}`}
            onClick={() => setTab("uso")}
          >
            Sua utilização
          </button>
        </div>

        {tab === "prefs" ? (
          <>
            <p className={styles.lead}>
              Defina o comportamento ao registrar memos: confirmação antes do envio à IA, áudio por voz e o nível de IA
              por tipo de conteúdo (valores padrão para novos registros).
            </p>

            {hasPrefsColumns === false ? (
              <p className={styles.schemaWarn}>
                O banco de dados ainda não inclui as colunas de preferências. Execute{" "}
                <code>docs/migrations/008_user_memo_preferences.sql</code> para ativar confirmação e níveis de IA. Até lá
                só o som abaixo pode ser salvo, se suportado.
              </p>
            ) : null}

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Fluxo e áudio</legend>
              <label className={`${styles.toggleRow} ${hasPrefsColumns === false ? styles.disabledBlock : ""}`}>
                <input
                  type="checkbox"
                  checked={prefs.confirmEnabled}
                  disabled={hasPrefsColumns === false || saving}
                  onChange={(e) => updatePref("confirmEnabled", e.target.checked)}
                />
                <span className={styles.toggleLabel}>
                  Confirmar antes do envio à IA
                  <span className={styles.toggleHint}>
                    Após capturar o arquivo, você confirma o registro antes de enviar ao processamento por IA. Desligado
                    = envio direto (sem confusão com revisão depois do processamento).
                  </span>
                </span>
              </label>
              <label className={`${styles.toggleRow} ${hasPrefsColumns === false ? styles.disabledBlock : ""}`}>
                <input
                  type="checkbox"
                  checked={prefs.allowFreeSpecificFieldsWithoutCategoryMatch}
                  disabled={hasPrefsColumns === false || saving}
                  onChange={(e) => updatePref("allowFreeSpecificFieldsWithoutCategoryMatch", e.target.checked)}
                />
                <span className={styles.toggleLabel}>
                  Permitir dados específicos livres sem correspondência de categoria
                  <span className={styles.toggleHint}>
                    Vale para memos pessoais. Quando ligado, a IA pode preencher <code>dados específicos</code> mesmo sem
                    match de categoria/campos no catálogo.
                  </span>
                </span>
              </label>
              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={prefs.soundEnabled}
                  disabled={saving}
                  onChange={(e) => updatePref("soundEnabled", e.target.checked)}
                />
                <span className={styles.toggleLabel}>
                  Áudio habilitado (voz e narração)
                  <span className={styles.toggleHint}>
                    Ativa narração automática das respostas em "Pergunte ao myMemory" e permite usar o microfone para inserir palavras-chave ao registrar memos.
                  </span>
                </span>
              </label>
              <div
                className={`${styles.selectRow} ${hasPrefsColumns === false ? styles.disabledBlock : ""}`}
                aria-disabled={hasPrefsColumns === false}
              >
                <label className={styles.selectLabel} htmlFor="pref-imageOcrVisionMinConfidence">
                  Confiança mínima do OCR (imagem)
                </label>
                <p className={styles.selectHint}>
                  Valor de 1 a 100 (confiança global do Tesseract). Se a leitura automática ficar abaixo deste valor, o
                  sistema faz uma extração de texto por visão (IA) antes do resumo — custo extra só nesses casos. Deixe
                  em branco para desligar.
                </p>
                <input
                  id="pref-imageOcrVisionMinConfidence"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  className={styles.select}
                  disabled={hasPrefsColumns === false || saving}
                  placeholder="Desligado"
                  value={prefs.imageOcrVisionMinConfidence ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === "") {
                      updatePref("imageOcrVisionMinConfidence", null);
                      return;
                    }
                    const n = Number.parseInt(raw, 10);
                    if (!Number.isFinite(n) || n < 1 || n > 100) return;
                    updatePref("imageOcrVisionMinConfidence", n);
                  }}
                />
              </div>
            </fieldset>

            <fieldset className={`${styles.fieldset} ${hasPrefsColumns === false ? styles.disabledBlock : ""}`}>
              <legend className={styles.legend}>Uso de IA por tipo de mídia (padrão)</legend>

              {(
                [
                  ["iaUseTexto", "Texto", "Memos criados como texto digitado."],
                  ["iaUseImagem", "Imagem", "Fotos e arquivos de imagem."],
                  ["iaUseVideo", "Vídeo", "Gravações e arquivos de vídeo."],
                  ["iaUseAudio", "Áudio", "Gravações e arquivos de áudio."],
                  ["iaUseDocumento", "Documento", "PDF, Office e documentos semelhantes."],
                  ["iaUseUrl", "Página URL", "Memos a partir de endereço web."],
                ] as const
              ).map(([key, label, hint]) => (
                <div key={key} className={styles.selectRow}>
                  <label className={styles.selectLabel} htmlFor={`pref-${key}`}>
                    {label}
                  </label>
                  <p className={styles.selectHint}>{hint}</p>
                  <select
                    id={`pref-${key}`}
                    className={styles.select}
                    disabled={hasPrefsColumns === false || saving}
                    value={prefs[key]}
                    onChange={(e) => updatePref(key, e.target.value as UserIaUseLevel)}
                  >
                    {USER_IA_USE_LEVELS.map((v) => (
                      <option key={v} value={v}>
                        {USER_IA_USE_LABELS[v]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </fieldset>

            <div className={styles.actions}>
              <button type="button" className="mm-btn mm-btn--primary" disabled={saving} onClick={() => void save()}>
                {saving ? "Salvando…" : "Salvar preferências"}
              </button>
            </div>
            {err ? <p className={styles.error}>{err}</p> : null}
            {okMsg ? <p className={styles.ok}>{okMsg}</p> : null}
          </>
        ) : (
          <div className={styles.usageCard}>
            <div className={styles.usageCardHead}>
              <h2 className={styles.usageCardTitle}>
                <span className={styles.usageCardTitleIcon} aria-hidden>
                  🗄
                </span>
                Utilização
              </h2>
              <p className={styles.usageEmail}>{meProfile?.email ?? meProfile?.name ?? "—"}</p>
              <p className={styles.usagePlan}>Plano {usage?.planName ?? "…"}</p>
            </div>

            {usageLoading ? <p className="mm-muted">Carregando…</p> : null}
            {usageErr ? <p className={styles.error}>{usageErr}</p> : null}

            {usage && !usageLoading ? (
              <div className={styles.usageMetrics}>
                <UsageMetricRow
                  icon="📄"
                  label="Memos"
                  metric={usage.memos}
                  valueDecimals={0}
                  limitDecimals={0}
                />
                <UsageMetricRow
                  icon="🗃"
                  label="Armazenamento"
                  metric={usage.storageGB}
                  valueDecimals={2}
                  limitDecimals={2}
                  unitSuffix=" GB"
                />
                <UsageMetricRow
                  icon="🧠"
                  label="Créditos IA (mês)"
                  metric={usage.apiCreditsMonth}
                  valueDecimals={1}
                  limitDecimals={1}
                />
                <UsageMetricRow
                  icon="⬇"
                  label="Downloads (mês)"
                  metric={usage.downloadsMonthGB}
                  valueDecimals={2}
                  limitDecimals={2}
                  unitSuffix=" GB"
                />
              </div>
            ) : null}

            <p className={styles.usageFootnote}>
              Créditos e downloads são contados no mês civil atual (servidor). Limites vêm do plano associado à sua
              assinatura individual ou à assinatura de grupo da qual é dono.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
