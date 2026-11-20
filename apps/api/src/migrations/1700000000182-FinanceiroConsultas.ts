import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CATEGORIAS, FIN_CONSULTAS, SQL_FUNCAO_FIN_AGENDA } from "../services/finConsultas.js";

/**
 * Controle financeiro — etapa 2a (desenho 13.11): o Fale comigo responde sobre o financeiro.
 *  - fin_agenda(de, ate): o motor de recorrência em SQL (títulos + previsão), para as consultas de categoria;
 *    roda com os direitos de quem chama (RLS do espaço vale).
 *  - Três categorias-modelo no Catálogo de modelos (contas a pagar e receber / gastos e lançamentos / saldos e
 *    investimentos), com as consultas prontas sobre fin_. O dono habilita num grupo; a cópia leva as consultas.
 */
export class FinanceiroConsultas1700000000182 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(SQL_FUNCAO_FIN_AGENDA);
    await queryRunner.query(`REVOKE ALL ON FUNCTION public.fin_agenda(date, date) FROM PUBLIC`);
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION public.fin_agenda(date, date) TO mm_query_reader`);

    const cat = (await queryRunner.query(`SELECT id FROM groups WHERE tipo = 'catalogo' ORDER BY id LIMIT 1`)) as { id: number }[];
    if (!cat[0]) return;
    const catalogo = Number(cat[0].id);
    for (const def of FIN_CATEGORIAS) {
      const existe = (await queryRunner.query(
        `SELECT 1 FROM categories WHERE groupid = $1 AND isactive = 1 AND lower(name) = lower($2) LIMIT 1`,
        [catalogo, def.nome]
      )) as unknown[];
      if (existe.length) continue;
      const ins = (await queryRunner.query(
        `INSERT INTO categories (groupid, name, description, isactive, modelo_resumo, modelo_exemplos, modelo_versao)
         VALUES ($1, $2, $3, 1, $4, $5, 1) RETURNING id`,
        [catalogo, def.nome, def.descricao, def.resumo, def.exemplos]
      )) as { id: number }[];
      const categoryId = Number(ins[0].id);
      for (const q of FIN_CONSULTAS.filter((c) => def.consultas.some((pref) => c.nome.startsWith(pref)))) {
        const qi = (await queryRunner.query(
          `INSERT INTO queries_categoria (categoryid, nome, descricao, sentencasql, sqlgerado, conexaoid, isactive)
           VALUES ($1, $2, $3, $4, NULL, NULL, 1) RETURNING id`,
          [categoryId, q.nome, q.descricao, q.sql]
        )) as { id: number }[];
        let ordem = 0;
        for (const p of q.params) {
          await queryRunner.query(
            `INSERT INTO queries_categoria_params (queryid, campo, tipo, obrigatorio, operadorsql, normalizar, ordem, isactive)
             VALUES ($1, $2, $3, 0, $4, 0, $5, 1)`,
            [qi[0].id, p.campo, p.tipo, p.operadorSql, ordem++]
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE categories SET isactive = 0 WHERE name = ANY($1) AND groupid IN (SELECT id FROM groups WHERE tipo = 'catalogo')`,
      [FIN_CATEGORIAS.map((c) => c.nome)]
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.fin_agenda(date, date)`);
  }
}
