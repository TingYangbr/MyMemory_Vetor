import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * O campo de situação criado antes do vocabulário único ainda descrevia "Ativo (vale, em andamento)…".
 * Troca só a descrição de fábrica pela nova (Pendente/Concluído/Cancelado, ou Válido/Cancelado);
 * descrição escrita à mão fica como está. Mesmo texto de situacaoMemo.descricaoCampoSituacao.
 */
export class DescricaoSituacaoNova1700000000178 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE categorycampos cc SET description = CASE WHEN c.situacao_tipo = 'registro'
        THEN 'Situação do registro: Válido (vale) ou Cancelado (lançado errado, estornado, revogado). Registro novo: Válido, salvo se o texto disser que foi cancelado.'
        ELSE 'Situação: Pendente (a fazer, ainda vai acontecer), Concluído (feito, aconteceu, comprado, pago) ou Cancelado (não vai acontecer). Registro novo: Pendente, salvo se o texto disser que já aconteceu ou foi cancelado.'
        END
      FROM categories c
      WHERE c.id = cc.categoryid AND c.campo_situacao = cc.name
        AND cc.description LIKE 'Situação do registro: Ativo (vale, em andamento)%'
    `);
  }

  public async down(): Promise<void> {
    /* descrição antiga não é restaurada */
  }
}
