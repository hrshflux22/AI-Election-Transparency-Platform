import { NextResponse } from "next/server";
import { desc, ilike, or, and, eq, sql } from "drizzle-orm";
import { db, databaseUnavailable } from "@/lib/db";
import { candidates } from "@/lib/schema";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!db) return databaseUnavailable();
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim();
  const state = params.get("state")?.trim();
  const constituency = params.get("constituency")?.trim();
  const party = params.get("party")?.trim();
  const limit = Math.min(Number(params.get("limit")) || 50, 300);
  const offset = Number(params.get("offset")) || 0;

  const conditions = [];

  if (query) {
    conditions.push(or(
      ilike(candidates.name, `%${query}%`),
      ilike(candidates.constituency, `%${query}%`),
      ilike(candidates.party, `%${query}%`),
    ));
  }
  if (state) conditions.push(eq(candidates.state, state));
  if (constituency) conditions.push(ilike(candidates.constituency, `%${constituency}%`));
  if (party) conditions.push(ilike(candidates.party, `%${party}%`));

  const where = conditions.length ? and(...conditions) : undefined;

  const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(candidates).where(where);
  const rows = await db.select().from(candidates).where(where).orderBy(desc(candidates.credibilityScore)).limit(limit).offset(offset);

  return NextResponse.json({ candidates: rows, total: countRow?.count ?? 0 });
}
