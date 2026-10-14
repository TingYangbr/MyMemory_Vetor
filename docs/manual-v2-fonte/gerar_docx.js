// Gera o .docx do manual v2 a partir do Markdown estruturado (mesmo padrão visual do v1).
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
  ShadingType, AlignmentType, BorderStyle, LevelFormat, PageBreak, Footer, Header, PageNumber,
} = require("docx");

const src = process.argv[2];
const out = process.argv[3];
const linhas = fs.readFileSync(src, "utf8").split(/\r?\n/);

const AZUL = "1E3A5F";
const NOTA = "7B3F00";
const DICA = "2D6A4F";
const CINZA = "555555";
const LARGURA = 11906 - 900 * 2; // A4 menos margens (DXA)

const filhos = [];
let listaNum = 0; // instância de numeração por bloco de passos

function texto(t, opts = {}) {
  return new TextRun({ text: t, font: "Calibri", size: opts.size ?? 21, bold: opts.bold, italics: opts.italics, color: opts.color });
}

function tabela(rows) {
  const cols = rows[0].length;
  const pesos = cols === 2 ? [0.3, 0.7] : cols === 3 ? [0.25, 0.35, 0.4] : Array(cols).fill(1 / cols);
  const larguras = pesos.map((p) => Math.floor(LARGURA * p));
  larguras[cols - 1] = LARGURA - larguras.slice(0, -1).reduce((a, b) => a + b, 0);
  const borda = { style: BorderStyle.SINGLE, size: 4, color: "B7C4D6" };
  return new Table({
    width: { size: LARGURA, type: WidthType.DXA },
    columnWidths: larguras,
    rows: rows.map((cells, ri) => new TableRow({
      tableHeader: ri === 0,
      cantSplit: true,
      children: cells.map((c, ci) => new TableCell({
        width: { size: larguras[ci], type: WidthType.DXA },
        shading: ri === 0 ? { type: ShadingType.CLEAR, color: "auto", fill: "D0E4FF" } : undefined,
        borders: { top: borda, bottom: borda, left: borda, right: borda },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [texto(c, { size: 20, bold: ri === 0 || (ci === 0 && cols === 2), color: ri === 0 ? AZUL : undefined })] })],
      })),
    })),
  });
}

function caixa(rotulo, resto, cor) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    indent: { left: 360 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: cor, space: 8 } },
    children: [texto(rotulo + " ", { bold: true, color: cor }), texto(resto)],
  });
}

// Capa
let i = 0;
filhos.push(new Paragraph({ spacing: { before: 2400, after: 120 }, alignment: AlignmentType.CENTER, children: [texto(linhas[0], { size: 72, bold: true, color: AZUL })] }));
filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [texto(linhas[1], { size: 36, color: AZUL })] }));
filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [texto(linhas[2], { size: 24, italics: true, color: CINZA })] }));
filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [texto(linhas[3], { size: 22 })] }));
i = 4;

let primeiraH1 = true;
while (i < linhas.length) {
  const l = linhas[i];
  if (!l.trim()) { i++; continue; }
  if (l.startsWith("|")) {
    const rows = [];
    while (i < linhas.length && linhas[i].startsWith("|")) {
      if (!/^\|[-|\s]+\|?$/.test(linhas[i])) {
        rows.push(linhas[i].replace(/^\|\s*|\s*\|$/g, "").split(/\s*\|\s*/));
      }
      i++;
    }
    filhos.push(tabela(rows));
    filhos.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
    continue;
  }
  if (l.startsWith("# ")) {
    filhos.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [new TextRun({ text: l.slice(2), font: "Calibri" })],
    }));
    primeiraH1 = false;
  } else if (l.startsWith("## ")) {
    filhos.push(new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, children: [new TextRun({ text: l.slice(3), font: "Calibri" })] }));
  } else if (l.startsWith("### ")) {
    filhos.push(new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, children: [new TextRun({ text: l.slice(4), font: "Calibri" })] }));
  } else if (/^(Rota|Rotas|Componente|Componentes):/.test(l)) {
    filhos.push(new Paragraph({ spacing: { after: 120 }, children: [texto(l, { italics: true, color: CINZA, size: 20 })] }));
  } else if (l.startsWith("NOTA:")) {
    filhos.push(caixa("NOTA:", l.slice(5).trim(), NOTA));
  } else if (l.startsWith("DICA:")) {
    filhos.push(caixa("DICA:", l.slice(5).trim(), DICA));
  } else if (/^- \d+\.\s/.test(l) || /^\d+\.\s/.test(l)) {
    // bloco de passos numerados (reinicia a cada bloco)
    listaNum++;
    while (i < linhas.length && (/^- \d+\.\s/.test(linhas[i]) || /^\d+\.\s/.test(linhas[i]))) {
      const t = linhas[i].replace(/^- /, "").replace(/^\d+\.\s*/, "");
      filhos.push(new Paragraph({ numbering: { reference: "passos", level: 0, instance: listaNum }, spacing: { after: 60 }, children: [texto(t)] }));
      i++;
    }
    continue;
  } else if (l.startsWith("- ")) {
    filhos.push(new Paragraph({ numbering: { reference: "marcadores", level: 0 }, spacing: { after: 60 }, children: [texto(l.slice(2))] }));
  } else if (l.startsWith("Fim do documento")) {
    filhos.push(new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [texto(l, { italics: true, color: CINZA, size: 20 })] }));
  } else {
    filhos.push(new Paragraph({ spacing: { after: 120 }, children: [texto(l)] }));
  }
  i++;
}

const doc = new Document({
  creator: "MyMemory",
  title: "MyMemory — Manual Operacional de Suporte — Versão 2",
  styles: {
    default: { document: { run: { font: "Calibri", size: 21 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, color: "2E74B5", font: "Calibri" }, paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, color: "2E74B5", font: "Calibri" }, paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, color: "1F4D78", font: "Calibri" }, paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: "marcadores", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 260 } } } }] },
      { reference: "passos", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, right: 900, bottom: 1080, left: 900 } } },
    headers: {
      default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [texto("MyMemory — Manual Operacional · Versão 2", { size: 16, color: CINZA })] })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
        new TextRun({ children: ["Página ", PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES], size: 16, color: CINZA, font: "Calibri" }),
      ] })] }),
    },
    children: filhos,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log("ok", out, buf.length, "bytes");
});
