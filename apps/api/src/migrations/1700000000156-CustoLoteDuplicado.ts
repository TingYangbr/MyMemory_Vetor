import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A importação em lote registrava o custo de IA duas vezes em api_usage_logs: 'memo_batch_ia'
 * (ao criar o memo) e 'batch_import' (logo depois, com o mesmo valor). Remove as cópias
 * 'batch_import' que têm o par 'memo_batch_ia' do mesmo memo e custo — o código já não as grava.
 */
export class CustoLoteDuplicado1700000000156 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM api_usage_logs b
      WHERE b.operation = 'batch_import'
        AND b.memoid IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM api_usage_logs m
          WHERE m.operation = 'memo_batch_ia' AND m.memoid = b.memoid AND m.costusd = b.costusd
        )
    `);
  }

  public async down(): Promise<void> {
    // Registros duplicados não são recriados
  }
}
