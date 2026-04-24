import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT ?? 3010);

// Mapeamento de códigos de versão DWG → rótulo legível
const DWG_VERSION_MAP = {
  AC1006: "AutoCAD R10",
  AC1009: "AutoCAD R11/R12",
  AC1012: "AutoCAD R13",
  AC1014: "AutoCAD R14",
  AC1015: "AutoCAD 2000/2002",
  AC1018: "AutoCAD 2004/2006",
  AC1021: "AutoCAD 2007/2009",
  AC1024: "AutoCAD 2010/2012",
  AC1027: "AutoCAD 2013/2017",
  AC1032: "AutoCAD 2018/2024",
};

// Tokens DWG de formato interno — não são texto útil para a LLM
const DWG_FORMAT_NOISE = new Set([
  "SECTION","ENDSEC","ENTITIES","HEADER","BLOCKS","ENDBLK","TABLES","OBJECTS",
  "CLASSES","THUMBNAILIMAGE","ACDSDATA","ACDSRECORD","ACDSSCHEMA",
  "AcDbEntity","AcDbLine","AcDbArc","AcDbCircle","AcDbText","AcDbMText",
  "AcDbPolyline","AcDbBlockReference","AcDbAttributeDefinition","AcDbAttribute",
  "AcDbBlockTableRecord","AcDbLayerTableRecord","AcDbTextStyleTableRecord",
  "AcDbLinetypeTableRecord","AcDbDimStyleTableRecord","AcDbDimension",
  "AcDbRotatedDimension","AcDbAlignedDimension","AcDbAngularDimension",
  "AcDbHatch","AcDbSolid","AcDbSpline","AcDbEllipse","AcDbViewport",
  "AcDbLayout","AcDbDictionary","AcDbXrecord","AcDbGroup","AcDbImageDef",
  "AcDbRasterVariables","AcDbPlotSettings","AcDbProxyEntity","AcDbMLeader",
  "INSERT","POINT","LINE","LWPOLYLINE","POLYLINE","SPLINE","ELLIPSE","ARC",
  "CIRCLE","SOLID","TRACE","TEXT","MTEXT","ATTRIB","ATTDEF","BLOCK","EOF",
  "MODEL_SPACE","PAPER_SPACE","*MODEL_SPACE","*PAPER_SPACE",
  "Standard","ByLayer","ByBlock","Continuous","STANDARD",
  "bylayer","byblock","continuous","Arial","romans","simplex","txt","monotxt",
  "ACAD","AutoCAD","Autodesk","DWG","DXF","Layout1","Layout2",
]);

function parseDwgHeader(buf) {
  const versionCode = buf.slice(0, 6).toString("ascii");
  const versionLabel = DWG_VERSION_MAP[versionCode] ?? `Versão desconhecida (${versionCode})`;
  const isValidDwg = versionCode.startsWith("AC");
  return { versionCode, versionLabel, isValidDwg };
}

/** Extrai sequências de caracteres ASCII imprimíveis com comprimento mínimo. */
function extractAsciiStrings(buf, minLen = 4) {
  const results = [];
  let start = -1;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    const ok = b >= 0x20 && b < 0x7f;
    if (ok) {
      if (start === -1) start = i;
    } else {
      if (start !== -1 && i - start >= minLen) {
        results.push(buf.slice(start, i).toString("ascii"));
      }
      start = -1;
    }
  }
  if (start !== -1 && buf.length - start >= minLen) {
    results.push(buf.slice(start).toString("ascii"));
  }
  return results;
}

/** Extrai sequências UTF-16LE (texto Unicode em DWG moderno). */
function extractUtf16Strings(buf, minLen = 4) {
  const results = [];
  let start = -1;
  let charCount = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const lo = buf[i];
    const hi = buf[i + 1];
    // Caracteres BMP comuns: ASCII imprimível ou Latin-1 suplementar
    const ok = hi === 0 && lo >= 0x20 && lo < 0x7f;
    if (ok) {
      if (start === -1) start = i;
      charCount++;
    } else {
      if (start !== -1 && charCount >= minLen) {
        results.push(buf.slice(start, start + charCount * 2).toString("utf16le"));
      }
      start = -1;
      charCount = 0;
    }
  }
  if (start !== -1 && charCount >= minLen) {
    results.push(buf.slice(start, start + charCount * 2).toString("utf16le"));
  }
  return results;
}

