import type { MigrationInterface, QueryRunner } from "typeorm";

export class DbConnections1700000000110 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS db_connections (
        id          SERIAL PRIMARY KEY,
        nome        VARCHAR(255) NOT NULL,
        descricao   TEXT DEFAULT NULL,
        host        VARCHAR(255) NOT NULL,
        port        INT NOT NULL DEFAULT 1433,
        database    VARCHAR(255) NOT NULL,
        username    VARCHAR(255) NOT NULL,
        password    TEXT NOT NULL DEFAULT '',
        encrypt     INT NOT NULL DEFAULT 0,
        trustservercertificate INT NOT NULL DEFAULT 1,
        isactive    INT NOT NULL DEFAULT 1,
        createdat   TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE queries_categoria
        ADD COLUMN IF NOT EXISTS conexaoid INT NULL
          REFERENCES db_connections(id) ON DELETE SET NULL
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS ix_queries_categoria_conexaoid ON queries_categoria (conexaoid)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE queries_categoria DROP COLUMN IF EXISTS conexaoid`);
    await queryRunner.query(`DROP TABLE IF EXISTS db_connections`);
  }
}
