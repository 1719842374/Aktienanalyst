/** #226 follow-up: no ANTHROPIC_API_KEY → PDF still renders, AI summary shows an n/a note, no 500. Chromium lookup order.
 *  Run: npx tsx script/test-pdf-narrative-na.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
delete process.env.ANTHROPIC_API_KEY;
const { generateAnalysisHTML, resolvePdfChromium, NARRATIVE_NA_NOTE } = await import("../server/pdf-export");

const base = { ticker: "NOKEY", companyName: "No Key Inc", currentPrice: 100, sector: "Technology", industry: "Software", historicalPrices: [] };
const t0 = Date.now();
const html = await generateAnalysisHTML(base);
assert.ok(Date.now() - t0 < 5000, "no network wait for the LLM");
assert.match(html, /data-testid="pdf-narrative-na"/);
assert.ok(html.includes(NARRATIVE_NA_NOTE));
assert.doesNotMatch(html, />Executive Summary</);
assert.doesNotMatch(html, />Handlungsempfehlung</);
assert.match(html, /FAZIT: /, "rest of the PDF intact");

// ETF: section 14 n/a
const etf = await generateAnalysisHTML({ ...base, ticker: "ETFX", isEtf: true });
assert.match(etf, /n\/a \(ETF\/Fonds — Reverse DCF nicht anwendbar\)/);

// Chromium order: env override wins, then @sparticuz/chromium, then Playwright default
process.env.PDF_CHROMIUM_PATH = "/custom/chrome";
assert.deepEqual((await resolvePdfChromium()).source, "PDF_CHROMIUM_PATH");
delete process.env.PDF_CHROMIUM_PATH;
const r = await resolvePdfChromium();
assert.ok(["@sparticuz/chromium", "playwright-default"].includes(r.source));
assert.ok(r.args.includes("--no-sandbox"));
const src = readFileSync("server/pdf-export.ts", "utf8");
assert.ok(src.indexOf("PDF_CHROMIUM_PATH) return") < src.indexOf("import('@sparticuz/chromium')"));
assert.ok(src.indexOf("import('@sparticuz/chromium')") < src.indexOf("source: 'playwright-default'"));
console.log(`chromium source here: ${r.source}`);
console.log("test-pdf-narrative-na: OK");
