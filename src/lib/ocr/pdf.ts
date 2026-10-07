import { createRequire } from "module";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const require = createRequire(import.meta.url);
const { createCanvas } = require("canvas");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

class CanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(c: { canvas: { width: number; height: number } }, w: number, h: number) {
    c.canvas.width = w;
    c.canvas.height = h;
  }
  destroy(c: any) {
    c.canvas.width = 0;
    c.canvas.height = 0;
    c.canvas = null;
    c.context = null;
  }
}

/**
 * Renders PDF pages to image buffers. PNG is the default and stays byte-identical
 * for existing callers; `format: "jpeg"` exists because providers reject request
 * bodies over ~20MB and a 20-page PNG affidavit is ~26MB base64 (HTTP 413 from
 * Google AI Studio), while the same pages at JPEG q0.85 are several times smaller.
 */
export async function renderPdfPagesToPng(
  pdfBuffer: Buffer,
  options: { maxPages?: number; scale?: number; format?: "png" | "jpeg"; quality?: number } = {},
): Promise<Buffer[]> {
  const maxPages = options.maxPages ?? 5;
  const scale = options.scale ?? 1.5;
  const format = options.format ?? "png";
  const quality = options.quality ?? 0.85;
  const data = new Uint8Array(pdfBuffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pageCount = Math.min(doc.numPages, maxPages);
  const factory = new CanvasFactory();
  const pages: Buffer[] = [];
  try {
    for (let p = 1; p <= pageCount; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale });
      const result = factory.create(viewport.width, viewport.height);
      await page.render({ canvasContext: result.context, viewport }).promise;
      pages.push(
        format === "jpeg"
          ? result.canvas.toBuffer("image/jpeg", { quality, progressive: false })
          : result.canvas.toBuffer("image/png"),
      );
      factory.destroy(result);
    }
  } finally {
    doc.destroy?.();
  }
  return pages;
}