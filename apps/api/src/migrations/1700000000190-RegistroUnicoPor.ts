import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Registro único (ex.: Antropometria: um memo por Dono + Data + Período): categories.registro_unico_por,
 * nomes dos campos da chave separados por vírgula. Registrar de novo com a mesma chave atualiza o memo que
 * já existe (com Desfazer) em vez de criar outro. NULL = cada registro cria um memo (como era).
 * Independe da "Lista aberta" (lista_aberta_por), que continua acrescentando itens na lista aberta.
 */
export class RegistroUnicoPor1700000000190 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS registro_unico_por VARCHAR(500) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS registro_unico_por`);
  }
}
