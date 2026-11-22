import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Investimentos — o "fato" de cada operação com papel (compra, venda; depois provento e evento), com a origem
 * (falecomigo, tela, b3, nota) e a chave externa da fonte. É a porta única para o Fale comigo hoje e para a API da
 * B3 depois: a importação só chama registrarOperacaoInvestimento com origem "b3", que casa o que já foi relatado.
 * Os números de saldo e custo médio continuam saindo do livro (fin_lancamentos, ligados pelo lote).
 * fin_contas.instituicao_b3: código/nome da instituição na B3, para ligar a corretora quando a API chegar.
 */
export class FinOperacoesInv1700000000197 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE fin_contas ADD COLUMN IF NOT EXISTS instituicao_b3 VARCHAR(60) NULL`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fin_operacoes_inv (
        id SERIAL PRIMARY KEY,
        groupid INT NULL REFERENCES groups(id) ON DELETE CASCADE,
        userid INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        data DATE NOT NULL,
        operacao VARCHAR(12) NOT NULL CHECK (operacao IN ('compra','venda','provento','evento')),
        ticker VARCHAR(30) NOT NULL,
        papel_contaid INT NOT NULL REFERENCES fin_contas(id),
        corretora_contaid INT NULL REFERENCES fin_contas(id),
        quantidade NUMERIC(18,6) NULL,
        preco NUMERIC(18,6) NULL,
        valor_total NUMERIC(14,2) NULL,
        taxas NUMERIC(14,2) NOT NULL DEFAULT 0,
        moeda CHAR(3) NOT NULL DEFAULT 'BRL',
        origem VARCHAR(20) NOT NULL,
        situacao VARCHAR(12) NOT NULL DEFAULT 'relatada' CHECK (situacao IN ('relatada','confirmada','divergente')),
        chave_externa VARCHAR(120) NULL,
        lote VARCHAR(40) NULL,
        conciliada_com INT NULL REFERENCES fin_operacoes_inv(id) ON DELETE SET NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_operacoes_inv_espaco ON fin_operacoes_inv (groupid, userid, data)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_operacoes_inv_papel ON fin_operacoes_inv (papel_contaid, data)`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS fin_operacoes_inv_chave ON fin_operacoes_inv
        (COALESCE(groupid, 0), (CASE WHEN groupid IS NULL THEN userid ELSE 0 END), chave_externa)
        WHERE chave_externa IS NOT NULL`);

    // Leitura pelas consultas de categoria (papel restrito), recortada pelo espaço — como as outras fin_
    await queryRunner.query(`GRANT SELECT ON fin_operacoes_inv TO mm_query_reader`);
    await queryRunner.query(`ALTER TABLE fin_operacoes_inv ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS mm_app_all ON fin_operacoes_inv`);
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format('CREATE POLICY mm_app_all ON fin_operacoes_inv FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
      END $$;
    `);
    await queryRunner.query(`DROP POLICY IF EXISTS mm_query_reader_grupo ON fin_operacoes_inv`);
    await queryRunner.query(`
      CREATE POLICY mm_query_reader_grupo ON fin_operacoes_inv FOR SELECT TO mm_query_reader USING (
        (SELECT public.mm_ctx_ativo())
        AND CASE
          WHEN (SELECT public.mm_ctx_group_id()) IS NOT NULL
            THEN groupid = (SELECT public.mm_ctx_group_id())
          ELSE groupid IS NULL AND userid = (SELECT public.mm_ctx_user_id())
        END)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS fin_operacoes_inv`);
    await queryRunner.query(`ALTER TABLE fin_contas DROP COLUMN IF EXISTS instituicao_b3`);
  }
}
