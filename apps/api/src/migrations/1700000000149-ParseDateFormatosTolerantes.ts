import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * mymemory_parse_date mais tolerante aos formatos que a IA de extração grava nos campos de data:
 *   - ano primeiro com "-", "/" ou "."   → 2026-10-04, 2026/10/04, 2026.10.4 (antes só YYYY-MM-DD)
 *   - dia primeiro com "/", "-" ou "."   → 04/10/2026, 4-10-2026 (antes só DD/MM/YYYY exato)
 *   - por extenso em qualquer posição    → "domingo, 4 de outubro de 2026", "4 de marco de 2026"
 * Em todos, texto depois da data é ignorado ("2026/10/04 - sabado", "04/10/2026 domingo").
 * Motivo: memo de Agenda com "2026/10/04 - sabado" ficava fora do filtro "compromissos de outubro".
 * Continua retornando NULL (sem exceção) para formato desconhecido ou data inválida.
 */
const FUNCAO_NOVA = `
  CREATE OR REPLACE FUNCTION mymemory_parse_date(v_text text) RETURNS date AS $$
  DECLARE
    v_match text[];
    v_month int;
    v_month_map text[] := ARRAY[
      'janeiro','fevereiro','marco','abril','maio','junho',
      'julho','agosto','setembro','outubro','novembro','dezembro'
    ];
  BEGIN
    IF v_text IS NULL OR trim(v_text) = '' THEN
      RETURN NULL;
    END IF;
    v_text := trim(v_text);

    -- Ano primeiro: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD (mês/dia com 1 ou 2 dígitos)
    v_match := regexp_match(v_text, '^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})');
    IF v_match IS NOT NULL THEN
      RETURN make_date(v_match[1]::int, v_match[2]::int, v_match[3]::int);
    END IF;

    -- Dia primeiro (brasileiro): DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
    v_match := regexp_match(v_text, '^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4})');
    IF v_match IS NOT NULL THEN
      RETURN make_date(v_match[3]::int, v_match[2]::int, v_match[1]::int);
    END IF;

    -- Por extenso, em qualquer posição: "4 de outubro de 2026", "domingo, 4 de março de 2026"
    v_match := regexp_match(lower(v_text), '(\\d{1,2})\\s+de\\s+([a-zç]+)\\s+de\\s+(\\d{4})');
    IF v_match IS NOT NULL THEN
      v_month := array_position(v_month_map, replace(v_match[2], 'ç', 'c'));
      IF v_month IS NOT NULL THEN
        RETURN make_date(v_match[3]::int, v_month, v_match[1]::int);
      END IF;
    END IF;

    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  $$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;
`;

/** Definição da migration 1700000000120, para o down(). */
const FUNCAO_ANTERIOR = `
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
    IF v_text ~ '^\\d{4}-\\d{2}-\\d{2}' THEN
      RETURN substring(v_text, 1, 10)::date;
    END IF;
    IF v_text ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN
      RETURN TO_DATE(v_text, 'DD/MM/YYYY');
    END IF;
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
`;

export class ParseDateFormatosTolerantes1700000000149 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(FUNCAO_NOVA);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(FUNCAO_ANTERIOR);
  }
}
