/**
 * Ordem das colunas da tabela nas respostas, pela categoria (categorycampos.ordem_exibicao):
 *   1, 2, 3… primeiro, nessa ordem; sem ordem (null) depois, na ordem dos campos na categoria; colunas que não
 *   são campo (texto do memo, data de registro) por último; -1 não aparece, a não ser que a pergunta cite o campo.
 * Com alguma ordem configurada na categoria, a tabela mostra todas as colunas da consulta (menos as técnicas),
 * em vez das poucas que a IA escolheu. O id fica na tabela (a tela o põe na última coluna, com o arquivo).
 */
import type { MemoContextCategory, PerguntaResposta, PerguntaResultadoEstruturado } from "@mymemory/shared";
import { normalizarDataParaIso, toParamName } from "@mymemory/shared";

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

/** Unidade de cada coluna que é campo com unidade (kg, %, cm…). */
function unidadesDasColunas(campos: MemoContextCategory["campos"], colunas: string[]): { unidades?: Record<string, string> } {
  const out: Record<string, string> = {};
  for (const f of campos) {
    const u = f.unidade?.trim();
    if (!u) continue;
    const col = colunas.find((c) => c.toLowerCase() === toParamName(f.name).toLowerCase());
    if (col) out[col] = u;
  }
  return Object.keys(out).length ? { unidades: out } : {};
}


/** Período pedido na pergunta para uma coluna de data (dos parâmetros _ini/_fin da consulta). */
export type LimitesDatas = Record<string, { ini?: string; fim?: string }>;

const DIA_MS = 86_400_000;
/** Máximo de dias gerados (um ano e pouco): período maior fica só com os dias que têm registro. */
const MAX_DIAS = 400;

/**
 * Campo de data com "mostrar dias sem registro": acrescenta uma linha vazia para cada dia sem memo, do início ao
 * fim do período pedido (ou do primeiro ao último dia encontrado), e põe as linhas em ordem crescente de data.
 */
function completarDias(
  dados: PerguntaResultadoEstruturado,
  campos: MemoContextCategory["campos"],
  limites: LimitesDatas
): PerguntaResultadoEstruturado {
  const todas = dados.linhasCompletas?.length ? dados.linhasCompletas : dados.linhas;
  const chaves = todas[0] ? Object.keys(todas[0]) : dados.colunas;
  const f = campos.find((c) => c.completarDatas && c.tipo === "date" && chaves.some((k) => k.toLowerCase() === toParamName(c.name).toLowerCase()));
  if (!f) return dados;
  const col = chaves.find((k) => k.toLowerCase() === toParamName(f.name).toLowerCase())!;
  const iso = (v: unknown) => (v == null || v === "" ? null : normalizarDataParaIso(String(v).slice(0, 10)));
  const datas = todas.map((l) => iso(l[col])).filter((d): d is string => !!d).sort();
  const lim = limites[col.toLowerCase()] ?? {};
  const ini = iso(lim.ini) ?? datas[0];
  const fim = iso(lim.fim) ?? datas[datas.length - 1];
  if (!ini || !fim || fim < ini) return dados;
  const t0 = Date.parse(`${ini}T00:00:00Z`);
  const t1 = Date.parse(`${fim}T00:00:00Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || (t1 - t0) / DIA_MS > MAX_DIAS) return dados;
  const tem = new Set(datas);
  const novas: Record<string, unknown>[] = [];
  for (let t = t0; t <= t1; t += DIA_MS) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!tem.has(d)) novas.push({ [col]: d });
  }
  if (!novas.length) return dados;
  const linhas = [...todas, ...novas].sort((a, b) => (iso(a[col]) ?? "9999").localeCompare(iso(b[col]) ?? "9999"));
  return { ...dados, linhas, linhasCompletas: undefined, totalLinhas: linhas.length };
}

function ordenarUm(
  dadosOriginais: PerguntaResultadoEstruturado,
  cats: MemoContextCategory[],
  pergunta: string,
  limites: LimitesDatas = {}
): PerguntaResultadoEstruturado {
  const campos = cats.flatMap((c) => (c.campos ?? []).filter((f) => f.isActive === 1));
  if (!campos.length || !dadosOriginais.colunas.length) return dadosOriginais;
  // Dias sem registro (campo de data com "mostrar dias sem registro") antes de ordenar as colunas
  const dados = completarDias(dadosOriginais, campos, limites);
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
    ...unidadesDasColunas(campos, chavesLinha.length ? chavesLinha : dados.colunas),
  };
}

/** Aplica a ordem da categoria às tabelas da resposta (uma ou várias). */
export function ordenarColunasDaResposta(
  resposta: PerguntaResposta,
  cats: MemoContextCategory[],
  pergunta: string,
  limites: LimitesDatas = {}
): PerguntaResposta {
  const de = resposta.dados_estruturados;
  if (!de || !cats.length) return resposta;
  return {
    ...resposta,
    dados_estruturados: Array.isArray(de) ? de.map((d) => ordenarUm(d, cats, pergunta, limites)) : ordenarUm(de, cats, pergunta, limites),
  };
}
