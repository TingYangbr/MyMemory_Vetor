import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AdminCostReportMediaFilter,
  AdminCostReportResponse,
  AdminDiagnosticsResponse,
  AdminPromptCategory,
  AdminPromptCategoryListResponse,
  AiConfigListResponse,
  AiConfigProvider,
  AiConfigRow,
  DbConnection,
  DbConnectionListResponse,
  DbConnectionTestResult,
  HardDeleteSoftDeletedMonthResponse,
  LlmPromptCategoryOverride,
  LlmPromptCategoryOverrideListResponse,
  LlmPromptConfig,
  LlmPromptConfigListResponse,
  MeResponse,
  MemoContextCategory,
  MemoContextGroupOption,
  MemoContextStructureResponse,
  MemosListaResponse,
  SoftDeletedMemosMonthlyRow,
  SoftDeletedMemosMonthlySummaryResponse,
  SubscriptionPlanAdmin,
  SubscriptionPlansListResponse,
} from "@mymemory/shared";
import { AI_PROVIDER_OPTIONS } from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiGetOptional, apiPatchJson, apiPostJson, apiPutJson } from "../api";
import Header from "../components/Header";
import styles from "./AdminPage.module.css";

type AdminTab = "planos" | "outros" | "eliminacao" | "custos" | "consulta" | "prompts" | "ia" | "conexoes_bd" | "convites_usuarios";

const COST_MEDIA_OPTIONS: { value: AdminCostReportMediaFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "text", label: "Texto" },
  { value: "audio", label: "Áudio" },
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "document", label: "Documento" },
  { value: "url", label: "URL" },
];

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultCostRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: ymdLocal(first), to: ymdLocal(now) };
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatCredIa(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function fmtCatalogPlanPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return `R$ ${formatMoney(n)}`;
}

function fmtCell(n: number | null | undefined): string {
  if (n == null) return "—";
  return String(n).replace(".", ",");
}

function fmtYesNo(v: number): string {
  return v === 1 ? "Sim" : "Não";
}

const MEDIA_TYPE_PT: Record<string, string> = {
  text: "Texto", audio: "Áudio", image: "Imagem",
  video: "Vídeo", document: "Doc.", url: "URL",
};

function fmtConsultaCell(key: string, value: unknown): string {
  if (value == null) return "—";
  const s = String(value);
  if (key === "data_registro") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  if (key === "mediaType") return MEDIA_TYPE_PT[s] ?? s;
  if (key === "mediaText") return s.length > 150 ? `${s.slice(0, 150)}…` : s;
  return s || "—";
}

function deleteBlockTitle(p: SubscriptionPlanAdmin): string {
  const total = p.totalSubscriptionCount ?? 0;
  const active = p.activeSubscriptionCount ?? 0;
  if (total === 0) return "Excluir este plano";
  if (active > 0) {
    return `Não é possível excluir: ${active} assinatura(s) ativa(s) ligada(s) a este plano.`;
  }
  return "Não é possível excluir: existem assinaturas inativas/expiradas ainda ligadas no banco.";
}

function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10"/>
      <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
      <path d="m10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4 5.4-5.4z"/>
    </svg>
  );
}

function IconTrash() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function IconPrint() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      />
    </svg>
  );
}

