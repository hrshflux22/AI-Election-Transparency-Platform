// Shared vision-LLM extraction layer: the engine interface every provider
// implements, the Form 26 extraction prompt/schema, and tolerant JSON
// parsing plus multi-chunk merging.

export interface ExtractionResult {
  engine: string;
  model: string;
  data: Record<string, unknown>;
  text: string;
  elapsedMs: number;
  inTokens?: number;
  outTokens?: number;
  pagesRead?: string;
}

export interface ExtractOptions {
  includePan?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Cap on rendered pages for engines that cannot accept PDF bytes directly. */
  maxPages?: number;
  /** Render scale for those page-to-image engines. */
  scale?: number;
  /** Cap on API requests one extract/extractBatch call may spend (splits and retries count). */
  requestBudget?: number;
  /** Page image encoding. JPEG keeps a 20-page affidavit under provider body caps (20MB); PNG default in the renderer. */
  imageFormat?: "png" | "jpeg";
  /** JPEG quality when imageFormat is jpeg (default 0.8). */
  imageQuality?: number;
  onRetry?: (attempt: number, waitMs: number, reason: string) => void;
}

export interface VlmEngine {
  readonly name: string;
  readonly model: string;
  extract(pdf: Buffer, options?: ExtractOptions): Promise<ExtractionResult>;
}

export const KEY_FIELDS = [
  "name",
  "age",
  "gender",
  "fatherName",
  "occupation",
  "constituency",
  "state",
  "citizenship",
  "educationalQualification",
  "criminalCases",
  "totalAssets",
  "totalLiabilities",
] as const;

export type KeyField = (typeof KEY_FIELDS)[number];

export function buildExtractionSchema(includePan: boolean): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    form26Found: {
      type: "BOOLEAN",
      description: "True if Form 26 (Statement of Individual Solvency) is present in the document.",
    },
    form26Pages: {
      type: "STRING",
      description: "Comma-separated 1-indexed page numbers where Form 26 and its annexures appear.",
    },
    name: { type: "STRING", description: "Candidate's full name exactly as printed." },
    fatherName: { type: "STRING" },
    age: { type: "INTEGER" },
    gender: { type: "STRING" },
    dateOfBirth: { type: "STRING" },
    occupation: { type: "STRING" },
    address: { type: "STRING" },
    citizenship: { type: "STRING" },
    constituency: {
      type: "STRING",
      description: "Assembly or parliamentary constituency the candidate is contesting.",
    },
    state: { type: "STRING" },
    educationalQualification: { type: "STRING" },
    spouseName: { type: "STRING" },
    criminalCases: {
      type: "INTEGER",
      description: "Total number of pending criminal cases. 0 if explicitly stated as none.",
    },
    criminalCasesDetail: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "One entry per case: court, case/FIR number, sections, stage.",
    },
    totalMovableAssets: {
      type: "STRING",
      description: "As written in the document, e.g. 'Rs. 25,00,000' or 'Rs. 25 lakh'.",
    },
    totalImmovableAssets: { type: "STRING" },
    totalAssets: { type: "STRING", description: "Grand total of movable plus immovable assets as printed." },
    totalLiabilities: { type: "STRING" },
    assetsBreakdown: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Individual asset line items with their values.",
    },
    liabilitiesBreakdown: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Individual liability line items with their values.",
    },
    electoralHistory: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "One entry per election: constituency, year, votes polled.",
    },
    confidence: {
      type: "NUMBER",
      description: "0.0 to 1.0 confidence that the extracted Form 26 values are correct.",
    },
    warnings: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Any illegible, ambiguous or missing fields, and where they appear.",
    },
  };

  if (includePan) {
    properties.pan = { type: "STRING", description: "Permanent Account Number in ABCDE1234F form." };
  }

  return {
    type: "OBJECT",
    properties,
    required: ["form26Found", "confidence"],
  };
}

