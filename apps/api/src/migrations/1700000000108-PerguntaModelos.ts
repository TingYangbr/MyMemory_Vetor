import type { MigrationInterface, QueryRunner } from "typeorm";

export class PerguntaModelos1700000000108 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pergunta_modelos (
        id        SERIAL PRIMARY KEY,
        userid    INTEGER NOT NULL,
        groupid   INTEGER NULL,
        category  TEXT NULL,
        pergunta  TEXT NOT NULL,
        createdat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updatedat TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_pergunta_modelos_userid ON pergunta_modelos (userid)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_pergunta_modelos_groupid ON pergunta_modelos (groupid)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS pergunta_modelos`);
  }
}
