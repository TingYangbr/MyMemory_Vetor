import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * Investimentos, parte 2: proventos (dividendo, JCP com IR retido, rendimento, juros) e eventos (desdobramento,
 * grupamento, bonificação) em fin_operacoes_inv; cotação dos papéis (brapi ou digitada) em fin_cotacoes_papel, lida
 * também pela consulta "Posição de investimentos" (preço atual, valor de mercado, resultado).
 */
const POS = "Financeiro — Posição de investimentos";

export class FinInvestimentosParte2_1700000000214 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE fin_operacoes_inv ADD COLUMN IF NOT EXISTS subtipo VARCHAR(20) NULL`);
    await queryRunner.query(`ALTER TABLE fin_operacoes_inv ADD COLUMN IF NOT EXISTS valor_bruto NUMERIC(14,2) NULL`);
    await queryRunner.query(`ALTER TABLE fin_operacoes_inv ADD COLUMN IF NOT EXISTS ir_retido NUMERIC(14,2) NULL`);
    await queryRunner.query(`ALTER TABLE fin_operacoes_inv ADD COLUMN IF NOT EXISTS fator NUMERIC(18,8) NULL`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fin_cotacoes_papel (
        ticker VARCHAR(30) PRIMARY KEY,
        preco NUMERIC(18,6) NOT NULL,
        momento TIMESTAMPTZ NOT NULL,
        fonte VARCHAR(10) NOT NULL,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await queryRunner.query(`GRANT SELECT ON fin_cotacoes_papel TO mm_query_reader`);
    const def = FIN_CONSULTAS.find((q) => q.nome === POS);
    if (def) {
      await queryRunner.query(
        `UPDATE queries_categoria SET sentencasql = $1, descricao = $2, updatedat = NOW()
         WHERE nome = $3 AND conexaoid IS NULL AND isactive = 1`,
        [def.sql, def.descricao, POS]
      );
    }
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
