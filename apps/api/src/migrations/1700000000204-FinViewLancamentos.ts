import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS, SQL_LANCAMENTOS_SEM_VIEW, SQL_VIEW_FIN_LANCAMENTOS } from "../services/finConsultas.js";

/**
 * View fin_v_lancamentos (entradas e saídas, como a ia_FaturamentoProduto do ERP) e a consulta "Lançamentos (entradas e
 * saídas)" passa a ler dela com um SELECT simples. O recorte do espaço está dentro da view (mm_ctx_*).
 */
const NOME = "Financeiro — Lançamentos (entradas e saídas)";

export class FinViewLancamentos1700000000204 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const def = FIN_CONSULTAS.find((q) => q.nome === NOME);
    if (!def) return;
    // Falha ao criar a view não pode impedir a API de subir: volta ao savepoint e a consulta fica sem a view
    await queryRunner.query(`SAVEPOINT fin_view`);
    try {
      await queryRunner.query(SQL_VIEW_FIN_LANCAMENTOS);
      await queryRunner.query(`GRANT SELECT ON public.fin_v_lancamentos TO mm_query_reader`);
      await queryRunner.query(`RELEASE SAVEPOINT fin_view`);
    } catch (err) {
      await queryRunner.query(`ROLLBACK TO SAVEPOINT fin_view`);
      console.error("[migration 204] view fin_v_lancamentos não criada; a consulta fica sem a view:", err instanceof Error ? err.message : err);
      await queryRunner.query(
        `UPDATE queries_categoria SET sentencasql = $1, updatedat = NOW() WHERE nome = $2 AND conexaoid IS NULL AND isactive = 1`,
        [SQL_LANCAMENTOS_SEM_VIEW, NOME]
      );
      return;
    }
    await queryRunner.query(
      `UPDATE queries_categoria SET sentencasql = $1, descricao = $2, updatedat = NOW()
       WHERE nome = $3 AND conexaoid IS NULL AND isactive = 1 AND sentencasql NOT ILIKE '%fin_v_lancamentos%'`,
      [def.sql, def.descricao, NOME]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS public.fin_v_lancamentos`);
  }
}
