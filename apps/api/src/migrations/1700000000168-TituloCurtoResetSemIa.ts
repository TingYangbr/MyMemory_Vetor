import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Na primeira versão, memos "sem IA" (com texto) receberam título vazio ('') e ficaram de fora
 * do botão "Gerar títulos". Volta esses memos para NULL para o botão poder gerar o título.
 * Só mexe em títulos vazios de memos com texto; títulos preenchidos não mudam.
 */
export class TituloCurtoResetSemIa1700000000168 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE memos SET titulo_curto = NULL
      WHERE titulo_curto = '' AND COALESCE(TRIM(mediatext), '') <> ''
    `);
  }

  public async down(): Promise<void> {
    // Sem volta: NULL e '' só diferem em "já processado"; o botão regenera quando pedido.
  }
}
