import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS, SQL_FUNCAO_FIN_AGENDA } from "../services/finConsultas.js";

/**
 * Consulta "Contas a pagar e receber (agenda)": sem data_fin = sem limite (antes era o fim do mês atual), para que
 * uma conta lançada com vencimento em meses futuros apareça. data_ini vazio continua = dia 1º do mês atual.
 * fin_agenda passa a limitar a previsão das recorrências a 12 meses quando o período não tem fim.
 * Atualiza as cópias que ainda têm o SQL antigo (edição à mão é preservada).
 */
const NOME = "Financeiro — Contas a pagar e receber (agenda)";

export class AgendaSemDataFinal1700000000194 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(SQL_FUNCAO_FIN_AGENDA);
    const def = FIN_CONSULTAS.find((q) => q.nome === NOME);
    if (!def) return;
    await queryRunner.query(
      `UPDATE queries_categoria SET sentencasql = $1, descricao = $2, updatedat = NOW()
       WHERE nome = $3 AND conexaoid IS NULL AND sentencasql ILIKE '%COALESCE(:data_fin, (date_trunc(%'`,
      [def.sql, def.descricao, NOME]
    );
  }

  public async down(): Promise<void> {
    // sem volta: o SQL antigo não é guardado
  }
}
