import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * Consulta "Financeiro — Lançamentos": passa a trazer o id do lançamento (lancamento_id), que vira o ✎ de corrigir
 * na tabela do Fale comigo. Só acrescenta a coluna (não troca o SQL editado à mão) e atualiza a descrição.
 */
const LANC = "Financeiro — Lançamentos (entradas e saídas)";

export class FinLancamentoIdNaConsulta1700000000219 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const lanc = FIN_CONSULTAS.find((q) => q.nome === LANC);
    await queryRunner.query(
      `UPDATE queries_categoria
         SET sentencasql = regexp_replace(sentencasql, '^\\s*SELECT\\s+', 'SELECT id AS lancamento_id, ', 'i'),
             updatedat = NOW()
       WHERE nome = $1 AND conexaoid IS NULL AND isactive = 1
         AND sentencasql ILIKE '%fin_v_lancamentos%' AND sentencasql NOT ILIKE '%lancamento_id%'
         AND sentencasql ~* '^\\s*SELECT\\s+data\\y'`,
      [LANC]
    );
    if (lanc) {
      await queryRunner.query(
        `UPDATE queries_categoria SET descricao = $1, updatedat = NOW() WHERE nome = $2 AND conexaoid IS NULL AND isactive = 1`,
        [lanc.descricao, LANC]
      );
    }
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
