import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Lista aberta única (ex.: Lista de compras): categories.lista_aberta_por.
 *   NULL = cada registro cria uma lista nova (como era);
 *   '*'  = uma lista aberta só: registrar itens acrescenta nela;
 *   nome de um campo (ex.: 'Tipo') = uma lista aberta por valor desse campo (Mercado, Farmácia…).
 * A lista sai de "aberta" quando é concluída ou cancelada; aí o próximo registro abre outra.
 */
export class ListaAbertaPor1700000000187 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS lista_aberta_por VARCHAR(120) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS lista_aberta_por`);
  }
}
