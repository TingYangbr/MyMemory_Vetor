import type { MigrationInterface, QueryRunner } from "typeorm";

export class PerguntaModelosAnotacoes1700000000121 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pergunta_modelos
        ADD COLUMN IF NOT EXISTS anotacoes TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pergunta_modelos
        DROP COLUMN IF EXISTS anotacoes
    `);
  }
}
