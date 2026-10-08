import cron from "node-cron";
import { executarLembretesPendentes } from "./lembreteService.js";

let iniciado = false;
let rodando = false;

/**
 * Robô dos lembretes: verifica a cada 5 minutos; cada regra só roda quando o seu intervalo
 * (5, 15, 30 ou 60 min) já passou desde a última execução.
 */
export function iniciarLembreteScheduler(): void {
  if (iniciado) return;
  iniciado = true;
  console.info("[lembreteScheduler] iniciado (verificação a cada 5 min)");

  cron.schedule("*/5 * * * *", async () => {
    if (rodando) return; // ciclo anterior ainda em andamento
    rodando = true;
    try {
      await executarLembretesPendentes();
    } catch (err) {
      console.error("[lembreteScheduler] erro:", err instanceof Error ? err.message : err);
    } finally {
      rodando = false;
    }
  });
}
