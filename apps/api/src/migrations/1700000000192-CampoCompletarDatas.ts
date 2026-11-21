import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Campo de data com "mostrar dias sem registro": categorycampos.completar_datas (0/1). Na tabela e no gráfico das
 * respostas entram também os dias sem memo, do início ao fim do período da pergunta (ou do primeiro ao último dia
 * encontrado), em ordem crescente. Os dias são gerados no código — não precisa de tabela de calendário.
 */
export class CampoCompletarDatas1700000000192 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categorycampos ADD COLUMN IF NOT EXISTS completar_datas SMALLINT NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categorycampos DROP COLUMN IF EXISTS completar_datas`);
  }
}
