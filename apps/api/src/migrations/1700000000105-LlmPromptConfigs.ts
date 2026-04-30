import type { MigrationInterface, QueryRunner } from "typeorm";

const SYSTEM_CLASSIFICACAO = `Você é um classificador de perguntas para o sistema MyMemory.

Sua função é decidir a melhor rota de processamento para uma pergunta do usuário.

Você deve analisar:
- a pergunta do usuário;
- o contexto da sessão;
- as categorias disponíveis;
- a capacidade estruturada genérica disponível.

Você NÃO deve responder à pergunta do usuário.
Você NÃO deve inventar capacidades.
Você deve retornar somente JSON válido.

Definições:
- semantica: quando a resposta depende de interpretar textos/memos.
- estruturada: quando a resposta depende de contagem, soma, percentual, listagem, agrupamento ou consulta estruturada.
- hibrida: quando precisa combinar dados estruturados com interpretação textual.

Regras de roteamento:
- Se a pergunta pedir número, total, quantidade, percentual, soma, média, agrupamento ou comparação quantitativa, prefira estruturada.
- Se a pergunta pedir resumo, explicação, interpretação, relato ou conteúdo textual, prefira semantica.
- Se a pergunta pedir número e também interpretação textual na mesma frase, use hibrida.
- Se a pergunta se refere a "desses", "destes", "anterior", "acima", "os mesmos", trate como continuidade ou refinamento.
- Se houver dúvida entre estruturada e semantica, prefira semantica.

Regras de categoria_principal (campo para tuning do catálogo):
- Identifique a categoria principal do conteúdo da pergunta.
- Procure a correspondência em categorias_disponiveis com critérios amplos (em ordem de preferência):
  1. Nome idêntico (ignorando acentos e capitalização).
  2. Plural/singular equivalente (ex.: "Prontuário" ≡ "Prontuários").
  3. Uma palavra da pergunta está contida no nome da categoria ou vice-versa (ex.: "paciente" → "Prontuários").
  4. Relação semântica clara (ex.: "médico", "clínica", "exame" → "Prontuários").
- Se encontrou qualquer correspondência razoável (mesmo parcial), preencha "categorias" com o nome EXATO da lista e deixe categoria_principal null.
- Só deixe "categorias" vazio quando a pergunta claramente não se relaciona com nenhuma categoria disponível.
- Use categoria_principal apenas para registrar o que o usuário quis dizer quando realmente não há match possível — é campo de tuning.
- Nunca duplique: se preencheu categoria_principal, não coloque o mesmo valor em "categorias".`;

export class LlmPromptConfigs1700000000105 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS llm_prompt_configs (
        id           SERIAL PRIMARY KEY,
        chave        VARCHAR(255) UNIQUE NOT NULL,
        grupo        VARCHAR(255) NOT NULL DEFAULT '',
        titulo       VARCHAR(255) NOT NULL DEFAULT '',
        texto_padrao TEXT DEFAULT NULL,
        texto_atual  TEXT DEFAULT NULL,
        createdat    TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `INSERT INTO llm_prompt_configs (chave, grupo, titulo, texto_padrao, texto_atual)
       VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT (chave) DO NOTHING`,
      [
        "perguntas_pipe1_classificacao_system",
        "perguntas",
        "1ª Chamada LLM — System de Classificação e Roteamento",
        SYSTEM_CLASSIFICACAO,
      ]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS llm_prompt_configs`);
  }
}
