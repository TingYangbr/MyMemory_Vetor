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
    // Quem recebe no grupo: dono, membros ou escolhidos (ids); e-mails a mais
    await queryRunner.query(`ALTER TABLE fin_config ADD COLUMN IF NOT EXISTS lembrete_quem VARCHAR(12) NOT NULL DEFAULT 'dono'`);
    await queryRunner.query(`ALTER TABLE fin_config ADD COLUMN IF NOT EXISTS lembrete_membros VARCHAR(500) NOT NULL DEFAULT ''`);
    await queryRunner.query(`ALTER TABLE fin_config ADD COLUMN IF NOT EXISTS lembrete_emails VARCHAR(500) NOT NULL DEFAULT ''`);
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