function coreExtractionRules(includePan: boolean): string {
  const panRule = includePan
    ? "6. Report the PAN exactly in ABCDE1234F form if it is legible."
    : "6. Do NOT transcribe the PAN field. Leave it out entirely.";

  return `You are extracting structured data from a scanned candidate nomination affidavit (India, Election Commission of India format).

STRUCTURE OF THESE DOCUMENTS — READ CAREFULLY:
- Page 1 is an e-STAMP CERTIFICATE (revenue stamp / e-stamp acknowledgement). It is NOT part of the affidavit and contains NO candidate data. Ignore it entirely. It often contains a name in the "Purchased by" field, but that is a stamp vendor detail, not proof of candidacy — do not use it as the answer.
- A nomination form (Form 2A / Form 2B) follows, which may repeat name and constituency.
- The substantive data is in FORM 26 "STATEMENT OF INDIVIDUAL SOLVENCY", which contains:
  - Part A: candidate identity (name, father's/husband's name, date of birth, age, occupation, address, PAN, citizenship, constituency)
  - Part B: assets, itemised across movable and immovable property, often spread over MANY pages and continuation sheets
  - Part C: liabilities, likewise itemised
  - A section declaring the number of PENDING CRIMINAL CASES (legally mandated; it may be 0 and you must record 0 as 0, never as null/omitted)
  - A section listing ELECTORAL HISTORY (previous contests)

RULES:
1. Read the WHOLE document, including continuation and annexure pages. Asset and liability totals frequently appear ONLY in a later summary block while the itemised rows appear earlier.
2. Report monetary values EXACTLY as written. Do NOT convert between units. Do NOT convert between Indian and international numbering systems (lakh/crore stay as lakh/crore). Do NOT reformat or round.
3. If a field is genuinely absent or illegible, use null. Never guess, never infer from the filename, and never carry a value over from the e-stamp page.
4. "criminalCases" must be an integer. If the document states "nil" or "0" or "no pending cases", report 0.
${panRule}
7. If Form 26 is genuinely not in the document, set form26Found to false, leave the data fields null, and explain why in warnings.`;
}

export function buildExtractionPrompt(includePan: boolean): string {
  return `${coreExtractionRules(includePan)}

Return only the JSON object described by the schema. No prose, no markdown fences.`;
}

/**
 * Prompt for one request carrying SEVERAL documents at once. The bulk
 * pipeline batches to fit the free tier's daily request cap, so the response
 * contract is the only thing that changes: one JSON object keyed by
 * filename, with each document's own extraction under its key.
 */
export function buildBatchExtractionPrompt(includePan: boolean): string {
  return `${coreExtractionRules(includePan)}

BATCH MODE — this request contains MULTIPLE documents:
- Each document starts with a line of the form: === DOCUMENT n: <filename> ===
  Everything after that line, up to the next marker, belongs to <filename>.
- Return ONE JSON object whose keys are EXACTLY the filenames given by those markers, and whose value for each key is that document's own extraction object (the schema described above).
- Never mix data between documents: values from one affidavit may only appear under that affidavit's filename key.
- Never invent or omit keys: there must be exactly one key per marker line, in the same order.
- If one document is unreadable, still include its key with {"form26Found": false, "confidence": 0, "warnings": ["<why>"]}.
- Filenames are case-sensitive and must be copied verbatim, including the .pdf extension.

Return only that single JSON object keyed by filename. No prose, no markdown fences.`;
}

/**
 * Repairs the JSON defects small models commonly emit: unescaped newlines,
 * stray or doubled commas, a closer that does not match the innermost
 * container, and containers left open by an output that hit the token cap.
 * Deliberately conservative - it only rewrites the specific patterns that
 * throw, and gives up rather than guessing at structure it cannot infer.
 */
