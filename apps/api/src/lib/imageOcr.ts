/**
 * OCR local com Tesseract (sem custo de API). Worker partilhado e fila simples.
 */
type TesseractWorker = import("tesseract.js").Worker;

export type TesseractImageOcrResult = {
  text: string;
  /** Confiança global da página (0–100), quando disponível; `null` se indisponível. */
  confidence: number | null;
};

let workerPromise: Promise<TesseractWorker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      try {
        return await createWorker("por+eng");
      } catch {
        return createWorker("eng");
      }
    })();
  }
  return workerPromise;
}

function normalizeConfidence(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

const OCR_TIMEOUT_MS = 25_000;

export async function recognizeImageWithTesseract(buffer: Buffer): Promise<TesseractImageOcrResult> {
  const run = async (): Promise<TesseractImageOcrResult> => {
    try {
      const worker = await getWorker();
      const timeoutResult = new Promise<TesseractImageOcrResult>((resolve) =>
        setTimeout(() => resolve({ text: "", confidence: null }), OCR_TIMEOUT_MS)
      );
      const recognizeResult = worker.recognize(buffer).then(({ data }) => ({
        text: (data.text ?? "").trim(),
        confidence: normalizeConfidence(data.confidence),
      }));
      return await Promise.race([recognizeResult, timeoutResult]);
    } catch {
      return { text: "", confidence: null };
    }
  };
  const done = queue.then(run);
  queue = done.catch(() => {});
  return done;
}
