import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, databaseUnavailable } from "@/lib/db";
import { candidates } from "@/lib/schema";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!db) return databaseUnavailable();

  const { id } = await params;
  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, id)).limit(1);
  if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });

  return NextResponse.json({ candidate });
}
