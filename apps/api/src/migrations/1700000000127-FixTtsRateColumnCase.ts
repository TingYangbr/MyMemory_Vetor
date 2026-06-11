import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Corrige coluna criada com aspas ("ttsRate") na migration 126 — renomeia para ttsrate
 * (lowercase sem aspas), padrão de todos os outros campos do schema.
 * Se já existe ttsrate (lowercase), não faz nada. Se não existe nenhuma das duas, cria ttsrate.
 */
export class FixTtsRateColumnCase1700000000127 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'ttsRate'
        ) THEN
          ALTER TABLE users RENAME COLUMN "ttsRate" TO ttsrate;
        ELSIF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'ttsrate'
        ) THEN
          ALTER TABLE users ADD COLUMN ttsrate FLOAT DEFAULT NULL;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS ttsrate`);
  }
}
