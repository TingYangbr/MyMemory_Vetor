/**
 * ↺ Refazer de um toque: sem IA, procura outra categoria (com consultas) que case com as palavras da
 * pergunta — nome, descrição e nomes das consultas. Se a melhor passar do limiar, a pergunta é refeita
 * nela como estruturada; senão, quem chama refaz pela busca nos textos dos memos (como era).
 */
import type { MemoContextCategory } from "@mymemory/shared";

/** Mínimo de palavras da pergunta que a categoria precisa ter para ser escolhida. */
export const LIMIAR_PALAVRAS_REFAZER = 2;

const PARADAS = new Set(
  "a o as os um uma uns umas de da do das dos na no nas nos em e ou que se para pra por com sem sobre ao aos " +
    "qual quais quanto quantos quanta quantas como onde quando mostrar mostra mostre liste listar lista ver " +
    "meu minha meus minhas seu sua tenho tem ter esta estao sao foi era sistema todos todas tudo isso esse essa"
      .split(" ")
);

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Raiz curta da palavra: "contas"/"conta", "cadastrados"/"cadastradas" e "bancos"/"banco" casam. */
const raiz = (w: string) => (w.length > 5 ? w.slice(0, 5) : w.replace(/s$/, ""));

function palavrasDaPergunta(pergunta: string): string[] {
  return [...new Set(norm(pergunta).split(" ").filter((w) => w.length >= 3 && !PARADAS.has(w)).map(raiz))];
}

/** Quantas palavras (raízes) da pergunta aparecem no texto da categoria. */
export function pontuarCategoria(pergunta: string, cat: MemoContextCategory): number {
  const texto = norm(
    [cat.name, cat.description ?? "", ...(cat.queries ?? []).filter((q) => q.isActive === 1).map((q) => `${q.nome} ${q.descricao ?? ""}`)].join(" ")
  );
  const raizesTexto = new Set(texto.split(" ").filter(Boolean).map(raiz));
  return palavrasDaPergunta(pergunta).filter((r) => raizesTexto.has(r)).length;
}

/** Melhor categoria estruturada fora das excluídas, se passar do limiar; senão null. */
export function melhorCategoriaAlternativa(
  pergunta: string,
  categories: MemoContextCategory[],
  excluir: string[]
): MemoContextCategory | null {
  const fora = new Set(excluir.map(norm));
  let melhor: MemoContextCategory | null = null;
  let pontos = 0;
  for (const c of categories) {
    if (c.isActive !== 1 || fora.has(norm(c.name))) continue;
    if (!(c.queries ?? []).some((q) => q.isActive === 1)) continue; // só categoria com consulta (estruturada)
    const p = pontuarCategoria(pergunta, c);
    if (p > pontos) {
      pontos = p;
      melhor = c;
    }
  }
  return pontos >= LIMIAR_PALAVRAS_REFAZER ? melhor : null;
}
