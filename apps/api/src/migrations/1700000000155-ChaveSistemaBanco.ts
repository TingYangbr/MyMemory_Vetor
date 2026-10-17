import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A chave de integração passa a fixar também o SISTEMA de origem (ex.: "softing-erp") e o banco do
 * cliente. O de-para (identidades_externas) é consultado por esses dois valores vindos da CHAVE,
 * nunca da requisição: quem tem a chave de um cliente não consegue se passar por usuários de outro
 * só informando outro banco.
 *
 * Aditiva: colunas com padrão. Chaves existentes ficam com sistema "softing-erp" e banco "" — que é
 * exatamente como o de-para é preenchido hoje na tela de Perfis.
 */
export class ChaveSistemaBanco1700000000155 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE group_api_keys ADD COLUMN IF NOT EXISTS sistema VARCHAR(60) NOT NULL DEFAULT 'softing-erp'`);
    await queryRunner.query(`ALTER TABLE group_api_keys ADD COLUMN IF NOT EXISTS banco VARCHAR(120) NOT NULL DEFAULT ''`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE group_api_keys DROP COLUMN IF EXISTS banco`);
    await queryRunner.query(`ALTER TABLE group_api_keys DROP COLUMN IF EXISTS sistema`);
  }
}
