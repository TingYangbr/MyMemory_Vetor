/**
 * Datas dos "dados específicos" (campos do tipo date): o sistema guarda SEMPRE em AAAA-MM-DD e mostra
 * em dd/mm/aaaa. A IA de extração não é confiável para o formato (ora devolve 27/11/2025, ora
 * 2025-11-27), então a conversão é feita aqui, em código, depois da extração.
 *
 * Os formatos aceitos espelham `mymemory_parse_date` (migration 149), que as consultas usam:
 *   - ano primeiro  com "-", "/" ou "." : 2026-10-04, 2026/10/04, 2026.10.4
 *   - dia primeiro (brasileiro)          : 04/10/2026, 4-10-2026, 4.10.2026
 *   - por extenso                        : "4 de outubro de 2026", "domingo, 4 de março de 2026"
 * Texto depois da data é ignorado. Formato desconhecido ou data inválida devolve null (o valor
 * original é mantido por quem chama).
 */

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

function montarIso(ano: number, mes: number, dia: number): string | null {
  if (ano < 1000 || ano > 9999 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  // rejeita 31/02 e similares (o JS "rola" para o mês seguinte)
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Converte uma data em texto para AAAA-MM-DD, ou null se não reconhecer. */
export function normalizarDataParaIso(texto: string): string | null {
  const t = texto.trim();
  if (!t) return null;

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (m) return montarIso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t);
  if (m) return montarIso(Number(m[3]), Number(m[2]), Number(m[1]));

  const semAcento = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  m = /(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/.exec(semAcento);
  if (m) {
    const mes = MESES[m[2]];
    return mes ? montarIso(Number(m[3]), mes, Number(m[1])) : null;
  }
  return null;
}

const ISO_COMPLETO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Para exibição: AAAA-MM-DD vira dd/mm/aaaa; qualquer outro texto passa sem alteração. */
export function formatarDataBr(valor: string): string {
  const m = ISO_COMPLETO.exec(valor.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : valor;
}
