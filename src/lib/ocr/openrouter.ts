import {
  buildBatchExtractionPrompt,
  buildExtractionPrompt,
  isFreeModel,
  parseBatchExtractionJson,
  parseExtractionJson,
  type BatchExtraction,
  type ExtractOptions,
  type ExtractionResult,
  type VlmEngine,
} from "./vlm";

export { isFreeModel };

import { createRequire } from "module";

const require = createRequire(import.meta.url);

const API_ROOT = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_OPENROUTER_MODEL = "qwen/qwen3-vl-32b-instruct";

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function openRouterModel(): string {
  return process.env.OPENROUTER_OCR_MODEL || DEFAULT_OPENROUTER_MODEL;
}

export function apiKeyLabel(): string {
  const key = process.env.OPENROUTER_API_KEY || "";
  return key.length > 12 ? `${key.slice(0, 10)}...${key.slice(-3)}` : "(not set)";
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export class OpenRouterBudgetError extends Error {
  readonly fatal = true;
  constructor(detail: string) {
    super(`OpenRouter budget exhausted (${detail}). Add credits or raise the key credit limit, then re-run.`);
    this.name = "OpenRouterBudgetError";
  }
}

/**
 * The free tier allows a fixed number of free-model requests per day. Once
 * that cap answers, every retry burns nothing but time, so the run stops and
 * resumes after the UTC reset instead of looping.
 */
export class OpenRouterDailyLimitError extends Error {
  readonly fatal = true;
  constructor(detail: string) {
    super(`OpenRouter free-model daily request limit reached (${detail}). The cap resets at 00:00 UTC; re-run then.`);
    this.name = "OpenRouterDailyLimitError";
  }
}

/** Raised when a run passes --max-requests so a batch cannot overspend the day's cap. */
export class RequestBudgetExhaustedError extends Error {
  readonly fatal = true;
  constructor(used: number, cap: number) {
    super(`Request budget exhausted: ${used}/${cap} API requests used this run. Stop and resume later.`);
    this.name = "RequestBudgetExhaustedError";
  }
}

export interface OpenRouterStats {
  /** Chat-completion requests actually sent (includes retries and batch splits). */
  requests: number;
  /** Requests that were retried after a retryable failure. */
  retries: number;
  /** HTTP 429 responses received. */
  rateLimitEvents: number;
  /** HTTP 413 payload-too-large responses received. */
  bodyTooLargeEvents: number;
}

const stats: OpenRouterStats = { requests: 0, retries: 0, rateLimitEvents: 0, bodyTooLargeEvents: 0 };

export function openRouterStats(): OpenRouterStats {
  return { ...stats };
}

export function resetOpenRouterStats(): void {
  stats.requests = 0;
  stats.retries = 0;
  stats.rateLimitEvents = 0;
  stats.bodyTooLargeEvents = 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function minIntervalMs(): number {
  const raw = parseInt(process.env.OPENROUTER_MIN_INTERVAL_MS || "3100", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 3100;
}

/** Cheap page count, used to detect a deliberately truncated read. */
async function countPdfPages(pdf: Buffer): Promise<number> {
  try {
    const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdf) }).promise;
    const n = doc.numPages;
    doc.destroy?.();
    return n;
  } catch {
    return 0;
  }
}

let lastRequestAt = 0;
let paceChain: Promise<void> = Promise.resolve();

/**
 * Serialises the interval between requests. Concurrent callers must queue
 * behind one another, otherwise several workers inspect the same
 * `lastRequestAt` and burst past the free tier's per-minute cap together.
 */
async function pace(): Promise<void> {
  const turn = paceChain.then(async () => {
    const gap = minIntervalMs() - (Date.now() - lastRequestAt);
    if (gap > 0) await sleep(gap);
    lastRequestAt = Date.now();
  });
  paceChain = turn.catch(() => {});
  return turn;
}

