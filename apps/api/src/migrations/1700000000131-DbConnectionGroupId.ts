import type { MigrationInterface, QueryRunner } from "typeorm";

export class DbConnectionGroupId1700000000131 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE db_connections
      ADD COLUMN IF NOT EXISTS groupid INT NULL REFERENCES groups(id) ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE db_connections DROP COLUMN IF EXISTS groupid
    `);
  }
}
