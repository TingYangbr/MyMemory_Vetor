import type { MigrationInterface, QueryRunner } from "typeorm";
import { gerarQueryPadraoMemos, type QueryPadraoCampo } from "@mymemory/shared";

/**
 * queries_categoria.sqlgerado — último SQL gerado automaticamente para a Query padrão da categoria.
 * Enquanto sentencasql = sqlgerado a query é "automática" e o backend a regera quando a categoria ou
 * os campos mudam (sincronizarQueryPadrao). Se o usuário editar à mão, os textos divergem e a query
 * deixa de ser tocada.
 *
 * Backfill: Query padrão existentes (conexão interna) cujo SQL ainda é idêntico ao que o gerador
 * produz hoje para os campos da categoria → nunca foram editadas → passam a ser automáticas.
 * As editadas (SQL diferente) ficam como estão.
 */
export class QueryPadraoAutomatica1700000000150 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE queries_categoria ADD COLUMN IF NOT EXISTS sqlgerado TEXT NULL`);

    const queries = (await queryRunner.query(
      `SELECT q.id, q.categoryid, q.sentencasql, c.name AS categoria
       FROM queries_categoria q
       JOIN categories c ON c.id = q.categoryid
       WHERE q.isactive = 1 AND q.conexaoid IS NULL AND q.sqlgerado IS NULL
         AND q.nome LIKE 'Query padrão — %'`
    )) as { id: number; categoryid: number; sentencasql: string; categoria: string }[];

    for (const q of queries) {
      const campos = (await queryRunner.query(
        `SELECT id, name, tipo, normalizedterms AS "normalizedTerms", isactive AS "isActive"
         FROM categorycampos WHERE categoryid = $1 AND isactive = 1 ORDER BY id ASC`,
        [q.categoryid]
      )) as QueryPadraoCampo[];
      const gerado = gerarQueryPadraoMemos(q.categoria, campos);
      if (q.sentencasql.trim() === gerado.sql) {
        await queryRunner.query(`UPDATE queries_categoria SET sqlgerado = $1 WHERE id = $2`, [gerado.sql, q.id]);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE queries_categoria DROP COLUMN IF EXISTS sqlgerado`);
  }
}