interface Attempt {
  ok: boolean;
  status: number;
  body?: string;
  json?: any;
  elapsedMs: number;
  budget?: boolean;
  bodyTooLarge?: boolean;
  /** True when 429 means the free tier's daily cap, not a transient burst. */
  dailyLimit?: boolean;
  /** Server-requested wait before the next attempt, from Retry-After (ms). */
  retryAfterMs?: number;
}

function retryAfterMsFrom(headers: Headers): number {
  const raw = headers.get("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

async function postOnce(
  model: string,
  contentParts: any[],
  timeoutMs: number,
  promptText: string,
  maxTokens: number,
): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  const body = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: promptText },
          ...contentParts,
        ],
      },
    ],
    // Structured output is requested via the schema in the prompt rather than
    // response_format, because several free/vision models reject json_schema.
    max_tokens: maxTokens,
    temperature: 0,
  };

  stats.requests++;

  try {
    await pace();
    const res = await fetch(API_ROOT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY || ""}`,
        "HTTP-Referer": "https://github.com/chunav-bodh",
        "X-Title": "Chunav Bodh affidavit OCR",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      if (res.status === 429) stats.rateLimitEvents++;
      if (res.status === 413) stats.bodyTooLargeEvents++;
      // 403 with a key/credit-limit message is a spent budget, not a permission
      // problem; treat it as fatal so retries cannot waste more calls.
      const budget =
        res.status === 402 ||
        (res.status === 403 && /limit exceeded|insufficient credit|quota|billing/i.test(text.slice(0, 500))) ||
        /insufficient credit|exceeded your credit|limit_remaining|balance/i.test(text.slice(0, 500));
      // The free tier's 50-requests/day cap answers as a 429 whose body names
      // the daily allowance. Distinguished from a burst 429 because waiting
      // cannot help until 00:00 UTC.
      const dailyLimit =
        res.status === 429 &&
        /daily|per day|every ?24 ?hours|free_model_daily|50 requests|free (tier|model)[^\n]{0,120}(limit|exceeded)|(limit|exceeded)[^\n]{0,120}free (tier|model)/i.test(
          text.slice(0, 800),
        );
      return {
        ok: false,
        status: res.status,
        body: text.slice(0, 500),
        elapsedMs: Date.now() - started,
        budget,
        bodyTooLarge: res.status === 413,
        dailyLimit,
        retryAfterMs: retryAfterMsFrom(res.headers),
      };
    }
    return { ok: true, status: res.status, json: JSON.parse(text), elapsedMs: Date.now() - started };
  } catch (e: any) {
    return {
      ok: false,
      status: e?.name === "AbortError" ? 408 : 0,
      body: String(e?.message || e).slice(0, 300),
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractContent(json: any): string {
  return json?.choices?.[0]?.message?.content ?? "";
}

/** Providers reject oversized bodies (Google AI Studio: 20,000,000 bytes, HTTP 413). */
const MAX_BODY_BYTES = (() => {
  const raw = parseInt(process.env.OPENROUTER_MAX_BODY_BYTES || "19000000", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 19000000;
})();

function imageEncoding(options: ExtractOptions): { format: "png" | "jpeg"; quality: number; mime: string } {
  const format = options.imageFormat ?? (process.env.OPENROUTER_IMAGE_FORMAT === "png" ? "png" : "jpeg");
  const parsed = parseFloat(process.env.OPENROUTER_IMAGE_QUALITY || "0.8");
  const quality = options.imageQuality ?? (Number.isFinite(parsed) && parsed > 0 ? parsed : 0.8);
  return { format, quality, mime: format === "jpeg" ? "image/jpeg" : "image/png" };
}

/** Approximate JSON body size of a message's content parts (base64 strings dominate). */
function bodyBytesOf(content: any[], prompt: string): number {
  let n = prompt.length + 512;
  for (const part of content) n += part.image_url?.url?.length ?? part.text?.length ?? 0;
  return n;
}

// Models that ignore the requested schema often substitute close synonyms.
// Normalising here keeps the stored shape consistent with the Gemini rows so
// db:ocr:compare compares like with like.
const ALIASES: Record<string, string[]> = {
  fatherName: ["fatherHusbandName", "father_name", "fathersName", "husbandName"],
  educationalQualification: ["education", "educationalQualificationDetails", "qualification"],
  totalAssets: ["assets", "totalAsset", "assetsTotal", "grandTotalAssets"],
  totalLiabilities: ["liabilities", "totalLiability", "liabilitiesTotal"],
  totalMovableAssets: ["movableAssets", "movable"],
  totalImmovableAssets: ["immovableAssets", "immovable"],
  criminalCases: ["totalCriminalCases", "numberOfCriminalCases", "pendingCriminalCases"],
  form26Pages: ["form26PageNumbers", "pages"],
};

function normaliseKeys(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const [canonical, alternatives] of Object.entries(ALIASES)) {
    if (out[canonical] !== undefined && out[canonical] !== null && out[canonical] !== "") continue;
    for (const alt of alternatives) {
      const value = out[alt];
      if (value !== undefined && value !== null && value !== "") {
        out[canonical] = value;
        break;
      }
    }
  }
  return out;
}

/**
 * Models often return asset figures as an object ({self, spouse, total}) rather
 * than a string. Flatten to a readable scalar so downstream storage and the
 * ocrCompare tool never see "[object Object]".
 */
function flattenMonetary(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(flattenMonetary);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["total", "grandTotal", "amount", "value", "self", "spouse"]) {
      if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
        const flat = flattenMonetary(obj[key]);
        if (flat !== undefined && flat !== "") return flat;
      }
    }
    return Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${flattenMonetary(v)}`)
      .join(", ");
  }
  return value;
}

