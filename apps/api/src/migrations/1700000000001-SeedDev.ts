import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Seed inicial — dados mínimos para rodar o projeto.
 * Todas as inserções são idempotentes (ON DUPLICATE KEY UPDATE ou NOT EXISTS).
 */
export class SeedDev1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("SET NAMES utf8mb4");

    // ------------------------------------------------------------------ //
    // Planos de assinatura
    // ------------------------------------------------------------------ //

    await queryRunner.query(`
      INSERT INTO subscription_plans (
        name, planType, price, maxMemos, maxStorageGB, maxMembers,
        durationDays, isActive, monthlyApiCredits, monthlyDownloadLimitGB,
        supportLargeAudio, supportLargeVideo
      )
      SELECT 'Grupo Starter', 'group', 0.00, 500, 5.00, 10,
             NULL, 1, NULL, NULL, 0, 0
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM subscription_plans WHERE planType = 'group' AND isActive = 1 LIMIT 1
      )
    `);

    await queryRunner.query(`
      INSERT INTO subscription_plans (name, planType, price, maxMemos, maxStorageGB, maxMembers, isActive)
      SELECT 'Individual', 'individual', 0, 500, 2.00, NULL, 1
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM subscription_plans WHERE planType = 'individual' LIMIT 1
      )
    `);

    // ------------------------------------------------------------------ //
    // Usuário local de desenvolvimento
    // ------------------------------------------------------------------ //

    await queryRunner.query(`
      INSERT INTO users (openId, name, email, loginMethod, emailVerified)
      VALUES ('dev-local-openid', 'Usuário Dev', 'dev@mymemory.local', 'dev', 1)
      ON DUPLICATE KEY UPDATE name = VALUES(name)
    `);

    await queryRunner.query(`
      UPDATE users SET role = 'admin' WHERE email = 'dev@mymemory.local' LIMIT 1
    `);

    // ------------------------------------------------------------------ //
    // Admin: ting8088@gmail.com — senha local: Ting8088!dev
    // ------------------------------------------------------------------ //

    await queryRunner.query(`
      INSERT INTO users (openId, name, email, loginMethod, emailVerified, role)
      VALUES ('seed-ting8088', 'Ting', 'ting8088@gmail.com', 'password', 1, 'admin')
      ON DUPLICATE KEY UPDATE
        name          = VALUES(name),
        role          = 'admin',
        emailVerified = 1
    `);

    await queryRunner.query(`
      UPDATE users
      SET
        passwordHash  = '$2b$10$EmjchteMvFMj4/ACt4oa7uNQXaG4mJ6HXlb0/OWLP74ADZ194Rw6i',
        loginMethod   = 'password',
        emailVerified = 1,
        role          = 'admin'
      WHERE email = 'ting8088@gmail.com'
      LIMIT 1
    `);

    // ------------------------------------------------------------------ //
    // Assinatura de grupo
    // ------------------------------------------------------------------ //

    await queryRunner.query(`
      INSERT INTO subscriptions (type, userId, ownerId, planId, status)
      SELECT 'group', NULL, u.id, p.id, 'active'
      FROM users u
      CROSS JOIN (
        SELECT id FROM subscription_plans WHERE planType = 'group' ORDER BY id LIMIT 1
      ) AS p
      WHERE u.email = 'ting8088@gmail.com'
        AND NOT EXISTS (
          SELECT 1
          FROM subscriptions s
          WHERE s.ownerId = u.id AND s.type = 'group' AND s.status = 'active'
        )
    `);

    // ------------------------------------------------------------------ //
    // Grupo "Teste"
    // ------------------------------------------------------------------ //

    await queryRunner.query(`
      INSERT INTO \`groups\` (name, description, subscriptionId, isPublic, maxSummaryLength, allowPersonalContext)
      SELECT
        'Teste',
        'Grupo criado pelo seed (docs/seed-dev.sql)',
        s.id,
        0,
        1000,
        1
      FROM subscriptions s
      INNER JOIN users u ON u.id = s.ownerId
      WHERE u.email = 'ting8088@gmail.com'
        AND s.type   = 'group'
        AND s.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM \`groups\` g
          WHERE g.subscriptionId = s.id AND g.name = 'Teste'
        )
    `);

    // ------------------------------------------------------------------ //
    // Membership: owner do grupo
    // ------------------------------------------------------------------ //

    await queryRunner.query(`
      INSERT INTO group_members (groupId, userId, role)
      SELECT g.id, u.id, 'owner'
      FROM \`groups\` g
      INNER JOIN subscriptions s ON s.id = g.subscriptionId
      INNER JOIN users u ON u.id = s.ownerId
      WHERE g.name = 'Teste'
        AND u.email = 'ting8088@gmail.com'
      ON DUPLICATE KEY UPDATE role = 'owner'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove memberships do grupo semente
    await queryRunner.query(`
      DELETE gm FROM group_members gm
      INNER JOIN \`groups\` g  ON g.id  = gm.groupId
      INNER JOIN users u       ON u.id  = gm.userId
      WHERE g.name = 'Teste' AND u.email = 'ting8088@gmail.com'
    `);

    // Remove o grupo semente
    await queryRunner.query(`
      DELETE g FROM \`groups\` g
      INNER JOIN subscriptions s ON s.id = g.subscriptionId
      INNER JOIN users u         ON u.id = s.ownerId
      WHERE g.name = 'Teste' AND u.email = 'ting8088@gmail.com'
    `);

    // Remove a assinatura de grupo do ting8088
    await queryRunner.query(`
      DELETE s FROM subscriptions s
      INNER JOIN users u ON u.id = s.ownerId
      WHERE u.email = 'ting8088@gmail.com' AND s.type = 'group'
    `);

    // Remove os usuários semente
    await queryRunner.query(`
      DELETE FROM users WHERE email IN ('ting8088@gmail.com', 'dev@mymemory.local')
    `);

    // Remove os planos semente
    await queryRunner.query(`
      DELETE FROM subscription_plans WHERE name IN ('Plano Grupo (seed)', 'Individual (seed)')
    `);
  }
}
