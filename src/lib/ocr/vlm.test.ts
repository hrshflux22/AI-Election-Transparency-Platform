import { parseBatchExtractionJson, parseExtractionJson } from "./vlm";

const cases: [string, string][] = [
  ["clean", '{"a":1,"b":"x"}'],
  ["fenced", '```json\n{"a":1}\n```'],
  ["prose-wrapped", 'Here is the data: {"a":1,"b":[1,2]} Hope this helps.'],
  ["unescaped-newline-in-string", '{"warnings":["line one\nline two"]}'],
  ["tab-in-string", '{"n":"col1\tcol2"}'],
  ["trailing-comma-object", '{"a":1,"b":2,}'],
  ["trailing-comma-array", '{"a":[1,2,3,]}'],
  ["dup-comma-array", '{"a":[1,,2]}'],
  ["comma-after-opener", '{"a":[,1,2]}'],
  ["empty-value-before-comma", '{"a": ,"b":1}'],
  ["unterminated-array", '{"assets":["a","b"'],
  ["nested-broken", '{"a":{"b":[1,2,},"c":"d"}'],
  ["mismatched-closer", '{"a":[1,2}]}'],
  ["truncated-mid-object", '{"name":"Krupal","age":41,"criminalCases":2,'],
  ["stray-closer", '{"a":1}}'],
  ["unterminated-string", '{"warnings":["line one'],
];

let pass = 0;
let fail = 0;
for (const [name, input] of cases) {
  try {
    const result = parseExtractionJson(input);
    pass++;
    console.log(`  PASS  ${name.padEnd(30)} ${JSON.stringify(result).slice(0, 60)}`);
  } catch (e: any) {
    fail++;
    console.log(`  FAIL  ${name.padEnd(30)} ${e.message.slice(0, 60)}`);
  }
}

try {
  parseExtractionJson("no json at all here");
  fail++;
  console.log("  FAIL  garbage-should-throw        did not throw");
} catch {
  pass++;
  console.log("  PASS  garbage-should-throw        threw as expected");
}

console.log(`\n  ${pass} passed, ${fail} failed`);

// ---------- batch parsing ----------

const ids = ["A. Gopala Krishna.pdf", "Bansuri Swaraj  .pdf", "Ajay Tiwari.pdf"];

function check(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${name.padEnd(34)}`);
  } catch (e: any) {
    fail++;
    console.log(`  FAIL  ${name.padEnd(34)} ${e.message.slice(0, 70)}`);
  }
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

check("batch keyed-object", () => {
  const raw = JSON.stringify({
    "A. Gopala Krishna.pdf": { name: "A. Gopala Krishna", age: 54 },
    "Bansuri Swaraj  .pdf": { name: "Bansuri Swaraj", age: 38 },
    "Ajay Tiwari.pdf": { name: "Ajay Tiwari", age: 45 },
  });
  const { byId, missing } = parseBatchExtractionJson(raw, ids);
  assert(byId.size === 3 && missing.length === 0, `got ${byId.size} docs, missing ${missing.length}`);
  assert(byId.get(ids[1])?.name === "Bansuri Swaraj", "wrong value for second doc");
});

check("batch case/spacing-insensitive keys", () => {
  const raw = JSON.stringify({
    "a. gopala krishna.pdf": { name: "A. Gopala Krishna" },
    "BANSURI SWARAJ.pdf": { name: "Bansuri Swaraj" },
    "Ajay Tiwari.pdf": { name: "Ajay Tiwari" },
  });
  const { byId, missing } = parseBatchExtractionJson(raw, ids);
  assert(byId.size === 3 && !missing.length, `got ${byId.size}, missing ${JSON.stringify(missing)}`);
});

check("batch fenced response", () => {
  const raw = '```json\n{"A. Gopala Krishna.pdf":{"name":"x"},"Bansuri Swaraj  .pdf":{"name":"y"},"Ajay Tiwari.pdf":{"name":"z"}}\n```';
  const { byId, missing } = parseBatchExtractionJson(raw, ids);
  assert(byId.size === 3 && !missing.length, `got ${byId.size}`);
});

check("batch prose-wrapped response", () => {
  const raw = `Sure! Here is the extraction: {"A. Gopala Krishna.pdf":{"age":54},"Bansuri Swaraj  .pdf":{"age":38},"Ajay Tiwari.pdf":{"age":45}}`;
  const { byId } = parseBatchExtractionJson(raw, ids);
  assert(byId.size === 3, `got ${byId.size}`);
});

check("batch array response", () => {
  const raw = JSON.stringify([
    { filename: "A. Gopala Krishna.pdf", name: "A" },
    { file: "Bansuri Swaraj  .pdf", name: "B" },
    { document: "Ajay Tiwari.pdf", name: "C" },
  ]);
  const { byId, missing } = parseBatchExtractionJson(raw, ids);
  assert(byId.size === 3 && !missing.length, `got ${byId.size}, missing ${JSON.stringify(missing)}`);
});

check("batch wrapper object {results:{...}}", () => {
  const raw = JSON.stringify({
    results: { "A. Gopala Krishna.pdf": { age: 54 }, "Bansuri Swaraj  .pdf": { age: 38 }, "Ajay Tiwari.pdf": { age: 45 } },
  });
  const { byId } = parseBatchExtractionJson(raw, ids);
  assert(byId.size === 3, `got ${byId.size}`);
});

check("batch marker-prefixed keys", () => {
  const raw = JSON.stringify({
    "=== DOCUMENT 1: A. Gopala Krishna.pdf ===": { age: 1 },
    "=== DOCUMENT 2: Bansuri Swaraj  .pdf ===": { age: 2 },
    "=== DOCUMENT 3: Ajay Tiwari.pdf ===": { age: 3 },
  });
  const { byId } = parseBatchExtractionJson(raw, ids);
  assert(byId.size === 3, `got ${byId.size}`);
});

check("batch reports missing docs", () => {
  const raw = JSON.stringify({ "A. Gopala Krishna.pdf": { age: 54 } });
  const { byId, missing } = parseBatchExtractionJson(raw, ids);
  assert(byId.size === 1, `got ${byId.size}`);
  assert(missing.length === 2 && missing.includes(ids[1]) && missing.includes(ids[2]), `missing=${JSON.stringify(missing)}`);
});

check("batch single-doc bare object", () => {
  const raw = '{"name":"Solo Candidate","age":41,"criminalCases":0}';
  const { byId, missing } = parseBatchExtractionJson(raw, ["Solo Candidate.pdf"]);
  assert(byId.size === 1 && !missing.length, `got ${byId.size}, missing ${JSON.stringify(missing)}`);
  assert(byId.get("Solo Candidate.pdf")?.name === "Solo Candidate", "wrong value");
});

check("batch single-doc keyed object", () => {
  const raw = '{"Solo Candidate.pdf":{"name":"Solo Candidate"}}';
  const { byId, missing } = parseBatchExtractionJson(raw, ["Solo Candidate.pdf"]);
  assert(byId.size === 1 && !missing.length, `got ${byId.size}`);
});

check("batch repaired/truncated response", () => {
  const raw = '{"A. Gopala Krishna.pdf":{"age":54},"Bansuri Swaraj  .pdf":{"age":38},"Ajay Tiwari.pdf":{"age":';
  const { byId } = parseBatchExtractionJson(raw, ids);
  assert(byId.size >= 2, `got ${byId.size}`);
});

check("batch garbage throws", () => {
  let threw = false;
  try {
    parseBatchExtractionJson("no json here at all", ids);
  } catch {
    threw = true;
  }
  assert(threw, "did not throw");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
