// Bulk OCR pipeline: reads all candidate affidavit PDFs, extracts text,
// matches to DB candidates, and stores scan records + cross-validates profile data.
//
// Usage: npm run db:ocr -- [--limit=N] [--state=Delhi|Kerala] [--ocr-pages=N]

import { config } from "dotenv";
config({ path: ".env.local" });

import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { parseAffidavitText } from "./ocr/parser";
import { candidates, affidavitScans } from "./schema";

const require = createRequire(import.meta.url);
const { neon } = require("@neondatabase/serverless");
const { drizzle } = require("drizzle-orm/neon-http");
const pdfParse = require("pdf-parse");
const { createCanvas } = require("canvas");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { createWorker } = require("tesseract.js");

// ---------- Config ----------
const params: Record<string, string> = {};
process.argv.slice(2).forEach((arg) => {
  const m = arg.match(/^--([^=]+)=(.+)$/);
  if (m) params[m[1]] = m[2];
});
const LIMIT = params.limit ? parseInt(params.limit, 10) : Infinity;
const STATE_FILTER = params.state || null;
const OCR_PAGES = params["ocr-pages"] ? parseInt(params["ocr-pages"], 10) : 3;

const TMP_DIR = path.join("C:", "Users", "Asus", "AppData", "Local", "Temp", "opencode", "ocr-pages");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ---------- PDF helpers ----------
class CanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(c: any, w: number, h: number) { c.canvas.width = w; c.canvas.height = h; }
  destroy(c: any) { c.canvas.width = 0; c.canvas.height = 0; c.canvas = null; c.context = null; }
}

async function renderPageToPng(pdfBuf: Buffer, pageNum: number, scale = 1.5): Promise<Buffer> {
  const data = new Uint8Array(pdfBuf);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const factory = new CanvasFactory();
  const result = factory.create(viewport.width, viewport.height);
  await page.render({ canvasContext: result.context, viewport }).promise;
  return result.canvas.toBuffer("image/png");
}

async function textFromPdf(pdfBuf: Buffer): Promise<string> {
  const data = await pdfParse(pdfBuf);
  return data.text;
}

// ---------- Matching ----------
function normalizeName(name: string): string {
  return (name || "")
    .replace(/\s+/g, "")
    .replace(/[^a-z]/gi, "")
    .toLowerCase();
}

function lastNameKey(name: string): string {
  const cleaned = normalizeName(name);
  if (cleaned.length <= 8) return cleaned;
  return cleaned.slice(-8);
}

function matchToCandidate(dbCandidates: any[], filename: string): any | null {
  const base = path.basename(filename, ".pdf");
  const normFile = normalizeName(base);
  const exact = dbCandidates.find((c) => normalizeName(c.name) === normFile);
  if (exact) return exact;
  const fileKey = lastNameKey(base);
  const byKey = dbCandidates.find((c) => lastNameKey(c.name) === fileKey);
  if (byKey) return byKey;
  const contains = dbCandidates.find((c) => {
    const cn = normalizeName(c.name);
    return normFile.includes(cn) || cn.includes(normFile);
  });
  return contains || null;
}

