import cron from "node-cron";
import { executarLembretesPendentes } from "./lembreteService.js";
import { executarLembretesFinanceiro } from "./finLembreteService.js";
import { atualizarCotacoesEmCarteira } from "./finCotacaoPapelService.js";
import { executarHistoricoDiario } from "./finPrecoHistoricoService.js";

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
      await executarLembretesFinanceiro().catch((err) =>
        console.error("[lembreteScheduler] financeiro:", err instanceof Error ? err.message : err)
      );
      // Cotações dos papéis em carteira (brapi, renova o que tem mais de 30 min)
      await atualizarCotacoesEmCarteira().catch((err) =>
        console.error("[lembreteScheduler] cotações:", err instanceof Error ? err.message : err)
      );
      // Histórico de preços: fechamento do dia pelo arquivo da B3 (a partir das 20h, de hora em hora)
      await executarHistoricoDiario().catch((err) =>
        console.error("[lembreteScheduler] histórico de preços:", err instanceof Error ? err.message : err)
      );
    } catch (err) {
      console.error("[lembreteScheduler] erro:", err instanceof Error ? err.message : err);
    } finally {
      rodando = false;
    }
  });
}
