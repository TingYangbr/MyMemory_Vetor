import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A Consulta padrão das categorias com "Pedir o resultado" lê memo_relacoes (coluna resultado e o filtro
 * tem_resultado). As consultas rodam com o papel restrito mm_query_reader: precisa de leitura na tabela.
 * As linhas só aparecem juntas de memos que o papel já enxerga (RLS de memos).
 */
export class ResultadoNaConsulta1700000000224 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`GRANT SELECT ON memo_relacoes TO mm_query_reader`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`REVOKE SELECT ON memo_relacoes FROM mm_query_reader`);
  }
}