function repairJson(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  const lastNonWs = (): string => {
    for (let i = out.length - 1; i >= 0; i--) {
      const ch = out[i];
      if (ch !== " " && ch !== "\n" && ch !== "\t" && ch !== "\r") return ch;
    }
    return "";
  };

  // Removes a separator that would otherwise sit directly before a closer, and
  // supplies the value for a key whose value never arrived: `{"a":` -> `{"a":null}`.
  const dropDangling = (): void => {
    for (;;) {
      out = out.replace(/\s+$/, "");
      if (out.endsWith(",")) {
        out = out.slice(0, -1);
        continue;
      }
      if (out.endsWith(":")) out += "null";
      return;
    }
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }

    if (inString) {
      // Literal control characters are illegal inside JSON strings.
      if (ch === "\n") out += "\\n";
      else if (ch === "\t") out += "\\t";
      else if (ch === "\r") out += "\\r";
      else out += ch;
      continue;
    }

    if (ch === ",") {
      const last = lastNonWs();
      // `[,,`, `[{,` and `{"a":1,,` carry no value of their own; a comma that
      // follows a key with no value supplies that value instead: `{"a":,1}`.
      if (last === "" || last === "[" || last === "{" || last === ",") continue;
      out += last === ":" ? "null," : ch;
      continue;
    }

    if (ch === ":") {
      const last = lastNonWs();
      if (last === "" || last === "[" || last === "{" || last === "," || last === ":") continue;
      out += ch;
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push(ch);
      out += ch;
      continue;
    }

    if (ch === "}" || ch === "]") {
      const want = ch === "}" ? "{" : "[";
      // A closer that does not match the innermost container closes the ones
      // inside it first. This is what an unterminated array followed by more
      // object members always means: `{"a":{"b":[1,2,},"c":"d"}`.
      while (stack.length && stack[stack.length - 1] !== want) {
        const inner = stack.pop()!;
        dropDangling();
        out += inner === "{" ? "}" : "]";
      }
      if (!stack.length) continue; // stray closer with nothing open
      dropDangling();
      stack.pop();
      out += ch;
      continue;
    }

    out += ch;
  }

  // An output cut off mid-string cannot be finished by closing containers
  // alone, so terminate the string first and let the closers below do the rest.
  if (inString) {
    if (escaped) out = out.slice(0, -1);
    out += '"';
  }

  while (stack.length) {
    dropDangling();
    const inner = stack.pop()!;
    out += inner === "{" ? "}" : "]";
  }

  return out;
}

function tryParse(candidate: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(candidate);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function parseExtractionJson(raw: string): Record<string, unknown> {
  const text = raw.trim();

  const direct = tryParse(text);
  if (direct) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const fromFence = tryParse(fenced[1]);
    if (fromFence) return fromFence;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const slice = text.slice(start, end + 1);
    const fromSlice = tryParse(slice);
    if (fromSlice) return fromSlice;
    const repaired = tryParse(repairJson(slice));
    if (repaired) return repaired;
  }

  // Last resort: repair the whole response, then extract the outermost object.
  const repairedWhole = repairJson(text);
  const rs = repairedWhole.indexOf("{");
  const re = repairedWhole.lastIndexOf("}");
  if (rs !== -1 && re > rs) {
    const repaired = tryParse(repairedWhole.slice(rs, re + 1));
    if (repaired) return repaired;
  }

  throw new Error(`Could not parse extraction JSON from: ${text.slice(0, 160)}`);
}

// ---------- Batch response parsing ----------

export interface BatchExtraction {
  /** Parsed extraction per document id (filename), only for docs the model answered. */
  byId: Map<string, Record<string, unknown>>;
  /** Document ids the response did not contain a usable object for. */
  missing: string[];
}

/** Case/space/extension-insensitive key so "A. Gopala Krishna.pdf" == "a.gopala krishna". */
function normaliseDocKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/={2,}/g, " ") // "=== DOCUMENT 1: x ===" marker decoration
    .replace(/^\s*document\s*\d+\s*[:\-]?\s*/, "")
    .replace(/^\s*\d+\s*[.)\-:]\s*/, "") // list numbering the model added
    .replace(/\.pdf\s*$/i, "")
    .replace(/[^a-z0-9]/g, "");
}

function docKeyCandidates(value: string): string[] {
  const norm = normaliseDocKey(value);
  const out = [norm];
  // Models sometimes append an index ("1 - file.pdf") or drop text from the
  // middle; a long prefix still identifies the file without guessing.
  if (norm.length > 16) out.push(norm.slice(0, 16));
  return out;
}

const DOC_ID_KEYS = ["filename", "file", "document", "doc", "id", "file_name", "pdf"];

