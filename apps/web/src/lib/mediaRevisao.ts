const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

/**
 * Arquivo recém-enviado na tela de revisão: com S3 (URL absoluta) passa pelo servidor
 * (/api/media-revisao), para o bucket poder ficar privado; disco local (/media/…) segue como está.
 */
export function urlMediaRevisao(url: string | null | undefined): string {
  const u = (url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return u;
  return `${apiBase}/api/media-revisao?url=${encodeURIComponent(u)}`;
}
