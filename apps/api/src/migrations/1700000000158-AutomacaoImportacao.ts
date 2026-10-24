import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Importação automática ("Automatizar" na Importação em Lote): uma pasta (disco/rede do servidor
 * ou WebDAV) verificada periodicamente; arquivos novos com situação "Pronto" viram memos do grupo.
 */
export class AutomacaoImportacao1700000000158 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS batch_automacoes (
        id                  SERIAL PRIMARY KEY,
        groupid             INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        userid              INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pasta               TEXT NOT NULL,
        ia_level            VARCHAR(10) NOT NULL DEFAULT 'basico'
                              CHECK (ia_level IN ('semIA','basico','completo')),
        intervalo_min       INT NOT NULL DEFAULT 60,
        copiar_arquivo      SMALLINT NOT NULL DEFAULT 0,
        limite_execucao     INT NOT NULL DEFAULT 50,
        avisar_email        SMALLINT NOT NULL DEFAULT 1,
        ativo               SMALLINT NOT NULL DEFAULT 1,
        proxima_execucao    TIMESTAMP NOT NULL DEFAULT NOW(),
        executando_desde    TIMESTAMP NULL,
        ultima_execucao     TIMESTAMP NULL,
        ultimo_status       VARCHAR(20) NULL,
        ultimo_resumo       TEXT NULL,
        falhas_seguidas     INT NOT NULL DEFAULT 0,
        createdat           TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat           TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_batch_automacoes_proxima ON batch_automacoes (proxima_execucao) WHERE ativo = 1`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS batch_automacao_execucoes (
        id            SERIAL PRIMARY KEY,
        automacaoid   INT NOT NULL REFERENCES batch_automacoes(id) ON DELETE CASCADE,
        origem        VARCHAR(10) NOT NULL DEFAULT 'agendada',
        inicio        TIMESTAMP NOT NULL DEFAULT NOW(),
        fim           TIMESTAMP NULL,
        status        VARCHAR(20) NOT NULL,
        encontrados   INT NOT NULL DEFAULT 0,
        importados    INT NOT NULL DEFAULT 0,
        pulados       INT NOT NULL DEFAULT 0,
        erros         INT NOT NULL DEFAULT 0,
        sem_dono      INT NOT NULL DEFAULT 0,
        mensagem      TEXT NULL,
        detalhes      JSONB NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_batch_automacao_exec ON batch_automacao_execucoes (automacaoid, inicio DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS batch_automacao_execucoes`);
    await queryRunner.query(`DROP TABLE IF EXISTS batch_automacoes`);
  }
}
