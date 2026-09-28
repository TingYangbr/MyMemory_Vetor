import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * queries_categoria.conexaopendente — marca queries clonadas cuja origem usava conexão
 * SQL Server externa. O clone grava conexaoid = NULL (cada grupo tem a sua conexão), mas
 * NULL também significa "PostgreSQL interno", então sem esta flag não dá para distinguir
 * "esquecido" de "configurado". Enquanto = 1, a query não executa e o editor exige a escolha.
 */
export class QueryConexaoPendente1700000000147 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE queries_categoria ADD COLUMN IF NOT EXISTS conexaopendente SMALLINT NOT NULL DEFAULT 0`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE queries_categoria DROP COLUMN IF EXISTS conexaopendente`);
  }
}
