import { ImageAnnotatorClient } from "@google-cloud/vision";
import pdfParse from "pdf-parse";
import { parseAffidavitText, type ParsedAffidavit } from "./parser";
import { isBaiduOcrConfigured, extractWithBaiduOcr } from "./baidu";
import { isUnlimitedOcrConfigured, extractWithUnlimitedOcr } from "./unlimited";
import { renderPdfPagesToPng } from "./pdf";
import { createOpenRouterEngine, isOpenRouterConfigured, OpenRouterBudgetError } from "./openrouter";
import { redactExtraction } from "./privacy";
import { buildParsedData, estimateCostUsd, renderExtractedText } from "./vlm";

export type OcrResult = {
  text: string;
  parsed: ParsedAffidavit;
  source: "vision" | "pdf-text" | "unlimited" | "baidu" | "openrouter";
};

export async function extractAffidavit(file: Buffer, mimeType: string, filename = "document.pdf"): Promise<OcrResult> {
  // OpenRouter (Qwen3-VL) — reads the whole PDF and returns Form 26 fields as
  // structured JSON, the same engine and row shape the bulk pipeline uses.
  // PDFs only: the engine renders pages with pdf.js, so images cannot go
  // through it and fall through to the OCR providers below.
  if (isOpenRouterConfigured() && mimeType === "application/pdf") {
    try {
      const result = await createOpenRouterEngine().extract(file, {
        includePan: false,
        onRetry: (attempt, waitMs, reason) =>
          console.warn(`[ocr] OpenRouter retry ${attempt} in ${Math.round(waitMs / 1000)}s (${reason.slice(0, 120)})`),
      });

      const data = redactExtraction(result.data, { dropPanField: true, scrubKinds: ["pan"] });
      const text = renderExtractedText(data);
      const parsed = {
        ...buildParsedData(data, {
          _source: result.engine,
          _model: result.model,
          _inTokens: result.inTokens ?? null,
          _outTokens: result.outTokens ?? null,
          _estimatedCostUsd: estimateCostUsd(result.model, result.inTokens, result.outTokens),
          _elapsedMs: result.elapsedMs ?? null,
          _pagesRead: result.pagesRead ?? null,
          _redactedPan: true,
          rawText: text,
        }),
      } as unknown as ParsedAffidavit;
      return { text, parsed, source: "openrouter" };
    } catch (e) {
      // Out of credit is a configuration problem, not a bad document: surface
      // it instead of falling through to "the PDF contains no selectable text".
      if (e instanceof OpenRouterBudgetError) throw e;
      console.warn("[ocr] OpenRouter extraction failed, trying next provider:", (e as Error).message);
    }
  }

  // Baidu Cloud OCR (managed Unlimited-OCR API) — handles PDFs and images directly.
  if (isBaiduOcrConfigured() && (mimeType === "application/pdf" || mimeType.startsWith("image/"))) {
    try {
      const safeName = filename.match(/\.(pdf|jpe?g|png|bmp|tiff?|ofd)$/i) ? filename : `${filename.replace(/\.[^.]+$/, "")}.${mimeType === "application/pdf" ? "pdf" : "jpg"}`;
      const text = await extractWithBaiduOcr(file, { filename: safeName });
      if (text) return { text, parsed: parseAffidavitText(text), source: "baidu" };
    } catch (e) {
      console.warn("[ocr] Baidu Cloud OCR failed, trying next provider:", (e as Error).message);
    }
  }

  // Self-hosted Unlimited-OCR (SGLang/vLLM) — next in priority.
  const unlimited = isUnlimitedOcrConfigured();

  if (mimeType === "application/pdf") {
    if (unlimited) {
      try {
        const pages = await renderPdfPagesToPng(file, { maxPages: 5, scale: 1.5 });
        const text = await extractWithUnlimitedOcr(
          pages.map((buffer) => ({ mimeType: "image/png", buffer })),
          { imageMode: "base", windowSize: 1024 },
        );
        if (text) return { text, parsed: parseAffidavitText(text), source: "unlimited" };
      } catch (e) {
        console.warn("[ocr] Unlimited-OCR failed for PDF, falling back to pdf-text:", (e as Error).message);
      }
    }

    const pdf = await pdfParse(file);
    const text = pdf.text.trim();
    if (!text) throw new Error("The PDF contains no selectable text. Upload an image or searchable PDF.");
    return { text, parsed: parseAffidavitText(text), source: "pdf-text" };
  }

  if (!["image/jpeg", "image/png", "image/webp", "image/tiff"].includes(mimeType)) {
    throw new Error("Unsupported file type. Upload a JPG, PNG, WEBP, TIFF, or PDF affidavit.");
  }

  if (unlimited) {
    try {
      const text = await extractWithUnlimitedOcr(
        [{ mimeType, buffer: file }],
        { imageMode: "gundam", windowSize: 128 },
      );
      if (text) return { text, parsed: parseAffidavitText(text), source: "unlimited" };
    } catch (e) {
      console.warn("[ocr] Unlimited-OCR failed for image, falling back to Vision:", (e as Error).message);
    }
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT) {
    throw new Error(
      unlimited || isBaiduOcrConfigured()
        ? "OCR failed (see server logs). Configure GOOGLE_APPLICATION_CREDENTIALS as a fallback."
        : "Google Vision is not configured. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_CLOUD_PROJECT.",
    );
  }

  const client = new ImageAnnotatorClient();
  try {
    const [result] = await client.documentTextDetection({ image: { content: file } });
    const text = result.fullTextAnnotation?.text?.trim() ?? "";
    if (!text) throw new Error("No text could be detected in the uploaded image.");
    return { text, parsed: parseAffidavitText(text), source: "vision" };
  } finally {
    await client.close();
  }
}