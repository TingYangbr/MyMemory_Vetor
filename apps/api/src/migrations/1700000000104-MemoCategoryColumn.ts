import type { MigrationInterface, QueryRunner } from "typeorm";

export class MemoCategoryColumn1700000000104 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE memos ADD COLUMN IF NOT EXISTS category TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE memos DROP COLUMN IF EXISTS category
    `);
  }
}
