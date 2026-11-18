import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Tipo de campo "status": valores fixos (nos padrões do campo) e verbos que levam a cada valor.
 *  - categorycampos.verbos = uma linha por valor, "Baixado: pagar, paguei, quitar".
 */
export class CampoStatusVerbos1700000000174 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categorycampos ADD COLUMN IF NOT EXISTS verbos TEXT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categorycampos DROP COLUMN IF EXISTS verbos`);
  }
}
