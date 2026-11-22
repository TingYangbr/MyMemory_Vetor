import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Ajustes do Fale comigo → financeiro por espaço ("g:<groupId>" ou "u:<userId>" no pessoal):
 * gravar direto quando o cartão vem completo, e permitir cadastrar grupo de despesa/receita ou conta/cartão pelo cartão.
 */
export class FinConfig1700000000195 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fin_config (
        espaco VARCHAR(30) PRIMARY KEY,
        gravar_direto SMALLINT NOT NULL DEFAULT 0,
        criar_grupo SMALLINT NOT NULL DEFAULT 0,
        criar_conta SMALLINT NOT NULL DEFAULT 0,
        updatedat TIMESTAMP NOT NULL DEFAULT NOW()
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS fin_config`);
  }
}
