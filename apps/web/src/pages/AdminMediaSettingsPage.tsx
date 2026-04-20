import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AdminMediaSettingRow,
  AdminMediaSettingsResponse,
  MediaSettingsMediaTypeDb,
  MeResponse,
  SubscriptionPlanAdmin,
  SubscriptionPlansListResponse,
} from "@mymemory/shared";
import { apiGet, apiGetOptional, apiPutJson } from "../api";
import Header from "../components/Header";
import adminStyles from "./AdminPage.module.css";
import styles from "./AdminMediaSettingsPage.module.css";

const MEDIA_LABELS: Record<MediaSettingsMediaTypeDb, string> = {
  default: "Padrão (fallback)",
  audio: "Áudio",
  image: "Imagem",
  video: "Vídeo",
  document: "Documento",
  text: "Texto",
  html: "Página HTML",
};

function fmtMbFromKb(kb: number): string {
  if (!Number.isFinite(kb) || kb <= 0) return "—";
  return `${(kb / 1024).toFixed(1)} MB`;
}

function nullableKbInput(
  raw: string
): { ok: true; value: number | null } | { ok: false } {
  const v = raw.trim();
  if (v === "") return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  return { ok: true, value: Math.floor(n) };
}

/** Minutos por segmento (1–120); vazio = NULL (servidor usa default ~10). */
function nullableChunkMinutesInput(
  raw: string
): { ok: true; value: number | null } | { ok: false } {
  const v = raw.trim();
  if (v === "") return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 120) return { ok: false };
  return { ok: true, value: Math.floor(n) };
}