const MONETARY_FIELDS = [
  "totalAssets",
  "totalLiabilities",
  "totalMovableAssets",
  "totalImmovableAssets",
];

function normaliseMonetary(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  for (const f of MONETARY_FIELDS) {
    if (out[f] !== undefined) out[f] = flattenMonetary(out[f]);
  }
  return out;
}

/**
 * Asset and liability figures are the whole point of these documents, so a
 * response missing every one of them is treated as a truncated read rather
 * than a genuine "candidate declared none".
 */
function looksTruncated(data: Record<string, unknown>): boolean {
  const blank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
  const assetFields = [
    "totalAssets",
    "assets",
    "totalMovableAssets",
    "totalImmovableAssets",
    "assetsBreakdown",
    "movableAssets",
    "immovableAssets",
  ];
  return assetFields.every((f) => blank(data[f]));
}

export interface BatchDocInput {
  id: string;
  pdf: Buffer;
}

export interface BatchItemResult {
  id: string;
  ok: boolean;
  data?: Record<string, unknown>;
  text?: string;
  inTokens?: number;
  outTokens?: number;
  pagesRead?: string;
  error?: string;
}

export interface BatchExtractResult {
  items: BatchItemResult[];
  requestsUsed: number;
}

export interface OpenRouterEngineApi extends VlmEngine {
  extractBatch(docs: BatchDocInput[], options?: ExtractOptions): Promise<BatchExtractResult>;
}

interface PreparedDoc {
  id: string;
  pages: Buffer[];
  totalPages: number;
}

/** Drops image parts from the oldest half of the page list and retries smaller. */
class OpenRouterEngine implements OpenRouterEngineApi {
  readonly name = "openrouter";

  constructor(readonly model: string = openRouterModel()) {}

