/**
 * Ordem das colunas da tabela nas respostas, pela categoria (categorycampos.ordem_exibicao):
 *   1, 2, 3… primeiro, nessa ordem; sem ordem (null) depois, na ordem dos campos na categoria; colunas que não
 *   são campo (texto do memo, data de registro) por último; -1 não aparece, a não ser que a pergunta cite o campo.
 * Com alguma ordem configurada na categoria, a tabela mostra todas as colunas da consulta (menos as técnicas),
 * em vez das poucas que a IA escolheu. O id fica na tabela (a tela o põe na última coluna, com o arquivo).
 */
import type { MemoContextCategory, PerguntaResposta, PerguntaResultadoEstruturado, QueryColunaConfig } from "@mymemory/shared";
import { normalizarDataParaIso, toParamName } from "@mymemory/shared";

/** Colunas que a tela usa por dentro (ícone do arquivo, escopo) e não mostra como coluna. */
const TECNICAS = new Set(["mediatype", "mediafileurl", "attachmentdisplayname", "keywords", "category", "userid", "groupid"]);

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Palavras sem o plural simples ("pesos" → "peso", "medidas" → "medida"), para citar campo no plural. */
const singular = (s: string) =>
  norm(s)
    .split(" ")
    .map((w) => (w.length > 3 ? w.replace(/s$/, "") : w))
    .join(" ");

/** Palavras que não identificam o campo ("Peso em Kg", "Taxa de juros"). */
const PALAVRAS_VAZIAS = new Set(["com", "sem", "para", "por", "dos", "das", "nos", "nas", "pelo", "pela", "total", "valor"]);

/**
 * A pergunta cita o campo (nome ou rótulo), aceitando plural e nome com mais palavras: "pesos e IGC" cita
 * "Peso Kg" e "IGC" (basta uma palavra própria do nome, de 3+ letras).
 */
function citaFlex(pergunta: string): (...nomes: (string | null | undefined)[]) => boolean {
  const p = ` ${singular(pergunta)} `;
  const palavras = norm(pergunta).split(" ").filter((w) => w && !LIGACOES.has(w));
  return (...nomes) =>
    nomes.some((n) => {
      const x = n ? singular(n) : "";
      if (x.length >= 3 && p.includes(` ${x} `)) return true;
      if (x.split(" ").some((w) => w.length >= 3 && !PALAVRAS_VAZIAS.has(w) && p.includes(` ${w} `))) return true;
      return siglaPorExtenso(x, palavras);
    });
}

const LIGACOES = new Set(["de", "da", "do", "das", "dos", "e", "em", "a", "o"]);

/** Sigla dita por extenso: "índice gordura corporal" cita IGC, "índice de massa corporal" cita IMC. */
function siglaPorExtenso(sigla: string, palavras: string[]): boolean {
  if (!/^[a-z]{2,5}$/.test(sigla)) return false;
  for (let i = 0; i + sigla.length <= palavras.length; i++) {
    if (palavras.slice(i, i + sigla.length).map((w) => w[0]).join("") === sigla) return true;
  }
  return false;
}

/**
 * Medidas (campos Y do gráfico) que a pergunta NÃO citou, quando ela cita pelo menos uma: "pesos e IGC de novembro"
 * mostra só Peso e IGC na tabela e no gráfico. Sem citar nenhuma ("medidas de novembro"), todas aparecem.
 */
function medidasNaoCitadas(
  ys: { col: string; nomes: (string | null | undefined)[] }[],
  pergunta: string,
  escolhidasIa?: Set<string>
): Set<string> {
  const cita = citaFlex(pergunta);
  // Pedidas = citadas pelo nome OU escolhidas pela IA para a resposta ("quanto rendeu" → rendimento: a IA entende,
  // a comparação de palavras não). Nenhuma das duas: todas aparecem.
  const pedidas = ys.filter((y) => cita(...y.nomes) || !!escolhidasIa?.has(y.col.toLowerCase()));
  if (!pedidas.length || pedidas.length === ys.length) return new Set();
  return new Set(ys.filter((y) => !pedidas.includes(y)).map((y) => y.col));
}

/**
 * Colunas que a IA escolheu para a resposta (colunas_exibir), quando ela escolheu um pedaço do resultado; senão
 * undefined (sem escolha, ou a lista é o resultado inteiro).
 */
function escolhaDaIa(dados: PerguntaResultadoEstruturado, chavesLinha: string[]): Set<string> | undefined {
  const sem = (c: string) => !TECNICAS.has(c.toLowerCase()) && c.toLowerCase() !== "id" && c !== "lancamento_id";
  const escolhidas = dados.colunas.filter(sem);
  const todas = chavesLinha.filter(sem);
  if (!escolhidas.length || escolhidas.length >= todas.length) return undefined;
  return new Set(escolhidas.map((c) => c.toLowerCase()));
}

