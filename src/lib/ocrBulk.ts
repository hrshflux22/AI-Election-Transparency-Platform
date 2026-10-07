// Bulk affidavit pipeline: reads all candidate affidavit PDFs, extracts
// structured Form 26 data, matches to DB candidates, stores scan records.
//
// Engines:
//   gemini    - Gemini vision model, whole-PDF inline upload (primary)
//   baidu     - Baidu Cloud managed OCR API
//   unlimited - self-hosted Unlimited-OCR (SGLang/vLLM)
//   tesseract - local Tesseract.js fallback
//
// Usage:
//   npm run db:ocr -- [--limit=N] [--state=Delhi|Kerala] [--engine=gemini] \
//     [--force] [--replace] [--redact-pan] [--concurrency=N] [--verbose] \
//     [--batch=N] [--file=<substring>] [--max-requests=N]
//
//   --force        process files that already have a stored scan (insert a new row;
//                  the newest row wins because reads order by createdAt DESC)
//   --replace      hard-delete existing rows for a file before inserting
//   --redact-pan   drop the PAN field and scrub PAN-shaped strings (default ON for gemini)
//   --batch=N      read N affidavits per API request (openrouter only; default 1).
//                  Batching exists to fit the free tier's daily request cap.
//   --file=STR     only queue filenames containing STR (validation runs)
//   --max-requests=N  halt once N API requests have been sent this run
//
// Progress and outcomes are logged one line per document so a long run can be
// followed with grep: [OCR] 1/204 processing X | success | retry | failed | progress.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { and, eq, inArray } from "drizzle-orm";
import { parseAffidavitText } from "./ocr/parser";
import { extractWithBaiduOcr, isBaiduOcrConfigured } from "./ocr/baidu";
import { extractWithUnlimitedOcr, isUnlimitedOcrConfigured } from "./ocr/unlimited";
import { renderPdfPagesToPng } from "./ocr/pdf";
import { createGeminiEngine, isGeminiConfigured, GeminiQuotaError } from "./ocr/gemini";
import { createOpenRouterEngine, isOpenRouterConfigured, OpenRouterBudgetError, openRouterModel, openRouterStats, isFreeModel, type BatchItemResult, type OpenRouterEngineApi } from "./ocr/openrouter";
import { redactExtraction, REDACTED } from "./ocr/privacy";
import { buildParsedData, countFilledKeyFields, estimateCostUsd, KEY_FIELDS, renderExtractedText, type VlmEngine } from "./ocr/vlm";
import { candidates, affidavitScans } from "./schema";

const require = createRequire(import.meta.url);
const { neon } = require("@neondatabase/serverless");
const { drizzle } = require("drizzle-orm/neon-http");
const pdfParse = require("pdf-parse");
const { createWorker } = require("tesseract.js");

const params: Record<string, string> = {};
const flags = new Set<string>();
process.argv.slice(2).forEach((arg) => {
  const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) return;
  flags.add(m[1]);
  params[m[1]] = m[2] ?? "true";
});

const LIMIT = params.limit ? parseInt(params.limit, 10) : Infinity;
const STATE_FILTER = params.state || null;
const OCR_PAGES = params["ocr-pages"] ? parseInt(params["ocr-pages"], 10) : 3;
const CONCURRENCY = Math.max(1, parseInt(params.concurrency || "4", 10));
const FORCE = flags.has("force");
const REPLACE = flags.has("replace");
const REDACT_PAN = flags.has("keep-pan") ? false : params["redact-pan"] !== "false";
const BATCH = Math.max(1, parseInt(params.batch || "1", 10));
const FILE_FILTER = params.file && params.file !== "true" ? params.file.toLowerCase() : null;
const MAX_REQUESTS = params["max-requests"] ? parseInt(params["max-requests"], 10) : Infinity;

const ENGINE = (
  params.engine ||
  (isOpenRouterConfigured()
    ? "openrouter"
    : isGeminiConfigured()
      ? "gemini"
      : isBaiduOcrConfigured()
        ? "baidu"
        : isUnlimitedOcrConfigured()
          ? "unlimited"
          : "tesseract")
).toLowerCase();

