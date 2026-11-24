import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * Posição de investimentos: colunas com nomes claros — custo_total_reais (quantidade × custo médio, o que foi pago pela
 * posição) e custo_medio_reais (por ação). "Total custo médio" / "custo total" / "quanto investi" caíam no custo médio
 * por ação (preco_medio_reais), porque o custo total se chamava só custo_reais.
 */
const POS = "Financeiro — Posição de investimentos";

export class FinPosicaoCustoTotal1700000000216 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const def = FIN_CONSULTAS.find((q) => q.nome === POS);
    if (!def) return;
    await queryRunner.query(
      `UPDATE queries_categoria SET sentencasql = $1, descricao = $2, updatedat = NOW()
       WHERE nome = $3 AND conexaoid IS NULL AND isactive = 1`,
      [def.sql, def.descricao, POS]
    );
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
