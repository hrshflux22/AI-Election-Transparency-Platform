export interface ParsedAffidavit {
  name?: string;
  age?: number;
  education?: string;
  assets?: string;
  liabilities?: string;
  criminalCases?: number;
  constituency?: string;
  pan?: string;
  occupation?: string;
  spouseName?: string;
  city?: string;
  state?: string;
  rawText: string;
}

const find = (text: string, pattern: RegExp) => text.match(pattern)?.[1]?.trim();

export function parseAmount(raw: string): string | undefined {
  const cleaned = raw.replace(/[,\s]/g, "");
  const normalized = cleaned.replace(/[A-Za-z₹]/g, "").trim().replace(/\s+/g, "");
  if (!normalized) return undefined;
  if (/(crore|cr\b)/i.test(raw)) {
    const num = normalized.replace(/\./g, "");
    const croreValue = Number(num) / 10000000;
    return `₹${isNaN(croreValue) ? 0 : croreValue.toFixed(1)} Cr`;
  }
  if (/(lakh|lc\b)/i.test(raw)) {
    const num = normalized.replace(/\./g, "");
    const lakhValue = Number(num) / 100000;
    return `₹${isNaN(lakhValue) ? 0 : lakhValue.toFixed(1)} Lakh`;
  }
  const digits = normalized.replace(/\D/g, "");
  if (digits.length > 0) {
    const value = parseInt(digits, 10);
    if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)} Cr`;
    if (value >= 100000) return `₹${(value / 100000).toFixed(1)} Lakh`;
    return `₹${value.toLocaleString("en-IN")}`;
  }
  return undefined;
}

export function parseAffidavitText(rawText: string): ParsedAffidavit {
  const text = rawText.replace(/\r/g, "");

  // Name - appears in Form 26 as "Thiru/Shri X son of Y aged Z"
  const nameMatch = text.match(/(?:Shri|Thiru|Smt\.|Kum\.|Adv\.)*\s*([A-Z][a-z]+(?:\s+[A-Z][a-zA-Z]+){1,4})\s+(?:son|daughter|wife|S\/O|D\/O|W\/O)/i)
    || text.match(/^([A-Z][A-Za-z-]+(?:\s+[A-Z][a-zA-Z-]+){1,4})\s*$/m)
    || find(text, /(?:name\s*[:\-])([^\n]+)/i);

  // Age - "Aged NN years" or "age: NN"
  const ageMatch = text.match(/Aged\s+(\d{1,2})\s*(?:years|yrs)?/i)
    || find(text, /\bage\s*[:\-]?\s*(\d{1,2})\b/i);

  // Education - from declaration
  const education = find(text, /(?:educational\s+qualification|qualification|education)\s*[:\-]\s*([^\n]+)/i);

  // Total assets - "Total value of assets: Rs X"
  const assetsLine = text.match(/(?:Total\s+value\s+of\s+(?:movable|immovable)?\s*assets?|Total\s+assets?|Assets|Gross\s+value)\s*[:\-]?\s*((?:Rs|₹)[^,\n]{0,60}(?:Crore|Lakh|lakh|cr)?)/i)?.[1];
  const assets = assetsLine ? (parseAmount(assetsLine) ?? assetsLine.trim()) : undefined;

  // Liabilities
  const liabLine = text.match(/(?:Total\s+liabilit(?:y|ies)|Liabilit(?:y|ies))\s*[:\-]?\s*((?:Rs|₹)[^,\n]{0,60}(?:Crore|Lakh|lakh|cr)?)/i)?.[1];
  const liabilities = liabLine ? (parseAmount(liabLine) ?? liabLine.trim()) : undefined;

  // Criminal cases
  const cases = find(text, /(?:pending\s+criminal\s+cases?|criminal\s+cases?\s*(?:pending)?|no\.\s*of\s*criminal)\s*[:\-]?\s*(\d{1,3})/i)
    || find(text, /criminal\s+cases?\s*[:(\-]\s*(\d{1,3})/i);

  // Constituency
  const constituency = find(text, /from\s+(\d+\s*)?([A-Z][A-Za-z\s-]{2,40}?)\s*(?:PARLIAMENTARY|ASSEMBLY)\s+CONSTITUENCY/i);

  // PAN
  const pan = find(text, /(?:PAN|Permanent Account Number)\s*[:\-]?\s*([A-Z]{5}[0-9]{4}[A-Z])/i);

  return {
    name: typeof nameMatch === "string" ? nameMatch : nameMatch?.[1]?.replace(/\b(?:Thiru|Shri|Smt\.|Kum\.|Adv\.)\b/g, "").trim(),
    age: ageMatch ? Number(typeof ageMatch === "string" ? ageMatch : ageMatch[1]) : undefined,
    education,
    assets,
    liabilities,
    criminalCases: cases ? Number(cases) : undefined,
    constituency,
    pan,
    rawText,
  };
}
