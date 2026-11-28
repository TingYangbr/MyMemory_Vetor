import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CATEGORIAS, FIN_CONSULTAS, SQL_VIEW_FIN_LANCAMENTOS } from "../services/finConsultas.js";

/**
 * "Listar dividendos mensais recebidos em 2026, por papel" caía no Rendimento da carteira. Proventos já são lançamentos
 * de receita (grupos Dividendos, JCP, Rendimentos); faltava o papel de forma determinística.
 *  - View fin_v_lancamentos ganha a coluna papel: compra/venda = a conta do papel; provento/evento = a operação do mesmo
 *    lote (fin_operacoes_inv). Calculada na view: nenhum dado novo gravado nos lançamentos.
 *  - Consulta Lançamentos: coluna e filtro papel; descrição explica proventos.
 *  - Descrições do Rendimento da carteira e da categoria Gastos e lançamentos (esta só se ainda for a de fábrica).
 */
const LANC = "Financeiro — Lançamentos (entradas e saídas)";
const REND = "Financeiro — Rendimento da carteira";
const CAT = "Finanças Pessoais - Gastos e lançamentos";

export class FinLancamentoPapel1700000000225 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_operacoes_inv_lote ON fin_operacoes_inv (lote) WHERE lote IS NOT NULL`);
    await queryRunner.query(`SAVEPOINT fin_v_papel`);
    try {
      await queryRunner.query(SQL_VIEW_FIN_LANCAMENTOS);
      await queryRunner.query(`RELEASE SAVEPOINT fin_v_papel`);
    } catch (err) {
      await queryRunner.query(`ROLLBACK TO SAVEPOINT fin_v_papel`);
      console.warn("[migration 225] view fin_v_lancamentos não atualizada:", err instanceof Error ? err.message : err);
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
           SELECT $1, 'papel', 'string', 0, 'LIKE', 0,
                  COALESCE((SELECT MAX(ordem) + 1 FROM queries_categoria_params WHERE queryid = $1), 0), 1
           WHERE NOT EXISTS (SELECT 1 FROM queries_categoria_params WHERE queryid = $1 AND campo = 'papel')`,
          [q.id]
        );
      }
    }
    const rend = FIN_CONSULTAS.find((q) => q.nome === REND);
    if (rend) {
      await queryRunner.query(
        `UPDATE queries_categoria SET descricao = $1, updatedat = NOW() WHERE nome = $2 AND conexaoid IS NULL AND isactive = 1`,
        [rend.descricao, REND]
      );
    }
    const cat = FIN_CATEGORIAS.find((c) => c.nome === CAT);
    if (cat) {
      // Só a descrição de fábrica (não sobrescreve a editada pelo usuário)
      await queryRunner.query(
        `UPDATE categories SET description = $1 WHERE name = $2 AND description LIKE '%para quem paguei, maiores gastos.'`,
        [cat.descricao, CAT]
      );
    }
  }

  public async down(): Promise<void> {
    // sem volta (a coluna a mais na view não atrapalha)
  }
}
