// Model shootout: sends one affidavit PDF to several Gemini models and reports
// which return usable Form 26 data on a free tier.
//
// Usage: npm run db:ocr:shootout -- [--file=Delhi/Adv. Krupal.pdf] [--models=a,b,c]

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import fs from "fs";
import path from "path";

const API = "https://generativelanguage.googleapis.com/v1beta/models";

const params: Record<string, string> = {};
process.argv.slice(2).forEach((arg) => {
  const m = arg.match(/^--([^=]+)=(.+)$/);
  if (m) params[m[1]] = m[2];
});

const DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-3.1-pro-preview"];
const MODELS = (params.models ? params.models.split(",") : DEFAULT_MODELS).map((m) => m.trim()).filter(Boolean);
const FILE = params.file || "Delhi/Adv. Krupal.pdf";

const EXTRACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    form26Found: { type: "BOOLEAN", description: "True if Form 26 (Statement of Individual Solvency) is present in the document." },
    form26Pages: { type: "STRING", description: "Comma-separated 1-indexed page numbers where Form 26 and its annexures appear." },
    name: { type: "STRING", description: "Candidate's full name exactly as printed." },
    fatherName: { type: "STRING" },
    age: { type: "INTEGER" },
    gender: { type: "STRING" },
    dateOfBirth: { type: "STRING" },
    occupation: { type: "STRING" },
    address: { type: "STRING" },
    citizenship: { type: "STRING" },
    constituency: { type: "STRING", description: "Assembly or parliamentary constituency the candidate is contesting." },
    state: { type: "STRING" },
    pan: { type: "STRING", description: "Permanent Account Number in ABCDE1234F form." },
    educationalQualification: { type: "STRING" },
    spouseName: { type: "STRING" },
    criminalCases: { type: "INTEGER", description: "Total number of pending criminal cases. 0 if explicitly stated as none." },
    criminalCasesDetail: { type: "ARRAY", items: { type: "STRING" }, description: "One entry per case: court, case/FIR number, sections, stage." },
    totalMovableAssets: { type: "STRING", description: "As written in the document, e.g. 'Rs. 25,00,000' or 'Rs. 25 lakh'." },
    totalImmovableAssets: { type: "STRING" },
    totalAssets: { type: "STRING", description: "Grand total of movable plus immovable assets as printed." },
    totalLiabilities: { type: "STRING" },
    assetsBreakdown: { type: "ARRAY", items: { type: "STRING" }, description: "Individual asset line items with their values." },
    liabilitiesBreakdown: { type: "ARRAY", items: { type: "STRING" }, description: "Individual liability line items with their values." },
    electoralHistory: { type: "ARRAY", items: { type: "STRING" }, description: "One entry per election: constituency, year, votes polled." },
    confidence: { type: "NUMBER", description: "0.0 to 1.0 confidence that the extracted Form 26 values are correct." },
    warnings: { type: "ARRAY", items: { type: "STRING" }, description: "Any illegible, ambiguous or missing fields, and where they appear." },
  },
  required: ["form26Found", "confidence"],
};

const PROMPT = `You are extracting structured data from a scanned candidate nomination affidavit (India, Election Commission of India format).

STRUCTURE OF THESE DOCUMENTS — READ CAREFULLY:
- Page 1 is an e-STAMP CERTIFICATE (revenue stamp / e-stamp acknowledgement). It is NOT part of the affidavit and contains NO candidate data. Ignore it entirely. It often contains the candidate's name in the "Purchased by" field, but that is a stamp vendor detail, not proof of candidacy — do not use it as the answer.
- A nomination form (Form 2A / Form 2B) follows, which may repeat name and constituency.
- The substantive data is in FORM 26 "STATEMENT OF INDIVIDUAL SOLVENCY", which contains:
  - Part A: candidate identity (name, father's/husband's name, date of birth, age, occupation, address, PAN, citizenship, constituency)
  - Part B: assets, itemised across movable and immovable property, often spread over MANY pages and continuation sheets
  - Part C: liabilities, likewise itemised
  - A section declaring the number of PENDING CRIMINAL CASES (this is legally mandated; it may be 0 and you must record 0 as 0, never as null/omitted)
  - A section listing ELECTORAL HISTORY (previous contests)

RULES:
1. Read the WHOLE document, including continuation and annexure pages. Asset and liability totals frequently appear ONLY in a later summary block while the itemised rows appear earlier.
2. Report monetary values EXACTLY as written in the document. Do NOT convert between units. Do NOT convert between Indian and international numbering systems (lakh/crore stay as lakh/crore). Do NOT reformat or round.
3. If a field is genuinely absent or illegible, use null. Never guess, never infer from the filename, and never carry a value over from the e-stamp page.
4. "criminalCases" must be an integer. If the document states "nil" or "0" or "no pending cases", report 0.
5. If Form 26 is genuinely not in the document, set form26Found to false, leave the data fields null, and explain why in warnings.

Return only the JSON object described by the schema. No prose, no markdown fences.`;

