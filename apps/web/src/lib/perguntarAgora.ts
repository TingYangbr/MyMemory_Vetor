/**
 * Pergunta para o Perguntar fazer sozinho ao abrir (vinda de Perguntas salvas ou de Meus avisos).
 * Vai pelo sessionStorage porque a Home troca os parâmetros da URL ao abrir e o state da navegação se perde.
 */
const CHAVE = "mm_perguntar_agora";

export function pedirPerguntaAgora(texto: string): void {
  try { sessionStorage.setItem(CHAVE, JSON.stringify({ texto, em: Date.now() })); } catch { /* sem storage */ }
}

/** Lê e apaga o pedido; ignora pedidos com mais de 1 minuto. */
export function pegarPerguntaAgora(): string | null {
  try {
    const raw = sessionStorage.getItem(CHAVE);
    if (!raw) return null;
    sessionStorage.removeItem(CHAVE);
    const p = JSON.parse(raw) as { texto?: string; em?: number };
    if (!p.texto || !p.em || Date.now() - p.em > 60_000) return null;
    return p.texto;
  } catch {
    return null;
  }
}
