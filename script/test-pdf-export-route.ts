/** JOB 9: POST /api/export-pdf must be registered and return a real PDF. Run: npx tsx script/test-pdf-export-route.ts [fixture.json] */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerPdfExportRoute } from "../server/pdf-export-route";

// Wiring: the route is registered from routes-register.ts (server/index.ts entry), not only mentioned in a comment
const reg = readFileSync("server/routes-register.ts", "utf8");
assert.match(reg, /import\("\.\/pdf-export-route"\)/);
assert.match(reg, /registerPdfExportRoute\(app\)/);
assert.match(readFileSync("server/pdf-export-route.ts", "utf8"), /app\.post\("\/api\/export-pdf"/);

const app = express();
app.use(express.json({ limit: "10mb" }));
registerPdfExportRoute(app);
app.use((_req, res) => res.status(200).type("html").send("<!DOCTYPE html><html>SPA</html>")); // like the SPA catch-all
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

try {
  const bad = await fetch(`${base}/api/export-pdf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(bad.status, 400);
  assert.match(bad.headers.get("content-type") || "", /json/);

  const fixturePath = process.argv[2];
  const data = fixturePath && existsSync(fixturePath)
    ? JSON.parse(readFileSync(fixturePath, "utf8"))
    : { ticker: "FIX", companyName: "Fixture Inc", currentPrice: 100, sector: "Technology", industry: "Software", historicalPrices: [] };
  const r = await fetch(`${base}/api/export-pdf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const buf = Buffer.from(await r.arrayBuffer());
  if (r.status === 500 && /Executable doesn't exist|browserType\.launch/.test(buf.toString())) {
    console.log("SKIP render: no Chromium on this machine —", buf.toString().slice(0, 160));
  } else {
    assert.equal(r.status, 200, buf.toString().slice(0, 200));
    assert.equal(r.headers.get("content-type"), "application/pdf");
    assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
    assert.match(r.headers.get("content-disposition") || "", new RegExp(`${data.ticker}_Analyse_\\d{4}-\\d{2}-\\d{2}\\.pdf`));
    console.log(`PDF ${data.ticker}: ${buf.length} bytes, header ${buf.subarray(0, 8).toString()}`);
  }
} finally {
  server.close();
}
console.log("test-pdf-export-route: OK");
