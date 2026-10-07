// Ad-hoc probe: sends one PDF to an OpenRouter model and prints the RAW
// response text plus the parsed result. Use this to diagnose why a field came
// back empty. Read-only with respect to the database.
//
//   npx tsx --env-file=.env.local src/lib/ocrProbe.ts "A. Gopala Krishna.pdf" qwen/qwen3-vl-32b-instruct 4

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import fs from "fs";
import path from "path";
import { buildExtractionPrompt, parseExtractionJson } from "./ocr/vlm";
import { renderPdfPagesToPng } from "./ocr/pdf";

const target = process.argv[2] || "A. Gopala Krishna.pdf";
const model = process.argv[3] || "qwen/qwen3-vl-32b-instruct";
const maxPages = parseInt(process.argv[4] || "4", 10);

async function main() {
  const found: string[] = [];
  for (const dir of ["Delhi", "Kerala"]) {
    const dirPath = path.join("Candidate Affidavits", dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const f of fs.readdirSync(dirPath).filter((f) => f.toLowerCase().endsWith(".pdf"))) {
      if (f.toLowerCase() === target.toLowerCase()) found.push(path.join(dirPath, f));
    }
  }
  if (!found.length) throw new Error(`No PDF named "${target}"`);

  console.log(`File:  ${found[0]}`);
  console.log(`Model: ${model}`);
  console.log(`Pages: ${maxPages}\n`);

  // JPEG matches the production payload: PNG blows past provider body caps at
  // 20 pages (~25MB base64 vs ~20MB limit on Google AI Studio).
  const pages = await renderPdfPagesToPng(fs.readFileSync(found[0]), { maxPages, scale: 1.5, format: "jpeg", quality: 0.8 });
  console.log(`Rendered ${pages.length} page(s); sizes: ${pages.map((b) => `${Math.round(b.length / 1024)}KB`).join(", ")}\n`);

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://github.com/chunav-bodh",
      "X-Title": "Chunav Bodh affidavit OCR probe",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildExtractionPrompt(false) },
            ...pages.map((b) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` } })),
          ],
        },
      ],
      max_tokens: 8192,
      temperature: 0,
    }),
  });

  const text = await res.text();
  console.log(`HTTP ${res.status}\n`);

  if (!res.ok) {
    console.log("--- error body ---");
    console.log(text.slice(0, 1200));
    process.exit(1);
  }

  const json = JSON.parse(text);
  console.log("usage:", JSON.stringify(json.usage ?? {}));
  console.log("finish_reason:", json.choices?.[0]?.finish_reason);
  console.log("model actually used:", json.model);

  const raw = json.choices?.[0]?.message?.content ?? "";
  console.log(`\n=== RAW CONTENT (${raw.length} chars) ===\n`);
  console.log(raw);

  console.log(`\n\n=== PARSED KEYS ===\n`);
  try {
    const data = parseExtractionJson(raw);
    for (const [k, v] of Object.entries(data)) {
      const preview = v === null ? "null" : Array.isArray(v) ? `[${v.length} items]` : String(v).slice(0, 70);
      console.log(`  ${k}: ${preview}`);
    }
  } catch (e: any) {
    console.log("PARSE FAILED:", e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
