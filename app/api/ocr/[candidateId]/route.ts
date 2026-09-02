import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, databaseUnavailable } from "@/lib/db";
import { affidavitScans, candidates } from "@/lib/schema";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  if (!db) return databaseUnavailable();
  const { candidateId } = await params;
  const scans = await db.select({
    id: affidavitScans.id,
    filename: affidavitScans.filename,
    status: affidavitScans.status,
    parsedData: affidavitScans.parsedData,
    createdAt: affidavitScans.createdAt,
  }).from(affidavitScans).where(eq(affidavitScans.candidateId, candidateId)).orderBy(desc(affidavitScans.createdAt));
  return NextResponse.json({ scans });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  if (!db) return databaseUnavailable();
  const { candidateId } = await params;
  const body = await request.json().catch(() => ({}));
  const allowed = ["name", "age", "education", "assets", "criminalCases"];
  const fields = Object.fromEntries(
    allowed
      .filter((key) => body[key] !== undefined && body[key] !== null)
      .map((key) => [key, body[key]]),
  );
  if (!Object.keys(fields).length) return NextResponse.json({ error: "No profile fields supplied." }, { status: 400 });
  const [updated] = await db.update(candidates).set(fields).where(eq(candidates.id, candidateId)).returning();
  if (!updated) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  return NextResponse.json({ candidate: updated });
}
