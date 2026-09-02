import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, databaseUnavailable } from "@/lib/db";
import { candidates } from "@/lib/schema";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!db) return databaseUnavailable();
  const params = new URL(request.url).searchParams;
  const state = params.get("state")?.trim();

  const where = state ? sql`${candidates.state} = ${state}` : undefined;

  const rows = await db.select({
    constituency: candidates.constituency,
    state: candidates.state,
    count: sql<number>`count(*)::int`,
  }).from(candidates).where(where).groupBy(candidates.constituency, candidates.state).orderBy(candidates.constituency);

  return NextResponse.json({ constituencies: rows });
}
