/**
 * Corrige as datas dos memos JÁ existentes: campos de data (categorycampos.tipo = 'date') passam a AAAA-MM-DD.
 *
 *   npm run datas:normalizar --workspace=@mymemory/api                 # SIMULA (não grava nada)
 *   npm run datas:normalizar --workspace=@mymemory/api -- --aplicar    # grava
 *   npm run datas:normalizar --workspace=@mymemory/api -- --grupo 4    # só um grupo
 *
 * Antes de gravar, salva um arquivo normalizar-datas-backup-<data>.jsonl (id + JSON antigo) para desfazer.
 * Só mexe em memos.dadosespecificosjson; o texto, as palavras-chave e os vetores não mudam.
 */
import fs from "node:fs";
import path from "node:path";
import { pool } from "./db.js";
import { normalizarDatasDoJson, type AlteracaoData } from "./services/normalizarDatasMemos.js";
import type { RowDataPacket } from "./lib/dbTypes.js";

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const iGrupo = args.indexOf("--grupo");
const grupoFiltro = iGrupo >= 0 ? Number(args[iGrupo + 1]) : null;
if (iGrupo >= 0 && !Number.isInteger(grupoFiltro)) {
  console.error("Uso: --grupo <id numérico>");
  process.exit(1);
}

async function main() {
  // campos de data por categoria: chave "nome da categoria|grupo" (grupo vazio = categoria global)
  const [campos] = await pool.query<RowDataPacket[]>(
    `SELECT c.name AS "catNome", c.groupid AS "catGrupo", cc.name AS "campo"
     FROM categories c JOIN categorycampos cc ON cc.categoryid = c.id
     WHERE cc.isactive = 1 AND cc.tipo = 'date'`
  );
  const porCategoria = new Map<string, string[]>();
  for (const r of campos) {
    const chave = `${String(r.catNome).toLowerCase()}|${r.catGrupo ?? ""}`;
    porCategoria.set(chave, [...(porCategoria.get(chave) ?? []), String(r.campo)]);
  }
  console.log(`Categorias com campo de data: ${porCategoria.size}`);

  const [memos] = await pool.query<RowDataPacket[]>(
    `SELECT id, groupid AS "grupo", category, dadosespecificosjson AS "dados"
     FROM memos
     WHERE isactive = 1 AND dadosespecificosjson IS NOT NULL AND category IS NOT NULL
       ${grupoFiltro != null ? "AND groupid = ?" : ""}
     ORDER BY id`,
    grupoFiltro != null ? [grupoFiltro] : []
  );

  const mudancas: { id: number; antes: string; depois: string; alteracoes: AlteracaoData[] }[] = [];
  for (const m of memos) {
    const cat = String(m.category).toLowerCase();
    const camposData = [
      ...(porCategoria.get(`${cat}|${m.grupo ?? ""}`) ?? []),
      ...(porCategoria.get(`${cat}|`) ?? []),
    ];
    if (!camposData.length) continue;
    const r = normalizarDatasDoJson(String(m.dados), camposData);
    if (r.json) mudancas.push({ id: Number(m.id), antes: String(m.dados), depois: r.json, alteracoes: r.alteracoes });
  }

  console.log(`Memos analisados: ${memos.length} · com datas a converter: ${mudancas.length}`);
  for (const m of mudancas.slice(0, 10)) {
    console.log(`  memo ${m.id}: ${m.alteracoes.map((a) => `${a.campo} "${a.de}" → ${a.para}`).join("; ")}`);
  }
  if (mudancas.length > 10) console.log(`  … e mais ${mudancas.length - 10}`);

  if (!aplicar) {
    console.log("\nSIMULAÇÃO: nada foi gravado. Rode com --aplicar para gravar.");
    return;
  }
  if (!mudancas.length) return;

  const arquivo = path.resolve(`normalizar-datas-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  fs.writeFileSync(arquivo, mudancas.map((m) => JSON.stringify({ id: m.id, dadosespecificosjson: m.antes })).join("\n") + "\n", "utf8");
  console.log(`Backup salvo em ${arquivo}`);

  for (const m of mudancas) {
    await pool.query(`UPDATE memos SET dadosespecificosjson = ? WHERE id = ?`, [m.depois, m.id]);
  }
  console.log(`Gravado: ${mudancas.length} memo(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
