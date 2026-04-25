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
      SET passwordhash = '$2b$10$Y64Ic7KvWsYJGDy3vLGbmOt5P44BX9edmtW5Jq47VPbeUMD/s9YoG',
          loginmethod  = 'password',
          emailverified = 1,
          role          = 'admin'
      WHERE email = 'ting8088@gmail.com'
    `);

    await queryRunner.query(`
      INSERT INTO subscriptions (type, userid, ownerid, planid, status)
      SELECT 'individual', u.id, u.id, p.id, 'active'
      FROM users u
      CROSS JOIN (
        SELECT id FROM subscription_plans WHERE plantype = 'individual' AND isactive = 1 ORDER BY id LIMIT 1
      ) AS p
      WHERE u.email = 'ting8088@gmail.com'
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.userid = u.id AND s.type = 'individual'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM subscriptions s
      USING users u
      WHERE u.id = s.userid AND u.email = 'ting8088@gmail.com' AND s.type = 'individual'
    `);
    await queryRunner.query(`
      DELETE FROM users WHERE email IN ('ting8088@gmail.com', 'dev@mymemory.local')
    `);
  }
}
