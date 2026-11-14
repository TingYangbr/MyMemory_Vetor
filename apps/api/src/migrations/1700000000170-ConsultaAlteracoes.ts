import type { MigrationInterface, QueryRunner } from "typeorm";
import { gerarQueryAlteracoesMemos, queryAlteracoesDescricao, queryAlteracoesNome, type QueryPadraoCampo } from "@mymemory/shared";

/**
 * Perguntar sobre remarcações ("o que foi remarcado esta semana?"):
 *  - queries_categoria.autotipo — tipo da consulta mantida pelo sistema: 'padrao' (Query padrão) ou
 *    'alteracoes' (Consulta de alterações). Antes só existia a padrão, identificada por sqlgerado.
 *  - memo_alteracoes passa a ser lida pelas queries de categoria (papel mm_query_reader), com o mesmo
 *    recorte por grupo dos memos: a policy só mostra alterações de memos que o papel enxerga.
 *  - Backfill: cada categoria atualizável ativa ganha a Consulta de alterações automática.
 */
export class ConsultaAlteracoes1700000000170 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE queries_categoria ADD COLUMN IF NOT EXISTS autotipo VARCHAR(20) NULL`);
    await queryRunner.query(`UPDATE queries_categoria SET autotipo = 'padrao' WHERE sqlgerado IS NOT NULL AND autotipo IS NULL`);

    await queryRunner.query(`GRANT SELECT ON memo_alteracoes TO mm_query_reader`);
    await queryRunner.query(`ALTER TABLE memo_alteracoes ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS mm_app_all ON memo_alteracoes`);
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format('CREATE POLICY mm_app_all ON memo_alteracoes FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
      END $$;
    `);
    // Herda o recorte de memos: a subconsulta também passa pela RLS de memos
    await queryRunner.query(`DROP POLICY IF EXISTS mm_query_reader_grupo ON memo_alteracoes`);
    await queryRunner.query(`
      CREATE POLICY mm_query_reader_grupo ON memo_alteracoes FOR SELECT TO mm_query_reader
      USING (EXISTS (SELECT 1 FROM memos mm WHERE mm.id = memo_alteracoes.memoid))
    `);

    const cats = (await queryRunner.query(
      `SELECT c.id, c.name FROM categories c
       WHERE c.isactive = 1 AND c.atualizavel = 1
         AND NOT EXISTS (SELECT 1 FROM queries_categoria q WHERE q.categoryid = c.id AND q.autotipo = 'alteracoes')`
    )) as { id: number; name: string }[];
    for (const cat of cats) {
      const campos = (await queryRunner.query(
        `SELECT id, name, tipo, normalizedterms AS "normalizedTerms", isactive AS "isActive"
         FROM categorycampos WHERE categoryid = $1 AND isactive = 1 ORDER BY id ASC`,
        [cat.id]
      )) as QueryPadraoCampo[];
      const g = gerarQueryAlteracoesMemos(cat.name, campos);
      const ins = (await queryRunner.query(
        `INSERT INTO queries_categoria (categoryid, nome, descricao, sentencasql, sqlgerado, autotipo, conexaoid, isactive)
         VALUES ($1, $2, $3, $4, $4, 'alteracoes', NULL, 1) RETURNING id`,
        [cat.id, queryAlteracoesNome(cat.name), queryAlteracoesDescricao(cat.name), g.sql]
      )) as { id: number }[];
      for (const p of g.params) {
        await queryRunner.query(
          `INSERT INTO queries_categoria_params (queryid, campo, tipo, obrigatorio, operadorsql, normalizar, ordem, isactive)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
          [ins[0].id, p.campo, p.tipo, p.obrigatorio, p.operadorSql, p.normalizar, p.ordem]
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE queries_categoria SET isactive = 0 WHERE autotipo = 'alteracoes'`);
    await queryRunner.query(`DROP POLICY IF EXISTS mm_query_reader_grupo ON memo_alteracoes`);
    await queryRunner.query(`DROP POLICY IF EXISTS mm_app_all ON memo_alteracoes`);
    await queryRunner.query(`ALTER TABLE memo_alteracoes DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`REVOKE SELECT ON memo_alteracoes FROM mm_query_reader`);
    await queryRunner.query(`ALTER TABLE queries_categoria DROP COLUMN IF EXISTS autotipo`);
  }
}
