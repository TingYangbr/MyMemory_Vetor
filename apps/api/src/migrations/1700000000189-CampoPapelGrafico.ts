import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Papel do campo no gráfico das respostas: categorycampos.papel_grafico.
 *   'X' = rótulos (eixo das categorias: horizontal na barra em pé, vertical na barra deitada);
 *   'Y' = valor (eixo perpendicular, o tamanho da barra);
 *   NULL = não entra no gráfico, a não ser que a pergunta cite o campo.
 * Vários Y = várias barras lado a lado, cada uma de uma cor (a cor é automática).
 * Categoria sem nenhum papel definido continua com a escolha automática de antes.
 */
export class CampoPapelGrafico1700000000189 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categorycampos ADD COLUMN IF NOT EXISTS papel_grafico VARCHAR(1) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categorycampos DROP COLUMN IF EXISTS papel_grafico`);
  }
}
