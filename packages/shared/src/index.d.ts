/** Tipos compartilhados entre API e Web — MyMemory SaaS */
/** Modo de processamento por IA ao registrar foto (upload imagem). */
export type PhotoAiUsage = "none" | "keywords" | "full";
export declare const PHOTO_AI_USAGE_LABELS: Record<PhotoAiUsage, string>;
export type PlanCode = "free" | "pro" | "business";
export type MediaKind = "audio" | "video" | "image" | "document" | "web";
/** Valores de `memos.mediaType` no MySQL */
export type MemoMediaTypeDb = "text" | "audio" | "image" | "video" | "document" | "url";
export interface MemoCreatedResponse {
    id: number;
    mediaType: MemoMediaTypeDb;
    mediaText: string;
    createdAt: string;
}
/** Card “memos recentes” na home */
export interface MemoRecentCard {
    id: number;
    mediaType: MemoMediaTypeDb;
    headline: string;
    createdAt: string;
    mediaWebUrl: string | null;
    hasFile: boolean;
}
export interface MeResponse {
    id: number;
    name: string | null;
    email: string | null;
    groupLabel: string;
}
export interface Plan {
    id: number;
    code: PlanCode;
    name: string;
    maxMemosPerMonth: number;
    maxStorageMb: number;
    aiSearchEnabled: boolean;
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
//# sourceMappingURL=index.d.ts.map