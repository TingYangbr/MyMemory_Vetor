import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Grupo: "Usar categorias globais" (groups.usar_globais). Ligado = o registro de memos (Catalogar e registro novo
 * pelo Fale comigo) considera também as categorias globais (Categorias Modelos), como sempre foi. Desligado = só as
 * categorias do próprio grupo. Grupos que já existem ficam ligados (nada muda); grupos novos nascem desligados
 * (usam os Modelos prontos, copiados para o grupo).
 */
export class GrupoUsarGlobais1700000000193 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS usar_globais SMALLINT NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE groups ALTER COLUMN usar_globais SET DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE groups DROP COLUMN IF EXISTS usar_globais`);
  }
}