if (BATCH > 1 && ENGINE !== "openrouter") {
  throw new Error(`--batch=${BATCH} is only supported by --engine=openrouter.`);
}

/** Engines that write structured per-engine provenance into parsedData._source. */
const VLM_ENGINES = new Set(["gemini", "openrouter"]);

// Hard stop so a paid model cannot burn past the remaining key credit.
// estimateCostUsd lives in ./ocr/vlm so the upload endpoint reports the same
// numbers this pipeline does.
const BUDGET_CAP_USD = params["budget-cap"] ? parseFloat(params["budget-cap"]) : Infinity;
let spendUsd = 0;

const TMP_DIR = path.join(process.env.TEMP || "C:\\Windows\\Temp", "opencode-ocr-pages");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ---------- Legacy extraction paths ----------

async function textFromPdf(pdfBuf: Buffer): Promise<string> {
  const data = await pdfParse(pdfBuf);
  return data.text;
}

async function ocrPdfPages(pdfBuf: Buffer, filename: string): Promise<{ text: string; source: string }> {
  if (ENGINE === "baidu") {
    if (!isBaiduOcrConfigured()) throw new Error("--engine=baidu requires BAIDU_API_KEY and BAIDU_SECRET_KEY.");
    const text = await extractWithBaiduOcr(pdfBuf, { filename });
    return { text, source: "baidu" };
  }

  if (ENGINE === "unlimited") {
    if (!isUnlimitedOcrConfigured()) throw new Error("--engine=unlimited requires UNLIMITED_OCR_URL.");
    const pages = await renderPdfPagesToPng(pdfBuf, { maxPages: Math.min(OCR_PAGES, 5), scale: 1.5 });
    const text = await extractWithUnlimitedOcr(
      pages.map((buffer) => ({ mimeType: "image/png", buffer })),
      { imageMode: "base", windowSize: 1024 },
    );
    return { text, source: "unlimited" };
  }

  let worker: any = null;
  try {
    worker = await createWorker("eng");
    const pageCount = Math.min(OCR_PAGES, 5);
    const pages = await renderPdfPagesToPng(pdfBuf, { maxPages: pageCount, scale: 1.5 });
    let combined = "";
    for (let p = 0; p < pages.length; p++) {
      const tmpFile = path.join(TMP_DIR, `page-${Date.now()}-${p}.png`);
      fs.writeFileSync(tmpFile, pages[p]);
      const res = await worker.recognize(tmpFile);
      combined += res.data.text + "\n";
      fs.unlinkSync(tmpFile);
    }
    return { text: combined, source: "ocr" };
  } finally {
    if (worker) await worker.terminate();
  }
}

// ---------- Matching ----------

function normalizeName(name: string): string {
  // "S/O", "son of" and "D/O", "daughter of" are the same relation written
  // differently in filenames and in the candidate spreadsheet; collapse both
  // to the initials the spreadsheet uses so they compare equal.
  return (name || "")
    .replace(/\s+/g, " ")
    .replace(/[^a-z ]/gi, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/daughterof/g, "do")
    .replace(/sonof/g, "so");
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

  const byKey = dbCandidates.find((c) => lastNameKey(c.name) === lastNameKey(base));
  if (byKey) return byKey;

  const contains = dbCandidates.find((c) => {
    const cn = normalizeName(c.name);
    return normFile.includes(cn) || cn.includes(normFile);
  });
  return contains || null;
}

// ---------- Rendering / storing ----------
// renderExtractedText / buildParsedData are shared with the upload endpoint
// via ./ocr/vlm so both paths store the same row shape.

type Job = { dir: string; file: string; fullPath: string; candidate: any | null };
type Failure = { file: string; reason: string };

interface ProcessResult {
  failure?: Failure;
  fatal?: string;
  filled?: number;
  source?: string;
}

/** One greppable line per event; logTotal is set once the queue is known. */
let logTotal = 0;

