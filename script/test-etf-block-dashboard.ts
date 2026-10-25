/**
 * ETF/Index/Fonds sind nicht Teil des Aktien-Dashboards: nur Hinweis, kein PDF, /api/export-pdf → 422.
 * Run: npx tsx script/test-etf-block-dashboard.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { registerPdfExportRoute } from "../server/pdf-export-route";
import { isEtfOrFund } from "../shared/conflict-matrix";

const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
assert.match(dash, /data && isEtfOrFund\(data\) \? \(/, "ETF branch before the sections branch");
assert.ok(dash.indexOf("data && isEtfOrFund(data) ? (") < dash.indexOf("<ExecSummaryCard data={data}"), "note replaces the sections");
assert.match(dash, /ETF\/Index – nicht im Aktien-Dashboard/);
// PDF-Button liegt direkt im ETF-Gate: Gate → <button … data-testid="button-pdf-export"> ohne dazwischen geschlossenes Element/Gate
// (unabhängig von der Länge des onClick-Blocks).
const gate = dash.search(/\{data && !isEtfOrFund\(data\) && \(\s*<button/), pdfBtn = dash.indexOf('data-testid="button-pdf-export"');
assert.ok(gate >= 0 && pdfBtn > gate, "PDF button hidden for ETFs");
assert.equal(dash.split('data-testid="button-pdf-export"').length, 2, "genau ein PDF-Button");
assert.ok(!/<\/button>|\n\s*\)\}/.test(dash.slice(gate, pdfBtn)), "PDF-Button ist der Button direkt im ETF-Gate");
assert.match(dash, /disabled=\{!data \|\| isEtfOrFund\(data\)\}/, "section nav disabled for ETFs");

// Live flags (FMP profile via analyze): SPY/QQQ isEtf true, MSFT false
assert.equal(isEtfOrFund({ isEtf: true, isFund: false }), true);
assert.equal(isEtfOrFund({ isEtf: false, isFund: true }), true);
assert.equal(isEtfOrFund({ isEtf: false, isFund: false }), false);
assert.equal(isEtfOrFund({}), false, "old cache entry without flags → stock path (n/a safety net from #222/#231 stays)");

const app = express(); app.use(express.json({ limit: "5mb" })); registerPdfExportRoute(app);
const srv = app.listen(0); const port = (srv.address() as any).port;
try {
  for (const t of ["SPY", "QQQ"]) {
    const r = await fetch(`http://127.0.0.1:${port}/api/export-pdf`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: t, isEtf: true, isFund: false }) });
    assert.equal(r.status, 422); const j = await r.json();
    assert.equal(j.errorCode, "ETF_NOT_SUPPORTED"); assert.match(j.error, /ETF\/Index/);
  }
  const f = await fetch(`http://127.0.0.1:${port}/api/export-pdf`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: "VFIAX", isFund: true }) });
  assert.equal(f.status, 422);
  const n = await fetch(`http://127.0.0.1:${port}/api/export-pdf`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(n.status, 400);
} finally { srv.close(); }
console.log("test-etf-block-dashboard: OK");
