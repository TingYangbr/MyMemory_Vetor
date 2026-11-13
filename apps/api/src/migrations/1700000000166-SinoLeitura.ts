import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Sino do cabeçalho: guarda quando cada usuário abriu o painel pela última vez.
 * Avisos registrados depois disso contam como "não lidos". Tabela nova; nada existente muda.
 */
export class SinoLeitura1700000000166 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sino_leitura (
        userid   INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        lido_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sino_leitura`);
  }
}
