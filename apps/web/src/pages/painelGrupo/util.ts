/** Mensagem legível de um erro da API (que vem como texto JSON com `message`). */
export function msgErro(e: unknown, padrao = "Algo deu errado. Tente de novo."): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  if (!raw) return padrao;
  try {
    const j = JSON.parse(raw) as { message?: string; error?: string };
    return j.message ?? j.error ?? padrao;
  } catch {
    return raw;
  }
}

const CORES = ["#0d9488", "#7c3aed", "#ea580c", "#2563eb", "#16a34a", "#db2777", "#ca8a04", "#0891b2"];

/** Cor fixa por pessoa (mesmo id = mesma cor). */
export function corDe(id: number | string): string {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CORES[h % CORES.length];
}

/** Iniciais para o avatar: "Marina Costa" → "MC", "ana@x.com" → "AN". */
export function iniciais(nome: string | null | undefined, email?: string | null): string {
  const base = (nome ?? "").trim();
  if (base) {
    const partes = base.split(/\s+/).filter(Boolean);
    const a = partes[0]?.[0] ?? "";
    const b = partes.length > 1 ? partes[partes.length - 1][0] : partes[0]?.[1] ?? "";
    return (a + b).toUpperCase();
  }
  return (email ?? "?").slice(0, 2).toUpperCase();
}

export function fmtData(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
}

export type Secao = "pessoas" | "categorias" | "consulta" | "perfis" | "erp" | "config";

export const SECOES: { id: Secao; nome: string }[] = [
  { id: "pessoas", nome: "Pessoas" },
  { id: "categorias", nome: "Categorias" },
  { id: "consulta", nome: "Consulta de memos" },
  { id: "perfis", nome: "Perfis de acesso" },
  { id: "erp", nome: "Ligação com o ERP" },
  { id: "config", nome: "Configurações" },
];