type Shot = {
  model: string;
  ok: boolean;
  error?: string;
  httpStatus?: number;
  elapsedMs?: number;
  inTokens?: number;
  outTokens?: number;
  data?: any;
};

async function callGemini(model: string, inlineData: { mimeType: string; data: string }): Promise<Shot> {
  const url = `${API}/${model}:generateContent`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: PROMPT }, { inlineData }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: EXTRACTION_SCHEMA,
    },
  };

  const attempts: Record<string, unknown>[] = [
    { ...body, generationConfig: { ...(body.generationConfig as object), thinkingConfig: { thinkingBudget: 0 } } },
    body,
  ];

  let lastErr = "";
  let lastStatus = 0;

  for (const [i, payload] of attempts.entries()) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY || "" },
        body: JSON.stringify(payload),
      });
      const raw = await res.text();
      if (!res.ok) {
        lastStatus = res.status;
        lastErr = raw.slice(0, 300);
        // Retry without thinkingConfig only if the rejection looks like an argument problem.
        if (res.status === 400 && /thinking|generationConfig|generation_config/i.test(raw) && i === 0) continue;
        break;
      }
      const json = JSON.parse(raw);
      const cand = json.candidates?.[0];
      const text = (cand?.content?.parts || []).map((p: any) => p.text || "").join("");
      if (!text.trim()) {
        return { model, ok: false, error: `empty response (finishReason=${cand?.finishReason})`, httpStatus: res.status };
      }
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (!fenced) throw new Error(`unparseable JSON: ${text.slice(0, 160)}`);
        data = JSON.parse(fenced[1]);
      }
      return {
        model,
        ok: true,
        httpStatus: res.status,
        elapsedMs: Date.now() - started,
        inTokens: json.usageMetadata?.promptTokenCount,
        outTokens: json.usageMetadata?.candidatesTokenCount,
        data,
      };
    } catch (e: any) {
      lastErr = String(e?.message || e);
      break;
    }
  }

  return { model, ok: false, error: lastErr, httpStatus: lastStatus };
}

function summarise(shot: Shot): string {
  if (!shot.ok) return `      FAILED  http=${shot.httpStatus}  ${shot.error}`;
  const d = shot.data || {};
  const filled = ["name", "age", "constituency", "criminalCases", "totalAssets", "totalLiabilities"]
    .map((k) => {
      const v = d[k];
      return `${k}=${v === null || v === undefined ? "MISSING" : JSON.stringify(v)}`;
    })
    .join("  ");
  return [
    `      ${filled}`,
    `      confidence=${d.confidence}  form26Found=${d.form26Found}  pages=${d.form26Pages || "?"}`,
    `      tokens in=${shot.inTokens} out=${shot.outTokens}  ${(shot.elapsedMs! / 1000).toFixed(1)}s`,
  ].join("\n");
}

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env.local.");

  const fullPath = path.join("Candidate Affidavits", FILE);
  if (!fs.existsSync(fullPath)) throw new Error(`Not found: ${fullPath}`);
  const buf = fs.readFileSync(fullPath);
  const sizeMb = (buf.length / 1024 / 1024).toFixed(2);
  console.log(`File: ${FILE}  (${sizeMb} MB)`);
  console.log(`Inline base64 payload: ${(buf.length * 4 / 3 / 1024 / 1024).toFixed(2)} MB  (limit 50 MB for PDFs)\n`);

  const inlineData = { mimeType: "application/pdf", data: buf.toString("base64") };

  const results: Shot[] = [];
  for (const model of MODELS) {
    process.stdout.write(`  ${model} ... `);
    const shot = await callGemini(model, inlineData);
    results.push(shot);
    console.log(shot.ok ? `ok in ${(shot.elapsedMs! / 1000).toFixed(1)}s` : `FAILED`);
    console.log(summarise(shot));
    console.log("");
  }

  console.log("===== SUMMARY =====");
  for (const shot of results) {
    const status = shot.ok
      ? `OK   ${(shot.elapsedMs! / 1000).toFixed(1)}s  in=${shot.inTokens} out=${shot.outTokens}`
      : `FAIL http=${shot.httpStatus} ${(shot.error || "").slice(0, 120)}`;
    console.log(`  ${shot.model.padEnd(28)} ${status}`);
  }

  const winner = results.find((s) => s.ok && s.data?.form26Found && s.data?.name);
  console.log(`\nUsable on free tier: ${winner ? winner.model : "NONE"}`);
  if (winner) {
    console.log("\nFull JSON from winner:");
    console.log(JSON.stringify(winner.data, null, 2));
  }
}

main().catch((e) => {
  console.error("Shootout error:", e?.message || e);
  process.exit(1);
});