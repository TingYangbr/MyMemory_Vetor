import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Controle financeiro — etapa 1 do núcleo (docs/desenho-controle-financeiro-promemory.md, seção 13):
 *  - fin_contas: banco, cartão, corretora, investimento por papel, grupos de despesa/receita e as contas
 *    do sistema (a receber, a pagar, saldo inicial, juros, descontos, ganho/perda), por espaço.
 *  - fin_lancamentos: o livro — cada lançamento tem dois lados (conta de origem → conta de destino);
 *    investimento guarda também quantidade (variação, com sinal) e preço.
 *  - fin_titulos: compromissos a pagar/receber. Prazo determinado (parcelado) grava todos de uma vez;
 *    recorrente nasce no pagamento, com (recorrenciaid, referencia) únicos.
 *  - fin_recorrencias + fin_recorrencia_excecoes: a regra do motor e as exceções de um mês
 *    (outro valor ou pular) — exceção não é título, não é obrigação.
 * Espaço = grupo (groupid) ou pessoal (groupid NULL + userid), como os memos. RLS para mm_query_reader.
 */
const TABELAS = ["fin_contas", "fin_lancamentos", "fin_titulos", "fin_recorrencias", "fin_recorrencia_excecoes"];

export class FinanceiroNucleo1700000000180 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fin_contas (
        id SERIAL PRIMARY KEY,
        groupid INT NULL REFERENCES groups(id) ON DELETE CASCADE,
        userid INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        nome VARCHAR(120) NOT NULL,
        tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('banco','cartao','corretora','investimento','despesa','receita','a_receber','a_pagar','patrimonio')),
        chave VARCHAR(30) NULL,
        papel VARCHAR(30) NULL,
        corretora_contaid INT NULL REFERENCES fin_contas(id),
        ativo SMALLINT NOT NULL DEFAULT 1,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    // Conta do sistema: uma por chave e por espaço (pessoal = groupid nulo + userid)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS fin_contas_chave_espaco ON fin_contas
        (COALESCE(groupid, 0), (CASE WHEN groupid IS NULL THEN userid ELSE 0 END), chave)
        WHERE chave IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_contas_espaco ON fin_contas (groupid, userid)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fin_recorrencias (
        id SERIAL PRIMARY KEY,
        groupid INT NULL REFERENCES groups(id) ON DELETE CASCADE,
        userid INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sentido VARCHAR(10) NOT NULL CHECK (sentido IN ('pagar','receber')),
        descricao VARCHAR(200) NOT NULL,
        valor NUMERIC(14,2) NOT NULL CHECK (valor > 0),
        periodicidade VARCHAR(12) NOT NULL,
        inicio DATE NOT NULL,
        fim DATE NULL,
        conta_grupoid INT NOT NULL REFERENCES fin_contas(id),
        conta_pagamentoid INT NULL REFERENCES fin_contas(id),
        ativo SMALLINT NOT NULL DEFAULT 1,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_recorrencias_espaco ON fin_recorrencias (groupid, userid)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fin_recorrencia_excecoes (
        id SERIAL PRIMARY KEY,
        recorrenciaid INT NOT NULL REFERENCES fin_recorrencias(id) ON DELETE CASCADE,
        referencia DATE NOT NULL,
        valor NUMERIC(14,2) NULL,
        pular SMALLINT NOT NULL DEFAULT 0,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (recorrenciaid, referencia)
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fin_titulos (
        id SERIAL PRIMARY KEY,
        groupid INT NULL REFERENCES groups(id) ON DELETE CASCADE,
        userid INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sentido VARCHAR(10) NOT NULL CHECK (sentido IN ('pagar','receber')),
        descricao VARCHAR(200) NOT NULL,
        valor NUMERIC(14,2) NOT NULL CHECK (valor > 0),
        vencimento DATE NOT NULL,
        situacao VARCHAR(10) NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto','quitado')),
        conta_grupoid INT NOT NULL REFERENCES fin_contas(id),
        recorrenciaid INT NULL REFERENCES fin_recorrencias(id),
        referencia DATE NULL,
        lote VARCHAR(40) NULL,
        parcela INT NULL,
        parcelas INT NULL,
        quitado_em DATE NULL,
        valor_pago NUMERIC(14,2) NULL,
        conta_pagamentoid INT NULL REFERENCES fin_contas(id),
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS fin_titulos_ocorrencia ON fin_titulos (recorrenciaid, referencia)
        WHERE recorrenciaid IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_titulos_espaco ON fin_titulos (groupid, userid, situacao, vencimento)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_titulos_lote ON fin_titulos (lote) WHERE lote IS NOT NULL`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fin_lancamentos (
        id SERIAL PRIMARY KEY,
        groupid INT NULL REFERENCES groups(id) ON DELETE CASCADE,
        userid INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        data DATE NOT NULL,
        descricao VARCHAR(200) NOT NULL,
        valor NUMERIC(14,2) NOT NULL CHECK (valor >= 0),
        conta_origemid INT NOT NULL REFERENCES fin_contas(id),
        conta_destinoid INT NOT NULL REFERENCES fin_contas(id),
        quantidade NUMERIC(18,6) NULL,
        preco NUMERIC(18,6) NULL,
        tituloid INT NULL REFERENCES fin_titulos(id) ON DELETE CASCADE,
        lote VARCHAR(40) NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_lancamentos_espaco ON fin_lancamentos (groupid, userid, data)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_lancamentos_origem ON fin_lancamentos (conta_origemid)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_lancamentos_destino ON fin_lancamentos (conta_destinoid)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_lancamentos_titulo ON fin_lancamentos (tituloid) WHERE tituloid IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS fin_lancamentos_lote ON fin_lancamentos (lote) WHERE lote IS NOT NULL`);

    // Leitura pelas consultas de categoria (papel restrito), recortada pelo espaço da execução
    for (const t of TABELAS) {
      await queryRunner.query(`GRANT SELECT ON ${t} TO mm_query_reader`);
      await queryRunner.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`DROP POLICY IF EXISTS mm_app_all ON ${t}`);
      await queryRunner.query(`
        DO $$
        BEGIN
          EXECUTE format('CREATE POLICY mm_app_all ON ${t} FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
        END $$;
      `);
      await queryRunner.query(`DROP POLICY IF EXISTS mm_query_reader_grupo ON ${t}`);
    }
    const recorte = `
      (SELECT public.mm_ctx_ativo())
      AND CASE
        WHEN (SELECT public.mm_ctx_group_id()) IS NOT NULL
          THEN groupid = (SELECT public.mm_ctx_group_id())
        ELSE groupid IS NULL AND userid = (SELECT public.mm_ctx_user_id())
      END`;
    for (const t of ["fin_contas", "fin_lancamentos", "fin_titulos", "fin_recorrencias"]) {
      await queryRunner.query(`CREATE POLICY mm_query_reader_grupo ON ${t} FOR SELECT TO mm_query_reader USING (${recorte})`);
    }
    await queryRunner.query(`
      CREATE POLICY mm_query_reader_grupo ON fin_recorrencia_excecoes FOR SELECT TO mm_query_reader
      USING (EXISTS (SELECT 1 FROM fin_recorrencias r WHERE r.id = fin_recorrencia_excecoes.recorrenciaid))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of ["fin_lancamentos", "fin_titulos", "fin_recorrencia_excecoes", "fin_recorrencias", "fin_contas"]) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t}`);
    }
  }
}
