/**
 * Pergunta salva com plano: guarda a classificação e o plano do planejador (queries, parâmetros, agregação)
 * para reexecutar sem as chamadas de IA de classificação e planejamento. Os parâmetros viram "chips"
 * na frase da pergunta, trocáveis por teclado ou voz.
 */
import { normalizarDataParaIso } from "./dataCampo.js";
import type { ComandoCriacao, PerguntaClassificacao } from "./index.js";

export interface PlanoSalvoParam {
  nome: string;
  termo_usuario: string;
  valor: unknown;
  tipo: string;
  operador_sugerido: string;
  obrigatorio: boolean;
  precisa_normalizacao: boolean;
}

export interface PlanoSalvoQuery {
  query_id: string;
  parametros: PlanoSalvoParam[];
  [k: string]: unknown;
}

export interface PlanoSalvo {
  queries: PlanoSalvoQuery[];
  [k: string]: unknown;
}

export interface PerguntaPlanoSalvo {
  versao: 1;
  classificacao: PerguntaClassificacao;
  plano: PlanoSalvo;
  /** query_id → hash do SQL e dos parâmetros no momento do salvamento; mudou → replaneja */
  queryHashes: Record<string, string>;
}

export type PerguntaChipTipo = "texto" | "lista" | "numero" | "periodo";

export interface PeriodoValor {
  ini: string | null;
  fin: string | null;
  /** Rótulo do atalho escolhido (ex.: "últimos 6 meses"); null = datas digitadas */
  rotulo?: string | null;
}

export type PerguntaChipValor = string | PeriodoValor;

export interface PerguntaChip {
  /** Identificador estável do chip (ex.: "abrev_empresa", "periodo:data_emissao") */
  chave: string;
  rotulo: string;
  tipo: PerguntaChipTipo;
  /** Nome do parâmetro (texto/lista/número) ou base do par _ini/_fin (período), em minúsculas */
  param: string;
  valor: PerguntaChipValor;
  /** Trecho da pergunta de onde o valor veio (termo_usuario do planejador) */
  termo: string;
  /** Primeira query do plano que usa este parâmetro (usada para sugerir valores) */
  queryId: string;
}

const PARAMS_SISTEMA = new Set(["userid", "groupid"]);

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function ehData(tipo: string, valor: unknown): boolean {
  return /^(date|data)$/i.test(tipo) || (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}/.test(valor));
}

