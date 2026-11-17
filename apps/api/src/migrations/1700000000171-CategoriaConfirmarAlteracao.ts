import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Categoria atualizável: "confirmar antes de alterar".
 *  - confirmar_alteracao = 1: alteração pedida em linguagem natural não grava direto; o sistema mostra
 *    o que vai mudar (antes → depois) e só grava depois do "sim" do usuário.
 *  - confirmar_alteracao = 0 (padrão): grava direto, com o Desfazer como proteção (como hoje).
 * Vale só para categorias atualizáveis; em categoria comum o marcador é ignorado.
 */
export class CategoriaConfirmarAlteracao1700000000171 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS confirmar_alteracao SMALLINT NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS confirmar_alteracao`);
  }
}
