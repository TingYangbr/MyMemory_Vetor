import type { MigrationInterface, QueryRunner } from "typeorm";

export class CampoTipo1700000000134 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE categorycampos
      ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'text'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE categorycampos DROP COLUMN IF EXISTS tipo
    `);
  }
}
