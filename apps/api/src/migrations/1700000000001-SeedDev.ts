import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Seed inicial — dados mínimos para rodar o projeto.
 * Usa identificadores lowercase (padrão PostgreSQL sem aspas).
 */
export class SeedDev1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO subscription_plans (name, plantype, price, maxmemos, maxstoragegb, maxmembers,
        durationdays, isactive, monthlyapicredits, monthlydownloadlimitgb, supportlargeaudio, supportlargevideo)
      SELECT 'Grupo Starter', 'group', 0.00, 500, 5.00, 10, NULL, 1, NULL, NULL, 0, 0
      WHERE NOT EXISTS (
        SELECT 1 FROM subscription_plans WHERE plantype = 'group' AND isactive = 1 LIMIT 1
      )
    `);

    await queryRunner.query(`
      INSERT INTO subscription_plans (name, plantype, price, maxmemos, maxstoragegb, maxmembers, isactive)
      SELECT 'Individual', 'individual', 0, 500, 2.00, NULL, 1
      WHERE NOT EXISTS (
        SELECT 1 FROM subscription_plans WHERE plantype = 'individual' LIMIT 1
      )
    `);

    await queryRunner.query(`
      INSERT INTO users (openid, name, email, loginmethod, emailverified)
      VALUES ('dev-local-openid', 'Usuário Dev', 'dev@mymemory.local', 'dev', 1)
      ON CONFLICT (openid) DO UPDATE SET name = EXCLUDED.name
    `);

    await queryRunner.query(`
      UPDATE users SET role = 'admin' WHERE email = 'dev@mymemory.local'
    `);

    await queryRunner.query(`
      INSERT INTO users (openid, name, email, loginmethod, emailverified, role)
      VALUES ('seed-ting8088', 'Ting', 'ting8088@gmail.com', 'password', 1, 'admin')
      ON CONFLICT (openid) DO UPDATE SET name = EXCLUDED.name, role = 'admin', emailverified = 1
    `);

    await queryRunner.query(`
      UPDATE users
      SET passwordhash = '$2b$10$EmjchteMvFMj4/ACt4oa7uNQXaG4mJ6HXlb0/OWLP74ADZ194Rw6i',
          loginmethod  = 'password',
          emailverified = 1,
          role          = 'admin'
      WHERE email = 'ting8088@gmail.com'
    `);

    await queryRunner.query(`
      INSERT INTO subscriptions (type, userid, ownerid, planid, status)
      SELECT 'group', NULL, u.id, p.id, 'active'
      FROM users u
      CROSS JOIN (
        SELECT id FROM subscription_plans WHERE plantype = 'group' ORDER BY id LIMIT 1
      ) AS p
      WHERE u.email = 'ting8088@gmail.com'
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.ownerid = u.id AND s.type = 'group' AND s.status = 'active'
        )
    `);

    await queryRunner.query(`
      INSERT INTO groups (name, description, subscriptionid, ispublic, maxsummarylength, allowpersonalcontext)
      SELECT 'Teste', 'Grupo criado pelo seed', s.id, 0, 1000, 1
      FROM subscriptions s
      INNER JOIN users u ON u.id = s.ownerid
      WHERE u.email = 'ting8088@gmail.com'
        AND s.type   = 'group'
        AND s.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM groups g WHERE g.subscriptionid = s.id AND g.name = 'Teste'
        )
    `);

    await queryRunner.query(`
      INSERT INTO group_members (groupid, userid, role)
      SELECT g.id, u.id, 'owner'
      FROM groups g
      INNER JOIN subscriptions s ON s.id = g.subscriptionid
      INNER JOIN users u ON u.id = s.ownerid
      WHERE g.name = 'Teste' AND u.email = 'ting8088@gmail.com'
      ON CONFLICT (groupid, userid) DO UPDATE SET role = 'owner'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM group_members gm
      USING groups g, users u
      WHERE g.id = gm.groupid AND u.id = gm.userid
        AND g.name = 'Teste' AND u.email = 'ting8088@gmail.com'
    `);
    await queryRunner.query(`
      DELETE FROM groups g
      USING subscriptions s, users u
      WHERE s.id = g.subscriptionid AND u.id = s.ownerid
        AND g.name = 'Teste' AND u.email = 'ting8088@gmail.com'
    `);
    await queryRunner.query(`
      DELETE FROM subscriptions s
      USING users u
      WHERE u.id = s.ownerid AND u.email = 'ting8088@gmail.com' AND s.type = 'group'
    `);
    await queryRunner.query(`
      DELETE FROM users WHERE email IN ('ting8088@gmail.com', 'dev@mymemory.local')
    `);
  }
}
