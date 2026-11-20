import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CATEGORIAS, FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * Controle financeiro — consulta "Contas cadastradas" (lista as contas e grupos, com ou sem movimento).
 * Entra nas categorias "Gastos e lançamentos" e "Saldos e investimentos": no modelo do catálogo e nas cópias
 * já habilitadas (pelo nome da categoria), se ainda não tiverem a consulta.
 * Também tira o "atualizável" das 3 categorias e desliga as consultas automáticas de memos (alterações/padrão).
 */
const NOME = "Financeiro — Contas cadastradas";

export class FinanceiroContasCadastradas1700000000184 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // As categorias do financeiro não têm memos: sem "atualizável" e sem a consulta automática de alterações
    // (ela entrava no planejamento e só atrapalhava a escolha)
    const todas = FIN_CATEGORIAS.map((c) => c.nome);
    await queryRunner.query(`UPDATE categories SET atualizavel = 0 WHERE name = ANY($1) AND atualizavel <> 0`, [todas]);
    await queryRunner.query(
      `UPDATE queries_categoria SET isactive = 0, updatedat = NOW()
       WHERE autotipo IN ('alteracoes', 'padrao') AND isactive = 1
         AND categoryid IN (SELECT id FROM categories WHERE name = ANY($1))`,
      [todas]
    );

    const def = FIN_CONSULTAS.find((q) => q.nome === NOME);
    if (!def) return;
    const categorias = FIN_CATEGORIAS.filter((c) => c.consultas.includes(NOME)).map((c) => c.nome);
    const cats = (await queryRunner.query(
      `SELECT c.id FROM categories c
       WHERE c.isactive = 1 AND c.name = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM queries_categoria q WHERE q.categoryid = c.id AND q.nome = $2 AND q.isactive = 1)`,
      [categorias, NOME]
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
    await queryRunner.query(`UPDATE queries_categoria SET isactive = 0 WHERE nome = $1`, [NOME]);
  }
}
