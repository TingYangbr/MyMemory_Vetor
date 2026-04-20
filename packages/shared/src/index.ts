/** Tipos compartilhados entre API e Web — MyMemory SaaS */

/** Modo de processamento por IA ao registrar foto (upload imagem). */
export type PhotoAiUsage = "none" | "keywords" | "full";

export const PHOTO_AI_USAGE_LABELS: Record<PhotoAiUsage, string> = {
  none: "Sem IA",
  keywords: "Keywords",
  full: "Completo",
};

export type PlanCode = "free" | "pro" | "business";

export type MediaKind = "audio" | "video" | "image" | "document" | "web";

/** Valores de `memos.mediaType` no MySQL */
export type MemoMediaTypeDb =
  | "text"
  | "audio"
  | "image"
  | "video"
  | "document"
  | "url";

/** Nível de uso de IA por tipo de mídia (tabela `users`). */
export type UserIaUseLevel = "semIA" | "basico" | "completo";

export const USER_IA_USE_LEVELS: readonly UserIaUseLevel[] = ["semIA", "basico", "completo"] as const;

/** Converte preferência de usuário (`users.iaUse*`) para o modo de upload de foto/mídia na API. */
export function photoAiUsageFromUserIaLevel(level: UserIaUseLevel | undefined | null): PhotoAiUsage {
  if (level === "semIA") return "none";
  if (level === "completo") return "full";
  return "keywords";
}

export const USER_IA_USE_LABELS: Record<UserIaUseLevel, string> = {
  semIA: "Sem IA",
  basico: "Básico",
  completo: "Completo",
};

export interface UserMemoPreferences {
  /** Confirmar captura antes do envio / processamento IA (não confundir com revisão pós-IA). */
  confirmEnabled: boolean;
  soundEnabled: boolean;
  /** Se ligado, a IA pode devolver campos livres em `dadosEspecificosJson` quando não houver match de categoria/campos. */
  allowFreeSpecificFieldsWithoutCategoryMatch: boolean;
  iaUseTexto: UserIaUseLevel;
  iaUseImagem: UserIaUseLevel;
  iaUseVideo: UserIaUseLevel;
  iaUseAudio: UserIaUseLevel;
  iaUseDocumento: UserIaUseLevel;
  iaUseUrl: UserIaUseLevel;
  /**
   * `null` = desligado. Valor 1–100: se a confiança global do Tesseract (imagem) for **menor** que isto,
   * a API extrai o texto de novo com LLM visão antes do resumo (custo extra só nesse caso).
   */
  imageOcrVisionMinConfidence: number | null;
}

export interface PatchMePreferencesResponse {
  ok: true;
  preferences: UserMemoPreferences;
}

export interface MemoCreatedResponse {
  id: number;
  mediaType: MemoMediaTypeDb;
  mediaText: string;
  createdAt: string;
}

/** Resposta de `POST /api/memos/text/process` antes da tela de revisão. */
export interface TextMemoProcessResponse {
  originalText: string;
  suggestedMediaText: string;
  suggestedKeywords: string;
  maxSummaryChars: number;
  /** Custo estimado USD das chamadas OpenAI (0 se sem IA ou sem chave). */
  apiCost: number;
  iaLevel: UserIaUseLevel;
  processingWarning?: string | null;
  /** Presente em `POST /api/memos/url/process` — memo final é tipo `url`. */
  mediaWebUrl?: string;
  /** HTML arquivado (fluxo URL); gravado em `mediaDocumentUrl` na confirmação. */
  mediaDocumentUrl?: string | null;
  /**
   * JSON stringificado do objeto de campos específicos (chave → valor), ex.: `{"Autor":"…"}`.
   * Omitido ou null quando a IA não devolveu campos.
   */
  dadosEspecificosJson?: string | null;
  /** JSON stringificado com os valores originais extraídos antes da padronização. */
  dadosEspecificosOriginaisJson?: string | null;
  /** Categoria reconhecida no contexto (quando houver match exato/aproximado). */
  matchedCategoryId?: number | null;
}

