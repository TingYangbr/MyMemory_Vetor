import type { MigrationInterface, QueryRunner } from "typeorm";

export class CampoResolucaoNomeAbrev1700000000132 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE categorycampos
      ADD COLUMN IF NOT EXISTS resolucaoNomeAbrev TINYINT(1) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE categorycampos DROP COLUMN IF EXISTS resolucaoNomeAbrev
    `);
  }
}
