import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * group_api_keys — autenticação servidor-a-servidor (ex.: Softing-erp chamando /api/perguntas
 * sem usuário logado no myMemory). A key resolve para um userId real já existente (um "usuário
 * de serviço" por tenant/grupo), então todo o resto do código (api_usage_logs, checagem de
 * acesso a grupo) continua funcionando sem alteração.
 */
export class GroupApiKeys1700000000146 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS group_api_keys (
        id          SERIAL PRIMARY KEY,
        groupid     INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        userid      INT NOT NULL REFERENCES users(id),
        nome        VARCHAR(255) NOT NULL,
        keyhash     TEXT NOT NULL,
        keyprefix   VARCHAR(12) NOT NULL,
        isactive    INT NOT NULL DEFAULT 1,
        lastusedat  TIMESTAMP NULL,
        expiresat   TIMESTAMP NULL,
        createdat   TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedat   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS ix_group_api_keys_groupid ON group_api_keys (groupid)`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_group_api_keys_keyprefix ON group_api_keys (keyprefix)`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_group_api_keys_keyhash ON group_api_keys (keyhash)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS group_api_keys`);
  }
}
