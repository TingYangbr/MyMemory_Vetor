import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * "Gastos e receitas por grupo e mês" sem datas na pergunta: do começo do ano até o fim do mês atual (antes, só o mês
 * atual — a série mensal mostrava um mês e escondia, por exemplo, a despesa de 31/10). Atualiza as cópias intactas.
 */
const NOME = "Financeiro — Gastos e receitas por grupo e mês";

export class FinanceiroPorMesDesdeJaneiro1700000000201 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const def = FIN_CONSULTAS.find((q) => q.nome === NOME);
    if (!def) return;
    await queryRunner.query(
      `UPDATE queries_categoria SET sentencasql = $1, descricao = $2, updatedat = NOW()
       WHERE nome = $3 AND conexaoid IS NULL AND isactive = 1 AND sentencasql NOT ILIKE '%date_trunc(''year''%'`,
      [def.sql, def.descricao, NOME]
    );
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