function humanizar(nome: string): string {
  const t = nome.replace(/_/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : nome;
}

const PALAVRAS_LIGACAO = new Set(["a", "o", "as", "os", "de", "do", "da", "dos", "das", "para", "pro", "pra", "com", "contendo", "em", "no", "na", "ao", "e"]);

/** "cliente Genea" com valor "Genea" → "Cliente"; "tipo contendo proposta" → "Tipo"; senão o nome humanizado. */
function rotuloDe(termo: string, valor: string, nome: string): string {
  const pos = semAcento(termo).indexOf(semAcento(valor));
  const antes = (pos > 0 ? termo.slice(0, pos) : "").trim().split(/\s+/).filter(Boolean);
  while (antes.length && PALAVRAS_LIGACAO.has(semAcento(antes[antes.length - 1]).replace(/["']/g, ""))) antes.pop();
  const rotulo = antes.join(" ").replace(/["']/g, "").trim();
  if (rotulo && antes.length <= 3 && !/\d/.test(rotulo)) return humanizar(rotulo);
  return humanizar(nome);
}

/** Parâmetros do plano viram chips; pares _ini/_fin de data viram um chip de período. */
export function derivarChips(plano: PlanoSalvo): PerguntaChip[] {
  const chips = new Map<string, PerguntaChip>();
  for (const q of plano.queries ?? []) {
    for (const p of q.parametros ?? []) {
      const nome = String(p.nome ?? "").toLowerCase();
      if (!nome || PARAMS_SISTEMA.has(nome) || p.valor == null || p.valor === "") continue;
      const sufixo = /_(ini|fin)$/.exec(nome);
      if (sufixo && ehData(p.tipo, p.valor)) {
        const base = nome.slice(0, -4);
        const chave = `periodo:${base}`;
        const atual = chips.get(chave) ?? {
          chave, rotulo: "Período", tipo: "periodo" as const, param: base,
          valor: { ini: null, fin: null } as PeriodoValor, termo: p.termo_usuario ?? "", queryId: q.query_id,
        };
        const v = atual.valor as PeriodoValor;
        if (sufixo[1] === "ini") v.ini = String(p.valor).slice(0, 10);
        else v.fin = String(p.valor).slice(0, 10);
        if (!atual.termo && p.termo_usuario) atual.termo = p.termo_usuario;
        chips.set(chave, atual);
        continue;
      }
      if (chips.has(nome)) continue;
      const lista = Array.isArray(p.valor) || /lista/i.test(p.tipo);
      const numero = !lista && /^(number|numero|numeric)$/i.test(p.tipo);
      const valorTxt = Array.isArray(p.valor) ? p.valor.map(String).join(", ") : String(p.valor).replace(/%/g, "");
      chips.set(nome, {
        chave: nome,
        rotulo: rotuloDe(p.termo_usuario ?? "", valorTxt, nome.replace(/_(in|nin|ini|fin)$/, "")),
        tipo: lista ? "lista" : numero ? "numero" : "texto",
        param: nome,
        valor: valorTxt,
        termo: p.termo_usuario ?? "",
        queryId: q.query_id,
      });
    }
  }
  return [...chips.values()];
}

// ── Período ─────────────────────────────────────────────────────────────────

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fimDoMes = (a: number, m: number) => new Date(a, m + 1, 0);

export const PERIODO_ATALHOS: { id: string; rotulo: string }[] = [
  { id: "hoje", rotulo: "hoje" },
  { id: "este_mes", rotulo: "este mês" },
  { id: "mes_passado", rotulo: "mês passado" },
  { id: "ultimos_3_meses", rotulo: "últimos 3 meses" },
  { id: "ultimos_6_meses", rotulo: "últimos 6 meses" },
  { id: "ultimos_12_meses", rotulo: "últimos 12 meses" },
  { id: "este_ano", rotulo: "este ano" },
  { id: "ano_passado", rotulo: "ano passado" },
  { id: "proximos_30_dias", rotulo: "próximos 30 dias" },
];

export function calcularPeriodo(id: string, hoje = new Date()): PeriodoValor | null {
  const a = hoje.getFullYear();
  const m = hoje.getMonth();
  const rotulo = PERIODO_ATALHOS.find((x) => x.id === id)?.rotulo ?? null;
  const ultimos = /^ultimos_(\d+)_meses$/.exec(id);
  if (id === "hoje") return { ini: iso(hoje), fin: iso(hoje), rotulo };
  if (id === "este_mes") return { ini: iso(new Date(a, m, 1)), fin: iso(fimDoMes(a, m)), rotulo };
  if (id === "mes_passado") return { ini: iso(new Date(a, m - 1, 1)), fin: iso(fimDoMes(a, m - 1)), rotulo };
  if (ultimos) {
    const n = Number(ultimos[1]);
    return { ini: iso(new Date(a, m - n, hoje.getDate())), fin: iso(hoje), rotulo: rotulo ?? `últimos ${n} meses` };
  }
  if (id === "este_ano") return { ini: `${a}-01-01`, fin: `${a}-12-31`, rotulo };
  if (id === "ano_passado") return { ini: `${a - 1}-01-01`, fin: `${a - 1}-12-31`, rotulo };
  if (id === "proximos_30_dias") return { ini: iso(hoje), fin: iso(new Date(a, m, hoje.getDate() + 30)), rotulo };
  return null;
}

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const NUM_EXTENSO: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12 };

/** Fala/texto livre → período ("mês passado", "últimos três meses", "março de 2025", "2025"). Sem IA. */
export function interpretarPeriodo(texto: string, hoje = new Date()): PeriodoValor | null {
  const t = semAcento(texto).replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/\bhoje\b/.test(t)) return calcularPeriodo("hoje", hoje);
  if (/\b(este|esse|neste|nesse) mes\b|\bmes atual\b/.test(t)) return calcularPeriodo("este_mes", hoje);
  if (/\b(mes passado|ultimo mes|mes anterior)\b/.test(t)) return calcularPeriodo("mes_passado", hoje);
  if (/\b(este|esse|neste|nesse) ano\b|\bano atual\b/.test(t)) return calcularPeriodo("este_ano", hoje);
  if (/\b(ano passado|ultimo ano|ano anterior)\b/.test(t)) return calcularPeriodo("ano_passado", hoje);
  const ult = /\bultim[oa]s? (\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze) (mes|meses|dia|dias)\b/.exec(t);
  if (ult) {
    const n = /^\d+$/.test(ult[1]) ? Number(ult[1]) : NUM_EXTENSO[ult[1]];
    if (ult[2].startsWith("mes")) {
      const p = calcularPeriodo(`ultimos_${n}_meses`, hoje);
      return p ? { ...p, rotulo: `últimos ${n} meses` } : null;
    }
    const ini = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - n);
    return { ini: iso(ini), fin: iso(hoje), rotulo: `últimos ${n} dias` };
  }
  const mesAno = new RegExp(`\\b(${MESES.join("|")})(?: de)? (\\d{4})\\b`).exec(t);
  if (mesAno) {
    const mi = MESES.indexOf(mesAno[1]);
    const a = Number(mesAno[2]);
    return { ini: iso(new Date(a, mi, 1)), fin: iso(fimDoMes(a, mi)), rotulo: `${mesAno[1] === "marco" ? "março" : mesAno[1]} de ${a}` };
  }
  const soMes = new RegExp(`\\b(${MESES.join("|")})\\b`).exec(t);
  if (soMes) {
    const mi = MESES.indexOf(soMes[1]);
    const a = hoje.getFullYear();
    return { ini: iso(new Date(a, mi, 1)), fin: iso(fimDoMes(a, mi)), rotulo: `${soMes[1] === "marco" ? "março" : soMes[1]} de ${a}` };
  }
  const ano = /\b(19|20)(\d{2})\b/.exec(t);
  if (ano) {
    const a = Number(ano[1] + ano[2]);
    return { ini: `${a}-01-01`, fin: `${a}-12-31`, rotulo: `${a}` };
  }
  return null;
}

/** Texto curto para mostrar no chip de período. */
export function descreverPeriodo(v: PeriodoValor): string {
  if (v.rotulo) return v.rotulo;
  const br = (s: string | null) => (s ? s.split("-").reverse().join("/") : "…");
  return `${br(v.ini)} a ${br(v.fin)}`;
}

export function descreverValorChip(chip: PerguntaChip, valor: PerguntaChipValor): string {
  return chip.tipo === "periodo" ? descreverPeriodo(valor as PeriodoValor) : String(valor);
}

// ── Frase com chips ─────────────────────────────────────────────────────────

/** `texto` no segmento de chip = trecho original da pergunta coberto pelo chip */
export type SegmentoPergunta = { texto: string } | { chip: PerguntaChip; texto: string };

const PREPOSICAO_PERIODO = /(?:^|\s)(no|nos|na|nas|em|do|dos|da|das|de|durante)\s+$/i;

/** Localiza `agulha` em `texto` ignorando acentos e maiúsculas; devolve [início, fim) no texto original. */
function localizar(texto: string, agulha: string): [number, number] | null {
  if (!agulha.trim()) return null;
  const mapa: number[] = [];
  let norm = "";
  for (let i = 0; i < texto.length; i++) {
    const n = semAcento(texto[i]);
    for (let k = 0; k < n.length; k++) { norm += n[k]; mapa.push(i); }
  }
  const pos = norm.indexOf(semAcento(agulha));
  if (pos < 0) return null;
  const fimNorm = pos + semAcento(agulha).length - 1;
  return [mapa[pos], mapa[fimNorm] + 1];
}

/**
 * Divide a pergunta em trechos de texto e chips. O chip ocupa o lugar do valor (texto/lista/número)
 * ou do termo inteiro (período). Chips que não aparecem na frase vão em `extras`.
 */
export function montarFrase(pergunta: string, chips: PerguntaChip[]): { segmentos: SegmentoPergunta[]; extras: PerguntaChip[] } {
  const posicoes: { ini: number; fim: number; chip: PerguntaChip }[] = [];
  const extras: PerguntaChip[] = [];
  for (const chip of chips) {
    let achou: [number, number] | null = null;
    const termo = localizar(pergunta, chip.termo);
    if (chip.tipo === "periodo") {
      // Inclui a preposição anterior ("nos últimos 6 meses") para a troca soar natural
      const prep = termo ? PREPOSICAO_PERIODO.exec(pergunta.slice(0, termo[0])) : null;
      achou = termo && prep ? [termo[0] - prep[0].trimStart().length, termo[1]] : termo;
    }
    else if (termo) {
      // Valor dentro do termo: o chip vai do valor até o fim do termo ("empresa [Gama Quimica]"),
      // cobrindo o nome inteiro mesmo quando o planejador usou curinga (GAMA%)
      const dentro = localizar(pergunta.slice(termo[0], termo[1]), String(chip.valor));
      achou = dentro ? [termo[0] + dentro[0], termo[1]] : termo;
    } else achou = localizar(pergunta, String(chip.valor));
    if (achou && posicoes.some((p) => achou![0] < p.fim && achou![1] > p.ini)) achou = null;
    if (achou) posicoes.push({ ini: achou[0], fim: achou[1], chip });
    else extras.push(chip);
  }
  posicoes.sort((a, b) => a.ini - b.ini);
  const segmentos: SegmentoPergunta[] = [];
  let cursor = 0;
  for (const p of posicoes) {
    if (p.ini > cursor) segmentos.push({ texto: pergunta.slice(cursor, p.ini) });
    segmentos.push({ chip: p.chip, texto: pergunta.slice(p.ini, p.fim) });
    cursor = p.fim;
  }
  if (cursor < pergunta.length) segmentos.push({ texto: pergunta.slice(cursor) });
  return { segmentos, extras };
}

/** Pergunta com os valores atuais dos chips (para a síntese e para o caminho completo, se replanejar). */
export function perguntaComValores(pergunta: string, chips: PerguntaChip[], valores: Record<string, PerguntaChipValor>): string {
  const { segmentos, extras } = montarFrase(pergunta, chips);
  let texto = segmentos
    .map((s) => {
      if (!("chip" in s)) return s.texto;
      const v = valores[s.chip.chave];
      if (v == null || valorIgual(v, s.chip.valor)) return s.texto;
      const desc = descreverValorChip(s.chip, v);
      return s.chip.tipo === "periodo" ? `no período ${desc}` : desc;
    })
    .join("");
  for (const chip of extras) {
    const v = valores[chip.chave];
    if (v != null && !valorIgual(v, chip.valor)) texto += ` (${chip.rotulo}: ${descreverValorChip(chip, v)})`;
  }
  return texto;
}

export function valorIgual(a: PerguntaChipValor, b: PerguntaChipValor): boolean {
  if (typeof a === "string" || typeof b === "string") return String(a).trim() === String(b).trim();
  return a.ini === b.ini && a.fin === b.fin;
}

/** Aplica os valores dos chips nos parâmetros do plano (cópia). Chip não alterado mantém o valor original. */
export function aplicarValoresNoPlano(plano: PlanoSalvo, chips: PerguntaChip[], valores: Record<string, PerguntaChipValor>): PlanoSalvo {
  const copia = JSON.parse(JSON.stringify(plano)) as PlanoSalvo;
  for (const chip of chips) {
    const v = valores[chip.chave];
    if (v == null || valorIgual(v, chip.valor)) continue;
    for (const q of copia.queries) {
      if (chip.tipo === "periodo") {
        const pv = v as PeriodoValor;
        for (const suf of ["ini", "fin"] as const) {
          const nome = `${chip.param}_${suf}`;
          const valor = suf === "ini" ? pv.ini : pv.fin;
          const existente = q.parametros.find((p) => p.nome.toLowerCase() === nome);
          if (existente) existente.valor = valor;
          else if (valor && q.parametros.some((p) => p.nome.toLowerCase().startsWith(chip.param))) {
            q.parametros.push({
              nome, termo_usuario: chip.termo, valor, tipo: "data",
              operador_sugerido: suf === "ini" ? ">=" : "<=", obrigatorio: false, precisa_normalizacao: false,
            });
          }
        }
        continue;
      }
      const p = q.parametros.find((x) => x.nome.toLowerCase() === chip.param);
      if (!p) continue;
      const txt = String(v).trim();
      if (chip.tipo === "lista") p.valor = txt.split(",").map((s) => s.trim()).filter(Boolean);
      else if (chip.tipo === "numero") p.valor = Number(txt.replace(/\./g, "").replace(",", "."));
      else {
        // Mantém os curingas que o planejador usou ("GAMA%" → "GENEA%")
        const orig = typeof p.valor === "string" ? p.valor : "";
        p.valor = `${orig.startsWith("%") ? "%" : ""}${txt}${orig.endsWith("%") && orig.length > 1 ? "%" : ""}`;
      }
    }
  }
  return copia;
}

// ── Modelo de registro: pergunta salva que CRIA um memo ─────────────────────

/**
 * Pergunta salva a partir de um pedido de criação ("minha medida de hoje: peso 78,5, IGP 45…").
 * Não guarda valores: só o começo da frase e os campos da categoria. Ao usar, os chips começam vazios e o
 * texto enviado à IA leva apenas o que foi preenchido — nada de ontem é regravado e o campo vazio fica nulo.
 * Ao enviar, o servidor monta o cartão "Revisar e salvar" direto dos valores dos chips, sem IA
 * (como a pergunta salva com parâmetros pula a classificação e o planejamento). Se a categoria ou um
 * campo mudou, o texto segue pelo caminho normal, com IA.
 */
export interface PerguntaPlanoCriacao {
  versao: 1;
  tipo: "criacao";
  categoria: string;
  /** Começo da frase, sempre terminado em ":". */
  prefixo: string;
  campos: { nome: string; tipo: "texto" | "numero" }[];
  /** Campos de data que, ao salvar o modelo, valiam "hoje": no uso recebem a data do dia (nunca a de quando foi salvo). */
  hoje?: string[];
}

export function ehPlanoCriacao(p: unknown): p is PerguntaPlanoCriacao {
  if (!p || typeof p !== "object") return false;
  const o = p as { tipo?: unknown; campos?: unknown };
  return o.tipo === "criacao" && Array.isArray(o.campos);
}

/** Campos que viram chip: texto e número, fora o campo dono (o sistema o preenche com quem salva). */
export function camposDeModeloCriacao(criacao: ComandoCriacao): PerguntaPlanoCriacao["campos"] {
  const dono = criacao.campoDono ? semAcento(criacao.campoDono).trim() : null;
  return criacao.campos
    .filter((c) => (c.tipo === "text" || c.tipo === "number") && semAcento(c.nome).trim() !== dono)
    .map((c) => ({ nome: c.nome, tipo: c.tipo === "number" ? ("numero" as const) : ("texto" as const) }));
}

/** Começo da frase: o que vem antes do primeiro nome de campo (ou do primeiro número) na frase original. */
function prefixoDeCriacao(pergunta: string, categoria: string, nomesCampos: string[]): string {
  const base = pergunta.trim();
  let corte = -1;
  for (const nome of nomesCampos) {
    const pos = localizar(base, nome);
    if (pos && (corte < 0 || pos[0] < corte)) corte = pos[0];
  }
  if (corte < 0) {
    const m = /\d/.exec(base);
    if (m) corte = m.index;
  }
  const ini = (corte >= 0 ? base.slice(0, corte) : base).replace(/[\s:;,\-–—]+$/u, "").trim();
  return `${ini || `Novo registro em ${categoria}`}:`;
}

/** Plano de um modelo de registro, ou null se a categoria não tem campo de texto/número para virar chip. */
export function planoDeCriacao(criacao: ComandoCriacao, pergunta: string, hojeIso?: string): PerguntaPlanoCriacao | null {
  const campos = camposDeModeloCriacao(criacao);
  if (!campos.length || !criacao.categoria) return null;
  // Campos de data com o valor do dia em que o modelo foi salvo → "hoje" (a data que o AI extraiu de "de hoje")
  const hoje: string[] = [];
  if (hojeIso) {
    let extraidos: Record<string, unknown> = {};
    try {
      const j = JSON.parse(criacao.processado.dadosEspecificosJson ?? "{}") as unknown;
      if (j && typeof j === "object" && !Array.isArray(j)) extraidos = j as Record<string, unknown>;
    } catch { /* sem campos extraídos */ }
    for (const c of criacao.campos) {
      if (c.tipo !== "date") continue;
      const k = Object.keys(extraidos).find((x) => semAcento(x).trim() === semAcento(c.nome).trim());
      const v = k != null ? String(extraidos[k] ?? "") : "";
      if (v && normalizarDataParaIso(v) === hojeIso) hoje.push(c.nome);
    }
  }
  return {
    versao: 1,
    tipo: "criacao",
    categoria: criacao.categoria,
    prefixo: prefixoDeCriacao(pergunta, criacao.categoria, campos.map((c) => c.nome)),
    campos,
    ...(hoje.length ? { hoje } : {}),
  };
}

/** Chips do modelo de registro: todos vazios (valor "" e sem trecho na frase → aparecem depois do começo dela). */
export function chipsDeCriacao(plano: PerguntaPlanoCriacao): PerguntaChip[] {
  return plano.campos.map((c) => ({
    chave: c.nome,
    rotulo: c.nome,
    tipo: c.tipo,
    param: c.nome,
    valor: "",
    termo: "",
    queryId: "",
  }));
}

/** Texto enviado à IA: começo da frase + só os campos preenchidos. Vazio se nada foi preenchido. */
export function textoDeCriacao(plano: PerguntaPlanoCriacao, valores: Record<string, PerguntaChipValor>): string {
  const partes: string[] = [];
  for (const c of plano.campos) {
    const v = valores[c.nome];
    const t = typeof v === "string" ? v.trim() : "";
    if (t) partes.push(`${c.nome}: ${t}`);
  }
  return partes.length ? `${plano.prefixo} ${partes.join(" - ")}` : "";
}
