import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * Agenda: "a pagar" / "a receber" no filtro de situação caía em "pago" (contém "pag") e o título em aberto sumia.
 * Agora a pagar, a receber, pendente, não pago = em aberto; descrição da consulta explica os valores.
 * O nome passa de "(agenda)" para "(previstos)", como a aba da tela.
 */
const ANTIGO = "Financeiro — Contas a pagar e receber (agenda)";
const NOME = "Financeiro — Contas a pagar e receber (previstos)";

export class FinAgendaAPagarAberto1700000000206 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const def = FIN_CONSULTAS.find((q) => q.nome === NOME);
    if (!def) return;
    await queryRunner.query(
      `UPDATE queries_categoria SET sentencasql = $1, descricao = $2, nome = $3, updatedat = NOW()
       WHERE nome IN ($3, $4) AND conexaoid IS NULL AND isactive = 1 AND sentencasql ILIKE '%fin_agenda(%'`,
      [def.sql, def.descricao, NOME, ANTIGO]
    );
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
