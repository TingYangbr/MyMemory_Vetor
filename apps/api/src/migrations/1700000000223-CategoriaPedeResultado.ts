import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * "Pedir o resultado depois da data" vira característica da categoria (não só da Agenda): o sino junta numa aba só
 * ("Resultados") os registros de todas as categorias com a opção ligada (Agenda, To-do List…), com a etiqueta da
 * categoria. Para não mudar o que já está no ar, liga nas categorias que têm lembrete ativo hoje (a Agenda).
 */
export class CategoriaPedeResultado1700000000223 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS pede_resultado SMALLINT NOT NULL DEFAULT 0`);
    await queryRunner.query(
      `UPDATE categories SET pede_resultado = 1
       WHERE isactive = 1 AND id IN (SELECT categoryid FROM lembrete_regras WHERE ativo = 1 AND origem = 'memos')`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS pede_resultado`);
  }
}
