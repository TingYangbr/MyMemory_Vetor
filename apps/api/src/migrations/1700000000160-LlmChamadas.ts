import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * llm_chamadas — uma linha por chamada de IA de texto (chatIa): etapa (source), provedor, modelo,
 * tamanho da instrução (system), da entrada (user) e da saída em caracteres, tempo e custo.
 * Levantamento do peso de cada etapa (perguntas, catalogação…) antes de enxugar os prompts.
 */
export class LlmChamadas1700000000160 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS llm_chamadas (
        id BIGSERIAL PRIMARY KEY,
        etapa VARCHAR(80) NOT NULL,
        provedor VARCHAR(40) NULL,
        modelo VARCHAR(80) NULL,
        chars_sistema INTEGER NOT NULL DEFAULT 0,
        chars_entrada INTEGER NOT NULL DEFAULT 0,
        chars_saida INTEGER NOT NULL DEFAULT 0,
        ms INTEGER NOT NULL DEFAULT 0,
        custo_usd NUMERIC(12, 8) NOT NULL DEFAULT 0,
        ok SMALLINT NOT NULL DEFAULT 1,
        createdat TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_llm_chamadas_data ON llm_chamadas (createdat)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS llm_chamadas`);
  }
}