function logProcessing(index: number, file: string): void {
  console.log(`[OCR] ${index}/${logTotal} processing ${file}`);
}

function logSuccess(file: string, candidate: string, filled: number): void {
  console.log(`[OCR] success ${file} candidate=${candidate} fields=${filled}/${KEY_FIELDS.length}`);
}

function logRetry(file: string, status: string, attempt: number, waitMs: number, reason: string): void {
  console.log(`[OCR] retry ${file} status=${status} attempt=${attempt} wait=${Math.round(waitMs / 1000)}s ${reason.replace(/\s+/g, " ").slice(0, 120)}`);
}

function logFailed(file: string, reason: string): void {
  console.log(`[OCR] failed ${file} reason=${reason.replace(/\s+/g, " ").slice(0, 140)}`);
}

function logProgress(done: number): void {
  console.log(`[OCR] progress ${done}/${logTotal}`);
}

/** Quota/spend/rate-limit errors where retrying cannot help; the run stops. */
function isFatalError(e: any): boolean {
  return e instanceof GeminiQuotaError || e instanceof OpenRouterBudgetError || e?.fatal === true;
}

/**
 * Persists one scan row. Shared by the single-file and batched paths so both
 * write exactly the same row shape. Returns the failure reason, or null on
 * success. Never overwrites: with no --replace it only inserts.
 */
async function insertScan(db: any, job: Job, parsedData: Record<string, unknown>): Promise<string | null> {
  const text = renderExtractedText(parsedData);
  if (!text.trim()) return "no text extracted";
  try {
    if (REPLACE) {
      await db.delete(affidavitScans).where(eq(affidavitScans.filename, job.file));
    }
    await db.insert(affidavitScans).values({
      candidateId: job.candidate!.id,
      filename: job.file,
      status: "completed",
      extractedText: text.slice(0, 20000),
      parsedData,
    });
    return null;
  } catch (e: any) {
    return `db: ${String(e?.message || e).slice(0, 160)}`;
  }
}

