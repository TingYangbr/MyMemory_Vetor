import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS, SQL_VIEW_FIN_LANCAMENTOS } from "../services/finConsultas.js";

/**
 * Histórico do título no Fale comigo: a view fin_v_lancamentos ganha titulo, titulo_vencimento e titulo_id (o título
 * a pagar/receber que o lançamento pagou) e a consulta "Lançamentos (entradas e saídas)" ganha a coluna e o filtro titulo.
 */
const NOME = "Financeiro — Lançamentos (entradas e saídas)";

export class FinLancamentosTitulo1700000000207 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SAVEPOINT fin_v_titulo`);
    try {
      await queryRunner.query(SQL_VIEW_FIN_LANCAMENTOS);
      await queryRunner.query(`RELEASE SAVEPOINT fin_v_titulo`);
    } catch (err) {
      await queryRunner.query(`ROLLBACK TO SAVEPOINT fin_v_titulo`);
      console.warn("[migration 207] view fin_v_lancamentos não atualizada:", err instanceof Error ? err.message : err);
      return;
    }
    const def = FIN_CONSULTAS.find((q) => q.nome === NOME);
    if (!def) return;
    const qs = (await queryRunner.query(
      `UPDATE queries_categoria SET sentencasql = $1, descricao = $2, updatedat = NOW()
       WHERE nome = $3 AND conexaoid IS NULL AND isactive = 1 AND sentencasql ILIKE '%fin_v_lancamentos%'
       RETURNING id`,
      [def.sql, def.descricao, NOME]
    )) as unknown;
    // pg devolve [linhas, contagem] em UPDATE ... RETURNING
    const linhas = (Array.isArray(qs) && Array.isArray(qs[0]) ? qs[0] : qs) as { id: number }[];
    for (const q of linhas) {
      await queryRunner.query(
        `INSERT INTO queries_categoria_params (queryid, campo, tipo, obrigatorio, operadorsql, normalizar, ordem, isactive)
         SELECT $1, 'titulo', 'string', 0, 'LIKE', 0,
                COALESCE((SELECT MAX(ordem) + 1 FROM queries_categoria_params WHERE queryid = $1), 0), 1
         WHERE NOT EXISTS (SELECT 1 FROM queries_categoria_params WHERE queryid = $1 AND campo = 'titulo')`,
        [q.id]
      );
    }
  }

  public async down(): Promise<void> {
    // sem volta (colunas a mais na view não atrapalham)
  }
}