/** Corpo de `POST /api/memos/text/confirm` após o usuário revisar. */
export interface TextMemoConfirmBody {
  mediaText: string;
  keywords: string;
  groupId: number | null;
  apiCost: number;
  /** Texto original antes da revisão (gravado em mediaMetadata). */
  originalText: string;
  /** Nível usado no processamento (deve coincidir com a revisão). */
  iaLevel?: UserIaUseLevel;
  /** Objeto JSON (string) de campos específicos; omitido = null na base. */
  dadosEspecificosJson?: string | null;
  /** Objeto JSON (string) com os valores originais extraídos antes da padronização. */
  dadosEspecificosOriginaisJson?: string | null;
  /** Categoria reconhecida no processamento da IA, quando disponível. */
  matchedCategoryId?: number | null;
}

/** Corpo de `POST /api/memos/url/confirm` após revisão do memo por URL. */
export interface UrlMemoConfirmBody {
  mediaWebUrl: string;
  /** Caminho do HTML arquivado — coluna `mediaDocumentUrl` (memo tipo `url`). */
  mediaDocumentUrl?: string | null;
  mediaText: string;
  keywords: string;
  groupId: number | null;
  apiCost: number;
  originalText: string;
  iaLevel?: UserIaUseLevel;
  dadosEspecificosJson?: string | null;
  dadosEspecificosOriginaisJson?: string | null;
  matchedCategoryId?: number | null;
}

/** Estado passado ao navegar para a página de revisão de memo texto. */
export type TextMemoReviewNavState = TextMemoProcessResponse & { groupId: number | null };

/** Origem do texto sugerido no fluxo imagem (gravado em metadata no confirm). */
export type ImageMemoProcessSource = "none" | "ocr_text" | "vision_basic" | "vision_full";

/** Resposta de `POST /api/memos/image/process` (imagem já enviada ao armazenamento). */
export interface ImageMemoProcessResponse extends TextMemoProcessResponse {
  mediaImageUrl: string;
  originalFilename: string;
  tamMediaUrl: number;
  source: ImageMemoProcessSource;
  /**
   * Confiança global do Tesseract (0–100) na primeira leitura, antes de qualquer re-extração por visão.
   * `null` se não houve OCR (ex.: sem IA) ou se o motor não devolveu valor.
   */
  tesseractConfidence: number | null;
  /**
   * Cópia da preferência do usuario (1–100) que define o mínimo de confiança para re-extração por visão;
   * `null` se a funcionalidade está desligada. Útil para mostrar p.ex. `72/90` na revisão.
   */
  imageOcrVisionMinConfidence: number | null;
  /**
   * Limiar de caracteres (`media_settings` / plano) aplicado neste processamento.
   * Na revisão: mostrar bloco de texto OCR só quando esse texto é referência útil (ramo `ocr_text`, ou `none` com OCR acima do limiar).
   * Respostas novas da API incluem sempre; estados de navegação antigos podem omitir (UI usa 100).
   */
  textImagemMin?: number;
}

export interface ImageMemoConfirmBody {
  mediaText: string;
  keywords: string;
  dadosEspecificosJson?: string | null;
  dadosEspecificosOriginaisJson?: string | null;
  matchedCategoryId?: number | null;
  groupId: number | null;
  apiCost: number;
  originalText: string;
  iaLevel?: UserIaUseLevel;
  mediaImageUrl: string;
  tamMediaUrl: number;
  originalFilename: string;
  source: ImageMemoProcessSource;
}

export type ImageMemoReviewNavState = ImageMemoProcessResponse & { groupId: number | null };

/** Origem do texto no fluxo áudio (transcrição + LLM). */
export type AudioMemoProcessSource = "none" | "speech_basic" | "speech_full" | "speech_segmented";

/** Resposta de `POST /api/memos/audio/process` (áudio já gravado no armazenamento). */
export interface AudioMemoProcessResponse extends TextMemoProcessResponse {
  mediaAudioUrl: string;
  originalFilename: string;
  tamMediaUrl: number;
  source: AudioMemoProcessSource;
}

export interface AudioMemoConfirmBody {
  mediaText: string;
  keywords: string;
  groupId: number | null;
  apiCost: number;
  originalText: string;
  iaLevel?: UserIaUseLevel;
  /** Igual ao fluxo texto/imagem — preenchido pela IA no modo completo. */
  dadosEspecificosJson?: string | null;
  /** Valor original extraído antes de eventual padronização. */
  dadosEspecificosOriginaisJson?: string | null;
  matchedCategoryId?: number | null;
  mediaAudioUrl: string;
  tamMediaUrl: number;
  originalFilename: string;
  source: AudioMemoProcessSource;
}

