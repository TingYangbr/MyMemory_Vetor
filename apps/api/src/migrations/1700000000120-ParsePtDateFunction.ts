import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Cria função auxiliar `mymemory_parse_date(text) RETURNS date` que converte
 * os 3 formatos de data usados no sistema para o tipo date do PostgreSQL:
 *   - ISO: YYYY-MM-DD
 *   - Brasileiro: DD/MM/YYYY
 *   - Português por extenso: D de mês de YYYY (ex: "3 de maio de 2026")
 * Retorna NULL para formatos desconhecidos ou em caso de erro — sem lançar exceção.
 * Usada pelo DATE_TRUNC em group_by_trunc para perguntas com agregação mensal/anual.
 */
export class ParsePtDateFunction1700000000120 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION mymemory_parse_date(v_text text) RETURNS date AS $$
      DECLARE
        v_match text[];
        v_month int;
        v_month_map text[] := ARRAY[
          'janeiro','fevereiro','março','abril','maio','junho',
          'julho','agosto','setembro','outubro','novembro','dezembro'
        ];
      BEGIN
        IF v_text IS NULL OR trim(v_text) = '' THEN
          RETURN NULL;
        END IF;
        v_text := trim(v_text);

        -- ISO: YYYY-MM-DD
        IF v_text ~ '^\\d{4}-\\d{2}-\\d{2}' THEN
          RETURN substring(v_text, 1, 10)::date;
        END IF;

        -- Brasileiro: DD/MM/YYYY
        IF v_text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN
          RETURN TO_DATE(v_text, 'DD/MM/YYYY');
        END IF;

        -- Português por extenso: D de mês de YYYY
        v_match := regexp_match(v_text, '^(\\d{1,2}) de (\\w+) de (\\d{4})$', 'i');
        IF v_match IS NOT NULL THEN
          v_month := array_position(v_month_map, lower(v_match[2]));
          IF v_month IS NOT NULL THEN
            RETURN make_date(v_match[3]::int, v_month, v_match[1]::int);
          END IF;
        END IF;

        RETURN NULL;
      EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS mymemory_parse_date(text)`);
  }
}
