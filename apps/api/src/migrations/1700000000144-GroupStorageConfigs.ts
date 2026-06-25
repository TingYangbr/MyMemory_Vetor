import type { MigrationInterface, QueryRunner } from "typeorm";

export class GroupStorageConfigs1700000000144 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS group_storage_configs (
        id          SERIAL PRIMARY KEY,
        group_id    INT REFERENCES groups(id) ON DELETE CASCADE,
        user_id     INT REFERENCES users(id)  ON DELETE CASCADE,
        label       VARCHAR(100) NOT NULL,
        tipo        VARCHAR(30)  NOT NULL DEFAULT 'WEBDAV',
        url         VARCHAR(500) NOT NULL,
        path_prefix VARCHAR(500),
        username    VARCHAR(255),
        password_enc TEXT,
        is_default  BOOLEAN NOT NULL DEFAULT FALSE,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_group_or_user CHECK (
          (group_id IS NOT NULL AND user_id IS NULL) OR
          (group_id IS NULL AND user_id IS NOT NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gsc_group_default
        ON group_storage_configs (group_id)
        WHERE is_default = TRUE AND is_active = TRUE AND group_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gsc_user_default
        ON group_storage_configs (user_id)
        WHERE is_default = TRUE AND is_active = TRUE AND user_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_gsc_group_active
        ON group_storage_configs (group_id) WHERE is_active = TRUE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS group_storage_configs`);
  }
}
