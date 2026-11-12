/**
 * PDF da resposta do Perguntar: pergunta, resposta, gráficos (desenhados no próprio PDF) e tabelas completas
 * (todas as linhas, não só as 20 da tela). jsPDF e autotable são carregados só ao clicar no ícone.
 */

export interface PdfTabela {
  titulo?: string;
  colunas: string[];
  /** Rótulo exibido de cada coluna. */
  rotulos: string[];
  linhas: string[][];
  totalLinhas: number;
  /** Barras desenhadas no PDF (vetorial, fonte e tamanho controlados — a captura do SVG aumentava as letras). */
  grafico?: { rotulos: string[]; series: { nome: string; cor: string; valores: number[] }[] } | null;
}

export interface PdfResposta {
  pergunta: string;
  resposta: string;
  tipo: string;
  confianca: number | null;
  geradoEm: Date;
  tabelas: PdfTabela[];
  limitacoes: string[];
}

const MARGEM = 14;
const COR_TITULO: [number, number, number] = [15, 118, 110];
const COR_TEXTO: [number, number, number] = [30, 41, 59];
const COR_SUAVE: [number, number, number] = [100, 116, 139];

function nomeArquivo(pergunta: string, quando: Date): string {
  const slug = pergunta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const z = (n: number) => String(n).padStart(2, "0");
  const carimbo = `${quando.getFullYear()}${z(quando.getMonth() + 1)}${z(quando.getDate())}-${z(quando.getHours())}${z(quando.getMinutes())}`;
  return `resposta-${slug || "mymemory"}-${carimbo}.pdf`;
}

/**
 * A fonte padrão do jsPDF (Helvetica) só tem os caracteres do WinAnsi. Um caractere fora dele (ex.: "−" U+2212,
 * "→", "≥") faz o jsPDF gravar a linha inteira em outra codificação: as letras saem espaçadas e o símbolo vira lixo.
 * Troca os comuns por equivalentes e o resto por "?".
 */
const TROCAS: Record<string, string> = {
  "−": "-", "‐": "-", "‑": "-", "‒": "-", "⁃": "-",
  "→": "->", "←": "<-", "↔": "<->", "⇒": "=>",
  "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~",
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", "​": "",
  "′": "'", "″": "\"", "✓": "v", "✔": "v", "✗": "x", "✕": "x",
};
// Acima de 255, o WinAnsi só tem estes
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
function paraWinAnsi(s: string): string {
  let out = "";
  for (const ch of s) {
    const t = TROCAS[ch];
    if (t !== undefined) out += t;
    else if (ch.codePointAt(0)! <= 255 || WINANSI_EXTRA.has(ch)) out += ch;
    else if (/\p{Extended_Pictographic}|[️‍]/u.test(ch)) continue; // emoji: some
    else out += "?";
  }
  return out;
}
function limparTextos<T>(v: T): T {
  if (typeof v === "string") return paraWinAnsi(v) as T;
  if (Array.isArray(v)) return v.map(limparTextos) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, limparTextos(x)])) as T;
  }
  return v; // Date, números etc.
}

