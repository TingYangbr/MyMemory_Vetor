import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Ressincroniza as sequences SERIAL de todas as tabelas após inserções manuais.
 * Necessário quando rows foram inseridos manualmente com ID explícito,
 * deixando a sequence atrás do MAX(id) real.
 */
export class ResyncSequences1700000000103 implements MigrationInterface {
  private static readonly TABLES = [
    "users",
    "subscription_plans",
    "subscriptions",
    "groups",
    "group_members",
    "memos",
    "email_invites",
    "media_settings",
    "ai_config",
    "api_usage_logs",
    "download_logs",
    "semantic_logs",
    "system_config",
    "support_chats",
    "usage_alerts",
    "user_auth_tokens",
    "categories",
    "subcategories",
    "categorycampos",
    "dadosespecificos",
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ResyncSequences1700000000103.TABLES) {
      await queryRunner.query(`
        SELECT setval(
          pg_get_serial_sequence('${table}', 'id'),
          COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1,
          false
        )
      `);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Não revertível.
  }
}
