import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Consulta (DB interno ou ERP): configuração das colunas do resultado, como os campos do memo — ordem na tabela
 * (-1 = oculta), papel no gráfico (X/Y), unidade e rótulo. JSON: [{coluna, ordem, papel, unidade, rotulo}].
 */
export class ConsultaColunas1700000000199 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE queries_categoria ADD COLUMN IF NOT EXISTS colunas_json TEXT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE queries_categoria DROP COLUMN IF EXISTS colunas_json`);
  }
}
