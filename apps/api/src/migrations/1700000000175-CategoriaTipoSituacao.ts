import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Situação em um vocabulário só (Pendente/Válido, Concluído, Cancelado):
 *  - categories.situacao_tipo = 'afazer' (Pendente · Concluído · Cancelado) ou 'registro' (Válido · Cancelado);
 *  - categories.rotulo_concluido = nome do Concluído na tela da categoria (Comprado, Pago, Realizado).
 * Campo de situação com os padrões antigos (Ativo, Concluído, Cancelado) passa para Pendente, Concluído, Cancelado.
 * Os memos com "Ativo" continuam valendo como Pendente (a regra de aberto/encerrado olha conclu…/cancel…).
 */
export class CategoriaTipoSituacao1700000000175 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE categories ADD COLUMN IF NOT EXISTS situacao_tipo VARCHAR(20) NOT NULL DEFAULT 'afazer'`
    );
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS rotulo_concluido VARCHAR(40) NULL`);
    await queryRunner.query(`
      UPDATE categorycampos cc SET normalizedterms = 'Pendente, Concluído, Cancelado'
      FROM categories c
      WHERE c.id = cc.categoryid AND c.campo_situacao = cc.name
        AND lower(unaccent(COALESCE(cc.normalizedterms, ''))) = 'ativo, concluido, cancelado'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS rotulo_concluido`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS situacao_tipo`);
  }
}