export type AudioMemoReviewNavState = AudioMemoProcessResponse & { groupId: number | null };

/** Origem do texto no fluxo vídeo (transcrição + LLM ou fotogramas + visão). */
export type VideoMemoProcessSource =
  | "none"
  | "video_basic"
  | "video_full"
  | "video_segmented"
  | "video_vision_basic"
  | "video_vision_full";

/** Resposta de `POST /api/memos/video/process` (vídeo já gravado no armazenamento). */
export interface VideoMemoProcessResponse extends TextMemoProcessResponse {
  mediaVideoUrl: string;
  originalFilename: string;
  tamMediaUrl: number;
  source: VideoMemoProcessSource;
  /**
   * Limiar `media_settings.textImagemMin` (tipo imagem do plano): transcrição de áudio com mais caracteres
   * (e não classificada como ruído) segue fluxo de texto; caso contrário, descrição por fotogramas.
   */
  textImagemMin?: number;
}

export interface VideoMemoConfirmBody {
  mediaText: string;
  keywords: string;
  groupId: number | null;
  apiCost: number;
  originalText: string;
  iaLevel?: UserIaUseLevel;
  mediaVideoUrl: string;
  tamMediaUrl: number;
  originalFilename: string;
  source: VideoMemoProcessSource;
}

export type VideoMemoReviewNavState = VideoMemoProcessResponse & { groupId: number | null };

/** Resposta de `POST /api/memos/document/process` (documento já gravado no memo). */
export interface DocumentMemoProcessResponse extends TextMemoProcessResponse {
  memoId: number;
  mediaDocumentUrl: string;
  originalFilename: string;
  mime: string;
  /** Pipeline de extração (ex.: extract_pdf_text, extract_utf8_text). */
  pipelineUsed: string;
  tamMediaUrl: number;
}

/** Corpo de `POST /api/memos/document/confirm`. */
export interface DocumentMemoConfirmBody {
  memoId: number;
  mediaText: string;
  keywords: string;
  /** Objeto JSON (string) de campos específicos; omitido = null na base. */
  dadosEspecificosJson?: string | null;
  /** Objeto JSON (string) com os valores originais extraídos antes da padronização. */
  dadosEspecificosOriginaisJson?: string | null;
  matchedCategoryId?: number | null;
  groupId: number | null;
  apiCost: number;
  originalText: string;
  iaLevel?: UserIaUseLevel;
  mediaDocumentUrl: string;
  tamMediaUrl: number;
  originalFilename: string;
  mime: string;
  pipelineUsed: string;
}

/** Estado inicial na rota de revisão: ids + nível de IA escolhido na confirmação (se houver). */
export type DocumentMemoReviewLocationState = {
  memoId: number;
  groupId: number | null;
  /** Se omitido, `document/process` usa a preferência de documento no perfil. */
  iaUseDocumento?: UserIaUseLevel;
};

/** Card “memos recentes” na home */
export interface MemoRecentCard {
  id: number;
  mediaType: MemoMediaTypeDb;
  /** Resumo curto (lista); o texto completo está em `mediaText`. */
  headline: string;
  /** Texto do memo (`memos.mediaText`). */
  mediaText: string;
  createdAt: string;
  mediaWebUrl: string | null;
  hasFile: boolean;
  /** Lista em texto (vírgulas); coluna `memos.keywords`. */
  keywords: string | null;
  /** JSON object (string) em `memos.dadosEspecificosJson` — campos específicos da IA. */
  dadosEspecificosJson?: string | null;
  /** URL relativa do anexo principal (`/media/...`) para pré-visualização. */
  mediaFileUrl: string | null;
  /** Nome do arquivo, URL completa ou rótulo derivado (ex.: busca — linha principal do cartão). */
  attachmentDisplayName?: string | null;
  /** Autor do memo — para mostrar editar/excluir só ao dono. */
  userId: number;
  /** Custo API em USD (memo texto com IA, etc.). */
  apiCost?: number;
  /** Créditos consumidos (`apiCost` × fator da config). */
  usedApiCred?: number;
}

/** Termo normalizado (minúsculas) para realce na UI; `bucket` distingue ramo OR (0 = primeiro, …). */
export interface MemoSearchHighlightTerm {
  term: string;
  bucket: number;
}

