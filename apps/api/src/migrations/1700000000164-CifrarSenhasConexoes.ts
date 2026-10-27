import type { MigrationInterface, QueryRunner } from "typeorm";
import { encryptCredential } from "../lib/storageEncryption.js";

/**
 * Cifra as senhas já gravadas em db_connections (conexões SQL Server do ERP), com a mesma chave
 * (STORAGE_ENCRYPTION_KEY) das senhas do WebDAV. Sem a chave configurada não faz nada — as senhas
 * novas também ficam em texto até a chave existir. Já cifradas ("enc:") são puladas.
 */
export class CifrarSenhasConexoes1700000000164 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(process.env.STORAGE_ENCRYPTION_KEY ?? "").trim()) {
      console.warn("[migração 164] STORAGE_ENCRYPTION_KEY vazia — senhas das conexões continuam em texto.");
      return;
    }
    const rows: { id: number; password: string | null }[] = await queryRunner.query(
      `SELECT id, password FROM db_connections WHERE password IS NOT NULL AND password <> '' AND password NOT LIKE 'enc:%'`
    );
    for (const r of rows) {
      await queryRunner.query(`UPDATE db_connections SET password = $1 WHERE id = $2`, [encryptCredential(String(r.password)), r.id]);
    }
    console.log(`[migração 164] ${rows.length} senha(s) de conexão cifrada(s).`);
  }

  public async down(): Promise<void> {
    // As senhas continuam legíveis pelo app (decryptCredential); não volta para texto.
  }
}
