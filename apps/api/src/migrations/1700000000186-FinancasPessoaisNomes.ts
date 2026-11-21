import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Controle financeiro — nomes das 3 categorias: "Fin - …" → "Finanças Pessoais - …". O nome pesa na escolha
 * da categoria (classificação e ↺ Refazer) e separa melhor das categorias de ERP; os cartões já quebram a linha.
 * Renomeia o modelo do catálogo e as cópias habilitadas (num grupo que já tenha o nome novo, mantém o antigo).
 */
const TROCAS: [string, string][] = [
  ["Fin - A pagar e receber", "Finanças Pessoais - A pagar e receber"],
  ["Fin - Gastos e lançamentos", "Finanças Pessoais - Gastos e lançamentos"],
  ["Fin - Saldos e investimentos", "Finanças Pessoais - Saldos e investimentos"],
];

export class FinancasPessoaisNomes1700000000186 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [antigo, novo] of TROCAS) {
      await queryRunner.query(
        `UPDATE categories c SET name = $2
         WHERE c.name = $1
           AND NOT EXISTS (
             SELECT 1 FROM categories d
             WHERE d.groupid IS NOT DISTINCT FROM c.groupid AND d.isactive = 1 AND lower(d.name) = lower($2)
           )`,
        [antigo, novo]
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [antigo, novo] of TROCAS) {
      await queryRunner.query(`UPDATE categories SET name = $1 WHERE name = $2`, [antigo, novo]);
    }
  }
}