/**
 * Reads a batched response — one JSON object keyed by filename — back into
 * per-document extractions. Tolerant of the shapes models actually emit:
 * a keyed object, a wrapper object ({results: {...}} or {documents: [...]}),
 * or an array of objects each carrying a filename field. Keys are matched
 * loosely because models re-capitalise or re-space filenames constantly.
 */
export function parseBatchExtractionJson(raw: string, docIds: string[]): BatchExtraction {
  const byId = new Map<string, Record<string, unknown>>();
  const missing: string[] = [];

  const assign = (key: string, value: unknown): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const candidates = docKeyCandidates(key);
    for (const id of docIds) {
      if (byId.has(id)) continue;
      const idCandidates = docKeyCandidates(id);
      if (candidates.some((c) => idCandidates.includes(c))) {
        byId.set(id, value as Record<string, unknown>);
        return;
      }
    }
  };

  // A model that answers with a bare array ([{filename, ...}]) is read here
  // first; parseExtractionJson only accepts objects, so fall back to it for
  // fenced/repaired object responses.
  let root: Record<string, unknown> = {};
  let rootArray: unknown[] | null = null;

  const readContainer = (text: string): boolean => {
    try {
      const value = JSON.parse(text);
      if (Array.isArray(value)) rootArray = value;
      else if (value && typeof value === "object") root = value as Record<string, unknown>;
      else return false;
      return true;
    } catch {
      return false;
    }
  };

  if (!readContainer(raw)) {
    const fenced = raw.trim().match(/```(?:json)?\s*([\s\S]*?)```/);
    let ok = fenced ? readContainer(fenced[1]) : false;
    if (!ok) {
      try {
        // Object recovery first (prose-wrapped, truncated or unrepaired).
        root = parseExtractionJson(raw);
      } catch {
        // Then an array buried in prose: bracket-slice it out.
        const arrStart = raw.indexOf("[");
        const arrEnd = raw.lastIndexOf("]");
        ok = arrStart !== -1 && arrEnd > arrStart && readContainer(raw.slice(arrStart, arrEnd + 1));
        if (!ok) throw new Error(`Could not parse batch response JSON from: ${raw.slice(0, 160)}`);
      }
    }
  }

  const arrayItems = (items: unknown[]): void => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const idKey = DOC_ID_KEYS.find((k) => typeof rec[k] === "string");
      if (idKey) assign(String(rec[idKey]), rec);
    }
  };

  if (rootArray) arrayItems(rootArray);

  if (docIds.length === 1 && !rootArray) {
    // A single-document request may come back as the bare extraction object
    // (no filename key at all); treat it as that document's answer.
    const rootNamesTheDoc = Object.keys(root).some((k) => docIds.some((id) => docKeyCandidates(id).includes(normaliseDocKey(k))));
    if (!rootNamesTheDoc) {
      byId.set(docIds[0], root);
      return { byId, missing };
    }
  }

  // Unwrap a container the model put around the filename-keyed map.
  for (const wrapKey of ["results", "documents", "document", "files", "extractions"]) {
    const wrapped = root[wrapKey];
    if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
      for (const [k, v] of Object.entries(wrapped as Record<string, unknown>)) assign(k, v);
      if (byId.size) break;
    }
    if (Array.isArray(wrapped)) {
      arrayItems(wrapped);
      if (byId.size) break;
    }
  }

  // The common case: keys of the root object are the filenames.
  for (const [k, v] of Object.entries(root)) {
    if (byId.size >= docIds.length) break;
    assign(k, v);
  }

  for (const id of docIds) if (!byId.has(id)) missing.push(id);
  return { byId, missing };
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

export function mergeExtractions(parts: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    for (const [key, value] of Object.entries(part)) {
      if (Array.isArray(value)) {
        const existing = Array.isArray(merged[key]) ? (merged[key] as unknown[]) : [];
        const seen = new Set(existing.map((v) => JSON.stringify(v)));
        for (const item of value) {
          const sig = JSON.stringify(item);
          if (!seen.has(sig)) {
            seen.add(sig);
            existing.push(item);
          }
        }
        merged[key] = existing;
      } else if (!isBlank(value) && isBlank(merged[key])) {
        merged[key] = value;
      }
    }
  }

  return merged;
}

