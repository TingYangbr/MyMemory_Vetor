import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAvisos1700000000128 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS avisos (
        id                   SERIAL PRIMARY KEY,
        userid               INT NOT NULL,
        groupid              INT NULL,
        descricao            TEXT NOT NULL,
        perguntaoriginal     TEXT NOT NULL,
        pipe                 VARCHAR(20) NOT NULL CHECK (pipe IN ('semantica','estruturada','hibrida')),
        execucaosnapshotjson JSONB NOT NULL,
        frequenciatipo       VARCHAR(20) NOT NULL CHECK (frequenciatipo IN ('horas','diaria','semanal','mensal')),
        frequenciahoras      INT NULL CHECK (frequenciahoras BETWEEN 1 AND 12),
        canalenvio           VARCHAR(20) NOT NULL DEFAULT 'email',
        canaldestino         VARCHAR(255) NOT NULL,
        ultimoresultadojson  JSONB NULL,
        ultimaexecucao       TIMESTAMPTZ NULL,
        proximaexecucao      TIMESTAMPTZ NULL,
        status               VARCHAR(20) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','pausado')),
        createdat            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_avisos_user  FOREIGN KEY (userid)  REFERENCES users(id)  ON DELETE CASCADE,
        CONSTRAINT fk_avisos_group FOREIGN KEY (groupid) REFERENCES groups(id) ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_avisos_userid          ON avisos (userid)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_avisos_proximaexecucao ON avisos (proximaexecucao)
        WHERE status = 'ativo'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS aviso_historico (
        id         SERIAL PRIMARY KEY,
        avisoid    INT NOT NULL,
        enviadoem  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        texto      TEXT NOT NULL,
        custousd   DECIMAL(12,8) NOT NULL DEFAULT 0,
        CONSTRAINT fk_ah_aviso FOREIGN KEY (avisoid) REFERENCES avisos(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_aviso_historico_avisoid ON aviso_historico (avisoid, enviadoem DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS aviso_historico CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS avisos CASCADE`);
  }
}