function isUsefulString(s) {
  const t = s.trim();
  if (!t || t.length < 3) return false;
  // Deve ter pelo menos uma letra
  if (!/[a-zA-ZÀ-ÿÀ-ž]/.test(t)) return false;
  // Descarta puramente numérico (coordenadas, handles, etc.)
  if (/^[\d\s.,;:\-+*/()=]+$/.test(t)) return false;
  // Descarta repetição de mesmo caractere
  if (/^(.)\1{4,}$/.test(t)) return false;
  // Descarta tokens de formato interno DWG
  if (DWG_FORMAT_NOISE.has(t) || DWG_FORMAT_NOISE.has(t.toUpperCase())) return false;
  // Descarta strings que parecem paths de arquivo de sistema
  if (/^[A-Z]:[\\\/]/.test(t)) return false;
  // Descarta tokens que parecem handles ou GUIDs internos
  if (/^[0-9A-F]{8,}$/i.test(t)) return false;
  return true;
}

/** Deduplica mantendo ordem de primeira ocorrência, case-insensitive. */
function dedup(strings) {
  const seen = new Set();
  const out = [];
  for (const s of strings) {
    const key = s.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s.trim());
    }
  }
  return out;
}

/**
 * Classifica strings em prováveis nomes de layer/bloco vs. textos de conteúdo.
 * Layers/blocos: curtos (<=40 chars), sem quebra de linha.
 * Conteúdo: mais longos ou com espaços/pontuação típicos de legenda.
 */
function classifyStrings(strings) {
  const layers = [];
  const content = [];
  for (const s of strings) {
    const t = s.trim();
    if (t.length <= 40 && !t.includes("\n") && /^[\w\s\-_.\/()]+$/.test(t)) {
      layers.push(t);
    } else {
      content.push(t);
    }
  }
  return { layers, content };
}

function buildStructuredText(filename, fileSize, header, layers, content) {
  const kb = (fileSize / 1024).toFixed(1);
  const sections = [
    `Arquivo DWG: ${filename}`,
    `Tamanho: ${kb} KB`,
    `Versão: ${header.versionLabel} (${header.versionCode})`,
  ];

  if (layers.length > 0) {
    sections.push("");
    sections.push(`Layers e blocos identificados (${layers.length}):`);
    for (const l of layers.slice(0, 80)) sections.push(`  • ${l}`);
    if (layers.length > 80) sections.push(`  … e mais ${layers.length - 80} entradas`);
  }

  if (content.length > 0) {
    sections.push("");
    sections.push(`Textos extraídos do desenho (${content.length}):`);
    for (const c of content.slice(0, 150)) sections.push(`  - ${c}`);
    if (content.length > 150) sections.push(`  … e mais ${content.length - 150} textos`);
  }

  return sections.join("\n");
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: "binary-parse" }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/convert") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);

    if (!buf.length) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "empty_body" }));
      return;
    }

    const header = parseDwgHeader(buf);
    if (!header.isValidDwg) {
      res.writeHead(422, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_a_dwg_file", detail: header.versionCode }));
      return;
    }

    // Extrai strings ASCII e UTF-16LE, une, filtra e deduplica
    const ascii = extractAsciiStrings(buf, 4);
    const utf16 = extractUtf16Strings(buf, 4);
    const all = [...ascii, ...utf16].filter(isUsefulString);
    const unique = dedup(all);

    const { layers, content } = classifyStrings(unique);

    // Recupera o nome original do header Content-Disposition, se enviado
    const disposition = req.headers["content-disposition"] ?? "";
    const nameMatch = /filename[^;=\n]*=([^;\n]*)/.exec(disposition);
    const filename = nameMatch ? nameMatch[1].replace(/['"]/g, "").trim() : "arquivo.dwg";

    const text = buildStructuredText(filename, buf.length, header, layers, content);
    const entityCount = layers.length + content.length;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text, entityCount, dwgVersion: header.versionCode }));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[dwg-converter] erro inesperado:", detail);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "internal_error", detail }));
  }
});

server.listen(PORT, () => {
  console.log(`[dwg-converter] modo: parse binário direto (sem dwg2dxf). Porta ${PORT}`);
});
