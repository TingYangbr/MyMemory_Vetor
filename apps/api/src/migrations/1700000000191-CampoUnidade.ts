import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Unidade do campo (kg, %, cm, R$…): categorycampos.unidade. Aparece no título da coluna da tabela e na legenda
 * do gráfico; no gráfico, os valores em % vão para o eixo da direita e as demais unidades para o da esquerda.
 * O papel "P" (Y %) da migration 189 vira papel "Y" com unidade "%".
 */
export class CampoUnidade1700000000191 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categorycampos ADD COLUMN IF NOT EXISTS unidade VARCHAR(20) NULL`);
    await queryRunner.query(
      `UPDATE categorycampos SET papel_grafico = 'Y', unidade = COALESCE(NULLIF(unidade, ''), '%') WHERE papel_grafico = 'P'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE categorycampos SET papel_grafico = 'P' WHERE papel_grafico = 'Y' AND unidade = '%'`);
    await queryRunner.query(`ALTER TABLE categorycampos DROP COLUMN IF EXISTS unidade`);
  }
}