  async extract(pdf: Buffer, options: ExtractOptions = {}): Promise<ExtractionResult> {
    if (!isOpenRouterConfigured()) throw new Error("OPENROUTER_API_KEY is not set in .env.local.");

    const { renderPdfPagesToPng } = await import("./pdf");
    const timeoutMs = options.timeoutMs ?? 180000;
    const maxAttempts = Math.min(options.maxAttempts ?? 3, 3);
    const prompt = buildExtractionPrompt(options.includePan ?? false);

    // Qwen-VL family takes images, not PDF bytes. Render pages to PNG and send
    // them as base64 data URLs.
    //
    // The default must cover whole documents: these affidavits run 13-14 pages,
    // and Form 26 Part B (assets) / Part C (liabilities) typically start around
    // page 5. Truncating to a handful of pages yields honest but empty
    // asset fields, because those pages genuinely do not carry them.
    const maxPages = options.maxPages ?? 20;
    const encoding = imageEncoding(options);
    let pages = await renderPdfPagesToPng(pdf, {
      maxPages,
      scale: options.scale ?? 1.5,
      format: encoding.format,
      quality: encoding.quality,
    });

    // How many pages the document actually has, so a truncated read can tell the
    // difference between "no assets declared" and "we never saw those pages".
    const totalPages = await countPdfPages(pdf);
    const startPages = pages.length;

    let lastError = "";
    let totalAttempts = 0;
    // Halving pages only helps payload-size problems (413/oversize); a
    // transient 429 or a broken parse is not cured by sending fewer pages,
    // so the attempt loop exits without shrinking in those cases.
    let shrinkPages = false;

    while (pages.length > 0) {
      const contentParts = pages.map((buffer) => ({
        type: "image_url",
        image_url: { url: `data:${encoding.mime};base64,${buffer.toString("base64")}` },
      }));

      // Split/trim locally before spending a request on a known 413.
      const approxBytes = bodyBytesOf(contentParts, prompt);
      if (approxBytes > MAX_BODY_BYTES) {
        shrinkPages = true;
        lastError = `payload ${Math.round(approxBytes / 1e6)}MB exceeds ${Math.round(MAX_BODY_BYTES / 1e6)}MB provider cap`;
        break;
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        totalAttempts++;
        const res = await postOnce(this.model, contentParts, timeoutMs, prompt, 32768);

        if (res.ok) {
          const raw = extractContent(res.json);
          if (raw.trim()) {
            const data = normaliseMonetary(normaliseKeys(parseExtractionJson(raw)));

            // Only treat an all-empty asset block as a failed read when the
            // document has pages we did not send. Otherwise it is a real answer.
            const pagesOmitted = totalPages > startPages;
            if (looksTruncated(data) && pagesOmitted) {
              lastError = `asset fields all empty though ${totalPages - startPages} page(s) were not sent`;
              break;
            } else {
              return {
                engine: this.name,
                model: this.model,
                data,
                text: raw,
                elapsedMs: res.elapsedMs,
                inTokens: res.json?.usage?.prompt_tokens,
                outTokens: res.json?.usage?.completion_tokens,
                pagesRead: `${pages.length} pages`,
              };
            }
          } else {
            lastError = `empty content (finish_reason=${res.json?.choices?.[0]?.finish_reason})`;
          }
        } else if (res.budget) {
          throw new OpenRouterBudgetError(`http ${res.status}: ${(res.body || "").replace(/\s+/g, " ").slice(0, 120)}`);
        } else if (res.dailyLimit) {
          throw new OpenRouterDailyLimitError(`http ${res.status}: ${(res.body || "").replace(/\s+/g, " ").slice(0, 120)}`);
        } else if (res.bodyTooLarge) {
          shrinkPages = true;
          break; // handled by the page-reduction loop below
        } else {
          lastError = `http ${res.status}: ${(res.body || "").replace(/\s+/g, " ").slice(0, 140)}`;
          if (!RETRYABLE.has(res.status)) break;
        }

        if (attempt < maxAttempts) {
          stats.retries++;
          // A server-provided Retry-After overrides local backoff: it is the
          // wait the provider actually requires, especially on 429.
          const wait = res.retryAfterMs || Math.min(1500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 600), 12000);
          options.onRetry?.(attempt, wait, `${this.model} ${lastError}`);
          await sleep(wait);
        }
      }

      if (!shrinkPages) break;
      if (pages.length <= 2) break;
      const next = Math.max(2, Math.floor(pages.length / 2));
      pages = pages.slice(0, next);
      lastError = `retrying with ${pages.length} page(s): ${lastError}`;
      options.onRetry?.(1, 0, lastError);
    }

