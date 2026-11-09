/** JOB 12: every PDF section 1–17 present in order; empty sections show n/a instead of a bare header.
 *  "Section 3 missing" in the MSFT PDF was a pdftotext artefact: the header starts page 2, so the text
 *  line is "\f   3 ZYKLUS…" and a line-anchored scan skips it. This test strips form feeds before scanning.
 *  Run: npx tsx script/test-pdf-section-na.ts   (PDF=1 also renders a real PDF and checks pdftotext) */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
delete process.env.ANTHROPIC_API_KEY;
const { generateAnalysisHTML, renderHTMLtoPDF } = await import("../server/pdf-export");

const headers = (html: string) => Array.from(html.matchAll(/class="sec-header"><span>(\d+) &nbsp;/g)).map(m => Number(m[1]));
const seq = Array.from({ length: 17 }, (_, i) => i + 1);

const msft = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const full = await generateAnalysisHTML({ ...msft, cycleClassification: "Secular Growth", politicalCycle: "Low sensitivity" });
assert.deepEqual(headers(full), seq, "all 17 sections in order");
assert.match(full, /Zyklusklassifikation<\/span><span class="row-val">Secular Growth/);
assert.doesNotMatch(full, /data-testid="pdf-s3-na"/);

const bare = await generateAnalysisHTML({ ticker: "BARE", companyName: "Bare Inc", currentPrice: 10, sector: "Tech", industry: "SW", historicalPrices: [] });
assert.deepEqual(headers(bare), seq, "headers also without data");
for (const s of [3, 8, 11, 12, 13, 15]) assert.match(bare, new RegExp(`data-testid="pdf-s${s}-na"`), `section ${s} n/a`);
const partial = await generateAnalysisHTML({ ticker: "P", companyName: "P", currentPrice: 10, sector: "T", industry: "S", historicalPrices: [], politicalCycle: "Mittel" });
assert.match(partial, /Zyklusklassifikation<\/span><span class="row-val">n\/a/);
assert.match(partial, /Politischer Zyklus<\/span><span class="row-val">Mittel/);
assert.match(full, /\.sec-header \{[^}]*break-after: avoid/, "header kept with its content");

if (process.env.PDF === "1") {
  const src = existsSync("/workspace/dod-round2-api/msft.json") ? JSON.parse(readFileSync("/workspace/dod-round2-api/msft.json", "utf8")) : msft;
  const pdf = await renderHTMLtoPDF(await generateAnalysisHTML(src));
  writeFileSync("/tmp/job12-msft.pdf", pdf);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  const txt = execFileSync("pdftotext", ["-layout", "/tmp/job12-msft.pdf", "-"], { encoding: "utf8" });
  const anchored = (t: string) => Array.from(t.matchAll(/^ *(\d{1,2}) [A-ZÄÖÜ]/gm)).map(m => Number(m[1])).filter(n => n <= 17);
  const found = anchored(txt.replace(/\f/g, "\n"));
  for (const n of seq) assert.ok(found.includes(n), `section ${n} in pdftotext (form feeds stripped)`);
  console.log(`PDF ok: /tmp/job12-msft.pdf; without stripping \\f a line scan would miss: ${seq.filter(n => !anchored(txt).includes(n)).join(",") || "none"}`);
}
console.log("test-pdf-section-na: OK");