export default function AdminMediaSettingsPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [plans, setPlans] = useState<SubscriptionPlanAdmin[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [meta, setMeta] = useState<Omit<AdminMediaSettingsResponse, "rows"> | null>(null);
  const [rows, setRows] = useState<AdminMediaSettingRow[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const adminMediaPlan = useMemo(() => {
    if (planId == null) return null;
    const fromList = plans.find((p) => p.id === planId);
    const name =
      fromList?.name ?? (meta?.planId === planId ? meta.planName : null) ?? `Plano #${planId}`;
    return { planId, planName: name };
  }, [planId, plans, meta?.planId, meta?.planName]);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me")
      .then((r) => {
        if (!r.ok) {
          if (r.status === 401) setNeedLogin(true);
          else setLoadErr(`Erro ao carregar o perfil (HTTP ${r.status}).`);
          setLoading(false);
          return;
        }
        setMe(r.data);
        setForbidden(r.data.role !== "admin");
        setLoading(false);
      })
      .catch(() => {
        setLoadErr("Não foi possível conectar à API.");
        setLoading(false);
      });
  }, []);

  const loadPlans = useCallback(() => {
    if (me?.role !== "admin") return Promise.resolve();
    setLoadErr(null);
    return apiGet<SubscriptionPlansListResponse>("/api/admin/subscription-plans")
      .then((r) => {
        setPlans(r.plans);
        setPlanId((cur) => {
          if (cur != null && r.plans.some((p) => p.id === cur)) return cur;
          return r.plans[0]?.id ?? null;
        });
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Falha ao carregar planos."));
  }, [me?.role]);

  useEffect(() => {
    if (me?.role === "admin") void loadPlans();
  }, [me?.role, loadPlans]);

  const loadSettings = useCallback((id: number) => {
    setSettingsLoading(true);
    setSaveErr(null);
    setSaveOk(false);
    return apiGet<AdminMediaSettingsResponse>(`/api/admin/subscription-plans/${id}/media-settings`)
      .then((data) => {
        const { rows: r, ...rest } = data;
        setMeta(rest);
        setRows(r.map((x) => ({ ...x })));
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Falha ao carregar media_settings."))
      .finally(() => setSettingsLoading(false));
  }, []);

  useEffect(() => {
    if (planId != null && me?.role === "admin") void loadSettings(planId);
  }, [planId, me?.role, loadSettings]);

  function patchRow(mediaType: MediaSettingsMediaTypeDb, patch: Partial<AdminMediaSettingRow>) {
    setRows((prev) => prev.map((r) => (r.mediaType === mediaType ? { ...r, ...patch } : r)));
    setSaveOk(false);
  }

  async function save() {
    if (planId == null) return;
    setSaving(true);
    setSaveErr(null);
    setSaveOk(false);
    try {
      await apiPutJson(`/api/admin/subscription-plans/${planId}/media-settings`, {
        rows: rows.map((r) => ({
          mediaType: r.mediaType,
          maxFileSizeKB: r.maxFileSizeKB,
          videoChunkMinutes: r.videoChunkMinutes,
          audioChunkMinutes: r.audioChunkMinutes,
          maxLargeVideoKb: r.maxLargeVideoKb,
          maxLargeAudioKb: r.maxLargeAudioKb,
          maxSummaryChars: r.maxSummaryChars,
          textImagemMin: r.textImagemMin,
          compressBeforeAI: r.compressBeforeAI,
        })),
      });
      setSaveOk(true);
      await loadSettings(planId);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className={adminStyles.shell}>
        <Header />
        <main className={adminStyles.main}>
          <p className="mm-muted">Carregando…</p>
        </main>
      </div>
    );
  }

  if (needLogin) {
    return (
      <div className={adminStyles.shell}>
        <Header />
        <main className={adminStyles.main}>
          <h1 className={adminStyles.title}>Autenticação necessária</h1>
          <Link to="/login" className={adminStyles.back}>
            Ir ao login
          </Link>
        </main>
      </div>
    );
  }

  if (forbidden || me?.role !== "admin") {
    return (
      <div className={adminStyles.shell}>
        <Header />
        <main className={adminStyles.main}>
          <h1 className={adminStyles.title}>Acesso negado</h1>
        </main>
      </div>
    );
  }

  return (
    <div className={adminStyles.shell}>
      <Header adminMediaPlan={adminMediaPlan} />
      <main className={`${adminStyles.main} ${adminStyles.mainWide}`}>
        <Link to="/admin" className={adminStyles.back}>
          ← Painel admin
        </Link>
        <h1 className={adminStyles.title}>Mídia por plano</h1>
        <p className={adminStyles.lead}>
          Tabela <code className={adminStyles.tableToolbarCode}>media_settings</code>: cada combinação{" "}
          <strong>plano (planId)</strong> + <strong>tipo de mídia</strong> define limites em KB e opções de texto/OCR.
          O <strong>processamento simples</strong> usa a coluna <strong>máximo (KB)</strong> por tipo. Para{" "}
          <strong>áudio</strong> e <strong>vídeo</strong> acima desse teto (quando o plano permite arquivos grandes), o
          servidor corta por <strong>duração (minutos por segmento)</strong> e transcreve cada segmento; o{" "}
          <strong>máximo grande (KB)</strong> define o teto de envio nesse modo.
        </p>

        {loadErr ? <p className="mm-error">{loadErr}</p> : null}

        <div className={styles.toolbar}>
          <div className={styles.planField}>
            <label htmlFor="admin-media-plan">Plano de assinatura (planId)</label>
            <select
              id="admin-media-plan"
              className={styles.select}
              value={planId ?? ""}
              onChange={(e) => setPlanId(Number(e.target.value) || null)}
              disabled={!plans.length}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  planId {p.id} — {p.name} ({p.planType === "group" ? "grupo" : "individual"})
                </option>
              ))}
            </select>
          </div>
        </div>

        {meta ? (
          <div className={styles.summaryStrip}>
            <span>
              <strong>Plano em edição:</strong> #{meta.planId} — {meta.planName}
            </span>
            <span className={meta.supportLargeAudio ? styles.badge : `${styles.badge} ${styles.badgeOff}`}>
              Áudio grande: {meta.supportLargeAudio ? "habilitado no plano" : "desabilitado"}
            </span>
            <span className={meta.supportLargeVideo ? styles.badge : `${styles.badge} ${styles.badgeOff}`}>
              Vídeo grande: {meta.supportLargeVideo ? "habilitado no plano" : "desabilitado"}
            </span>
            <span className="mm-muted">
              Esses interruptores estão em{" "}
              <Link to="/admin">Planos de assinatura</Link>. Com desabilitado, o teto de envio segue o processamento
              simples.
            </span>
          </div>
        ) : null}

        <p className={styles.legend}>
          <strong>Padrão</strong> vale quando não há linha específica para um tipo. <strong>Mín. OCR</strong> e{" "}
          <strong>máx. resumo</strong> valem sobretudo para <strong>imagem</strong> e <strong>texto</strong>. Minutos de
          segmento vazios usam default no servidor (~10 min). Máximo grande vazio faz o teto de envio coincidir com o
          processamento simples dessa linha.
        </p>

        {settingsLoading ? (
          <p className="mm-muted">Carregando configurações…</p>
        ) : rows.length ? (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr className={styles.groupHead}>
                    <th rowSpan={2}>Tipo de mídia</th>
                    <th rowSpan={2}>
                      Máx. (KB)
                      <br />
                      <span className={styles.thSub}>processamento simples</span>
                    </th>
                    <th colSpan={2}>Arquivo grande (áudio / vídeo)</th>
                    <th colSpan={2}>Texto / revisão</th>
                    <th rowSpan={2}>Comprimir antes da IA</th>
                  </tr>
                  <tr className={styles.subHead}>
                    <th>Segmento (min)</th>
                    <th>Máx. grande (KB)</th>
                    <th>Máx. chars resumo</th>
                    <th>Mín. OCR imagem</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isVideo = r.mediaType === "video";
                    const isAudio = r.mediaType === "audio";
                    const chunkLabel =
                      isVideo
                        ? "Duração alvo por segmento, vídeo (minutos)"
                        : isAudio
                          ? "Duração alvo por segmento, áudio (minutos)"
                          : null;
                    const largeLabel = isVideo
                      ? "Tamanho máximo (vídeo grande)"
                      : isAudio
                        ? "Tamanho máximo (áudio grande)"
                        : null;
                    return (
                      <tr key={r.mediaType}>
                        <td className={styles.typeCell}>{MEDIA_LABELS[r.mediaType]}</td>
                        <td>
                          <input
                            type="number"
                            className={styles.numInput}
                            min={1}
                            value={r.maxFileSizeKB}
                            onChange={(e) =>
                              patchRow(r.mediaType, { maxFileSizeKB: Math.max(1, Number(e.target.value) || 1) })
                            }
                            aria-label={`${MEDIA_LABELS[r.mediaType]}: máximo KB (simples)`}
                          />
                          <div className={styles.mutedCell}>{fmtMbFromKb(r.maxFileSizeKB)}</div>
                        </td>
                        <td>
                          {isVideo || isAudio ? (
                            <input
                              type="number"
                              className={`${styles.numInput} ${styles.numInputWide}`}
                              min={1}
                              max={120}
                              placeholder="opcional"
                              value={
                                isVideo
                                  ? (r.videoChunkMinutes ?? "")
                                  : isAudio
                                    ? (r.audioChunkMinutes ?? "")
                                    : ""
                              }
                              onChange={(e) => {
                                const parsed = nullableChunkMinutesInput(e.target.value);
                                if (!parsed.ok) return;
                                if (isVideo) patchRow(r.mediaType, { videoChunkMinutes: parsed.value });
                                if (isAudio) patchRow(r.mediaType, { audioChunkMinutes: parsed.value });
                              }}
                              aria-label={chunkLabel ?? "chunk"}
                            />
                          ) : (
                            <span className={styles.mutedCell}>—</span>
                          )}
                        </td>
                        <td>
                          {isVideo || isAudio ? (
                            <input
                              type="number"
                              className={`${styles.numInput} ${styles.numInputWide}`}
                              min={1}
                              placeholder="opcional"
                              value={
                                isVideo ? (r.maxLargeVideoKb ?? "") : isAudio ? (r.maxLargeAudioKb ?? "") : ""
                              }
                              onChange={(e) => {
                                const parsed = nullableKbInput(e.target.value);
                                if (!parsed.ok) return;
                                if (isVideo) patchRow(r.mediaType, { maxLargeVideoKb: parsed.value });
                                if (isAudio) patchRow(r.mediaType, { maxLargeAudioKb: parsed.value });
                              }}
                              aria-label={largeLabel ?? "máximo grande"}
                            />
                          ) : (
                            <span className={styles.mutedCell}>—</span>
                          )}
                        </td>
                        <td>
                          <input
                            type="number"
                            className={styles.numInputWide}
                            min={1}
                            max={65000}
                            value={r.maxSummaryChars}
                            onChange={(e) =>
                              patchRow(r.mediaType, {
                                maxSummaryChars: Math.min(65_000, Math.max(1, Number(e.target.value) || 1)),
                              })
                            }
                            aria-label={`${MEDIA_LABELS[r.mediaType]}: máximo caracteres resumo`}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className={styles.numInput}
                            min={0}
                            max={65000}
                            value={r.textImagemMin}
                            onChange={(e) =>
                              patchRow(r.mediaType, {
                                textImagemMin: Math.min(65_000, Math.max(0, Number(e.target.value) || 0)),
                              })
                            }
                            aria-label={`${MEDIA_LABELS[r.mediaType]}: mínimo OCR`}
                          />
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={r.compressBeforeAI === 1}
                            onChange={(e) =>
                              patchRow(r.mediaType, { compressBeforeAI: e.target.checked ? 1 : 0 })
                            }
                            aria-label={`${MEDIA_LABELS[r.mediaType]}: comprimir antes da IA`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={styles.foot}>
              <strong>Segmento (min)</strong>: duração alvo de cada corte no servidor (Whisper por segmento; depois junta
              o texto). <strong>Máx. grande</strong>: teto em KB quando o plano tem áudio/vídeo grande habilitado; se
              vazio, o limite efetivo de envio iguala o <strong>processamento simples</strong> dessa linha.
            </p>
            <div className={styles.actions}>
              <button type="button" className="mm-btn mm-btn--primary" disabled={saving} onClick={() => void save()}>
                {saving ? "Salvando…" : "Salvar alterações"}
              </button>
              {saveOk ? <span className={styles.savedOk}>Alterações salvas.</span> : null}
              {saveErr ? <span className="mm-error">{saveErr}</span> : null}
            </div>
          </>
        ) : planId != null ? (
          <p className="mm-muted">Sem dados para este plano.</p>
        ) : (
          <p className="mm-muted">Nenhum plano disponível. Crie um plano no painel admin.</p>
        )}
      </main>
    </div>
  );
}