/** Escopo da expressão SQL em `POST /api/memos/search`. */
export type MemoSearchMode = "all" | "mediaText" | "keywords" | "dadosEspecificos";

/** Resposta de `POST /api/memos/search`. */
export interface MemoSearchResponse {
  items: MemoRecentCard[];
  totalCount: number;
  displayLabel: string;
  highlightTerms: MemoSearchHighlightTerm[];
}

/** Resposta de `POST /api/memos/search/synonyms`. */
export interface MemoSearchSynonymsResponse {
  synonyms: string[];
  /** Grupo OR sugerido, ex.: `(Contrato OR acordo OR convenção)`. */
  suggestedQuery: string;
  costUsd: number;
  /** Sinónimos não gerados (ex.: LLM indisponível). */
  unavailable?: boolean;
}

/** Detalhe do memo para edição pelo autor (`GET /api/memos/:id`). */
export interface MemoAuthorEditResponse {
  id: number;
  mediaType: MemoMediaTypeDb;
  groupId: number | null;
  mediaText: string;
  keywords: string | null;
  /** JSON object (string) em `memos.dadosEspecificosJson`. */
  dadosEspecificosJson?: string | null;
  /** JSON ou texto bruto de `memos.mediaMetadata`. */
  mediaMetadata: string | null;
  apiCost: number;
  usedApiCred: number;
  createdAt: string;
  mediaWebUrl: string | null;
  hasFile: boolean;
  mediaFileUrl: string | null;
}

export interface PatchMemoResponse {
  ok: true;
  memo: MemoCreatedResponse;
}

export interface DeleteMemoResponse {
  ok: true;
}

export interface MeResponse {
  id: number;
  name: string | null;
  email: string | null;
  groupLabel: string;
  /** `null` = contexto pessoal; caso contrário id do grupo em `groups`. */
  lastWorkspaceGroupId: number | null;
  /** Presente quando a API envia perfil estendido */
  role?: "user" | "admin";
  /** Admin ou dono de grupo (assinatura grupo ou role owner em group_members) */
  memoContextAccess?: boolean;
  emailVerified?: boolean;
  /** De `system_config.showApiCost` — exibir custo USD e créditos na UI de memos. */
  showApiCost?: boolean;
  /** De `system_config.fatorCredCost` — multiplicador para estimativa de créditos no cliente. */
  usdToCreditsMultiplier?: number;
  /** Preferências de memo (após migração 008_user_memo_preferences.sql) */
  soundEnabled?: boolean;
  confirmEnabled?: boolean;
  allowFreeSpecificFieldsWithoutCategoryMatch?: boolean;
  iaUseTexto?: UserIaUseLevel;
  iaUseImagem?: UserIaUseLevel;
  iaUseVideo?: UserIaUseLevel;
  iaUseAudio?: UserIaUseLevel;
  iaUseDocumento?: UserIaUseLevel;
  iaUseUrl?: UserIaUseLevel;
  /** Ver `UserMemoPreferences.imageOcrVisionMinConfidence`. */
  imageOcrVisionMinConfidence?: number | null;
}

/** Métrica usada / limite para barras de progresso (`GET /api/me/usage`). */
export interface UserUsageMetric {
  used: number;
  /** `null` = sem plano ou limite não definido no plano. */
  limit: number | null;
}

/** `GET /api/me/usage` — consumo do usuario vs limites do plano (individual ou grupo do qual é dono). */
export interface UserUsageDashboardResponse {
  planName: string;
  memos: UserUsageMetric;
  storageGB: UserUsageMetric;
  apiCreditsMonth: UserUsageMetric;
  downloadsMonthGB: UserUsageMetric;
}

/** Limites de tamanho de arquivo por mídia (`GET /api/me/media-limits`), alinhados a `media_settings` + plano. */
export interface UserMediaLimitsResponse {
  maxFileBytes: {
    audio: number;
    video: number;
    image: number;
    document: number;
    default: number;
    /** Processamento simples — memo texto (`media_settings` linha `text`). */
    text: number;
    /** Processamento simples — página HTML (`media_settings` linha `html`). */
    html: number;
  };
  supportLargeAudio: boolean;
  supportLargeVideo: boolean;
}

/** Linha de `media_settings` (admin). */
export type MediaSettingsMediaTypeDb =
  | "audio"
  | "image"
  | "video"
  | "document"
  | "default"
  | "text"
  | "html";

