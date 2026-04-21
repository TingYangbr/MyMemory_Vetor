/** Shim de tipos para substituir mysql2 após migração para PostgreSQL.
 * Usa `any` indexado para manter compatibilidade com código que acessa
 * propriedades de rows sem cast explícito (mesmo comportamento do mysql2). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RowDataPacket = Record<string, any>;

export interface ResultSetHeader {
  insertId: number;
  affectedRows: number;
  changedRows: number;
}
