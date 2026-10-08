import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Lembretes (docs/Desenho_Lembretes_myMemory_v2.docx).
 * lembrete_regras: configuração por categoria — campo de data/hora, antecedências, destinatário, texto.
 * lembretes_enviados: controle "já avisei"; chave única regra + item + momento + antecedência, de modo que
 * cada lembrete sai uma vez e um compromisso remarcado (momento diferente) gera lembrete novo.
 * Colunas de ERP (queryid, campo_chave, filtros_fixos, colunas_exibidas, horario_execucao) já existem para a
 * segunda etapa; nesta etapa só a origem 'memos' é executada.
 */
export class Lembretes1700000000151 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS lembrete_regras (
        id                  SERIAL PRIMARY KEY,
        categoryid          INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        origem              VARCHAR(10) NOT NULL DEFAULT 'memos' CHECK (origem IN ('memos','erp')),
        ativo               SMALLINT NOT NULL DEFAULT 1,
        campo_data          VARCHAR(255) NOT NULL,
        campo_horario       VARCHAR(255) NULL,
        antecedencias_min   INT[] NOT NULL DEFAULT '{1440,60}',
        destinatario_tipo   VARCHAR(10) NOT NULL DEFAULT 'autor'
                              CHECK (destinatario_tipo IN ('autor','grupo','owner','email')),
        destinatario_valor  TEXT NULL,
        campo_antecedencia  VARCHAR(255) NULL,
        campo_destinatario  VARCHAR(255) NULL,
        campo_lembrete      VARCHAR(255) NULL,
        modelo_texto        TEXT NULL,
        horario_padrao      VARCHAR(5) NOT NULL DEFAULT '08:00',
        lembrar_importados  SMALLINT NOT NULL DEFAULT 0,
        intervalo_min       INT NOT NULL DEFAULT 15,
        ultima_execucao     TIMESTAMPTZ NULL,
        -- segunda etapa (origem ERP)
        queryid             INT NULL REFERENCES queries_categoria(id) ON DELETE SET NULL,
        campo_chave         VARCHAR(255) NULL,
        filtros_fixos       JSONB NULL,
        colunas_exibidas    TEXT[] NULL,
        horario_execucao    VARCHAR(5) NULL,
        createdat           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updatedat           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS ix_lembrete_regras_categoryid ON lembrete_regras (categoryid)`
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS lembretes_enviados (
        id                SERIAL PRIMARY KEY,
        regraid           INT NOT NULL REFERENCES lembrete_regras(id) ON DELETE CASCADE,
        chave_item        VARCHAR(255) NOT NULL,
        momento_alvo      TIMESTAMPTZ NOT NULL,
        antecedencia_min  INT NOT NULL,
        situacao          VARCHAR(10) NOT NULL DEFAULT 'enviado' CHECK (situacao IN ('enviado','ignorado')),
        destino           TEXT NULL,
        observacao        TEXT NULL,
        enviadoem         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ux_lembretes_enviados UNIQUE (regraid, chave_item, momento_alvo, antecedencia_min)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS lembretes_enviados`);
    await queryRunner.query(`DROP TABLE IF EXISTS lembrete_regras`);
  }
}
