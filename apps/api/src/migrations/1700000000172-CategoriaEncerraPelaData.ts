import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Categoria atualizável: "Encerra pela data".
 *  - campo_encerra_data = nome de um campo do tipo data. Registro com essa data já passada sai das
 *    respostas da Query padrão, a não ser que a pergunta peça um período (ex.: "reuniões de ontem").
 *    É calculado na consulta: nada é gravado no memo.
 *  - NULL (padrão): sem efeito.
 */
export class CategoriaEncerraPelaData1700000000172 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS campo_encerra_data VARCHAR(255) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS campo_encerra_data`);
  }
}
