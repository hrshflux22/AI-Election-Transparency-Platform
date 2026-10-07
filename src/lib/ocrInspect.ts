// Ad-hoc: dump the newest stored scan row for a filename, for eyeballing
// extraction quality. Read-only.
//
//   npx tsx --env-file=.env.local src/lib/ocrInspect.ts "A. Gopala Krishna.pdf"

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createRequire } from "module";
import { desc, eq } from "drizzle-orm";
import { affidavitScans, candidates } from "./schema";

const require = createRequire(import.meta.url);
const { neon } = require("@neondatabase/serverless");
const { drizzle } = require("drizzle-orm/neon-http");

const target = process.argv[2];

async function main() {
  const db = drizzle(neon(process.env.DATABASE_URL));
  const rows: any[] = await db
    .select()
    .from(affidavitScans)
    .where(eq(affidavitScans.filename, target))
    .orderBy(desc(affidavitScans.createdAt));

  if (!rows.length) {
    console.log(`No stored scans for "${target}".`);
    return;
  }

  const names: any[] = await db.select({ id: candidates.id, name: candidates.name }).from(candidates);
  const nameOf = new Map(names.map((c: any) => [c.id, c.name]));

  for (const row of rows) {
    const p = row.parsedData || {};
    console.log(`\n===== ${row.filename} =====`);
    console.log(`candidate:   ${nameOf.get(row.candidateId) ?? `#${row.candidateId}`}`);
    console.log(`stored:      ${new Date(row.createdAt).toISOString()}`);
    console.log(`source:      ${p._source}  model: ${p._model}`);
    console.log(`tokens:      in=${p._inTokens} out=${p._outTokens}  cost=$${p._estimatedCostUsd ?? "0 (free)"}`);
    console.log(`pages:       ${p._form26Pages ?? "n/a"}  elapsed: ${p._elapsedMs}ms`);
    console.log(`form26Found: ${p.form26Found}   confidence: ${p.confidence}`);

    console.log(`\n-- fields --`);
    for (const [k, v] of Object.entries(p)) {
      if (k.startsWith("_")) continue;
      if (v === null || v === undefined || v === "") continue;
      if (Array.isArray(v)) {
        console.log(`  ${k}: [${v.length}]`);
        for (const item of v.slice(0, 12)) console.log(`      - ${typeof item === "string" ? item : JSON.stringify(item)}`);
        if (v.length > 12) console.log(`      ... +${v.length - 12} more`);
    } else {
      const text = typeof v === "object" ? JSON.stringify(v) : String(v);
      console.log(`  ${k}: ${text}`);
    }
    }
    if (Array.isArray(p.warnings) && p.warnings.length) {
      console.log(`\n-- warnings --`);
      for (const w of p.warnings) console.log(`  - ${w}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