    throw new Error(`OpenRouter extraction failed after ${totalAttempts} attempt(s). Last error: ${lastError}`);
  }

  /**
   * Reads several affidavits in ONE request: prompt + a `=== DOCUMENT n: <file>`
   * marker and that file's page images, answered by a single JSON object keyed
   * by filename. This exists purely to fit the free tier's daily request cap.
   *
   * Failure handling stays bounded: a partial response re-requests only the
   * docs the model missed, an unusable/oversized response halves the group,
   * and both are capped by depth plus `options.requestBudget` so a bad evening
   * cannot quietly spend tomorrow's quota too.
   */
  async extractBatch(docs: BatchDocInput[], options: ExtractOptions = {}): Promise<BatchExtractResult> {
    if (!isOpenRouterConfigured()) throw new Error("OPENROUTER_API_KEY is not set in .env.local.");
    if (!docs.length) return { items: [], requestsUsed: 0 };

    const { renderPdfPagesToPng } = await import("./pdf");
    const timeoutMs = options.timeoutMs ?? 600000;
    const maxAttempts = Math.min(options.maxAttempts ?? 2, 3);
    const maxPages = options.maxPages ?? 20;
    const requestBudget = options.requestBudget ?? 6;
    const prompt = buildBatchExtractionPrompt(options.includePan ?? false);
    const encoding = imageEncoding(options);

    const prepared: PreparedDoc[] = [];
    for (const doc of docs) {
      const pages = await renderPdfPagesToPng(doc.pdf, {
        maxPages,
        scale: options.scale ?? 1.5,
        format: encoding.format,
        quality: encoding.quality,
      });
      prepared.push({ id: doc.id, pages, totalPages: await countPdfPages(doc.pdf) });
    }

    const results = new Map<string, BatchItemResult>();
    let requestsUsed = 0;

    const failPending = (pending: PreparedDoc[], error: string): void => {
      for (const d of pending) {
        if (!results.get(d.id)?.ok) results.set(d.id, { id: d.id, ok: false, error });
      }
    };

    const dispatch = async (subset: PreparedDoc[], depth: number): Promise<void> => {
      const pending = subset.filter((d) => !results.get(d.id)?.ok);
      if (!pending.length) return;

      if (requestsUsed >= requestBudget) {
        failPending(pending, `request budget for this batch exhausted (${requestsUsed}/${requestBudget} requests)`);
        return;
      }
      if (depth > 4) {
        failPending(pending, "unresolved after batch retries");
        return;
      }

      const content: any[] = [];
      pending.forEach((d, i) => {
        content.push({ type: "text", text: `=== DOCUMENT ${i + 1}/${pending.length}: ${d.id} ===` });
        for (const page of d.pages) {
          content.push({ type: "image_url", image_url: { url: `data:${encoding.mime};base64,${page.toString("base64")}` } });
        }
      });
      // Headroom for the keyed wrapper plus one full extraction per document
      // (single-doc probes hit the old 8192 cap mid-object).
      const maxTokens = Math.min(32768, 4096 + pending.length * 4096);

      // Provider body caps are absolute: split BEFORE spending a request, so a
      // 413 never costs quota. Local splitting is free.
      const approxBytes = bodyBytesOf(content, prompt);
      if (approxBytes > MAX_BODY_BYTES) {
        if (pending.length === 1) {
          failPending(pending, `payload too large (${Math.round(approxBytes / 1e6)}MB exceeds ${Math.round(MAX_BODY_BYTES / 1e6)}MB provider cap)`);
          return;
        }
        const mid = Math.ceil(pending.length / 2);
        await dispatch(pending.slice(0, mid), depth + 1);
        await dispatch(pending.slice(mid), depth + 1);
        return;
      }

      let lastError = "";
      let splitAfterLoop = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        requestsUsed++;
        const res = await postOnce(this.model, content, timeoutMs, prompt, maxTokens);

        if (res.budget) {
          throw new OpenRouterBudgetError(`http ${res.status}: ${(res.body || "").replace(/\s+/g, " ").slice(0, 120)}`);
        }
        if (res.dailyLimit) {
          throw new OpenRouterDailyLimitError(`http ${res.status}: ${(res.body || "").replace(/\s+/g, " ").slice(0, 120)}`);
        }

        if (res.bodyTooLarge) {
          if (pending.length === 1) {
            failPending(pending, `payload too large (${pending[0].pages.length} pages, ${pending[0].totalPages} in PDF)`);
            return;
          }
          splitAfterLoop = true;
          break;
        }

        if (res.ok) {
          const raw = extractContent(res.json);
          if (!raw.trim()) {
            lastError = `empty content (finish_reason=${res.json?.choices?.[0]?.finish_reason})`;
          } else {
            let batchParse: BatchExtraction | null = null;
            try {
              batchParse = parseBatchExtractionJson(raw, pending.map((d) => d.id));
            } catch (e: any) {
              lastError = `unparseable batch response: ${String(e?.message || e).slice(0, 120)}`;
            }

            if (batchParse) {
              const inTokens = res.json?.usage?.prompt_tokens;
              const outTokens = res.json?.usage?.completion_tokens;
              const failed: PreparedDoc[] = [];

              for (const d of pending) {
                const obj = batchParse.byId.get(d.id);
                if (!obj) {
                  results.set(d.id, { id: d.id, ok: false, error: "missing from batch response" });
                  failed.push(d);
                  continue;
                }
                const data = normaliseMonetary(normaliseKeys(obj));
                const pagesOmitted = d.totalPages > d.pages.length;
                if (looksTruncated(data) && pagesOmitted) {
                  results.set(d.id, {
                    id: d.id,
                    ok: false,
                    error: `asset fields all empty though ${d.totalPages - d.pages.length} page(s) were not sent`,
                  });
                  failed.push(d);
                  continue;
                }
                results.set(d.id, {
                  id: d.id,
                  ok: true,
                  data,
                  text: raw,
                  inTokens,
                  outTokens,
                  pagesRead: `${d.pages.length} pages`,
                });
              }

              if (!failed.length) return;

              if (failed.length < pending.length) {
                // The model clearly can read these docs; give the stragglers
                // a dedicated request instead of re-sending the whole group.
                await dispatch(failed, depth + 1);
                return;
              }
              lastError = lastError || "no document in the batch response matched the request";
            }
          }
        } else {
          lastError = `http ${res.status}: ${(res.body || "").replace(/\s+/g, " ").slice(0, 140)}`;
          if (!RETRYABLE.has(res.status)) {
            splitAfterLoop = pending.length > 1;
            break;
          }
        }

        if (attempt < maxAttempts) {
          stats.retries++;
          const wait = res.retryAfterMs || Math.min(1500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 600), 15000);
          options.onRetry?.(attempt, wait, `${this.model} ${lastError}`);
          await sleep(wait);
        }
      }

      if (pending.length > 1 && (splitAfterLoop || lastError)) {
        const mid = Math.ceil(pending.length / 2);
        await dispatch(pending.slice(0, mid), depth + 1);
        await dispatch(pending.slice(mid), depth + 1);
        return;
      }

      failPending(pending, lastError || "extraction failed");
    };

    await dispatch(prepared, 0);

    return { items: prepared.map((d) => results.get(d.id) ?? { id: d.id, ok: false, error: "not attempted" }), requestsUsed };
  }
}

export function createOpenRouterEngine(model?: string): OpenRouterEngineApi {
  return new OpenRouterEngine(model);
}
