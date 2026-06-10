import type { MigrationInterface, QueryRunner } from "typeorm";

export class UserInvites1700000000125 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_invites (
        id               SERIAL PRIMARY KEY,
        email            VARCHAR(320) NOT NULL,
        invitedbyuserid  INT NOT NULL,
        token            VARCHAR(256) NOT NULL,
        status           VARCHAR(10) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','accepted','expired')),
        expiresat        TIMESTAMP NOT NULL,
        createdat        TIMESTAMP NOT NULL DEFAULT NOW(),
        acceptedat       TIMESTAMP NULL,
        acceptedbyuserid INT NULL,
        CONSTRAINT user_invites_token_unique UNIQUE (token),
        CONSTRAINT fk_ui_inviter FOREIGN KEY (invitedbyuserid) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_ui_accepter FOREIGN KEY (acceptedbyuserid) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_user_invites_email ON user_invites (LOWER(email))
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_user_invites_token ON user_invites (token)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_invites CASCADE`);
  }
}
