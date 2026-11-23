import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Converte os títulos em competência (caixa = 0) para regime de caixa, como os novos:
 *  1. apaga o lançamento de desconto do pagamento (no caixa a despesa é o que saiu);
 *  2. o pagamento que baixava Contas a pagar (conta → a pagar) passa a ir direto ao grupo do título (conta → grupo);
 *     no recebimento, a receber → conta vira grupo → conta;
 *  3. apaga o "registro" (lançamento da compra/venda a prazo contra a pagar/a receber, sem título, do mesmo lote);
 *  4. marca os títulos com caixa = 1.
 * Juros/multa e excedente ficam como estão. Sem volta: o registro apagado não é recriado.
 */
export class FinTitulosParaCaixa1700000000210 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. descontos dos pagamentos/recebimentos de títulos em competência
    await queryRunner.query(`
      DELETE FROM fin_lancamentos l
      USING fin_titulos t
      WHERE l.tituloid = t.id AND t.caixa = 0 AND l.descricao LIKE '% — desconto'`);

    // 2a. pagar: conta → a pagar  ⇒  conta → grupo do título
    await queryRunner.query(`
      UPDATE fin_lancamentos l SET conta_destinoid = t.conta_grupoid
      FROM fin_titulos t, fin_contas d
      WHERE l.tituloid = t.id AND t.caixa = 0 AND t.sentido = 'pagar'
        AND d.id = l.conta_destinoid AND d.tipo = 'a_pagar'`);

    // 2b. receber: a receber → conta  ⇒  grupo do título → conta
    await queryRunner.query(`
      UPDATE fin_lancamentos l SET conta_origemid = t.conta_grupoid
      FROM fin_titulos t, fin_contas o
      WHERE l.tituloid = t.id AND t.caixa = 0 AND t.sentido = 'receber'
        AND o.id = l.conta_origemid AND o.tipo = 'a_receber'`);

    // 3. registros (sem título) dos lotes de títulos em competência
    await queryRunner.query(`
      DELETE FROM fin_lancamentos l
      USING fin_contas o, fin_contas d
      WHERE l.tituloid IS NULL
        AND l.lote IN (SELECT DISTINCT lote FROM fin_titulos WHERE caixa = 0 AND lote IS NOT NULL)
        AND o.id = l.conta_origemid AND d.id = l.conta_destinoid
        AND (o.tipo IN ('a_pagar', 'a_receber') OR d.tipo IN ('a_pagar', 'a_receber'))`);

    // 4. todos os títulos passam a caixa
    await queryRunner.query(`UPDATE fin_titulos SET caixa = 1 WHERE caixa = 0`);
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
