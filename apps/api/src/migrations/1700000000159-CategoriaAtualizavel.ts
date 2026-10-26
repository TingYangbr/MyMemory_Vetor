import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Categorias "atualizáveis" (agenda, tarefas, pedidos): os memos mudam de situação.
 *  - categories.atualizavel / campo_situacao — marca e o campo com Ativo, Concluído ou Cancelado;
 *  - memos.criado_por — quem catalogou (userid muda quando o memo passa ao dono, categoria Pessoal);
 *    nulo = o próprio userid;
 *  - memo_alteracoes — histórico das alterações (antes/depois por campo), agrupadas por lote
 *    (um "Salvar"), para desfazer e para perguntas ("quem cancelou?").
 */
export class CategoriaAtualizavel1700000000159 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS atualizavel SMALLINT NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS campo_situacao VARCHAR(255) NULL`);
    await queryRunner.query(`ALTER TABLE memos ADD COLUMN IF NOT EXISTS criado_por INTEGER NULL`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS memo_alteracoes (
        id SERIAL PRIMARY KEY,
        memoid INTEGER NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
        lote VARCHAR(36) NOT NULL,
        userid INTEGER NULL,
        campo VARCHAR(255) NOT NULL,
        antes TEXT NULL,
        depois TEXT NULL,
        origem VARCHAR(20) NOT NULL DEFAULT 'edicao',
        createdat TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_memo_alteracoes_memo ON memo_alteracoes (memoid, createdat)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_memo_alteracoes_lote ON memo_alteracoes (lote)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS memo_alteracoes`);
    await queryRunner.query(`ALTER TABLE memos DROP COLUMN IF EXISTS criado_por`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS campo_situacao`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS atualizavel`);
  }
}
