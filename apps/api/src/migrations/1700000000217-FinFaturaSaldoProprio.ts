import type { MigrationInterface, QueryRunner } from "typeorm";
import { SQL_FUNCAO_FIN_AGENDA } from "../services/finConsultas.js";

/**
 * Faturas de cartão na agenda: cada fatura fica com o próprio saldo em aberto (antes era acumulado com as anteriores,
 * e pagar uma fatura baixava o valor de todas as seguintes). Só crédito (pago a mais) passa para a próxima.
 */
export class FinFaturaSaldoProprio1700000000217 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(SQL_FUNCAO_FIN_AGENDA);
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