export function summariseCoverage(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of KEY_FIELDS) {
    const value = data[field];
    out[field] = isBlank(value) ? "MISSING" : String(value);
  }
  return out;
}

export function countFilledKeyFields(data: Record<string, unknown>): number {
  return KEY_FIELDS.filter((f) => !isBlank(data[f])).length;
}

/**
 * Free-tier models drift from the schema's key names. These aliases map what
 * they actually emit back onto the canonical keys so coverage, comparison and
 * the UI all see one consistent shape.
 */
const EXTRACTION_KEY_ALIASES: Record<string, readonly string[]> = {
  name: ["candidateName", "candidate_name", "fullName"],
  fatherName: ["fatherHusbandName", "fatherOrHusbandName", "fatherHusbandsName", "father_husband_name"],
  educationalQualification: ["education", "educationalQualifications", "qualification"],
  totalLiabilities: ["liabilitiesTotal", "totalLiability", "totalLiabilitiesAmount"],
  electoralHistory: ["electionHistory", "electionsContested"],
  party: ["politicalParty", "partyName"],
  address: ["candidateAddress", "permanentAddress"],
  dateOfBirth: ["dob", "dateOfBirthAsOn"],
  constituency: ["constituencyName", "assemblyConstituency"],
};

/** Schema fields declared as STRING/INTEGER/NUMBER: anything object-shaped here is a defect. */
const SCALAR_EXTRACTION_FIELDS = [
  "name",
  "fatherName",
  "age",
  "gender",
  "dateOfBirth",
  "occupation",
  "address",
  "citizenship",
  "constituency",
  "state",
  "educationalQualification",
  "spouseName",
  "criminalCases",
  "totalMovableAssets",
  "totalImmovableAssets",
  "totalAssets",
  "totalLiabilities",
  "confidence",
  "pan",
  "form26Found",
  "form26Pages",
  "party",
] as const;

/**
 * Renders a scalar extraction field as a string without ever producing
 * "[object Object]": arrays join with "; ", objects fall back to JSON.
 */
function scalarString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => scalarString(v)).filter((v): v is string => v !== undefined);
    return parts.length ? parts.join("; ") : undefined;
  }
  return JSON.stringify(value);
}

/** Keys (normalised: lowercase, alphanumeric only) that hold a document-printed grand total. */
const MONEY_TOTAL_KEYS = new Set(["grosstotalvalue", "grandtotalliabilities", "grandtotalvalue", "grandtotal"]);

/** Parses a rupee leaf as written ("rs 50,000/-", "277000/-", 0); null when not a plain amount. */
function parseRupeeLeaf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return 0;
  if (/^(nil|n\/?a|not applicable|none|null|-|0+)$/i.test(s)) return 0;
  const m = s.match(/^(?:rs\.?\s*)?([\d,]+(?:\.\d+)?)\s*(?:\/-)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Asset/liability totals arrive either as a printed grand total or as a
 * itemised object. When the object nests a grosstotalvalue block whose leaves
 * are all plain amounts, sum them into one printed-style total; anything less
 * certain falls back to JSON so no value is ever invented or "[object Object]".
 */
function flattenStructuredTotal(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return scalarString(value);

  const obj = value as Record<string, unknown>;
  for (const own of ["totalAssets", "totalLiabilities"]) {
    const direct = parseRupeeLeaf(obj[own]);
    if (direct !== null && obj[own] !== null && obj[own] !== undefined && obj[own] !== "") {
      return `Rs. ${Number.isInteger(direct) ? direct : direct.toFixed(2)}`;
    }
  }

  const totals: number[] = [];
  let sawTotalKey = false;
  let clean = true;

  // Collects every plain amount under a money-total node; marks the row dirty
  // when a leaf cannot be read as an amount (then the whole JSON is kept).
  const collectLeaves = (node: unknown): void => {
    if (!clean) return;
    if (node === null || node === undefined) return;
    if (typeof node === "object" && !Array.isArray(node)) {
      for (const v of Object.values(node as Record<string, unknown>)) collectLeaves(v);
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) collectLeaves(v);
      return;
    }
    const n = parseRupeeLeaf(node);
    if (n === null) clean = false;
    else totals.push(n);
  };

  const walk = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.every(walk);
    if (node === null || typeof node !== "object") return true;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (MONEY_TOTAL_KEYS.has(normalizeKey(k))) {
        sawTotalKey = true;
        collectLeaves(v);
      } else if (v !== null && typeof v === "object" && !walk(v)) {
        return false;
      }
    }
    return true;
  };

  if (!walk(obj) || !clean || !sawTotalKey || !totals.length) return JSON.stringify(value);
  const sum = totals.reduce((a, b) => a + b, 0);
  return `Rs. ${Number.isInteger(sum) ? sum : sum.toFixed(2)}`;
}

