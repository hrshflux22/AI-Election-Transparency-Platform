// PII scrubbing for affidavit extraction output.
//
// NOTE ON SCOPE: this prevents sensitive identifiers from being *persisted* or
// *re-transmitted*. It does not remove them from the uploaded image or PDF —
// Google still sees whatever is printed on the scan. Closing that gap would
// require locating each field on the page (an OCR pass over every page) before
// upload, which costs hours of compute for a small additional reduction in
// exposure.

export const REDACTED = "[REDACTED]";

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "pan", re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  { name: "aadhaar", re: /\b[2-9][0-9]{3}\s?[0-9]{4}\s?[0-9]{4}\b/g },
  { name: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
];

export function scrubPii(text: string, kinds: string[] = ["pan"]): string {
  if (!text) return text;
  let out = text;
  for (const { name, re } of PATTERNS) {
    if (!kinds.includes(name)) continue;
    out = out.replace(re, REDACTED);
  }
  return out;
}

export type RedactOptions = {
  dropPanField?: boolean;
  scrubKinds?: string[];
};

/**
 * Removes PII from a parsed extraction object. `dropPanField` deletes the pan
 * key outright; scrubbing then runs over every remaining string value so a PAN
 * echoed inside free text is still caught.
 */
export function redactExtraction<T extends Record<string, unknown>>(data: T, options: RedactOptions = {}): T {
  const { dropPanField = true, scrubKinds = ["pan"] } = options;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data ?? {})) {
    if (dropPanField && key.toLowerCase() === "pan") continue;
    out[key] = scrubValue(value, scrubKinds);
  }
  return out as T;
}

function scrubValue(value: unknown, kinds: string[]): unknown {
  if (typeof value === "string") return scrubPii(value, kinds);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, kinds));
  if (value && typeof value === "object") {
    const nested: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) nested[k] = scrubValue(v, kinds);
    return nested;
  }
  return value;
}

export function countRedactions(before: string, after: string): number {
  const original = scrubPii(before, ["pan", "aadhaar", "email"]);
  const originalCount = (before.match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g) || []).length;
  const leftover = (original.match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g) || []).length;
  return originalCount - leftover;
}