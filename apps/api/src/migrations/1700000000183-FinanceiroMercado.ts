import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CATEGORIAS, FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * Controle financeiro — mercado local ou exterior (desenho 13.12):
 *  - fin_contas.mercado ('local' | 'exterior') em banco, corretora, cartão e investimento; padrão pela moeda
 *    (BDR e fundo cambial são locais em reais; Avenue/Nomad são exterior).
 *  - Consultas "Saldos das contas" e "Posição de investimentos" ganham a coluna e o filtro mercado, e a instrução
 *    de nunca somar moedas diferentes. Atualiza o modelo e as cópias habilitadas que não foram editadas à mão.
 */
const ALVOS = ["Financeiro — Saldos das contas", "Financeiro — Posição de investimentos"];

export class FinanceiroMercado1700000000183 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE fin_contas ADD COLUMN IF NOT EXISTS mercado VARCHAR(10) NULL`);
    await queryRunner.query(`
      UPDATE fin_contas SET mercado = CASE WHEN moeda = 'BRL' THEN 'local' ELSE 'exterior' END
      WHERE mercado IS NULL AND tipo IN ('banco', 'corretora', 'cartao', 'investimento')`);

    const nomesCategorias = FIN_CATEGORIAS.map((c) => c.nome);
    for (const nome of ALVOS) {
      const def = FIN_CONSULTAS.find((q) => q.nome === nome);
      if (!def) continue;
      // Só as que ainda não têm "mercado" (não atualizadas) — edição à mão com mercado é preservada
      const qs = (await queryRunner.query(
        `SELECT q.id FROM queries_categoria q JOIN categories c ON c.id = q.categoryid
         WHERE q.nome = $1 AND q.conexaoid IS NULL AND q.isactive = 1 AND c.name = ANY($2)
           AND q.sentencasql NOT ILIKE '%mercado%'`,
        [nome, nomesCategorias]
      )) as { id: number }[];
      for (const q of qs) {
        await queryRunner.query(`UPDATE queries_categoria SET sentencasql = $1, descricao = $2, updatedat = NOW() WHERE id = $3`, [
          def.sql,
          def.descricao,
          q.id,
        ]);
        const tem = (await queryRunner.query(
          `SELECT 1 FROM queries_categoria_params WHERE queryid = $1 AND campo = 'mercado' AND isactive = 1`,
          [q.id]
        )) as unknown[];
        if (!tem.length) {
          await queryRunner.query(
            `INSERT INTO queries_categoria_params (queryid, campo, tipo, obrigatorio, operadorsql, normalizar, ordem, isactive)
             VALUES ($1, 'mercado', 'string', 0, '=', 0,
                     (SELECT COALESCE(MAX(ordem), 0) + 1 FROM queries_categoria_params WHERE queryid = $1), 1)`,
            [q.id]
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE fin_contas DROP COLUMN IF EXISTS mercado`);
  }
}
