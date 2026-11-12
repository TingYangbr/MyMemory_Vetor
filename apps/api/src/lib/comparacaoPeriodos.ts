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
  medidas?: { medida: string; campo: string; alias?: string }[];
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
interface PlanoMin {
  queries: QueryPlanoMin[];
  /** "só itens que tiveram movimento nos dois períodos" */
  comparacao_somente_em_ambos?: boolean;
}
interface ResultadoMin { colunas: string[]; linhas: Record<string, unknown>[] }

export interface ItemComparacao {
  chave: string;
  descricao: string | null;
  base: number;
  atual: number;
  variacao: number;
  variacaoPct: number | null;
  situacao: "aumento" | "reducao" | "estavel" | "novo" | "sem_movimento_atual";
  /** Demais medidas (quando a consulta tem mais de uma, ex.: faturamento e CMV), na ordem de medidasExtras. */
  extras?: { base: number; atual: number; variacao: number; variacaoPct: number | null }[];
}

export interface MedidaExtraComparacao {
  coluna: string;
  totalBase: number;
  totalAtual: number;
  variacaoTotal: number;
  variacaoTotalPct: number | null;
}

export interface ComparacaoPeriodos {
  periodoBase: string;
  periodoAtual: string;
  colunaChave: string;
  colunaDescricao: string | null;
  /** Coluna da medida principal (a primeira). */
  colunaMedida?: string;
  /** Medidas além da principal (ex.: CMV ao lado do faturamento). */
  medidasExtras?: MedidaExtraComparacao[];
  /** Só entraram itens presentes nos dois períodos. */
  somenteEmAmbos?: boolean;
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
  // "% do total geral" (subconjunto × total) não é comparação de períodos. Não testar só "percentual":
  // "variação percentual de fev sobre jan" É comparação e cairia aqui.
  if (qs.some((q) => /total geral/i.test(q.motivo_uso))) return null;

  const ag = a.agregacao;
  const ag2 = b.agregacao;
  if (!ag || !ag2) return null;
  if (ag.group_by_trunc?.length || ag2.group_by_trunc?.length) return null;
  const assinatura = (x: AgregacaoMin) =>
    x.medidas?.length
      ? x.medidas.map((m) => `${m.medida}:${m.campo}`.toLowerCase()).join("|")
      : `${x.medida}:${x.campo_medida ?? ""}`.toLowerCase();
  if (assinatura(ag) !== assinatura(ag2)) return null;
  const funcoes = ag.medidas?.length ? ag.medidas.map((m) => m.medida) : [ag.medida];
  if (funcoes.some((f) => f !== "sum" && f !== "count")) return null;
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

