import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS, SQL_FUNCAO_FIN_AGENDA, SQL_FUNCOES_FATURA, SQL_VIEW_FIN_LANCAMENTOS } from "../services/finConsultas.js";

/**
 * Cartão de crédito com fatura: dias de fechamento e vencimento no cartão; cada lançamento de cartão guarda a fatura
 * (vencimento) em que caiu — calculada por gatilho na inclusão e mudável à mão (fatura_manual). As faturas entram na
 * agenda (fin_agenda) e a view/consulta de lançamentos ganha a coluna e o filtro fatura.
 */
const LANC = "Financeiro — Lançamentos (entradas e saídas)";
const PREV = "Financeiro — Contas a pagar e receber (previstos)";

export class FinCartaoFatura1700000000211 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE fin_contas ADD COLUMN IF NOT EXISTS dia_fechamento SMALLINT NULL CHECK (dia_fechamento BETWEEN 1 AND 31)`);
    await queryRunner.query(`ALTER TABLE fin_contas ADD COLUMN IF NOT EXISTS dia_vencimento SMALLINT NULL CHECK (dia_vencimento BETWEEN 1 AND 31)`);
    await queryRunner.query(`ALTER TABLE fin_lancamentos ADD COLUMN IF NOT EXISTS fatura DATE NULL`);
    await queryRunner.query(`ALTER TABLE fin_lancamentos ADD COLUMN IF NOT EXISTS fatura_manual SMALLINT NOT NULL DEFAULT 0`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_lancamentos_fatura ON fin_lancamentos (fatura) WHERE fatura IS NOT NULL`);
    await queryRunner.query(SQL_FUNCOES_FATURA);
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION public.fin_fatura_de(date, int, int) TO mm_query_reader`);
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION public.fin_fatura_pagamento(date, int, int) TO mm_query_reader`);
    await queryRunner.query(SQL_FUNCAO_FIN_AGENDA);
    await queryRunner.query(`SAVEPOINT fin_v_fatura`);
    try {
      await queryRunner.query(SQL_VIEW_FIN_LANCAMENTOS);
      await queryRunner.query(`RELEASE SAVEPOINT fin_v_fatura`);
    } catch (err) {
      await queryRunner.query(`ROLLBACK TO SAVEPOINT fin_v_fatura`);
      console.warn("[migration 211] view fin_v_lancamentos não atualizada:", err instanceof Error ? err.message : err);
      return;
    }
    const lanc = FIN_CONSULTAS.find((q) => q.nome === LANC);
    if (lanc) {
      const r = (await queryRunner.query(
        `UPDATE queries_categoria SET sentencasql = $1, descricao = $2, updatedat = NOW()
         WHERE nome = $3 AND conexaoid IS NULL AND isactive = 1 AND sentencasql ILIKE '%fin_v_lancamentos%'
         RETURNING id`,
        [lanc.sql, lanc.descricao, LANC]
      )) as unknown;
      const linhas = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as { id: number }[];
      for (const q of linhas) {
        await queryRunner.query(
          `INSERT INTO queries_categoria_params (queryid, campo, tipo, obrigatorio, operadorsql, normalizar, ordem, isactive)
           SELECT $1, 'fatura', 'string', 0, '=', 0,
                  COALESCE((SELECT MAX(ordem) + 1 FROM queries_categoria_params WHERE queryid = $1), 0), 1
           WHERE NOT EXISTS (SELECT 1 FROM queries_categoria_params WHERE queryid = $1 AND campo = 'fatura')`,
          [q.id]
        );
      }
    }
    const prev = FIN_CONSULTAS.find((q) => q.nome === PREV);
    if (prev) {
      await queryRunner.query(
        `UPDATE queries_categoria SET descricao = $1, updatedat = NOW() WHERE nome = $2 AND conexaoid IS NULL AND isactive = 1`,
        [prev.descricao, PREV]
      );
    }
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
