import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Parcelado / a prazo em regime de caixa: fin_titulos.caixa = 1 nos títulos novos — não há lançamento na data da
 * compra; a despesa/receita entra parcela a parcela, no pagamento (conta → grupo). Os títulos existentes ficam com 0
 * (competência: registro contra a pagar/a receber, pagamento baixa a pagar/a receber) e continuam como estão.
 */
export class FinTituloCaixa1700000000209 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE fin_titulos ADD COLUMN IF NOT EXISTS caixa SMALLINT NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE fin_titulos DROP COLUMN IF EXISTS caixa`);
  }
}