async function processFile(db: any, engine: VlmEngine | null, job: Job): Promise<ProcessResult> {
  const { file, fullPath, dir, candidate } = job;

  if (!candidate) return { failure: { file, reason: "no DB match" } };

  let buf: Buffer;
  try {
    buf = fs.readFileSync(fullPath);
  } catch {
    return { failure: { file, reason: "read error" } };
  }

  let text = "";
  let parsedData: Record<string, unknown> = {};
  let source = ENGINE;

  try {
    if (ENGINE === "gemini" || ENGINE === "openrouter") {
      if (!engine) throw new Error(`${ENGINE} engine requested but not constructed.`);
      const result = await engine.extract(buf, {
        includePan: !REDACT_PAN,
        // These affidavits are 13-14 pages and the asset tables sit late in the
        // document, so default to reading the whole thing.
        maxPages: params.maxPages ? parseInt(params.maxPages, 10) : undefined,
        scale: params.scale ? parseFloat(params.scale) : undefined,
        onRetry: (attempt, waitMs, reason) => {
          const status = (/http (\d+)/.exec(reason) || [])[1] || "n/a";
          logRetry(file, status, attempt, waitMs, reason);
        },
      });

      if (ENGINE === "openrouter") {
        const cost = estimateCostUsd(result.model, result.inTokens, result.outTokens);
        if (cost !== null) {
          spendUsd += cost;
          if (spendUsd > BUDGET_CAP_USD) {
            return { fatal: `Projected spend $${spendUsd.toFixed(3)} exceeded --budget-cap $${BUDGET_CAP_USD}. Stopping before further charges.` };
          }
        }
      }

      let data = result.data;
      if (REDACT_PAN) data = redactExtraction(data, { dropPanField: true, scrubKinds: ["pan"] });
      parsedData = buildParsedData(data, {
        _source: ENGINE === "openrouter" ? "openrouter" : "gemini",
        _model: result.model,
        _engine: result.engine,
        _state: dir,
        _inTokens: result.inTokens ?? null,
        _outTokens: result.outTokens ?? null,
        _form26Pages: result.pagesRead ?? null,
        _elapsedMs: result.elapsedMs ?? null,
        _estimatedCostUsd: estimateCostUsd(result.model, result.inTokens, result.outTokens),
        _redactedPan: REDACT_PAN,
      });
      text = renderExtractedText(parsedData);
    } else if (ENGINE === "baidu") {
      text = await extractWithBaiduOcr(buf, { filename: file });
      source = "baidu";
    } else {
      const extracted = await textFromPdf(buf);
      if (extracted.trim().length > 200) {
        text = extracted;
        source = "pdf-text";
      } else {
        const result = await ocrPdfPages(buf, file);
        text = result.text;
        source = result.source;
      }
    }
  } catch (e: any) {
    if (isFatalError(e)) return { fatal: e.message };
    return { failure: { file, reason: `extraction: ${String(e?.message || e).slice(0, 160)}` } };
  }

  if (!text.trim()) return { failure: { file, reason: "no text extracted" } };

  // Only the legacy text-based engines need regex parsing. The VLM engines
  // already produced a structured object; re-parsing their rendered text with
  // the regex parser would discard almost every field.
  if (ENGINE !== "gemini" && ENGINE !== "openrouter") {
    const parsed = parseAffidavitText(text);
    parsedData = buildParsedData({ ...parsed, rawText: undefined }, { _source: source, _state: dir });
  }

  const dbReason = await insertScan(db, job, parsedData);
  if (dbReason) return { failure: { file, reason: dbReason } };

  return { filled: countFilledKeyFields(parsedData), source };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const db = drizzle(neon(connectionString));

  if (ENGINE === "gemini" && !isGeminiConfigured()) {
    throw new Error("--engine=gemini requires GEMINI_API_KEY in .env.local.");
  }
  if (ENGINE === "openrouter") {
    if (!isOpenRouterConfigured()) throw new Error("--engine=openrouter requires OPENROUTER_API_KEY in .env.local.");
    const model = openRouterModel();
    const free = isFreeModel(model);
    console.log(`OpenRouter model: ${model}${free ? " (free tier - no cost)" : " (PAID)"}`);
    console.log(
      free
        ? "Free-tier requests remaining today: see GET /api/v1/key\n"
        : `Projected spend is tracked locally; pass --budget-cap=<usd> to hard-stop.\n`,
    );
  }

  const allRows = await db.select().from(candidates);
  console.log(`Engine: ${ENGINE}${ENGINE === "gemini" ? ` (model ${process.env.GEMINI_OCR_MODEL || "gemini-3-flash-preview"})` : ""}`);
  console.log(`Redact PAN: ${REDACT_PAN ? "yes" : "no"}   Concurrency: ${CONCURRENCY}   Force: ${FORCE}   Replace: ${REPLACE}\n`);

  const existingScans = await db.select({ filename: affidavitScans.filename, parsedData: affidavitScans.parsedData }).from(affidavitScans);
  // A VLM engine only skips a file it has read itself, so switching engines
  // re-reads the corpus instead of silently inheriting another engine's rows.
  // Legacy/text engines keep the original "any stored scan counts" rule: their
  // rows predate per-engine provenance and re-running them would re-burn cost
  // for no new information.
  const doneFiles = new Set(
    existingScans
      .filter((s: any) => (VLM_ENGINES.has(ENGINE) ? s.parsedData?._source === ENGINE : true))
      .map((s: { filename: string }) => s.filename),
  );
  console.log(`Loaded ${allRows.length} candidates; ${doneFiles.size} filenames already have ${VLM_ENGINES.has(ENGINE) ? `a ${ENGINE} ` : ""}stored scans.\n`);

  const pdfFiles: Job[] = [];
  for (const dir of ["Delhi", "Kerala"]) {
    const dirPath = path.join("Candidate Affidavits", dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const f of fs.readdirSync(dirPath).filter((f) => f.toLowerCase().endsWith(".pdf"))) {
      pdfFiles.push({ dir, file: f, fullPath: path.join(dirPath, f), candidate: matchToCandidate(allRows, f) });
    }
  }

  // PDFs with no candidate row cannot store a scan (candidateId is NOT NULL),
  // and there is nothing to match them against, so they are dropped here
  // rather than reported as failures on every run.
  const unmatched = pdfFiles.filter((job) => !job.candidate);
  const matched = pdfFiles.filter((job) => Boolean(job.candidate));

  const eligible = matched.filter((job) => {
    if (STATE_FILTER && job.dir !== STATE_FILTER) return false;
    if (FILE_FILTER && !job.file.toLowerCase().includes(FILE_FILTER)) return false;
    if (!FORCE && doneFiles.has(job.file)) return false;
    return true;
  });

  const queue = eligible.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
  const skippedStoredOrFiltered = matched.length - eligible.length;

  console.log(`Found ${pdfFiles.length} PDFs total; ${eligible.length} eligible${Number.isFinite(LIMIT) ? `, capped to ${queue.length} by --limit` : ""}${FILE_FILTER ? `, file filter "${FILE_FILTER}"` : ""}.`);
  if (BATCH > 1) console.log(`Batching: ${BATCH} document(s) per API request.`);
  if (Number.isFinite(MAX_REQUESTS)) console.log(`Request budget: ${MAX_REQUESTS} API request(s) this run.`);
  if (unmatched.length) {
    console.log(`${unmatched.length} PDF(s) have no matching candidate in the database and will be skipped:`);
    for (const job of unmatched) console.log(`  - ${path.join(job.dir, job.file)}`);
    console.log("");
  } else {
    console.log("");
  }

  const engine = ENGINE === "gemini" ? createGeminiEngine() : ENGINE === "openrouter" ? createOpenRouterEngine() : null;
  const failures: Failure[] = [];
  const started = Date.now();
  const requestsAtStart = openRouterStats().requests;
  let attempted = 0;
  let done = 0;
  let stored = 0;
  let lowCoverage = 0;
  let docMsTotal = 0;
  const coverage: Record<string, number> = {};

  logTotal = queue.length;

  let halted = false;
  let haltReason = "";

  const requestsUsed = () => openRouterStats().requests - requestsAtStart;

  const noteStored = (filled: number): void => {
    if (ENGINE === "gemini" || ENGINE === "openrouter") coverage[String(filled)] = (coverage[String(filled)] || 0) + 1;
    if (filled < KEY_FIELDS.length - 3) lowCoverage++;
  };

  const requestBudgetHit = (): boolean => {
    if (requestsUsed() >= MAX_REQUESTS) {
      halted = true;
      haltReason = `Request budget exhausted: ${requestsUsed()}/${MAX_REQUESTS} API requests used this run (--max-requests).`;
      return true;
    }
    return false;
  };

  // Single-document requests, one row per outcome line.
  const runSingle = async (): Promise<void> => {
    const queueRef = [...queue];
    const workerCount = Math.min(CONCURRENCY, Math.max(1, queueRef.length));

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (queueRef.length) {
          if (halted) return;
          const job = queueRef.shift();
          if (!job) return;
          attempted++;
          logProcessing(attempted, job.file);
          const t0 = Date.now();
          const result = await processFile(db, engine, job);
          docMsTotal += Date.now() - t0;
          done++;
          if (result.fatal) {
            halted = true;
            haltReason = result.fatal;
            return;
          }
          if (result.failure) {
            failures.push(result.failure);
            logFailed(job.file, result.failure.reason);
          } else {
            stored++;
            const filled = result.filled ?? 0;
            noteStored(filled);
            logSuccess(job.file, job.candidate?.name || "?", filled);
          }
          logProgress(done);
          requestBudgetHit();
        }
      }),
    );
  };

  // Batched requests: N affidavits per API call, one row written per document.
  const runBatched = async (): Promise<void> => {
    const orEngine = engine as OpenRouterEngineApi;
    const model = openRouterModel();
    const batches: Job[][] = [];
    for (let i = 0; i < queue.length; i += BATCH) batches.push(queue.slice(i, i + BATCH));

    const queueRef = [...batches];
    const workerCount = Math.min(CONCURRENCY, Math.max(1, queueRef.length));

    const settle = async (job: Job, item: BatchItemResult, batchElapsed: number): Promise<void> => {
      done++;
      if (!item.ok || !item.data) {
        const reason = item.error || "not returned by engine";
        failures.push({ file: job.file, reason });
        logFailed(job.file, reason);
        return;
      }

      const cost = estimateCostUsd(model, item.inTokens, item.outTokens);
      if (cost !== null) {
        spendUsd += cost;
        if (spendUsd > BUDGET_CAP_USD && !halted) {
          halted = true;
          haltReason = `Projected spend $${spendUsd.toFixed(3)} exceeded --budget-cap $${BUDGET_CAP_USD}. Stopping before further charges.`;
        }
      }

      let data = item.data;
      if (REDACT_PAN) data = redactExtraction(data, { dropPanField: true, scrubKinds: ["pan"] });
      const parsedData = buildParsedData(data, {
        _source: "openrouter",
        _model: model,
        _engine: "openrouter",
        _state: job.dir,
        _inTokens: item.inTokens ?? null,
        _outTokens: item.outTokens ?? null,
        _form26Pages: item.pagesRead ?? null,
        // Wall time of the batched request that carried this document.
        _elapsedMs: batchElapsed,
        _estimatedCostUsd: estimateCostUsd(model, item.inTokens, item.outTokens),
        _redactedPan: REDACT_PAN,
      });

      const dbReason = await insertScan(db, job, parsedData);
      if (dbReason) {
        failures.push({ file: job.file, reason: dbReason });
        logFailed(job.file, dbReason);
        return;
      }
      stored++;
      const filled = countFilledKeyFields(parsedData);
      noteStored(filled);
      logSuccess(job.file, job.candidate?.name || "?", filled);
    };

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (queueRef.length) {
          if (halted) return;
          const batchJobs = queueRef.shift();
          if (!batchJobs?.length) return;

          // Do not start a batch whose requests the budget could not finish.
          if (requestBudgetHit()) return;

          const batchStart = Date.now();
          for (const job of batchJobs) {
            attempted++;
            logProcessing(attempted, job.file);
          }

          // A file that cannot be read fails on its own, not with its batch.
          const docs: { id: string; pdf: Buffer }[] = [];
          const jobsById = new Map<string, Job>();
          const unreadable: Job[] = [];
          for (const job of batchJobs) {
            if (!job.candidate) {
              unreadable.push(job);
              continue;
            }
            try {
              docs.push({ id: job.file, pdf: fs.readFileSync(job.fullPath) });
              jobsById.set(job.file, job);
            } catch {
              unreadable.push(job);
            }
          }
          for (const job of unreadable) {
            done++;
            const reason = job.candidate ? "read error" : "no DB match";
            failures.push({ file: job.file, reason });
            logFailed(job.file, reason);
          }

          if (docs.length) {
            try {
              const res = await orEngine.extractBatch(docs, {
                includePan: !REDACT_PAN,
                maxPages: params.maxPages ? parseInt(params.maxPages, 10) : undefined,
                scale: params.scale ? parseFloat(params.scale) : undefined,
                // Splits and retries count against the same daily cap, so the
                // engine may only spend what is left plus one recovery round.
                requestBudget: Math.max(1, Math.min(BATCH + 3, MAX_REQUESTS - requestsUsed())),
                onRetry: (attempt, waitMs, reason) => {
                  const status = (/(?:http )(\d+)/.exec(reason) || [])[1] || "n/a";
                  const label = docs.length === 1 ? docs[0].id : `${docs[0].id} +${docs.length - 1} more`;
                  logRetry(label, status, attempt, waitMs, reason);
                },
              });

              const byId = new Map(res.items.map((i) => [i.id, i]));
              const batchElapsed = Date.now() - batchStart;
              for (const doc of docs) {
                const job = jobsById.get(doc.id)!;
                const item = byId.get(doc.id);
                await settle(job, item || { id: doc.id, ok: false, error: "not returned by engine" }, batchElapsed);
                logProgress(done);
              }
            } catch (e: any) {
              const batchElapsed = Date.now() - batchStart;
              if (isFatalError(e)) {
                halted = true;
                haltReason = e.message;
                for (const doc of docs) {
                  done++;
                  failures.push({ file: doc.id, reason: "run halted during batch; outcome unknown (will retry next run)" });
                }
                return;
              }
              const reason = `extraction: ${String(e?.message || e).slice(0, 160)}`;
              for (const doc of docs) {
                const job = jobsById.get(doc.id)!;
                await settle(job, { id: doc.id, ok: false, error: reason }, batchElapsed);
                logProgress(done);
              }
            }
          }

          requestBudgetHit();
        }
      }),
    );
  };

  if (BATCH > 1) await runBatched();
  else await runSingle();

  const elapsedMs = Date.now() - started;
  const elapsed = (elapsedMs / 1000).toFixed(0);
  const orStats = ENGINE === "openrouter" ? openRouterStats() : null;
  const notAttempted = queue.length - done;

  console.log(`\n\n===== PIPELINE SUMMARY (${elapsed}s) =====`);
  console.log(`Engine: ${ENGINE}${ENGINE === "openrouter" ? ` (${openRouterModel()})` : ""}${BATCH > 1 ? `   Batch size: ${BATCH}` : ""}`);
  console.log(`Attempted: ${done}/${queue.length}   Successful: ${stored}   Failed: ${failures.length}   Not attempted: ${notAttempted}`);
  console.log(`Skipped (stored scan or filter): ${skippedStoredOrFiltered}   Unmatched PDFs: ${unmatched.length}`);
  if (orStats) {
    console.log(
      `API requests: ${orStats.requests}   Retries: ${orStats.retries}   Rate-limit events: ${orStats.rateLimitEvents}   Payload-too-large events: ${orStats.bodyTooLargeEvents}`,
    );
  }
  if (done) console.log(`Avg time per document: ${Math.round(docMsTotal / done / 1000)}s   Elapsed: ${elapsed}s`);

  if (halted) {
    console.log(`\n*** HALTED EARLY after ${done} document(s). ***`);
    console.log(haltReason);
    if (notAttempted > 0) {
      console.log(`${notAttempted} file(s) were not attempted. Re-run the same command later; stored results are kept and skipped unless --force is passed.`);
    }
  }
  if (ENGINE === "gemini" || ENGINE === "openrouter") {
    if (ENGINE === "openrouter" && !isFreeModel(openRouterModel())) {
      console.log(`Estimated spend this run: $${spendUsd.toFixed(4)} (check GET /api/v1/key for the billed amount)`);
    }
    console.log(`Rows with < ${KEY_FIELDS.length - 3} key fields filled: ${lowCoverage}`);
    if (Object.keys(coverage).length) {
      console.log("Key-field coverage histogram (filled -> count):");
      for (const k of Object.keys(coverage).sort((a, b) => Number(b) - Number(a))) {
        console.log(`  ${k}/${KEY_FIELDS.length} -> ${coverage[k]}`);
      }
    }
    console.log(`PAN redaction: ${REDACT_PAN ? `enabled (${REDACTED})` : "disabled — PAN retained"}`);
  }
  if (failures.length) {
    console.log(`\nRemaining failures (${failures.length}):`);
    const grouped = new Map<string, string[]>();
    for (const f of failures) {
      const key = f.reason.replace(/\d+/g, "N").slice(0, 60);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(f.file);
    }
    for (const [reason, files] of grouped) {
      console.log(`  ${files.length}x ${reason}`);
      for (const f of files.slice(0, 6)) console.log(`      - ${f}`);
      if (files.length > 6) console.log(`      ... and ${files.length - 6} more`);
    }
  }
  console.log(`[OCR] progress ${done}/${queue.length} complete`);
}

main().catch((e) => {
  console.error("Pipeline error:", e);
  process.exit(1);
});