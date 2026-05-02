import type { MigrationInterface, QueryRunner } from "typeorm";

export class SemanticBuscaMinSimilarity1700000000106 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO system_config (configkey, configvalue, description, updatedat, updatedbyuserid)
       VALUES ($1, $2, $3, NOW(), NULL)
       ON CONFLICT (configkey) DO NOTHING`,
      [
        "semanticBuscaMinSimilarity",
        "0.5",
        "Similaridade mínima (0–1) para exibir resultados na Busca Semântica de Memos. Padrão: 0.5 (50%).",
      ]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM system_config WHERE configkey = 'semanticBuscaMinSimilarity'`
    );
  }
}
