import type { MigrationInterface, QueryRunner } from "typeorm";

// Corrige busca de contatos no ERP (SQL Server) e ajusta regras do planejador e resposta:
// 1. Contatos_ERP: wildcards embutidos no SQL para match parcial (SQL Server não injeta % automaticamente)
// 2. Planner override "Contatos": 1-2 palavras → abrev_contato; 3+ palavras → nome_contato
// 3. Response override "Contatos": >20 resultados pede refinamento; 0 resultados sugere grafia

export class ContatosWildcardAndResponseRules1700000000145 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Contatos_ERP — adiciona '%' + param + '%' nas colunas Abrev_Contato e Nome_Contato
    await queryRunner.query(
      `UPDATE queries_categoria
       SET sentencasql = REPLACE(
             REPLACE(sentencasql, $1, $2),
             $3, $4
           ),
           updatedat = NOW()
       WHERE nome = 'Contatos_ERP'`,
      [
        "CONTT.Abrev_Contato LIKE @Abrev_Contato",
        "CONTT.Abrev_Contato LIKE '%' + @Abrev_Contato + '%'",
        "CONTT.Nome_Contato LIKE @Nome_Contato",
        "CONTT.Nome_Contato LIKE '%' + @Nome_Contato + '%'",
      ]
    );

    // 2. Override do planejador "Contatos" — corrige regra de mapeamento de nome
    await queryRunner.query(
      `UPDATE llm_prompt_category_overrides
       SET texto = REPLACE(
             REPLACE(texto, $1, $2),
             $3, $4
           ),
           updatedat = NOW()
       WHERE prompt_chave = 'perguntas_pipe2_planejamento_estruturado_system'
         AND category_id IN (SELECT id FROM categories WHERE name = 'Contatos')`,
      [
        '  - Primeiro nome apenas (ex: "Paulo") → abrev_contato LIKE',
        '  - 1-2 palavras (ex: "Paulo", "José Américo") → abrev_contato LIKE',
        '  - Nome completo (ex: "Paulo Luna") → nome_contato LIKE',
        '  - 3+ palavras (ex: "José Américo Pinto") → nome_contato LIKE',
      ]
    );

    // 3. Override de resposta para categoria "Contatos" — volume de resultados
    const RESPOSTA_CONTATOS_OVERRIDE = `{{base_prompt}}

Volume de resultados — Contatos:
- Mais de 20 registros: não liste todos — informe a quantidade encontrada e peça ao usuário para refinar a busca (ex: empresa, cargo ou outro critério).
- Zero registros: informe claramente e sugira verificar variações de grafia comuns em português (ex: "Luis" → "Luiz", "César" → "Cézar").`;

    await queryRunner.query(
      `INSERT INTO llm_prompt_category_overrides (prompt_chave, category_id, texto, updatedat)
       SELECT 'perguntas_pipe2_resposta_estruturada_system', id, $1, NOW()
       FROM categories
       WHERE name = 'Contatos'
       ON CONFLICT (prompt_chave, category_id) DO UPDATE
         SET texto = EXCLUDED.texto, updatedat = NOW()`,
      [RESPOSTA_CONTATOS_OVERRIDE]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverte wildcards do Contatos_ERP
    await queryRunner.query(
      `UPDATE queries_categoria
       SET sentencasql = REPLACE(
             REPLACE(sentencasql, $1, $2),
             $3, $4
           ),
           updatedat = NOW()
       WHERE nome = 'Contatos_ERP'`,
      [
        "CONTT.Abrev_Contato LIKE '%' + @Abrev_Contato + '%'",
        "CONTT.Abrev_Contato LIKE @Abrev_Contato",
        "CONTT.Nome_Contato LIKE '%' + @Nome_Contato + '%'",
        "CONTT.Nome_Contato LIKE @Nome_Contato",
      ]
    );

    // Reverte regra do planejador
    await queryRunner.query(
      `UPDATE llm_prompt_category_overrides
       SET texto = REPLACE(
             REPLACE(texto, $1, $2),
             $3, $4
           ),
           updatedat = NOW()
       WHERE prompt_chave = 'perguntas_pipe2_planejamento_estruturado_system'
         AND category_id IN (SELECT id FROM categories WHERE name = 'Contatos')`,
      [
        '  - 1-2 palavras (ex: "Paulo", "José Américo") → abrev_contato LIKE',
        '  - Primeiro nome apenas (ex: "Paulo") → abrev_contato LIKE',
        '  - 3+ palavras (ex: "José Américo Pinto") → nome_contato LIKE',
        '  - Nome completo (ex: "Paulo Luna") → nome_contato LIKE',
      ]
    );

    // Reverte override de resposta de "Contatos"
    await queryRunner.query(
      `DELETE FROM llm_prompt_category_overrides
       WHERE prompt_chave = 'perguntas_pipe2_resposta_estruturada_system'
         AND category_id IN (SELECT id FROM categories WHERE name = 'Contatos')`,
    );
  }
}
