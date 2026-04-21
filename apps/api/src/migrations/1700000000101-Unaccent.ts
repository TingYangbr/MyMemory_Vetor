import type { MigrationInterface, QueryRunner } from "typeorm";

export class Unaccent1700000000101 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // unaccent é extensão partilhada; não remove para não afetar outros usos
  }
}