function PlanModal({
  open,
  mode,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  initial: SubscriptionPlanAdmin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [planType, setPlanType] = useState<"individual" | "group">("individual");
  const [price, setPrice] = useState("0");
  const [maxMemos, setMaxMemos] = useState("1000");
  const [maxStorageGB, setMaxStorageGB] = useState("1");
  const [maxMembers, setMaxMembers] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [monthlyApiCredits, setMonthlyApiCredits] = useState("");
  const [monthlyDownloadLimitGB, setMonthlyDownloadLimitGB] = useState("");
  const [supportLargeAudio, setSupportLargeAudio] = useState(false);
  const [supportLargeVideo, setSupportLargeVideo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (mode === "create" || !initial) {
      setName("");
      setPlanType("individual");
      setPrice("0");
      setMaxMemos("1000");
      setMaxStorageGB("1");
      setMaxMembers("");
      setDurationDays("");
      setIsActive(true);
      setMonthlyApiCredits("");
      setMonthlyDownloadLimitGB("");
      setSupportLargeAudio(false);
      setSupportLargeVideo(false);
      return;
    }
    setName(initial.name);
    setPlanType(initial.planType);
    setPrice(String(initial.price));
    setMaxMemos(String(initial.maxMemos));
    setMaxStorageGB(String(initial.maxStorageGB));
    setMaxMembers(initial.maxMembers != null ? String(initial.maxMembers) : "");
    setDurationDays(initial.durationDays != null ? String(initial.durationDays) : "");
    setIsActive(initial.isActive === 1);
    setMonthlyApiCredits(
      initial.monthlyApiCredits != null ? String(initial.monthlyApiCredits) : ""
    );
    setMonthlyDownloadLimitGB(
      initial.monthlyDownloadLimitGB != null ? String(initial.monthlyDownloadLimitGB) : ""
    );
    setSupportLargeAudio(initial.supportLargeAudio === 1);
    setSupportLargeVideo(initial.supportLargeVideo === 1);
  }, [open, mode, initial]);

  async function submit() {
    setErr(null);
    const nPrice = Number(price.replace(",", "."));
    const nMaxMemos = parseInt(maxMemos, 10);
    const nMaxStorage = Number(maxStorageGB.replace(",", "."));
    if (!name.trim()) {
      setErr("Nome é obrigatório.");
      return;
    }
    if (!Number.isFinite(nPrice) || nPrice < 0) {
      setErr("Preço inválido.");
      return;
    }
    if (!Number.isFinite(nMaxMemos) || nMaxMemos < 0) {
      setErr("Máx. memos inválido.");
      return;
    }
    if (!Number.isFinite(nMaxStorage) || nMaxStorage < 0) {
      setErr("Armazenamento (GB) inválido.");
      return;
    }

    const maxMembersVal =
      maxMembers.trim() === "" ? null : parseInt(maxMembers, 10);
    if (maxMembers.trim() !== "" && !Number.isFinite(maxMembersVal)) {
      setErr("Máx. membros inválido.");
      return;
    }
    const durationVal =
      durationDays.trim() === "" ? null : parseInt(durationDays, 10);
    if (durationDays.trim() !== "" && !Number.isFinite(durationVal)) {
      setErr("Duração (dias) inválida.");
      return;
    }
    const creditsVal =
      monthlyApiCredits.trim() === "" ? null : Number(monthlyApiCredits.replace(",", "."));
    if (monthlyApiCredits.trim() !== "" && !Number.isFinite(creditsVal)) {
      setErr("Créditos API inválidos.");
      return;
    }
    const dlVal =
      monthlyDownloadLimitGB.trim() === ""
        ? null
        : Number(monthlyDownloadLimitGB.replace(",", "."));
    if (monthlyDownloadLimitGB.trim() !== "" && !Number.isFinite(dlVal)) {
      setErr("Limite download inválido.");
      return;
    }

    const payload = {
      name: name.trim(),
      planType,
      price: nPrice,
      maxMemos: nMaxMemos,
      maxStorageGB: nMaxStorage,
      maxMembers: maxMembersVal,
      durationDays: durationVal,
      isActive: isActive ? 1 : 0,
      monthlyApiCredits: creditsVal,
      monthlyDownloadLimitGB: dlVal,
      supportLargeAudio: supportLargeAudio ? 1 : 0,
      supportLargeVideo: supportLargeVideo ? 1 : 0,
    };

    setSaving(true);
    try {
      if (mode === "create") {
        await apiPostJson<{ id: number }>("/api/admin/subscription-plans", payload);
      } else if (initial) {
        await apiPatchJson(`/api/admin/subscription-plans/${initial.id}`, payload);
      }
      onSaved();
      onClose();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      try {
        const j = JSON.parse(raw) as { message?: string };
        setErr(j.message ?? raw);
      } catch {
        setErr(raw);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="mm-modal-overlay"
      role="presentation"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div className="mm-modal" role="dialog" aria-modal="true" onClick={(ev) => ev.stopPropagation()}>
        <h3 className={styles.title} style={{ fontSize: "1.15rem", marginBottom: "1rem" }}>
          {mode === "create" ? "Novo plano" : `Editar plano #${initial?.id}`}
        </h3>
        {err ? <p className="mm-error">{err}</p> : null}
        <div className={styles.modalGrid}>
          <div className={`${styles.modalField} ${styles.modalFieldFull}`}>
            <label htmlFor="adm-plan-name">Nome</label>
            <input
              id="adm-plan-name"
              className="mm-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className={styles.modalField}>
            <label htmlFor="adm-plan-type">Tipo</label>
            <select
              id="adm-plan-type"
              className="mm-field"
              value={planType}
              onChange={(e) => setPlanType(e.target.value as "individual" | "group")}
            >
              <option value="individual">Individual</option>
              <option value="group">Grupo</option>
            </select>
          </div>
          <div className={styles.modalField}>
            <label htmlFor="adm-plan-price">Preço</label>
            <input
              id="adm-plan-price"
              className="mm-field"
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className={styles.modalField}>
            <label htmlFor="adm-plan-memos">Máx. memos</label>
            <input
              id="adm-plan-memos"
              className="mm-field"
              type="number"
              min={0}
              value={maxMemos}
              onChange={(e) => setMaxMemos(e.target.value)}
            />
          </div>
          <div className={styles.modalField}>
            <label htmlFor="adm-plan-gb">Armazenamento (GB)</label>
            <input
              id="adm-plan-gb"
              className="mm-field"
              type="text"
              inputMode="decimal"
              value={maxStorageGB}
              onChange={(e) => setMaxStorageGB(e.target.value)}
            />
          </div>
          <div className={styles.modalField}>
            <label htmlFor="adm-plan-members">Máx. membros (vazio = sem limite)</label>
            <input
              id="adm-plan-members"
              className="mm-field"
              type="number"
              min={1}
              value={maxMembers}
              onChange={(e) => setMaxMembers(e.target.value)}
              placeholder="—"
            />
          </div>
          <div className={styles.modalField}>
            <label htmlFor="adm-plan-days">Duração (dias)</label>
            <input
              id="adm-plan-days"
              className="mm-field"
              type="number"
              min={1}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              placeholder="—"
            />
          </div>
          <div className={styles.modalField}>
            <label htmlFor="adm-plan-credits">Cred. / mês (API)</label>
            <input
              id="adm-plan-credits"
              className="mm-field"
              type="text"
              inputMode="decimal"
              value={monthlyApiCredits}
              onChange={(e) => setMonthlyApiCredits(e.target.value)}
              placeholder="—"
            />
          </div>
          <div className={styles.modalField}>
            <label htmlFor="adm-plan-dl">Download / mês (GB)</label>
            <input
              id="adm-plan-dl"
              className="mm-field"
              type="text"
              inputMode="decimal"
              value={monthlyDownloadLimitGB}
              onChange={(e) => setMonthlyDownloadLimitGB(e.target.value)}
              placeholder="—"
            />
          </div>
          <div className={styles.modalField}>
            <label>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />{" "}
              Plano ativo
            </label>
          </div>
          <div className={styles.modalField}>
            <label>
              <input
                type="checkbox"
                checked={supportLargeAudio}
                onChange={(e) => setSupportLargeAudio(e.target.checked)}
              />{" "}
              Suporte áudio grande
            </label>
          </div>
          <div className={styles.modalField}>
            <label>
              <input
                type="checkbox"
                checked={supportLargeVideo}
                onChange={(e) => setSupportLargeVideo(e.target.checked)}
              />{" "}
              Suporte vídeo grande
            </label>
          </div>
        </div>
        <p className={styles.hint}>
          Valores decimais podem usar ponto ou vírgula. Campos vazios em limite/créditos = sem definição (NULL).
        </p>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
          <button type="button" className="mm-btn mm-btn--ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className="mm-btn mm-btn--primary" disabled={saving} onClick={() => void submit()}>
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [tab, setTab] = useState<AdminTab>("planos");
  const [plans, setPlans] = useState<SubscriptionPlanAdmin[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [diag, setDiag] = useState<AdminDiagnosticsResponse | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagErr, setDiagErr] = useState<string | null>(null);
  const [purgeRows, setPurgeRows] = useState<SoftDeletedMemosMonthlyRow[]>([]);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeErr, setPurgeErr] = useState<string | null>(null);
  const [hardDeletingMonth, setHardDeletingMonth] = useState<string | null>(null);
  const [purgeOk, setPurgeOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("edit");
  const [editing, setEditing] = useState<SubscriptionPlanAdmin | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [costDateFrom, setCostDateFrom] = useState(() => defaultCostRange().from);
  const [costDateTo, setCostDateTo] = useState(() => defaultCostRange().to);
  const [costMedia, setCostMedia] = useState<AdminCostReportMediaFilter>("all");
  const [costReport, setCostReport] = useState<AdminCostReportResponse | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costErr, setCostErr] = useState<string | null>(null);
  const [openCostPlans, setOpenCostPlans] = useState<Set<string>>(() => new Set());
  const costFirstLoadRef = useRef(false);

  // ── Aba Consulta ─────────────────────────────────────────────────────────
  const [consultaGroups, setConsultaGroups] = useState<MemoContextGroupOption[]>([]);
  /** Grupo 1 — contexto de categorias: popula o select de categorias. */
  const [consultaCatGroupId, setConsultaCatGroupId] = useState<number | null>(null);
  /** Grupo 2 — filtro de memos: restringe quais memos aparecem no resultado (null = todos). */
  const [consultaFiltroGroupId, setConsultaFiltroGroupId] = useState<number | null>(null);
  const [consultaGroupsLoaded, setConsultaGroupsLoaded] = useState(false);
  const [consultaCategorias, setConsultaCategorias] = useState<MemoContextCategory[]>([]);
  const [consultaCatNome, setConsultaCatNome] = useState<string>("");
  const [consultaDataInicio, setConsultaDataInicio] = useState<string>("");
  const [consultaDataFim, setConsultaDataFim] = useState<string>("");
  const [pendingCampoFiltros, setPendingCampoFiltros] = useState<Record<string, string>>({});
  const [consultaSortKey, setConsultaSortKey] = useState<string>("data_registro");
  const [consultaSortDir, setConsultaSortDir] = useState<"asc" | "desc">("desc");
  const [consultaOffset, setConsultaOffset] = useState<number>(0);
  const [consultaResult, setConsultaResult] = useState<MemosListaResponse | null>(null);
  const [consultaLoading, setConsultaLoading] = useState<boolean>(false);
  const [consultaErr, setConsultaErr] = useState<string | null>(null);

  // ── Aba Prompts ──────────────────────────────────────────────────────────
  const [promptConfigs, setPromptConfigs] = useState<LlmPromptConfig[]>([]);
  const [promptsLoaded, setPromptsLoaded] = useState(false);
  const [promptsErr, setPromptsErr] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // draft edits: chave → {texto_padrao, texto_atual}
  const [promptDrafts, setPromptDrafts] = useState<Record<string, { texto_padrao: string; texto_atual: string }>>({});
  const [promptSaving, setPromptSaving] = useState<Set<string>>(new Set());
  const [promptSaveOk, setPromptSaveOk] = useState<Set<string>>(new Set());
  // category overrides
  const [catOverrides, setCatOverrides] = useState<Record<string, LlmPromptCategoryOverride[]>>({});
  const [catOverridesLoaded, setCatOverridesLoaded] = useState<Set<string>>(new Set());
  const [catAvailable, setCatAvailable] = useState<AdminPromptCategory[]>([]);
  // novo override em edição: chave → {categoryId, texto}
  const [newCatOverride, setNewCatOverride] = useState<Record<string, { categoryId: number | ""; texto: string }>>({});
  // saving/deleting: "chave:categoryId"
  const [catOverrideSaving, setCatOverrideSaving] = useState<Set<string>>(new Set());
  const [catOverrideDeleting, setCatOverrideDeleting] = useState<Set<string>>(new Set());

  // ── Aba Conexões BD ──────────────────────────────────────────────────────
  const emptyDbConn = (): Partial<DbConnection> & { password: string; groupId: number | null } => ({
    nome: "", descricao: null, host: "", port: 1433, database: "",
    username: "", password: "", encrypt: 0, trustServerCertificate: 1, groupId: null,
  });
  const [dbConns, setDbConns] = useState<DbConnection[]>([]);
  const [dbConnsLoading, setDbConnsLoading] = useState(false);
  const [dbConnsErr, setDbConnsErr] = useState<string | null>(null);
  const [dbConnForm, setDbConnForm] = useState<Partial<DbConnection> & { password: string; groupId: number | null }>(emptyDbConn());
  const [dbConnEditing, setDbConnEditing] = useState<number | null>(null);
  const [dbConnSaving, setDbConnSaving] = useState(false);
  const [dbConnSaveOk, setDbConnSaveOk] = useState(false);
  const [dbConnTestResults, setDbConnTestResults] = useState<Record<number, DbConnectionTestResult>>({});
  const [dbConnTesting, setDbConnTesting] = useState<Set<number>>(new Set());
  const [dbConnGroups, setDbConnGroups] = useState<MemoContextGroupOption[]>([]);

  // ── Aba Convites de Usuários ─────────────────────────────────────────────
  const [userInvites, setUserInvites] = useState<{ id: number; email: string; status: string; createdAt: string; expiresAt: string; acceptedAt: string | null }[]>([]);
  const [userInvitesLoading, setUserInvitesLoading] = useState(false);
  const [userInvitesErr, setUserInvitesErr] = useState<string | null>(null);
  const [userInviteEmail, setUserInviteEmail] = useState("");
  const [userInviteSending, setUserInviteSending] = useState(false);
  const [userInviteSendOk, setUserInviteSendOk] = useState<string | null>(null);
  const [userInviteSendErr, setUserInviteSendErr] = useState<string | null>(null);

  const loadCostReport = useCallback(() => {
    if (me?.role !== "admin") return Promise.resolve();
    setCostErr(null);
    setCostLoading(true);
    const q = new URLSearchParams({
      dateFrom: costDateFrom.trim(),
      dateTo: costDateTo.trim(),
      mediaType: costMedia,
    });
    return apiGet<AdminCostReportResponse>(`/api/admin/cost-report?${q}`)
      .then((r) => {
        setCostReport(r);
        setOpenCostPlans(new Set());
      })
      .catch((e) => {
        const raw = e instanceof Error ? e.message : String(e);
        try {
          const j = JSON.parse(raw) as { message?: string };
          setCostErr(j.message ?? raw);
        } catch {
          setCostErr(raw || "Falha ao carregar o relatório.");
        }
        setCostReport(null);
      })
      .finally(() => setCostLoading(false));
  }, [me?.role, costDateFrom, costDateTo, costMedia]);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me")
      .then((r) => {
        if (!r.ok) {
          if (r.status === 401) {
            setNeedLogin(true);
          } else {
            let msg = `Erro ao carregar o perfil (HTTP ${r.status}).`;
            if (r.bodyText) {
              try {
                const j = JSON.parse(r.bodyText) as { message?: string };
                if (j.message) msg = j.message;
              } catch {
                /* */
              }
            }
            setLoadErr(msg);
          }
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
      .then((r) => setPlans(r.plans))
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Falha ao carregar planos."));
  }, [me?.role]);

  useEffect(() => {
    if (me?.role === "admin" && tab === "planos") loadPlans();
  }, [me?.role, tab, loadPlans]);

  const runDiagnostics = useCallback(async () => {
    setDiagLoading(true);
    setDiagErr(null);
    try {
      const r = await apiGet<AdminDiagnosticsResponse>("/api/admin/diagnostics");
      setDiag(r);
    } catch (e) {
      setDiagErr(e instanceof Error ? e.message : "Falha ao executar diagnóstico.");
    } finally {
      setDiagLoading(false);
    }
  }, []);

  const loadPurgeSummary = useCallback(() => {
    if (me?.role !== "admin") return Promise.resolve();
    setPurgeErr(null);
    setPurgeOk(null);
    setPurgeLoading(true);
    return apiGet<SoftDeletedMemosMonthlySummaryResponse>("/api/admin/soft-deleted-memos/monthly-summary")
      .then((r) => setPurgeRows(r.rows ?? []))
      .catch((e) => {
        const raw = e instanceof Error ? e.message : String(e);
        try {
          const j = JSON.parse(raw) as { message?: string };
          setPurgeErr(j.message ?? raw);
        } catch {
          setPurgeErr(raw || "Falha ao carregar o resumo.");
        }
        setPurgeRows([]);
      })
      .finally(() => setPurgeLoading(false));
  }, [me?.role]);

  useEffect(() => {
    if (me?.role === "admin" && tab === "eliminacao") void loadPurgeSummary();
  }, [me?.role, tab, loadPurgeSummary]);

  useEffect(() => {
    if (me?.role !== "admin" || tab !== "custos") return;
    if (costFirstLoadRef.current) return;
    costFirstLoadRef.current = true;
    void loadCostReport();
  }, [me?.role, tab, loadCostReport]);

  const loadConsultaGroups = useCallback(() => {
    if (me?.role !== "admin") return Promise.resolve();
    return apiGet<{ groups: MemoContextGroupOption[] }>("/api/memo-context/groups")
      .then((r) => {
        setConsultaGroups(r.groups);
        setConsultaGroupsLoaded(true);
      })
      .catch(() => { /* silently fail */ });
  }, [me?.role]);

  useEffect(() => {
    if (me?.role === "admin" && tab === "consulta" && !consultaGroupsLoaded) {
      void loadConsultaGroups();
    }
  }, [me?.role, tab, consultaGroupsLoaded, loadConsultaGroups]);

  useEffect(() => {
    if (me?.role !== "admin" || tab !== "consulta") return;
    const qs = consultaCatGroupId != null ? `?groupId=${consultaCatGroupId}` : "";
    apiGet<MemoContextStructureResponse>(`/api/memo-context/structure${qs}`)
      .then((s) => {
        setConsultaCategorias(s.categories.filter((c) => c.isActive === 1));
        setConsultaCatNome("");
        setConsultaResult(null);
        setPendingCampoFiltros({});
      })
      .catch(() => setConsultaCategorias([]));
  }, [me?.role, tab, consultaCatGroupId]);

  const handleConsultar = useCallback((opts?: { offset?: number; sortKey?: string; sortDir?: "asc" | "desc" }) => {
    if (!consultaCatNome || me?.role !== "admin") return;
    const newOffset = opts?.offset ?? 0;
    const newSortKey = opts?.sortKey ?? consultaSortKey;
    const newSortDir = opts?.sortDir ?? consultaSortDir;
    setConsultaLoading(true);
    setConsultaErr(null);
    return apiPostJson<MemosListaResponse>("/api/memo-context/memos-lista", {
      categoryName: consultaCatNome,
      contextGroupId: consultaCatGroupId,
      workspaceGroupId: consultaFiltroGroupId,
      dataInicio: consultaDataInicio || null,
      dataFim: consultaDataFim || null,
      campoFiltros: pendingCampoFiltros,
      sortKey: newSortKey,
      sortDir: newSortDir,
      limit: 50,
      offset: newOffset,
    })
      .then((r) => {
        setConsultaResult(r);
        setConsultaOffset(newOffset);
        setConsultaSortKey(newSortKey);
        setConsultaSortDir(newSortDir);
      })
      .catch((e) => {
        const raw = e instanceof Error ? e.message : String(e);
        try {
          const j = JSON.parse(raw) as { message?: string };
          setConsultaErr(j.message ?? raw);
        } catch {
          setConsultaErr(raw || "Erro ao consultar.");
        }
      })
      .finally(() => setConsultaLoading(false));
  }, [me?.role, consultaCatNome, consultaCatGroupId, consultaFiltroGroupId, consultaDataInicio, consultaDataFim, pendingCampoFiltros, consultaSortKey, consultaSortDir]);

  const loadPromptConfigs = useCallback(() => {
    if (me?.role !== "admin") return Promise.resolve();
    setPromptsErr(null);
    return Promise.all([
      apiGet<LlmPromptConfigListResponse>("/api/admin/prompt-configs"),
      apiGet<AdminPromptCategoryListResponse>("/api/admin/prompt-configs/categories"),
    ])
      .then(([r, cats]) => {
        setPromptConfigs(r.configs);
        setPromptsLoaded(true);
        setCatAvailable(cats.categories);
        // seed drafts with current values
        setPromptDrafts((prev) => {
          const next = { ...prev };
          for (const c of r.configs) {
            if (!next[c.chave]) {
              next[c.chave] = { texto_padrao: c.texto_padrao ?? "", texto_atual: c.texto_atual ?? "" };
            }
          }
          return next;
        });
        // open all groups by default
        if (r.configs.length > 0) {
          setExpandedGroups((prev) => {
            if (prev.size > 0) return prev;
            return new Set(r.configs.map((c) => c.grupo));
          });
        }
      })
      .catch((e) => setPromptsErr(e instanceof Error ? e.message : "Erro ao carregar prompts."));
  }, [me?.role]);

  const loadCatOverrides = useCallback(async (chave: string) => {
    if (me?.role !== "admin") return;
    try {
      const r = await apiGet<LlmPromptCategoryOverrideListResponse>(
        `/api/admin/prompt-configs/${encodeURIComponent(chave)}/category-overrides`
      );
      setCatOverrides((prev) => ({ ...prev, [chave]: r.overrides }));
      setCatOverridesLoaded((prev) => new Set([...prev, chave]));
    } catch {
      // ignora erro silencioso; pode tentar novamente
    }
  }, [me?.role]);

  async function saveCatOverride(chave: string) {
    const draft = newCatOverride[chave];
    if (!draft || draft.categoryId === "") return;
    const key = `${chave}:${draft.categoryId}`;
    setCatOverrideSaving((prev) => new Set([...prev, key]));
    try {
      await apiGet<void>(`/api/admin/prompt-configs/${encodeURIComponent(chave)}/category-overrides/${draft.categoryId}`)
        .catch(() => null); // ignora — PUT faz upsert
      const resp = await fetch(
        `/api/admin/prompt-configs/${encodeURIComponent(chave)}/category-overrides/${draft.categoryId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ texto: draft.texto }),
        }
      );
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({})) as { message?: string };
        throw new Error(j.message ?? `HTTP ${resp.status}`);
      }
      setNewCatOverride((prev) => ({ ...prev, [chave]: { categoryId: "", texto: "" } }));
      await loadCatOverrides(chave);
    } catch (e) {
      setPromptsErr(e instanceof Error ? e.message : "Erro ao salvar override.");
    } finally {
      setCatOverrideSaving((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  }

  async function deleteCatOverride(chave: string, categoryId: number) {
    const key = `${chave}:${categoryId}`;
    setCatOverrideDeleting((prev) => new Set([...prev, key]));
    try {
      const resp = await fetch(
        `/api/admin/prompt-configs/${encodeURIComponent(chave)}/category-overrides/${categoryId}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await loadCatOverrides(chave);
    } catch (e) {
      setPromptsErr(e instanceof Error ? e.message : "Erro ao remover override.");
    } finally {
      setCatOverrideDeleting((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  }

  useEffect(() => {
    if (me?.role === "admin" && tab === "prompts" && !promptsLoaded) {
      void loadPromptConfigs();
    }
  }, [me?.role, tab, promptsLoaded, loadPromptConfigs]);

  // ── Aba IA ────────────────────────────────────────────────────────────────
  const [aiConfig, setAiConfig] = useState<AiConfigListResponse | null>(null);
  const [aiConfigLoading, setAiConfigLoading] = useState(false);
  const [aiConfigErr, setAiConfigErr] = useState<string | null>(null);
  const [aiDrafts, setAiDrafts] = useState<Record<string, Partial<AiConfigRow>>>({});
  const [aiSaving, setAiSaving] = useState<Record<string, boolean>>({});
  const [aiSaveOk, setAiSaveOk] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (me?.role !== "admin" || tab !== "ia" || aiConfig !== null) return;
    setAiConfigLoading(true);
    void apiGet<AiConfigListResponse>("/api/admin/ai-config")
      .then((data) => { setAiConfig(data); setAiConfigLoading(false); })
      .catch((e) => { setAiConfigErr(e instanceof Error ? e.message : "Erro ao carregar"); setAiConfigLoading(false); });
  }, [me?.role, tab, aiConfig]);

  const AI_DEFAULT_MODELS: Record<string, string> = {
    openai:           "gpt-4o-mini",
    google_gemini:    "gemini-1.5-flash",
    anthropic:        "claude-haiku-4-5-20251001",
    manus_proxy:      "gpt-4o-mini",
    microsoft_azure:  "gpt-4o-mini",
  };

  function aiDraft(op: string): Partial<AiConfigRow> { return aiDrafts[op] ?? {}; }
  function setAiDraftField<K extends keyof AiConfigRow>(op: string, field: K, val: AiConfigRow[K]) {
    setAiDrafts((prev) => ({ ...prev, [op]: { ...prev[op], [field]: val } }));
    setAiSaveOk((prev) => ({ ...prev, [op]: false }));
  }

  function changeAiProvider(op: string, newProvider: AiConfigProvider, currentModel: string) {
    const defaultModel = AI_DEFAULT_MODELS[newProvider] ?? "";
    setAiDrafts((prev) => ({
      ...prev,
      [op]: { ...prev[op], provider: newProvider, model: defaultModel || currentModel },
    }));
    setAiSaveOk((prev) => ({ ...prev, [op]: false }));
  }

  async function saveAiRow(row: AiConfigRow) {
    const draft = aiDrafts[row.operation] ?? {};
    const payload = {
      provider:    (draft.provider    ?? row.provider) as AiConfigProvider,
      model:       draft.model        ?? row.model,
      isEnabled:   draft.isEnabled    ?? row.isEnabled,
      maxTokens:   draft.maxTokens    !== undefined ? draft.maxTokens    : row.maxTokens,
      temperature: draft.temperature  !== undefined ? draft.temperature  : row.temperature,
      notes:       draft.notes        !== undefined ? draft.notes        : row.notes,
    };
    setAiSaving((prev) => ({ ...prev, [row.operation]: true }));
    try {
      await apiPutJson(`/api/admin/ai-config/${row.operation}`, payload);
      setAiConfig(null); // force reload
      setAiDrafts((prev) => { const n = { ...prev }; delete n[row.operation]; return n; });
      setAiSaveOk((prev) => ({ ...prev, [row.operation]: true }));
      setTimeout(() => setAiSaveOk((prev) => ({ ...prev, [row.operation]: false })), 2500);
    } catch (e) {
      setAiConfigErr(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setAiSaving((prev) => ({ ...prev, [row.operation]: false }));
    }
  }

  function togglePromptGroup(grupo: string) {
    setExpandedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(grupo)) n.delete(grupo);
      else n.add(grupo);
      return n;
    });
  }

  function setPromptDraft(chave: string, field: "texto_padrao" | "texto_atual", value: string) {
    setPromptDrafts((prev) => ({ ...prev, [chave]: { ...prev[chave]!, [field]: value } }));
    setPromptSaveOk((prev) => { const n = new Set(prev); n.delete(chave); return n; });
  }

  async function savePrompt(chave: string) {
    const draft = promptDrafts[chave];
    if (!draft) return;
    setPromptSaving((prev) => new Set([...prev, chave]));
    setPromptsErr(null);
    try {
      await apiPatchJson(`/api/admin/prompt-configs/${encodeURIComponent(chave)}`, {
        texto_padrao: draft.texto_padrao || null,
        texto_atual: draft.texto_atual || null,
      });
      setPromptSaveOk((prev) => new Set([...prev, chave]));
      await loadPromptConfigs();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      try { setPromptsErr((JSON.parse(raw) as { message?: string }).message ?? raw); } catch { setPromptsErr(raw); }
    } finally {
      setPromptSaving((prev) => { const n = new Set(prev); n.delete(chave); return n; });
    }
  }

  function cancelPrompt(chave: string) {
    const orig = promptConfigs.find((c) => c.chave === chave);
    if (!orig) return;
    setPromptDrafts((prev) => ({ ...prev, [chave]: { texto_padrao: orig.texto_padrao ?? "", texto_atual: orig.texto_atual ?? "" } }));
    setPromptSaveOk((prev) => { const n = new Set(prev); n.delete(chave); return n; });
  }

  function toggleCostPlan(planName: string) {
    setOpenCostPlans((prev) => {
      const n = new Set(prev);
      if (n.has(planName)) n.delete(planName);
      else n.add(planName);
      return n;
    });
  }

  async function handleHardDeleteMonth(month: string) {
    const row = purgeRows.find((r) => r.month === month);
    const n = row?.memosCount ?? 0;
    if (
      !window.confirm(
        `Eliminação definitiva do período ${month}: serão removidos ${n} memo(s) do banco e os arquivos associados no S3 ou disco, quando aplicável. Os registros em api_usage_logs permanecem (memoId fica NULL). Confirma?`
      )
    ) {
      return;
    }
    setHardDeletingMonth(month);
    setPurgeErr(null);
    setPurgeOk(null);
    try {
      const res = await apiPostJson<HardDeleteSoftDeletedMonthResponse>(
        "/api/admin/soft-deleted-memos/hard-delete-month",
        { month }
      );
      setPurgeOk(
        `Período ${res.month}: ${res.deletedMemos} memo(s) removidos; S3: ${res.s3ObjectsRemoved} objeto(s); disco: ${res.localFilesRemoved} arquivo(s).`
      );
      await loadPurgeSummary();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      try {
        const j = JSON.parse(raw) as { message?: string };
        setPurgeErr(j.message ?? raw);
      } catch {
        setPurgeErr(raw || "Falha na eliminação definitiva.");
      }
    } finally {
      setHardDeletingMonth(null);
    }
  }

  // ── Conexões BD — funções ──────────────────────────────────────────────────
  const loadDbConns = useCallback(() => {
    if (me?.role !== "admin") return Promise.resolve();
    setDbConnsLoading(true);
    setDbConnsErr(null);
    return Promise.all([
      apiGet<DbConnectionListResponse>("/api/admin/db-connections")
        .then((r) => setDbConns(r.connections)),
      apiGet<{ groups: MemoContextGroupOption[] }>("/api/memo-context/groups")
        .then((r) => setDbConnGroups(r.groups))
        .catch(() => {}),
    ])
      .catch((e) => setDbConnsErr(e instanceof Error ? e.message : "Falha ao carregar conexões."))
      .finally(() => setDbConnsLoading(false));
  }, [me?.role]);

  useEffect(() => {
    if (me?.role === "admin" && tab === "conexoes_bd") void loadDbConns();
  }, [me?.role, tab, loadDbConns]);

  useEffect(() => {
    if (me?.role !== "admin" || tab !== "convites_usuarios") return;
    setUserInvitesLoading(true);
    setUserInvitesErr(null);
    apiGet<{ invites: typeof userInvites }>("/api/admin/user-invites")
      .then((r) => setUserInvites(r.invites ?? []))
      .catch((e) => setUserInvitesErr(e instanceof Error ? e.message : "Falha ao carregar convites."))
      .finally(() => setUserInvitesLoading(false));
  }, [me?.role, tab]);

  function startEditDbConn(c: DbConnection) {
    setDbConnEditing(c.id);
    setDbConnForm({ ...c, password: "", groupId: c.groupId ?? null });
    setDbConnSaveOk(false);
  }

  function cancelEditDbConn() {
    setDbConnEditing(null);
    setDbConnForm(emptyDbConn());
    setDbConnSaveOk(false);
  }

  async function saveDbConn() {
    setDbConnSaving(true);
    setDbConnsErr(null);
    setDbConnSaveOk(false);
    try {
      if (dbConnEditing == null) {
        await apiPostJson<{ id: number }>("/api/admin/db-connections", {
          nome: dbConnForm.nome ?? "",
          descricao: dbConnForm.descricao ?? null,
          host: dbConnForm.host ?? "",
          port: dbConnForm.port ?? 1433,
          database: dbConnForm.database ?? "",
          username: dbConnForm.username ?? "",
          password: dbConnForm.password,
          encrypt: dbConnForm.encrypt ?? 0,
          trustServerCertificate: dbConnForm.trustServerCertificate ?? 1,
          groupId: dbConnForm.groupId ?? null,
        });
      } else {
        await apiPutJson(`/api/admin/db-connections/${dbConnEditing}`, {
          nome: dbConnForm.nome,
          descricao: dbConnForm.descricao ?? null,
          host: dbConnForm.host,
          port: dbConnForm.port,
          database: dbConnForm.database,
          username: dbConnForm.username,
          ...(dbConnForm.password ? { password: dbConnForm.password } : {}),
          encrypt: dbConnForm.encrypt ?? 0,
          trustServerCertificate: dbConnForm.trustServerCertificate ?? 1,
          groupId: dbConnForm.groupId ?? null,
        });
      }
      setDbConnSaveOk(true);
      setDbConnEditing(null);
      setDbConnForm(emptyDbConn());
      await loadDbConns();
    } catch (e) {
      setDbConnsErr(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setDbConnSaving(false);
    }
  }

  async function deleteDbConn(id: number, nome: string) {
    if (!window.confirm(`Desativar a conexão "${nome}"?`)) return;
    try {
      await apiDeleteJson<{ ok: boolean }>(`/api/admin/db-connections/${id}`);
      await loadDbConns();
    } catch (e) {
      setDbConnsErr(e instanceof Error ? e.message : "Erro ao desativar.");
    }
  }

  async function testDbConn(id: number) {
    setDbConnTesting((prev) => new Set([...prev, id]));
    setDbConnTestResults((prev) => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const result = await apiPostJson<DbConnectionTestResult>(`/api/admin/db-connections/${id}/test`, {});
      setDbConnTestResults((prev) => ({ ...prev, [id]: result }));
    } catch (e) {
      setDbConnTestResults((prev) => ({ ...prev, [id]: { ok: false, message: e instanceof Error ? e.message : "Erro" } }));
    } finally {
      setDbConnTesting((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }

  function openCreate() {
    setModalMode("create");
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(p: SubscriptionPlanAdmin) {
    setModalMode("edit");
    setEditing(p);
    setModalOpen(true);
  }

  async function handleDeletePlan(p: SubscriptionPlanAdmin) {
    if ((p.totalSubscriptionCount ?? 0) > 0) return;
    if (!window.confirm(`Excluir o plano "${p.name}"? Esta ação não pode ser desfeita.`)) return;
    setDeletingId(p.id);
    setLoadErr(null);
    try {
      await apiDeleteJson<{ ok?: boolean }>(`/api/admin/subscription-plans/${p.id}`);
      await loadPlans();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      try {
        const j = JSON.parse(raw) as { message?: string };
        setLoadErr(j.message ?? raw);
      } catch {
        setLoadErr(raw || "Não foi possível excluir o plano.");
      }
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className={styles.shell}>
        <Header />
        <main className={styles.main}>
          <p className="mm-muted">Carregando…</p>
        </main>
      </div>
    );
  }

  if (needLogin) {
    return (
      <div className={styles.shell}>
        <Header />
        <main className={styles.main}>
          <h1 className={styles.title}>Autenticação necessária</h1>
          <p className="mm-muted">Faça login para acessar o painel administrativo.</p>
          <Link to="/login" className={styles.back}>
            Ir ao login
          </Link>
        </main>
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className={styles.shell}>
        <Header />
        <main className={styles.main}>
          <p className="mm-error">{loadErr}</p>
        </main>
      </div>
    );
  }

  if (forbidden || me?.role !== "admin") {
    return (
      <div className={styles.shell}>
        <Header />
        <main className={styles.main}>
          <h1 className={styles.title}>Acesso negado</h1>
          <p className="mm-muted">Apenas administradores podem acessar esta área.</p>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <Header />
      <main
        className={`${styles.main} ${tab === "planos" || tab === "eliminacao" || tab === "custos" || tab === "consulta" ? styles.mainWide : ""}`}
      >
        <h1 className={styles.title}>Painel administrativo</h1>
        <p className={styles.lead}>Gestão de conteúdos e configurações da plataforma.</p>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "planos"}
            className={`${styles.tab} ${tab === "planos" ? styles.tabActive : ""}`}
            onClick={() => setTab("planos")}
          >
            Planos de assinatura
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "outros"}
            className={`${styles.tab} ${tab === "outros" ? styles.tabActive : ""}`}
            onClick={() => setTab("outros")}
          >
            Configurações
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "custos"}
            className={`${styles.tab} ${tab === "custos" ? styles.tabActive : ""}`}
            onClick={() => setTab("custos")}
          >
            Custos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "eliminacao"}
            className={`${styles.tab} ${tab === "eliminacao" ? styles.tabActive : ""}`}
            onClick={() => setTab("eliminacao")}
          >
            Eliminação definitiva
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "consulta"}
            className={`${styles.tab} ${tab === "consulta" ? styles.tabActive : ""}`}
            onClick={() => setTab("consulta")}
          >
            Consulta de memos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "prompts"}
            className={`${styles.tab} ${tab === "prompts" ? styles.tabActive : ""}`}
            onClick={() => setTab("prompts")}
          >
            Prompts LLM
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ia"}
            className={`${styles.tab} ${tab === "ia" ? styles.tabActive : ""}`}
            onClick={() => setTab("ia")}
          >
            Provedores IA
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "conexoes_bd"}
            className={`${styles.tab} ${tab === "conexoes_bd" ? styles.tabActive : ""}`}
            onClick={() => setTab("conexoes_bd")}
          >
            Conexões BD
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "convites_usuarios"}
            className={`${styles.tab} ${tab === "convites_usuarios" ? styles.tabActive : ""}`}
            onClick={() => setTab("convites_usuarios")}
          >
            Convites de usuários
          </button>
        </div>

        {tab === "eliminacao" ? (
          <div className={styles.panel}>
            <div className={styles.purgeHeader}>
              <h2 className={styles.purgeTitle}>
                <span className={styles.purgeTitleIcon} aria-hidden>
                  🗑️
                </span>{" "}
                Eliminação definitiva
              </h2>
              <p className={styles.purgeLead}>
                Memos e chats marcados como inativos (soft delete) por mês. O agrupamento usa o mês de{" "}
                <code className={styles.tableToolbarCode}>updatedAt</code> do memo (última alteração, em geral o soft
                delete). O hard delete remove permanentemente do banco os memos desse período; arquivos em S3 (chave{" "}
                <code className={styles.tableToolbarCode}>memos/…</code>) ou em disco (<code>/media/…</code>) são
                removidos quando reconhecidos. Os consumos em{" "}
                <code className={styles.tableToolbarCode}>api_usage_logs</code> são preservados (
                <code>memoId</code> passa a NULL).
              </p>
              <p className={styles.purgeNote}>
                <strong>Chats:</strong> contagem reservada (sempre 0) até existir modelo equivalente.
              </p>
            </div>
            {purgeErr ? <p className="mm-error">{purgeErr}</p> : null}
            {purgeOk ? (
              <p className={styles.purgeOk} role="status">
                {purgeOk}
              </p>
            ) : null}
            {purgeLoading ? (
              <p className="mm-muted">A carregar…</p>
            ) : purgeRows.length === 0 ? (
              <p className="mm-muted">Nenhum memo inativo por período.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Mês</th>
                      <th>Memos</th>
                      <th>Chats</th>
                      <th>Total</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purgeRows.map((r) => (
                      <tr key={r.month}>
                        <td>{r.month}</td>
                        <td>{r.memosCount}</td>
                        <td>{r.chatsCount}</td>
                        <td>{r.totalCount}</td>
                        <td>
                          <button
                            type="button"
                            className={styles.hardDeleteBtn}
                            disabled={hardDeletingMonth !== null || r.totalCount === 0}
                            onClick={() => void handleHardDeleteMonth(r.month)}
                          >
                            <IconTrash />
                            {hardDeletingMonth === r.month ? " A remover…" : " Hard Delete"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {tab === "outros" ? (
          <div className={styles.panel}>
            <p className="mm-muted" style={{ margin: "0 0 0.75rem" }}>
              Atalhos para áreas que não são a tabela de planos.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              <Link to="/admin/midia" className="mm-btn mm-btn--primary">Mídia por plano (media_settings)</Link>
              <Link to="/admin/documento-ia" className="mm-btn mm-btn--primary">Documento IA (ai_config)</Link>
              <Link to="/admin/llm-prompt" className="mm-btn mm-btn--primary">Último prompt LLM</Link>
              <Link to="/admin/cad-pipeline" className="mm-btn mm-btn--primary">CAD/BIM pipeline</Link>
              <Link to="/admin/system-config" className="mm-btn mm-btn--primary">Configurações do sistema</Link>
              <Link to="/admin/assinaturas" className="mm-btn mm-btn--primary">Assinaturas &amp; Grupos</Link>
              <Link to="/admin/storage" className="mm-btn mm-btn--primary">Storage por Grupo</Link>
            </div>

            <hr style={{ margin: "1.25rem 0", border: "none", borderTop: "1px solid var(--mm-border, #e2e2e2)" }} />

            <h2 className={styles.tableToolbarLabel} style={{ marginBottom: "0.5rem" }}>
              Diagnóstico de saúde
            </h2>
            <p className="mm-muted" style={{ margin: "0 0 0.75rem" }}>
              Testa as dependências usadas pela pergunta ao MyMemory (banco, embeddings e provedor de IA)
              e mostra a latência de cada uma. Útil para isolar erros de rede e gargalos de tempo.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                onClick={() => void runDiagnostics()}
                disabled={diagLoading}
              >
                {diagLoading ? "Executando…" : "Executar diagnóstico"}
              </button>
              {diag ? (
                <span className="mm-muted" style={{ fontSize: "0.85rem" }}>
                  Última execução: {new Date(diag.ranAt).toLocaleString()}
                </span>
              ) : null}
            </div>

            {diagErr ? (
              <p style={{ color: "var(--mm-danger, #c0392b)", marginTop: "0.75rem" }}>{diagErr}</p>
            ) : null}

            {diag ? (
              <table className={styles.table} style={{ marginTop: "0.75rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Verificação</th>
                    <th style={{ textAlign: "center" }}>Status</th>
                    <th style={{ textAlign: "right" }}>Latência</th>
                    <th style={{ textAlign: "left" }}>Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {diag.checks.map((c) => (
                    <tr key={c.id}>
                      <td>{c.label}</td>
                      <td style={{ textAlign: "center", color: c.ok ? "var(--mm-success, #27ae60)" : "var(--mm-danger, #c0392b)", fontWeight: 600 }}>
                        {c.ok ? "OK" : "FALHA"}
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.durationMs} ms</td>
                      <td style={{ wordBreak: "break-word" }}>{c.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ) : null}

        {tab === "custos" ? (
          <div className={styles.panel}>
            <h2 className={styles.tableToolbarLabel} style={{ marginBottom: "0.75rem" }}>
              Relatório de custos
            </h2>
            <p className={styles.costMeta}>
              Agrega <code className={styles.tableToolbarCode}>api_usage_logs</code> (custo API em USD, janela{" "}
              <code className={styles.tableToolbarCode}>createdAt</code>) e{" "}
              <code className={styles.tableToolbarCode}>download_logs</code> (
              <code className={styles.tableToolbarCode}>costUsd</code>,{" "}
              <code className={styles.tableToolbarCode}>usedCred</code>, janela{" "}
              <code className={styles.tableToolbarCode}>downloadedAt</code>), com{" "}
              <code className={styles.tableToolbarCode}>memos</code> para filtro de mídia e contexto de grupo. Coluna{" "}
              <strong>Plano</strong>: se o consumo é em contexto de grupo (<code>memo.groupId</code>), o nome vem do
              plano da subscrição desse grupo; caso contrário, do plano <strong>individual</strong> ativo do usuario.
              Coluna Créd. IA: soma dos créditos de API (USD agregados × fator configurado <em>hoje</em>) mais soma de{" "}
              <code className={styles.tableToolbarCode}>usedCred</code> dos downloads (cada linha gravada com o fator da
              altura).
            </p>
            <p className={styles.costMeta}>
              Nível 1: totais por <strong>plano</strong>. Nível 2 (▶): por <strong>grupo</strong> (nome,{" "}
              <code className={styles.tableToolbarCode}>groupId</code>, código de acesso) em planos de grupo; por{" "}
              <strong>usuario</strong> (nome, email, <code className={styles.tableToolbarCode}>userId</code>) em planos
              individuais.
            </p>
            <div className={styles.costFilters}>
              <div className={styles.costField}>
                <label htmlFor="cost-date-from">Data inicial</label>
                <input
                  id="cost-date-from"
                  type="date"
                  value={costDateFrom}
                  onChange={(e) => setCostDateFrom(e.target.value)}
                />
              </div>
              <div className={styles.costField}>
                <label htmlFor="cost-date-to">Data final</label>
                <input
                  id="cost-date-to"
                  type="date"
                  value={costDateTo}
                  onChange={(e) => setCostDateTo(e.target.value)}
                />
              </div>
              <div className={styles.costField}>
                <label htmlFor="cost-media">Mídia</label>
                <select
                  id="cost-media"
                  value={costMedia}
                  onChange={(e) => setCostMedia(e.target.value as AdminCostReportMediaFilter)}
                >
                  {COST_MEDIA_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                disabled={costLoading}
                onClick={() => void loadCostReport()}
              >
                {costLoading ? "A carregar…" : "Atualizar"}
              </button>
            </div>
            {costErr ? <p className="mm-error">{costErr}</p> : null}
            {costReport ? (
              <>
                <p className={styles.costMeta}>
                  Período: <strong>{costReport.dateFrom}</strong> — <strong>{costReport.dateTo}</strong>. Mídia:{" "}
                  <strong>{COST_MEDIA_OPTIONS.find((o) => o.value === costReport.mediaType)?.label ?? costReport.mediaType}</strong>
                  . Fator USD → créditos <strong>só na parte API</strong> deste relatório:{" "}
                  <strong>{costReport.credMultiplier}</strong> (downloads não usam este valor; usam{" "}
                  <code className={styles.tableToolbarCode}>usedCred</code>).
                </p>
                <div className={`${styles.tableWrap} ${styles.costTableWrap}`}>
                  <table className={`${styles.table} ${styles.costTable}`}>
                    <thead>
                      <tr>
                        <th scope="col">Plano</th>
                        <th scope="col">Grupo ou usuario</th>
                        <th scope="col">API (USD)</th>
                        <th scope="col">Créd. IA</th>
                        <th scope="col">Download (USD)</th>
                        <th scope="col">Soma preço plano (R$)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costReport.plans.map((plan) => {
                        const planOpen = openCostPlans.has(plan.planName);
                        return (
                          <Fragment key={plan.planName}>
                            <tr className={styles.costRowL1}>
                              <td>
                                <button
                                  type="button"
                                  className={styles.costExpandBtn}
                                  aria-expanded={planOpen}
                                  aria-label={planOpen ? "Fechar detalhe" : "Abrir grupo ou usuario"}
                                  onClick={() => toggleCostPlan(plan.planName)}
                                >
                                  {planOpen ? "▼" : "▶"}
                                </button>
                                {plan.planName}
                              </td>
                              <td>—</td>
                              <td>{formatUsd(plan.apiCostUsd)}</td>
                              <td>{formatCredIa(plan.credIa)}</td>
                              <td>{formatUsd(plan.downloadCostUsd)}</td>
                              <td>{fmtCatalogPlanPrice(plan.planPriceSum)}</td>
                            </tr>
                            {planOpen
                              ? plan.segments.map((seg) => (
                                  <tr
                                    key={`${plan.planName}-${seg.kind}-${seg.entityId}`}
                                    className={styles.costRowL2}
                                  >
                                    <td>{plan.planName}</td>
                                    <td>{seg.label}</td>
                                    <td>{formatUsd(seg.apiCostUsd)}</td>
                                    <td>{formatCredIa(seg.credIa)}</td>
                                    <td>{formatUsd(seg.downloadCostUsd)}</td>
                                    <td>{fmtCatalogPlanPrice(seg.planPriceSum)}</td>
                                  </tr>
                                ))
                              : null}
                          </Fragment>
                        );
                      })}
                      <tr className={styles.costRowTotal}>
                        <td colSpan={2}>Total geral</td>
                        <td>{formatUsd(costReport.totals.apiCostUsd)}</td>
                        <td>{formatCredIa(costReport.totals.credIa)}</td>
                        <td>{formatUsd(costReport.totals.downloadCostUsd)}</td>
                        <td>{fmtCatalogPlanPrice(costReport.totals.planPriceSum)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {costReport.plans.length === 0 ? (
                  <p className="mm-muted">Nenhum consumo no período e filtros escolhidos.</p>
                ) : null}
                <div className={styles.costDetail}>
                  <details>
                    <summary>Detalhe — últimas linhas de api_usage_logs (até 150)</summary>
                    <div className={styles.costDetailTableWrap}>
                      <table className={`${styles.table} ${styles.costDetailTable}`}>
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Quando</th>
                            <th>Usuario</th>
                            <th>Memo</th>
                            <th>Operação</th>
                            <th>Modelo</th>
                            <th>USD</th>
                            <th>Mídia</th>
                            <th>Grupo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {costReport.detailApi.map((r) => (
                            <tr key={r.id}>
                              <td>{r.id}</td>
                              <td>{r.createdAt}</td>
                              <td>{r.userId}</td>
                              <td>{r.memoId ?? "—"}</td>
                              <td>{r.operation}</td>
                              <td>{r.model}</td>
                              <td>{formatUsd(r.costUsd)}</td>
                              <td>{r.mediaType ?? "—"}</td>
                              <td>{r.groupId ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                  <details style={{ marginTop: "0.75rem" }}>
                    <summary>Detalhe — últimas linhas de download_logs (até 150)</summary>
                    <div className={styles.costDetailTableWrap}>
                      <table className={`${styles.table} ${styles.costDetailTable}`}>
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Quando</th>
                            <th>Usuario</th>
                            <th>Grupo</th>
                            <th>Memo</th>
                            <th>USD</th>
                            <th>Cred.</th>
                            <th>Mídia</th>
                          </tr>
                        </thead>
                        <tbody>
                          {costReport.detailDownloads.map((r) => (
                            <tr key={r.id}>
                              <td>{r.id}</td>
                              <td>{r.downloadedAt}</td>
                              <td>{r.userId}</td>
                              <td>{r.groupId ?? "—"}</td>
                              <td>{r.memoId ?? "—"}</td>
                              <td>{r.costUsd != null ? formatUsd(r.costUsd) : "—"}</td>
                              <td>{r.usedCred != null ? formatCredIa(r.usedCred) : "—"}</td>
                              <td>{r.mediaType ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              </>
            ) : costLoading ? (
              <p className="mm-muted">A carregar…</p>
            ) : costErr ? null : (
              <p className="mm-muted">Clique em «Atualizar» para carregar o relatório.</p>
            )}
          </div>
        ) : null}

        {tab === "prompts" ? (
          <div className={styles.panel}>
            <h2 className={styles.tableToolbarLabel} style={{ marginBottom: "0.25rem" }}>
              Configuração de prompts LLM
            </h2>
            <p className={styles.costMeta} style={{ marginBottom: "1rem" }}>
              Cada entrada tem um <strong>texto padrão</strong> (base de referência) e um{" "}
              <strong>texto atual</strong> (override ativo). Se o texto atual estiver vazio, o padrão é utilizado.
            </p>

            {promptsErr ? <p className="mm-error">{promptsErr}</p> : null}
            {!promptsLoaded ? (
              <p className="mm-muted">A carregar…</p>
            ) : promptConfigs.length === 0 ? (
              <p className="mm-muted">Nenhuma configuração encontrada.</p>
            ) : (
              <div className={styles.promptAccordion}>
                {Array.from(new Set(promptConfigs.map((c) => c.grupo))).map((grupo) => {
                  const items = promptConfigs.filter((c) => c.grupo === grupo);
                  const open = expandedGroups.has(grupo);
                  const GRUPO_LABELS: Record<string, string> = { perguntas: "Responder a Perguntas" };
                  const grupoLabel = GRUPO_LABELS[grupo] ?? grupo;
                  return (
                    <div key={grupo} className={styles.promptGroup}>
                      <button
                        type="button"
                        className={styles.promptGroupHeader}
                        onClick={() => togglePromptGroup(grupo)}
                        aria-expanded={open}
                      >
                        <span className={styles.promptGroupChevron}>{open ? "▼" : "▶"}</span>
                        <span className={styles.promptGroupTitle}>{grupoLabel}</span>
                        <span className={styles.promptGroupCount}>{items.length} config.</span>
                      </button>

                      {open ? (
                        <div className={styles.promptGroupBody}>
                          {items.map((cfg) => {
                            const draft = promptDrafts[cfg.chave] ?? {
                              texto_padrao: cfg.texto_padrao ?? "",
                              texto_atual: cfg.texto_atual ?? "",
                            };
                            const saving = promptSaving.has(cfg.chave);
                            const saved = promptSaveOk.has(cfg.chave);
                            const isDirty =
                              draft.texto_padrao !== (cfg.texto_padrao ?? "") ||
                              draft.texto_atual !== (cfg.texto_atual ?? "");
                            const hasCatOverrides = cfg.chave !== "perguntas_pipe1_classificacao_system";
                            const overridesForChave = catOverrides[cfg.chave] ?? [];
                            const catNewDraft = newCatOverride[cfg.chave] ?? { categoryId: "" as const, texto: "" };

                            // Carrega overrides na primeira vez que o card é renderizado
                            if (hasCatOverrides && !catOverridesLoaded.has(cfg.chave)) {
                              void loadCatOverrides(cfg.chave);
                            }

                            return (
                              <div key={cfg.chave} className={styles.promptCard}>
                                <div className={styles.promptCardHead}>
                                  <span className={styles.promptCardTitle}>{cfg.titulo}</span>
                                  <code className={styles.promptCardChave}>{cfg.chave}</code>
                                </div>

                                <div className={styles.promptFieldsRow}>
                                  <div className={styles.promptFieldGroup}>
                                    <div className={styles.promptFieldLabel}>
                                      <span>Texto padrão</span>
                                      <button
                                        type="button"
                                        className={styles.promptCopyBtn}
                                        onClick={() => void navigator.clipboard.writeText(draft.texto_padrao)}
                                      >
                                        Copiar
                                      </button>
                                    </div>
                                    <textarea
                                      className={styles.promptTextarea}
                                      value={draft.texto_padrao}
                                      rows={10}
                                      onChange={(e) => setPromptDraft(cfg.chave, "texto_padrao", e.target.value)}
                                      placeholder="Texto padrão (base de referência)"
                                    />
                                  </div>

                                  <div className={styles.promptFieldGroup}>
                                    <div className={styles.promptFieldLabel}>
                                      <span>
                                        Texto atual{" "}
                                        <em className={styles.promptFieldHint}>
                                          {hasCatOverrides
                                            ? "(override global — menos prioritário que override por categoria)"
                                            : "(override — vazio usa o padrão)"}
                                        </em>
                                      </span>
                                      <button
                                        type="button"
                                        className={styles.promptCopyBtn}
                                        onClick={() => void navigator.clipboard.writeText(draft.texto_atual)}
                                      >
                                        Copiar
                                      </button>
                                    </div>
                                    <textarea
                                      className={`${styles.promptTextarea} ${styles.promptTextareaAtual}`}
                                      value={draft.texto_atual}
                                      rows={10}
                                      onChange={(e) => setPromptDraft(cfg.chave, "texto_atual", e.target.value)}
                                      placeholder="Deixe vazio para usar o texto padrão"
                                    />
                                  </div>
                                </div>

                                <div className={styles.promptCardActions}>
                                  {saved && !isDirty ? (
                                    <span className={styles.promptSaveOk}>Salvo.</span>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="mm-btn mm-btn--ghost"
                                    disabled={saving || !isDirty}
                                    onClick={() => cancelPrompt(cfg.chave)}
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    type="button"
                                    className="mm-btn mm-btn--primary"
                                    disabled={saving || !isDirty}
                                    onClick={() => void savePrompt(cfg.chave)}
                                  >
                                    {saving ? "Salvando…" : "Salvar"}
                                  </button>
                                </div>

                                {hasCatOverrides ? (
                                  <div className={styles.promptCatOverridesSection}>
                                    <div className={styles.promptCatOverridesTitle}>
                                      Overrides por categoria
                                      <em className={styles.promptFieldHint}> (maior prioridade que texto atual)</em>
                                    </div>

                                    {overridesForChave.length > 0 ? (
                                      <table className={styles.promptCatTable}>
                                        <thead>
                                          <tr>
                                            <th>Categoria</th>
                                            <th>Texto</th>
                                            <th></th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {overridesForChave.map((ov) => {
                                            const delKey = `${cfg.chave}:${ov.category_id}`;
                                            const isDeleting = catOverrideDeleting.has(delKey);
                                            return (
                                              <tr key={ov.id}>
                                                <td className={styles.promptCatName}>
                                                  {ov.category_name ?? `#${ov.category_id}`}
                                                </td>
                                                <td>
                                                  <textarea
                                                    className={styles.promptCatTextarea}
                                                    defaultValue={ov.texto}
                                                    rows={4}
                                                    onBlur={(e) => {
                                                      const newTexto = e.currentTarget.value.trim();
                                                      if (newTexto && newTexto !== ov.texto) {
                                                        const saveKey = `${cfg.chave}:${ov.category_id}`;
                                                        setCatOverrideSaving((prev) => new Set([...prev, saveKey]));
                                                        fetch(
                                                          `/api/admin/prompt-configs/${encodeURIComponent(cfg.chave)}/category-overrides/${ov.category_id}`,
                                                          {
                                                            method: "PUT",
                                                            headers: { "Content-Type": "application/json" },
                                                            credentials: "include",
                                                            body: JSON.stringify({ texto: newTexto }),
                                                          }
                                                        )
                                                          .then(() => loadCatOverrides(cfg.chave))
                                                          .catch((err) => setPromptsErr(err instanceof Error ? err.message : "Erro ao salvar."))
                                                          .finally(() => setCatOverrideSaving((prev) => { const n = new Set(prev); n.delete(saveKey); return n; }));
                                                      }
                                                    }}
                                                  />
                                                  {catOverrideSaving.has(`${cfg.chave}:${ov.category_id}`) ? (
                                                    <span className={styles.promptSaveOk}>Salvando…</span>
                                                  ) : null}
                                                </td>
                                                <td>
                                                  <button
                                                    type="button"
                                                    className="mm-btn mm-btn--ghost"
                                                    disabled={isDeleting}
                                                    onClick={() => void deleteCatOverride(cfg.chave, ov.category_id)}
                                                  >
                                                    {isDeleting ? "…" : "Remover"}
                                                  </button>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    ) : (
                                      <p className="mm-muted" style={{ fontSize: "0.85rem", margin: "0.25rem 0 0.75rem" }}>
                                        Nenhum override por categoria cadastrado.
                                      </p>
                                    )}

                                    <div className={styles.promptCatAddRow}>
                                      <select
                                        className={styles.promptCatSelect}
                                        value={catNewDraft.categoryId}
                                        onChange={(e) =>
                                          setNewCatOverride((prev) => ({
                                            ...prev,
                                            [cfg.chave]: { ...catNewDraft, categoryId: e.target.value ? Number(e.target.value) : "" },
                                          }))
                                        }
                                      >
                                        <option value="">— Selecionar categoria —</option>
                                        {catAvailable
                                          .filter((cat) => !overridesForChave.some((ov) => ov.category_id === cat.id))
                                          .map((cat) => (
                                            <option key={cat.id} value={cat.id}>
                                              {cat.groupName ? `${cat.groupName} #${cat.groupId} — ` : ""}{cat.name}
                                            </option>
                                          ))}
                                      </select>
                                      <textarea
                                        className={styles.promptCatTextarea}
                                        rows={3}
                                        placeholder="Texto do override para esta categoria…"
                                        value={catNewDraft.texto}
                                        onChange={(e) =>
                                          setNewCatOverride((prev) => ({
                                            ...prev,
                                            [cfg.chave]: { ...catNewDraft, texto: e.target.value },
                                          }))
                                        }
                                      />
                                      <button
                                        type="button"
                                        className="mm-btn mm-btn--primary"
                                        disabled={
                                          catNewDraft.categoryId === "" ||
                                          !catNewDraft.texto.trim() ||
                                          catOverrideSaving.has(`${cfg.chave}:${catNewDraft.categoryId}`)
                                        }
                                        onClick={() => void saveCatOverride(cfg.chave)}
                                      >
                                        Adicionar
                                      </button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {tab === "planos" ? (
          <div className={styles.panel}>
            <div className={styles.toolbar}>
              <span className={styles.tableToolbarLabel}>
                Tabela <code className={styles.tableToolbarCode}>subscription_plans</code>
              </span>
              <button type="button" className="mm-btn mm-btn--primary" onClick={openCreate}>
                + Novo plano
              </button>
            </div>
            {loadErr ? <p className="mm-error">{loadErr}</p> : null}
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.tablePlans}`}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Preço</th>
                    <th>Máx. memos</th>
                    <th>Armaz. (GB)</th>
                    <th>Máx. membros</th>
                    <th>Cred. / mês</th>
                    <th>Download / mês (GB)</th>
                    <th>Áudio grande</th>
                    <th>Vídeo grande</th>
                    <th>Duração (dias)</th>
                    <th>Ativo</th>
                    <th className={styles.thIcon} scope="col" aria-label="Editar">
                      <IconPencil />
                    </th>
                    <th className={styles.thActions} scope="col">
                      Excluir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => {
                    const blocked = (p.totalSubscriptionCount ?? 0) > 0;
                    return (
                      <tr key={p.id}>
                        <td>{p.id}</td>
                        <td>{p.name}</td>
                        <td>
                          <span className={styles.badge}>
                            {p.planType === "group" ? "Grupo" : "Individual"}
                          </span>
                        </td>
                        <td>R$ {formatMoney(p.price)}</td>
                        <td>{p.maxMemos.toLocaleString("pt-BR")}</td>
                        <td>{formatMoney(p.maxStorageGB)}</td>
                        <td>{p.maxMembers ?? "—"}</td>
                        <td>{fmtCell(p.monthlyApiCredits)}</td>
                        <td>{fmtCell(p.monthlyDownloadLimitGB)}</td>
                        <td>{fmtYesNo(p.supportLargeAudio)}</td>
                        <td>{fmtYesNo(p.supportLargeVideo)}</td>
                        <td>{p.durationDays ?? "—"}</td>
                        <td>
                          <span className={`${styles.badge} ${p.isActive !== 1 ? styles.badgeOff : ""}`}>
                            {p.isActive === 1 ? "Sim" : "Não"}
                          </span>
                        </td>
                        <td className={styles.cellActions}>
                          <button
                            type="button"
                            className={styles.btnEditIcon}
                            onClick={() => openEdit(p)}
                            title={`Editar plano ${p.name}`}
                            aria-label={`Editar plano ${p.name}`}
                          >
                            <IconPencil />
                          </button>
                        </td>
                        <td className={styles.cellActions}>
                          <button
                            type="button"
                            className={styles.btnTrash}
                            disabled={blocked || deletingId === p.id}
                            title={deleteBlockTitle(p)}
                            aria-label={`Excluir plano ${p.name}`}
                            onClick={() => void handleDeletePlan(p)}
                          >
                            {deletingId === p.id ? (
                              <span className={styles.trashLoading} aria-hidden>
                                …
                              </span>
                            ) : (
                              <IconTrash />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {plans.length === 0 && !loadErr ? (
              <p className="mm-muted" style={{ marginTop: "0.75rem" }}>
                Nenhum plano. Clique em «Novo plano» ou execute o seed SQL.
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === "consulta" ? (
          <div className={styles.panel}>
            <h2 className={styles.tableToolbarLabel} style={{ marginBottom: "0.75rem" }}>
              Lista de memos por categoria
            </h2>

            <div className={styles.consultaFilters}>
              <div className={styles.consultaField}>
                <label htmlFor="consulta-cat-group">Grupo de categorias</label>
                <select
                  id="consulta-cat-group"
                  value={consultaCatGroupId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setConsultaCatGroupId(v === "" ? null : Number(v));
                    setConsultaResult(null);
                    setConsultaOffset(0);
                  }}
                >
                  <option value="">Global (sem grupo)</option>
                  {consultaGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div className={styles.consultaField}>
                <label htmlFor="consulta-cat">Categoria *</label>
                <select
                  id="consulta-cat"
                  value={consultaCatNome}
                  onChange={(e) => {
                    setConsultaCatNome(e.target.value);
                    setConsultaResult(null);
                    setConsultaOffset(0);
                    setPendingCampoFiltros({});
                  }}
                >
                  <option value="">— selecione —</option>
                  {consultaCategorias.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className={styles.consultaField}>
                <label htmlFor="consulta-filtro-group">Grupo de memos</label>
                <select
                  id="consulta-filtro-group"
                  value={consultaFiltroGroupId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setConsultaFiltroGroupId(v === "" ? null : Number(v));
                    setConsultaResult(null);
                    setConsultaOffset(0);
                  }}
                >
                  <option value="">Todos os grupos</option>
                  {consultaGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div className={styles.consultaField}>
                <label htmlFor="consulta-inicio">Data início</label>
                <input
                  id="consulta-inicio"
                  type="date"
                  value={consultaDataInicio}
                  onChange={(e) => setConsultaDataInicio(e.target.value)}
                />
              </div>

              <div className={styles.consultaField}>
                <label htmlFor="consulta-fim">Data fim</label>
                <input
                  id="consulta-fim"
                  type="date"
                  value={consultaDataFim}
                  onChange={(e) => setConsultaDataFim(e.target.value)}
                />
              </div>

              <button
                type="button"
                className="mm-btn mm-btn--primary"
                disabled={!consultaCatNome || consultaLoading}
                onClick={() => void handleConsultar()}
              >
                {consultaLoading ? "A consultar…" : "Consultar"}
              </button>
              {consultaResult ? (
                <button
                  type="button"
                  className={styles.printBtn}
                  title="Imprimir / salvar como PDF"
                  aria-label="Imprimir relatório da consulta"
                  onClick={() => window.print()}
                >
                  <IconPrint />
                </button>
              ) : null}
            </div>

            {consultaErr ? <p className="mm-error">{consultaErr}</p> : null}

            {consultaResult ? (
              <>
                <p className={styles.costMeta}>
                  {consultaResult.totalLinhas} registro(s).
                  {consultaResult.totalLinhas > 50
                    ? ` Exibindo ${consultaOffset + 1}–${Math.min(consultaOffset + 50, consultaResult.totalLinhas)}.`
                    : ""}
                </p>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        {consultaResult.colunas.map((col) => (
                          <th
                            key={col.key}
                            className={styles.consultaThSort}
                            onClick={() => {
                              const newDir =
                                consultaSortKey === col.key && consultaSortDir === "asc" ? "desc" : "asc";
                              void handleConsultar({ sortKey: col.key, sortDir: newDir, offset: 0 });
                            }}
                          >
                            {col.label}{" "}
                            {consultaSortKey === col.key ? (
                              <span className={styles.sortArrow}>{consultaSortDir === "asc" ? "▲" : "▼"}</span>
                            ) : (
                              <span className={styles.sortArrowInactive}>⇅</span>
                            )}
                          </th>
                        ))}
                      </tr>
                      <tr className={styles.consultaFilterRow}>
                        {consultaResult.colunas.map((col) => (
                          <th key={col.key}>
                            <input
                              className={styles.consultaColFilter}
                              value={pendingCampoFiltros[col.key] ?? ""}
                              onChange={(e) =>
                                setPendingCampoFiltros((prev) => ({ ...prev, [col.key]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void handleConsultar({ offset: 0 });
                              }}
                              placeholder="filtrar…"
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {consultaResult.linhas.length === 0 ? (
                        <tr>
                          <td colSpan={consultaResult.colunas.length} className={styles.consultaEmpty}>
                            Nenhum resultado.
                          </td>
                        </tr>
                      ) : (
                        consultaResult.linhas.map((row, i) => (
                          <tr key={i} className={i % 2 === 0 ? styles.consultaRowEven : styles.consultaRowOdd}>
                            {consultaResult.colunas.map((col) => (
                              <td key={col.key} className={styles.consultaTd}>
                                {fmtConsultaCell(col.key, row[col.key])}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {consultaResult.totalLinhas > 50 ? (
                  <div className={styles.consultaPaginacao}>
                    <button
                      type="button"
                      className="mm-btn mm-btn--ghost"
                      disabled={consultaOffset === 0 || consultaLoading}
                      onClick={() => void handleConsultar({ offset: Math.max(0, consultaOffset - 50) })}
                    >
                      ← Anterior
                    </button>
                    <span className={styles.costMeta}>
                      {consultaOffset + 1}–{Math.min(consultaOffset + 50, consultaResult.totalLinhas)} de{" "}
                      {consultaResult.totalLinhas}
                    </span>
                    <button
                      type="button"
                      className="mm-btn mm-btn--ghost"
                      disabled={consultaOffset + 50 >= consultaResult.totalLinhas || consultaLoading}
                      onClick={() => void handleConsultar({ offset: consultaOffset + 50 })}
                    >
                      Próximo →
                    </button>
                  </div>
                ) : null}
              </>
            ) : consultaLoading ? (
              <p className="mm-muted">A consultar…</p>
            ) : null}
          </div>
        ) : null}

        {tab === "ia" ? (
          <div className={styles.panel}>
            <h2 className={styles.tableToolbarLabel} style={{ marginBottom: "0.5rem" }}>
              Provedores de IA
            </h2>
            <p className="mm-muted" style={{ marginBottom: "1rem", fontSize: "0.88rem" }}>
              Configure qual provedor e modelo será usado para cada operação. As API keys devem estar no <code>.env</code> do servidor.
            </p>

            {aiConfigErr ? <p className="mm-error">{aiConfigErr}</p> : null}

            {aiConfig ? (
              <>
                <div className={styles.aiProviderBadges}>
                  <span className={`${styles.aiProviderBadge} ${aiConfig.providersConfigured.openai ? styles.aiProviderBadgeOn : styles.aiProviderBadgeOff}`}>
                    OpenAI {aiConfig.providersConfigured.openai ? "✓" : "sem key"}
                  </span>
                  <span className={`${styles.aiProviderBadge} ${aiConfig.providersConfigured.gemini ? styles.aiProviderBadgeOn : styles.aiProviderBadgeOff}`}>
                    Gemini {aiConfig.providersConfigured.gemini ? "✓" : "sem key"}
                  </span>
                  <span className={`${styles.aiProviderBadge} ${aiConfig.providersConfigured.anthropic ? styles.aiProviderBadgeOn : styles.aiProviderBadgeOff}`}>
                    Anthropic {aiConfig.providersConfigured.anthropic ? "✓" : "sem key"}
                  </span>
                </div>

                <div className={styles.aiRows}>
                  {aiConfig.rows.map((row) => {
                    const draft = aiDraft(row.operation);
                    const isReadOnly = row.operation === "audio_transcription_ia";
                    const provider = (draft.provider ?? row.provider) as AiConfigProvider;
                    const model = draft.model ?? row.model;
                    const isEnabled = draft.isEnabled ?? row.isEnabled;
                    const maxTokens = draft.maxTokens !== undefined ? draft.maxTokens : row.maxTokens;
                    const temperature = draft.temperature !== undefined ? draft.temperature : row.temperature;
                    const saving = aiSaving[row.operation] ?? false;
                    const saveOk = aiSaveOk[row.operation] ?? false;

                    return (
                      <div key={row.operation} className={styles.aiRow}>
                        <div className={styles.aiRowHeader}>
                          <strong className={styles.aiRowName}>{row.displayName}</strong>
                          <code className={styles.aiRowOp}>{row.operation}</code>
                          {isReadOnly ? (
                            <span className={styles.aiReadOnlyBadge}>somente leitura</span>
                          ) : null}
                        </div>

                        <div className={styles.aiRowFields}>
                          <div className={styles.aiField}>
                            <label>Provedor</label>
                            {isReadOnly ? (
                              <span className="mm-muted">{row.provider}</span>
                            ) : (
                              <select
                                className="mm-field"
                                value={provider}
                                onChange={(e) => changeAiProvider(row.operation, e.target.value as AiConfigProvider, model)}
                              >
                                {AI_PROVIDER_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            )}
                          </div>

                          <div className={`${styles.aiField} ${styles.aiFieldModel}`}>
                            <label>Modelo</label>
                            {isReadOnly ? (
                              <span className="mm-muted">{row.model}</span>
                            ) : (
                              <input
                                className="mm-field"
                                value={model}
                                onChange={(e) => setAiDraftField(row.operation, "model", e.target.value)}
                                placeholder="ex: gpt-4o-mini"
                                maxLength={100}
                              />
                            )}
                          </div>

                          <div className={styles.aiField}>
                            <label>Max tokens</label>
                            {isReadOnly ? (
                              <span className="mm-muted">—</span>
                            ) : (
                              <input
                                className="mm-field"
                                type="number"
                                min={1}
                                value={maxTokens ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value.trim();
                                  setAiDraftField(row.operation, "maxTokens", v === "" ? null : Number(v));
                                }}
                                placeholder="—"
                                style={{ width: "90px" }}
                              />
                            )}
                          </div>

                          <div className={styles.aiField}>
                            <label>Temperatura</label>
                            {isReadOnly ? (
                              <span className="mm-muted">—</span>
                            ) : (
                              <input
                                className="mm-field"
                                type="number"
                                min={0}
                                max={2}
                                step={0.1}
                                value={temperature ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value.trim();
                                  setAiDraftField(row.operation, "temperature", v === "" ? null : Number(v));
                                }}
                                placeholder="—"
                                style={{ width: "80px" }}
                              />
                            )}
                          </div>

                          {!isReadOnly ? (
                            <div className={styles.aiField}>
                              <label>Ativo</label>
                              <input
                                type="checkbox"
                                checked={isEnabled}
                                onChange={(e) => setAiDraftField(row.operation, "isEnabled", e.target.checked)}
                                style={{ width: "auto", marginTop: "0.25rem" }}
                              />
                            </div>
                          ) : null}
                        </div>

                        {!isReadOnly ? (
                          <div className={styles.aiRowActions}>
                            <button
                              type="button"
                              className="mm-btn mm-btn--primary"
                              disabled={saving}
                              onClick={() => void saveAiRow(row)}
                            >
                              {saving ? "Salvando…" : "Salvar"}
                            </button>
                            {saveOk ? (
                              <span className={styles.aiSaveOk}>✓ Salvo</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : aiConfigLoading ? (
              <p className="mm-muted">Carregando…</p>
            ) : null}
          </div>
        ) : null}

        {tab === "conexoes_bd" ? (
          <div className={styles.panel}>
            <h2 className={styles.sectionTitle}>Conexões de Banco de Dados</h2>
            <p className="mm-muted" style={{ marginBottom: "1.5rem" }}>
              Conexões SQL Server externas usadas pelos query templates. Deixe o campo Senha vazio ao editar para manter a senha atual.
            </p>

            {dbConnsErr ? <p className="mm-error" style={{ marginBottom: "1rem" }}>{dbConnsErr}</p> : null}
            {dbConnSaveOk ? <p style={{ color: "var(--color-success, green)", marginBottom: "1rem" }}>Salvo com sucesso.</p> : null}

            {/* Formulário criar / editar */}
            <div className={styles.dbConnForm}>
              <h3 className={styles.dbConnFormTitle}>
                {dbConnEditing != null ? "Editar conexão" : "Nova conexão"}
              </h3>
              <div className={styles.dbConnFields}>
                <label className={styles.dbConnField}>
                  <span>Nome *</span>
                  <input className="mm-field" value={dbConnForm.nome ?? ""} onChange={(e) => setDbConnForm((p) => ({ ...p, nome: e.target.value }))} placeholder="Ex: ERP SQL Server" />
                </label>
                <label className={styles.dbConnField}>
                  <span>Descrição</span>
                  <input className="mm-field" value={dbConnForm.descricao ?? ""} onChange={(e) => setDbConnForm((p) => ({ ...p, descricao: e.target.value || null }))} placeholder="Opcional" />
                </label>
                <label className={styles.dbConnField}>
                  <span>Host *</span>
                  <input className="mm-field" value={dbConnForm.host ?? ""} onChange={(e) => setDbConnForm((p) => ({ ...p, host: e.target.value }))} placeholder="servidor.dominio.com" />
                </label>
                <label className={styles.dbConnField} style={{ maxWidth: "120px" }}>
                  <span>Porta</span>
                  <input className="mm-field" type="number" value={dbConnForm.port ?? 1433} onChange={(e) => setDbConnForm((p) => ({ ...p, port: Number(e.target.value) }))} />
                </label>
                <label className={styles.dbConnField}>
                  <span>Banco de dados *</span>
                  <input className="mm-field" value={dbConnForm.database ?? ""} onChange={(e) => setDbConnForm((p) => ({ ...p, database: e.target.value }))} placeholder="NomeDoBanco" />
                </label>
                <label className={styles.dbConnField}>
                  <span>Usuário *</span>
                  <input className="mm-field" value={dbConnForm.username ?? ""} onChange={(e) => setDbConnForm((p) => ({ ...p, username: e.target.value }))} placeholder="sa" />
                </label>
                <label className={styles.dbConnField}>
                  <span>{dbConnEditing != null ? "Senha (vazio = manter)" : "Senha *"}</span>
                  <input className="mm-field" type="password" value={dbConnForm.password} onChange={(e) => setDbConnForm((p) => ({ ...p, password: e.target.value }))} autoComplete="new-password" />
                </label>
                <label className={styles.dbConnField}>
                  <span>Grupo (owner)</span>
                  <select
                    className="mm-field"
                    value={dbConnForm.groupId ?? ""}
                    onChange={(e) => setDbConnForm((p) => ({ ...p, groupId: e.target.value === "" ? null : Number(e.target.value) }))}
                  >
                    <option value="">— Sem grupo (admin only) —</option>
                    {dbConnGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
                <label className={styles.dbConnField} style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem", maxWidth: "fit-content" }}>
                  <input type="checkbox" checked={dbConnForm.encrypt === 1} onChange={(e) => setDbConnForm((p) => ({ ...p, encrypt: e.target.checked ? 1 : 0 }))} />
                  <span>Criptografar conexão</span>
                </label>
                <label className={styles.dbConnField} style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem", maxWidth: "fit-content" }}>
                  <input type="checkbox" checked={dbConnForm.trustServerCertificate === 1} onChange={(e) => setDbConnForm((p) => ({ ...p, trustServerCertificate: e.target.checked ? 1 : 0 }))} />
                  <span>Confiar no certificado do servidor</span>
                </label>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  className="mm-btn mm-btn--primary"
                  disabled={dbConnSaving || !(
                    dbConnForm.nome?.trim() &&
                    dbConnForm.host?.trim() &&
                    dbConnForm.database?.trim() &&
                    dbConnForm.username?.trim() &&
                    (dbConnEditing != null || !!dbConnForm.password)
                  )}
                  onClick={() => void saveDbConn()}
                >
                  {dbConnSaving ? "Salvando…" : dbConnEditing != null ? "Atualizar" : "Criar"}
                </button>
                {dbConnEditing != null ? (
                  <button type="button" className="mm-btn mm-btn--ghost" onClick={cancelEditDbConn}>
                    Cancelar
                  </button>
                ) : null}
              </div>
            </div>

            {/* Lista de conexões */}
            {dbConnsLoading ? (
              <p className="mm-muted">Carregando…</p>
            ) : (
              <div className={styles.dbConnList}>
                {dbConns.filter((c) => c.isActive === 1).length === 0 ? (
                  <p className="mm-muted">Nenhuma conexão cadastrada.</p>
                ) : (
                  dbConns
                    .filter((c) => c.isActive === 1)
                    .map((c) => {
                      const testResult = dbConnTestResults[c.id];
                      const testing = dbConnTesting.has(c.id);
                      return (
                        <div key={c.id} className={styles.dbConnRow}>
                          <div className={styles.dbConnRowInfo}>
                            <strong>{c.nome}</strong>
                            <span className="mm-muted">{c.host}:{c.port} / {c.database} — usuário: {c.username}</span>
                            {c.groupId ? (
                              <span style={{ fontSize: "0.78rem", color: "#6366f1", fontWeight: 600 }}>
                                Grupo: {dbConnGroups.find((g) => g.id === c.groupId)?.name ?? `#${c.groupId}`}
                              </span>
                            ) : (
                              <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>Admin only (sem grupo)</span>
                            )}
                            {c.descricao ? <span className="mm-muted" style={{ fontStyle: "italic" }}>{c.descricao}</span> : null}
                          </div>
                          <div className={styles.dbConnRowActions}>
                            <button type="button" className="mm-btn mm-btn--ghost" disabled={testing} onClick={() => void testDbConn(c.id)}>
                              {testing ? "Testando…" : "Testar"}
                            </button>
                            <button type="button" className="mm-btn mm-btn--ghost" onClick={() => startEditDbConn(c)}>
                              Editar
                            </button>
                            <button type="button" className="mm-btn mm-btn--ghost" style={{ color: "var(--color-danger, #c00)" }} onClick={() => void deleteDbConn(c.id, c.nome)}>
                              Desativar
                            </button>
                          </div>
                          {testResult ? (
                            <div className={styles.dbConnTestResult} style={{ color: testResult.ok ? "var(--color-success, green)" : "var(--color-danger, #c00)" }}>
                              {testResult.ok ? `✓ ${testResult.message}${testResult.latencyMs != null ? ` (${testResult.latencyMs}ms)` : ""}` : `✗ ${testResult.message}`}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                )}
              </div>
            )}
          </div>
        ) : null}
        {tab === "convites_usuarios" ? (
          <div className={styles.panel}>
            <h2 className={styles.sectionTitle}>Convites de usuários</h2>
            <p className="mm-muted" style={{ marginBottom: "1.5rem" }}>
              Envie um convite por e-mail para uma pessoa criar conta pessoal no MyMemory. O status é atualizado automaticamente quando o cadastro é concluído.
            </p>

            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", marginBottom: "1.5rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px" }}>
                <label className={styles.tableToolbarLabel} htmlFor="ui-email" style={{ display: "block", marginBottom: "0.35rem" }}>E-mail do convidado</label>
                <input
                  id="ui-email"
                  type="email"
                  className="mm-field"
                  value={userInviteEmail}
                  onChange={(e) => { setUserInviteEmail(e.target.value); setUserInviteSendOk(null); setUserInviteSendErr(null); }}
                  placeholder="nome@exemplo.com"
                  disabled={userInviteSending}
                />
              </div>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                disabled={userInviteSending || !userInviteEmail.trim()}
                onClick={() => {
                  if (!userInviteEmail.trim()) return;
                  setUserInviteSending(true);
                  setUserInviteSendOk(null);
                  setUserInviteSendErr(null);
                  apiPostJson<{ inviteId: number; emailSendFailed?: boolean; message?: string }>(
                    "/api/admin/user-invites",
                    { email: userInviteEmail.trim() }
                  )
                    .then((r) => {
                      setUserInviteEmail("");
                      setUserInviteSendOk(r.emailSendFailed ? (r.message ?? "Convite registrado, mas o e-mail não foi enviado.") : "Convite enviado com sucesso.");
                      return apiGet<{ invites: typeof userInvites }>("/api/admin/user-invites").then((d) => setUserInvites(d.invites ?? []));
                    })
                    .catch((e) => {
                      const raw = e instanceof Error ? e.message : String(e);
                      try { setUserInviteSendErr((JSON.parse(raw) as { message?: string }).message ?? raw); } catch { setUserInviteSendErr(raw); }
                    })
                    .finally(() => setUserInviteSending(false));
                }}
              >
                {userInviteSending ? "Enviando…" : "Enviar convite"}
              </button>
            </div>

            {userInviteSendOk ? <p style={{ color: "var(--color-success, green)", marginBottom: "1rem" }}>{userInviteSendOk}</p> : null}
            {userInviteSendErr ? <p className="mm-error" style={{ marginBottom: "1rem" }}>{userInviteSendErr}</p> : null}
            {userInvitesErr ? <p className="mm-error" style={{ marginBottom: "1rem" }}>{userInvitesErr}</p> : null}

            {userInvitesLoading ? (
              <p className="mm-muted">A carregar…</p>
            ) : userInvites.length === 0 ? (
              <p className="mm-muted">Nenhum convite enviado ainda.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>E-mail</th>
                      <th>Status</th>
                      <th>Enviado em</th>
                      <th>Expira em</th>
                      <th>Aceito em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userInvites.map((inv) => (
                      <tr key={inv.id}>
                        <td>{inv.email}</td>
                        <td>
                          <span style={{
                            fontWeight: 600,
                            color: inv.status === "accepted" ? "var(--color-success, green)" : inv.status === "expired" ? "var(--color-muted, #888)" : "var(--color-warning, #b45309)",
                          }}>
                            {inv.status === "accepted" ? "Aceito" : inv.status === "expired" ? "Expirado" : "Pendente"}
                          </span>
                        </td>
                        <td>{new Date(inv.createdAt).toLocaleString("pt-BR")}</td>
                        <td>{new Date(inv.expiresAt).toLocaleString("pt-BR")}</td>
                        <td>{inv.acceptedAt ? new Date(inv.acceptedAt).toLocaleString("pt-BR") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </main>

      <PlanModal
        open={modalOpen}
        mode={modalMode}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSaved={loadPlans}
      />
    </div>
  );
}
