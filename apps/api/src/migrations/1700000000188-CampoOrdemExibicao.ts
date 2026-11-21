import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Ordem das colunas na tabela das respostas: categorycampos.ordem_exibicao.
 *   1, 2, 3… = posição (menor primeiro); NULL = depois dos numerados, na ordem do campo na categoria;
 *   -1 = não mostra, a não ser que a pergunta cite o campo.
 */
export class CampoOrdemExibicao1700000000188 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categorycampos ADD COLUMN IF NOT EXISTS ordem_exibicao INTEGER NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categorycampos DROP COLUMN IF EXISTS ordem_exibicao`);
  }
}