/**
 * Gráfico pelo papel de cada campo: X = rótulos, Y = valores (vários Y = várias cores, automático).
 * Campo sem papel só entra se a pergunta o citar (como Y; ou como X, se ainda não houver X).
 * Sem nenhum papel na categoria: nada aqui (a tela escolhe sozinha, como antes).
 */
function graficoPelaCategoria(
  campos: MemoContextCategory["campos"],
  colunas: string[],
  citada: (nome: string) => boolean
): { grafico?: { x?: string; y: string[]; dica?: string[] } } {
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
  // Papel D: o campo aparece só na dica (tooltip) da barra (ex.: Observação "iniciei dieta do leite")
  const dica = campos
    .filter((f) => f.papelGrafico === "D")
    .map((f) => colDe(f.name))
    .filter((c): c is string => !!c && c !== x && !y.includes(c));
  return y.length ? { grafico: { ...(x ? { x } : {}), y, ...(dica.length ? { dica } : {}) } } : {};
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

/**
 * Tabela de uma consulta com "Colunas do resultado" configuradas (DB interno ou ERP): a mesma regra dos campos do
 * memo — ordem (−1 oculta, a não ser que a pergunta cite), papel X/Y no gráfico, unidade e rótulo de exibição.
 */
function aplicarConfigConsulta(
  dados: PerguntaResultadoEstruturado,
  cfg: QueryColunaConfig[],
  pergunta: string,
  cats: MemoContextCategory[]
): PerguntaResultadoEstruturado {
  const chavesLinha = dados.linhas[0] ? Object.keys(dados.linhas[0]) : dados.colunas;
  const porCol = new Map(cfg.map((c, i) => [c.coluna.toLowerCase(), { c, i }]));
  const de = (col: string) => porCol.get(col.toLowerCase());
  const p = ` ${norm(pergunta)} `;
  const citada = (col: string) => {
    const info = de(col);
    return [col, info?.c.rotulo ?? ""].some((n) => {
      const x = norm(n);
      return x.length >= 3 && p.includes(` ${x} `);
    });
  };
  // Com ordem configurada, mostra todas as colunas da consulta (menos as técnicas), não só as que a IA escolheu
  const configurada = cfg.some((c) => c.ordem != null);
  const base = configurada ? chavesLinha.filter((c) => !TECNICAS.has(c.toLowerCase())) : dados.colunas;
  const colReal = (nome: string) => chavesLinha.find((c) => c.toLowerCase() === nome.toLowerCase());
  const semCitar = medidasNaoCitadas(
    cfg.filter((c) => c.papel === "Y" && colReal(c.coluna)).map((c) => ({ col: colReal(c.coluna)!, nomes: [c.coluna, c.rotulo] })),
    pergunta,
    escolhaDaIa(dados, chavesLinha)
  );
  const visiveis = base.filter((c) => !(de(c)?.c.ordem === -1 && !citada(c)) && !semCitar.has(c));
  const ordenadas = visiveis
    .map((c, idx) => {
      const o = de(c)?.c.ordem;
      return { c, k: (o != null && o >= 0 ? [0, o] : [1, idx]) as [number, number] };
    })
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1])
    .map((x) => x.c);
  const x = cfg.filter((c) => c.papel === "X").map((c) => colReal(c.coluna)).find(Boolean);
  const y = cfg
    .filter((c) => c.papel === "Y")
    .map((c) => colReal(c.coluna))
    .filter((c): c is string => !!c && !semCitar.has(c));
  const unidades: Record<string, string> = {};
  const rotulos: Record<string, string> = {};
  for (const c of cfg) {
    const col = colReal(c.coluna);
    if (!col) continue;
    if (c.unidade) unidades[col] = c.unidade;
    if (c.rotulo) rotulos[col] = c.rotulo;
  }
  return {
    ...dados,
    colunas: ordenadas,
    ...(cats.length === 1 ? { categoria: cats[0]!.name } : {}),
    ...(y.length ? { grafico: { ...(x ? { x } : {}), y } } : {}),
    ...(Object.keys(unidades).length ? { unidades } : {}),
    ...(Object.keys(rotulos).length ? { rotulos } : {}),
  };
}

