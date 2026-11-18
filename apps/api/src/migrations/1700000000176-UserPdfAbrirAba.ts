import type { MigrationInterface, QueryRunner } from "typeorm";

/** Preferência do usuário: o botão PDF das respostas abre o PDF numa aba (1) ou baixa o arquivo (0). */
export class UserPdfAbrirAba1700000000176 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pdf_abrir_aba SMALLINT NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS pdf_abrir_aba`);
  }
}
