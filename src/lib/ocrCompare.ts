// Cross-engine comparison + coverage report for stored affidavit scans.
//
// Since the pipeline appends a new row per rescan (reads order by createdAt
// DESC), the same filename can hold rows from different engines. This tool
// lines those up field by field to show where engines agree, where they differ,
// and which rows need human review.
//
// Usage:
//   npm run db:ocr:compare
//   npm run db:ocr:compare -- --file="Adv. Krupal.pdf"
//   npm run db:ocr:compare -- --max-disagreements=50

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createRequire } from "module";
import { KEY_FIELDS } from "./ocr/vlm";
import { affidavitScans, candidates } from "./schema";

const require = createRequire(import.meta.url);
const { neon } = require("@neondatabase/serverless");
const { drizzle } = require("drizzle-orm/neon-http");

const params: Record<string, string> = {};
process.argv.slice(2).forEach((arg) => {
  const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) params[m[1]] = m[2] ?? "true";
});

const ONLY_FILE = params.file || null;
const MAX_OUT = parseInt(params["max-disagreements"] || "30", 10);

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Loose normalisation so "KRUPAL" vs "Krupal" vs "Krupal Yadav" isn't flagged as a mismatch. */
function normalise(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).toLowerCase().replace(/\s+/g, " ").replace(/[.,]/g, "").trim();
}

const MONEY_FIELDS = new Set(["totalAssets", "totalLiabilities", "totalMovableAssets", "totalImmovableAssets"]);

/** Monetary values are compared as pure digits so "Rs. 5,43,000/-" == "543000". */
function normaliseField(field: string, v: unknown): string {
  const base = normalise(v);
  if (!MONEY_FIELDS.has(field)) return base;
  const digits = base.replace(/\D/g, "");
  return digits || base;
}

function sourceOf(row: any): string {
  return row.parsedData?._source || "unknown";
}

