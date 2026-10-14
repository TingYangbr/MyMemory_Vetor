import type { MigrationInterface, QueryRunner } from "typeorm";
import { gerarQueryPadraoMemos, type QueryPadraoCampo } from "@mymemory/shared";

/**
 * mymemory_parse_number(text) — converte o texto de um campo numérico dos memos em número sem
 * quebrar a query. Antes a Query padrão fazia `(campo)::numeric` e qualquer valor como "4 horas"
 * derrubava a pergunta com "invalid input syntax for type numeric".
 *
 * - Duração (tem h/hora/min ou formato 1:30) → HORAS: "4 horas" = 4, "1h30" = 1.5,
 *   "uma hora e meia" = 1.5, "90 minutos" = 1.5, "meia hora" = 0.5.
 * - Outros números: primeiro número do texto, aceitando vírgula decimal e milhar com ponto
 *   ("R$ 1.500,25" = 1500.25, "3 quartos" = 3).
 * - Sem número → NULL (o registro só não entra em filtros de faixa).
 *
 * Também troca `(expr)::numeric` por `mymemory_parse_number(expr)` nas queries internas
 * (Query padrão automáticas e editadas) — para números puros o resultado é o mesmo.
 */
export const SQL_PARSE_NUMBER = `
CREATE OR REPLACE FUNCTION mymemory_parse_number(v_text text) RETURNS numeric AS $$
DECLARE
  t   text;
  h   numeric;
  mt  text[];
  num text;
BEGIN
  IF v_text IS NULL THEN RETURN NULL; END IF;
  t := lower(btrim(v_text));
  IF t = '' THEN RETURN NULL; END IF;

  -- Duração no formato 1h30 / 1:30 / 01:30:00
  mt := regexp_match(t, '^(\\d{1,3})\\s*(?:h|:)\\s*(\\d{1,2})(?::\\d{2})?\\s*(?:min|m)?$');
  IF mt IS NOT NULL THEN
    RETURN round(mt[1]::numeric + mt[2]::numeric / 60, 4);
  END IF;

  -- Duração por extenso: horas, minutos, "e meia", "meia hora"
  IF t ~ '(\\d|\\muma?\\M|\\mmeia\\M)\\s*(h\\M|hrs?\\M|horas?\\M)' OR t ~ '\\d\\s*(min\\M|mins\\M|minutos?\\M)' THEN
    h := 0;
    mt := regexp_match(t, '(\\d+(?:[.,]\\d+)?)\\s*(?:h\\M|hrs?\\M|horas?\\M)');
    IF mt IS NOT NULL THEN
      h := replace(mt[1], ',', '.')::numeric;
    ELSIF t ~ '\\muma?\\s+hora' THEN
      h := 1;
    END IF;
    IF t ~ '\\me\\s+meia\\M' OR t ~ '\\mmeia\\s+hora' THEN
      h := h + 0.5;
    END IF;
    mt := regexp_match(t, '(\\d+)\\s*(?:min\\M|mins\\M|minutos?\\M)');
    IF mt IS NOT NULL THEN
      h := h + mt[1]::numeric / 60;
    END IF;
    RETURN round(h, 4);
  END IF;

  -- Número genérico: primeiro número do texto
  num := substring(t from '-?\\d[\\d.,]*');
  IF num IS NULL THEN RETURN NULL; END IF;
  num := rtrim(num, '.,');
  IF num ~ ',' AND num ~ '\\.' THEN
    num := replace(replace(num, '.', ''), ',', '.');
  ELSIF num ~ ',' THEN
    num := replace(num, ',', '.');
  ELSIF num ~ '^-?\\d{1,3}(\\.\\d{3})+$' THEN
    num := replace(num, '.', '');
  END IF;
  BEGIN
    RETURN num::numeric;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
`;

/** `(m.dadosespecificosjson::jsonb->>'X')::numeric` → `mymemory_parse_number(m.dadosespecificosjson::jsonb->>'X')` */
export function trocarCastNumeric(sql: string): string {
  return sql.replace(/\((m\.dadosespecificosjson::jsonb->>'[^']*')\)::numeric/g, "mymemory_parse_number($1)");
}

export class ParseNumberTolerante1700000000153 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(SQL_PARSE_NUMBER);
    // Função usada pelas queries de categoria, que rodam com o papel restrito
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mm_query_reader') THEN
          GRANT EXECUTE ON FUNCTION mymemory_parse_number(text) TO mm_query_reader;
        END IF;
      END $$;
    `);

    const queries = (await queryRunner.query(
      `SELECT q.id, q.categoryid, q.sentencasql, q.sqlgerado, c.name AS categoria
       FROM queries_categoria q
       JOIN categories c ON c.id = q.categoryid
       WHERE q.conexaoid IS NULL AND q.sentencasql LIKE '%)::numeric%'`
    )) as { id: number; categoryid: number; sentencasql: string; sqlgerado: string | null; categoria: string }[];

    for (const q of queries) {
      const automatica = q.sqlgerado != null && q.sentencasql === q.sqlgerado;
      if (automatica) {
        // Query padrão automática: regera com o gerador atual (mesmo texto que o backend produz)
        const campos = (await queryRunner.query(
          `SELECT id, name, tipo, normalizedterms AS "normalizedTerms", isactive AS "isActive"
           FROM categorycampos WHERE categoryid = $1 AND isactive = 1 ORDER BY id ASC`,
          [q.categoryid]
        )) as QueryPadraoCampo[];
        const gerado = gerarQueryPadraoMemos(q.categoria, campos).sql;
        await queryRunner.query(`UPDATE queries_categoria SET sentencasql = $1, sqlgerado = $1 WHERE id = $2`, [gerado, q.id]);
      } else {
        const novo = trocarCastNumeric(q.sentencasql);
        if (novo !== q.sentencasql) {
          await queryRunner.query(`UPDATE queries_categoria SET sentencasql = $1 WHERE id = $2`, [novo, q.id]);
        }
      }
    }
  }

  public async down(): Promise<void> {
    // Mantém a função: queries já reescritas dependem dela
  }
}
