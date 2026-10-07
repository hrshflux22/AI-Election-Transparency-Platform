export interface UnlimitedOcrImage {
  mimeType: string;
  buffer: Buffer;
}

export interface UnlimitedOcrOptions {
  prompt?: string;
  imageMode?: "gundam" | "base";
  windowSize?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export type UnlimitedOcrBackend = "sglang" | "vllm";

const SERVER_URL = process.env.UNLIMITED_OCR_URL || "http://127.0.0.1:8000";
const MODEL = process.env.UNLIMITED_OCR_MODEL || "baidu/Unlimited-OCR";
const BACKEND: UnlimitedOcrBackend =
  (process.env.UNLIMITED_OCR_BACKEND || "vllm").toLowerCase() === "sglang" ? "sglang" : "vllm";
const NGRAM_SIZE = Number(process.env.UNLIMITED_OCR_NGRAM_SIZE || 35);
const DEFAULT_PROMPT = process.env.UNLIMITED_OCR_PROMPT || "<image>document parsing.";
// SGLang only: dill-serialized DeepseekOCRNoRepeatNGramLogitProcessor string.
const SGLANG_LOGIT_PROCESSOR = process.env.UNLIMITED_OCR_SGLANG_LOGIT_PROCESSOR || "";

export function isUnlimitedOcrConfigured(): boolean {
  return Boolean(process.env.UNLIMITED_OCR_URL);
}

export function isUnlimitedOcrBackendVllm(): boolean {
  return BACKEND === "vllm";
}

function mimeFromBuffer(buffer: Buffer, fallback: string): string {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  return fallback;
}

async function readStreamText(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) return response.text();

  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const payload = JSON.parse(data);
        const delta = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content ?? "";
        if (delta) out += delta;
      } catch {
        out += data;
      }
    }
  }
  return out;
}

function buildPayload(
  images: UnlimitedOcrImage[],
  options: Required<UnlimitedOcrOptions>,
): Record<string, unknown> {
  const content: unknown[] = [
    { type: "text", text: options.prompt },
    ...images.map((img) => ({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.buffer.toString("base64")}` },
    })),
  ];

  const base: Record<string, unknown> = {
    model: MODEL,
    messages: [{ role: "user", content }],
    temperature: 0,
    max_tokens: options.maxTokens,
    skip_special_tokens: false,
  };

  if (BACKEND === "sglang") {
    base.images_config = { image_mode: options.imageMode };
    if (SGLANG_LOGIT_PROCESSOR) {
      base.custom_logit_processor = SGLANG_LOGIT_PROCESSOR;
    }
    base.custom_params = { ngram_size: NGRAM_SIZE, window_size: options.windowSize };
    base.stream = true;
  } else {
    base.vllm_xargs = { ngram_size: NGRAM_SIZE, window_size: options.windowSize };
  }
  return base;
}

export async function extractWithUnlimitedOcr(
  images: UnlimitedOcrImage[],
  options: UnlimitedOcrOptions = {},
): Promise<string> {
  if (!isUnlimitedOcrConfigured()) {
    throw new Error("UNLIMITED_OCR_URL is not configured.");
  }

  const imageMode = options.imageMode ?? (images.length > 1 ? "base" : "gundam");
  const windowSize = options.windowSize ?? (imageMode === "base" ? 1024 : 128);
  const defaults: Required<UnlimitedOcrOptions> = {
    prompt: DEFAULT_PROMPT,
    imageMode,
    windowSize,
    maxTokens: options.maxTokens ?? 32768,
    timeoutMs: options.timeoutMs ?? 600000,
  };
  defaults.prompt = options.prompt ?? (imageMode === "base" ? "<image>Multi page parsing." : DEFAULT_PROMPT);

  const payload = buildPayload(images.map((img) => ({ ...img, mimeType: img.mimeType || mimeFromBuffer(img.buffer, "image/png") })), defaults);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), defaults.timeoutMs);
  try {
    const response = await fetch(`${SERVER_URL.replace(/\/+$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 400);
      throw new Error(`Unlimited-OCR server error ${response.status}: ${detail}`);
    }
    const text = (await readStreamText(response)).trim();
    if (!text) throw new Error("Unlimited-OCR returned no text.");
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}