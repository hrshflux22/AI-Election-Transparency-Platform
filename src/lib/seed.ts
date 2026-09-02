import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { candidates } from "./schema";
import { parseExcelCandidates } from "./parseCandidates";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to seed the database.");
  }

  const db = drizzle(neon(connectionString));
  const seedCandidates = parseExcelCandidates();

  console.log(`Seeding ${seedCandidates.length} candidates from Excel...`);

  const batchSize = 50;
  for (let i = 0; i < seedCandidates.length; i += batchSize) {
    const batch = seedCandidates.slice(i, i + batchSize);
    await db.insert(candidates).values(batch).onConflictDoNothing();
    console.log(`  Inserted batch ${Math.floor(i / batchSize) + 1} (${batch.length} candidates)`);
  }

  console.log(`\nDone!`);
  const delhiCount = seedCandidates.filter(c => c.state === "Delhi").length;
  const keralaCount = seedCandidates.filter(c => c.state === "Kerala").length;
  console.log(`  Delhi: ${delhiCount} candidates`);
  console.log(`  Kerala: ${keralaCount} candidates`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
