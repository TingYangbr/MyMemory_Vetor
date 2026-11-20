import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Controle financeiro — etapa 1.1, moedas (desenho 13.10):
 *  - fin_contas.moeda: real por padrão; grupos de despesa/receita e contas do sistema são sempre em real.
 *  - fin_lancamentos: valor continua em reais (o livro fecha em reais); quando um lado é conta em outra moeda,
 *    guarda também valor_moeda, moeda e a cotação usada.
 *  - fin_cotacoes: PTAX diária do Banco Central (fechamento, venda), cache compartilhado — dado público.
 */
export class FinanceiroMoedas1700000000181 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE fin_contas ADD COLUMN IF NOT EXISTS moeda CHAR(3) NOT NULL DEFAULT 'BRL'`);
    await queryRunner.query(`ALTER TABLE fin_lancamentos ADD COLUMN IF NOT EXISTS valor_moeda NUMERIC(18,2) NULL`);
    await queryRunner.query(`ALTER TABLE fin_lancamentos ADD COLUMN IF NOT EXISTS moeda CHAR(3) NULL`);
    await queryRunner.query(`ALTER TABLE fin_lancamentos ADD COLUMN IF NOT EXISTS cotacao NUMERIC(18,8) NULL`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fin_cotacoes (
        moeda CHAR(3) NOT NULL,
        data DATE NOT NULL,
        valor NUMERIC(18,8) NOT NULL,
        fonte VARCHAR(20) NOT NULL DEFAULT 'PTAX',
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (moeda, data)
      )`);
    await queryRunner.query(`GRANT SELECT ON fin_cotacoes TO mm_query_reader`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS fin_cotacoes`);
    await queryRunner.query(`ALTER TABLE fin_lancamentos DROP COLUMN IF EXISTS cotacao`);
    await queryRunner.query(`ALTER TABLE fin_lancamentos DROP COLUMN IF EXISTS moeda`);
    await queryRunner.query(`ALTER TABLE fin_lancamentos DROP COLUMN IF EXISTS valor_moeda`);
    await queryRunner.query(`ALTER TABLE fin_contas DROP COLUMN IF EXISTS moeda`);
  }
}
