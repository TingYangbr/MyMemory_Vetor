import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CATEGORIAS, FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * Histórico de preços (fechamento diário) dos papéis da B3: fin_precos_historico (um preço por ticker e pregão, igual
 * para todos — dado público), fin_precos_importacoes (arquivos da B3 já lidos) e a consulta "Histórico de preços" nas
 * categorias de Saldos e investimentos.
 */
const NOVA = "Financeiro — Histórico de preços";

export class FinPrecosHistorico1700000000215 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fin_precos_historico (
        ticker VARCHAR(12) NOT NULL,
        data DATE NOT NULL,
        abertura NUMERIC(18,6) NULL,
        maxima NUMERIC(18,6) NULL,
        minima NUMERIC(18,6) NULL,
        fechamento NUMERIC(18,6) NOT NULL,
        volume NUMERIC(20,2) NULL,
        PRIMARY KEY (ticker, data)
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fin_precos_importacoes (
        arquivo VARCHAR(20) PRIMARY KEY,
        situacao VARCHAR(20) NOT NULL,
        linhas INT NOT NULL DEFAULT 0,
        mensagem VARCHAR(500) NULL,
        em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await queryRunner.query(`GRANT SELECT ON fin_precos_historico TO mm_query_reader`);
    const def = FIN_CONSULTAS.find((q) => q.nome === NOVA);
    if (!def) return;
    const categorias = FIN_CATEGORIAS.filter((c) => c.consultas.some((pref) => NOVA.startsWith(pref))).map((c) => c.nome);
    const cats = (await queryRunner.query(
      `SELECT c.id FROM categories c
       WHERE c.isactive = 1 AND c.name = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM queries_categoria q WHERE q.categoryid = c.id AND q.nome = $2 AND q.isactive = 1)`,
      [categorias, NOVA]
    )) as { id: number }[];
    for (const c of cats) {
      const qi = (await queryRunner.query(
        `INSERT INTO queries_categoria (categoryid, nome, descricao, sentencasql, sqlgerado, conexaoid, isactive)
         VALUES ($1, $2, $3, $4, NULL, NULL, 1) RETURNING id`,
        [c.id, def.nome, def.descricao, def.sql]
      )) as { id: number }[];
      let ordem = 0;
      for (const p of def.params) {
        await queryRunner.query(
          `INSERT INTO queries_categoria_params (queryid, campo, tipo, obrigatorio, operadorsql, normalizar, ordem, isactive)
           VALUES ($1, $2, $3, 0, $4, 0, $5, 1)`,
          [qi[0].id, p.campo, p.tipo, p.operadorSql, ordem++]
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE queries_categoria SET isactive = 0 WHERE nome = $1`, [NOVA]);
  }
}