// ---------- Main ----------
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const db = drizzle(neon(connectionString));

  const allRows = await db.select().from(candidates);
  console.log(`Loaded ${allRows.length} candidates from DB for matching.\n`);

  // Load already-processed filenames so we can resume without duplicating scan records
  const existingScans = await db.select({ filename: affidavitScans.filename }).from(affidavitScans);
  const doneFiles = new Set(existingScans.map((s: { filename: string }) => s.filename));
  console.log(`Found ${doneFiles.size} already-processed affidavits; will skip them.\n`);

  const pdfFiles: { dir: string; file: string; fullPath: string }[] = [];
  for (const dir of ["Delhi", "Kerala"]) {
    const dirPath = path.join("Candidate Affidavits", dir);
    if (!fs.existsSync(dirPath)) continue;
    const files = fs.readdirSync(dirPath).filter((f) => f.toLowerCase().endsWith(".pdf"));
    files.forEach((f) => pdfFiles.push({ dir, file: f, fullPath: path.join(dirPath, f) }));
  }
  console.log(`Found ${pdfFiles.length} PDFs; ${pdfFiles.length - doneFiles.size} to process.\n`);

  let processed = 0;
  let skippedExisting = 0;
  let textPdfs = 0;
  let imagePdfs = 0;
  let matched = 0;
  let unmatchedPdfs = 0;
  let stored = 0;
  const skipped: string[] = [];

  let worker: any = null;
  async function getWorker() {
    if (!worker) {
      console.log("Initializing OCR engine (first image PDF), this may take a moment...\n");
      worker = await createWorker("eng");
    }
    return worker;
  }

  for (const { dir, file, fullPath } of pdfFiles) {
    if (STATE_FILTER && dir !== STATE_FILTER) continue;
    if (doneFiles.has(file)) {
      skippedExisting++;
      continue;
    }
    processed++;
    if (processed > LIMIT) {
      console.log(`\nReached limit of ${LIMIT}. Stopping.`);
      break;
    }

    let buf: Buffer;
    try {
      buf = fs.readFileSync(fullPath);
    } catch {
      skipped.push(`${file}: read error`);
      continue;
    }

    const dbCandidate = matchToCandidate(allRows, file);
    if (!dbCandidate) {
      unmatchedPdfs++;
      skipped.push(`${file}: no DB match`);
      continue;
    }

    let text = "";
    let source = "";
    try {
      const extracted = await textFromPdf(buf);
      if (extracted.trim().length > 200) {
        text = extracted;
        source = "pdf-text";
        textPdfs++;
      } else {
        imagePdfs++;
        const w = await getWorker();
        const pageCount = Math.min(OCR_PAGES, 5);
        let combined = "";
        for (let p = 1; p <= pageCount; p++) {
          try {
            const png = await renderPageToPng(buf, p);
            const tmpFile = path.join(TMP_DIR, `page-${Date.now()}-${p}.png`);
            fs.writeFileSync(tmpFile, png);
            const res = await w.recognize(tmpFile);
            combined += res.data.text + "\n";
            fs.unlinkSync(tmpFile);
          } catch {
            break;
          }
        }
        text = combined;
        source = "ocr";
      }
    } catch (e: any) {
      skipped.push(`${file}: extraction error: ${e.message}`);
      continue;
    }

    const parsed = parseAffidavitText(text);

    try {
      await db.insert(affidavitScans).values({
        candidateId: dbCandidate.id,
        filename: file,
        status: "completed",
        extractedText: text.substring(0, 20000),
        parsedData: { name: parsed.name, age: parsed.age, education: parsed.education, assets: parsed.assets, liabilities: parsed.liabilities, criminalCases: parsed.criminalCases, constituency: parsed.constituency, pan: parsed.pan, _source: source, _state: dir },
      });
      stored++;
    } catch (e: any) {
      skipped.push(`${file}: DB insert error: ${e.message}`);
      continue;
    }

    if (parsed.criminalCases !== undefined && dbCandidate.criminalCases !== parsed.criminalCases) {
      console.log(`  [!] ${path.basename(file)}: DB cases=${dbCandidate.criminalCases}, OCR cases=${parsed.criminalCases}`);
    }
    matched++;

    if (source === "ocr") {
      process.stdout.write(`\r  [${processed}/${pdfFiles.length}] ${path.basename(file).slice(0, 26)} (${source})`);
    } else {
      console.log(`  [${processed}/${pdfFiles.length}] ${path.basename(file).slice(0, 40)} (${source}, ${text.length} chars)`);
    }
  }

  if (worker) await worker.terminate();

  console.log("\n\n===== OCR PIPELINE SUMMARY =====");
  console.log(`Processed: ${processed} PDFs`);
  console.log(`  Text-based: ${textPdfs} | Image-based (OCR): ${imagePdfs}`);
  console.log(`Matched to DB: ${matched}`);
  console.log(`Stored scan records: ${stored}`);
  console.log(`No DB match: ${unmatchedPdfs}`);
  console.log(`Skipped/errors: ${skipped.length}`);
  console.log("\nSkipped/unmatched:");
  skipped.forEach((s) => console.log(`  - ${s}`));
}

main().catch((e) => {
  console.error("Pipeline error:", e);
  process.exit(1);
});
