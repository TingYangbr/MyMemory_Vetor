import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Controle financeiro — nomes curtos das 3 categorias ("Financeiro — …" → "Fin — …"), que passavam da borda
 * dos cartões. Renomeia o modelo do catálogo e as cópias já habilitadas nos grupos (as categorias do
 * financeiro não têm memos; a ligação com as consultas é pelo id). Os nomes novos ficam em FIN_CATEGORIAS.
 */
const TROCAS: [string, string][] = [
  ["Financeiro — Contas a pagar e receber", "Fin — A pagar e receber"],
  ["Financeiro — Gastos e lançamentos", "Fin — Gastos e lançamentos"],
  ["Financeiro — Saldos e investimentos", "Fin — Saldos e investimentos"],
];

export class FinanceiroNomesCurtos1700000000185 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [antigo, novo] of TROCAS) {
      // Num grupo que já tenha uma categoria com o nome novo, mantém o antigo (não cria nome repetido)
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