export async function gerarPdfResposta(dadosOriginais: PdfResposta): Promise<void> {
  const dados = limparTextos(dadosOriginais);
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;

  // Tabela larga (mais de 6 colunas) fica melhor em paisagem
  const larga = dados.tabelas.some((t) => t.colunas.length > 6);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: larga ? "landscape" : "portrait", compress: true });
  const larguraPagina = doc.internal.pageSize.getWidth();
  const alturaPagina = doc.internal.pageSize.getHeight();
  const larguraUtil = larguraPagina - MARGEM * 2;
  const limiteY = alturaPagina - 16;
  let y = MARGEM;

  const garantirEspaco = (mm: number) => {
    if (y + mm > limiteY) {
      doc.addPage();
      y = MARGEM;
    }
  };
  const paragrafo = (texto: string, tamanho: number, cor = COR_TEXTO, estilo: "normal" | "bold" = "normal") => {
    doc.setFont("helvetica", estilo);
    doc.setFontSize(tamanho);
    doc.setTextColor(...cor);
    const alturaLinha = tamanho * 0.42;
    for (const bloco of texto.split(/\n/)) {
      const linhas = bloco.trim() ? (doc.splitTextToSize(bloco, larguraUtil) as string[]) : [""];
      for (const l of linhas) {
        garantirEspaco(alturaLinha);
        doc.text(l, MARGEM, y + alturaLinha * 0.8);
        y += alturaLinha;
      }
    }
  };
  const tituloSecao = (texto: string) => {
    garantirEspaco(12);
    y += 3;
    paragrafo(texto, 11, COR_TITULO, "bold");
    y += 1;
  };

  // Cabeçalho
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...COR_TITULO);
  doc.text("proMemory", MARGEM, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COR_SUAVE);
  doc.text(dados.geradoEm.toLocaleString("pt-BR"), larguraPagina - MARGEM, y + 5, { align: "right" });
  y += 9;
  doc.setDrawColor(...COR_TITULO);
  doc.setLineWidth(0.5);
  doc.line(MARGEM, y, larguraPagina - MARGEM, y);
  y += 5;

  tituloSecao("Pergunta");
  paragrafo(dados.pergunta, 11, COR_TEXTO, "bold");

  tituloSecao("Resposta");
  paragrafo(dados.resposta, 10);
  const meta = [dados.tipo, dados.confianca != null ? `Confiança: ${Math.round(dados.confianca * 100)}%` : ""].filter(Boolean).join(" · ");
  if (meta) {
    y += 1.5;
    paragrafo(meta, 8, COR_SUAVE);
  }

  /** Valor curto para o eixo Y: 240 mil, 1,5 mi. */
  const compacto = (v: number) => v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
  const passoBonito = (max: number) => {
    const bruto = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
    const n = bruto / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  };

  const desenharGrafico = (g: NonNullable<PdfTabela["grafico"]>) => {
    const n = g.rotulos.length;
    if (!n || !g.series.length) return;
    const FONTE_EIXO = 6.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONTE_EIXO);
    const rotulos = g.rotulos.map((r) => (r.length > 22 ? `${r.slice(0, 21)}…` : r));
    const maiorRotulo = Math.max(...rotulos.map((r) => doc.getTextWidth(r)));
    const larguraPlot = Math.min(larguraUtil, 175) - 16;
    const larguraGrupo = larguraPlot / n;
    // Rótulos inclinados (45°) só quando não cabem na horizontal
    const inclinar = rotulos.some((r) => doc.getTextWidth(r) > larguraGrupo - 1);
    const alturaRotulos = inclinar ? Math.min(maiorRotulo * 0.71 + 3, 30) : 5;
    const alturaPlot = 62;
    const legenda = g.series.length > 1 ? 6 : 0;
    garantirEspaco(alturaPlot + alturaRotulos + legenda + 4);

    const x0 = MARGEM + (larguraUtil - Math.min(larguraUtil, 175)) / 2 + 16;
    const yTopo = y + 2;
    const yBase = yTopo + alturaPlot;
    const maximo = Math.max(0, ...g.series.flatMap((s) => s.valores.filter((v) => Number.isFinite(v))));
    const passo = passoBonito(maximo || 1);
    const topo = Math.max(passo, Math.ceil((maximo || 1) / passo) * passo);

    // grade e eixo Y
    doc.setLineWidth(0.15);
    for (let v = 0; v <= topo + passo / 2; v += passo) {
      const yy = yBase - (v / topo) * alturaPlot;
      doc.setDrawColor(226, 232, 240);
      doc.line(x0, yy, x0 + larguraPlot, yy);
      doc.setTextColor(...COR_SUAVE);
      doc.text(compacto(v), x0 - 1.5, yy + 1, { align: "right" });
    }
    doc.setDrawColor(148, 163, 184);
    doc.line(x0, yTopo, x0, yBase);
    doc.line(x0, yBase, x0 + larguraPlot, yBase);

    // barras
    const larguraBarra = (larguraGrupo * 0.72) / g.series.length;
    g.series.forEach((serie, si) => {
      doc.setFillColor(serie.cor);
      serie.valores.forEach((v, i) => {
        if (!Number.isFinite(v) || v <= 0) return;
        const h = (v / topo) * alturaPlot;
        const x = x0 + i * larguraGrupo + larguraGrupo * 0.14 + si * larguraBarra;
        doc.rect(x, yBase - h, larguraBarra, h, "F");
      });
    });

    // rótulos do eixo X
    doc.setTextColor(...COR_TEXTO);
    rotulos.forEach((r, i) => {
      const xc = x0 + i * larguraGrupo + larguraGrupo / 2;
      if (inclinar) {
        const w = doc.getTextWidth(r);
        // texto termina no ponto do eixo, subindo da esquerda para a direita
        doc.text(r, xc - w * 0.71 + 1, yBase + 2 + w * 0.71, { angle: 45 });
      } else {
        doc.text(r, xc, yBase + 3.5, { align: "center" });
      }
    });
    y = yBase + alturaRotulos + 2;

    if (legenda) {
      let x = x0;
      doc.setFontSize(7.5);
      for (const serie of g.series) {
        doc.setFillColor(serie.cor);
        doc.rect(x, y, 3, 3, "F");
        doc.setTextColor(...COR_TEXTO);
        doc.text(serie.nome, x + 4.5, y + 2.6);
        x += 4.5 + doc.getTextWidth(serie.nome) + 6;
      }
      y += legenda;
    }
  };

  for (const t of dados.tabelas) {
    tituloSecao(t.titulo || "Dados");

    if (t.grafico) desenharGrafico(t.grafico);

    autoTable(doc, {
      startY: y,
      head: [t.rotulos],
      body: t.linhas,
      margin: { left: MARGEM, right: MARGEM, bottom: 18 },
      styles: { font: "helvetica", fontSize: 8, cellPadding: 1.6, overflow: "linebreak", textColor: COR_TEXTO },
      headStyles: { fillColor: COR_TITULO, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      showHead: "everyPage",
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2;
    const nota =
      t.totalLinhas > t.linhas.length
        ? `${t.linhas.length} de ${t.totalLinhas} registros (limite do PDF).`
        : `${t.totalLinhas} registro(s).`;
    paragrafo(nota, 8, COR_SUAVE);
  }

  if (dados.limitacoes.length) {
    tituloSecao("Observações");
    for (const l of dados.limitacoes) paragrafo(`• ${l}`, 9);
  }

  // Rodapé com numeração
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COR_SUAVE);
    doc.text("Gerado pelo proMemory", MARGEM, alturaPagina - 8);
    doc.text(`Página ${p} de ${total}`, larguraPagina - MARGEM, alturaPagina - 8, { align: "right" });
  }

  doc.save(nomeArquivo(dados.pergunta, dados.geradoEm));
}