function ordenarUm(
  dadosOriginais: PerguntaResultadoEstruturado,
  cats: MemoContextCategory[],
  pergunta: string,
  limites: LimitesDatas = {}
): PerguntaResultadoEstruturado {
  // Tabela de consulta com as colunas configuradas: vale a configuração da consulta
  if (dadosOriginais.queryId != null) {
    const q = cats.flatMap((c) => c.queries ?? []).find((x) => x.id === dadosOriginais.queryId);
    if (q?.colunas?.length && dadosOriginais.colunas.length) return aplicarConfigConsulta(dadosOriginais, q.colunas, pergunta, cats);
  }
  const campos = cats.flatMap((c) => (c.campos ?? []).filter((f) => f.isActive === 1));
  if (!campos.length || !dadosOriginais.colunas.length) return dadosOriginais;
  // Colunas pelas linhas de verdade (antes dos dias vazios: a 1ª linha podia ser um dia sem registro, só com a data,
  // e a tabela ficava só com a coluna de data)
  const todasOrig = dadosOriginais.linhasCompletas?.length ? dadosOriginais.linhasCompletas : dadosOriginais.linhas;
  const chavesLinha = [...new Set(todasOrig.slice(0, 50).flatMap((l) => Object.keys(l)))];
  const colsBase = chavesLinha.length ? chavesLinha : dadosOriginais.colunas;
  const semCitar = medidasNaoCitadas(
    campos
      .filter((f) => f.papelGrafico === "Y")
      .map((f) => ({ col: colsBase.find((c) => c.toLowerCase() === toParamName(f.name).toLowerCase()), nomes: [f.name] }))
      .filter((y): y is { col: string; nomes: string[] } => !!y.col),
    pergunta,
    escolhaDaIa(dadosOriginais, colsBase)
  );
  const ysVisiveis = campos
    .filter((f) => f.papelGrafico === "Y")
    .map((f) => colsBase.find((c) => c.toLowerCase() === toParamName(f.name).toLowerCase()))
    .filter((c): c is string => !!c && !semCitar.has(c));
  // "Quando foi o pico de peso…": só as linhas do pico (ou do mínimo) de cada medida, sem os dias vazios
  const extremo = linhasDoExtremo(dadosOriginais, ysVisiveis, pergunta);
  // Dias sem registro (campo de data com "mostrar dias sem registro") antes de ordenar as colunas
  const dados = extremo ?? completarDias(dadosOriginais, campos, limites);
  const porParam = new Map(campos.map((f, i) => [toParamName(f.name).toLowerCase(), { f, i }]));
  const configurada = campos.some((f) => f.ordemExibicao != null);
  const base = configurada && chavesLinha.length ? chavesLinha.filter((c) => !TECNICAS.has(c.toLowerCase())) : dados.colunas;
  const p = ` ${norm(pergunta)} `;
  const citada = (nome: string) => {
    const n = norm(nome);
    return n.length >= 3 && p.includes(` ${n} `);
  };
  const visiveis = base.filter((c) => {
    if (semCitar.has(c)) return false;
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
    ...graficoPelaCategoria(campos, colsBase.filter((c) => !semCitar.has(c)), citada),
    ...unidadesDasColunas(campos, colsBase),
  };
}

/** Número de uma célula ("85,1", "1.234,5", 85.1); null se não for número. */
function numeroCelula(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").trim();
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s.replace(/[^\d.+-]/g, ""));
  return /\d/.test(s) && Number.isFinite(n) ? n : null;
}

/**
 * Pergunta pelo pico/máximo ou pelo mínimo ("quando foi o pico de peso", "menor IGC do ano"): fica só com as
 * linhas em que alguma medida (campo Y visível) atinge o extremo. Null = não é pergunta de extremo (ou não há Y).
 */
function linhasDoExtremo(
  dados: PerguntaResultadoEstruturado,
  ys: string[],
  pergunta: string
): PerguntaResultadoEstruturado | null {
  if (!ys.length) return null;
  const p = norm(pergunta);
  const minimo = /\b(minim[oa]s?|menor(es)?|mais baix[oa]s?)\b/.test(p);
  const maximo = /\b(pico|picos|maxim[oa]s?|maior(es)?|mais alt[oa]s?|recorde)\b/.test(p);
  if (minimo === maximo) return null; // nenhum dos dois, ou os dois: deixa como está
  const todas = dados.linhasCompletas?.length ? dados.linhasCompletas : dados.linhas;
  const alvos = new Map<string, number>();
  for (const y of ys) {
    const vals = todas.map((l) => numeroCelula(l[y])).filter((n): n is number => n != null);
    if (vals.length) alvos.set(y, minimo ? Math.min(...vals) : Math.max(...vals));
  }
  if (!alvos.size) return null;
  const linhas = todas.filter((l) => [...alvos].some(([y, alvo]) => numeroCelula(l[y]) === alvo));
  if (!linhas.length || linhas.length === todas.length) return null;
  return { ...dados, linhas, linhasCompletas: undefined, totalLinhas: linhas.length };
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
