import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * Lançamentos (entradas e saídas): grupo, conta, saiu_de, foi_para e descrição por "contém" (condomínio pega Condomínio
 * Granja e Condomínio Butantã; Itaú pega Itaú Personnalité). Antes era igual (sem curinga).
 */
const NOME = "Financeiro — Lançamentos (entradas e saídas)";

export class FinLancamentosContem1700000000205 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const def = FIN_CONSULTAS.find((q) => q.nome === NOME);
    if (!def) return;
    await queryRunner.query(
      `UPDATE queries_categoria SET sentencasql = $1, updatedat = NOW()
       WHERE nome = $2 AND conexaoid IS NULL AND isactive = 1 AND sentencasql ILIKE '%fin_v_lancamentos%'
         AND sentencasql NOT ILIKE '%grupo ILIKE ''%%'' ||%'`,
      [def.sql, NOME]
    );
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
