import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * categories.campo_dono — em categoria marcada "Pessoal" (meus_por_padrao), o campo do memo que
 * identifica a pessoa dona do memo (e-mail ou nome de um membro do grupo). Usado na importação
 * em lote (manual e automática) para gravar o memo com o dono certo.
 */
export class CampoDonoCategoria1700000000157 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS campo_dono VARCHAR(255) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS campo_dono`);
  }
}
