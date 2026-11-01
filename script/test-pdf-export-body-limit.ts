/** #226: /api/export-pdf receives the full StockAnalysis (largest cached one in git ≈ 0.99 MB, MSFT + 6 peers).
 *  Guards the global express.json limit in server/index.ts (10mb) against falling back toward the 100kb default.
 *  Run: npx tsx script/test-pdf-export-body-limit.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";

const src = readFileSync("server/index.ts", "utf8");
const m = src.match(/express\.json\(\{\s*limit:\s*'(\d+)mb'/);
assert.ok(m, "global express.json limit is set explicitly in server/index.ts");
const limitMb = Number(m![1]);
assert.ok(limitMb >= 5, `limit ${limitMb}mb must leave ≥5× headroom over a ~1 MB analysis`);
assert.equal((src.match(/express\.json\(/g) || []).length, 1, "only one JSON parser (no stricter one in front)");

// Same parser config, a 3 MB analysis-shaped payload (≈3× the largest real one) must be accepted, >limit rejected with 413
const app = express();
app.use(express.json({ limit: `${limitMb}mb` }));
app.post("/api/export-pdf", (req, res) => res.json({ ok: true, points: req.body.historicalPrices.length }));
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ message: err.message }));
const server = app.listen(0);
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/export-pdf`;
try {
  const hp = Array.from({ length: 30000 }, (_, i) => ({ date: `2000-01-${String(i % 28 + 1).padStart(2, "0")}`, open: 100.123, high: 101.456, low: 99.789, close: 100.5 + i / 1000, volume: 12345678 }));
  const big = JSON.stringify({ ticker: "BIG", historicalPrices: hp });
  assert.ok(big.length > 2.5e6, `payload ${big.length} bytes`);
  const ok = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: big });
  assert.equal(ok.status, 200);
  const tooBig = JSON.stringify({ ticker: "X", pad: "x".repeat(limitMb * 1024 * 1024 + 1024) });
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: tooBig });
  assert.equal(r.status, 413);
  console.log(`limit ${limitMb}mb · ${(big.length / 1e6).toFixed(2)} MB accepted · ${(tooBig.length / 1e6).toFixed(1)} MB → 413`);
} finally { server.close(); }
console.log("test-pdf-export-body-limit: OK");
