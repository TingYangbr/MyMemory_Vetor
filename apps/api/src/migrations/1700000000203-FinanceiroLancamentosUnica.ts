import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CATEGORIAS, FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * "Finanças Pessoais - Gastos e lançamentos" com UMA consulta de detalhe: "Lançamentos (entradas e saídas)", uma linha
 * por lançamento com todos os campos (saiu_de/foi_para, grupo, tipo, conta, receita, despesa, resultado, moeda,
 * quantidade…). Sai daqui: "Movimentos por grupo", "Entradas e saídas por conta (caixa)", "Lançamentos (extrato)" e
 * "Contas cadastradas" (que fica só em "Saldos e investimentos").
 */
const NOVA = "Financeiro — Lançamentos (entradas e saídas)";
const SAEM = [
  "Financeiro — Movimentos por grupo",
  "Financeiro — Entradas e saídas por conta (caixa)",
  "Financeiro — Lançamentos (extrato)",
  "Financeiro — Contas cadastradas",
];

export class FinanceiroLancamentosUnica1700000000203 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
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
    // Só nas categorias "Gastos e lançamentos" (a "Contas cadastradas" continua em "Saldos e investimentos")
    await queryRunner.query(
      `UPDATE queries_categoria SET isactive = 0, updatedat = NOW()
       WHERE nome = ANY($1) AND conexaoid IS NULL AND isactive = 1
         AND categoryid IN (SELECT id FROM categories WHERE name = ANY($2))`,
      [SAEM, categorias]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE queries_categoria SET isactive = 0 WHERE nome = $1`, [NOVA]);
  }
}
