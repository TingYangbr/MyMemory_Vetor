import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Resultado da reunião pelo sino: depois que um compromisso (ex.: Agenda) termina, o sino pergunta "Registrar o
 * resultado?" com "Registrar" (Catalogar ligado à agenda) e "Não precisa". Não há estado novo na agenda.
 *  - users.pergunta_resultado: sempre | com_pessoas (só compromissos com outras pessoas) | nunca.
 *  - reuniao_resultado_dispensa: compromissos em que o usuário disse "Não precisa" (não pergunta de novo).
 */
export class ResultadoReuniao1700000000222 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS pergunta_resultado VARCHAR(12) NOT NULL DEFAULT 'sempre'`
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reuniao_resultado_dispensa (
        userid INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        memoid INT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (userid, memoid)
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS reuniao_resultado_dispensa`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS pergunta_resultado`);
  }
}
