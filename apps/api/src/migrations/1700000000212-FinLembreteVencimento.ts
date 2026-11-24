import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Lembrete de vencimento do financeiro, por espaço (fin_config): ligado (padrão), dias antes (padrão 3 e no dia),
 * e-mail (padrão ligado) e o último dia em que o e-mail saiu (um por dia).
 */
export class FinLembreteVencimento1700000000212 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE fin_config ADD COLUMN IF NOT EXISTS lembrete_ativo SMALLINT NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE fin_config ADD COLUMN IF NOT EXISTS lembrete_dias VARCHAR(40) NOT NULL DEFAULT '3,0'`);
    await queryRunner.query(`ALTER TABLE fin_config ADD COLUMN IF NOT EXISTS lembrete_email SMALLINT NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE fin_config ADD COLUMN IF NOT EXISTS lembrete_ultimo_dia DATE NULL`);
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
