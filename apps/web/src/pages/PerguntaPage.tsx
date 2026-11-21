import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { pegarPerguntaAgora } from "../lib/perguntarAgora";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type {
  MeResponse,
  MemoContextCategory,
  MemoContextStructureResponse,
  MemoRecentCard,
  PerguntaCardHistorico,
  PerguntaLlmTraceEntry,
  PerguntaModelo,
  PerguntaResponse,
  PerguntaResultadoEstruturado,
  PerguntaChip,
  PerguntaChipValor,
} from "@mymemory/shared";
import { camposDeModeloCriacao, chipsDeCriacao, derivarChips, ehPlanoCriacao, escreverItensLista, lerItensLista, perguntaComValores, planoDeCriacao, situacaoEncerrada, textoDeCriacao, toParamName } from "@mymemory/shared";
import type { EstadoItemLista, ItemLista } from "@mymemory/shared";
import type { ComandoAlteracao, ComandoCriacao, MemoAlteracaoResponse } from "@mymemory/shared";
import { apiDeleteJson, apiGet, apiGetOptional, apiPatchJson, apiPostJson, apiPutJson, avisos as avisosApi } from "../api";
import Header from "../components/Header";
import { useCategoryOptions } from "../hooks/useCategoryOptions";
import { IconBell, IconChat, IconChatPlus, IconInfo, IconMic, IconPin, IconRefresh, IconSend, IconStar, IconStop, IconVolume, IconX } from "../components/icons";
import { MemoFilePreviewModal } from "../components/MemoFilePreviewModal";
import { MemoResultListRow } from "../components/MemoResultListRow";
import { PerguntaChips } from "../components/PerguntaChips";
import { MemoAlteracaoCartao } from "../components/MemoAlteracaoCartao";
import { MemoNovoCartao } from "../components/MemoNovoCartao";
import { RelacaoAposSalvar } from "../components/RelacaoAposSalvar";
import styles from "./PerguntaPage.module.css";

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

/** Resposta curta de concordância ("sim", "pode", "ok", "quero"…), dita ou digitada. */
const RESPOSTA_SIM = /^\s*(sim|s|pode|pode sim|pode ser|ok|okay|claro|quero|isso|faça|faz|procure|procura|busque|busca|yes)\s*[.!]*\s*$/i;

const COLUNA_LABELS: Record<string, string> = {
  id: "ID", resumo: "Resumo", keywords: "Keywords",
  mediaType: "Tipo", mediaText: "Conteúdo", mediatext: "Conteúdo",
  data: "Data", createdAt: "Data criação", total: "Total", mes: "Mês",
  category: "Categoria",
  // campos estruturados de domínio — mantidos em português para unificar com dadosEspecificos
  andar: "Andar",
  area_m2: "Área m2",
  area_terreno: "Área Terreno",
  quantos_comodos: "Quantos Cômodos",
  idade_anos: "Idade (anos)",
  interessado_nome: "Interessado nome",
  interessado_telefone: "Interessado telefone",
  regiao: "Região",
  vagas_garagem: "Vagas garagem",
  intencao: "Intenção",
};

const MEDIA_TYPE_LABELS: Record<string, string> = {
  text: "Texto", audio: "Áudio", image: "Imagem",
  video: "Vídeo", document: "Documento", url: "URL",
};

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "$1")          // **negrito**
    .replace(/\*(.+?)\*/gs, "$1")               // *itálico*
    .replace(/`+([^`]+)`+/g, "$1")             // `código`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // [link](url)
    .replace(/^#{1,6}\s+/gm, "")               // # Títulos
    .replace(/^[-*]\s+/gm, "")                 // - listas
    .replace(/^\d+\.\s+/gm, "");               // 1. listas numeradas
}

function normalizeTtsText(text: string): string {
  return text
    // km² antes de m² para evitar match parcial
    .replace(/\bkm²/g,  "quilômetros quadrados")
    .replace(/\bkm2\b/gi, "quilômetros quadrados")
    .replace(/\bcm²/g,  "centímetros quadrados")
    .replace(/\bcm2\b/gi, "centímetros quadrados")
    .replace(/\bm²/g,   "metros quadrados")
    .replace(/\bm2\b/gi, "metros quadrados")
    // cúbicos
    .replace(/\bkm³/g,  "quilômetros cúbicos")
    .replace(/\bkm3\b/gi, "quilômetros cúbicos")
    .replace(/\bcm³/g,  "centímetros cúbicos")
    .replace(/\bcm3\b/gi, "centímetros cúbicos")
    .replace(/\bm³/g,   "metros cúbicos")
    .replace(/\bm3\b/gi, "metros cúbicos")
    // temperatura
    .replace(/(\d)\s*°C/g, "$1 graus Celsius")
    .replace(/(\d)\s*°F/g, "$1 graus Fahrenheit")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Resposta longa: mais de ~6 linhas na tela recolhe com "Ler mais". */
/** Acima disto, o texto de uma resposta com tabela fica recolhido em 2 linhas. */
const TEXTO_RESUMO_COM_TABELA = 140;

/** A resposta traz tabela (ou gráfico) com linhas abaixo do texto? */
function temTabelaNaResposta(resposta: { dados_estruturados?: unknown }): boolean {
  const de = resposta.dados_estruturados as { totalLinhas?: number; linhas?: unknown[] } | { totalLinhas?: number; linhas?: unknown[] }[] | null | undefined;
  return (de ? (Array.isArray(de) ? de : [de]) : []).some((d) => (d.totalLinhas ?? d.linhas?.length ?? 0) > 0);
}

function textoLongo(texto: string): boolean {
  return texto.length > 520 || texto.split("\n").length > 7;
}

/** Medidor de confiança: arco pequeno + porcentagem (verde ≥ 70, amarelo ≥ 40, vermelho abaixo). */
function MedidorConfianca({ valor, titulo }: { valor: number | null; titulo: string }) {
  const pct = valor == null ? null : Math.max(0, Math.min(100, Math.round(valor * 100)));
  const nivel = pct == null ? "vazio" : pct >= 70 ? "alto" : pct >= 40 ? "medio" : "baixo";
  // Arco de 180° com raio 8: comprimento ≈ 25,13
  const comprimento = 25.13;
  return (
    <span className={`${styles.medidor} ${styles[`medidor_${nivel}`]}`} title={titulo} aria-label={titulo}>
      <svg width="24" height="15" viewBox="0 0 24 15" aria-hidden>
        <path d="M4 12a8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" strokeLinecap="round" />
        {pct != null && pct > 0 ? (
          <path
            d="M4 12a8 8 0 0 1 16 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(comprimento * pct) / 100} ${comprimento}`}
          />
        ) : null}
      </svg>
      <span className={styles.medidorValor}>{pct == null ? "—" : `${pct}%`}</span>
    </span>
  );
}

function IconTrace({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="16 18 22 12 16 6"/>
      <polyline points="8 6 2 12 8 18"/>
    </svg>
  );
}

function IconPdf({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <text x="12" y="17.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="currentColor" stroke="none">PDF</text>
    </svg>
  );
}

