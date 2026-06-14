import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export interface TimingSpan {
  /** Rótulo legível da etapa (ex.: "Classificação", "Síntese da resposta"). */
  label: string;
  /** Duração da etapa em milissegundos. */
  durationMs: number;
}

const storage = new AsyncLocalStorage<TimingSpan[]>();

/**
 * Executa `fn` coletando os spans cronometrados por `withSpan` durante sua execução.
 * Retorna o valor de `fn` junto com a lista de spans na ordem de conclusão.
 */
export async function runWithTimings<T>(fn: () => Promise<T>): Promise<{ value: T; timings: TimingSpan[] }> {
  const spans: TimingSpan[] = [];
  const value = await storage.run(spans, fn);
  return { value, timings: spans };
}

/**
 * Cronometra uma etapa assíncrona. Se não houver coletor ativo (fora de
 * runWithTimings), apenas executa `fn` sem registrar nada.
 */
export async function withSpan<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    store.push({ label, durationMs: Math.round(performance.now() - start) });
  }
}
