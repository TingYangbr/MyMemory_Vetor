import type { MigrationInterface, QueryRunner } from "typeorm";

export class QueriesCategoria1700000000027 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS queries_categoria (
        id          SERIAL PRIMARY KEY,
        categoryid  INT NOT NULL,
        nome        VARCHAR(255) NOT NULL,
        descricao   TEXT DEFAULT NULL,
        sentencasql TEXT NOT NULL,
        isactive    INT NOT NULL DEFAULT 1,
        createdat   TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat   TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_queries_categoria_category FOREIGN KEY (categoryid) REFERENCES categories(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS ix_queries_categoria_categoryid ON queries_categoria (categoryid)`
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS queries_categoria_params (
        id          SERIAL PRIMARY KEY,
        queryid     INT NOT NULL,
        campo       VARCHAR(255) NOT NULL,
        tipo        VARCHAR(50) NOT NULL DEFAULT 'string',
        obrigatorio INT NOT NULL DEFAULT 1,
        operadorsql VARCHAR(50) NOT NULL DEFAULT '=',
        normalizar  INT NOT NULL DEFAULT 0,
        ordem       INT NOT NULL DEFAULT 0,
        isactive    INT NOT NULL DEFAULT 1,
        createdat   TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat   TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_queries_categoria_params_query FOREIGN KEY (queryid) REFERENCES queries_categoria(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS ix_queries_categoria_params_queryid ON queries_categoria_params (queryid)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS queries_categoria_params`);
    await queryRunner.query(`DROP TABLE IF EXISTS queries_categoria`);
  }
}