export interface AdminMediaSettingRow {
  id: number;
  planId: number;
  mediaType: MediaSettingsMediaTypeDb;
  /** Máximo em KB para processamento simples deste tipo. */
  maxFileSizeKB: number;
  /** Só na linha `video`: duração alvo por segmento (minutos) no processamento grande (modelo B). */
  videoChunkMinutes: number | null;
  /** Só na linha `audio`: duração alvo por segmento (minutos) no processamento grande (modelo B). */
  audioChunkMinutes: number | null;
  /** Só na linha `video`: máximo em KB para processamento grande de vídeo (com flag no plano). */
  maxLargeVideoKb: number | null;
  /** Só na linha `audio`: máximo em KB para processamento grande de áudio (com flag no plano). */
  maxLargeAudioKb: number | null;
  maxSummaryChars: number;
  textImagemMin: number;
  compressBeforeAI: 0 | 1;
}

/** `GET /api/admin/subscription-plans/:planId/media-settings` */
export interface AdminMediaSettingsResponse {
  planId: number;
  planName: string;
  supportLargeAudio: 0 | 1;
  supportLargeVideo: 0 | 1;
  rows: AdminMediaSettingRow[];
}

export type AdminMediaSettingPutRow = Pick<
  AdminMediaSettingRow,
  | "mediaType"
  | "maxFileSizeKB"
  | "videoChunkMinutes"
  | "audioChunkMinutes"
  | "maxLargeVideoKb"
  | "maxLargeAudioKb"
  | "maxSummaryChars"
  | "textImagemMin"
  | "compressBeforeAI"
>;

/** Corpo de `PUT /api/admin/subscription-plans/:planId/media-settings` */
export interface AdminMediaSettingsPutBody {
  rows: AdminMediaSettingPutRow[];
}

/** Alinha com `clientUploadKind` na web: limite em bytes para envio. */
export type ClientUploadMediaKind = "image" | "video" | "audio" | "document";

export function maxBytesForClientUploadKind(
  limits: UserMediaLimitsResponse,
  kind: ClientUploadMediaKind
): number {
  return limits.maxFileBytes[kind] ?? limits.maxFileBytes.default;
}

