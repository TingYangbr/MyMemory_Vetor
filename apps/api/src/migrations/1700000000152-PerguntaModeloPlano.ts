import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * pergunta_modelos.plano_json — classificação + plano do planejador guardados ao salvar a pergunta.
 * Reexecução pula as chamadas de IA de classificação/planejamento; os parâmetros viram chips na frase.
 * NULL = pergunta salva comum (comportamento anterior).
 */
export class PerguntaModeloPlano1700000000152 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pergunta_modelos ADD COLUMN IF NOT EXISTS plano_json JSONB NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pergunta_modelos DROP COLUMN IF EXISTS plano_json`);
  }
}
