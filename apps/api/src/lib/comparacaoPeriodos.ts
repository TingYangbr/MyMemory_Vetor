/**
 * Comparação entre dois períodos (ex.: faturamento de fevereiro × março por produto).
 * O planejador gera uma query por período; aqui o cruzamento e as contas (variação em valor e %)
 * são feitos em código, para o LLM só narrar números prontos — ele erra conta e transcrição de valores longos.
 *
 * Ativação estrita: só quando as queries do plano são a MESMA consulta, com a mesma agregação, e os
 * parâmetros diferem apenas nas datas. Qualquer outra forma (percentual do total, cross_query_filter,
 * análises encadeadas) devolve null e segue o fluxo normal.
 */

interface ParamMin { nome: string; valor: unknown; tipo: string }
interface AgregacaoMin {
  medida: string | null;
  campo_medida: string | null;
  medidas?: unknown[];
  group_by: string[];
  group_by_trunc?: unknown[];
}
interface QueryPlanoMin {
  query_id: string;
  motivo_uso: string;
  parametros: ParamMin[];
  agregacao?: AgregacaoMin | null;
  cross_query_filter?: unknown[];
}
interface PlanoMin { queries: QueryPlanoMin[] }
interface ResultadoMin { colunas: string[]; linhas: Record<string, unknown>[] }

export interface ItemComparacao {
  chave: string;
  descricao: string | null;
  base: number;
  atual: number;
  variacao: number;
  variacaoPct: number | null;
  situacao: "aumento" | "reducao" | "estavel" | "novo" | "sem_movimento_atual";
}

export interface ComparacaoPeriodos {
  periodoBase: string;
  periodoAtual: string;
  colunaChave: string;
  colunaDescricao: string | null;
  totalBase: number;
  totalAtual: number;
  variacaoTotal: number;
  variacaoTotalPct: number | null;
  totalItens: number;
  /** Todos os itens, do maior impacto absoluto para o menor. */
  itens: ItemComparacao[];
}

const MAX_NO_LLM = 15;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (variacao: number, base: number) => (base === 0 ? null : r1((variacao / Math.abs(base)) * 100));
const eData = (p: ParamMin) => /^(date|data)$/i.test(p.tipo) && /_(ini|fin)$/i.test(p.nome);
const vazio = (v: unknown) => v === null || v === undefined || v === "";

