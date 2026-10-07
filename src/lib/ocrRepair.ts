// One-off repair pass over stored affidavit_scans rows: applies the same
// key-alias + scalar-flattening normalisation that buildParsedData now runs,
// so legacy rows agree with newly ingested ones. Idempotent; dry-run by
// default, pass --apply to write.
//
// Usage:
//   npm run db:ocr:repair
//   npm run db:ocr:repair -- --apply

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createRequire } from "module";
import { eq } from "drizzle-orm";
import { affidavitScans } from "./schema";
import { buildParsedData, countFilledKeyFields, renderExtractedText } from "./ocr/vlm";

const require = createRequire(import.meta.url);
const { neon } = require("@neondatabase/serverless");
const { drizzle } = require("drizzle-orm/neon-http");

const APPLY = process.argv.includes("--apply");

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diff: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) diff.push(k);
  }
  return diff;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const db = drizzle(neon(connectionString));

  const rows = await db.select().from(affidavitScans);
  console.log(`${rows.length} scan rows loaded (${APPLY ? "APPLY" : "dry-run — pass --apply to write"}).`);

  let touched = 0;
  let stateFilled = 0;
  let textRefreshed = 0;
  const keyHits = new Map<string, number>();

  for (const row of rows) {
    const data = row.parsedData as Record<string, unknown> | null;
    if (!data || typeof data !== "object") continue;

    const meta: Record<string, unknown> = {};
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith("_")) meta[k] = v;
      else body[k] = v;
    }

    // The scan folder is the state of record when the model left state blank.
    if (isBlank(body.state) && typeof meta._state === "string" && meta._state) {
      body.state = meta._state;
      stateFilled++;
    }

    const next = buildParsedData(body, meta);
    const diff = changedKeys(data, next);
    if (!diff.length) continue;

    touched++;
    for (const k of diff) keyHits.set(k, (keyHits.get(k) || 0) + 1);

    const nextText = renderExtractedText(next);
    const textChanged = nextText !== row.extractedText;
    if (textChanged) textRefreshed++;

    console.log(
      `  ${row.filename} [${String(meta._source || "?")}] keys: ${diff.join(", ")}` +
        `${isBlank(data.state) && !isBlank(next.state) ? ` → state="${next.state}"` : ""}` +
        ` (${countFilledKeyFields(data)} → ${countFilledKeyFields(next)}/12 key fields)`,
    );

    if (APPLY) {
      const patch: Record<string, unknown> = { parsedData: next };
      if (textChanged) patch.extractedText = nextText;
      await db.update(affidavitScans).set(patch).where(eq(affidavitScans.id, row.id));
    }
  }

  console.log(`\nRows changed: ${touched} of ${rows.length}`);
  if (keyHits.size) {
    console.log("Changed keys:");
    for (const [k, n] of [...keyHits].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${n}`);
  }
  console.log(`state backfilled from folder: ${stateFilled}`);
  console.log(`extracted_text refreshed: ${textRefreshed}`);
  if (!APPLY) console.log("\nDry run only. Re-run with --apply to write these changes.");
}

main().catch((e) => {
  console.error("Repair error:", e);
  process.exit(1);
});
