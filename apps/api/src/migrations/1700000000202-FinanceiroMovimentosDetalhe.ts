import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CATEGORIAS, FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * Financeiro no mesmo padrão do ERP: uma consulta de DETALHE ("Movimentos por grupo", uma linha por lançamento com
 * receita/despesa/resultado já com sinal) e a IA monta os totais (por grupo, mês, conta…) com a agregação. Ela substitui
 * as consultas que já vinham somadas para um recorte só: "Gastos e receitas por grupo", "… por grupo e mês" e
 * "Resultado por mês". Entra nas categorias de Finanças Pessoais que a listam (modelo e cópias); as antigas saem.
 */
const NOVA = "Financeiro — Movimentos por grupo";
const ANTIGAS = [
  "Financeiro — Gastos e receitas por grupo",
  "Financeiro — Gastos e receitas por grupo e mês",
  "Financeiro — Resultado por mês (receitas − despesas)",
];

export class FinanceiroMovimentosDetalhe1700000000202 implements MigrationInterface {
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
    // As somadas saem (só as do banco interno, nas categorias de Finanças Pessoais)
    await queryRunner.query(
      `UPDATE queries_categoria SET isactive = 0, updatedat = NOW()
       WHERE nome = ANY($1) AND conexaoid IS NULL AND isactive = 1
         AND categoryid IN (SELECT id FROM categories WHERE name = ANY($2))`,
      [ANTIGAS, FIN_CATEGORIAS.map((c) => c.nome)]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE queries_categoria SET isactive = 1 WHERE nome = ANY($1)`, [ANTIGAS]);
    await queryRunner.query(`UPDATE queries_categoria SET isactive = 0 WHERE nome = $1`, [NOVA]);
  }
}
