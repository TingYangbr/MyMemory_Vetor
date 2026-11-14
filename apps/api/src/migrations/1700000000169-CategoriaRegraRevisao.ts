import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Regra da revisão antes de salvar, por categoria (nova tela de revisão):
 *  - revisao_sempre = 1: a revisão sempre abre (categorias críticas, como Contratos).
 *  - revisao_min_pct: % mínimo de campos preenchidos pela IA para gravar direto, sem revisão.
 */
export class CategoriaRegraRevisao1700000000169 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS revisao_sempre SMALLINT NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS revisao_min_pct INTEGER NOT NULL DEFAULT 80`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS revisao_min_pct`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS revisao_sempre`);
  }
}