function MediaTypeIcon({ mediaType, fileUrl, displayName }: {
  mediaType?: string | null;
  fileUrl?: string | null;
  displayName?: string | null;
}) {
  const mt = mediaType ?? "";
  if (mt === "document") {
    const s = (fileUrl ?? "") + "|" + (displayName ?? "");
    const m = s.match(/\.(pdf|docx?|msg|eml)\b/i);
    const ext = m ? m[1]!.toLowerCase() : "";
    if (ext === "pdf") return <span className={styles.tableTagPdf}>PDF</span>;
    if (ext === "doc" || ext === "docx") return <span className={styles.tableTagDoc}>DOC</span>;
    if (ext === "msg" || ext === "eml") return (
      <span className={styles.tableTagGlyph}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
          <path d="M3 7l9 5.5L21 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
    return <span className={styles.tableTagDoc}>DOC</span>;
  }
  if (mt === "audio") return (
    <span className={styles.tableTagGlyph}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M11 5L6 9H3v6h3l5 4V5z" fill="currentColor"/>
        <path d="M15.5 9.5a3 3 0 010 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    </span>
  );
  if (mt === "image") return (
    <span className={styles.tableTagGlyph}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
        <circle cx="8.5" cy="10" r="1.5" fill="currentColor"/>
        <path d="M21 15l-5-5-4 4-3-3-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
  if (mt === "video") return (
    <span className={styles.tableTagGlyph}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="2" y="7" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="2"/>
        <path d="M17 10l4-2v8l-4-2v-4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
      </svg>
    </span>
  );
  if (mt === "url") return (
    <span className={styles.tableTagGlyph}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
        <path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    </span>
  );
  if (mt === "text") return <span className={styles.tableTagText}>T</span>;
  return (
    <span className={styles.tableTagGlyph}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
        <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
      </svg>
    </span>
  );
}

function formatNumericCell(num: number, colName: string): string {
  const col = colName.toLowerCase().replace(/[_\s]+/g, " ");
  if (/\b(dias?|prazos?|atrasos?)\b/.test(col))
    return Math.round(num).toLocaleString("pt-BR");
  if (/\b(taxas?|indices?|índices?|juros|percentual|percent)\b/.test(col))
    return num.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  if (/\b(valores?|vlr|vl|prec[oa]s?|custos?|saldos?|receitas?|despesas?|montantes?)\b/.test(col))
    return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num.toLocaleString("pt-BR");
}

/**
 * Datas vindas do banco (ISO "2026-04-07T00:00:00.000Z" ou mês agregado "2026-04") → dd/mm/aaaa ou mm/aaaa.
 * Meia-noite UTC é data pura do SQL: formata pelas partes do texto para não voltar um dia no fuso -03.
 * Retorna null quando o valor não é data.
 */
function formatDateCell(val: string): string | null {
  const s = val.trim();
  const mes = /^(\d{4})-(\d{2})$/.exec(s);
  if (mes) return `${mes[2]}/${mes[1]}`;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (!m) return null;
  const [, ano, mesNum, dia, hh, mi, ss] = m;
  const horaZero = !hh || (hh === "00" && mi === "00" && (!ss || ss === "00"));
  if (horaZero) return `${dia}/${mesNum}/${ano}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? `${dia}/${mesNum}/${ano}` : d.toLocaleDateString("pt-BR");
}

const DIAS_SEMANA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "25/11/2026" → "25/11/2026 (qua)". Só datas com dia (mês/ano fica como está); calculado da data, sem fuso. */
function comDiaDaSemana(data: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data);
  if (!m) return data;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? data : `${data} (${DIAS_SEMANA_CURTO[d.getUTCDay()]})`;
}

/** 1ª série na cor da marca; as demais bem distintas entre si. */
const CHART_BAR_COLORS = ["#0d9488", "#f59e0b", "#6366f1", "#e11d48", "#0ea5e9"];
const CHART_MAX_BARRAS = 25;
/** Máximo de barras (séries) por item do eixo X. */
const CHART_MAX_SERIES = 3;

/** Colunas de identificação (Num_Nota_Fiscal, Codigo_Produto, id…) não são medidas — nunca viram barra. */
/** Texto de uma célula da tabela estruturada — mesma formatação na tela e no PDF. */
function textoCelula(col: string, val: unknown): string {
  if (col === "mediaType" && typeof val === "string") return MEDIA_TYPE_LABELS[val] ?? val;
  if (val == null) return "—";
  if (typeof val === "string") {
    const data = formatDateCell(val);
    if (data) return comDiaDaSemana(data);
  }
  if (typeof val === "number" || (typeof val === "string" && val !== "" && !isNaN(Number(val)))) {
    const num = typeof val === "number" ? val : Number(val);
    // Colunas de variação ("var. %", "Variação %"): número com uma casa e o sinal de %
    if (/%\s*$/.test(col)) return `${num.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    return formatNumericCell(num, col);
  }
  return String(val);
}

function isColunaIdentificador(col: string): boolean {
  return /(^|_)(id|num|numero|nro|nr|cod|codigo)(_|$)/.test(col.toLowerCase());
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
}

/**
 * Escolhe até CHART_MAX_SERIES colunas: se a pergunta cita colunas, usa só as citadas; senão, as monetárias.
 * Palavra que aparece em muitas colunas (ex.: "valor" em todas as Valor_*) pesa menos (1/frequência),
 * para "valores presentes" apontar Valor_Presente_* e não todas as Valor_*.
 */
function escolherSeries(cols: string[], pergunta: string): string[] {
  const p = semAcento(pergunta);
  // "faturado"/"faturamento" sem "quantidade" explícita = valor monetário faturado (Valor_Prod_Fat, Valor_NF)
  const faturadoEhValor = /\bfatur/.test(p) && !/\b(quantidade|qtde|qtd|unidades|volume)\b/.test(p);
  const isValorFaturado = (col: string) =>
    /^(valor|vlr|total)(_prod(uto)?)?_(fat|faturado|faturamento|nf)$/.test(semAcento(col));
  const tokensPorCol = cols.map((col) =>
    semAcento(col).split(/[_\s]+/).filter((t) => t.length >= 4 && !(faturadoEhValor && t.startsWith("fatur")))
  );
  const freq = new Map<string, number>();
  for (const tokens of tokensPorCol) for (const t of new Set(tokens)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const isMonetaria = (col: string) => /(valor|vlr|preco|custo|total|saldo|montante|receita|despesa|lucro)/.test(semAcento(col));

  const avaliadas = cols.map((col, idx) => ({
    col,
    idx,
    citacao: tokensPorCol[idx].filter((t) => p.includes(t)).reduce((acc, t) => acc + 1 / (freq.get(t) ?? 1), 0),
    monetaria: isMonetaria(col) ? 1 : 0,
  }));
  // Entre as citadas, se houver monetárias fica só com elas: evita misturar quantidade e R$ na mesma escala
  const soMonetarias = (lista: typeof avaliadas) =>
    lista.some((a) => a.monetaria) ? lista.filter((a) => a.monetaria) : lista;
  // ≥ 0.75: exige ao menos uma palavra específica da coluna (palavra comum a 2+ colunas sozinha não basta)
  const citadas = avaliadas.filter((a) => a.citacao >= 0.75);
  const valorFaturado = faturadoEhValor && citadas.length === 0 ? avaliadas.filter((a) => isValorFaturado(a.col)) : [];
  const base = valorFaturado.length > 0 ? valorFaturado : soMonetarias(citadas.length > 0 ? citadas : avaliadas);
  return base
    .sort((a, b) => b.citacao - a.citacao || b.monetaria - a.monetaria || a.idx - b.idx)
    .slice(0, CHART_MAX_SERIES)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.col);
}

/**
 * Número de uma célula, aceitando o jeito brasileiro: "81,9", "1.234,56", "78,5 kg", "45%".
 * null quando não é número. Os campos de memo vêm como texto (o que a IA extraiu), quase sempre com vírgula.
 */
function numeroDaCelula(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let t = v.trim().replace(/\s*(kg|g|cm|m|%|r\$)\s*$/i, "").replace(/^r\$\s*/i, "").trim();
  if (!t) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
  const n = Number(t);
  return /^-?\d+(\.\d+)?$/.test(t) && Number.isFinite(n) ? n : null;
}

function isNumericCellValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string" && v.trim() !== "") return numeroDaCelula(v) != null;
  return false;
}

interface DadosGrafico {
  valueCols: string[];
  rows: Array<Record<string, string | number>>;
  /** Rótulos são datas, meses ou anos: barras em pé (linha do tempo). Senão, barras deitadas (ranking). */
  temporal: boolean;
  /** Séries em % no eixo da direita (as demais, em unidade, no da esquerda). */
  direita?: string[];
}

/** Coluna em %: pelo nome ("Taxa %", "perc_", "pct") — vai para o eixo da direita na escolha automática. */
const ehColunaPercentual = (col: string) => /%|(^|_)(perc|pct|percent)/i.test(col);

const MESES_RE = /^(jan(eiro)?|fev(ereiro)?|mar(co)?|abr(il)?|mai(o)?|jun(ho)?|jul(ho)?|ago(sto)?|set(embro)?|out(ubro)?|nov(embro)?|dez(embro)?)\.?(\s*(\/|de)?\s*\d{2,4})?$/i;

/** Rótulo de tempo: ano (2026), mês/ano (03/2026, 2026-03), data, nome de mês ou trimestre. */
function isRotuloTemporal(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (formatDateCell(t)) return true;
  return /^\d{4}$/.test(t)
    || /^\d{1,2}[/-]\d{4}$/.test(t)
    || /^\d{4}[/-]\d{1,2}$/.test(t)
    || /^[1-4]\s*[ºo°]?\s*(t|tri|trim|trimestre)\b/i.test(t)
    || /^[tq][1-4]\b/i.test(t)
    || MESES_RE.test(semAcento(t));
}

/**
 * Detecta colunas numéricas (exceto "id") e usa a primeira coluna não-numérica como eixo de categoria.
 * Quando TODAS as colunas são numéricas (ex.: ano + métricas, sem nenhuma coluna de texto), assume que a
 * primeira coluna é a categoria — convenção comum em queries agregadas, onde o group_by vem primeiro no SELECT.
 */
const CHART_MAX_ROTULOS_EIXO_X = 20;

/**
 * Gráfico pelos papéis dos campos da categoria (X = rótulos, Y = valores; vários Y = várias cores).
 * Linhas com o mesmo rótulo são somadas (ex.: várias contas do mesmo cliente). Com mais rótulos do que cabem,
 * fica com os maiores pelo primeiro Y (ranking) ou, se forem datas, com os primeiros.
 */
function graficoPelosPapeis(dados: PerguntaResultadoEstruturado): DadosGrafico | null {
  const g = dados.grafico;
  if (!g || !(g.y.length || g.y2?.length)) return null;
  const todas = dados.linhasCompletas?.length ? dados.linhasCompletas : dados.linhas;
  const valueCols = [...g.y, ...(g.y2 ?? [])].filter((col) => {
    const vals = todas.map((l) => l[col]).filter((v) => v != null && v !== "");
    return vals.length > 0 && vals.every(isNumericCellValue);
  });
  if (!valueCols.length) return null;
  const labelCol = g.x ?? dados.colunas.find((c) => c.toLowerCase() !== "id" && !valueCols.includes(c));
  if (!labelCol) return null;
  const somas = new Map<string, Record<string, string | number>>();
  for (const linha of todas) {
    const raw = String(linha[labelCol] ?? "");
    const label = formatDateCell(raw) ?? raw;
    const row = somas.get(label) ?? { label };
    for (const col of valueCols) row[col] = Number(row[col] ?? 0) + (numeroDaCelula(linha[col]) ?? 0);
    somas.set(label, row);
  }
  let rows = [...somas.values()];
  const temporal = todas.every((l) => isRotuloTemporal(String(l[labelCol] ?? "")));
  if (rows.length > CHART_MAX_ROTULOS_EIXO_X) {
    rows = temporal
      ? rows.slice(0, CHART_MAX_ROTULOS_EIXO_X)
      : rows.sort((a, b) => Number(b[valueCols[0]!]) - Number(a[valueCols[0]!])).slice(0, CHART_MAX_ROTULOS_EIXO_X);
  }
  return { valueCols, rows, temporal, direita: valueCols.filter((c) => g.y2?.includes(c)) };
}

function buildDadosGrafico(dados: PerguntaResultadoEstruturado, pergunta: string): DadosGrafico | null {
  // Categoria com papel no gráfico (X/Y) em algum campo: segue esses papéis
  if (dados.grafico && (dados.grafico.y.length || dados.grafico.y2?.length)) return graficoPelosPapeis(dados);
  if (!dados.linhas.length || dados.colunas.length < 2) return null;
  const numericCols = dados.colunas.filter((col) => {
    if (col.toLowerCase() === "id") return false;
    // % não vai para o gráfico: barras de % ao lado de valores em R$ ficam invisíveis
    if (/%\s*$/.test(col)) return false;
    const vals = dados.linhas.map((l) => l[col]).filter((v) => v != null);
    return vals.length > 0 && vals.every(isNumericCellValue);
  });
  if (numericCols.length === 0) return null;

  let labelCol = dados.colunas.find((col) => !numericCols.includes(col));
  let valueCols = numericCols;
  if (!labelCol) {
    labelCol = dados.colunas[0];
    valueCols = numericCols.filter((col) => col !== labelCol);
  }
  valueCols = escolherSeries(valueCols.filter((col) => !isColunaIdentificador(col)), pergunta);
  if (valueCols.length === 0) return null;

  // Mais de 20 rótulos distintos no eixo X fica ilegível — mostra só a tabela
  const rotulos = new Set(dados.linhas.map((l) => String(l[labelCol!] ?? "")));
  if (rotulos.size > CHART_MAX_ROTULOS_EIXO_X) return null;

  const rows = dados.linhas.slice(0, CHART_MAX_BARRAS).map((linha) => {
    const rawLabel = String(linha[labelCol] ?? "");
    const row: Record<string, string | number> = { label: formatDateCell(rawLabel) ?? rawLabel };
    for (const col of valueCols) {
      const v = linha[col];
      row[col] = numeroDaCelula(v) ?? 0;
    }
    return row;
  });
  const temporal = dados.linhas.every((l) => isRotuloTemporal(String(l[labelCol!] ?? "")));
  return { valueCols, rows, temporal, direita: valueCols.filter(ehColunaPercentual) };
}

function GraficoBarrasEstruturado({ dados }: { dados: DadosGrafico }) {
  const formatoValor = (value: unknown) =>
    Number(value ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compacto = (v: number) => v.toLocaleString("pt-BR", { notation: "compact" });
  const legenda = dados.valueCols.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null;
  const grade = <CartesianGrid strokeDasharray="3 3" stroke="var(--mm-border, #e2e8f0)" />;
  const tooltip = <Tooltip formatter={formatoValor} cursor={{ fill: "var(--mm-primary-faint, #eef8f7)" }} />;
  // Dois eixos de valor: unidade à esquerda (ou embaixo, na barra deitada) e % à direita (ou em cima).
  // Só com séries dos dois tipos; se todas forem %, um eixo só, com %.
  const direita = new Set(dados.direita ?? []);
  const doisEixos = direita.size > 0 && dados.valueCols.some((c) => !direita.has(c));
  const soPercent = direita.size > 0 && !doisEixos;
  const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  const eixoDe = (col: string) => (doisEixos && direita.has(col) ? "dir" : "esq");
  const nomeSerie = (col: string) => `${COLUNA_LABELS[col] ?? col}${doisEixos && direita.has(col) ? " (%)" : ""}`;

  if (dados.temporal) {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={dados.rows} margin={{ top: 8, right: doisEixos ? 0 : 8, left: 0, bottom: 24 }}>
          {grade}
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={50} />
          <YAxis yAxisId="esq" tick={{ fontSize: 11 }} width={60} tickFormatter={soPercent ? pct : compacto} />
          {doisEixos ? <YAxis yAxisId="dir" orientation="right" tick={{ fontSize: 11 }} width={48} tickFormatter={pct} /> : null}
          {tooltip}
          {legenda}
          {dados.valueCols.map((col, idx) => (
            <Bar key={col} yAxisId={eixoDe(col)} dataKey={col} name={nomeSerie(col)} fill={CHART_BAR_COLORS[idx % CHART_BAR_COLORS.length]} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Ranking / nomes longos: barras deitadas, rótulo inteiro à esquerda (até ~24 caracteres)
  const maxRotulo = Math.max(...dados.rows.map((r) => String(r.label).length));
  const larguraRotulo = Math.min(180, Math.max(60, Math.min(maxRotulo, 26) * 7.2 + 12));
  const corta = (v: string) => (v.length > 26 ? v.slice(0, 25) + "…" : v);
  const altura = Math.max(160, dados.rows.length * (dados.valueCols.length > 1 ? 34 : 26) + 50);
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <BarChart data={dados.rows} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }} barCategoryGap="22%">
        {grade}
        <XAxis xAxisId="esq" type="number" tick={{ fontSize: 11 }} tickFormatter={soPercent ? pct : compacto} />
        {doisEixos ? <XAxis xAxisId="dir" type="number" orientation="top" tick={{ fontSize: 11 }} tickFormatter={pct} /> : null}
        <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={larguraRotulo} interval={0} tickFormatter={corta} />
        {tooltip}
        {legenda}
        {dados.valueCols.map((col, idx) => (
          <Bar key={col} xAxisId={eixoDe(col)} dataKey={col} name={nomeSerie(col)} fill={CHART_BAR_COLORS[idx % CHART_BAR_COLORS.length]} radius={[0, 3, 3, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

interface TabelaEstruturadaProps {
  dados: PerguntaResultadoEstruturado;
  /** Texto da pergunta — usado para escolher quais colunas viram barras no gráfico. */
  pergunta?: string;
  onOpenMemo?: (id: number) => void;
  onOpenMemoFile?: (id: number) => void;
  loadingCardId?: number | null;
  loadingFileId?: number | null;
}

/** Coluna de um campo do tipo lista (valor com várias linhas) no resultado, ou null. */
function colunaDeLista(dados: PerguntaResultadoEstruturado): string | null {
  return dados.colunas.find((c) => dados.linhas.some((l) => typeof l[c] === "string" && (l[c] as string).includes("\n"))) ?? null;
}

/** A resposta traz um campo do tipo lista? Aí ela vira uma linha e a lista (o texto longo some). */
function respostaComLista(resposta: PerguntaResponse["resposta"]): boolean {
  const de = resposta.dados_estruturados;
  return (de ? (Array.isArray(de) ? de : [de]) : []).some((d) => d.totalLinhas > 0 && colunaDeLista(d) != null);
}

/** Envolve a tabela estruturada com um gráfico de barras à esquerda quando há colunas numéricas para plotar. */
function EstruturadoComGrafico(props: TabelaEstruturadaProps) {
  const grafico = useMemo(() => buildDadosGrafico(props.dados, props.pergunta ?? ""), [props.dados, props.pergunta]);
  // Campo do tipo lista (valor com várias linhas): mostra primeiro a lista, a tabela fica atrás de um botão
  const colLista = useMemo(() => colunaDeLista(props.dados), [props.dados]);
  const [verTabela, setVerTabela] = useState(false);
  if (!props.dados.totalLinhas) return null;
  if (colLista && !verTabela) return <VisaoLista dados={props.dados} colLista={colLista} pergunta={props.pergunta ?? ""} onVerTabela={() => setVerTabela(true)} />;
  if (!grafico) return <TabelaEstruturada {...props} />;
  return (
    <div className={styles.chartTableRow}>
      <div className={styles.chartWrap}>
        <GraficoBarrasEstruturado dados={grafico} />
      </div>
      <div className={styles.tabelaScrollItem}>
        <TabelaEstruturada {...props} />
      </div>
    </div>
  );
}

/**
 * Memos atualizáveis da resposta (✎ para alterar) e os valores alterados nesta tela, para a tabela
 * mostrar o valor novo sem refazer a pergunta.
 */
interface AlteracaoCtxValor {
  alteraveis: Set<number>;
  locais: Record<number, Record<string, string>>;
  abrir: (memoId: number, propostos?: Record<string, string>) => void;
  /** Reabre o cartão de memo novo de um pedido de criação. */
  abrirCriacao: (c: ComandoCriacao) => void;
  /** Pedidos de criação já salvos nesta tela → id do memo criado. */
  criados: Map<ComandoCriacao, number>;
  /** Muda a situação do memo direto da resposta (ex.: "Concluir lista"), com aviso e Desfazer. */
  mudarSituacao: (memoId: number, situacao: "Pendente" | "Concluído" | "Cancelado") => void;
  /** Valores gravados por uma alteração: as tabelas e listas da tela mostram o valor novo. */
  aplicarLocal: (memoId: number, r: MemoAlteracaoResponse) => void;
  /** Grava um campo do memo (ex.: a lista com o estado de um item mudado), com aviso e Desfazer. */
  alterarCampo: (memoId: number, campo: string, valor: string, aviso: string) => Promise<void>;
  /** Grupo da tela (para gravar a ordem das colunas arrastadas). */
  groupId: number | null;
  /** "⧉ Repetir lista": pede ao Perguntar uma lista nova a partir desta (cartão de registro novo). */
  repetirLista: (memoId: number) => void;
}
const AlteracaoCtx = createContext<AlteracaoCtxValor>({
  alteraveis: new Set(),
  locais: {},
  abrir: () => {},
  abrirCriacao: () => {},
  criados: new Map(),
  mudarSituacao: () => {},
  aplicarLocal: () => {},
  alterarCampo: async () => {},
  repetirLista: () => {},
  groupId: null,
});

/** Uma mudança mostrada no formato do usuário: lista com o que entra destacado e o que sai riscado. */
function MudancaVisual({ m }: { m: { campo: string; antes: string; depois: string } }) {
  const ehLista = m.antes.includes("\n") || m.depois.includes("\n");
  const igual = (a: ItemLista, b: ItemLista) => toParamName(a.texto) === toParamName(b.texto);
  if (ehLista) {
    const antes = lerItensLista(m.antes);
    const depois = lerItensLista(m.depois);
    const saiu = antes.filter((x) => !depois.some((y) => igual(x, y)));
    return (
      <ul className={styles.listaItensMarcados}>
        {depois.map((it, k) => {
          const anterior = antes.find((y) => igual(y, it));
          // Novo ou com estado mudado: destacado; concluído/cancelado: riscado
          const mudou = !anterior || anterior.estado !== it.estado;
          const classe = it.estado === "concluido" ? styles.itemConcluido : it.estado === "cancelado" ? styles.itemCancelado : undefined;
          return (
            <li key={`d${k}`} className={styles.itemLinha}>
              <span className={`${classe ?? ""} ${mudou ? styles.comandoEntra : ""}`}>{it.texto}</span>
              <span className={mudou ? styles.comandoEntra : styles.listaSub}>
                {mudou ? (anterior ? `→ ${it.estado === "pendente" ? "pendente" : it.estado === "concluido" ? "✓ concluído" : "✗ cancelado"}` : "novo") : ""}
              </span>
            </li>
          );
        })}
        {saiu.map((it, k) => (
          <li key={`s${k}`} className={styles.itemLinha}>
            <span className={styles.comandoSai}>{it.texto}</span>
            <span className={styles.listaSub}>sai</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className={styles.comandoCampo}>
      {m.campo}: {m.antes ? <span className={styles.comandoSai}>{m.antes}</span> : null} <span className={styles.comandoEntra}>{m.depois || "(vazio)"}</span>
    </p>
  );
}

/**
 * Comando de alteração na resposta: a mudança no formato do usuário (lista com o que entra e sai,
 * campo com o valor antigo riscado) e os botões ali mesmo: Confirmar grava, Ajustar abre o cartão de
 * edição, Cancelar descarta. Depois de gravar, o mesmo cartão mostra "✓ Alterado" e o Desfazer.
 */
function ComandoCartao({ comando }: { comando: ComandoAlteracao | undefined }) {
  const { abrir, aplicarLocal } = useContext(AlteracaoCtx);
  const [estado, setEstado] = useState<Record<number, { situacao: "feito" | "desfeito" | "cancelado"; lote: string | null }>>({});
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  if (!comando) return null;
  if (comando.status === "nao_encontrado" || !comando.candidatos?.length) {
    return <p className={styles.cardRespostaText}>{comando.mensagem}</p>;
  }
  const varios = comando.candidatos.length > 1;

  async function confirmar(memoId: number, propostos: Record<string, string>) {
    // Data estranha (já passou há mais de 30 dias ou fica a mais de 2 anos): confirma antes de gravar,
    // como o cartão de edição faz (ex.: "adiar para dia 3" entendido no ano errado)
    const estranhas = Object.entries(propostos)
      .filter(([, v]) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()))
      .map(([campo, v]) => {
        const hoje = new Date();
        hoje.setHours(12, 0, 0, 0);
        const dias = Math.round((new Date(`${v.trim()}T12:00:00`).getTime() - hoje.getTime()) / 86_400_000);
        const [a, m, d] = v.trim().split("-");
        return dias < -30 || dias > 730 ? `${campo}: ${d}/${m}/${a}` : null;
      })
      .filter((x): x is string => x != null);
    if (estranhas.length && !window.confirm(`Confira a data antes de gravar:\n${estranhas.join("\n")}\n\nGravar mesmo assim?`)) return;
    setOcupado(memoId);
    setErro(null);
    try {
      const r = await apiPostJson<MemoAlteracaoResponse>(`/api/memos/${memoId}/alterar`, { campos: propostos });
      aplicarLocal(memoId, r);
      setEstado((s) => ({ ...s, [memoId]: { situacao: "feito", lote: r.lote } }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  async function desfazer(memoId: number, lote: string | null) {
    if (!lote) return;
    setOcupado(memoId);
    setErro(null);
    try {
      const r = await apiPostJson<MemoAlteracaoResponse>(`/api/memos/alteracoes/${lote}/desfazer`, {});
      aplicarLocal(memoId, r);
      setEstado((s) => ({ ...s, [memoId]: { situacao: "desfeito", lote: null } }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className={styles.listaCards}>
      {varios ? <p className={styles.cardRespostaText}>{comando.mensagem}</p> : null}
      {comando.candidatos.map((c) => {
        const st = estado[c.memoId];
        const pendente = !st || st.situacao === "desfeito";
        return (
          <div key={c.memoId} className={`${styles.listaCard}${st?.situacao === "cancelado" ? ` ${styles.listaCardEncerrada}` : ""}`}>
            <div className={styles.listaTopo}>
              <div>
                <span className={styles.listaTitulo}>{c.categoria}</span>
                <span className={styles.listaSub}>#{c.memoId}</span>
                {st?.situacao === "feito" ? <span className={styles.comandoFeito}>✓ Alterado</span> : null}
                {st?.situacao === "desfeito" ? <span className={styles.listaSub}>· desfeito</span> : null}
                {st?.situacao === "cancelado" ? <span className={styles.listaSub}>· não alterado</span> : null}
              </div>
              <div className={styles.listaAcoes}>
                {pendente ? (
                  <>
                    <button type="button" className={styles.refazerBtn} disabled={ocupado === c.memoId} onClick={() => void confirmar(c.memoId, c.propostos)}>
                      {ocupado === c.memoId ? "Gravando…" : "✓ Confirmar"}
                    </button>
                    <button type="button" className={styles.refazerBtn} disabled={ocupado === c.memoId} onClick={() => abrir(c.memoId, c.propostos)}>
                      ✎ Ajustar
                    </button>
                    <button
                      type="button"
                      className={styles.refazerBtn}
                      disabled={ocupado === c.memoId}
                      onClick={() => setEstado((s) => ({ ...s, [c.memoId]: { situacao: "cancelado", lote: null } }))}
                    >
                      Cancelar
                    </button>
                  </>
                ) : st?.situacao === "feito" ? (
                  <button type="button" className={styles.refazerBtn} disabled={ocupado === c.memoId} onClick={() => void desfazer(c.memoId, st.lote)}>
                    ↶ Desfazer
                  </button>
                ) : null}
              </div>
            </div>
            {varios ? <p className={styles.listaSub}>{c.resumo}</p> : null}
            {c.mudancas.map((m) => (
              <MudancaVisual key={m.campo} m={m} />
            ))}
          </div>
        );
      })}
      {erro ? <p className="mm-error">{erro}</p> : null}
    </div>
  );
}

/** Listas mostradas de início numa resposta; o resto fica em "ver mais". */
const MAX_LISTAS_INICIAIS = 3;
/** Até quantas listas a mais o "ver mais" mostra sem perguntar. */
const MAX_LISTAS_SEM_PERGUNTAR = 10;

const ROTULO_ESTADO: Record<EstadoItemLista, string> = { pendente: "Pendente", concluido: "Concluído", cancelado: "Cancelado" };
const SIMBOLO_ESTADO: Record<EstadoItemLista, string> = { pendente: "☐", concluido: "☑", cancelado: "☒" };

/**
 * Itens da lista com um marcador à direita de cada um. Tocar no marcador oferece os outros dois
 * estados (pendente → concluído ou cancelado; concluído → pendente ou cancelado...). Cada escolha
 * grava o campo da lista pela alteração de sempre (histórico e Desfazer). Os pendentes aparecem
 * primeiro; os concluídos e cancelados ficam atrás de "ver N concluídos/cancelados".
 */
function ItensMarcados({
  memoId,
  colLista,
  itens,
  podeAlterar,
  mostrarFeitos = false,
  destacar = [],
  mudados = [],
  onMudou,
  encerrada = false,
}: {
  memoId: number | null;
  colLista: string;
  itens: ItemLista[];
  podeAlterar: boolean;
  /** Já começa mostrando concluídos e cancelados (lista encerrada, pedido de itens concluídos). */
  mostrarFeitos?: boolean;
  /** Termos da pergunta: o item que contém um deles aparece destacado ("sorvete está na lista?"). */
  destacar?: string[];
  /** Itens que mudaram de estado nesta tela: continuam visíveis, com o novo símbolo, até o ↻ do cartão. */
  mudados?: string[];
  onMudou?: (texto: string) => void;
  /** Lista já concluída/cancelada: não oferece concluir de novo. */
  encerrada?: boolean;
}) {
  const { alterarCampo, mudarSituacao } = useContext(AlteracaoCtx);
  const [menu, setMenu] = useState<number | null>(null);
  const [verFeitos, setVerFeitos] = useState(mostrarFeitos);
  const [gravando, setGravando] = useState(false);
  const feitos = itens.filter((it) => it.estado !== "pendente" && !mudados.includes(it.texto)).length;

  async function escolher(idx: number, estado: EstadoItemLista) {
    if (memoId == null) return;
    setMenu(null);
    setGravando(true);
    const novos = itens.map((it, k) => (k === idx ? { ...it, estado } : it));
    onMudou?.(itens[idx]!.texto);
    await alterarCampo(memoId, colLista, escreverItensLista(novos), `${itens[idx]!.texto}: ${ROTULO_ESTADO[estado].toLowerCase()}.`);
    setGravando(false);
    // Tudo marcado: oferece concluir a lista, para ninguém precisar lembrar de encerrar
    if (!encerrada && estado !== "pendente" && novos.every((it) => it.estado !== "pendente")) {
      if (window.confirm("Todos os itens estão marcados. Concluir a lista?")) mudarSituacao(memoId, "Concluído");
    }
  }

  return (
    <>
      <ul className={styles.listaItensMarcados}>
        {itens.map((it, k) => {
          if (it.estado !== "pendente" && !verFeitos && !mudados.includes(it.texto)) return null;
          const outros = (["pendente", "concluido", "cancelado"] as EstadoItemLista[]).filter((e) => e !== it.estado);
          return (
            <li key={k} className={styles.itemLinha}>
              <span
                className={`${it.estado === "concluido" ? styles.itemConcluido : it.estado === "cancelado" ? styles.itemCancelado : ""} ${
                  destacar.some((d) => it.texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(d.replace(/s$/, ""))) ? styles.itemDestacado : ""
                }`}
              >
                {it.texto}
              </span>
              {podeAlterar ? (
                menu === k ? (
                  <span className={styles.marcadorMenu}>
                    {outros.map((e) => (
                      <button key={e} type="button" className={styles.refazerBtn} disabled={gravando} onClick={() => void escolher(k, e)}>
                        {SIMBOLO_ESTADO[e]} {ROTULO_ESTADO[e]}
                      </button>
                    ))}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.marcador}
                    disabled={gravando}
                    onClick={() => setMenu(k)}
                    title={`${ROTULO_ESTADO[it.estado]} — toque para mudar`}
                    aria-label={`${it.texto}: ${ROTULO_ESTADO[it.estado]}. Mudar estado`}
                  >
                    {SIMBOLO_ESTADO[it.estado]}
                  </button>
                )
              ) : (
                <span className={styles.listaSub}>{SIMBOLO_ESTADO[it.estado]}</span>
              )}
            </li>
          );
        })}
      </ul>
      {feitos ? (
        <button type="button" className={styles.listaVerTabela} onClick={() => setVerFeitos((v) => !v)}>
          {verFeitos ? "esconder concluídos e cancelados" : `ver ${feitos} concluído(s) ou cancelado(s)`}
        </button>
      ) : null}
    </>
  );
}

/** Colunas técnicas que não entram no título do cartão da lista. */
const COLUNAS_FORA_DO_TITULO = new Set(["id", "mediatext", "mediatype", "mediafileurl", "attachmentdisplayname", "keywords", "createdat", "userid", "groupid", "category"]);

/**
 * Visão de lista: um cartão por registro, com o título (os outros campos), os itens um por linha e as
 * ações (✎ alterar, ✓ concluir). A tabela continua disponível em "ver como tabela".
 */
/** Em resposta com lista, o texto da IA aparece só se couber nisto (uma frase, ex.: "Sim, sorvete está na lista"). */
const MAX_TEXTO_COM_LISTA = 160;

/** Palavras que não identificam um item ("arroz está na lista de compras?" → só "arroz"). */
const PALAVRAS_GENERICAS = new Set(
  "a o as os um uma de da do das dos na no nas nos em e ou que se ja tem ter esta estao sao e eh lista listas compra compras item itens mostrar mostra minha meu quais qual quantos quantas ainda tambem todos todas concluidos concluidas cancelados canceladas comprados mercado feira farmacia padaria"
    .split(" ")
);

/** Termos da pergunta que podem ser um item, para destacar a linha correspondente. */
function termosDaPergunta(pergunta: string): string[] {
  const n = pergunta.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return n.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !PALAVRAS_GENERICAS.has(w));
}

/** A pergunta pede também os itens concluídos ou cancelados ("mostrar também os comprados")? */
function perguntaPedeFeitos(pergunta: string): boolean {
  const n = pergunta.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /conclu|cancel|comprad|riscad|feit[oa]s|todos os itens|tambem/.test(n);
}

function VisaoLista({ dados, colLista, pergunta, onVerTabela }: { dados: PerguntaResultadoEstruturado; colLista: string; pergunta: string; onVerTabela: () => void }) {
  const { alteraveis, locais, abrir, mudarSituacao, repetirLista } = useContext(AlteracaoCtx);
  const colTitulo = dados.colunas.filter(
    (c) => c !== colLista && !COLUNAS_FORA_DO_TITULO.has(c.toLowerCase()) && !/situa/i.test(toParamName(c))
  );
  // Uma linha só no lugar do texto da resposta: quantas listas e quantos itens pendentes
  const pendentes = dados.linhas.reduce((n, linha) => {
    const id = linha["id"] != null ? Number(linha["id"]) : null;
    const l = valorLocal(id != null ? locais[id] : undefined, colLista);
    const texto = String(l !== undefined ? l : linha[colLista] ?? "");
    return n + lerItensLista(texto).filter((it) => it.estado === "pendente").length;
  }, 0);
  // Com muitas listas (ex.: anos de listas concluídas), mostra as mais recentes e pede para ver o resto
  const total = Math.max(dados.totalLinhas, dados.linhas.length);
  const [verTodas, setVerTodas] = useState(false);
  // Itens que mudaram de estado, por lista: ficam à vista até o ↻ (que deixa só os que não mudaram)
  const [mudados, setMudados] = useState<Record<number, string[]>>({});
  const visiveis = verTodas ? dados.linhas : dados.linhas.slice(0, MAX_LISTAS_INICIAIS);
  const escondidas = dados.linhas.length - visiveis.length;
  return (
    <div className={styles.listaCards}>
      <p className={styles.listaResumo}>
        {total === 1 ? "1 lista" : `${total} listas`} · {pendentes === 1 ? "1 item pendente" : `${pendentes} itens pendentes`}
        {escondidas > 0 ? ` · mostrando as ${visiveis.length} mais recentes` : ""}
      </p>
      {visiveis.map((linha, i) => {
        const id = linha["id"] != null ? Number(linha["id"]) : null;
        const local = id != null ? locais[id] : undefined;
        const valor = (col: string) => {
          const l = valorLocal(local, col);
          return l !== undefined ? l : linha[col];
        };
        const itens = lerItensLista(String(valor(colLista) ?? ""));
        const partes = colTitulo
          .map((c) => [c, valor(c)] as const)
          .filter(([, v]) => v != null && String(v).trim() !== "")
          .map(([c, v]) => textoCelula(c, v));
        const situacaoCol = dados.colunas.find((c) => /situa/i.test(toParamName(c)));
        const encerrada = linhaEncerrada(local) || (situacaoCol ? situacaoEncerrada(String(valor(situacaoCol) ?? "")) : false);
        const podeAlterar = id != null && alteraveis.has(id);
        return (
          <div key={id ?? i} className={`${styles.listaCard}${encerrada ? ` ${styles.listaCardEncerrada}` : ""}`}>
            <div className={styles.listaTopo}>
              <div>
                <span className={styles.listaTitulo}>{partes[0] ?? "Lista"}</span>
                {partes.length > 1 ? <span className={styles.listaSub}>{partes.slice(1).join(" · ")}</span> : null}
                {encerrada ? <span className={styles.listaSub}>· concluída</span> : null}
              </div>
              {podeAlterar ? (
                <div className={styles.listaAcoes}>
                  {mudados[id!]?.length ? (
                    <button
                      type="button"
                      className={styles.refazerBtn}
                      onClick={() => setMudados((m) => ({ ...m, [id!]: [] }))}
                      title="Atualizar: tira da lista os itens que mudaram de situação"
                      aria-label="Atualizar a lista"
                    >
                      ↻
                    </button>
                  ) : null}
                  <button type="button" className={styles.refazerBtn} onClick={() => abrir(id!)} title="Alterar a lista">
                    ✎ Alterar
                  </button>
                  {!encerrada ? (
                    <button
                      type="button"
                      className={styles.refazerBtn}
                      onClick={() => {
                        // A lista inteira sai das respostas: pede confirmação para não confundir com o ✓ de um item
                        if (window.confirm("Concluir a lista inteira? Ela sai das respostas (dá para reabrir depois).")) {
                          mudarSituacao(id!, "Concluído");
                        }
                      }}
                      title="Concluir a lista inteira"
                    >
                      ☑ Concluir lista
                    </button>
                  ) : (
                    <button type="button" className={styles.refazerBtn} onClick={() => mudarSituacao(id!, "Pendente")} title="Voltar a lista para pendente">
                      ↺ Reabrir lista
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.refazerBtn}
                    onClick={() => repetirLista(id!)}
                    title="Criar uma lista nova com estes itens (todos pendentes, sem os cancelados); esta lista fica como está"
                  >
                    ⧉ Repetir lista
                  </button>
                </div>
              ) : null}
            </div>
            {itens.length ? (
              // Lista encerrada: mostra todos os itens (inclusive concluídos e cancelados), com o marcador
              <ItensMarcados key={encerrada ? "e" : "a"} memoId={id} colLista={colLista} itens={itens} podeAlterar={podeAlterar} mostrarFeitos={encerrada || perguntaPedeFeitos(pergunta)}
                destacar={termosDaPergunta(pergunta)}
                mudados={id != null ? mudados[id] ?? [] : []}
                encerrada={encerrada}
                onMudou={(texto) => id != null && setMudados((m) => ({ ...m, [id]: [...(m[id] ?? []).filter((t) => t !== texto), texto] }))}
              />
            ) : (
              <p className={styles.listaSub}>Sem itens.</p>
            )}
          </div>
        );
      })}
      {escondidas > 0 ? (
        <button
          type="button"
          className={styles.refazerBtn}
          onClick={() => {
            if (escondidas <= MAX_LISTAS_SEM_PERGUNTAR || window.confirm(`Mostrar mais ${escondidas} listas? Dica: peça "a última lista" ou "a lista de outubro" para ir direto.`)) {
              setVerTodas(true);
            }
          }}
        >
          ver mais {escondidas} lista(s)
        </button>
      ) : null}
      {total > dados.linhas.length ? (
        <p className={styles.listaSub}>
          Há {total} listas; a resposta trouxe as {dados.linhas.length} mais recentes. Peça uma lista específica (ex.: &quot;a lista de outubro&quot;).
        </p>
      ) : null}
      <button type="button" className={styles.listaVerTabela} onClick={onVerTabela}>
        ver como tabela ▸
      </button>
    </div>
  );
}

/** Valor alterado nesta tela para a coluna (nome do campo ou o alias da Query padrão). */
function valorLocal(locais: Record<string, string> | undefined, col: string): string | undefined {
  if (!locais) return undefined;
  const alvo = toParamName(col);
  for (const [k, v] of Object.entries(locais)) if (toParamName(k) === alvo) return v;
  return undefined;
}

/** Linha de memo cancelado/concluído nesta tela: algum valor local é uma situação encerrada. */
function linhaEncerrada(locais: Record<string, string> | undefined): boolean {
  return !!locais && Object.entries(locais).some(([k, v]) => /situa/i.test(toParamName(k)) && situacaoEncerrada(v));
}

/**
 * Ícone ✎ no fim do texto da resposta quando há memo atualizável: um memo → abre o cartão dele;
 * vários → primeiro a lista para escolher qual alterar.
 */
function BotoesAlterarResposta({ resposta }: { resposta: PerguntaResponse["resposta"] }) {
  const { alteraveis, abrir } = useContext(AlteracaoCtx);
  const [escolhendo, setEscolhendo] = useState(false);
  const memos = useMemo(() => {
    const vistos = new Map<number, string>();
    const add = (id: unknown, texto: unknown) => {
      const n = Number(id);
      if (!Number.isInteger(n) || !alteraveis.has(n) || vistos.has(n)) return;
      vistos.set(n, typeof texto === "string" ? texto.replace(/\s+/g, " ").trim() : "");
    };
    const de = resposta.dados_estruturados;
    for (const bloco of de ? (Array.isArray(de) ? de : [de]) : []) {
      for (const linha of bloco.linhas) add(linha["id"], linha["mediatext"] ?? linha["mediaText"]);
    }
    for (const d of resposta.dados_usados) add(d.memo_id, d.mediatext);
    return [...vistos.entries()];
  }, [resposta, alteraveis]);
  useEffect(() => {
    if (!escolhendo) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setEscolhendo(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [escolhendo]);
  if (!memos.length) return null;
  return (
    // Fica dentro do parágrafo da resposta, flutuando à direita da última linha; a lista vai num portal
    <span className={styles.botoesAlterar}>
      <button
        type="button"
        className={styles.botaoAlterar}
        onClick={() => (memos.length === 1 ? abrir(memos[0]![0]) : setEscolhendo(true))}
        title={memos.length === 1 ? "Alterar, concluir ou cancelar" : `Alterar, concluir ou cancelar — ${memos.length} memos`}
        aria-label="Alterar, concluir ou cancelar"
      >
        ✎
      </button>
      {escolhendo ? createPortal(
        <div className={styles.cellModalOverlay} onClick={() => setEscolhendo(false)}>
          <div className={styles.escolherMemo} role="dialog" aria-label="Escolha o memo para alterar" onClick={(e) => e.stopPropagation()}>
            <div className={styles.escolherMemoTopo}>
              <strong>Qual memo alterar?</strong>
              <button type="button" className={styles.avisoAlteracaoFechar} onClick={() => setEscolhendo(false)} aria-label="Fechar">×</button>
            </div>
            <ul className={styles.escolherMemoLista}>
              {memos.map(([id, texto]) => (
                <li key={id}>
                  <button
                    type="button"
                    className={styles.escolherMemoItem}
                    onClick={() => { setEscolhendo(false); abrir(id); }}
                  >
                    <span className={styles.escolherMemoId}>#{id}</span>
                    <span>{texto || `Memo #${id}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>,
        document.body
      ) : null}
    </span>
  );
}


/** Pedido de criação: botão para (re)abrir o cartão do registro novo. */
function CriacaoBotao({ criacao }: { criacao: ComandoCriacao | undefined }) {
  const { abrirCriacao, criados } = useContext(AlteracaoCtx);
  if (!criacao) return null;
  const salvo = criados.get(criacao);
  if (salvo != null) {
    return (
      <p className={styles.comandoFeito} role="status">
        ✓ Registro salvo{criacao.categoria ? ` em ${criacao.categoria}` : ""} (#{salvo}).
      </p>
    );
  }
  return (
    <button type="button" className={styles.refazerBtn} onClick={() => abrirCriacao(criacao)}>
      Revisar e salvar o registro novo
    </button>
  );
}

function BotaoAlterar({ memoId }: { memoId: number }) {
  const { alteraveis, abrir } = useContext(AlteracaoCtx);
  if (!alteraveis.has(memoId)) return null;
  return (
    <button
      type="button"
      className={styles.memoIdBtn}
      onClick={(e) => { e.stopPropagation(); abrir(memoId); }}
      title="Alterar, concluir ou cancelar"
      aria-label={`Alterar memo #${memoId}`}
    >
      ✎
    </button>
  );
}

/** Até quantas linhas um valor com várias linhas (campo do tipo lista) aparece inteiro na célula. */
const MAX_LINHAS_CELULA = 12;

/**
 * Conteúdo da célula: texto com quebras de linha (campo do tipo lista) mostra um item por linha,
 * sem cortar; o resto segue a regra de antes (corta em 80 caracteres e abre o texto completo).
 */
function ConteudoCelula({ texto, onExpandir }: { texto: string; onExpandir: (t: string) => void }) {
  const linhas = texto.includes("\n") ? texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : null;
  if (linhas && linhas.length > 1) {
    const mostradas = linhas.slice(0, MAX_LINHAS_CELULA);
    return (
      <>
        {mostradas.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
        {linhas.length > MAX_LINHAS_CELULA ? (
          <button type="button" className={styles.lerMaisBtn} onClick={(e) => { e.stopPropagation(); onExpandir(texto); }}>
            mais {linhas.length - MAX_LINHAS_CELULA}…
          </button>
        ) : null}
      </>
    );
  }
  return <>{texto.length > 80 ? texto.slice(0, 80) + "…" : texto}</>;
}

/** Valor para ordenar: número quando der (inclusive "1.234,56"), data ISO como texto, resto sem acento. */
function valorParaOrdenar(v: unknown): { n: number | null; t: string } {
  if (v == null || v === "") return { n: null, t: "" };
  if (typeof v === "number") return { n: v, t: String(v) };
  const t = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return { n: Number(t), t };
  if (/^-?[\d.]+,\d+$/.test(t)) return { n: Number(t.replace(/\./g, "").replace(",", ".")), t };
  return { n: null, t: t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() };
}

function TabelaEstruturada({ dados, onOpenMemo, onOpenMemoFile, loadingCardId, loadingFileId }: {
  dados: PerguntaResultadoEstruturado;
  onOpenMemo?: (id: number) => void;
  onOpenMemoFile?: (id: number) => void;
  loadingCardId?: number | null;
  loadingFileId?: number | null;
}) {
  const [expandedCell, setExpandedCell] = useState<string | null>(null);
  const alteracao = useContext(AlteracaoCtx);
  // O id vai para a última coluna (com o arquivo); o lápis, para a primeira
  const temId = dados.colunas.some((c) => c === "id");
  const inicial = useMemo(() => dados.colunas.filter((c) => c !== "id"), [dados.colunas]);
  const [ordem, setOrdem] = useState<string[]>(inicial);
  useEffect(() => setOrdem(inicial), [inicial]);
  const [arrastando, setArrastando] = useState<string | null>(null);
  // Ordem das linhas: duplo clique no título (crescente, decrescente, original)
  const [sortCol, setSortCol] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  // Depois de arrastar: oferece gravar a ordem na categoria por 5 s
  const [oferta, setOferta] = useState<{ seg: number; estado: "pergunta" | "gravando" | "ok" | "erro"; msg?: string } | null>(null);
  useEffect(() => {
    if (!oferta || oferta.estado !== "pergunta") return;
    if (oferta.seg <= 0) {
      setOferta(null);
      return;
    }
    const t = setTimeout(() => setOferta((o) => (o && o.estado === "pergunta" ? { ...o, seg: o.seg - 1 } : o)), 1000);
    return () => clearTimeout(t);
  }, [oferta]);
  useEffect(() => {
    if (oferta && (oferta.estado === "ok" || oferta.estado === "erro")) {
      const t = setTimeout(() => setOferta(null), 2500);
      return () => clearTimeout(t);
    }
  }, [oferta]);

  // "Ver todas": a resposta traz até 2.000 linhas (as mesmas do PDF); a tela começa com as primeiras
  const [verTodas, setVerTodas] = useState(false);
  const todas = dados.linhasCompletas ?? [];
  const base = verTodas && todas.length > dados.linhas.length ? todas : dados.linhas;
  const linhas = useMemo(() => {
    if (!sortCol) return base;
    const col = sortCol.col;
    return [...base].sort((a, b) => {
      const x = valorParaOrdenar(a[col]);
      const y = valorParaOrdenar(b[col]);
      if (x.t === "" && y.t !== "") return 1; // vazios sempre no fim
      if (y.t === "" && x.t !== "") return -1;
      const r = x.n != null && y.n != null ? x.n - y.n : x.t.localeCompare(y.t, "pt-BR", { numeric: true });
      return r * sortCol.dir;
    });
  }, [base, sortCol]);

  if (!dados.totalLinhas) return null;

  function soltar(alvo: string) {
    if (!arrastando || arrastando === alvo) return;
    const nova = ordem.filter((c) => c !== arrastando);
    nova.splice(nova.indexOf(alvo), 0, arrastando);
    setOrdem(nova);
    setArrastando(null);
    if (dados.categoria && alteracao.groupId != null && nova.join("|") !== inicial.join("|")) setOferta({ seg: 5, estado: "pergunta" });
  }

  async function gravarOrdem() {
    if (!dados.categoria || alteracao.groupId == null) return;
    setOferta({ seg: 0, estado: "gravando" });
    try {
      await apiPostJson("/api/memo-context/ordem-colunas", { groupId: alteracao.groupId, categoria: dados.categoria, colunas: ordem });
      setOferta({ seg: 0, estado: "ok", msg: `Ordem gravada em ${dados.categoria}.` });
    } catch (e) {
      setOferta({ seg: 0, estado: "erro", msg: e instanceof Error ? e.message : "Não foi possível gravar." });
    }
  }

  const duploClique = (col: string) =>
    setSortCol((s) => (!s || s.col !== col ? { col, dir: 1 } : s.dir === 1 ? { col, dir: -1 } : null));
  const seta = (col: string) => (sortCol?.col === col ? (sortCol.dir === 1 ? " ▲" : " ▼") : "");

  return (
    <>
      {expandedCell ? (
        <div className={styles.cellModalOverlay} onClick={() => setExpandedCell(null)}>
          <div className={styles.cellModal} onClick={(e) => e.stopPropagation()}>
            <p className={styles.cellModalText} style={{ whiteSpace: "pre-line" }}>{expandedCell}</p>
          </div>
        </div>
      ) : null}
      {oferta ? (
        <div className={styles.ordemOferta} role="status">
          {oferta.estado === "pergunta" ? (
            <>
              <span>Gravar esta ordem de colunas em {dados.categoria}?</span>
              <button type="button" className={styles.refazerBtn} onClick={() => void gravarOrdem()}>
                Gravar ({oferta.seg})
              </button>
            </>
          ) : (
            <span>{oferta.estado === "gravando" ? "Gravando…" : oferta.msg}</span>
          )}
        </div>
      ) : null}
      <div className={styles.tabelaWrap}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              {temId ? <th className={styles.tabelaTh} aria-label="Alterar" /> : null}
              {ordem.map((col) => (
                <th
                  key={col}
                  className={`${styles.tabelaTh} ${styles.tabelaThArrastavel}${arrastando === col ? ` ${styles.tabelaThArrastando}` : ""}`}
                  draggable
                  onDragStart={(e) => {
                    setArrastando(col);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    soltar(col);
                  }}
                  onDragEnd={() => setArrastando(null)}
                  onDoubleClick={() => duploClique(col)}
                  title="Arraste para mudar a ordem; duplo clique ordena as linhas"
                >
                  {COLUNA_LABELS[col] ?? col}
                  {seta(col)}
                </th>
              ))}
              {temId ? (
                <th className={styles.tabelaTh} onDoubleClick={() => duploClique("id")} title="Duplo clique ordena as linhas">
                  {COLUNA_LABELS["id"] ?? "id"}
                  {seta("id")}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha, i) => {
              const idLinha = linha["id"] != null ? Number(linha["id"]) : null;
              const locais = idLinha != null ? alteracao.locais[idLinha] : undefined;
              const alteravel = idLinha != null && alteracao.alteraveis.has(idLinha);
              const rowMt = String(linha["mediaType"] ?? linha["mediatype"] ?? "");
              const rowUrl = String(linha["mediaFileUrl"] ?? linha["mediafileurl"] ?? "");
              const rowName = String(linha["attachmentDisplayName"] ?? linha["attachmentdisplayname"] ?? "");
              return (
                <tr
                  key={idLinha ?? i}
                  className={`${styles.tabelaTr}${alteravel ? ` ${styles.tabelaTrAlteravel}` : ""}${linhaEncerrada(locais) ? ` ${styles.tabelaTrEncerrada}` : ""}`}
                  onClick={alteravel ? () => alteracao.abrir(idLinha!) : undefined}
                  title={alteravel ? "Toque para alterar, concluir ou cancelar" : undefined}
                >
                  {temId ? <td className={styles.tabelaTd}>{idLinha != null ? <BotaoAlterar memoId={idLinha} /> : null}</td> : null}
                  {ordem.map((col) => {
                    const local = valorLocal(locais, col);
                    const val = local !== undefined ? local : linha[col];
                    const display = textoCelula(col, val);
                    const isLong = display.length > 80 && !display.includes("\n");
                    return (
                      <td
                        key={col}
                        className={`${styles.tabelaTd}${isLong ? ` ${styles.tabelaTdExpandable}` : ""}`}
                        onClick={isLong ? (e) => { e.stopPropagation(); setExpandedCell(display); } : undefined}
                        title={isLong ? "Clique para ver texto completo" : undefined}
                      >
                        <ConteudoCelula texto={display} onExpandir={setExpandedCell} />
                      </td>
                    );
                  })}
                  {temId ? (
                    <td className={styles.tabelaTd}>
                      {idLinha != null ? (
                        <span className={styles.tabelaIdCell}>
                          {onOpenMemoFile ? (
                            <button
                              type="button"
                              className={styles.tableFileBtn}
                              onClick={(e) => { e.stopPropagation(); onOpenMemoFile(idLinha); }}
                              disabled={loadingFileId === idLinha}
                              title={`Abrir arquivo — memo #${idLinha}`}
                            >
                              {loadingFileId === idLinha ? "…" : <MediaTypeIcon mediaType={rowMt} fileUrl={rowUrl} displayName={rowName} />}
                            </button>
                          ) : null}
                          {onOpenMemo ? (
                            <button
                              type="button"
                              className={styles.memoIdBtn}
                              onClick={(e) => { e.stopPropagation(); onOpenMemo(idLinha); }}
                              disabled={loadingCardId === idLinha}
                              title="Ver detalhes do memo"
                            >
                              {loadingCardId === idLinha ? "…" : `#${idLinha}`}
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {dados.totalLinhas > base.length ? (
          <p className={styles.tabelaRodape}>
            Mostrando {base.length} de {dados.totalLinhas} registros.
            {!verTodas && todas.length > dados.linhas.length ? (
              <>
                {" "}
                <button type="button" className={styles.lerMaisBtn} onClick={() => setVerTodas(true)}>
                  Ver {todas.length >= dados.totalLinhas ? "todas" : `as ${todas.length} primeiras`}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </>
  );
}

function TabelaSemantica({ dados_usados, onOpenMemo, onOpenMemoFile, loadingCardId, loadingFileId }: {
  dados_usados: import("@mymemory/shared").PerguntaMemoUsado[];
  onOpenMemo?: (id: number) => void;
  onOpenMemoFile?: (id: number) => void;
  loadingCardId?: number | null;
  loadingFileId?: number | null;
}) {
  const [expandedCell, setExpandedCell] = useState<string | null>(null);
  const alteracao = useContext(AlteracaoCtx);

  if (dados_usados.length === 0) return null;

  // Coleta todas as chaves de dadosEspecificos em ordem alfabética (união de todas as categorias)
  const extraKeys = Array.from(
    new Set(dados_usados.flatMap((d) => d.dadosEspecificos ? Object.keys(d.dadosEspecificos) : []))
  ).sort();

  const LABELS: Record<string, string> = { memo_id: "ID", mediaType: "Tipo", mediatext: "Conteúdo" };

  function renderCell(val: string) {
    const isLong = val.length > 80 && !val.includes("\n");
    return (
      <td
        className={`${styles.tabelaTd}${isLong ? ` ${styles.tabelaTdExpandable}` : ""}`}
        onClick={isLong ? (e) => { e.stopPropagation(); setExpandedCell(val); } : undefined}
        title={isLong ? "Clique para ver texto completo" : undefined}
      >
        <ConteudoCelula texto={val} onExpandir={setExpandedCell} />
      </td>
    );
  }

  return (
    <>
      {expandedCell ? (
        <div className={styles.cellModalOverlay} onClick={() => setExpandedCell(null)}>
          <div className={styles.cellModal} onClick={(e) => e.stopPropagation()}>
            <p className={styles.cellModalText} style={{ whiteSpace: "pre-line" }}>{expandedCell}</p>
          </div>
        </div>
      ) : null}
      <div className={styles.tabelaWrap}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              {["memo_id", "mediaType", "mediatext", ...extraKeys].map((c) => (
                <th key={c} className={styles.tabelaTh}>{LABELS[c] ?? c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dados_usados.map((d, i) => {
              const locais = alteracao.locais[d.memo_id];
              const alteravel = alteracao.alteraveis.has(d.memo_id);
              return (
              <tr
                key={i}
                className={`${styles.tabelaTr}${alteravel ? ` ${styles.tabelaTrAlteravel}` : ""}${linhaEncerrada(locais) ? ` ${styles.tabelaTrEncerrada}` : ""}`}
                onClick={alteravel ? () => alteracao.abrir(d.memo_id) : undefined}
                title={alteravel ? "Toque para alterar, concluir ou cancelar" : undefined}
              >
                <td className={styles.tabelaTd}>
                  <span className={styles.tabelaIdCell}>
                    {onOpenMemoFile ? (
                      <button
                        type="button"
                        className={styles.tableFileBtn}
                        onClick={(e) => { e.stopPropagation(); onOpenMemoFile(d.memo_id); }}
                        disabled={loadingFileId === d.memo_id}
                        title={`Abrir arquivo — memo #${d.memo_id}`}
                      >
                        {loadingFileId === d.memo_id ? "…" : <MediaTypeIcon mediaType={d.mediaType} />}
                      </button>
                    ) : null}
                    {onOpenMemo ? (
                      <button
                        type="button"
                        className={styles.memoIdBtn}
                        onClick={(e) => { e.stopPropagation(); onOpenMemo(d.memo_id); }}
                        disabled={loadingCardId === d.memo_id}
                        title="Ver detalhes do memo"
                      >
                        {loadingCardId === d.memo_id ? "…" : `#${d.memo_id}`}
                      </button>
                    ) : `#${d.memo_id}`}
                    <BotaoAlterar memoId={d.memo_id} />
                  </span>
                </td>
                {renderCell(d.mediaType ?? "—")}
                {renderCell(d.mediatext ?? "—")}
                {extraKeys.map((k) => {
                  const local = valorLocal(locais, k);
                  return renderCell(local !== undefined ? local || "—" : d.dadosEspecificos?.[k] != null ? String(d.dadosEspecificos![k]) : "—");
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function tryPrettifyJson(text: string): string {
  const t = text.trim();
  const i = t.indexOf("{");
  const k = t.lastIndexOf("}");
  if (i >= 0 && k > i) {
    try {
      const parsed = JSON.parse(t.slice(i, k + 1)) as unknown;
      const pretty = JSON.stringify(parsed, null, 2);
      return t.slice(0, i) + pretty + t.slice(k + 1);
    } catch { /* não é JSON válido */ }
  }
  return text;
}

function LlmTraceModal({
  trace,
  pergunta,
  onClose,
}: {
  trace: PerguntaLlmTraceEntry[];
  pergunta: string;
  onClose: () => void;
}) {
  return (
    <div className={styles.traceOverlay} onClick={onClose}>
      <div className={styles.traceModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.traceHeader}>
          <span className={styles.traceTitle}>LLM Trace</span>
          <span className={styles.traceSubtitle} title={pergunta}>"{pergunta}"</span>
          <button type="button" className={styles.traceCloseBtn} onClick={onClose} title="Fechar">×</button>
        </div>
        <div className={styles.traceBody}>
          {trace.length === 0 ? (
            <p className={styles.traceEmpty}>Nenhuma chamada LLM registrada para esta resposta.</p>
          ) : trace.map((entry, idx) => (
            <div key={idx} className={styles.traceEntry}>
              <div className={styles.traceEntryHeader}>
                <span className={styles.traceEntryIndex}>#{idx + 1}</span>
                <span className={styles.traceEntrySource}>{entry.source}</span>
                <span className={styles.traceEntryModel}>{entry.model}</span>
                <span className={`${styles.traceEntryProvider} ${entry.provider === "sql" ? styles.traceEntryProviderSql : ""}`}>
                  {entry.provider}
                </span>
              </div>
              <div className={styles.traceMessages}>
                {entry.messages.map((msg, mi) => (
                  <div
                    key={mi}
                    className={`${styles.traceMessage} ${
                      msg.role === "system" ? styles.traceRoleSystem
                      : msg.role === "user" ? styles.traceRoleUser
                      : styles.traceRoleAssistant
                    }`}
                  >
                    <div className={styles.traceMessageRole}>{msg.role}</div>
                    <pre className={styles.traceMessageContent}>{tryPrettifyJson(msg.content)}</pre>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const CHUNK_MS = 4000; // duração de cada chunk enviado ao Whisper (ms)
const IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

type SearchAuthorOption = { id: number; name: string | null; email: string | null };

interface SpeechRecInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: {
    resultIndex: number;
    results: { length: number; [i: number]: { isFinal: boolean; [k: number]: { transcript: string } } };
  }) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: (() => void) | null;
}

function stripPunctuation(t: string): string {
  return t.replace(/[.!?,;:]+$/g, "").trim();
}

export default function PerguntaPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [ready, setReady] = useState(false);
  const [pergunta, setPergunta] = useState("");
  const [historico, setHistorico] = useState<PerguntaCardHistorico[]>([]);
  const [respostas, setRespostas] = useState<(PerguntaResponse & { perguntaTexto: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Etapas que rodaram até o erro (trace parcial), para "ver etapas" mesmo quando a pergunta falha */
  const [errorTrace, setErrorTrace] = useState<{ trace: PerguntaLlmTraceEntry[]; pergunta: string } | null>(null);
  const [refazerIdx, setRefazerIdx] = useState<number | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [cardMemo, setCardMemo] = useState<MemoRecentCard | null>(null);
  const [memoDeleteConfirm, setMemoDeleteConfirm] = useState(false);
  const [memoDeleteBusy, setMemoDeleteBusy] = useState(false);
  const [memoDeleteError, setMemoDeleteError] = useState<string | null>(null);
  const [filePreviewMemo, setFilePreviewMemo] = useState<MemoRecentCard | null>(null);
  const [loadingCardId, setLoadingCardId] = useState<number | null>(null);
  // Categoria atualizável: memos da resposta com ✎, cartão aberto, valores alterados e "Desfazer"
  const [alteraveis, setAlteraveis] = useState<Set<number>>(() => new Set());
  const [alteracoesLocais, setAlteracoesLocais] = useState<Record<number, Record<string, string>>>({});
  const [alterandoMemoId, setAlterandoMemoId] = useState<number | null>(null);
  /** Valores propostos por um comando do Perguntar para o cartão aberto. */
  const [propostosAbertos, setPropostosAbertos] = useState<Record<string, string> | undefined>(undefined);
  const [avisoAlteracao, setAvisoAlteracao] = useState<{ texto: string; lote: string | null; memoId: number; criadoId?: number } | null>(null);
  /** Pedido de criação aberto no cartão de memo novo. */
  const [criando, setCriando] = useState<ComandoCriacao | null>(null);
  // Pedidos de criação já salvos: a resposta troca "Revisar e salvar" por "✓ Registro salvo"
  const [criados, setCriados] = useState<Map<ComandoCriacao, number>>(new Map());
  /** Memo criado pelo Perguntar: sugestão de ligação a um compromisso. */
  const [memoParaLigar, setMemoParaLigar] = useState<number | null>(null);
  const fimLigacao = useCallback(() => setMemoParaLigar(null), []);
  const idsVerificadosRef = useRef<Set<number>>(new Set());
  const [loadingFileId, setLoadingFileId] = useState<number | null>(null);
  const [memoEditMode, setMemoEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [editDados, setEditDados] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [traceModal, setTraceModal] = useState<{ trace: PerguntaLlmTraceEntry[]; pergunta: string } | null>(null);
  const [modeloSelectOpen, setModeloSelectOpen] = useState(false);
  const [modelos, setModelos] = useState<PerguntaModelo[]>([]);
  // Pergunta salva com plano em uso: frase com chips em vez da caixa de texto
  const [modeloAtivo, setModeloAtivo] = useState<{ modelo: PerguntaModelo; chips: PerguntaChip[] } | null>(null);
  const [chipValores, setChipValores] = useState<Record<string, PerguntaChipValor>>({});
  const [modelosLoading, setModelosLoading] = useState(false);
  const [modeloSavedIdx, setModeloSavedIdx] = useState<number | null>(null);
  const [modeloSavingIdx, setModeloSavingIdx] = useState<number | null>(null);
  const [modeloSaveErr, setModeloSaveErr] = useState<string | null>(null);
  // Card cuja resposta tem parâmetros: pergunta se salva só o texto (padrão) ou com os parâmetros
  const [salvarEscolhaIdx, setSalvarEscolhaIdx] = useState<number | null>(null);
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);
  const [editingModalModelo, setEditingModalModelo] = useState<{ id: number; pergunta: string; anotacoes: string; estrelas: number | null; category: string | null } | null>(null);
  const [savingModalModelo, setSavingModalModelo] = useState(false);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [showCatFilter, setShowCatFilter] = useState(false);
  const [modalSearchText, setModalSearchText] = useState("");
  const [modalShowSearch, setModalShowSearch] = useState(false);
  // Última pergunta salva escolhida (e filtros usados) — reaberta na mesma posição durante a sessão do navegador
  const [ultimoModeloId, setUltimoModeloId] = useState<number | null>(null);
  const modeloListRef = useRef<HTMLUListElement>(null);
  const modalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [contextCategories, setContextCategories] = useState<MemoContextCategory[]>([]);
  const [helpHintOpenIdx, setHelpHintOpenIdx] = useState<number | null>(null);
  const [avisoModal, setAvisoModal] = useState<{
    cardIdx: number;
    descricao: string;
    freqTipo: "horas" | "diaria" | "semanal" | "mensal";
    freqHoras: number;
    email: string;
  } | null>(null);
  const [avisoSaving, setAvisoSaving] = useState(false);
  const [avisoSaveErr, setAvisoSaveErr] = useState<string | null>(null);
  const [avisoSavedPergunta, setAvisoSavedPergunta] = useState<string | null>(null);
  const [ttsBusyPergunta, setTtsBusyPergunta] = useState<string | null>(null);
  const ttsBusyRef = useRef<string | null>(null);
  const ttsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRespostasLenRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Filtros
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAuthorId, setFilterAuthorId] = useState<number | null>(null);
  const [filterModal, setFilterModal] = useState<null | "quando" | "quem">(null);
  const [showFilters, setShowFilters] = useState(false);
  const [draftDateFrom, setDraftDateFrom] = useState("");
  const [draftDateTo, setDraftDateTo] = useState("");
  const [draftAuthorId, setDraftAuthorId] = useState<number | null>(null);
  const [authorOptions, setAuthorOptions] = useState<SearchAuthorOption[]>([]);

  // Voz
  const [micState, setMicState] = useState<"idle" | "listening">("idle");
  const recognitionRef     = useRef<{ stop: () => void } | null>(null); // desktop
  const mediaRecorderRef   = useRef<MediaRecorder | null>(null);         // mobile
  const chunkTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningRef       = useRef(false);
  const capturedRef        = useRef("");
  const transcribeQueueRef = useRef<Promise<void>>(Promise.resolve());   // serializa chunks
  const textareaRef        = useRef<HTMLTextAreaElement | null>(null);
  /** Início do toque no botão Enviar (celular): envia no fim do toque se o dedo não arrastou. */
  const toqueEnviarRef     = useRef<{ x: number; y: number } | null>(null);

  const workspaceGroupId = me?.lastWorkspaceGroupId ?? null;
  const isGroup = workspaceGroupId != null;
  const categoryOptionsModelo = useCategoryOptions(workspaceGroupId);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [pergunta]);

  // Celular (aba embutida): caixa de pergunta presa embaixo, acima do teclado. O teclado virtual não
  // encolhe a página no iOS/Android, então a altura dele vem do visualViewport (--mm-teclado).
  useEffect(() => {
    if (!embedded || typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const raiz = document.documentElement;
    const atualizar = () => {
      const teclado = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      raiz.style.setProperty("--mm-teclado", `${Math.round(teclado)}px`);
    };
    vv.addEventListener("resize", atualizar);
    vv.addEventListener("scroll", atualizar);
    atualizar();
    return () => {
      vv.removeEventListener("resize", atualizar);
      vv.removeEventListener("scroll", atualizar);
      raiz.style.removeProperty("--mm-teclado");
      document.body.classList.remove("mm-typing");
    };
  }, [embedded]);

  // Celular: resposta nova aparece logo acima da caixa de pergunta; rola até o início dela
  const respostaMaisNova = respostas[0];
  useEffect(() => {
    if (!embedded || !respostaMaisNova || !window.matchMedia("(max-width: 760px)").matches) return;
    const el = document.querySelector("[data-resposta-nova]");
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [embedded, respostaMaisNova]);
  useEffect(() => {
    if (!embedded || !pendingQuestion || !window.matchMedia("(max-width: 760px)").matches) return;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  }, [embedded, pendingQuestion]);

  // Para a narração ao sair da página
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    apiGetOptional<MeResponse>("/api/me").then((r) => {
      if (r.ok) {
        setMe(r.data);
        setReady(true);
        return;
      }
      if (r.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      setReady(true);
    }).catch(() => setReady(true));
  }, [navigate]);

  // Perguntas salvas fixadas como atalho (por usuário, no espaço atual)
  const [fixadas, setFixadas] = useState<PerguntaModelo[]>([]);
  useEffect(() => {
    if (!me) return;
    const gid = workspaceGroupId != null ? `?workspaceGroupId=${workspaceGroupId}` : "";
    apiGet<{ modelos: PerguntaModelo[] }>(`/api/pergunta-modelos${gid}`)
      .then((d) => setFixadas(d.modelos.filter((m) => m.fixada)))
      .catch(() => setFixadas([]));
  }, [me, workspaceGroupId]);

  useEffect(() => {
    if (!isGroup) return;
    apiGetOptional<{ authors: SearchAuthorOption[] }>("/api/memos/search-authors?groupId=" + workspaceGroupId)
      .then((r) => { if (r.ok) setAuthorOptions(r.data.authors); })
      .catch(() => {});
  }, [isGroup, workspaceGroupId]);

  useEffect(() => {
    if (!me) return;
    const gid = me.lastWorkspaceGroupId;
    // Espelha o fallback do /api/perguntas: tenta o grupo e, se vier vazio, usa global.
    const fetchStructure = async () => {
      if (gid) {
        const r = await apiGetOptional<MemoContextStructureResponse>(`/api/memo-context/structure?groupId=${gid}`);
        if (r.ok && r.data.categories.length > 0) {
          setContextCategories(r.data.categories);
          return;
        }
      }
      const r = await apiGetOptional<MemoContextStructureResponse>("/api/memo-context/structure");
      if (r.ok) setContextCategories(r.data.categories);
    };
    fetchStructure().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, me?.lastWorkspaceGroupId]);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    // desktop
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    try { rec?.stop?.(); } catch {}
    // mobile
    if (chunkTimerRef.current) { clearInterval(chunkTimerRef.current); chunkTimerRef.current = null; }
    const mr = mediaRecorderRef.current;
    if (mr?.state === "recording") mr.stop(); // onstop faz transcrição final + cleanup da stream
    setMicState("idle");
  }, []);

  const startListening = useCallback(async () => {
    setError(null);
    stopListening();
    capturedRef.current = "";
    transcribeQueueRef.current = Promise.resolve();
    setPergunta("");
    listeningRef.current = true;

    // ── MOBILE: MediaRecorder contínuo + Whisper periódico ───────────────────
    if (IS_MOBILE) {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        listeningRef.current = false;
        setError("Microfone bloqueado. Permita o acesso nas configurações do navegador.");
        return;
      }

      const mimeType =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" :
        MediaRecorder.isTypeSupported("audio/webm")             ? "audio/webm" :
        "audio/mp4";

      const allChunks: Blob[] = [];

      // Envia o áudio acumulado completo ao Whisper; substitui o campo com a
      // melhor transcrição disponível até o momento.
      const sendAccumulated = () => {
        if (allChunks.length === 0) return;
        const blob = new Blob(allChunks, { type: mimeType });
        if (blob.size < 1000) return;
        transcribeQueueRef.current = transcribeQueueRef.current.then(async () => {
          try {
            const form = new FormData();
            form.append("audio", blob, "recording.webm");
            const res = await fetch("/api/perguntas/transcribe", {
              method: "POST", body: form, credentials: "include",
            });
            if (!res.ok) return;
            const { text } = await (res.json() as Promise<{ text: string }>);
            if (text?.trim()) {
              capturedRef.current = text.trim();
              setPergunta(text.trim());
            }
          } catch { /* rede — tenta no próximo intervalo */ }
        });
      };

      let recorder: MediaRecorder;
      try { recorder = new MediaRecorder(stream, { mimeType }); } catch {
        stream.getTracks().forEach(t => t.stop());
        listeningRef.current = false;
        setError("Não foi possível iniciar a gravação.");
        return;
      }

      recorder.ondataavailable = (e) => { if (e.data.size > 0) allChunks.push(e.data); };

      recorder.onstop = () => {
        sendAccumulated(); // transcrição final com todo o áudio
        transcribeQueueRef.current.finally(() => {
          stream.getTracks().forEach(t => t.stop());
          mediaRecorderRef.current = null;
        });
      };

      // 500 ms por chunk interno → acumulação suave sem parar o mic
      recorder.start(500);
      mediaRecorderRef.current = recorder;

      // Envia transcrição a cada CHUNK_MS enquanto grava
      chunkTimerRef.current = setInterval(sendAccumulated, CHUNK_MS) as unknown as ReturnType<typeof setTimeout>;

      setMicState("listening");
      return;
    }

    // ── DESKTOP: Web Speech API ───────────────────────────────────────────────
    const SR =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecInstance }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecInstance }).webkitSpeechRecognition;
    if (!SR) {
      listeningRef.current = false;
      setError("Voz não disponível neste navegador. Use Chrome ou Edge.");
      return;
    }

    let rec: SpeechRecInstance;
    try { rec = new SR(); } catch {
      listeningRef.current = false;
      setError("Não foi possível iniciar o microfone.");
      return;
    }
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i]![0]!.transcript;
      setPergunta(stripPunctuation(text.trim()));
    };
    rec.onerror = (ev: Event) => {
      const code = (ev as Event & { error?: string }).error ?? "";
      const map: Record<string, string> = {
        "not-allowed": "Microfone bloqueado. Permita o acesso nas configurações do navegador.",
        "no-speech": "Não foi detectada fala. Tente de novo.",
        network: "Erro de rede no reconhecimento de voz.",
      };
      const msg = map[code];
      if (msg) setError(msg);
      else if (code && code !== "aborted") setError(`Voz: ${code}`);
      stopListening();
    };
    rec.onend = () => { recognitionRef.current = null; setMicState("idle"); };
    recognitionRef.current = rec;
    try {
      rec.start();
      setMicState("listening");
    } catch {
      listeningRef.current = false;
      setError("Não foi possível iniciar o microfone.");
    }
  }, [stopListening]);

  function cancelar() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    capturedRef.current = "";
    stopListening();
    setPergunta("");
    setPendingQuestion(null);
  }

  function novasSessao() {
    cancelar();
    stopTts();
    setHistorico([]);
    setRespostas([]);
    setError(null);
    setErrorTrace(null);
    setPendingQuestion(null);
    setSalvarEscolhaIdx(null);
  }

  // Vindo de "Perguntas salvas" ou "Meus avisos" (botão Perguntar): faz a pergunta uma vez, assim que a tela fica pronta.
  const autoPerguntaFeita = useRef(false);
  useEffect(() => {
    if (!ready || !me || autoPerguntaFeita.current) return;
    autoPerguntaFeita.current = true;
    const q = pegarPerguntaAgora()?.trim();
    if (!q) return;
    setPergunta(q);
    void enviar({ perguntaOverride: q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, me]);

  /**
   * ↺ Refazer: todas as categorias que já responderam a esta mesma pergunta nesta tela (a original e as dos
   * refazer anteriores). Sem isso, o segundo Refazer voltava para a categoria errada do começo.
   */
  /** Consultas que já responderam a esta mesma pergunta (o Refazer não tenta categoria que só teria essas). */
  function consultasJaUsadas(pergunta: string): string[] {
    const alvo = pergunta.trim().toLowerCase();
    const nomes = new Set<string>();
    for (const x of respostas) {
      if (x.perguntaTexto.trim().toLowerCase() !== alvo) continue;
      for (const q of x.avisoSnapshot?.queries ?? []) nomes.add(q.nome);
    }
    return [...nomes];
  }

  function categoriasJaTentadas(pergunta: string): string[] {
    const alvo = pergunta.trim().toLowerCase();
    const nomes = new Set<string>();
    for (const x of respostas) {
      if (x.perguntaTexto.trim().toLowerCase() !== alvo) continue;
      for (const c of x.classificacao.categorias) nomes.add(c);
    }
    return [...nomes];
  }

  async function enviar(opts?: { forcePipe?: "semantica" | "estruturada" | "hibrida"; perguntaOverride?: string; thresholdOverride?: number; forceCategories?: string[]; ampliarAteAchar?: boolean; forceAlvo?: "dados" | "uso_do_sistema"; refazer?: boolean; excluirCategorias?: string[]; excluirConsultas?: string[] }) {
    stopListening();
    const q = (opts?.perguntaOverride ?? pergunta).trim();
    if (!q || busy) return;
    // "Sim" vale UMA vez: logo depois de "não achei nas consultas" (resposta não semântica vazia),
    // faz a busca nos memos com a pergunta anterior. Depois disso, ampliar só pelo botão.
    const ultima = respostas[0];
    if (!opts && ultima && RESPOSTA_SIM.test(q) && isSemResposta(ultima) && ultima.classificacao.pipe !== "semantica") {
      setPergunta("");
      return enviar({ forcePipe: "semantica", perguntaOverride: ultima.perguntaTexto, forceCategories: ultima.classificacao.categorias, ampliarAteAchar: true });
    }
    setError(null);
    setErrorTrace(null);
    setStatusMsg(null);
    setBusy(true);
    setRefazerIdx(null);
    setHelpHintOpenIdx(null);
    setPendingQuestion(q);
    const ac = new AbortController();
    abortControllerRef.current = ac;
    try {
      const body: Record<string, unknown> = {
        pergunta: q,
        workspaceGroupId: workspaceGroupId ?? null,
        filtros: {
          autorId: filterAuthorId,
          dataInicio: filterDateFrom || null,
          dataFim: filterDateTo || null,
        },
        contextoSessao: historico,
      };
      if (opts?.forcePipe) body.forcePipe = opts.forcePipe;
      if (opts?.thresholdOverride != null) body.thresholdOverride = opts.thresholdOverride;
      if (opts?.forceCategories) body.forceCategories = opts.forceCategories;
      if (opts?.ampliarAteAchar) body.ampliarAteAchar = true;
      if (opts?.forceAlvo) body.forceAlvo = opts.forceAlvo;
      if (opts?.refazer) {
        body.refazer = true;
        body.excluirCategorias = opts.excluirCategorias ?? [];
        body.excluirConsultas = opts.excluirConsultas ?? [];
      }

      const response = await fetch(`${apiBase}/api/perguntas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      if (!response.ok || !response.body) {
        const txt = await response.text().catch(() => "");
        let msg = `HTTP ${response.status}`;
        try { msg = (JSON.parse(txt) as { message?: string }).message ?? msg; } catch { /* */ }
        throw new Error(msg);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let res: PerguntaResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const evt = JSON.parse(line.slice(6)) as { type: string; message?: string; data?: PerguntaResponse; llmTrace?: PerguntaLlmTraceEntry[] };
          if (evt.type === "status") setStatusMsg(evt.message ?? null);
          if (evt.type === "error") {
            if (evt.llmTrace?.length) setErrorTrace({ trace: evt.llmTrace, pergunta: q });
            throw new Error(evt.message ?? "Erro ao processar a pergunta.");
          }
          if (evt.type === "result" && evt.data) res = evt.data;
        }
      }

      if (!res) throw new Error("Resposta não recebida.");
      const card = { ...res, perguntaTexto: q };
      setRespostas((prev) => [card, ...prev]);
      if (res.comando) tratarComando(res.comando);
      if (res.criacao) setCriando(res.criacao);
      setHistorico((prev) => [
        ...prev,
        {
          pergunta: q,
          resposta: res!.resposta.resposta,
          pipe: res!.classificacao.pipe,
          dados_usados: res!.resposta.dados_usados.length > 0 ? res!.resposta.dados_usados : undefined,
        },
      ].slice(-5));
      setPergunta("");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const raw = e instanceof Error ? e.message : String(e);
      try { const j = JSON.parse(raw) as { message?: string }; setError(j.message ?? raw); }
      catch { setError(raw || "Não foi possível obter a resposta."); }
    } finally {
      abortControllerRef.current = null;
      setBusy(false);
      setStatusMsg(null);
      setPendingQuestion(null);
    }
  }

  // Memos novos nas respostas: pergunta ao servidor quais são atualizáveis (e alteráveis por mim)
  useEffect(() => {
    const novos = new Set<number>();
    for (const r of respostas) {
      for (const d of r.resposta.dados_usados) novos.add(d.memo_id);
      const de = r.resposta.dados_estruturados;
      for (const bloco of de ? (Array.isArray(de) ? de : [de]) : []) {
        for (const linha of bloco.linhas) if (linha["id"] != null) novos.add(Number(linha["id"]));
      }
    }
    const ids = [...novos].filter((id) => Number.isInteger(id) && id > 0 && !idsVerificadosRef.current.has(id));
    if (!ids.length) return;
    for (const id of ids) idsVerificadosRef.current.add(id);
    apiPostJson<{ ids: number[] }>("/api/memos/alteraveis", { ids: ids.slice(0, 500) })
      .then((r) => {
        if (r.ids.length) setAlteraveis((s) => new Set([...s, ...r.ids]));
      })
      .catch(() => { /* sem ✎: a resposta continua normal */ });
  }, [respostas]);

  // "Desfazer" some sozinho
  useEffect(() => {
    if (!avisoAlteracao) return;
    const t = window.setTimeout(() => setAvisoAlteracao(null), 10_000);
    return () => window.clearTimeout(t);
  }, [avisoAlteracao]);

  function aplicarAlteracaoLocal(memoId: number, r: MemoAlteracaoResponse) {
    setAlteracoesLocais((s) => ({ ...s, [memoId]: { ...(s[memoId] ?? {}), ...r.campos } }));
  }

  /** Um campo gravado direto da resposta (ex.: estado de um item da lista), com aviso e Desfazer. */
  async function alterarCampoDireto(memoId: number, campo: string, valor: string, aviso: string) {
    try {
      const r = await apiPostJson<MemoAlteracaoResponse>(`/api/memos/${memoId}/alterar`, { campos: { [campo]: valor } });
      aplicarAlteracaoLocal(memoId, r);
      setAvisoAlteracao({ texto: r.mudancas.length ? aviso : "Nada mudou.", lote: r.lote, memoId });
    } catch (e) {
      setAvisoAlteracao({ texto: `Não foi possível alterar: ${e instanceof Error ? e.message : String(e)}`, lote: null, memoId });
    }
  }

  /** Situação mudada direto da resposta (ex.: "✓ Concluir" na visão de lista), com aviso e Desfazer. */
  async function mudarSituacaoDireto(memoId: number, situacao: "Pendente" | "Concluído" | "Cancelado") {
    try {
      const r = await apiPostJson<MemoAlteracaoResponse>(`/api/memos/${memoId}/situacao`, { situacao });
      aplicarAlteracaoLocal(memoId, r);
      const texto = situacao === "Concluído" ? "Marcado como concluído." : situacao === "Cancelado" ? "Marcado como cancelado." : "Reativado.";
      setAvisoAlteracao({ texto, lote: r.lote, memoId });
    } catch (e) {
      setAvisoAlteracao({ texto: `Não foi possível alterar: ${e instanceof Error ? e.message : String(e)}`, lote: null, memoId });
    }
  }

  /** Comando de alteração: gravado → aviso com Desfazer; pede confirmação → abre o cartão com a proposta. */
  function tratarComando(cmd: ComandoAlteracao) {
    const ids = (cmd.candidatos ?? []).map((c) => c.memoId);
    if (ids.length) setAlteraveis((s) => new Set([...s, ...ids]));
    if (cmd.status === "alterado" && cmd.memoId != null) {
      const memoId = cmd.memoId;
      const prop = cmd.candidatos?.find((c) => c.memoId === memoId)?.propostos ?? {};
      setAlteracoesLocais((s) => ({ ...s, [memoId]: { ...(s[memoId] ?? {}), ...prop } }));
      setAvisoAlteracao({ texto: cmd.mensagem, lote: cmd.lote ?? null, memoId });
    }
    // "confirmar" e "escolher": o cartão de comando na própria resposta mostra a mudança e os botões
  }

  async function desfazerAlteracao() {
    const aviso = avisoAlteracao;
    if (aviso?.criadoId) {
      // Desfazer de uma criação: exclui o memo recém-criado (exclusão lógica)
      const id = aviso.criadoId;
      setAvisoAlteracao(null);
      try {
        await apiDeleteJson(`/api/memos/${id}`);
        // Desfeito: a resposta volta a oferecer "Revisar e salvar"
        setCriados((m) => new Map([...m].filter(([, v]) => v !== id)));
        setAvisoAlteracao({ texto: "Registro desfeito.", lote: null, memoId: id });
      } catch (e) {
        setAvisoAlteracao({ texto: `Não foi possível desfazer: ${e instanceof Error ? e.message : String(e)}`, lote: null, memoId: id });
      }
      return;
    }
    if (!aviso?.lote) return;
    setAvisoAlteracao(null);
    try {
      const r = await apiPostJson<MemoAlteracaoResponse>(`/api/memos/alteracoes/${aviso.lote}/desfazer`, {});
      aplicarAlteracaoLocal(aviso.memoId, r);
      setAvisoAlteracao({ texto: "Alteração desfeita.", lote: null, memoId: aviso.memoId });
    } catch (e) {
      setAvisoAlteracao({ texto: `Não foi possível desfazer: ${e instanceof Error ? e.message : String(e)}`, lote: null, memoId: aviso.memoId });
    }
  }

  // O contexto é memorizado; o botão ⧉ Repetir lista chama sempre o enviar da renderização atual
  const enviarRef = useRef<typeof enviar | null>(null);
  enviarRef.current = enviar;
  const alteracaoCtx = useMemo<AlteracaoCtxValor>(
    () => ({
      alteraveis,
      locais: alteracoesLocais,
      abrir: (id: number, propostos?: Record<string, string>) => { setPropostosAbertos(propostos); setAlterandoMemoId(id); },
      abrirCriacao: (c: ComandoCriacao) => setCriando(c),
      criados,
      mudarSituacao: (id: number, situacao: "Pendente" | "Concluído" | "Cancelado") => void mudarSituacaoDireto(id, situacao),
      aplicarLocal: (id: number, r: MemoAlteracaoResponse) => aplicarAlteracaoLocal(id, r),
      alterarCampo: (id: number, campo: string, valor: string, aviso: string) => alterarCampoDireto(id, campo, valor, aviso),
      repetirLista: (id: number) => void enviarRef.current?.({ perguntaOverride: `Repetir a lista #${id}` }),
      groupId: workspaceGroupId ?? null,
    }),
    [alteraveis, alteracoesLocais, criados, workspaceGroupId]
  );

  async function openMemoCard(id: number) {
    if (loadingCardId === id) return;
    setLoadingCardId(id);
    try {
      const card = await apiGet<MemoRecentCard>(`/api/memos/${id}/card`);
      setCardMemo(card);
    } catch {
      /* silencioso — memo pode não estar mais acessível */
    } finally {
      setLoadingCardId(null);
    }
  }

  async function openMemoFileDirect(id: number) {
    if (loadingFileId === id) return;
    setLoadingFileId(id);
    try {
      const card = await apiGet<MemoRecentCard>(`/api/memos/${id}/card`);
      setFilePreviewMemo(card);
    } catch {
      /* silencioso */
    } finally {
      setLoadingFileId(null);
    }
  }

  function stopTts() {
    if (typeof window.speechSynthesis !== "undefined") window.speechSynthesis.cancel();
    if (ttsTimeoutRef.current) { clearTimeout(ttsTimeoutRef.current); ttsTimeoutRef.current = null; }
    ttsBusyRef.current = null;
    setTtsBusyPergunta(null);
  }

  function speakText(key: string, text: string) {
    if (typeof window.speechSynthesis === "undefined") return;
    window.speechSynthesis.cancel();
    if (ttsTimeoutRef.current) { clearTimeout(ttsTimeoutRef.current); ttsTimeoutRef.current = null; }
    ttsBusyRef.current = key;
    setTtsBusyPergunta(key);
    const ttsText = normalizeTtsText(stripMarkdown(text).replace(/\n+/g, " "));
    const u = new SpeechSynthesisUtterance(ttsText);
    u.lang = "pt-BR";
    u.rate = me?.ttsRate ?? 1.0;
    u.onend = () => { ttsBusyRef.current = null; setTtsBusyPergunta(null); };
    u.onerror = () => { ttsBusyRef.current = null; setTtsBusyPergunta(null); };
    ttsTimeoutRef.current = setTimeout(() => {
      ttsTimeoutRef.current = null;
      if (ttsBusyRef.current === key) window.speechSynthesis.speak(u);
    }, 2000);
  }

  function toggleSpeakResposta(key: string, text: string) {
    if (typeof window.speechSynthesis === "undefined") return;
    if (ttsBusyRef.current === key) { stopTts(); return; }
    speakText(key, text);
  }

  // Para TTS ao clicar em qualquer ponto fora do card ativo e do botão de narrar
  useEffect(() => {
    if (!ttsBusyPergunta) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Element;
      if (target.closest("[data-tts-btn]")) return;
      if (target.closest("[data-tts-card-active]")) return;
      stopTts();
    }
    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsBusyPergunta]);

  // Auto-narrar a resposta mais recente quando soundEnabled
  useEffect(() => {
    const prev = prevRespostasLenRef.current;
    prevRespostasLenRef.current = respostas.length;
    if (respostas.length > prev && me?.soundEnabled && respostas[0]) {
      const r = respostas[0];
      speakText(r.perguntaTexto, r.resposta.resposta);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respostas.length]);

  function handleCloseMemoCard() {
    if (memoDeleteBusy) return;
    setCardMemo(null);
    setMemoEditMode(false);
    setMemoDeleteConfirm(false);
    setMemoDeleteError(null);
  }

  async function handleDeleteMemoCard() {
    if (!cardMemo) return;
    setMemoDeleteBusy(true);
    setMemoDeleteError(null);
    try {
      await apiDeleteJson(`/api/memos/${cardMemo.id}`);
      setMemoDeleteBusy(false);
      setMemoDeleteConfirm(false);
      setCardMemo(null);
      setMemoEditMode(false);
    } catch (e) {
      setMemoDeleteError(e instanceof Error ? e.message : "Não foi possível excluir.");
      setMemoDeleteBusy(false);
    }
  }

  function handleOpenMemoEdit(m: MemoRecentCard) {
    setEditText(m.mediaText ?? "");
    setEditKeywords(m.keywords ?? "");
    setEditDados(m.dadosEspecificosJson ?? "");
    setEditError(null);
    setMemoEditMode(true);
  }

  async function handleSaveMemoEdit() {
    if (!cardMemo) return;
    setEditBusy(true);
    setEditError(null);
    try {
      await apiPatchJson<unknown>(`/api/memos/${cardMemo.id}`, {
        mediaText: editText.trim(),
        keywords: editKeywords.trim() || null,
        dadosEspecificosJson: editDados.trim() || null,
      });
      setCardMemo({ ...cardMemo, mediaText: editText.trim(), keywords: editKeywords.trim() || null, dadosEspecificosJson: editDados.trim() || null });
      setMemoEditMode(false);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setEditBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); }
  }

  function openFilterModal(modal: "quando" | "quem") {
    setDraftDateFrom(filterDateFrom);
    setDraftDateTo(filterDateTo);
    setDraftAuthorId(filterAuthorId);
    setFilterModal(modal);
  }

  function applyFilter() {
    if (filterModal === "quando") {
      setFilterDateFrom(draftDateFrom);
      setFilterDateTo(draftDateTo);
    } else if (filterModal === "quem") {
      setFilterAuthorId(draftAuthorId);
    }
    setFilterModal(null);
  }

  function clearFilter(which: "quando" | "quem") {
    if (which === "quando") { setFilterDateFrom(""); setFilterDateTo(""); }
    else { setFilterAuthorId(null); }
  }

  const hasQuando = !!(filterDateFrom || filterDateTo);
  const hasQuem = filterAuthorId != null;

  function getCamposForCategories(categorias: string[]): string[] {
    return contextCategories
      .filter((cat) => categorias.includes(cat.name))
      .flatMap((cat) => cat.campos.filter((c) => c.isActive).map((c) => c.name));
  }

  function isSemResposta(r: PerguntaResponse & { perguntaTexto: string }): boolean {
    const noMemos = r.resposta.dados_usados.length === 0;
    const de = r.resposta.dados_estruturados;
    const noRows = Array.isArray(de)
      ? de.every((d) => d.totalLinhas === 0)
      : (de?.totalLinhas ?? 0) === 0;
    if (r.classificacao.pipe === "semantica") return noMemos;
    if (r.classificacao.pipe === "estruturada") return noRows;
    return noMemos && noRows; // hibrida
  }

  function renderPipeLabel(pipe: string) {
    if (pipe === "semantica") return "Semântico";
    if (pipe === "estruturada") return "Estruturado";
    if (pipe === "hibrida") return "Híbrido";
    return pipe;
  }

  const [pdfGerandoIdx, setPdfGerandoIdx] = useState<number | null>(null);

  // Estado por resposta (pela identidade do objeto: o índice muda quando chega resposta nova)
  const [expandidos, setExpandidos] = useState<Set<object>>(() => new Set());
  const [detalhesAbertos, setDetalhesAbertos] = useState<Set<object>>(() => new Set());
  function alternarNoSet(set: Set<object>, item: object): Set<object> {
    const novo = new Set(set);
    if (novo.has(item)) novo.delete(item); else novo.add(item);
    return novo;
  }
  function alternarExpandido(r: object) { setExpandidos((prev) => alternarNoSet(prev, r)); }
  function alternarDetalhes(r: object) { setDetalhesAbertos((prev) => alternarNoSet(prev, r)); }
  /** Há algo para "Detalhes técnicos" conforme as configurações do usuário (custo, tempos, trace). */
  function temDetalhes(r: (typeof respostas)[number]): boolean {
    return (me?.showApiCost !== false && r.apiCost > 0)
      || Boolean(me?.showLlmTrace && ((r.timings?.length ?? 0) > 0 || (r.llmTrace?.length ?? 0) > 0));
  }

  /** PDF da resposta: texto, gráficos capturados da tela e tabelas com todos os registros. */
  async function baixarPdf(r: (typeof respostas)[number], i: number) {
    setPdfGerandoIdx(i);
    // Preferência "abrir o PDF numa aba": a aba abre já no clique (depois o bloqueador de pop-up impediria)
    const aba = me?.pdfAbrirAba ? window.open("", "_blank") : null;
    if (aba) aba.document.title = "Gerando PDF…";
    try {
      const { gerarPdfResposta } = await import("../lib/respostaPdf");
      type PdfTabela = import("../lib/respostaPdf").PdfTabela;
      const ds = r.resposta.dados_estruturados;
      const lista = ds ? (Array.isArray(ds) ? ds : [ds]) : [];
      const tabelas: PdfTabela[] = [];
      for (const [k, d] of lista.entries()) {
        if (!d.totalLinhas) continue;
        const g = buildDadosGrafico(d, r.perguntaTexto);
        const grafico: PdfTabela["grafico"] = g
          ? {
              rotulos: g.rows.map((row) => String(row.label)),
              series: g.valueCols.map((c, idx) => ({
                nome: COLUNA_LABELS[c] ?? c,
                cor: CHART_BAR_COLORS[idx % CHART_BAR_COLORS.length],
                valores: g.rows.map((row) => Number(row[c]) || 0),
              })),
            }
          : null;
        const linhas = d.linhasCompletas ?? d.linhas;
        tabelas.push({
          titulo: lista.length > 1 ? `Dados ${k + 1}` : "Dados",
          colunas: d.colunas,
          rotulos: d.colunas.map((c) => COLUNA_LABELS[c] ?? c),
          linhas: linhas.map((l) => d.colunas.map((c) => textoCelula(c, l[c]))),
          totalLinhas: d.totalLinhas,
          grafico,
        });
      }
      if (r.classificacao.pipe === "semantica" && r.resposta.dados_usados.length) {
        const usados = r.resposta.dados_usados;
        const extras = Array.from(new Set(usados.flatMap((d) => (d.dadosEspecificos ? Object.keys(d.dadosEspecificos) : [])))).sort();
        const cols = ["Memo", "Tipo", "Conteúdo", ...extras];
        tabelas.push({
          titulo: "Memos usados",
          colunas: cols,
          rotulos: cols,
          linhas: usados.map((d) => [
            `#${d.memo_id}`,
            MEDIA_TYPE_LABELS[d.mediaType ?? ""] ?? d.mediaType ?? "—",
            d.mediatext ?? "—",
            ...extras.map((k) => (d.dadosEspecificos?.[k] != null ? String(d.dadosEspecificos[k]) : "—")),
          ]),
          totalLinhas: usados.length,
        });
      }
      await gerarPdfResposta({
        pergunta: r.perguntaTexto,
        resposta: stripMarkdown(r.resposta.resposta).trim(),
        tipo: renderPipeLabel(r.classificacao.pipe),
        confianca: r.resposta.confianca_estimada ?? null,
        geradoEm: new Date(),
        tabelas,
        limitacoes: r.resposta.limitacoes,
      }, aba);
    } catch (e) {
      aba?.close();
      const msg = e instanceof Error ? e.message : String(e);
      // Página aberta antes de uma atualização pede o arquivo da versão anterior, que não existe mais
      const versaoAntiga = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(msg);
      setError(
        versaoAntiga
          ? "O myMemory foi atualizado enquanto esta página estava aberta. Recarregue a página (Ctrl+F5) e clique no PDF de novo."
          : `Não foi possível gerar o PDF: ${msg}`
      );
    } finally {
      setPdfGerandoIdx(null);
    }
  }

  const chaveUltimoModelo = `mm_pergunta_modelo_ultimo:${workspaceGroupId ?? "pessoal"}`;

  function lerUltimoModelo(): { id: number; filterCat: string | null; busca: string; showCatFilter: boolean } | null {
    try {
      const raw = sessionStorage.getItem(chaveUltimoModelo);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function guardarUltimoModelo(id: number) {
    setUltimoModeloId(id);
    try {
      sessionStorage.setItem(chaveUltimoModelo, JSON.stringify({ id, filterCat, busca: modalSearchText, showCatFilter }));
    } catch { /* storage indisponível: só não lembra */ }
  }

  async function abrirModeloSelect() {
    const ultimo = lerUltimoModelo();
    setModeloSelectOpen(true);
    setOpenNoteId(null);
    setEditingModalModelo(null);
    setUltimoModeloId(ultimo?.id ?? null);
    setFilterCat(ultimo?.filterCat ?? null);
    setShowCatFilter(!!ultimo?.filterCat && ultimo.showCatFilter);
    setModalSearchText(ultimo?.busca ?? "");
    setModalShowSearch(!!ultimo?.busca);
    setModelosLoading(true);
    try {
      const gid = workspaceGroupId != null ? `?workspaceGroupId=${workspaceGroupId}` : "";
      const data = await apiGet<{ modelos: PerguntaModelo[] }>(`/api/pergunta-modelos${gid}`);
      setModelos(data.modelos);
    } catch { /* silencia */ } finally {
      setModelosLoading(false);
    }
  }

  async function saveModalModelo() {
    if (!editingModalModelo) return;
    setSavingModalModelo(true);
    try {
      const res = await apiPutJson<{ modelo: PerguntaModelo }>(
        `/api/pergunta-modelos/${editingModalModelo.id}`,
        { pergunta: editingModalModelo.pergunta.trim(), anotacoes: editingModalModelo.anotacoes.trim() || null, estrelas: editingModalModelo.estrelas, category: editingModalModelo.category }
      );
      setModelos((prev) => prev.map((m) => (m.id === editingModalModelo.id ? res.modelo : m)));
      setEditingModalModelo(null);
    } catch { /* silencia erros no modal */ } finally {
      setSavingModalModelo(false);
    }
  }

  async function alternarFixada(m: PerguntaModelo) {
    const fixada = !m.fixada;
    try {
      await apiPostJson(`/api/pergunta-modelos/${m.id}/fixar`, { fixada });
      const atualizado = { ...m, fixada };
      setModelos((prev) => prev.map((x) => (x.id === m.id ? atualizado : x)));
      setFixadas((prev) => (fixada ? [...prev.filter((x) => x.id !== m.id), atualizado] : prev.filter((x) => x.id !== m.id)));
    } catch { /* silencia: o ícone só não muda */ }
  }

  function selecionarModelo(m: PerguntaModelo) {
    setPergunta(m.pergunta);
    setChipValores({});
    const plano = m.plano;
    // Modelo de registro: chips vazios (um por campo); nada do dia em que foi salvo é reaproveitado
    const chips = !plano ? [] : ehPlanoCriacao(plano) ? chipsDeCriacao(plano) : derivarChips(plano.plano);
    // Sem parâmetros trocáveis → comportamento de sempre (texto na caixa)
    setModeloAtivo(chips.length ? { modelo: m, chips } : null);
  }

  function sairDoModelo() {
    if (modeloAtivo) {
      const plano = modeloAtivo.modelo.plano;
      setPergunta(
        ehPlanoCriacao(plano)
          ? textoDeCriacao(plano, chipValores) || plano.prefixo
          : perguntaComValores(modeloAtivo.modelo.pergunta, modeloAtivo.chips, chipValores)
      );
    }
    setModeloAtivo(null);
    setChipValores({});
  }

  /** Reexecuta a pergunta salva com os valores dos chips (sem classificação/planejamento). */
  async function executarModelo() {
    if (!modeloAtivo || busy) return;
    stopListening();
    // Modelo de registro: só o que foi preenchido vale (campo vazio fica nulo); o servidor monta o cartão sem IA
    const planoCriacao = modeloAtivo.modelo.plano;
    const registro = ehPlanoCriacao(planoCriacao);
    const q = ehPlanoCriacao(planoCriacao)
      ? textoDeCriacao(planoCriacao, chipValores)
      : perguntaComValores(modeloAtivo.modelo.pergunta, modeloAtivo.chips, chipValores);
    if (registro && !q) {
      setError("Preencha ao menos um valor.");
      return;
    }
    setError(null);
    setErrorTrace(null);
    setStatusMsg("Executando a pergunta salva…");
    setBusy(true);
    setRefazerIdx(null);
    setHelpHintOpenIdx(null);
    setPendingQuestion(q);
    let replanejar: string | null = null;
    try {
      const r = await fetch(`${apiBase}/api/pergunta-modelos/${modeloAtivo.modelo.id}/executar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ valores: chipValores }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        replanejar?: boolean; pergunta?: string; resultado?: PerguntaResponse;
        message?: string; llmTrace?: PerguntaLlmTraceEntry[];
      };
      if (!r.ok) {
        if (j.llmTrace?.length) setErrorTrace({ trace: j.llmTrace, pergunta: q });
        throw new Error(j.message ?? `HTTP ${r.status}`);
      }
      if (j.replanejar) replanejar = j.pergunta ?? q;
      else if (j.resultado) {
        const res = j.resultado;
        setRespostas((prev) => [{ ...res, perguntaTexto: q }, ...prev]);
        setHistorico((prev) => [
          ...prev,
          {
            pergunta: q,
            resposta: res.resposta.resposta,
            pipe: res.classificacao.pipe,
            dados_usados: res.resposta.dados_usados.length > 0 ? res.resposta.dados_usados : undefined,
          },
        ].slice(-5));
        if (res.criacao) {
          // Registro novo: abre o cartão "Revisar e salvar"; os chips voltam a ficar vazios para o próximo uso
          setCriando(res.criacao);
          setChipValores({});
        }
      } else throw new Error("Resposta não recebida.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível obter a resposta.");
    } finally {
      setBusy(false);
      setStatusMsg(null);
      setPendingQuestion(null);
    }
    // Query do plano mudou desde que a pergunta foi salva: segue pelo caminho normal
    if (replanejar) {
      setModeloAtivo(null);
      setChipValores({});
      await enviar({ perguntaOverride: replanejar });
    }
  }

  function cliqueSalvarModelo(cardIdx: number) {
    const r = respostas[cardIdx];
    if (!r) return;
    // Pedido de criação ("minha medida de hoje: …"): modelo de registro, com os campos da categoria como chips
    const temParametros = r.criacao
      ? camposDeModeloCriacao(r.criacao).length > 0
      : !!r.planoSalvavel && derivarChips(r.planoSalvavel.plano).length > 0;
    if (temParametros) setSalvarEscolhaIdx((v) => (v === cardIdx ? null : cardIdx));
    else void salvarModelo(cardIdx, false);
  }

  async function salvarModelo(cardIdx: number, comPlano: boolean) {
    const r = respostas[cardIdx];
    setSalvarEscolhaIdx(null);
    if (!r || modeloSavingIdx === cardIdx || modeloSavedIdx === cardIdx) return;
    const category = r.criacao?.categoria ?? r.classificacao.categorias[0] ?? null;
    // "hoje" no fuso local: o campo de data que valia hoje ao salvar passa a valer sempre "hoje" no uso
    const hojeIso = new Date().toLocaleDateString("sv-SE");
    const plano = comPlano ? (r.criacao ? planoDeCriacao(r.criacao, r.perguntaTexto, hojeIso) : r.planoSalvavel ?? null) : null;
    setModeloSaveErr(null);
    setModeloSavingIdx(cardIdx);
    try {
      await apiPostJson("/api/pergunta-modelos", {
        pergunta: r.perguntaTexto,
        category,
        workspaceGroupId: workspaceGroupId ?? null,
        plano,
      });
      setModeloSavedIdx(cardIdx);
      setTimeout(() => setModeloSavedIdx((v) => (v === cardIdx ? null : v)), 2000);
    } catch (e) {
      setModeloSaveErr(e instanceof Error ? e.message : "Erro ao salvar pergunta.");
    } finally {
      setModeloSavingIdx(null);
    }
  }


  async function ativarAviso() {
    if (!avisoModal) return;
    const r = respostas[avisoModal.cardIdx];
    if (!r || !r.avisoSnapshot) return;
    setAvisoSaving(true);
    setAvisoSaveErr(null);
    try {
      await avisosApi.criar({
        descricao: avisoModal.descricao,
        perguntaOriginal: r.perguntaTexto,
        pipe: r.classificacao.pipe,
        execucaoSnapshot: r.avisoSnapshot as unknown as Record<string, unknown>,
        frequenciaTipo: avisoModal.freqTipo,
        frequenciaHoras: avisoModal.freqTipo === "horas" ? avisoModal.freqHoras : null,
        canalDestino: avisoModal.email,
        workspaceGroupId: workspaceGroupId ?? null,
        textoRespostaInicial: r.resposta.resposta ?? null,
      });
      setAvisoSavedPergunta(r.perguntaTexto);
      setAvisoModal(null);
    } catch (e) {
      setAvisoSaveErr(e instanceof Error ? e.message : "Erro ao ativar aviso.");
    } finally {
      setAvisoSaving(false);
    }
  }

  const modeloCatOptions = useMemo(() => {
    if (modelos.length <= 6) return [];
    const cats = new Set<string>();
    let hasSemCat = false;
    for (const m of modelos) {
      if (m.category) cats.add(m.category);
      else hasSemCat = true;
    }
    if (cats.size === 0) return [];
    const sorted = [...cats].sort((a, b) => a.localeCompare(b, "pt"));
    if (hasSemCat) sorted.push("Sem categoria");
    return sorted;
  }, [modelos]);

  const filteredModelos = useMemo(() => {
    let result = modelos;
    if (filterCat) {
      result = filterCat === "Sem categoria"
        ? result.filter((m) => !m.category)
        : result.filter((m) => m.category === filterCat);
    }
    if (modalSearchText.trim()) {
      const q = modalSearchText.toLowerCase();
      result = result.filter(
        (m) => m.pergunta.toLowerCase().includes(q) || (m.anotacoes ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [modelos, filterCat, modalSearchText]);

  // Ao reabrir a lista, rola até a última pergunta escolhida
  useEffect(() => {
    if (!modeloSelectOpen || modelosLoading || ultimoModeloId == null) return;
    const el = modeloListRef.current?.querySelector(`[data-modelo-id="${ultimoModeloId}"]`);
    el?.scrollIntoView({ block: "center" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeloSelectOpen, modelosLoading]);

  if (!ready) {
    if (embedded) return <p className={styles.muted}>Carregando…</p>;
    return (
      <div className={styles.shell}>
        <Header />
        <main className={styles.main}><p className={styles.muted}>Carregando…</p></main>
      </div>
    );
  }

  return (
    <AlteracaoCtx.Provider value={alteracaoCtx}>
    <div className={embedded ? styles.embeddedShell : styles.shell}>
      {!embedded && <Header meRefreshKey={0} />}

      {alterandoMemoId != null ? (
        <MemoAlteracaoCartao
          memoId={alterandoMemoId}
          propostos={propostosAbertos}
          onFechar={() => { setAlterandoMemoId(null); setPropostosAbertos(undefined); }}
          onAlterado={(memoId, r, texto) => {
            setAlterandoMemoId(null);
            setPropostosAbertos(undefined);
            if (r.lote) aplicarAlteracaoLocal(memoId, r);
            setAvisoAlteracao({ texto, lote: r.lote, memoId });
          }}
        />
      ) : null}
      {criando ? (
        <MemoNovoCartao
          criacao={criando}
          onFechar={() => setCriando(null)}
          onCriado={(memo, texto) => {
            const pedido = criando;
            setCriados((m) => new Map(m).set(pedido, memo.id));
            setCriando(null);
            setAvisoAlteracao({ texto, lote: null, memoId: memo.id, criadoId: memo.id });
            setMemoParaLigar(memo.id);
          }}
        />
      ) : null}
      {memoParaLigar != null ? <RelacaoAposSalvar memoId={memoParaLigar} onFim={fimLigacao} /> : null}
      {avisoAlteracao ? (
        <div className={styles.avisoAlteracao} role="status">
          <span>{avisoAlteracao.texto}</span>
          {avisoAlteracao.lote || avisoAlteracao.criadoId ? (
            <button type="button" className={styles.avisoAlteracaoBtn} onClick={() => void desfazerAlteracao()}>
              ↶ Desfazer
            </button>
          ) : null}
          <button type="button" className={styles.avisoAlteracaoFechar} onClick={() => setAvisoAlteracao(null)} aria-label="Fechar aviso">×</button>
        </div>
      ) : null}

      {filterModal ? (
        <div className={styles.filterOverlay} onClick={() => setFilterModal(null)}>
          <div className={styles.filterModal} onClick={(e) => e.stopPropagation()}>
            {filterModal === "quando" ? (
              <>
                <h3 className={styles.filterModalTitle}>Filtrar por período</h3>
                <label className={styles.filterLabel}>
                  De
                  <input type="date" className={styles.filterInput} value={draftDateFrom} onChange={(e) => setDraftDateFrom(e.target.value)} />
                </label>
                <label className={styles.filterLabel}>
                  Até
                  <input type="date" className={styles.filterInput} value={draftDateTo} onChange={(e) => setDraftDateTo(e.target.value)} />
                </label>
              </>
            ) : (
              <>
                <h3 className={styles.filterModalTitle}>Filtrar por autor</h3>
                <div className={styles.authorList}>
                  <label className={styles.authorOption}>
                    <input type="radio" name="author" checked={draftAuthorId === null} onChange={() => setDraftAuthorId(null)} />
                    Todos
                  </label>
                  {authorOptions.map((a) => (
                    <label key={a.id} className={styles.authorOption}>
                      <input type="radio" name="author" checked={draftAuthorId === a.id} onChange={() => setDraftAuthorId(a.id)} />
                      {a.name ?? a.email ?? `#${a.id}`}
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className={styles.filterActions}>
              <button type="button" className="mm-btn mm-btn--primary" onClick={applyFilter}>Aplicar</button>
              <button type="button" className="mm-btn" onClick={() => setFilterModal(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Pergunta salva aberta e sem respostas: a caixa sobe para o topo (sem a área vazia de conversa em cima) */}
      <main className={`${styles.main} ${modeloAtivo && respostas.length === 0 && !pendingQuestion ? styles.mainCompacto : ""}`}>
        {!embedded && (
          <div className={styles.topBar}>
            <h1 className={styles.pageTitle}>Pergunte ao myMemory</h1>
            <div className={styles.topBarFilters}>
              {isGroup ? (
                <button
                  type="button"
                  className={`${styles.filterBtn} ${hasQuem ? styles.filterBtnActive : ""}`}
                  onClick={() => openFilterModal("quem")}
                >
                  Quem {hasQuem ? "✓" : ""}
                  {hasQuem ? (
                    <span className={styles.filterClear} onClick={(e) => { e.stopPropagation(); clearFilter("quem"); }} title="Limpar">×</span>
                  ) : null}
                </button>
              ) : null}
              <button
                type="button"
                className={`${styles.filterBtn} ${hasQuando ? styles.filterBtnActive : ""}`}
                onClick={() => openFilterModal("quando")}
              >
                Quando {hasQuando ? "✓" : ""}
                {hasQuando ? (
                  <span className={styles.filterClear} onClick={(e) => { e.stopPropagation(); clearFilter("quando"); }} title="Limpar">×</span>
                ) : null}
              </button>
            </div>
          </div>
        )}

        <div className={styles.inputArea}>
          <div className={styles.inputRow}>
            {modeloAtivo ? (
              <PerguntaChips
                modeloId={modeloAtivo.modelo.id}
                pergunta={ehPlanoCriacao(modeloAtivo.modelo.plano) ? modeloAtivo.modelo.plano.prefixo : modeloAtivo.modelo.pergunta}
                chips={modeloAtivo.chips}
                valores={chipValores}
                semSugestoes={ehPlanoCriacao(modeloAtivo.modelo.plano)}
                disabled={busy}
                onChange={(chave, v) => setChipValores((prev) => {
                  const nv = { ...prev };
                  if (v == null) delete nv[chave]; else nv[chave] = v;
                  return nv;
                })}
              />
            ) : (
            <textarea
              ref={textareaRef}
              className={styles.perguntaInput}
              placeholder="Digite sua pergunta ou fale clicando no microfone…"
              value={pergunta}
              onChange={(e) => { setPergunta(e.target.value); }}
              onKeyDown={handleKeyDown}
              onFocus={() => document.body.classList.add("mm-typing")}
              onBlur={() => document.body.classList.remove("mm-typing")}
              rows={2}
              disabled={busy}
            />
            )}
            {modeloAtivo ? null : (
            <div className={styles.micWrap}>
              <button
                type="button"
                className={`${styles.micBtn} ${micState === "listening" ? styles.micBtnActive : ""}`}
                onClick={() => {
                  if (micState === "listening") { stopListening(); return; }
                  setPergunta("");
                  void startListening();
                }}
                title={micState === "listening" ? "Parar gravação" : "Clique para falar"}
                aria-label={micState === "listening" ? "Parar gravação" : "Falar a pergunta"}
                aria-pressed={micState === "listening"}
                disabled={busy}
              >
                {micState === "listening" ? <IconStop size={20} /> : <IconMic size={22} />}
              </button>
              {micState === "listening" ? (
                <span className={styles.micOuvindo} role="status">Ouvindo…</span>
              ) : null}
              {(micState !== "idle" || pergunta.trim()) ? (
                <button
                  type="button"
                  className={styles.micCancelBtn}
                  onClick={() => { setPergunta(""); if (micState !== "idle") cancelar(); }}
                  title="Limpar texto"
                  aria-label="Limpar texto"
                  disabled={busy}
                ><IconX size={14} /></button>
              ) : null}
            </div>
            )}
          </div>
          <div className={styles.inputActions}>
            <div className={styles.inputActionsLeft}>
              {busy ? (
                <button
                  type="button"
                  className={styles.cancelarBtn}
                  onClick={cancelar}
                  title="Limpar e começar de novo"
                >
                  ✕ Cancelar
                </button>
              ) : null}
              {respostas.length > 0 && !busy ? (
                <button
                  type="button"
                  className={styles.novaSessaoBtn}
                  onClick={novasSessao}
                  title="Limpar histórico e começar nova sessão"
                  aria-label="Nova sessão"
                >
                  <IconRefresh size={16} /><span className={styles.soDesktop}>Nova sessão</span>
                </button>
              ) : null}
              {!busy && micState === "idle" ? (
                <button
                  type="button"
                  className={styles.carregarModeloBtn}
                  onClick={() => void abrirModeloSelect()}
                  title="Perguntas salvas"
                  aria-label="Perguntas salvas"
                >
                  <IconStar size={16} /><span className={styles.soDesktop}>Perguntas salvas</span>
                </button>
              ) : null}
              {/* Pergunta salva aberta: ✎ e ✕ ficam aqui, na linha de ações, e não numa coluna ao lado dos chips
                  (que tirava cerca de um terço da largura da caixa no celular) */}
              {modeloAtivo && !busy ? (
                <>
                  <button
                    type="button"
                    className={styles.modeloAcaoBtn}
                    onClick={sairDoModelo}
                    title="Editar como texto livre"
                    aria-label="Editar como texto livre"
                  >✎</button>
                  <button
                    type="button"
                    className={styles.modeloAcaoBtn}
                    onClick={() => { setModeloAtivo(null); setChipValores({}); setPergunta(""); }}
                    title="Fechar pergunta salva"
                    aria-label="Fechar pergunta salva"
                  >✕</button>
                </>
              ) : null}
            </div>
            {!busy ? (
              <button
                type="button"
                className={styles.perguntarBtn}
                disabled={!pergunta.trim() && !modeloAtivo}
                // Celular: tocar no botão tirava o foco da caixa, o teclado fechava e a caixa descia antes
                // do clique — o primeiro toque se perdia. Segura o foco e envia já no toque.
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  toqueEnviarRef.current = t ? { x: t.clientX, y: t.clientY } : null;
                }}
                onTouchEnd={(e) => {
                  const ini = toqueEnviarRef.current;
                  toqueEnviarRef.current = null;
                  const t = e.changedTouches[0];
                  if (!ini || !t || Math.abs(t.clientX - ini.x) > 12 || Math.abs(t.clientY - ini.y) > 12) return;
                  e.preventDefault();
                  if (!pergunta.trim() && !modeloAtivo) return;
                  void (modeloAtivo ? executarModelo() : enviar());
                  textareaRef.current?.blur();
                }}
                onClick={() => void (modeloAtivo ? executarModelo() : enviar())}
                title="Enviar (Enter)"
              >
                Enviar <IconSend size={16} />
              </button>
            ) : null}
          </div>
          {fixadas.length > 0 && !busy && micState === "idle" && !modeloAtivo ? (
            <div className={styles.fixadasRow} aria-label="Perguntas fixadas">
              <span className={styles.fixadasLbl}><IconPin size={13} /> Fixadas</span>
              {fixadas.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={styles.fixadaChip}
                  title={m.pergunta}
                  onClick={() => { guardarUltimoModelo(m.id); selecionarModelo(m); }}
                >
                  {m.plano ? <span aria-hidden>⚡</span> : null}
                  {m.pergunta.length > 48 ? `${m.pergunta.slice(0, 46)}…` : m.pergunta}
                </button>
              ))}
            </div>
          ) : null}
          {embedded && showFilters && (
            <div className={styles.filterPopover}>
              {isGroup ? (
                <button
                  type="button"
                  className={`${styles.filterBtn} ${hasQuem ? styles.filterBtnActive : ""}`}
                  onClick={() => { openFilterModal("quem"); setShowFilters(false); }}
                >
                  Quem {hasQuem ? "✓" : ""}
                  {hasQuem ? <span className={styles.filterClear} onClick={(e) => { e.stopPropagation(); clearFilter("quem"); }}>×</span> : null}
                </button>
              ) : null}
              <button
                type="button"
                className={`${styles.filterBtn} ${hasQuando ? styles.filterBtnActive : ""}`}
                onClick={() => { openFilterModal("quando"); setShowFilters(false); }}
              >
                Quando {hasQuando ? "✓" : ""}
                {hasQuando ? <span className={styles.filterClear} onClick={(e) => { e.stopPropagation(); clearFilter("quando"); }}>×</span> : null}
              </button>
            </div>
          )}
        </div>

        {error ? (
          <p className="mm-error" role="alert">
            {error}
            {errorTrace ? (
              <>
                {" "}
                <button
                  type="button"
                  className={styles.erroEtapasBtn}
                  onClick={() => setTraceModal(errorTrace)}
                  title="Ver as etapas que rodaram até o erro (classificação, planejamento e o SQL que falhou)"
                >
                  ver etapas ({errorTrace.trace.length})
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {modeloSaveErr ? <p className="mm-error" role="alert">Salvar pergunta: {modeloSaveErr}</p> : null}

        {pendingQuestion ? (
          <div className={`${styles.cards} ${styles.cardsPendente}`}>
            <article className={`${styles.card} ${styles.cardPending}`}>
              <div className={styles.cardPergunta}>
                <div className={styles.cardPerguntaMain}>
                  <span className={styles.cardPerguntaIcon} aria-hidden><IconChat size={16} /></span>
                  <p className={styles.cardPerguntaText}>{pendingQuestion}</p>
                </div>
              </div>
              <div className={styles.cardResposta}>
                <div className={styles.searchingIndicator}>
                  <span className={styles.searchingSpinner} aria-hidden />
                  <span className={styles.searchingLabel}>
                    {statusMsg ?? "Pesquisando nos seus memos…"}
                  </span>
                </div>
              </div>
            </article>
          </div>
        ) : null}

        {respostas.length > 0 ? (
          <div className={styles.cards}>
            {respostas.map((r, i) => (
              <article key={i} className={styles.card} {...(i === 0 ? { "data-resposta-nova": "" } : {})} {...(ttsBusyPergunta === r.perguntaTexto ? { "data-tts-card-active": "" } : {})}>
                <div className={styles.cardPergunta}>
                  <div className={styles.cardPerguntaMain}>
                    <span className={styles.cardPerguntaIcon} aria-hidden><IconChat size={16} /></span>
                    <p className={styles.cardPerguntaText}>{r.planoReaproveitado ? <span title="Plano salvo reaproveitado: sem classificação e planejamento">⚡ </span> : null}{r.perguntaTexto}</p>
                    <div className={styles.cardAcoes}>
                      {typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined" ? (
                        <button
                          type="button"
                          data-tts-btn
                          className={`${styles.acaoBtn} ${ttsBusyPergunta === r.perguntaTexto ? styles.acaoBtnOn : ""}`}
                          onClick={() => toggleSpeakResposta(r.perguntaTexto, r.resposta.resposta)}
                          aria-pressed={ttsBusyPergunta === r.perguntaTexto}
                          aria-label="Ouvir resposta"
                          title={ttsBusyPergunta === r.perguntaTexto ? "Parar narração" : "Ouvir a resposta"}
                        >
                          <IconVolume size={18} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={`${styles.acaoBtn} ${modeloSavedIdx === i ? styles.acaoBtnOn : ""}`}
                        onClick={() => cliqueSalvarModelo(i)}
                        title={modeloSavedIdx === i ? "Pergunta salva" : "Salvar esta pergunta"}
                        aria-label="Salvar esta pergunta"
                        disabled={modeloSavingIdx === i || modeloSavedIdx === i}
                      >
                        <IconChatPlus size={18} />
                      </button>
                      <button
                        type="button"
                        className={styles.acaoBtn}
                        onClick={() => void baixarPdf(r, i)}
                        disabled={pdfGerandoIdx === i}
                        aria-label="Baixar PDF"
                        title="Baixar a resposta em PDF (texto, gráfico e tabela com todos os registros)"
                      >
                        {pdfGerandoIdx === i ? <span className={styles.acaoSpinner} aria-hidden /> : <IconPdf />}
                      </button>
                      {r.sugestaoAviso && r.avisoSnapshot ? (
                        avisoSavedPergunta === r.perguntaTexto ? (
                          <a
                            href="/avisos"
                            className={`${styles.acaoBtn} ${styles.acaoBtnOn}`}
                            title="Aviso ativado. Ver Meus avisos"
                            aria-label="Aviso ativado. Ver Meus avisos"
                          >
                            <IconBell size={18} />
                          </a>
                        ) : (
                          <button
                            type="button"
                            className={styles.acaoBtn}
                            disabled={r.classificacao.contexto !== "nova"}
                            aria-label="Me avise quando mudar"
                            title={r.classificacao.contexto !== "nova"
                              ? "Aviso não disponível para perguntas de continuidade. Crie um aviso a partir de uma pergunta independente."
                              : `Me avise: ${r.sugestaoAviso}`}
                            onClick={() => setAvisoModal({
                              cardIdx: i,
                              descricao: r.sugestaoAviso!.length > 500
                                ? r.sugestaoAviso!.slice(0, 497) + "…"
                                : r.sugestaoAviso!,
                              freqTipo: "diaria",
                              freqHoras: 1,
                              email: me?.email ?? "",
                            })}
                          >
                            <IconBell size={18} />
                          </button>
                        )
                      ) : null}
                      {temDetalhes(r) ? (
                        <button
                          type="button"
                          className={`${styles.acaoBtn} ${detalhesAbertos.has(r) ? styles.acaoBtnOn : ""}`}
                          onClick={() => {
                            // O painel fica no fim do cartão: ao abrir, rola até ele (num cartão longo parecia não abrir)
                            const abrir = !detalhesAbertos.has(r);
                            alternarDetalhes(r);
                            if (abrir) {
                              setTimeout(
                                () => document.getElementById(`detalhes-tecnicos-${i}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
                                60
                              );
                            }
                          }}
                          aria-pressed={detalhesAbertos.has(r)}
                          aria-label="Detalhes técnicos"
                          title="Detalhes técnicos"
                        >
                          <IconInfo size={18} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {salvarEscolhaIdx === i || modeloSavedIdx === i ? (
                    <div className={styles.cardPerguntaExtra}>
                      {salvarEscolhaIdx === i ? (
                      <span className={styles.salvarEscolha}>
                        <button
                          type="button"
                          className={styles.salvarEscolhaPadrao}
                          autoFocus
                          onClick={() => void salvarModelo(i, false)}
                          title="Salva só o texto da pergunta (como sempre foi)"
                        >Salvar só o texto</button>
                        <button
                          type="button"
                          className={styles.salvarEscolhaAlt}
                          onClick={() => void salvarModelo(i, true)}
                          title="Salva com os parâmetros como chips trocáveis e reexecuta sem replanejar"
                        >⚡ Com parâmetros</button>
                        <button
                          type="button"
                          className={styles.salvarEscolhaFechar}
                          onClick={() => setSalvarEscolhaIdx(null)}
                          aria-label="Cancelar"
                        >×</button>
                      </span>
                    ) : null}
                      {modeloSavedIdx === i ? <span className={styles.modeloSavedMsg}>Pergunta salva</span> : null}
                    </div>
                  ) : null}
                </div>
                <div className={styles.cardResposta}>
                  {/* Comando (alterar/criar): sem as marcas técnicas da consulta */}
                  <div className={styles.cardRespostaMeta} style={r.comando || r.criacao ? { display: "none" } : undefined}>
                    <span className={`${styles.pipeBadge} ${styles[`pipe_${r.classificacao.pipe}`]}`}>
                      {renderPipeLabel(r.classificacao.pipe)}
                    </span>
                    <span className={`${styles.scopeBadge} ${r.classificacao.escopo_sugerido === "contexto_sessao" ? styles.scopeContexto : styles.scopeGlobal}`}>
                      {r.classificacao.escopo_sugerido === "contexto_sessao" ? "No contexto" : "Global"}
                    </span>
                    {(r.classificacao.pipe === "semantica" || (r.classificacao.pipe === "hibrida" && r.aguardaFase2)) && r.limiarInicial != null && r.limiarUsado != null && r.limiarUsado < r.limiarInicial - 0.001 ? (
                      <span
                        className={styles.limiarAmpliadoBadge}
                        title={`Busca ampliada: limiar reduzido de ${Math.round(r.limiarInicial * 100)}% para ${Math.round(r.limiarUsado * 100)}%`}
                      >
                        ↓ Busca ampliada
                      </span>
                    ) : null}
                    <MedidorConfianca
                      valor={r.resposta.dados_usados.length > 0 || r.classificacao.pipe !== "semantica" ? r.resposta.confianca_estimada : null}
                      titulo={r.classificacao.pipe === "semantica" && r.limiarUsado != null
                        ? (r.resposta.dados_usados.length > 0
                          ? `Confiança ${Math.round(r.resposta.confianca_estimada * 100)}%: similaridade máxima dos memos citados. Limiar utilizado ${Math.round(r.limiarUsado * 100)}% (mín. configurado: ${Math.round((r.limiarMinimo ?? 0) * 100)}%)`
                          : `Nenhum memo encontrado acima do limiar de ${Math.round(r.limiarUsado * 100)}% (mín. configurado: ${Math.round((r.limiarMinimo ?? 0) * 100)}%)`)
                        : `Confiança estimada da resposta: ${Math.round(r.resposta.confianca_estimada * 100)}%`}
                    />
                    <div className={styles.refazerArea}>
                    {r.classificacao.pipe === "semantica" || (r.classificacao.pipe === "hibrida" && r.aguardaFase2) ? (
                      (() => {
                        const proxLimiar = Math.max(
                          Math.round(((r.limiarUsado ?? 0) - 0.1) * 100) / 100,
                          r.limiarMinimo ?? 0,
                        );
                        const noMinimo = r.limiarUsado != null && r.limiarMinimo != null && r.limiarUsado <= r.limiarMinimo + 0.001;
                        const semResposta = isSemResposta(r);
                        const pipe = r.classificacao.pipe === "hibrida" ? "hibrida" : "semantica";
                        return (
                          <div className={styles.ampliarWrap}>
                            {semResposta ? (
                              <button
                                type="button"
                                className={`${styles.ajudaBtn} ${helpHintOpenIdx === i ? styles.ajudaBtnActive : ""}`}
                                onClick={() => setHelpHintOpenIdx(helpHintOpenIdx === i ? null : i)}
                                title="Dica: como obter respostas"
                              >
                                ?
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={styles.ampliarBtn}
                              disabled={busy || noMinimo}
                              title={noMinimo ? `Limiar mínimo (${Math.round((r.limiarMinimo ?? 0) * 100)}%) já atingido` : `Buscar novamente com limiar ${Math.round(proxLimiar * 100)}%`}
                              onClick={() => void enviar({ forcePipe: pipe, perguntaOverride: r.perguntaTexto, thresholdOverride: proxLimiar, forceCategories: r.classificacao.categorias, ampliarAteAchar: true })}
                            >
                              ↓ Ampliar busca
                            </button>
                          </div>
                        );
                      })()
                    ) : refazerIdx === i ? (
                      <div className={styles.refazerPipes}>
                        {(["semantica", "estruturada", "hibrida"] as const).map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`${styles.refazerPipeBtn} ${r.classificacao.pipe === p ? styles.refazerPipeCurrent : ""}`}
                            disabled={busy || r.classificacao.pipe === p}
                            onClick={() => void enviar({ forcePipe: p, perguntaOverride: r.perguntaTexto })}
                          >
                            {renderPipeLabel(p)}
                          </button>
                        ))}
                        {r.resposta.alvo === "uso_do_sistema" ? (
                          <button
                            type="button"
                            className={styles.refazerPipeBtn}
                            disabled={busy}
                            title="Procurar nos seus registros, não no manual"
                            onClick={() => void enviar({ forceAlvo: "dados", perguntaOverride: r.perguntaTexto })}
                          >
                            🗓 Meus registros
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={styles.refazerPipeBtn}
                            disabled={busy}
                            title="Responder como dúvida de uso, pelo manual"
                            onClick={() => void enviar({ forceAlvo: "uso_do_sistema", perguntaOverride: r.perguntaTexto })}
                          >
                            📘 No manual
                          </button>
                        )}
                        <button type="button" className={styles.refazerClose} onClick={() => setRefazerIdx(null)} title="Cancelar">×</button>
                      </div>
                    ) : isSemResposta(r) ? (
                      <div className={styles.ampliarWrap}>
                        <button
                          type="button"
                          className={`${styles.ajudaBtn} ${helpHintOpenIdx === i ? styles.ajudaBtnActive : ""}`}
                          onClick={() => setHelpHintOpenIdx(helpHintOpenIdx === i ? null : i)}
                          title="Dica: como obter respostas"
                        >
                          ?
                        </button>
                        <button
                          type="button"
                          className={styles.refazerBtn}
                          disabled={busy}
                          onClick={() => void enviar({ forcePipe: "semantica", perguntaOverride: r.perguntaTexto, forceCategories: r.classificacao.categorias, ampliarAteAchar: true })}
                          title="Procurar a mesma pergunta nos textos dos memos (também dá para responder sim)"
                        >
                          🔎 Buscar nos memos
                        </button>
                      </div>
                    ) : (
                      // Um toque: o sistema tenta outra categoria parecida com a pergunta ou, se não houver, os textos dos memos.
                      // O "⋯" abre as opções de sempre (Semântico, Estruturado, Híbrido, No manual).
                      <span className={styles.ampliarWrap}>
                        <button
                          type="button"
                          className={styles.refazerBtn}
                          disabled={busy}
                          onClick={() =>
                            void enviar({
                              refazer: true,
                              excluirCategorias: categoriasJaTentadas(r.perguntaTexto),
                              excluirConsultas: consultasJaUsadas(r.perguntaTexto),
                              perguntaOverride: r.perguntaTexto,
                            })
                          }
                          title="Não era isso? Refaz a pergunta com outra categoria ou nos textos dos memos"
                        >
                          ↺ Refazer
                        </button>
                        <button
                          type="button"
                          className={styles.refazerBtn}
                          disabled={busy}
                          onClick={() => setRefazerIdx(i)}
                          title="Mais opções: escolher Semântico, Estruturado ou Híbrido"
                          aria-label="Mais opções de refazer"
                        >
                          ⋯
                        </button>
                      </span>
                    )}
                  </div>
                  </div>
                  {(r.classificacao.pipe === "semantica" || (r.classificacao.pipe === "hibrida" && r.aguardaFase2)) && r.resposta.dados_usados.length === 0 && r.limiarUsado != null && r.limiarMinimo != null && r.limiarUsado <= r.limiarMinimo + 0.001 ? (
                    <p className={styles.limiarMinimoAviso}>
                      Limiar mínimo de {Math.round(r.limiarMinimo * 100)}% atingido sem memos relevantes encontrados.
                      O limiar inicial e o mínimo são configuráveis em <strong>Admin → Outros → Configurações do sistema</strong>.
                    </p>
                  ) : null}
                  {r.comando || (respostaComLista(r.resposta) && stripMarkdown(r.resposta.resposta).trim().length > MAX_TEXTO_COM_LISTA) ? null : (() => {
                    const texto = stripMarkdown(r.resposta.resposta).trimEnd();
                    // Com tabela logo abaixo, o texto só repete o que ela mostra: fica em 2 linhas com "Mais…"
                    const temTabela = temTabelaNaResposta(r.resposta);
                    const longo = temTabela ? texto.length > TEXTO_RESUMO_COM_TABELA : textoLongo(texto);
                    const recolhido = longo && !expandidos.has(r);
                    return (
                      <div className={styles.respostaTextoWrap}>
                        <p
                          className={`${styles.cardRespostaText} ${
                            recolhido ? (temTabela ? styles.cardRespostaTextResumo : styles.cardRespostaTextRecolhido) : ""
                          }`}
                        >
                          {texto}
                          {recolhido ? null : <BotoesAlterarResposta resposta={r.resposta} />}
                        </p>
                        {longo ? (
                          <div className={styles.lerMaisRow}>
                            <button type="button" className={styles.lerMaisBtn} onClick={() => alternarExpandido(r)} aria-expanded={!recolhido}>
                              {recolhido ? (temTabela ? "Mais…" : "Ler mais") : "Ler menos"}
                            </button>
                            {recolhido ? <BotoesAlterarResposta resposta={r.resposta} /> : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
                  <ComandoCartao comando={r.comando} />
                  <CriacaoBotao criacao={r.criacao} />
                  {r.resposta.refeitoCom ? <p className={styles.alvoUsoNota}>↺ Refeito com: {r.resposta.refeitoCom}</p> : null}
                  {r.resposta.alvo === "uso_do_sistema" ? (
                    <div className={styles.ampliarWrap}>
                      <span className={styles.alvoUsoNota}>Respondi como dúvida de uso.</span>
                      <button
                        type="button"
                        className={styles.refazerBtn}
                        disabled={busy}
                        title="Procurar a mesma pergunta nos seus registros, não no manual"
                        onClick={() => void enviar({ forceAlvo: "dados", perguntaOverride: r.perguntaTexto })}
                      >
                        🗓 Buscar nos meus registros
                      </button>
                    </div>
                  ) : null}
                  {r.resposta.dados_estruturados ? (
                    Array.isArray(r.resposta.dados_estruturados)
                      ? r.resposta.dados_estruturados.map((d, idx) => (
                          <EstruturadoComGrafico key={idx} dados={d} pergunta={r.perguntaTexto} onOpenMemo={(id) => void openMemoCard(id)} onOpenMemoFile={(id) => void openMemoFileDirect(id)} loadingCardId={loadingCardId} loadingFileId={loadingFileId} />
                        ))
                      : <EstruturadoComGrafico dados={r.resposta.dados_estruturados} pergunta={r.perguntaTexto} onOpenMemo={(id) => void openMemoCard(id)} onOpenMemoFile={(id) => void openMemoFileDirect(id)} loadingCardId={loadingCardId} loadingFileId={loadingFileId} />
                  ) : null}
                  {r.classificacao.pipe === "semantica" ? (
                    <TabelaSemantica dados_usados={r.resposta.dados_usados} onOpenMemo={(id) => void openMemoCard(id)} onOpenMemoFile={(id) => void openMemoFileDirect(id)} loadingCardId={loadingCardId} loadingFileId={loadingFileId} />
                  ) : null}
                  {r.resposta.limitacoes.length > 0 && !r.comando && !r.criacao ? (
                    <ul className={styles.limitacoes}>
                      {r.resposta.limitacoes.map((l, j) => <li key={j}>{l}</li>)}
                    </ul>
                  ) : null}
                  {r.resposta.dados_usados.length > 0 && !r.comando ? (
                    <details className={styles.memosDetails}>
                      <summary className={styles.memosSummary}>
                        {r.resposta.dados_usados.length} memo(s) utilizado(s)
                      </summary>
                      <ul className={styles.memosList}>
                        {r.resposta.dados_usados.map((d, j) => (
                          <li key={j} className={styles.memosItem}>
                            <button
                              type="button"
                              className={styles.memoIdBtn}
                              onClick={() => void openMemoCard(d.memo_id)}
                              disabled={loadingCardId === d.memo_id}
                              title="Abrir memo"
                            >
                              {loadingCardId === d.memo_id ? "…" : `Memo #${d.memo_id}`}
                            </button>
                            {d.trecho_usado ? <span className={styles.memoTrecho}>"{d.trecho_usado}"</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {detalhesAbertos.has(r) ? (
                    <div id={`detalhes-tecnicos-${i}`} className={styles.detalhesTecnicos}>
                      <p className={styles.detalhesTitulo}>Detalhes técnicos</p>
                      {me?.showApiCost !== false && r.apiCost > 0 ? (
                        <p className={styles.apiCostLine}>
                          Custo de API: ${r.apiCost.toFixed(6)} — Créditos: {(r.apiCost * 100).toFixed(6)}
                        </p>
                      ) : null}
                      {me?.showLlmTrace && r.timings && r.timings.length > 0 ? (
                        <details className={styles.memosDetails}>
                          <summary className={styles.memosSummary}>
                            Tempo: {((r.timings[0]?.durationMs ?? 0) / 1000).toFixed(1)}s (ver etapas)
                          </summary>
                          <ul className={styles.memosList}>
                            {r.timings.map((t, j) => (
                              <li key={j} className={styles.memosItem} style={{ justifyContent: "space-between" }}>
                                <span style={j === 0 ? { fontWeight: 600 } : undefined}>{t.label}</span>
                                <span style={{ fontVariantNumeric: "tabular-nums", marginLeft: "0.75rem" }}>
                                  {(t.durationMs / 1000).toFixed(2)}s
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {me?.showLlmTrace && r.llmTrace && r.llmTrace.length > 0 ? (
                        <button
                          type="button"
                          className={styles.traceBtn}
                          onClick={() => setTraceModal({ trace: r.llmTrace!, pergunta: r.perguntaTexto })}
                          title={`Ver trace de ${r.llmTrace.length} chamada(s) desta resposta`}
                        >
                          <IconTrace /> Ver chamadas à IA ({r.llmTrace.length})
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : pendingQuestion || modeloAtivo ? null : (
          <p className={styles.emptyHint}>As respostas aparecerão aqui. Faça sua primeira pergunta!</p>
        )}
      </main>

      {cardMemo ? (
        <div className={styles.memoCardOverlay} onClick={handleCloseMemoCard}>
          <div className={styles.memoCardModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.memoCardHeader}>
              <button
                type="button"
                className={styles.memoCardBack}
                onClick={() => memoEditMode ? setMemoEditMode(false) : handleCloseMemoCard()}
              >
                {memoEditMode ? "← Cancelar" : "← Voltar"}
              </button>
              {memoEditMode ? (
                <button
                  type="button"
                  className={styles.memoCardSaveBtn}
                  disabled={editBusy || !editText.trim()}
                  onClick={() => void handleSaveMemoEdit()}
                >
                  {editBusy ? "Salvando…" : "Salvar"}
                </button>
              ) : (
                <span className={styles.memoCardId}>Memo #{cardMemo.id}</span>
              )}
            </div>
            <div className={styles.memoCardBody}>
              {memoEditMode ? (
                <div className={styles.memoEditForm}>
                  <label className={styles.memoEditLabel}>
                    Texto
                    <textarea
                      className={styles.memoEditTextarea}
                      rows={8}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                    />
                  </label>
                  <label className={styles.memoEditLabel}>
                    Palavras-chave
                    <textarea
                      className={styles.memoEditTextarea}
                      rows={2}
                      value={editKeywords}
                      onChange={(e) => setEditKeywords(e.target.value)}
                      placeholder="ex.: reunião, projeto"
                    />
                  </label>
                  <label className={styles.memoEditLabel}>
                    Dados específicos (JSON)
                    <textarea
                      className={styles.memoEditTextarea}
                      rows={3}
                      value={editDados}
                      onChange={(e) => setEditDados(e.target.value)}
                      placeholder='ex.: {"telefone":"(11) 99999-9999"}'
                    />
                  </label>
                  {editError ? <p className={styles.memoEditError}>{editError}</p> : null}
                </div>
              ) : (
                <ul className={styles.memoCardList}>
                  <MemoResultListRow
                    m={cardMemo}
                    returnTo="/perguntar"
                    currentUserId={me?.id ?? null}
                    deletingId={memoDeleteBusy ? cardMemo.id : null}
                    onOpenPreview={(m) => { setFilePreviewMemo(m); setCardMemo(null); }}
                    onRequestDelete={() => { setMemoDeleteError(null); setMemoDeleteConfirm(true); }}
                    noNavigate={true}
                    onEdit={handleOpenMemoEdit}
                  />
                </ul>
              )}
              {!memoEditMode && memoDeleteConfirm ? (
                <div className={styles.memoDeleteConfirm}>
                  <span>Mover o memo #{cardMemo.id} para a lixeira?</span>
                  <div className={styles.memoDeleteConfirmBtns}>
                    <button type="button" className="mm-btn mm-btn--ghost" disabled={memoDeleteBusy} onClick={() => setMemoDeleteConfirm(false)}>
                      Cancelar
                    </button>
                    <button type="button" className="mm-btn mm-btn--primary" disabled={memoDeleteBusy} onClick={() => void handleDeleteMemoCard()}>
                      {memoDeleteBusy ? "Excluindo…" : "Confirmar"}
                    </button>
                  </div>
                  {memoDeleteError ? <p className={styles.memoEditError}>{memoDeleteError}</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {filePreviewMemo ? (
        <MemoFilePreviewModal
          m={filePreviewMemo}
          apiBase={apiBase}
          returnTo="/perguntar"
          onClose={() => setFilePreviewMemo(null)}
        />
      ) : null}

      {traceModal ? (
        <LlmTraceModal
          trace={traceModal.trace}
          pergunta={traceModal.pergunta}
          onClose={() => setTraceModal(null)}
        />
      ) : null}

      {modeloSelectOpen ? (
        <div className={styles.modeloModalOverlay} onClick={() => setModeloSelectOpen(false)}>
          <div className={styles.modeloModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modeloModalHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span className={styles.modeloModalTitle}>Perguntas salvas</span>
                <button
                  type="button"
                  className={`${styles.modeloFilterBtn}${modalShowSearch || modalSearchText ? ` ${styles.modeloFilterBtnActive}` : ""}`}
                  title={modalShowSearch ? "Fechar busca" : "Buscar por texto"}
                  onClick={() => {
                    if (modalShowSearch) {
                      setModalShowSearch(false);
                      setModalSearchText("");
                    } else {
                      setModalShowSearch(true);
                      setTimeout(() => modalSearchInputRef.current?.focus(), 50);
                    }
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  {modalSearchText && <span className={styles.modeloFilterDot} />}
                </button>
                {modeloCatOptions.length > 1 && (
                  <button
                    type="button"
                    className={`${styles.modeloFilterBtn}${showCatFilter || filterCat ? ` ${styles.modeloFilterBtnActive}` : ""}`}
                    title="Filtrar por categoria"
                    onClick={() => setShowCatFilter((v) => !v)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                    </svg>
                    {filterCat && <span className={styles.modeloFilterDot} />}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button
                  type="button"
                  className={styles.modeloModalClose}
                  style={{ fontSize: "0.75rem", padding: "0.1rem 0.4rem", opacity: 0.7 }}
                  title="Editar perguntas salvas"
                  onClick={() => { setModeloSelectOpen(false); navigate("/perguntas-salvas"); }}
                ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{display:"inline",verticalAlign:"middle",marginRight:"3px"}}><path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4 5.4-5.4z"/></svg>Editar</button>
                <button type="button" className={styles.modeloModalClose} onClick={() => setModeloSelectOpen(false)}>×</button>
              </div>
            </div>
            {modalShowSearch && (
              <div className={styles.modeloSearchBar}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--mm-text-muted,#94a3b8)", flexShrink: 0 }}>
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  ref={modalSearchInputRef}
                  type="text"
                  className={styles.modeloSearchInput}
                  placeholder="Buscar na pergunta ou anotações…"
                  value={modalSearchText}
                  onChange={(e) => setModalSearchText(e.target.value)}
                />
                {modalSearchText && (
                  <button
                    type="button"
                    className={styles.modeloSearchClear}
                    onClick={() => setModalSearchText("")}
                    title="Limpar"
                  >×</button>
                )}
              </div>
            )}
            {showCatFilter && modeloCatOptions.length > 1 && (
              <div className={styles.modeloCatFilterBar}>
                <button
                  className={`${styles.modeloCatChip}${!filterCat ? ` ${styles.modeloCatChipActive}` : ""}`}
                  onClick={() => setFilterCat(null)}
                >Todas</button>
                {modeloCatOptions.map((cat) => (
                  <button
                    key={cat}
                    className={`${styles.modeloCatChip}${filterCat === cat ? ` ${styles.modeloCatChipActive}` : ""}`}
                    onClick={() => setFilterCat(filterCat === cat ? null : cat)}
                  >{cat}</button>
                ))}
              </div>
            )}
            {modelosLoading ? (
              <p className={styles.modeloModalEmpty}>Carregando…</p>
            ) : modelos.length === 0 ? (
              <p className={styles.modeloModalEmpty}>Nenhuma pergunta salva{workspaceGroupId ? " neste grupo" : ""}.</p>
            ) : filteredModelos.length === 0 ? (
              <p className={styles.modeloModalEmpty}>Nenhuma pergunta nesta categoria.</p>
            ) : (
              <ul ref={modeloListRef} className={styles.modeloList}>
                {filteredModelos.map((m) => (
                  <li key={m.id} data-modelo-id={m.id} className={`${styles.modeloItem}${m.id === ultimoModeloId ? ` ${styles.modeloItemUltimo}` : ""}`}>
                    {editingModalModelo?.id === m.id ? (
                      <div className={styles.modeloInlineEdit}>
                        <textarea
                          className={styles.modeloInlineTextarea}
                          value={editingModalModelo.pergunta}
                          rows={2}
                          onChange={(e) => setEditingModalModelo({ ...editingModalModelo, pergunta: e.target.value })}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                        />
                        <textarea
                          className={styles.modeloInlineTextarea}
                          value={editingModalModelo.anotacoes}
                          rows={1}
                          placeholder="Anotações (opcional)"
                          onChange={(e) => setEditingModalModelo({ ...editingModalModelo, anotacoes: e.target.value })}
                          style={{ fontStyle: "italic", fontSize: "0.78rem" }}
                        />
                        <select
                          className={styles.modeloInlineSelect}
                          value={editingModalModelo.category ?? ""}
                          onChange={(e) => setEditingModalModelo({ ...editingModalModelo, category: e.target.value || null })}
                          aria-label="Categoria da pergunta salva"
                          title="Categoria (usada no filtro das perguntas salvas)"
                        >
                          <option value="">Sem categoria</option>
                          {editingModalModelo.category && !categoryOptionsModelo.some((c) => c.name === editingModalModelo.category) ? (
                            <option value={editingModalModelo.category}>{editingModalModelo.category}</option>
                          ) : null}
                          {categoryOptionsModelo.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                        <div className={styles.modeloInlineStarRow}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              className={`${styles.modeloInlineStar}${editingModalModelo.estrelas !== null && n <= editingModalModelo.estrelas ? ` ${styles.modeloInlineStarOn}` : ""}`}
                              onClick={() => setEditingModalModelo({ ...editingModalModelo, estrelas: editingModalModelo.estrelas === n ? null : n })}
                              title={`${n} estrela${n > 1 ? "s" : ""}`}
                            >★</button>
                          ))}
                        </div>
                        <div className={styles.modeloInlineActions}>
                          <button
                            type="button"
                            className={styles.modeloInlineSave}
                            onClick={() => void saveModalModelo()}
                            disabled={savingModalModelo || !editingModalModelo.pergunta.trim()}
                          >{savingModalModelo ? "…" : "Salvar"}</button>
                          <button
                            type="button"
                            className={styles.modeloInlineCancel}
                            onClick={() => setEditingModalModelo(null)}
                          >Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className={styles.modeloItemRow}>
                          <button
                            type="button"
                            className={styles.modeloItemBtn}
                            onClick={() => { guardarUltimoModelo(m.id); selecionarModelo(m); setModeloSelectOpen(false); }}
                          >
                            {(m.category || m.estrelas) ? (
                              <span className={styles.modeloItemMeta}>
                                {m.category ? <span className={styles.modeloItemCat}>{m.category}</span> : null}
                                {m.estrelas ? <span className={styles.modeloItemStars}>{"★".repeat(m.estrelas)}</span> : null}
                              </span>
                            ) : null}
                            <span className={styles.modeloItemText}>{m.plano ? <span title="Com plano salvo: troque os valores e reexecute direto">⚡ </span> : null}{m.pergunta}</span>
                          </button>
                          <button
                            type="button"
                            className={`${styles.modeloItemEditBtn} ${m.fixada ? styles.modeloItemPinOn : ""}`}
                            title={m.fixada ? "Desafixar do Fale comigo" : "Fixar no Fale comigo (atalho embaixo da caixa)"}
                            aria-label={m.fixada ? "Desafixar pergunta" : "Fixar pergunta"}
                            aria-pressed={Boolean(m.fixada)}
                            onClick={(e) => { e.stopPropagation(); void alternarFixada(m); }}
                          ><IconPin size={14} /></button>
                          <button
                            type="button"
                            className={styles.modeloItemEditBtn}
                            title="Editar"
                            onClick={(e) => { e.stopPropagation(); setEditingModalModelo({ id: m.id, pergunta: m.pergunta, anotacoes: m.anotacoes ?? "", estrelas: m.estrelas ?? null, category: m.category ?? null }); }}
                          ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4 5.4-5.4z"/></svg></button>
                          {m.anotacoes ? (
                            <button
                              type="button"
                              className={styles.modeloItemInfoBtn}
                              title={openNoteId === m.id ? "Fechar orientação" : "Ver orientação"}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenNoteId(openNoteId === m.id ? null : m.id);
                              }}
                            >
                              <span className={styles.modeloItemInfoBadge}>i</span>
                            </button>
                          ) : null}
                        </div>
                        {openNoteId === m.id && m.anotacoes ? (
                          <div className={styles.modeloItemNoteExpanded}>
                            {m.anotacoes}
                          </div>
                        ) : null}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {avisoModal ? (
        <div className={styles.filterOverlay} onClick={() => { if (!avisoSaving) setAvisoModal(null); }}>
          <div className={styles.filterModal} style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.filterModalTitle}>Configurar aviso</h3>
            <label className={styles.filterLabel}>
              Descrição
              <input
                type="text"
                className={styles.filterInput}
                value={avisoModal.descricao}
                maxLength={500}
                onChange={(e) => setAvisoModal({ ...avisoModal, descricao: e.target.value })}
              />
            </label>
            <div className={styles.filterLabel}>
              Frequência
              <div className={styles.avisoFreqRow}>
                {([1, 2, 3, 6, 12] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`${styles.freqChip}${avisoModal.freqTipo === "horas" && avisoModal.freqHoras === h ? ` ${styles.freqChipActive}` : ""}`}
                    onClick={() => setAvisoModal({ ...avisoModal, freqTipo: "horas", freqHoras: h })}
                  >
                    {h}h
                  </button>
                ))}
                {(["diaria", "semanal", "mensal"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`${styles.freqChip}${avisoModal.freqTipo === t ? ` ${styles.freqChipActive}` : ""}`}
                    onClick={() => setAvisoModal({ ...avisoModal, freqTipo: t })}
                  >
                    {t === "diaria" ? "Diária" : t === "semanal" ? "Semanal" : "Mensal"}
                  </button>
                ))}
              </div>
            </div>
            <label className={styles.filterLabel}>
              E-mail
              <input
                type="email"
                className={styles.filterInput}
                value={avisoModal.email}
                onChange={(e) => setAvisoModal({ ...avisoModal, email: e.target.value })}
              />
            </label>
            {avisoSaveErr ? <p className="mm-error" style={{ margin: 0 }}>{avisoSaveErr}</p> : null}
            <div className={styles.filterActions}>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                disabled={avisoSaving || !avisoModal.descricao.trim() || !avisoModal.email.trim()}
                onClick={() => void ativarAviso()}
              >
                {avisoSaving ? "Ativando…" : "Ativar aviso"}
              </button>
              <button
                type="button"
                className="mm-btn"
                disabled={avisoSaving}
                onClick={() => setAvisoModal(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {helpHintOpenIdx !== null && respostas[helpHintOpenIdx] ? (() => {
        const rHelp = respostas[helpHintOpenIdx]!;
        const botaoSemantico = rHelp.classificacao.pipe === "semantica"
          ? <strong>Ampliar busca</strong>
          : <strong>🔎 Buscar nos memos</strong>;
        const categoriaDetectada = rHelp.classificacao.categorias.length > 0;
        let mensagem: React.ReactNode;
        if (categoriaDetectada) {
          const campos = getCamposForCategories(rHelp.classificacao.categorias);
          const termos = campos.length > 0 ? campos.join(", ") : rHelp.classificacao.categorias.join(", ");
          mensagem = <>
            Para trazer respostas semânticas clique no {botaoSemantico} e para trazer respostas com dados estruturados re-formule sua pergunta e use os termos como: <strong>{termos}</strong>.
          </>;
        } else {
          const todasCategorias = contextCategories.filter((c) => c.isActive).map((c) => c.name).join(", ");
          mensagem = <>
            Para eu responder com semântica clique no {botaoSemantico} e para responder com dados estruturados mencione uma das categorias previstas no sistema: <strong>{todasCategorias || "nenhuma categoria cadastrada"}</strong>.
          </>;
        }
        return (
          <div className={styles.ajudaModalOverlay} onClick={() => setHelpHintOpenIdx(null)}>
            <div className={styles.ajudaModalBox}>
              <p className={styles.ajudaModalText}>{mensagem}</p>
            </div>
          </div>
        );
      })() : null}
    </div>
    </AlteracaoCtx.Provider>
  );
}