function modelOf(row: any): string {
  return row.parsedData?._model || sourceOf(row);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const db = drizzle(neon(connectionString));

  const rows: any[] = await db.select().from(affidavitScans);
  const names: any[] = await db.select({ id: candidates.id, name: candidates.name }).from(candidates);
  const nameOf = new Map(names.map((c: any) => [c.id, c.name]));

  console.log(`Loaded ${rows.length} scan rows across ${new Set(rows.map((r) => r.filename)).size} filenames.`);

  // ---- Coverage per source ----
  const bySource = new Map<string, { rows: number; coverage: Record<string, number>; files: Set<string> }>();
  for (const row of rows) {
    const s = sourceOf(row);
    if (!bySource.has(s)) bySource.set(s, { rows: 0, coverage: {}, files: new Set() });
    const bucket = bySource.get(s)!;
    bucket.rows++;
    bucket.files.add(row.filename);
    for (const f of KEY_FIELDS) {
      if (!isBlank(row.parsedData?.[f])) bucket.coverage[f] = (bucket.coverage[f] || 0) + 1;
    }
  }

  console.log("\n===== COVERAGE BY SOURCE =====");
  const header = ["source".padEnd(11), "files".padStart(6), "avg keys".padStart(10), "avg/12".padStart(8)];
  console.log(header.join(""));
  const totals = bySource.values().map((b) => b.files.size);
  const maxFiles = Math.max(1, ...totals);
  for (const [s, b] of [...bySource].sort((a, b) => b[1].files.size - a[1].files.size)) {
    const avg = KEY_FIELDS.reduce((sum, f) => sum + (b.coverage[f] || 0), 0) / Math.max(1, b.files.size);
    const bar = "#".repeat(Math.round((b.files.size / maxFiles) * 20));
    console.log(
      `${s.padEnd(11)} ${String(b.files.size).padStart(6)} ${avg.toFixed(1).padStart(10)} ${bar.padEnd(8)}`,
    );
  }

  // ---- Per-field fill rate ----
  console.log("\n===== KEY FIELD FILL RATE BY SOURCE =====");
  console.log(["field".padEnd(25), ...[...bySource.keys()].map((s) => s.padEnd(12))].join(""));
  for (const f of KEY_FIELDS) {
    const cells = [...bySource.entries()].map(([s, b]) => {
      const rate = Math.round(((b.coverage[f] || 0) / Math.max(1, b.rows)) * 100);
      return `${rate}%`.padEnd(12);
    });
    console.log([f.padEnd(25), ...cells].join(""));
  }

  // ---- Field-level agreement between engines on the same file ----
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    if (!groups.has(row.filename)) groups.set(row.filename, []);
    groups.get(row.filename)!.push(row);
  }

  const agreements = new Map<string, { agree: number; total: number; mismatch: string[] }>();
  const disagreementRows: { file: string; field: string; values: Record<string, string> }[] = [];

  for (const [file, group] of groups) {
    if (group.length < 2) continue;
    const distinctSources = new Set(group.map(sourceOf));
    if (distinctSources.size < 2) continue;

    const newest = [...group].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    for (const field of KEY_FIELDS) {
      const present = newest.filter((r) => !isBlank(r.parsedData?.[field]));
      if (present.length < 2) continue;

      const values: Record<string, string> = {};
      for (const r of present) values[`${sourceOf(r)}@${modelOf(r)}`] = normaliseField(field, r.parsedData[field]);

      const distinct = new Set(Object.values(values));
      if (!agreements.has(field)) agreements.set(field, { agree: 0, total: 0, mismatch: [] });
      const a = agreements.get(field)!;
      a.total++;
      if (distinct.size === 1) {
        a.agree++;
      } else {
        a.mismatch.push(file);
        disagreementRows.push({ file, field, values });
      }
    }
  }

  console.log("\n===== CROSS-ENGINE AGREEMENT (files scanned by 2+ sources) =====");
  if (!agreements.size) {
    console.log("No filenames have been processed by more than one source yet.");
    console.log("Run: npm run db:ocr -- --engine=gemini --force --redact-pan");
  } else {
    console.log(["field".padEnd(24), "agree".padStart(10), "rate".padStart(8)].join(""));
    for (const [field, a] of [...agreements].sort((x, y) => x[1].agree / x[1].total - y[1].agree / y[1].total)) {
      const rate = Math.round((a.agree / a.total) * 100);
      console.log(`${field.padEnd(24)} ${`${a.agree}/${a.total}`.padStart(10)} ${`${rate}%`.padStart(8)}`);
    }
  }

  // ---- Specific file detail ----
  if (ONLY_FILE) {
    const group = groups.get(ONLY_FILE);
    console.log(`\n===== DETAIL: ${ONLY_FILE} =====`);
    if (!group?.length) {
      console.log("No stored scans for that filename.");
      return;
    }
    for (const row of [...group].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())) {
      console.log(`\n  -- ${sourceOf(row)} / ${modelOf(row)} @ ${new Date(row.createdAt).toISOString()}`);
      console.log(`     candidate: ${nameOf.get(row.candidateId) ?? `#${row.candidateId}`}`);
      console.log(`     text length: ${row.extractedText?.length ?? 0} chars`);
      for (const f of KEY_FIELDS) {
        const v = row.parsedData?.[f];
        console.log(`     ${f.padEnd(24)} ${isBlank(v) ? "(missing)" : String(v)}`);
      }
    }
  }

  // ---- Needs review ----
  console.log(`\n===== DISAGREEMENTS NEEDING REVIEW (${disagreementRows.length}) =====`);
  if (!disagreementRows.length) {
    console.log("None.");
  } else {
    const seen = new Set<string>();
    for (const d of disagreementRows) {
      if (seen.has(d.file)) continue;
      seen.add(d.file);
      if (seen.size > MAX_OUT) {
        console.log(`  ... truncated at ${MAX_OUT}; re-run with --max-disagreements=999 for the full list`);
        break;
      }
      const fields = disagreementRows.filter((x) => x.file === d.file);
      console.log(`\n  ${d.file}`);
      for (const f of fields) {
        console.log(`    ${f.field}:`);
        for (const [who, val] of Object.entries(f.values)) console.log(`      ${who.padEnd(28)} ${val}`);
      }
    }
  }

  // ---- Missing candidates ----
  const matched = new Set(rows.map((r) => r.candidateId));
  const orphans = names.filter((c: any) => !matched.has(c.id));
  console.log(`\n===== COVERAGE GAP =====`);
  console.log(`Candidates with no scan: ${orphans.length} of ${names.length}`);
  if (orphans.length) {
    for (const c of orphans.slice(0, 25)) console.log(`  - ${c.name} (id ${c.id})`);
    if (orphans.length > 25) console.log(`  ... and ${orphans.length - 25} more`);
  }
}

main().catch((e) => {
  console.error("Compare error:", e);
  process.exit(1);
});
