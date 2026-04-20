/** Campos mínimos para derivar rótulo de anexo / URL (busca e recentes). */
export type MemoLikeForAttachmentLabel = {
  mediaType: string;
  mediaWebUrl: string | null;
  mediaMetadata: string | null;
  mediaAudioUrl: string | null;
  mediaImageUrl: string | null;
  mediaVideoUrl: string | null;
  mediaDocumentUrl: string | null;
};

export function primaryMediaFileUrlFromMemoLike(
  r: Pick<
    MemoLikeForAttachmentLabel,
    | "mediaType"
    | "mediaImageUrl"
    | "mediaVideoUrl"
    | "mediaAudioUrl"
    | "mediaDocumentUrl"
  >
): string | null {
  if (r.mediaType === "url" && r.mediaDocumentUrl?.trim()) return r.mediaDocumentUrl.trim();
  const u =
    r.mediaImageUrl?.trim() ||
    r.mediaVideoUrl?.trim() ||
    r.mediaAudioUrl?.trim() ||
    r.mediaDocumentUrl?.trim() ||
    "";
  return u || null;
}

function basenameFromStorageUrl(url: string): string {
  const noQuery = (url.split("?")[0] ?? "").split("#")[0] ?? "";
  const last = noQuery.split("/").pop() ?? "";
  if (!last) return "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function attachmentDisplayNameFromMemoLike(r: MemoLikeForAttachmentLabel): string | null {
  let meta: Record<string, unknown> = {};
  try {
    if (r.mediaMetadata) meta = JSON.parse(r.mediaMetadata) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  const origName = typeof meta.originalName === "string" && meta.originalName.trim() ? meta.originalName.trim() : null;
  const origFile =
    typeof meta.originalFilename === "string" && meta.originalFilename.trim() ? meta.originalFilename.trim() : null;
  if (origName) return origName;
  if (origFile) return origFile;

  const fileUrl = primaryMediaFileUrlFromMemoLike(r);
  if (fileUrl?.trim()) {
    const base = basenameFromStorageUrl(fileUrl.trim());
    if (base) return base;
  }

  if (r.mediaType === "url" && r.mediaWebUrl?.trim()) {
    return r.mediaWebUrl.trim();
  }

  return null;
}
