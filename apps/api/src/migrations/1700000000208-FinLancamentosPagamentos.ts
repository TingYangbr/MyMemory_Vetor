import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * Lançamentos (entradas e saídas): tipo "pagamentos", "pagamentos efetuados", "compras", "saídas" = despesa (igual a
 * gastos). Antes o filtro não reconhecia e a consulta voltava vazia.
 */
const NOME = "Financeiro — Lançamentos (entradas e saídas)";

export class FinLancamentosPagamentos1700000000208 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const def = FIN_CONSULTAS.find((q) => q.nome === NOME);
    if (!def) return;
    await queryRunner.query(
      `UPDATE queries_categoria SET sentencasql = $1, descricao = $2, updatedat = NOW()
       WHERE nome = $3 AND conexaoid IS NULL AND isactive = 1 AND sentencasql ILIKE '%fin_v_lancamentos%'`,
      [def.sql, def.descricao, NOME]
    );
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
