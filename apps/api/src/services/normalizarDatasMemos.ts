import { normalizarDataParaIso } from "@mymemory/shared";

export interface AlteracaoData {
  campo: string;
  de: string;
  para: string;
}

/**
 * Converte, no JSON de dados específicos de um memo, os campos de data (nomes em `camposData`, comparados
 * sem diferenciar maiúsculas) para AAAA-MM-DD. Valor que já é ISO, vazio ou não reconhecido fica como está.
 * Devolve o novo JSON e a lista do que mudou; `json` null quando nada mudou.
 */
export function normalizarDatasDoJson(
  dadosJson: string,
  camposData: string[]
): { json: string | null; alteracoes: AlteracaoData[] } {
  const alvo = new Set(camposData.map((c) => c.trim().toLowerCase()));
  let obj: unknown;
  try {
    obj = JSON.parse(dadosJson);
  } catch {
    return { json: null, alteracoes: [] };
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { json: null, alteracoes: [] };

  const alteracoes: AlteracaoData[] = [];
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (alvo.has(k.trim().toLowerCase()) && typeof v === "string" && v.trim()) {
      const iso = normalizarDataParaIso(v);
      if (iso && iso !== v.trim()) {
        alteracoes.push({ campo: k, de: v, para: iso });
        saida[k] = iso;
        continue;
      }
    }
    saida[k] = v;
  }
  return alteracoes.length ? { json: JSON.stringify(saida), alteracoes } : { json: null, alteracoes: [] };
}
