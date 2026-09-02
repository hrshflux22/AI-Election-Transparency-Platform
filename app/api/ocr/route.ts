import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { affidavitScans } from "@/lib/schema";
import { extractAffidavit } from "@/lib/ocr/service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const candidateId = String(form.get("candidateId") ?? "").trim();
    if (!(file instanceof File)) return NextResponse.json({ error: "An affidavit file is required." }, { status: 400 });
    if (!candidateId) return NextResponse.json({ error: "candidateId is required." }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "File must be 10 MB or smaller." }, { status: 413 });

    const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
    const result = await extractAffidavit(Buffer.from(await file.arrayBuffer()), mimeType);
    let scanId: number | undefined;
    if (db) {
      const [scan] = await db.insert(affidavitScans).values({
        candidateId,
        filename: file.name,
        status: "completed",
        extractedText: result.text,
        parsedData: result.parsed,
      }).returning({ id: affidavitScans.id });
      scanId = scan?.id;
    }
    return NextResponse.json({ scanId, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OCR processing failed.";
    const status = /not configured|credentials/i.test(message) ? 503 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
