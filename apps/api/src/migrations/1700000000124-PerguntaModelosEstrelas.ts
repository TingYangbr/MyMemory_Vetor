import type { MigrationInterface, QueryRunner } from "typeorm";

export class PerguntaModelosEstrelas1700000000124 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pergunta_modelos
        ADD COLUMN IF NOT EXISTS estrelas SMALLINT NULL CHECK (estrelas BETWEEN 1 AND 5)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pergunta_modelos
        DROP COLUMN IF EXISTS estrelas
    `);
  }
}
