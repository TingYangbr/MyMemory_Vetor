/**
 * PDF da resposta do Perguntar: pergunta, resposta, gráficos (capturados da tela) e tabelas completas
 * (todas as linhas, não só as 20 da tela). jsPDF e autotable são carregados só ao clicar no ícone.
 */

export interface PdfTabela {
  titulo?: string;
  colunas: string[];
  /** Rótulo exibido de cada coluna. */
  rotulos: string[];
  linhas: string[][];
  totalLinhas: number;
  grafico?: { png: string; largura: number; altura: number; legenda: { nome: string; cor: string }[] } | null;
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

/** Converte o gráfico (SVG do recharts) em imagem JPEG para o PDF (PNG sem compressão deixava o arquivo com MBs). Variáveis CSS viram a cor de reserva. */
export async function svgParaPng(svg: SVGSVGElement): Promise<{ png: string; largura: number; altura: number } | null> {
  const r = svg.getBoundingClientRect();
  const largura = Math.round(r.width);
  const altura = Math.round(r.height);
  if (!largura || !altura) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(largura));
  clone.setAttribute("height", String(altura));
  const xml = new XMLSerializer()
    .serializeToString(clone)
    .replace(/var\(--[\w-]+,\s*([^)]+)\)/g, "$1")
    .replace(/var\(--[\w-]+\)/g, "#94a3b8");
  const img = new Image();
  await new Promise<void>((ok, falha) => {
    img.onload = () => ok();
    img.onerror = () => falha(new Error("svg"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  });
  const escala = 2;
  const canvas = document.createElement("canvas");
  canvas.width = largura * escala;
  canvas.height = altura * escala;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { png: canvas.toDataURL("image/jpeg", 0.92), largura, altura };
}

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

export async function gerarPdfResposta(dados: PdfResposta): Promise<void> {
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

  for (const t of dados.tabelas) {
    tituloSecao(t.titulo || "Dados");

    if (t.grafico) {
      const largura = Math.min(larguraUtil, 180);
      const altura = (t.grafico.altura / t.grafico.largura) * largura;
      garantirEspaco(altura + (t.grafico.legenda.length > 1 ? 8 : 2));
      doc.addImage(t.grafico.png, "JPEG", MARGEM, y, largura, altura);
      y += altura + 2;
      if (t.grafico.legenda.length > 1) {
        let x = MARGEM;
        doc.setFontSize(8);
        for (const item of t.grafico.legenda) {
          doc.setFillColor(item.cor);
          doc.rect(x, y, 3, 3, "F");
          doc.setTextColor(...COR_TEXTO);
          doc.text(item.nome, x + 4.5, y + 2.6);
          x += 4.5 + doc.getTextWidth(item.nome) + 6;
        }
        y += 6;
      }
    }

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