/** Normaliza uma palavra-chave para comparação (deduplicação). */
export function normalizeMemoKeywordKey(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Remove repetições na string de keywords (separador vírgula).
 * Mantém a primeira grafia de cada variante (uma ocorrência por chave normalizada).
 */
export function dedupeMemoKeywordsCommaSeparated(raw: string | null | undefined): string {
  if (raw == null || typeof raw !== "string") return "";
  const byNorm = new Map<string, string>();
  for (const bit of raw.split(",")) {
    const s = bit.trim();
    if (!s.length) continue;
    const norm = normalizeMemoKeywordKey(s);
    if (!byNorm.has(norm)) byNorm.set(norm, s);
  }
  return [...byNorm.values()].join(", ");
}

/** Item em seletores da estrutura contextual */
export interface MemoContextGroupOption {
  id: number;
  name: string;
}

/** Grupo onde o usuário pode trabalhar (membro ou dono da assinatura). */
export interface WorkspaceGroupItem {
  id: number;
  name: string;
  /** Assinatura de grupo como owner ou `group_members.role = owner`. */
  isOwner: boolean;
  /** Texto do grupo; ajuda a distinguir nomes iguais entre grupos diferentes. */
  description: string | null;
  /** Dono da assinatura do grupo — útil quando o usuário é só membro. */
  subscriptionOwnerEmail: string | null;
}

export interface WorkspaceGroupsResponse {
  groups: WorkspaceGroupItem[];
}

export interface PatchWorkspaceResponse {
  ok: true;
  lastWorkspaceGroupId: number | null;
  groupLabel: string;
}

export type MemoContextMediaType = MemoMediaTypeDb;

export interface MemoContextCategory {
  id: number;
  /** `null` = categoria do contexto “grupo vazio” (global). */
  groupId: number | null;
  /**
   * `null` = a categoria classifica memo de qualquer mídia.
   * Valor preenchido = só faz sentido para aquele tipo (ex.: `audio` = só memos de áudio).
   */
  mediaType: MemoContextMediaType | null;
  name: string;
  description: string | null;
  isActive: number;
  createdAt: string;
  updatedAt: string;
  subcategories: MemoContextSubcategory[];
  campos: MemoContextCampo[];
}

export interface MemoContextSubcategory {
  id: number;
  categoryId: number;
  name: string;
  description: string | null;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoContextCampo {
  id: number;
  categoryId: number;
  name: string;
  description: string | null;
  /** Termos padronizados para o valor deste campo (separados por vírgula no editor). */
  normalizedTerms: string | null;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoContextStructureCapabilities {
  canEditStructure: boolean;
}

/** GET structure — ver docs/schemas/memo-context.schema.json */
export interface MemoContextStructureResponse {
  categories: MemoContextCategory[];
  capabilities: MemoContextStructureCapabilities;
}

/** GET /api/memo-context/editor-meta — selectors e papel do usuário */
export interface MemoContextEditorMetaResponse {
  isAdmin: boolean;
  ownedGroups: MemoContextGroupOption[];
  /** Só para admin; dono de grupo usa apenas `ownedGroups`. */
  allGroups: MemoContextGroupOption[] | null;
}

export interface Plan {
  id: number;
  code: PlanCode;
  name: string;
  maxMemosPerMonth: number;
  maxStorageMb: number;
  aiSearchEnabled: boolean;
}

/** Linha de `subscription_plans` (admin) — decimais podem vir como string da API. */
export type SubscriptionPlanTypeDb = "individual" | "group";

export interface SubscriptionPlanAdmin {
  id: number;
  name: string;
  planType: SubscriptionPlanTypeDb;
  price: number;
  maxMemos: number;
  maxStorageGB: number;
  maxMembers: number | null;
  durationDays: number | null;
  isActive: number;
  monthlyApiCredits: number | null;
  monthlyDownloadLimitGB: number | null;
  supportLargeAudio: number;
  supportLargeVideo: number;
  createdAt: string;
  updatedAt: string;
  /** Só na listagem admin GET */
  activeSubscriptionCount?: number;
  /** Só na listagem admin GET — qualquer linha em `subscriptions` impede excluir o plano */
  totalSubscriptionCount?: number;
}

export interface SubscriptionPlansListResponse {
  plans: SubscriptionPlanAdmin[];
}

/** Planos individuais ativos para escolha no cadastro. */
export interface IndividualPlanOption {
  id: number;
  name: string;
  price: number;
  maxMemos: number;
  maxStorageGB: number;
  maxMembers: number | null;
  durationDays: number | null;
}

export interface IndividualPlansResponse {
  plans: IndividualPlanOption[];
}

/** Plano de assinatura tipo grupo (mesmos campos que o individual na listagem pública). */
export type GroupPlanOption = IndividualPlanOption;

export interface GroupPlansResponse {
  plans: GroupPlanOption[];
}

export interface CreateGroupResponse {
  ok: true;
  groupId: number;
  subscriptionId: number;
  name: string;
}

export interface GroupOwnerPanelInviteRow {
  id: number;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export interface GroupOwnerPanelResponse {
  ok: true;
  group: {
    id: number;
    name: string;
    description: string | null;
    allowFreeSpecificFieldsWithoutCategoryMatch: boolean;
  };
  invites: GroupOwnerPanelInviteRow[];
}

export interface PatchGroupOwnerSettingsResponse {
  ok: true;
  group: {
    id: number;
    name: string;
    description: string | null;
    allowFreeSpecificFieldsWithoutCategoryMatch: boolean;
  };
}

export interface CreateGroupInviteResponse {
  ok: true;
  inviteId: number;
  emailSendFailed?: boolean;
  message?: string;
}

export interface AcceptGroupInviteResponse {
  ok: true;
  groupId: number;
  groupName: string;
  alreadyMember?: boolean;
}

/** Uma linha do resumo de memos inativos (soft delete) agrupados por mês de `updatedAt`. */
export interface SoftDeletedMemosMonthlyRow {
  month: string;
  memosCount: number;
  /** Reservado para chats; hoje sempre 0. */
  chatsCount: number;
  totalCount: number;
}

export interface SoftDeletedMemosMonthlySummaryResponse {
  ok: true;
  rows: SoftDeletedMemosMonthlyRow[];
}

export interface HardDeleteSoftDeletedMonthResponse {
  ok: true;
  month: string;
  deletedMemos: number;
  s3ObjectsRemoved: number;
  localFilesRemoved: number;
}

export interface UserPublic {
  id: number;
  email: string;
  displayName: string;
  plan: Plan | null;
}

export interface MemoListItem {
  id: number;
  title: string;
  createdAt: string;
  mediaCount: number;
  aiSummary: string | null;
}

export interface MemoDetail extends MemoListItem {
  sourceUrl: string | null;
  assets: MemoAssetPublic[];
}

export interface MemoAssetPublic {
  id: number;
  mediaKind: MediaKind;
  mimeType: string;
  fileName: string;
  aiExtractedText: string | null;
}

export interface SearchHit {
  memoId: number;
  title: string;
  snippet: string;
  score: number;
  reason: string;
}

/** Log de uso de API — sempre memoId (não factId); null se a operação não está ligada a um memo */
export interface ApiUsageLogRow {
  id: number;
  memoId: number | null;
  userId: number;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  audioDurationSeconds: number;
  costUsd: number;
  createdAt: Date;
}

/** Filtro de mídia em `GET /api/admin/cost-report`. */
export type AdminCostReportMediaFilter = "all" | MemoMediaTypeDb;

/**
 * Nível 2 do relatório de custos: em planos de **grupo**, uma linha por `groupId` agregado;
 * em planos **individuais**, uma linha por `userId` (consumo pessoal / sem memo / memo órfão fundidos).
 */
export interface AdminCostReportSegmentRow {
  kind: "group" | "user";
  /** `groupId` se `kind === "group"`, senão `userId`. */
  entityId: number;
  /** Rótulo com nome, códigos e id numérico (montado na API). */
  label: string;
  apiCostUsd: number;
  credIa: number;
  downloadCostUsd: number;
  /**
   * Soma de `subscription_plans.price` para todas as linhas do catálogo com `name` igual ao plano desta linha.
   * `null` se o nome do plano no relatório não existir em `subscription_plans` (ex.: «Sem plano individual»).
   */
  planPriceSum: number | null;
}

/** Nível 1: totais por nome de plano (`subscription_plans`). */
export interface AdminCostReportPlanRow {
  planName: string;
  apiCostUsd: number;
  credIa: number;
  downloadCostUsd: number;
  /** Igual a cada segmento: soma de `price` no catálogo para este `planName`. */
  planPriceSum: number | null;
  segments: AdminCostReportSegmentRow[];
}

export interface AdminCostReportTotals {
  apiCostUsd: number;
  credIa: number;
  downloadCostUsd: number;
  /** Soma dos `planPriceSum` de cada linha de plano (nível 1); ignora `null` como 0. */
  planPriceSum: number;
}

export interface AdminCostReportDetailApiRow {
  id: number;
  createdAt: string;
  userId: number;
  memoId: number | null;
  operation: string;
  model: string;
  costUsd: number;
  mediaType: string | null;
  groupId: number | null;
}

export interface AdminCostReportDetailDownloadRow {
  id: number;
  downloadedAt: string;
  userId: number;
  groupId: number | null;
  memoId: number | null;
  costUsd: number | null;
  usedCred: number | null;
  mediaType: string | null;
}

/** Resposta de `GET /api/admin/cost-report`. */
export interface AdminCostReportResponse {
  ok: true;
  dateFrom: string;
  dateTo: string;
  mediaType: AdminCostReportMediaFilter;
  /**
   * Fator USD → créditos usado só para converter totais de custo de **API** neste relatório (`creditsFromUsdCost`).
   * Downloads entram via `usedCred` gravado por linha; não são recalculados com este valor.
   */
  credMultiplier: number;
  plans: AdminCostReportPlanRow[];
  totals: AdminCostReportTotals;
  detailApi: AdminCostReportDetailApiRow[];
  detailDownloads: AdminCostReportDetailDownloadRow[];
}

export type AdminLlmPromptRole = "system" | "user" | "assistant";

export interface AdminLlmPromptMessage {
  role: AdminLlmPromptRole;
  content: string;
}

/** Última chamada LLM mantida apenas em memória da API (volátil). */
export interface AdminLlmLastPromptResponse {
  ok: true;
  trace: {
    createdAt: string;
    provider: "openai" | "forge";
    model: string;
    source: string;
    messages: AdminLlmPromptMessage[];
  } | null;
}
