import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Garante que todo usuário existente tenha pelo menos uma subscription individual ativa.
 * Corrige bases criadas antes de SeedDev incluir a subscription individual do usuário semeado.
 */
export class BackfillIndividualSubscriptions1700000000102 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO subscriptions (type, userid, ownerid, planid, status)
      SELECT 'individual', u.id, u.id, p.id, 'active'
      FROM users u
      CROSS JOIN (
        SELECT id FROM subscription_plans
        WHERE plantype = 'individual' AND isactive = 1
        ORDER BY id LIMIT 1
      ) AS p
      WHERE NOT EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.userid = u.id AND s.type = 'individual'
      )
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Não revertível com segurança: subscriptions individuais podem ter vindo
    // tanto desta migration quanto de registros normais de usuário.
  }
}
