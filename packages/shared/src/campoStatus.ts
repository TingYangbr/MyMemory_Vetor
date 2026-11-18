/**
 * Campo do tipo "status": valores fixos (o primeiro é o inicial) e verbos que levam a cada valor.
 * Ex.: Baixa = Aberto, Baixado; "pagar, paguei, quitar, recebi" → Baixado.
 *
 * Valores: os padrões do campo (normalizedTerms), separados por vírgula.
 * Verbos: texto com uma linha por valor, "Valor: verbo, verbo".
 */

export type VerbosStatus = Record<string, string[]>;

const sem = (s: string) =>
  s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().trim();

/** Valores do status, na ordem (o primeiro é o inicial). */
export function lerValoresStatus(normalizedTerms: string | null | undefined): string[] {
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const bit of (normalizedTerms ?? "").split(",")) {
    const s = bit.trim();
    if (s && !vistos.has(sem(s))) {
      vistos.add(sem(s));
      out.push(s);
    }
  }
  return out;
}

/** "Baixado: pagar, paguei\nAberto: estornar" → { Baixado: [...], Aberto: [...] } (só valores existentes). */
export function lerVerbosStatus(texto: string | null | undefined, valores: string[]): VerbosStatus {
  const out: VerbosStatus = {};
  for (const linha of (texto ?? "").split(/\r?\n/)) {
    const i = linha.indexOf(":");
    if (i <= 0) continue;
    const valor = valores.find((v) => sem(v) === sem(linha.slice(0, i)));
    if (!valor) continue;
    const verbos = linha
      .slice(i + 1)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (verbos.length) out[valor] = [...(out[valor] ?? []), ...verbos];
  }
  return out;
}

/** Texto dos verbos para o editor, na ordem dos valores. */
export function escreverVerbosStatus(verbos: VerbosStatus, valores: string[]): string {
  return valores
    .filter((v) => verbos[v]?.length)
    .map((v) => `${v}: ${verbos[v].join(", ")}`)
    .join("\n");
}

/** Mesma palavra em outra flexão: "pagas"/"pago", "baixadas"/"baixado", "paguei"/"pagar", "recebi"/"receber". */
function mesmaRaiz(a: string, b: string): boolean {
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= Math.max(3, Math.min(a.length, b.length) - 2);
}

const NEGA_VERBO = new Set(["a", "falta", "faltam", "faltando", "para", "pra", "nao", "sem", "vai", "vou", "precisa"]);

const palavras = (s: string) => sem(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Valor do status a partir do que foi dito ou extraído: o próprio valor (sem acento/maiúsculas),
 * outra flexão dele ("baixadas" → Baixado) ou um verbo cadastrado ("paguei" → Baixado).
 * null = não corresponde a nenhum valor.
 */
export function resolverValorStatus(
  dito: string | null | undefined,
  valores: string[],
  verbos: VerbosStatus = {}
): string | null {
  const alvo = sem(dito ?? "");
  if (!alvo || !valores.length) return null;
  const exato = valores.find((v) => sem(v) === alvo);
  if (exato) return exato;
  // Verbo de mais de uma palavra ("dar baixa"), dito por inteiro
  const porExpressao = valores.filter((v) =>
    (verbos[v] ?? []).some((verbo) => palavras(verbo).length > 1 && alvo.includes(palavras(verbo).join(" ")))
  );
  if (porExpressao.length === 1) return porExpressao[0];
  // Palavra por palavra, na ordem do texto: a primeira que for o valor (em outra flexão: "pagas" → Pago,
  // "em aberto" → Aberto) ou um verbo dele ("paguei" → Baixado) decide. "Estornar o pagamento" → Aberto.
  // Verbo logo depois de "a", "falta", "para", "não" é o contrário ("a receber", "falta pagar"): não conta
  const todas = palavras(alvo);
  for (let i = 0; i < todas.length; i++) {
    const w = todas[i];
    if (w.length < 3) continue;
    const negado = i > 0 && NEGA_VERBO.has(todas[i - 1]);
    const achados = valores.filter(
      (v) =>
        (palavras(v).length === 1 && mesmaRaiz(w, sem(v))) ||
        (!negado && (verbos[v] ?? []).some((verbo) => palavras(verbo).length === 1 && mesmaRaiz(w, sem(verbo))))
    );
    if (achados.length === 1) return achados[0];
  }
  return null;
}

/** Linha de ajuda para os prompts: valores e verbos do campo. */
export function descreverStatus(valores: string[], verbos: VerbosStatus): string {
  const vs = valores.map((v) => (verbos[v]?.length ? `${v} (${verbos[v].join(", ")})` : v));
  return `status com valores fixos: ${vs.join(" | ")}; use exatamente um desses valores; vazio = ${valores[0] ?? ""}`;
}
