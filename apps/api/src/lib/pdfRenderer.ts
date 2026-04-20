import { createCanvas } from "@napi-rs/canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

type CanvasAndContext = {
  canvas: unknown;
  context: unknown;
};

class NodeCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height))) as unknown as {
      width: number;
      height: number;
      getContext: (id: "2d") => unknown;
      toBuffer: (mimeType?: string) => Buffer | Uint8Array;
    };
    const context = canvas.getContext("2d");
    return { canvas, context };
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    const canvas = canvasAndContext.canvas as { width: number; height: number };
    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
  }

  destroy(canvasAndContext: CanvasAndContext): void {
    const canvas = canvasAndContext.canvas as { width: number; height: number };
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function renderPdfPagesToPngBuffers(
  pdfBuffer: Buffer,
  opts?: { maxPages?: number; scale?: number }
): Promise<{ pages: Buffer[]; renderedPages: number; totalPages: number; truncated: boolean }> {
  const maxPages = Math.max(1, Math.floor(opts?.maxPages ?? 10));
  const scale = opts?.scale != null && Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 2;

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  } as never);
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const renderedPages = Math.min(totalPages, maxPages);
  const truncated = totalPages > renderedPages;
  const canvasFactory = new NodeCanvasFactory();
  const pages: Buffer[] = [];

  for (let pageNo = 1; pageNo <= renderedPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale });
    const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
    try {
      const renderContext = {
        canvasContext: canvasAndContext.context as object,
        viewport,
      };
      await page.render(renderContext as never).promise;
      const png = (canvasAndContext.canvas as { toBuffer: (mimeType?: string) => Buffer | Uint8Array }).toBuffer(
        "image/png"
      );
      pages.push(Buffer.isBuffer(png) ? png : Buffer.from(png));
    } finally {
      canvasFactory.destroy(canvasAndContext);
    }
  }

  await pdf.cleanup();
  await pdf.destroy();

  return { pages, renderedPages, totalPages, truncated };
}
