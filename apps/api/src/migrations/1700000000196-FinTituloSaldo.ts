import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Pagamento parcial: a diferença vira um título "saldo" em aberto, ligado ao título pago (saldo_de_tituloid),
 * para o Desfazer devolver o valor ao título original.
 */
export class FinTituloSaldo1700000000196 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE fin_titulos ADD COLUMN IF NOT EXISTS saldo_de_tituloid INT NULL REFERENCES fin_titulos(id) ON DELETE CASCADE`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS fin_titulos_saldo_de ON fin_titulos (saldo_de_tituloid) WHERE saldo_de_tituloid IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE fin_titulos DROP COLUMN IF EXISTS saldo_de_tituloid`);
  }
}
