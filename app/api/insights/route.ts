import { NextResponse } from "next/server";
import { and, eq, desc, sql } from "drizzle-orm";
import { db, databaseUnavailable } from "@/lib/db";
import { candidates } from "@/lib/schema";

export const runtime = "nodejs";

function parseAssetsToCrores(assets: string): number {
  const cleaned = assets.replace(/[₹,\s]/g, "");
  const value = parseFloat(cleaned.replace(/[^\d.]/g, ""));
  if (isNaN(value)) return 0;
  if (/cr/i.test(cleaned)) return value;
  if (/lakh/i.test(cleaned)) return value / 100;
  return value / 10000000;
}

export async function GET(request: Request) {
  if (!db) return databaseUnavailable();
  const params = new URL(request.url).searchParams;
  const state = params.get("state")?.trim();
  const constituency = params.get("constituency")?.trim();

  const filters = [];
  if (state) filters.push(eq(candidates.state, state));
  if (constituency && constituency !== "all") filters.push(eq(candidates.constituency, constituency));
  const where = filters.length ? and(...filters) : undefined;

  // Fetch all matching candidates for client-aggregation (dataset is small enough)
  const rows = await db.select().from(candidates).where(where);

  // ---- Aggregate stats ----
  const total = rows.length;
  const withCriminalCases = rows.filter((c) => c.criminalCases > 0);
  const totalCriminalCases = rows.reduce((s, c) => s + (c.criminalCases || 0), 0);
  const avgCriminalCases = total ? +(totalCriminalCases / total).toFixed(2) : 0;

  const assetsInCrores = rows.map((c) => parseAssetsToCrores(c.assets));
  const totalAssets = assetsInCrores.reduce((s, v) => s + v, 0);
  const avgAssets = total ? +(totalAssets / total).toFixed(2) : 0;
  const maxAssets = total ? Math.max(...assetsInCrores) : 0;
  const medianAssets = total
    ? +[...assetsInCrores].sort((a, b) => a - b)[Math.floor(assetsInCrores.length / 2)].toFixed(2)
    : 0;

  const avgCredibility = total ? +(rows.reduce((s, c) => s + c.credibilityScore, 0) / total).toFixed(1) : 0;
  const avgCriminalRisk = total ? +(rows.reduce((s, c) => s + c.criminalRisk, 0) / total).toFixed(1) : 0;
  const avgFinancial = total ? +(rows.reduce((s, c) => s + c.financialTransparency, 0) / total).toFixed(1) : 0;

  // Criminal cases by party (aggregate)
  const partyStats = new Map<string, { cases: number; count: number; totalCases: number }>();
  for (const c of rows) {
    const cur = partyStats.get(c.party) ?? { cases: 0, count: 0, totalCases: 0 };
    cur.count += 1;
    cur.totalCases += c.criminalCases || 0;
    if ((c.criminalCases || 0) > 0) cur.cases += 1;
    partyStats.set(c.party, cur);
  }
  const crimeByParty = [...partyStats.entries()]
    .filter(([, s]) => s.count >= 3)
    .map(([party, s]) => ({
      party,
      candidates: s.count,
      totalCases: s.totalCases,
      withCases: s.cases,
      avgCases: +(s.totalCases / s.count).toFixed(2),
    }))
    .sort((a, b) => b.totalCases - a.totalCases)
    .slice(0, 12);

  // Credibility distribution buckets
  const bucketDefs = [
    { key: "0-40", label: "8-40", min: 0, max: 40 },
    { key: "40-60", label: "40-60", min: 40, max: 60 },
    { key: "60-80", label: "60-80", min: 60, max: 80 },
    { key: "80-95", label: "80-95", min: 80, max: 101 },
  ];
  const credibilityDistribution = bucketDefs.map((b) => ({
    name: b.label,
    value: rows.filter((c) => c.credibilityScore >= b.min && c.credibilityScore < b.max).length,
  }));

  // Avg assets by party (aggregate, for chart)
  const assetsByParty = [...partyStats.entries()]
    .map(([party, s]) => ({
      party,
      candidatess: s.count,
      avgAssets: +(rows.filter((c) => c.party === party).reduce((sum, c) => sum + parseAssetsToCrores(c.assets), 0) / s.count).toFixed(2),
    }))
    .filter((x) => x.candidatess >= 3)
    .sort((a, b) => b.avgAssets - a.avgAssets)
    .slice(0, 10);

  // Candidates with cases (top offenders)
  const topOffenders = [...rows]
    .filter((c) => c.criminalCases > 0)
    .sort((a, b) => b.criminalCases - a.criminalCases)
    .slice(0, 10)
    .map((c) => ({
      id: c.id,
      name: c.name,
      party: c.party,
      constituency: c.constituency,
      state: c.state,
      criminalCases: c.criminalCases,
      credibilityScore: c.credibilityScore,
    }));

  // State comparison (always show Delhi vs Kerala)
  const stateRows = await db.select().from(candidates);
  const stateBreakdown = ["Delhi", "Kerala"].map((st) => {
    const sr = stateRows.filter((c) => c.state === st);
    const cases = sr.reduce((s, c) => s + (c.criminalCases || 0), 0);
    return {
      state: st,
      candidates: sr.length,
      totalCriminalCases: cases,
      avgCredibility: sr.length ? +(sr.reduce((s, c) => s + c.credibilityScore, 0) / sr.length).toFixed(1) : 0,
      candidatesWithCases: sr.filter((c) => c.criminalCases > 0).length,
    };
  });

  const criminalCandidateShare = total ? +((withCriminalCases.length / total) * 100).toFixed(1) : 0;

  return NextResponse.json({
    metrics: {
      total,
      avgCriminalCases,
      avgAssets,
      medianAssets,
      maxAssets,
      avgCredibility,
      avgCriminalRisk,
      avgFinancial,
      withCriminalCases: withCriminalCases.length,
      criminalCandidateShare,
      totalAssets,
      totalCriminalCases,
    },
    crimeByParty,
    assetsByParty,
    credibilityDistribution,
    topOffenders,
    stateBreakdown,
  });
}
