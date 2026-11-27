import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CATEGORIAS, FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * "Listar dividendos mensais recebidos em 2026, por papel" caía no Rendimento da carteira (valorização, preços,
 * quantidades). Nova consulta "Proventos recebidos" (uma linha por provento: data, mês, papel, tipo, corretora, valor)
 * na categoria Saldos e investimentos; a descrição do Rendimento manda os proventos para ela.
 * Só cria/atualiza consultas e a descrição da categoria; não mexe nos lançamentos.
 */
const NOVA = "Financeiro — Proventos recebidos";
const REND = "Financeiro — Rendimento da carteira";
const CAT = "Finanças Pessoais - Saldos e investimentos";

export class FinProventosRecebidos1700000000225 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const rend = FIN_CONSULTAS.find((q) => q.nome === REND);
    if (rend) {
      await queryRunner.query(
        `UPDATE queries_categoria SET descricao = $1, updatedat = NOW() WHERE nome = $2 AND conexaoid IS NULL AND isactive = 1`,
        [rend.descricao, REND]
      );
    }
    const cat = FIN_CATEGORIAS.find((c) => c.nome === CAT);
    if (cat) await queryRunner.query(
      // Só a descrição de fábrica (não sobrescreve a editada pelo usuário)
      `UPDATE categories SET description = $1 WHERE name = $2 AND description LIKE '%quanto investi em cada papel.'`,
      [cat.descricao, CAT]
    );

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
