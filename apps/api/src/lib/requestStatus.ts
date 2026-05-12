import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<(msg: string) => void>();

/** Emite uma mensagem de status para o cliente conectado à requisição atual (se houver). */
export function emitStatus(msg: string): void {
  storage.getStore()?.(msg);
}

/** Executa `fn` no contexto de um emitter de status para a requisição. */
export function runWithStatusEmitter<T>(
  emitter: (msg: string) => void,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(emitter, fn);
}
