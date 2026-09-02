import * as XLSX from "xlsx";
import path from "path";

interface RawCandidate {
  srNo: number;
  name: string;
  party: string;
  criminalCases: number;
  education: string;
  age: number;
  totalAssets: string;
  liabilities: string;
  constituency: string;
}

export interface SeedCandidate {
  id: string;
  name: string;
  party: string;
  constituency: string;
  state: string;
  photo: string;
  credibilityScore: number;
  criminalRisk: number;
  financialTransparency: number;
  performance: number;
  criminalCases: number;
  assets: string;
  liabilities: string;
  education: string;
  age: number;
  experience: string;
}

function parseIndianRupees(s: string): number {
  const cleaned = s.replace(/[^\d]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}

function formatAssets(rawAmount: number): string {
  if (rawAmount >= 10000000) {
    return `₹${(rawAmount / 10000000).toFixed(1)} Cr`;
  }
  if (rawAmount >= 100000) {
    return `₹${(rawAmount / 100000).toFixed(1)} Lakh`;
  }
  return `₹${rawAmount.toLocaleString("en-IN")}`;
}

function calculateCriminalRisk(criminalCases: number): number {
  if (criminalCases === 0) return 85 + Math.round(Math.random() * 10);
  if (criminalCases === 1) return 65 + Math.round(Math.random() * 10);
  if (criminalCases <= 3) return 45 + Math.round(Math.random() * 10);
  if (criminalCases <= 5) return 30 + Math.round(Math.random() * 10);
  if (criminalCases <= 10) return 15 + Math.round(Math.random() * 10);
  if (criminalCases <= 20) return 5 + Math.round(Math.random() * 10);
  return Math.max(2, 15 - Math.round(Math.random() * 10));
}

function calculateFinancialTransparency(totalAssets: number, liabilities: number): number {
  if (totalAssets === 0) return 15 + Math.round(Math.random() * 15);
  const ratio = liabilities / totalAssets;
  if (ratio > 0.8) return 20 + Math.round(Math.random() * 10);
  if (ratio > 0.5) return 35 + Math.round(Math.random() * 10);
  if (ratio > 0.3) return 50 + Math.round(Math.random() * 10);
  if (ratio > 0.1) return 65 + Math.round(Math.random() * 10);
  return 80 + Math.round(Math.random() * 15);
}

function calculateCredibilityScore(
  criminalRisk: number,
  financialTransparency: number,
  criminalCases: number,
  age: number,
  education: string,
): number {
  let score = 0;
  score += criminalRisk * 0.35;
  score += financialTransparency * 0.30;
  if (criminalCases === 0) score += 15;
  else if (criminalCases <= 2) score += 8;
  else if (criminalCases <= 5) score += 2;
  else score -= Math.min(15, criminalCases * 0.8);
  if (age >= 30 && age <= 55) score += 8;
  else if (age >= 25 && age <= 65) score += 5;
  else score += 2;
  const edu = education.toLowerCase();
  if (edu.includes("doctorate")) score += 12;
  else if (edu.includes("post graduate")) score += 9;
  else if (edu.includes("graduate professional")) score += 7;
  else if (edu.includes("graduate")) score += 5;
  else if (edu.includes("12th")) score += 3;
  else if (edu.includes("10th")) score += 1;
  else score -= 2;
  return Math.max(5, Math.min(95, Math.round(score)));
}

function calculatePerformance(credibilityScore: number, criminalCases: number): number {
  let perf = credibilityScore * 0.65;
  if (criminalCases === 0) perf += 18;
  else if (criminalCases <= 2) perf += 10;
  else perf -= Math.min(20, criminalCases * 1.5);
  return Math.max(5, Math.min(95, Math.round(perf)));
}

function generateExperience(age: number, education: string): string {
  const yearsInPolitics = Math.max(1, Math.floor((age - 25) * 0.4));
  if (yearsInPolitics <= 3) return `${yearsInPolitics} years in local governance`;
  if (yearsInPolitics <= 8) return `${yearsInPolitics} years in public service`;
  if (yearsInPolitics <= 15) return `${yearsInPolitics} years in politics and social work`;
  return `${yearsInPolitics} years in politics and governance`;
}

function determineState(constituency: string): string {
  const c = constituency.toLowerCase();
  if (c.startsWith("delhi")) return "Delhi";
  if (c === "new delhi" || c === "north east delhi" || c === "north west delhi" || c === "south delhi" || c === "west delhi" || c === "east delhi") return "Delhi";
  return "Kerala";
}

function generatePhotoUrl(name: string, index: number): string {
  const colors = ["3B82F6", "EF4444", "10B981", "F59E0B", "8B5CF6", "EC4899", "06B6D4", "F97316"];
  const color = colors[index % colors.length];
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=${color}&color=fff&size=400&bold=true&format=svg`;
}

export function parseExcelCandidates(): SeedCandidate[] {
  const filePath = path.resolve(process.cwd(), "Candidate Affidavits", "Candidate Detailed Info(cleaned).xlsx");
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const rawCandidates: RawCandidate[] = rows.slice(1)
    .filter((row): row is unknown[] => Array.isArray(row) && row[0] != null && row[1] != null)
    .map((row) => ({
      srNo: Number(row[0]),
      name: String(row[1]).trim(),
      party: String(row[2]).trim(),
      criminalCases: Number(row[3]) || 0,
      education: String(row[4]).trim(),
      age: Number(row[5]) || 35,
      totalAssets: String(row[6]).trim(),
      liabilities: String(row[7]).trim(),
      constituency: String(row[8]).trim(),
    }));

  return rawCandidates.map((raw, index): SeedCandidate => {
    const assetValue = parseIndianRupees(raw.totalAssets);
    const liabilityValue = parseIndianRupees(raw.liabilities);
    const criminalRisk = calculateCriminalRisk(raw.criminalCases);
    const financialTransparency = calculateFinancialTransparency(assetValue, liabilityValue);
    const credibilityScore = calculateCredibilityScore(
      criminalRisk, financialTransparency, raw.criminalCases, raw.age, raw.education,
    );
    const performance = calculatePerformance(credibilityScore, raw.criminalCases);
    const state = determineState(raw.constituency);
    const cleanConstituency = raw.constituency.replace(/^Delhi\(/, "").replace(/\)$/, "");
    const cleanedName = raw.name.replace(/\s+/g, " ").trim();

    return {
      id: String(raw.srNo),
      name: cleanedName,
      party: raw.party,
      constituency: cleanConstituency,
      state,
      photo: generatePhotoUrl(cleanedName, index),
      credibilityScore,
      criminalRisk,
      financialTransparency,
      performance,
      criminalCases: raw.criminalCases,
      assets: formatAssets(assetValue),
      liabilities: formatAssets(liabilityValue),
      education: raw.education,
      age: raw.age,
      experience: generateExperience(raw.age, raw.education),
    };
  });
}

if (typeof require !== "undefined" && require.main === module) {
  const candidates = parseExcelCandidates();
  console.log(`Parsed ${candidates.length} candidates from Excel.`);
  console.log("\nSample:");
  candidates.slice(0, 3).forEach(c => console.log(JSON.stringify(c, null, 2)));
  const delhiCount = candidates.filter(c => c.state === "Delhi").length;
  const keralaCount = candidates.filter(c => c.state === "Kerala").length;
  console.log(`\nDelhi: ${delhiCount}, Kerala: ${keralaCount}`);
}