  // Colunas de cada resultado: as do group_by + as medidas, casadas pela POSIÇÃO — o planejador às vezes
  // dá apelidos diferentes por período (ex.: faturamento_janeiro × faturamento_fevereiro)
  const estrutura = (colunas: string[]) => {
    const g = ag.group_by.map((x) => acharColuna(colunas, x));
    if (colunas.length === 0 || g.some((c) => !c)) return null;
    const grupoR = g as string[];
    return { grupo: grupoR, medidas: colunas.filter((c) => !grupoR.includes(c)) };
  };
  const e0 = estrutura(resultados[0].colunas);
  const e1 = estrutura(resultados[1].colunas);
  if (!e0 || !e1) return null;
  if (e0.medidas.length < 1 || e0.medidas.length > 4 || e0.medidas.length !== e1.medidas.length) return null;
  const grupo = e0.grupo;
  // Nome exibido da medida: o apelido, se igual nos dois; senão a coluna somada (ex.: Valor_Prod_Fat)
  const nomesMedidas = e0.medidas.map((c, k) =>
    c.toLowerCase() === e1.medidas[k].toLowerCase() ? c : (ag.medidas?.[k]?.campo ?? (k === 0 ? ag.campo_medida : null) ?? c)
  );
  const colMedida = nomesMedidas[0];
  const colsExtras = nomesMedidas.slice(1);
  const somenteEmAmbos = plano.comparacao_somente_em_ambos === true;

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
  const num = (v: unknown) => {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n)) throw new Error("medida não numérica");
    return n;
  };
  const juntar = (linhas: Record<string, unknown>[], est: { grupo: string[]; medidas: string[] }) => {
    const m = new Map<string, { valor: number; extras: number[]; desc: string | null }>();
    for (const l of linhas) {
      const v = num(l[est.medidas[0]]);
      const ex = est.medidas.slice(1).map((c) => num(l[c]));
      const chave = String(l[est.grupo[0]] ?? "").trim();
      const desc = est.grupo.slice(1).map((c) => l[c]).filter((x) => !vazio(x)).join(" | ") || null;
      const ant = m.get(chave);
      m.set(chave, {
        valor: (ant?.valor ?? 0) + v,
        extras: ex.map((x, i) => (ant?.extras[i] ?? 0) + x),
        desc: ant?.desc ?? desc,
      });
    }
    return m;
  };
  const estr = [e0, e1];
  const mBase = juntar(resultados[ib].linhas, estr[ib]);
  const mAtual = juntar(resultados[ia].linhas, estr[ia]);
  // "Só os que tiveram movimento nos dois períodos": descarta os que aparecem em um só
  if (somenteEmAmbos) {
    for (const k of [...mBase.keys()]) if (!mAtual.has(k)) mBase.delete(k);
    for (const k of [...mAtual.keys()]) if (!mBase.has(k)) mAtual.delete(k);
  }

  const itens: ItemComparacao[] = [];
  for (const chave of new Set([...mBase.keys(), ...mAtual.keys()])) {
    const vb = mBase.get(chave)?.valor ?? 0;
    const va = mAtual.get(chave)?.valor ?? 0;
    const extras = colsExtras.map((_, i) => {
      const eb = mBase.get(chave)?.extras[i] ?? 0;
      const ea = mAtual.get(chave)?.extras[i] ?? 0;
      return { base: r2(eb), atual: r2(ea), variacao: r2(ea - eb), variacaoPct: pct(ea - eb, eb) };
    });
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
      ...(extras.length ? { extras } : {}),
    });
  }
  itens.sort((x, y) => Math.abs(y.variacao) - Math.abs(x.variacao));

  const totalBase = r2([...mBase.values()].reduce((s, x) => s + x.valor, 0));
  const totalAtual = r2([...mAtual.values()].reduce((s, x) => s + x.valor, 0));
  const medidasExtras: MedidaExtraComparacao[] = colsExtras.map((coluna, i) => {
    const tb = r2([...mBase.values()].reduce((s, x) => s + x.extras[i], 0));
    const ta = r2([...mAtual.values()].reduce((s, x) => s + x.extras[i], 0));
    return { coluna, totalBase: tb, totalAtual: ta, variacaoTotal: r2(ta - tb), variacaoTotalPct: pct(ta - tb, tb) };
  });
  return {
    periodoBase,
    periodoAtual,
    colunaChave: colChave,
    colunaDescricao: colsDesc.length ? colsDesc.join(" | ") : null,
    colunaMedida: colMedida,
    ...(medidasExtras.length ? { medidasExtras } : {}),
    ...(somenteEmAmbos ? { somenteEmAmbos } : {}),
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
    ...(c.somenteEmAmbos ? { filtro: "somente itens com movimento nos dois períodos" } : {}),
    ...(c.colunaMedida ? { medida_principal: c.colunaMedida } : {}),
    total_base: c.totalBase,
    total_atual: c.totalAtual,
    variacao_total: c.variacaoTotal,
    variacao_total_pct: c.variacaoTotalPct,
    itens_comparados: c.totalItens,
    itens_com_aumento: c.itens.filter((i) => i.variacao > 0).length,
    itens_com_reducao: c.itens.filter((i) => i.variacao < 0).length,
    aviso_destaques:
      "maiores_aumentos_em_valor e maiores_reducoes_em_valor estão ordenados pela variação em VALOR (R$), não pelo %. " +
      "Ao citá-los, diga que são os maiores \"em valor\" e mostre a variação em R$ e o %, ex.: \"PROD X: −R$ 48.917,58 (−98,0%)\". " +
      "Nunca os apresente como ranking de percentual.",
    maiores_aumentos_em_valor: aumentos,
    maiores_reducoes_em_valor: reducoes,
    ...(c.medidasExtras?.length
      ? {
          outras_medidas: c.medidasExtras.map((m) => ({
            medida: m.coluna,
            total_base: m.totalBase,
            total_atual: m.totalAtual,
            variacao_total: m.variacaoTotal,
            variacao_total_pct: m.variacaoTotalPct,
          })),
          aviso_outras_medidas: "Nos itens, 'extras' traz as outras medidas na mesma ordem de outras_medidas.",
        }
      : {}),
  };
}

/** Tabela completa no formato que a tela já exibe (colunas/linhas), ordenada pelo maior impacto. */
export function comparacaoParaTabela(c: ComparacaoPeriodos) {
  if (c.medidasExtras?.length) return tabelaVariasMedidas(c);
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

/** Mais de uma medida: por medida, valor no período base, no atual e a variação %. */
function tabelaVariasMedidas(c: ComparacaoPeriodos) {
  const nomes = [c.colunaMedida ?? "valor", ...(c.medidasExtras ?? []).map((m) => m.coluna)];
  const colunas = [c.colunaChave, ...(c.colunaDescricao ? [c.colunaDescricao] : [])];
  for (const n of nomes) colunas.push(`${n} ${c.periodoBase}`, `${n} ${c.periodoAtual}`, `${n} var. %`);
  const linhas = c.itens.map((i) => {
    const linha: Record<string, unknown> = { [c.colunaChave]: i.chave };
    if (c.colunaDescricao) linha[c.colunaDescricao] = i.descricao;
    const vals = [{ base: i.base, atual: i.atual, variacaoPct: i.variacaoPct }, ...(i.extras ?? [])];
    nomes.forEach((n, k) => {
      linha[`${n} ${c.periodoBase}`] = vals[k]?.base ?? 0;
      linha[`${n} ${c.periodoAtual}`] = vals[k]?.atual ?? 0;
      linha[`${n} var. %`] = vals[k]?.variacaoPct ?? null;
    });
    return linha;
  });
  return { colunas, linhas, totalLinhas: linhas.length };
}
