import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CATEGORIAS, FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * "Qual foi o rendimento da carteira no mês passado?" não tinha resposta: a Posição de investimentos usava sempre a
 * cotação de hoje (mesmo pedindo 31/10) e não havia como descontar as compras do período.
 *  - Nova consulta "Rendimento da carteira" (valor no início e no fim pelo fechamento da B3, compras, vendas, proventos).
 *  - Posição de investimentos: com data passada, preço = fechamento da B3 do último pregão até a data; sem cotação
 *    atual, o último fechamento.
 * Só cria/atualiza consultas (queries_categoria); não mexe nos lançamentos.
 */
const NOVA = "Financeiro — Rendimento da carteira";
const POS = "Financeiro — Posição de investimentos";

export class FinRendimentoCarteira1700000000220 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const pos = FIN_CONSULTAS.find((q) => q.nome === POS);
    if (pos) {
      await queryRunner.query(
        `UPDATE queries_categoria SET sentencasql = $1, descricao = $2, updatedat = NOW()
         WHERE nome = $3 AND conexaoid IS NULL AND isactive = 1`,
        [pos.sql, pos.descricao, POS]
      );
    }
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
