import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Lote 5 (Admin do sistema): guarda o resultado do último "Testar" de cada conexão de banco,
 * para a lista mostrar se ela está funcionando sem precisar testar de novo.
 */
export class ConexaoUltimoTeste1700000000179 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS ultimo_teste_em TIMESTAMPTZ NULL`);
    await queryRunner.query(`ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS ultimo_teste_ok SMALLINT NULL`);
    await queryRunner.query(`ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS ultimo_teste_ms INTEGER NULL`);
    await queryRunner.query(`ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS ultimo_teste_msg TEXT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const c of ["ultimo_teste_msg", "ultimo_teste_ms", "ultimo_teste_ok", "ultimo_teste_em"]) {
      await queryRunner.query(`ALTER TABLE db_connections DROP COLUMN IF EXISTS ${c}`);
    }
  }
}