/**
 * Normalises a raw engine extraction: resolves key aliases onto the canonical
 * schema keys and flattens object-shaped scalar fields. Idempotent, so it is
 * safe to run on freshly parsed output and on already-stored rows alike.
 */
export function normalizeExtraction(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };

  for (const [canonical, aliases] of Object.entries(EXTRACTION_KEY_ALIASES)) {
    if (!isBlank(out[canonical])) continue;
    for (const alias of aliases) {
      if (!isBlank(out[alias])) {
        out[canonical] = out[alias];
        break;
      }
    }
  }

  for (const field of SCALAR_EXTRACTION_FIELDS) {
    const value = out[field];
    if (value === null || value === undefined) continue;
    if (field === "totalAssets" || field === "totalLiabilities") {
      let candidate = value;
      // Rows written before flattenStructuredTotal existed hold raw JSON text;
      // re-parse it so the sum pass reaches them too.
      if (typeof candidate === "string" && /^[[{]/.test(candidate.trim())) {
        try {
          candidate = JSON.parse(candidate.trim());
        } catch {
          /* keep the string */
        }
      }
      if (typeof candidate === "object") out[field] = flattenStructuredTotal(candidate);
    } else if (typeof value === "object") {
      out[field] = scalarString(value);
    }
  }

  return out;
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Flattens a structured extraction into `key: value` lines. This text is what
 * gets stored in extracted_text and what the regex parser sees, so the bulk
 * pipeline and the upload endpoint must render identically.
 */
export function renderExtractedText(data: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("_")) continue;
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${renderValue(item)}`);
    } else {
      lines.push(`${key}: ${renderValue(value)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Keeps the legacy ParsedAffidavit keys in sync alongside the richer extraction
 * so any consumer expecting the old shape keeps working.
 */
export function buildParsedData(data: Record<string, unknown>, meta: Record<string, unknown>): Record<string, unknown> {
  const norm = normalizeExtraction(data);
  const derived = {
    education: scalarString(norm.educationalQualification),
    assets: scalarString(norm.totalAssets),
    liabilities: scalarString(norm.totalLiabilities),
  };
  return { ...norm, ...derived, ...meta };
}

/** OpenRouter serves the same model at $0 while it is on the free tier. */
export function isFreeModel(model: string): boolean {
  return model.endsWith(":free");
}

const MODEL_PRICING_PER_MTOK: Record<string, [number, number]> = {
  "qwen/qwen3-vl-32b-instruct": [0.104, 0.416],
  "qwen/qwen3-vl-8b-instruct": [0.117, 0.455],
  "qwen/qwen3-vl-30b-a3b-instruct": [0.15, 0.6],
  "qwen/qwen3-vl-235b-a22b-instruct": [0.21, 1.9],
  "qwen/qwen3.8-flash": [0.15, 0.47],
  "qwen/qwen3.8-27b": [0.425, 2.55],
  "qwen/qwen2.5-vl-72b-instruct": [0.8, 1.0],
};

/** Local spend estimate; null when the model is free or tokens were not reported. */
export function estimateCostUsd(model: string, inTokens?: number, outTokens?: number): number | null {
  if (isFreeModel(model) || !inTokens) return null;
  const price = MODEL_PRICING_PER_MTOK[model];
  if (!price) return null;
  return (price[0] * (inTokens || 0) + price[1] * (outTokens || 0)) / 1_000_000;
}
