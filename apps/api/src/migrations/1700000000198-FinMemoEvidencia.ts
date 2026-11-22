import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Documento como evidência: o memo do PDF/imagem registrado pelo Catalogar fica ligado ao que foi gravado no
 * financeiro (título/parcelado, conta fixa, lançamento, operação de investimento). O memo é o relato; a tabela é o fato.
 */
const TABELAS = ["fin_titulos", "fin_recorrencias", "fin_lancamentos", "fin_operacoes_inv"];

export class FinMemoEvidencia1700000000198 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const t of TABELAS) {
      await queryRunner.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS memoid INT NULL REFERENCES memos(id) ON DELETE SET NULL`);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS ${t}_memo ON ${t} (memoid) WHERE memoid IS NOT NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of TABELAS) await queryRunner.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS memoid`);
  }
}
