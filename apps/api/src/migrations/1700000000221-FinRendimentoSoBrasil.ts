import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * Rendimento da carteira: só papéis da B3 (mercado local). "E no exterior?" trazia os papéis do Brasil como se fossem
 * do exterior. Agora a consulta tem o parâmetro mercado e volta vazia para exterior, e a descrição diz à IA que o
 * rendimento no exterior não é calculado. Só atualiza a consulta (queries_categoria e o parâmetro novo).
 */
const NOME = "Financeiro — Rendimento da carteira";

export class FinRendimentoSoBrasil1700000000221 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const def = FIN_CONSULTAS.find((q) => q.nome === NOME);
    if (!def) return;
    await queryRunner.query(
      `UPDATE queries_categoria SET sentencasql = $1, descricao = $2, updatedat = NOW()
       WHERE nome = $3 AND conexaoid IS NULL AND isactive = 1`,
      [def.sql, def.descricao, NOME]
    );
    const linhas = (await queryRunner.query(
      `SELECT id FROM queries_categoria WHERE nome = $1 AND conexaoid IS NULL AND isactive = 1`,
      [NOME]
    )) as { id: number }[];
    for (const q of linhas) {
      await queryRunner.query(
        `INSERT INTO queries_categoria_params (queryid, campo, tipo, obrigatorio, operadorsql, normalizar, ordem, isactive)
         SELECT $1, 'mercado', 'string', 0, '=', 0, 4, 1
         WHERE NOT EXISTS (SELECT 1 FROM queries_categoria_params WHERE queryid = $1 AND campo = 'mercado')`,
        [q.id]
      );
    }
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
