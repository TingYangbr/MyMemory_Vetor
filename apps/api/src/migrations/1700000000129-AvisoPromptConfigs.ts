import type { MigrationInterface, QueryRunner } from "typeorm";

const SYSTEM_SUGESTAO = `Você gera frases curtas de monitoramento para alertas automáticos.`;

const SYSTEM_DESTAQUE_MUDANCA = `Você analisa mudanças em resultados de monitoramento automático e gera um aviso destacando o que mudou entre o resultado anterior e o atual. Responda em português, de forma concisa e direta, máximo 3 frases.`;

export class AvisoPromptConfigs1700000000129 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO llm_prompt_configs (chave, grupo, titulo, texto_padrao, texto_atual)
       VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT (chave) DO NOTHING`,
      [
        "avisos_sugestao_system",
        "avisos",
        "Aviso — System de Sugestão de Frase de Monitoramento",
        SYSTEM_SUGESTAO,
      ]
    );

    await queryRunner.query(
      `INSERT INTO llm_prompt_configs (chave, grupo, titulo, texto_padrao, texto_atual)
       VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT (chave) DO NOTHING`,
      [
        "avisos_destaque_mudanca_system",
        "avisos",
        "6ª Chamada LLM — System de Destaque de Mudança",
        SYSTEM_DESTAQUE_MUDANCA,
      ]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM llm_prompt_configs WHERE chave IN ('avisos_sugestao_system', 'avisos_destaque_mudanca_system')`
    );
  }
}
