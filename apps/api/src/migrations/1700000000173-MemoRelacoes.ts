import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Relações entre memos (ligação explícita, gravada; nunca inferida a cada pergunta).
 *  - origem_id "é <tipo> de" destino_id. Ex.: a ata (origem) é "resultado" da reunião da agenda (destino).
 *  - tipo: resultado, aditivo, recebimento, estorno, relacionado...
 *  - isactive = 0: relação desfeita (fica no histórico).
 * A ligação nasce pelo botão "Concluir e registrar resultado" ou pela sugestão da IA logo depois de
 * salvar um memo, sempre confirmada pelo usuário.
 */
export class MemoRelacoes1700000000173 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS memo_relacoes (
        id SERIAL PRIMARY KEY,
        origem_id INTEGER NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
        destino_id INTEGER NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
        tipo VARCHAR(40) NOT NULL DEFAULT 'resultado',
        criado_por INTEGER NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        isactive SMALLINT NOT NULL DEFAULT 1,
        CONSTRAINT uq_memo_relacoes UNIQUE (origem_id, destino_id, tipo)
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_memo_relacoes_origem ON memo_relacoes (origem_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_memo_relacoes_destino ON memo_relacoes (destino_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS memo_relacoes`);
  }
}
