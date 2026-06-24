import type { MigrationInterface, QueryRunner } from "typeorm";

// Reverte o texto_atual do prompt de classificação para NULL.
// texto_atual é domínio do admin (via UI); migrations só devem tocar texto_padrao.
// Com texto_atual = NULL, o sistema usa texto_padrao (atualizado pela migration 141).

export class RevertClassificacaoTextoAtual1700000000142 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE llm_prompt_configs
       SET texto_atual = NULL, updatedat = NOW()
       WHERE chave = 'perguntas_pipe1_classificacao_system'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Não há como restaurar o valor anterior sem conhecê-lo — noop intencional.
  }
}
