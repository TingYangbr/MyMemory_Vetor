import type { MigrationInterface, QueryRunner } from "typeorm";

export class AvisoTextoInicial1700000000130 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE avisos
      ADD COLUMN IF NOT EXISTS textorespostainicial TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE avisos DROP COLUMN IF EXISTS textorespostainicial
    `);
  }
}
