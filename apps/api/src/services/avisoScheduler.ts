import cron from "node-cron";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";
import { executarAviso } from "./avisoService.js";

let schedulerStarted = false;

export function iniciarAvisoScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Verifica avisos pendentes a cada 15 minutos
  cron.schedule("*/15 * * * *", async () => {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM avisos WHERE status = 'ativo' AND proximaexecucao <= NOW() ORDER BY proximaexecucao ASC LIMIT 50`
      );
      const avisos = rows as { id: number }[];
      console.info(`[avisoScheduler] tick — ${avisos.length} aviso(s) pendente(s)`);
      if (!avisos.length) return;

      console.info(`[avisoScheduler] ${avisos.length} aviso(s) a executar`);

      for (const { id } of avisos) {
        try {
          const { mudanca, custoUsd } = await executarAviso(id);
          console.info(`[avisoScheduler] aviso #${id} — mudança=${mudanca} custo=$${custoUsd.toFixed(6)}`);
        } catch (err) {
          console.error(`[avisoScheduler] erro ao executar aviso #${id}:`, err instanceof Error ? err.message : err);
          // Avança proximaexecucao 15 min para sair do ciclo atual sem atrasar muito
          try {
            await pool.query(
              `UPDATE avisos SET proximaexecucao = NOW() + INTERVAL '15 minutes' WHERE id = ?`,
              [id]
            );
          } catch { /* ignora */ }
        }
      }
    } catch (err) {
      console.error("[avisoScheduler] erro ao buscar avisos:", err instanceof Error ? err.message : err);
    }
  });

  console.info("[avisoScheduler] scheduler iniciado (a cada 15 min)");
}
