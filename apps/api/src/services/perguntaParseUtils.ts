/**
 * Extrai o campo "resposta" do JSON do LLM de forma defensiva.
 * O LLM às vezes retorna um array ou objeto em vez de string.
 */
export function parseRespostaStr(
  val: unknown,
  fallback = "Não foi possível gerar uma resposta.",
): string {
  if (typeof val === "string") return val.trim() || fallback;

  if (Array.isArray(val)) {
    const parts = (val as unknown[])
      .map((x) => {
        if (typeof x === "string") return x.trim();
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          const t = o.text ?? o.content ?? o.resposta ?? o.texto ?? o.message ?? o.answer;
          return typeof t === "string" ? t.trim() : "";
        }
        return "";
      })
      .filter(Boolean);
    return parts.join("\n").trim() || fallback;
  }

  if (val && typeof val === "object") {
    const o = val as Record<string, unknown>;
    const t = o.text ?? o.content ?? o.resposta ?? o.texto;
    if (typeof t === "string" && t.trim()) return t.trim();
  }

  return fallback;
}

/**
 * Filtra uma lista de limitações/observações retornada pelo LLM,
 * garantindo que só strings válidas cheguem ao frontend.
 */
export function parseStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return (val as unknown[]).filter((x) => typeof x === "string" && (x as string).trim()) as string[];
}
