import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Habilita pgvector e cria memo_chunks para busca semântica.
 * Relação 1:N (um memo → vários chunks), cada chunk com embedding vector(1536).
 */
export class PgvectorMemoChunks1700000000100 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS memo_chunks (
        id         SERIAL PRIMARY KEY,
        memo_id    INT NOT NULL,
        chunk_idx  SMALLINT NOT NULL,
        chunk_text TEXT NOT NULL,
        embedding  vector(1536),
        createdat  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_memo_chunks_memo FOREIGN KEY (memo_id) REFERENCES memos(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_memo_chunks_memo_id ON memo_chunks (memo_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_memo_chunks_embedding
      ON memo_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS memo_chunks CASCADE`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS vector`);
  }
}
