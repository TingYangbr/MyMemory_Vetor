/**
 * Itens de um campo do tipo "lista" (um item por linha) com o estado de cada item marcado no começo
 * da linha: sem marca = pendente; "✓ " = concluído (comprado, feito); "✗ " = cancelado.
 * A marca fica no próprio texto, então o memo continua sendo o registro e o histórico guarda cada mudança.
 */
export type EstadoItemLista = "pendente" | "concluido" | "cancelado";

export interface ItemLista {
  estado: EstadoItemLista;
  texto: string;
}

const MARCA: Record<Exclude<EstadoItemLista, "pendente">, string> = { concluido: "✓", cancelado: "✗" };

/** "✓ 2 kg de arroz" → { estado: "concluido", texto: "2 kg de arroz" }. Aceita também [x] e [-]. */
export function lerItemLista(linha: string): ItemLista {
  const l = linha.trim();
  const m = /^(✓|✔|\[x\]|✗|✘|\[-\])\s*/i.exec(l);
  if (!m) return { estado: "pendente", texto: l };
  const marca = m[1]!.toLowerCase();
  const estado: EstadoItemLista = marca === "✓" || marca === "✔" || marca === "[x]" ? "concluido" : "cancelado";
  return { estado, texto: l.slice(m[0].length).trim() };
}

export function escreverItemLista(item: ItemLista): string {
  return item.estado === "pendente" ? item.texto : `${MARCA[item.estado]} ${item.texto}`;
}

/** Texto do campo → itens (linhas vazias saem). */
export function lerItensLista(texto: string): ItemLista[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(lerItemLista);
}

export function escreverItensLista(itens: ItemLista[]): string {
  return itens.map(escreverItemLista).join("\n");
}
