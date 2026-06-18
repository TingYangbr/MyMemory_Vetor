import type { MigrationInterface, QueryRunner } from "typeorm";

export class DbConnectionIsPrincipal1700000000133 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE db_connections
      ADD COLUMN IF NOT EXISTS isPrincipal TINYINT(1) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE db_connections DROP COLUMN IF EXISTS isPrincipal
    `);
  }
}
