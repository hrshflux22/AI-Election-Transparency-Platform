import { ImageAnnotatorClient } from "@google-cloud/vision";
import pdfParse from "pdf-parse";
import { parseAffidavitText, type ParsedAffidavit } from "./parser";

export type OcrResult = { text: string; parsed: ParsedAffidavit; source: "vision" | "pdf-text" };

export async function extractAffidavit(file: Buffer, mimeType: string): Promise<OcrResult> {
  if (mimeType === "application/pdf") {
    const pdf = await pdfParse(file);
    const text = pdf.text.trim();
    if (!text) throw new Error("The PDF contains no selectable text. Upload an image or searchable PDF.");
    return { text, parsed: parseAffidavitText(text), source: "pdf-text" };
  }

  if (!["image/jpeg", "image/png", "image/webp", "image/tiff"].includes(mimeType)) {
    throw new Error("Unsupported file type. Upload a JPG, PNG, WEBP, TIFF, or PDF affidavit.");
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT) {
    throw new Error("Google Vision is not configured. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_CLOUD_PROJECT.");
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
