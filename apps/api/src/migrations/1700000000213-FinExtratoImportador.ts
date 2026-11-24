import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Importador de extrato (OFX): cada lançamento pode guardar a identificação da linha do banco (chave_externa = FITID)
 * e a conta do extrato — o mesmo arquivo importado de novo não duplica (índice único). Linhas que a pessoa mandou
 * ignorar ficam em fin_extrato_ignorados para não voltarem na próxima importação. A mesma porta servirá para a API
 * (Open Finance), com a chave que o agregador devolver.
 */
export class FinExtratoImportador1700000000213 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE fin_lancamentos ADD COLUMN IF NOT EXISTS chave_externa VARCHAR(120) NULL`);
    await queryRunner.query(
      `ALTER TABLE fin_lancamentos ADD COLUMN IF NOT EXISTS extrato_contaid INT NULL REFERENCES fin_contas(id) ON DELETE SET NULL`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS fin_lancamentos_extrato ON fin_lancamentos (extrato_contaid, chave_externa)
       WHERE extrato_contaid IS NOT NULL AND chave_externa IS NOT NULL`
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fin_extrato_ignorados (
        contaid INT NOT NULL REFERENCES fin_contas(id) ON DELETE CASCADE,
        fitid VARCHAR(120) NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (contaid, fitid)
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS fin_extrato_ignorados`);
    await queryRunner.query(`DROP INDEX IF EXISTS fin_lancamentos_extrato`);
  }
}
