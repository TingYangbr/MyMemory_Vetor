import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Perguntas salvas fixadas no Perguntar (atalhos), por usuário.
 * Tabela nova; nada existente muda.
 */
export class PerguntaFixadas1700000000167 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pergunta_fixadas (
        userid    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        modeloid  INT NOT NULL REFERENCES pergunta_modelos(id) ON DELETE CASCADE,
        createdat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (userid, modeloid)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS pergunta_fixadas`);
  }
}
