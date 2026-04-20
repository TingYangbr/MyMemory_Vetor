/** Alinhado com admin / `media_settings`: NULL → default; clamp 1–120. */
export const DEFAULT_CHUNK_MINUTES = 10;
const MIN_CHUNK_MIN = 1;
const MAX_CHUNK_MIN = 120;

export function clampChunkMinutes(raw: number | null | undefined): number {
  const d =
    raw != null && Number.isFinite(Number(raw)) && Number(raw) > 0 ? Math.floor(Number(raw)) : DEFAULT_CHUNK_MINUTES;
  return Math.min(MAX_CHUNK_MIN, Math.max(MIN_CHUNK_MIN, d));
}
