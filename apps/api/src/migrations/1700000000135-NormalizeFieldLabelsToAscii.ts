import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Normaliza nomes de campos de categoria para ASCII puro.
 * Remove acentos de: categorycampos.name, dadosespecificos.label,
 * chaves de memos.dadosespecificosjson e literais ->>'Campo' em queries_categoria.sentencasql.
 *
 * Exemplos: "Suítes" → "Suites", "região" → "regiao", "Intenção" → "Intencao",
 *           "situação financeiro" → "situacao financeiro", "Área" → "Area"
 */
export class NormalizeFieldLabelsToAscii1700000000135 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    function toAscii(s: string): string {
      return s.normalize("NFD").replace(/\p{Mn}/gu, "");
    }

    // Coleta todos os nomes distintos de campos (categorycampos + dadosespecificos)
    const campoRows = (await queryRunner.query(
      `SELECT DISTINCT name FROM categorycampos`
    )) as { name: string }[];
    const labelRows = (await queryRunner.query(
      `SELECT DISTINCT label FROM dadosespecificos`
    )) as { label: string }[];

    const allNames = new Set<string>([
      ...campoRows.map((r) => r.name),
      ...labelRows.map((r) => r.label),
    ]);

    // Filtra apenas nomes que mudam após normalização
    const mapping: Array<{ old: string; ascii: string }> = [];
    for (const name of allNames) {
      const ascii = toAscii(name);
      if (ascii !== name) {
        mapping.push({ old: name, ascii });
      }
    }

    if (mapping.length === 0) {
      console.log("[NormalizeFieldLabelsToAscii] Nenhum campo com acento encontrado.");
      return;
    }

    console.log(`[NormalizeFieldLabelsToAscii] Normalizando ${mapping.length} campo(s):`);
    for (const { old, ascii } of mapping) {
      console.log(`  "${old}" → "${ascii}"`);
    }

    for (const { old, ascii } of mapping) {
      // 1. categorycampos.name
      await queryRunner.query(
        `UPDATE categorycampos SET name = $1, updatedat = NOW() WHERE name = $2`,
        [ascii, old]
      );

      // 2. dadosespecificos.label
      await queryRunner.query(
        `UPDATE dadosespecificos SET label = $1, updatedat = NOW() WHERE label = $2`,
        [ascii, old]
      );

      // 3. Chaves JSON em memos.dadosespecificosjson
      // Usa -> (retorna JSONB) em vez de ->> (TEXT) para preservar tipos JSON (incluindo null)
      await queryRunner.query(
        `UPDATE memos
         SET dadosespecificosjson = (
           dadosespecificosjson::jsonb
           - $2::text
           || jsonb_build_object($1::text, dadosespecificosjson::jsonb->$2::text)
         )::text,
         updatedat = NOW()
         WHERE dadosespecificosjson IS NOT NULL
           AND dadosespecificosjson != ''
           AND dadosespecificosjson::jsonb ? $2::text`,
        [ascii, old]
      );

      // 4. Literais ->>'Campo' em queries_categoria.sentencasql
      const oldLiteral = `->>'${old}'`;
      const newLiteral = `->>'${ascii}'`;
      await queryRunner.query(
        `UPDATE queries_categoria
         SET sentencasql = replace(sentencasql, $1, $2),
             updatedat = NOW()
         WHERE sentencasql LIKE $3`,
        [oldLiteral, newLiteral, `%${oldLiteral}%`]
      );
    }

    console.log("[NormalizeFieldLabelsToAscii] Concluído.");
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Reversão não implementada: restaurar acentos exigiria o mapeamento inverso
    // e poderia conflitar com dados inseridos após a migration.
    console.warn("[NormalizeFieldLabelsToAscii] down() não implementado — migration irreversível.");
  }
}
