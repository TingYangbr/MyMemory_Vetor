import type { MigrationInterface, QueryRunner } from "typeorm";

// Override de planejamento para todas as categorias "Imóvel" (uma por grupo).
// Explica ao LLM a inversão de perspectiva comprador/vendedor no domínio imobiliário,
// para que o parâmetro de intenção seja mapeado corretamente.

const TEXTO_OVERRIDE = `{{base_prompt}}

REGRAS ESPECÍFICAS — CATEGORIA IMÓVEL (inversão de perspectiva comprador/vendedor):

O filtro de intenção deve refletir a perspectiva do REGISTRO no banco, não a do usuário.

Caso 1 — objeto da busca é o IMÓVEL:
  Pergunta: "Procuro apartamentos para COMPRAR" / "Quero alugar uma sala"
  → O usuário é comprador/locatário.
  → Os registros de imóveis disponíveis têm intencao = "vender" ou intencao = "alugar".
  → Filtrar por intencao = "vender" (ou "alugar"). NÃO filtrar por "comprar".

Caso 2 — objeto da busca é a PESSOA/CLIENTE:
  Pergunta: "Procuro clientes que querem COMPRAR apartamento" / "Leads interessados em alugar"
  → O usuário procura compradores/locatários cadastrados.
  → Os registros de clientes têm intencao = "comprar" ou intencao = "alugar".
  → Filtrar por intencao = "comprar" (ou "alugar"). Intenção direta.

Regra de identificação do caso:
  - Se o substantivo principal da busca é um BEM (apartamento, casa, sala, terreno, imóvel, loja) → Caso 1 (inverter).
  - Se o substantivo principal é uma PESSOA (cliente, contato, lead, comprador, locatário) → Caso 2 (direto).`;

export class ImovelPlanejamentoOverride1700000000139 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insere override para todas as categorias chamadas "Imóvel" (qualquer grupo).
    // ON CONFLICT preserva overrides existentes caso o admin já tenha customizado.
    await queryRunner.query(
      `INSERT INTO llm_prompt_category_overrides (prompt_chave, category_id, texto, updatedat)
       SELECT 'perguntas_pipe2_planejamento_estruturado_system', id, $1, NOW()
       FROM categories
       WHERE name = 'Imóvel'
       ON CONFLICT (prompt_chave, category_id) DO NOTHING`,
      [TEXTO_OVERRIDE]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM llm_prompt_category_overrides
       WHERE prompt_chave = 'perguntas_pipe2_planejamento_estruturado_system'
         AND category_id IN (SELECT id FROM categories WHERE name = 'Imóvel')
         AND texto = $1`,
      [TEXTO_OVERRIDE]
    );
  }
}
