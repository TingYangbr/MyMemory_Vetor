import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Título curto do memo (até ~5 palavras), gerado por IA depois da catalogação
 * e editável pelo autor. Coluna nova e vazia: não altera nenhum dado existente.
 * NULL = ainda não gerado; '' = sem título (sem IA ou sem texto).
 */
export class MemoTituloCurto1700000000165 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE memos ADD COLUMN IF NOT EXISTS titulo_curto TEXT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE memos DROP COLUMN IF EXISTS titulo_curto`);
  }
}
