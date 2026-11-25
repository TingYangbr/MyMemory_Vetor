import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Exemplos do Fale comigo (botão 💡 Exemplos): 2 = ainda não viu (abre sozinho uma vez), 1 = mostra o botão,
 * 0 = desligado ("Não mostrar mais"; religa em Preferências).
 */
export class UserExemplosFaleComigo1700000000218 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS exemplos_fale_comigo SMALLINT NOT NULL DEFAULT 2`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS exemplos_fale_comigo`);
  }
}
