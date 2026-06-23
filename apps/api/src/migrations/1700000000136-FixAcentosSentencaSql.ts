import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Corrige literais ->>'Campo' acentuados em queries_categoria.sentencasql
 * e normaliza chaves JSONB acentuadas em memos.dadosespecificosjson.
 * Usa regex JS (imune a problemas de encoding do replace() PostgreSQL).
 * É idempotente: só atualiza linhas que ainda contêm acentos.
 */
export class FixAcentosSentencaSql1700000000136 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    function toAscii(s: string): string {
      return s.normalize("NFD").replace(/\p{Mn}/gu, "");
    }

    // 1. Corrige sentencasql em queries_categoria via regex JS
    const qcRows = (await queryRunner.query(
      `SELECT id, sentencasql FROM queries_categoria`
    )) as { id: number; sentencasql: string }[];

    for (const row of qcRows) {
      const fixed = row.sentencasql.replace(/->>'([^']+)'/g, (_match, key: string) => {
        const ascii = toAscii(key);
        return `->>'${ascii}'`;
      });
      if (fixed !== row.sentencasql) {
        console.log(`[FixAcentosSentencaSql] Atualizando queries_categoria id=${row.id}`);
        await queryRunner.query(
          `UPDATE queries_categoria SET sentencasql = $1, updatedat = NOW() WHERE id = $2`,
          [fixed, row.id]
        );
      }
    }

    // 2. Normaliza chaves JSONB em memos.dadosespecificosjson (idempotente)
    const jsonKeyRows = (await queryRunner.query(`
      SELECT DISTINCT jsonb_object_keys(dadosespecificosjson::jsonb) AS key
      FROM memos
      WHERE dadosespecificosjson IS NOT NULL AND dadosespecificosjson != ''
    `)) as { key: string }[];

    for (const { key } of jsonKeyRows) {
      const ascii = toAscii(key);
      if (ascii !== key) {
        console.log(`[FixAcentosSentencaSql] Renomeando chave JSON "${key}" → "${ascii}"`);
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
          [ascii, key]
        );
      }
    }

    // 3. Normaliza categorycampos.name (idempotente)
    const campoRows = (await queryRunner.query(
      `SELECT DISTINCT name FROM categorycampos`
    )) as { name: string }[];

    for (const { name } of campoRows) {
      const ascii = toAscii(name);
      if (ascii !== name) {
        console.log(`[FixAcentosSentencaSql] categorycampos: "${name}" → "${ascii}"`);
        await queryRunner.query(
          `UPDATE categorycampos SET name = $1, updatedat = NOW() WHERE name = $2`,
          [ascii, name]
        );
      }
    }

    // 4. Normaliza dadosespecificos.label (idempotente)
    const labelRows = (await queryRunner.query(
      `SELECT DISTINCT label FROM dadosespecificos`
    )) as { label: string }[];

    for (const { label } of labelRows) {
      const ascii = toAscii(label);
      if (ascii !== label) {
        console.log(`[FixAcentosSentencaSql] dadosespecificos: "${label}" → "${ascii}"`);
        await queryRunner.query(
          `UPDATE dadosespecificos SET label = $1, updatedat = NOW() WHERE label = $2`,
          [ascii, label]
        );
      }
    }

    console.log("[FixAcentosSentencaSql] Concluído.");
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    console.warn("[FixAcentosSentencaSql] down() não implementado.");
  }
}
