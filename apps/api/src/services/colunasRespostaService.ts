/**
 * Ordem das colunas da tabela nas respostas, pela categoria (categorycampos.ordem_exibicao):
 *   1, 2, 3… primeiro, nessa ordem; sem ordem (null) depois, na ordem dos campos na categoria; colunas que não
 *   são campo (texto do memo, data de registro) por último; -1 não aparece, a não ser que a pergunta cite o campo.
 * Com alguma ordem configurada na categoria, a tabela mostra todas as colunas da consulta (menos as técnicas),
 * em vez das poucas que a IA escolheu. O id fica na tabela (a tela o põe na última coluna, com o arquivo).
 */
import type { MemoContextCategory, PerguntaResposta, PerguntaResultadoEstruturado } from "@mymemory/shared";
import { toParamName } from "@mymemory/shared";

/** Colunas que a tela usa por dentro (ícone do arquivo, escopo) e não mostra como coluna. */
const TECNICAS = new Set(["mediatype", "mediafileurl", "attachmentdisplayname", "keywords", "category", "userid", "groupid"]);

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Gráfico pelo papel de cada campo: X = rótulos, Y = valores (vários Y = várias cores, automático).
 * Campo sem papel só entra se a pergunta o citar (como Y; ou como X, se ainda não houver X).
 * Sem nenhum papel na categoria: nada aqui (a tela escolhe sozinha, como antes).
 */
function graficoPelaCategoria(
  campos: MemoContextCategory["campos"],
  colunas: string[],
  citada: (nome: string) => boolean
): { grafico?: { x?: string; y: string[] } } {
  if (!campos.some((f) => f.papelGrafico === "X" || f.papelGrafico === "Y")) return {};
  const colDe = (nome: string) => colunas.find((c) => c.toLowerCase() === toParamName(nome).toLowerCase());
  let x: string | undefined;
  const y: string[] = [];
  for (const f of campos) {
    const col = colDe(f.name);
    if (!col) continue;
    if (f.papelGrafico === "X" && !x) x = col;
    else if (f.papelGrafico === "Y") y.push(col);
  }
  for (const f of campos) {
    const col = colDe(f.name);
    if (!col || f.papelGrafico || !citada(f.name) || col === x || y.includes(col)) continue;
    if (f.tipo === "number") y.push(col);
    else if (!x) x = col;
  }
  return y.length ? { grafico: { ...(x ? { x } : {}), y } } : {};
}

function ordenarUm(
  dados: PerguntaResultadoEstruturado,
  cats: MemoContextCategory[],
  pergunta: string
): PerguntaResultadoEstruturado {
  const campos = cats.flatMap((c) => (c.campos ?? []).filter((f) => f.isActive === 1));
  if (!campos.length || !dados.colunas.length) return dados;
  const porParam = new Map(campos.map((f, i) => [toParamName(f.name).toLowerCase(), { f, i }]));
  const configurada = campos.some((f) => f.ordemExibicao != null);
  const chavesLinha = dados.linhas[0] ? Object.keys(dados.linhas[0]) : [];
  const base = configurada && chavesLinha.length ? chavesLinha.filter((c) => !TECNICAS.has(c.toLowerCase())) : dados.colunas;
  const p = ` ${norm(pergunta)} `;
  const citada = (nome: string) => {
    const n = norm(nome);
    return n.length >= 3 && p.includes(` ${n} `);
  };
  const visiveis = base.filter((c) => {
    const info = porParam.get(c.toLowerCase());
    return !(info && info.f.ordemExibicao === -1 && !citada(info.f.name));
  });
  const chave = (c: string, idxOriginal: number): [number, number] => {
    const info = porParam.get(c.toLowerCase());
    if (info && info.f.ordemExibicao != null && info.f.ordemExibicao >= 0) return [0, info.f.ordemExibicao];
    if (info) return [1, info.i];
    return [2, idxOriginal];
  };
  const ordenadas = visiveis
    .map((c, i) => ({ c, k: chave(c, i) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1])
    .map((x) => x.c);
  return {
    ...dados,
    colunas: ordenadas,
    ...(cats.length === 1 ? { categoria: cats[0]!.name } : {}),
    ...graficoPelaCategoria(campos, chavesLinha.length ? chavesLinha : dados.colunas, citada),
  };
}

/** Aplica a ordem da categoria às tabelas da resposta (uma ou várias). */
export function ordenarColunasDaResposta(resposta: PerguntaResposta, cats: MemoContextCategory[], pergunta: string): PerguntaResposta {
  const de = resposta.dados_estruturados;
  if (!de || !cats.length) return resposta;
  return {
    ...resposta,
    dados_estruturados: Array.isArray(de) ? de.map((d) => ordenarUm(d, cats, pergunta)) : ordenarUm(de, cats, pergunta),
  };
}
