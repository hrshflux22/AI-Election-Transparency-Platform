import {
  buildExtractionPrompt,
  buildExtractionSchema,
  parseExtractionJson,
  type ExtractOptions,
  type ExtractionResult,
  type VlmEngine,
} from "./vlm";

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

export const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";

// Fallbacks are only tried for capacity errors (5xx/429). They must NOT be
// tried on plain 429 when the account is genuinely exhausted — but a 429 that
// keeps occurring across models is escalated to GeminiQuotaError, so the run
// halts cleanly instead of burning attempts forever.
export const GEMINI_FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash"];

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function geminiModel(): string {
  return process.env.GEMINI_OCR_MODEL || DEFAULT_GEMINI_MODEL;
}

/** Free-tier headroom is tight; space requests out instead of bursting. */
function minIntervalMs(): number {
  const raw = parseInt(process.env.GEMINI_MIN_INTERVAL_MS || "4000", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 4000;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
// 429 is included so that an exhausted primary lands on the fallback model
// (see extract) before escalating to a fatal halt.
const CAPACITY_STATUS = new Set([429, 500, 502, 503, 504]);

export function geminiQuotaWaitMs(): number {
  const raw = parseInt(process.env.GEMINI_QUOTA_WAIT_MS || "30000", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 30000;
}

export class GeminiQuotaError extends Error {
  readonly fatal = true;
  constructor(readonly lastStatus: number, readonly attempts: number) {
    super(
      `Gemini quota/rate limit hit (HTTP ${lastStatus}) after ${attempts} attempt(s). ` +
        `Stop here, do not retry — wait for the quota window to reset, then re-run the ` +
        `pipeline; completed files are already stored and will be skipped.`,
    );
    this.name = "GeminiQuotaError";
  }
}

let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialises requests globally so concurrent workers cannot burst past the limit. */
async function pace(): Promise<void> {
  const gap = minIntervalMs() - (Date.now() - lastRequestAt);
  if (gap > 0) await sleep(gap);
  lastRequestAt = Date.now();
}

function backoffMs(attempt: number): number {
  return Math.min(1500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 750), 15000);
}

interface Attempt {
  ok: boolean;
  status: number;
  body?: string;
  json?: any;
  elapsedMs: number;
  reasoningUnsupported?: boolean;
  quota?: boolean;
}

async function postOnce(
  model: string,
  inlineData: { mimeType: string; data: string },
  includePan: boolean,
  timeoutMs: number,
  useThinkingConfig: boolean,
): Promise<Attempt> {
  const generationConfig: Record<string, unknown> = {
    temperature: 0,
    // Long affidavits (20+ pages, itemised asset/liability arrays) exceed 8192
    // output tokens; the schema-constrained JSON is compact, so a higher cap
    // only ever helps and never produces prose.
    maxOutputTokens: 32768,
    responseMimeType: "application/json",
    responseSchema: buildExtractionSchema(includePan),
  };
  if (useThinkingConfig) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    await pace();
    const res = await fetch(`${API_ROOT}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY || "" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildExtractionPrompt(includePan) }, { inlineData }] }],
        generationConfig,
      }),
      signal: controller.signal,
    });

    const body = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        body: body.slice(0, 500),
        elapsedMs: Date.now() - started,
        quota: res.status === 429,
        reasoningUnsupported: res.status === 400 && /thinking|generation[_]?config/i.test(body),
      };
    }
    return { ok: true, status: res.status, json: JSON.parse(body), elapsedMs: Date.now() - started };
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

function extractText(json: any): string {
  return (json?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
}

class GeminiEngine implements VlmEngine {
  readonly name = "gemini";

  constructor(readonly model: string = geminiModel()) {}

  async extract(pdf: Buffer, options: ExtractOptions = {}): Promise<ExtractionResult> {
    if (!isGeminiConfigured()) throw new Error("GEMINI_API_KEY is not set in .env.local.");

    const includePan = options.includePan ?? false;
    const timeoutMs = options.timeoutMs ?? 180000;
    const maxAttempts = Math.min(options.maxAttempts ?? 3, 3);
    const inlineData = { mimeType: "application/pdf", data: pdf.toString("base64") };

    let useThinkingConfig = true;
    let droppedThinking = false;
    let lastError = "";
    let totalAttempts = 0;
    // 429s on the free tier are frequently a transient shared-pool throttle
    // (interleaved between 503 "high demand" responses) rather than account
    // exhaustion. We retry each one with a long pause and cycle fallback
    // models; only persistent 429s across the whole plan escalate.
    let quotaHits = 0;
    const maxQuotaHits = 6;

    const plan: { model: string; forCapacity: boolean }[] = [{ model: this.model, forCapacity: false }];
    for (const m of GEMINI_FALLBACK_MODELS) {
      if (m !== this.model) plan.push({ model: m, forCapacity: true });
    }

    for (let modelIndex = 0; modelIndex < plan.length; modelIndex++) {
      const { model, forCapacity } = plan[modelIndex];

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        totalAttempts++;
        const res = await postOnce(model, inlineData, includePan, timeoutMs, useThinkingConfig);

        if (res.reasoningUnsupported && !droppedThinking) {
          droppedThinking = true;
          useThinkingConfig = false;
          attempt--;
          continue;
        }

        if (res.ok) {
          const raw = extractText(res.json);
          if (raw.trim()) {
            const data = parseExtractionJson(raw);
            return {
              engine: this.name,
              model,
              data,
              text: raw,
              elapsedMs: res.elapsedMs,
              inTokens: res.json?.usageMetadata?.promptTokenCount,
              outTokens: res.json?.usageMetadata?.candidatesTokenCount,
              pagesRead: typeof data.form26Pages === "string" ? data.form26Pages : undefined,
            };
          }
          lastError = `empty response (finishReason=${res.json?.candidates?.[0]?.finishReason})`;
        } else if (res.quota) {
          // Possibly transient shared-pool throttle: wait long and retry this
          // model, and only after the plan is exhausted on a second 429 do we
          // treat it as account-wide exhaustion.
          quotaHits++;
          lastError = `http ${res.status}: ${(res.body || "").replace(/\s+/g, " ").slice(0, 140)}`;
          const quotaPause = geminiQuotaWaitMs();
          options.onRetry?.(attempt, quotaPause, `${model} quota 429 (hit ${quotaHits}); pausing`);
          await sleep(quotaPause);
          if (attempt >= maxAttempts) break;
          continue; // the pause already served as the backoff
        } else {
          lastError = `http ${res.status}: ${(res.body || "").replace(/\s+/g, " ").slice(0, 140)}`;
          if (!RETRYABLE_STATUS.has(res.status)) break;
        }

        if (attempt < maxAttempts) {
          const wait = backoffMs(attempt);
          options.onRetry?.(attempt, wait, `${model} ${lastError}`);
          await sleep(wait);
        }
      }

      // Only fall through to another model if the primary was capacity-limited.
      if (!forCapacity) {
        const wasCapacity = CAPACITY_STATUS.has(parseInt(lastError.match(/http (\d+)/)?.[1] || "0", 10));
        if (!wasCapacity) break;
      }
    }

    if (quotaHits >= maxQuotaHits) {
      // Persistent across retries and every fallback model: genuinely the
      // account quota window, not a transient pool blip.
      throw new GeminiQuotaError(429, totalAttempts);
    }

    throw new Error(`Gemini extraction failed after ${totalAttempts} attempt(s). Last error: ${lastError}`);
  }
}

export function createGeminiEngine(): VlmEngine {
  return new GeminiEngine();
}
