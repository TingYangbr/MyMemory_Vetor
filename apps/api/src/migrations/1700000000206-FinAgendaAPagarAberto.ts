import type { MigrationInterface, QueryRunner } from "typeorm";
import { FIN_CONSULTAS } from "../services/finConsultas.js";

/**
 * Agenda: "a pagar" / "a receber" no filtro de situação caía em "pago" (contém "pag") e o título em aberto sumia.
 * Agora a pagar, a receber, pendente, não pago = em aberto; descrição da consulta explica os valores.
 */
const NOME = "Financeiro — Contas a pagar e receber (agenda)";

export class FinAgendaAPagarAberto1700000000206 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const def = FIN_CONSULTAS.find((q) => q.nome === NOME);
    if (!def) return;
    await queryRunner.query(
      `UPDATE queries_categoria SET sentencasql = $1, descricao = $2, updatedat = NOW()
       WHERE nome = $3 AND conexaoid IS NULL AND isactive = 1 AND sentencasql ILIKE '%fin_agenda(%'
         AND sentencasql NOT ILIKE '%baix%'`,
      [def.sql, def.descricao, NOME]
    );
  }

  public async down(): Promise<void> {
    // sem volta
  }
}
