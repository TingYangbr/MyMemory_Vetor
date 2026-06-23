import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Dois problemas corrigidos aqui:
 *
 * 1. sentencasql vulnerável: NULLIF(jsonb->>'Campo','')::numeric falha quando o JSON
 *    armazena "3 suites" em vez de "3". Solução: envolve com REGEXP_REPLACE que extrai
 *    somente dígitos antes do cast.
 *
 * 2. Dados existentes: normaliza valores JSON que deveriam ser numéricos mas contêm texto
 *    (ex: "1 suite" → "1", "2 suítes" → "2"). Detecta os campos numéricos lendo o próprio
 *    sentencasql (padrão NULLIF(jsonb->>'Campo','')::numeric).
 */
export class FixNumericJsonValues1700000000137 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Atualiza sentencasql: substitui NULLIF(jsonb->>'X','')::numeric
    //    por NULLIF(REGEXP_REPLACE(COALESCE(jsonb->>'X',''),'[^0-9]','','g'),'')::numeric
    const qcRows = (await queryRunner.query(
      `SELECT id, sentencasql FROM queries_categoria`
    )) as { id: number; sentencasql: string }[];

    const numericKeys = new Set<string>();

    for (const row of qcRows) {
      const fixed = row.sentencasql.replace(
        /NULLIF\(m\.dadosespecificosjson::jsonb->>'([^']+)',\s*''\)::numeric/g,
        (_match, key: string) => {
          numericKeys.add(key);
          return `NULLIF(REGEXP_REPLACE(COALESCE(m.dadosespecificosjson::jsonb->>'${key}',''),'[^0-9]','','g'),'')::numeric`;
        }
      );
      if (fixed !== row.sentencasql) {
        console.log(`[FixNumericJsonValues] Atualizando sentencasql id=${row.id}`);
        await queryRunner.query(
          `UPDATE queries_categoria SET sentencasql = $1, updatedat = NOW() WHERE id = $2`,
          [fixed, row.id]
        );
      }
    }

    // 2. Limpa valores JSON existentes que têm texto junto com o número.
    //    Usa ->>$1::text (operador binário) para passar a chave como parâmetro.
    //    Ex: "3 suites" → "3", "1 suite" → "1", "2 suítes" → "2"
    for (const key of numericKeys) {
      console.log(`[FixNumericJsonValues] Normalizando valores de "${key}" nos memos`);
      await queryRunner.query(
        `UPDATE memos
         SET dadosespecificosjson = (
           dadosespecificosjson::jsonb
           - $1::text
           || jsonb_build_object(
                $1::text,
                REGEXP_REPLACE(COALESCE(dadosespecificosjson::jsonb->>$1::text, ''), '[^0-9]', '', 'g')
              )
         )::text,
         updatedat = NOW()
         WHERE dadosespecificosjson IS NOT NULL
           AND dadosespecificosjson != ''
           AND dadosespecificosjson::jsonb ? $1::text
           AND (dadosespecificosjson::jsonb->>$1::text) ~ '[^0-9]'
           AND (dadosespecificosjson::jsonb->>$1::text) != ''`,
        [key]
      );
    }

    if (numericKeys.size === 0) {
      console.log("[FixNumericJsonValues] Nenhum campo numérico encontrado em sentencasql.");
    } else {
      console.log(`[FixNumericJsonValues] Concluído. Campos: ${[...numericKeys].join(", ")}`);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    console.warn("[FixNumericJsonValues] down() não implementado.");
  }
}
