import cron from "node-cron";
import { executarAutomacoesVencidas } from "./automacaoImportacaoService.js";

let iniciado = false;
let rodando = false;

/**
 * Robô da importação automática: verifica a cada 5 minutos; cada automação só roda quando o seu
 * intervalo (15 min a 1 dia) já passou desde a execução anterior.
 */
export function iniciarAutomacaoScheduler(): void {
  if (iniciado) return;
  iniciado = true;
  console.info("[automacaoScheduler] iniciado (verificação a cada 5 min)");

  cron.schedule("*/5 * * * *", async () => {
    if (rodando) return; // ciclo anterior ainda em andamento (importações longas)
    rodando = true;
    try {
      await executarAutomacoesVencidas();
    } catch (err) {
      console.error("[automacaoScheduler] erro:", err instanceof Error ? err.message : err);
    } finally {
      rodando = false;
    }
  });
}
