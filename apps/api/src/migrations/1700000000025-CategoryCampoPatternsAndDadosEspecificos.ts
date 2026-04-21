import type { MigrationInterface, QueryRunner } from "typeorm";

export class CategoryCampoPatternsAndDadosEspecificos1700000000025
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const colRows = (await queryRunner.query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name   = 'categorycampos'
        AND column_name  = 'normalizedterms'
    `)) as Array<{ cnt: string }>;
    if (Number(colRows[0]?.cnt ?? 0) === 0) {
      await queryRunner.query(`
        ALTER TABLE categorycampos ADD COLUMN IF NOT EXISTS normalizedterms TEXT NULL
      `);
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS dadosespecificos (
        id               SERIAL PRIMARY KEY,
        id_categoria     INT NULL,
        id_memo          INT NOT NULL,
        label            VARCHAR(255) NOT NULL,
        dadooriginal     TEXT NULL,
        dadopadronizado  TEXT NULL,
        isactive         INT NOT NULL DEFAULT 1,
        createdat        TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat        TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_dadosespecificos_memo_025      FOREIGN KEY (id_memo)      REFERENCES memos(id) ON DELETE CASCADE,
        CONSTRAINT fk_dadosespecificos_categoria_025 FOREIGN KEY (id_categoria) REFERENCES categories(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_dadosespecificos_memo_025      ON dadosespecificos (id_memo)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_dadosespecificos_categoria_025 ON dadosespecificos (id_categoria)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS dadosespecificos`);
    await queryRunner.query(`ALTER TABLE categorycampos DROP COLUMN IF EXISTS normalizedterms`);
  }
}