function dataIso(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

function rotuloPeriodo(ini: string | null, fin: string | null): string {
  if (!ini && !fin) return "período";
  const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  if (ini && fin && ini.slice(0, 7) === fin.slice(0, 7) && ini.endsWith("-01")) {
    const ultimo = new Date(Date.UTC(Number(fin.slice(0, 4)), Number(fin.slice(5, 7)), 0)).getUTCDate();
    if (Number(fin.slice(8, 10)) === ultimo) return `${fin.slice(5, 7)}/${fin.slice(0, 4)}`;
  }
  return `${ini ? br(ini) : "…"} a ${fin ? br(fin) : "…"}`;
}

function acharColuna(colunas: string[], nome: string): string | null {
  return colunas.find((c) => c.toLowerCase() === nome.toLowerCase()) ?? null;
}

function calcular(plano: PlanoMin, resultados: ResultadoMin[]): ComparacaoPeriodos | null {
  const qs = plano.queries;
  if (qs.length !== 2 || resultados.length !== 2) return null;
  const [a, b] = qs;
  if (a.query_id !== b.query_id) return null;
  if (qs.some((q) => q.cross_query_filter?.length)) return null;
  if (qs.some((q) => /percentual|total geral/i.test(q.motivo_uso))) return null;

  const ag = a.agregacao;
  const ag2 = b.agregacao;
  if (!ag || !ag2) return null;
  if (ag.medidas?.length || ag2.medidas?.length || ag.group_by_trunc?.length || ag2.group_by_trunc?.length) return null;
  if (ag.medida !== "sum" && ag.medida !== "count") return null;
  if (ag.medida !== ag2.medida || (ag.campo_medida ?? null) !== (ag2.campo_medida ?? null)) return null;
  if (!ag.group_by.length || ag.group_by.join("|").toLowerCase() !== ag2.group_by.join("|").toLowerCase()) return null;

  // Parâmetros: iguais, exceto datas; ao menos uma data diferente
  const mapa = (q: QueryPlanoMin) => new Map(q.parametros.filter((p) => !vazio(p.valor)).map((p) => [p.nome.toLowerCase(), p]));
  const ma = mapa(a);
  const mb = mapa(b);
  if (ma.size !== mb.size) return null;
  let dataDiferente = false;
  for (const [nome, pa] of ma) {
    const pb = mb.get(nome);
    if (!pb) return null;
    if (String(pa.valor) === String(pb.valor)) continue;
    if (!eData(pa)) return null;
    dataDiferente = true;
  }
  if (!dataDiferente) return null;

  const cols = resultados[0].colunas;
  if (cols.length === 0 || cols.join("|").toLowerCase() !== resultados[1].colunas.join("|").toLowerCase()) return null;
  const colsGrupo = ag.group_by.map((g) => acharColuna(cols, g));
  if (colsGrupo.some((c) => !c)) return null;
  const grupo = colsGrupo as string[];
  const medidas = cols.filter((c) => !grupo.includes(c));
  if (medidas.length !== 1) return null;
  const colMedida = medidas[0];

  // Ordena os períodos pela data inicial: base = mais antigo
  const iniDe = (q: QueryPlanoMin) => dataIso(q.parametros.find((p) => /_ini$/i.test(p.nome) && eData(p))?.valor);
  const finDe = (q: QueryPlanoMin) => dataIso(q.parametros.find((p) => /_fin$/i.test(p.nome) && eData(p))?.valor);
  let ordem = [0, 1];
  if ((iniDe(b) ?? "") < (iniDe(a) ?? "")) ordem = [1, 0];
  const [ib, ia] = ordem;
  const periodoBase = rotuloPeriodo(iniDe(qs[ib]), finDe(qs[ib]));
  const periodoAtual = rotuloPeriodo(iniDe(qs[ia]), finDe(qs[ia]));
  if (periodoBase === periodoAtual) return null;

  // Chave de junção = primeira coluna do group_by (ex.: código); as demais viram descrição
  const colChave = grupo[0];
  const colsDesc = grupo.slice(1);
  const juntar = (linhas: Record<string, unknown>[]) => {
    const m = new Map<string, { valor: number; desc: string | null }>();
    for (const l of linhas) {
      const v = Number(l[colMedida] ?? 0);
      if (!Number.isFinite(v)) throw new Error("medida não numérica");
      const chave = String(l[colChave] ?? "");
      const desc = colsDesc.map((c) => l[c]).filter((x) => !vazio(x)).join(" | ") || null;
      const ant = m.get(chave);
      m.set(chave, { valor: (ant?.valor ?? 0) + v, desc: ant?.desc ?? desc });
    }
    return m;
  };
  const mBase = juntar(resultados[ib].linhas);
  const mAtual = juntar(resultados[ia].linhas);

  const itens: ItemComparacao[] = [];
  for (const chave of new Set([...mBase.keys(), ...mAtual.keys()])) {
    const vb = mBase.get(chave)?.valor ?? 0;
    const va = mAtual.get(chave)?.valor ?? 0;
    const variacao = va - vb;
    const situacao: ItemComparacao["situacao"] =
      !mBase.has(chave) ? "novo" : !mAtual.has(chave) ? "sem_movimento_atual" : Math.abs(variacao) < 0.005 ? "estavel" : variacao > 0 ? "aumento" : "reducao";
    itens.push({
      chave,
      descricao: mAtual.get(chave)?.desc ?? mBase.get(chave)?.desc ?? null,
      base: r2(vb),
      atual: r2(va),
      variacao: r2(variacao),
      variacaoPct: pct(variacao, vb),
      situacao,
    });
  }
  itens.sort((x, y) => Math.abs(y.variacao) - Math.abs(x.variacao));

  const totalBase = r2([...mBase.values()].reduce((s, x) => s + x.valor, 0));
  const totalAtual = r2([...mAtual.values()].reduce((s, x) => s + x.valor, 0));
  return {
    periodoBase,
    periodoAtual,
    colunaChave: colChave,
    colunaDescricao: colsDesc.length ? colsDesc.join(" | ") : null,
    totalBase,
    totalAtual,
    variacaoTotal: r2(totalAtual - totalBase),
    variacaoTotalPct: pct(totalAtual - totalBase, totalBase),
    totalItens: itens.length,
    itens,
  };
}

/** Devolve a comparação calculada ou null quando o plano não é uma comparação simples entre dois períodos. */
export function detectarComparacaoPeriodos(plano: PlanoMin, resultados: ResultadoMin[]): ComparacaoPeriodos | null {
  try {
    return calcular(plano, resultados);
  } catch (err) {
    console.warn("[comparacaoPeriodos] ignorada:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Resumo enxuto para o LLM: totais e maiores aumentos/reduções, já calculados. */
export function comparacaoParaLlm(c: ComparacaoPeriodos) {
  const aumentos = c.itens.filter((i) => i.variacao > 0).slice(0, MAX_NO_LLM);
  const reducoes = c.itens.filter((i) => i.variacao < 0).slice(0, MAX_NO_LLM);
  return {
    aviso: "Valores calculados pelo sistema sobre TODAS as linhas dos dois períodos. Use exatamente estes números; não recalcule nem arredonde de outra forma.",
    periodo_base: c.periodoBase,
    periodo_atual: c.periodoAtual,
    total_base: c.totalBase,
    total_atual: c.totalAtual,
    variacao_total: c.variacaoTotal,
    variacao_total_pct: c.variacaoTotalPct,
    itens_comparados: c.totalItens,
    itens_com_aumento: c.itens.filter((i) => i.variacao > 0).length,
    itens_com_reducao: c.itens.filter((i) => i.variacao < 0).length,
    maiores_aumentos: aumentos,
    maiores_reducoes: reducoes,
  };
}

/** Tabela completa no formato que a tela já exibe (colunas/linhas), ordenada pelo maior impacto. */
export function comparacaoParaTabela(c: ComparacaoPeriodos) {
  const colunas = [c.colunaChave, ...(c.colunaDescricao ? [c.colunaDescricao] : []), c.periodoBase, c.periodoAtual, "Variação", "Variação %"];
  const linhas = c.itens.map((i) => {
    const linha: Record<string, unknown> = { [c.colunaChave]: i.chave };
    if (c.colunaDescricao) linha[c.colunaDescricao] = i.descricao;
    linha[c.periodoBase] = i.base;
    linha[c.periodoAtual] = i.atual;
    linha["Variação"] = i.variacao;
    linha["Variação %"] = i.variacaoPct;
    return linha;
  });
  return { colunas, linhas, totalLinhas: linhas.length };
}
