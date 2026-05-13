import type { MigrationInterface, QueryRunner } from "typeorm";

export class BatchImportStorageProvider1700000000119 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE memos
        ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(30) NOT NULL DEFAULT 'S3',
        ADD COLUMN IF NOT EXISTS original_file_name VARCHAR(255) NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_memos_original_file_name
        ON memos (userid, original_file_name)
        WHERE original_file_name IS NOT NULL AND isactive = 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_memos_original_file_name`);
    await queryRunner.query(`
      ALTER TABLE memos
        DROP COLUMN IF EXISTS storage_provider,
        DROP COLUMN IF EXISTS original_file_name
    `);
  }
}
