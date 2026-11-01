/**
 * Chart-Overlays: Earnings Beat/Miss. Peer-Linien bleiben die Schnittstelle von PR #380.
 * Der Szenario-Kegel (#359) bleibt die bestehende Return-Zeile.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-chart-overlays.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { buildEarningsMarkers, attachEarningsToPoints } = await import("../shared/earnings-markers.ts");
const { ampelBadge, conditionCount, paintAmpelClose, TA_PROTOCOL_SIZE } = await import("../shared/ta-ampel.ts");

const thin = buildEarningsMarkers([
  { date: "2024-01-01", revenueActual: 10, revenueEstimate: 9, epsActual: null, epsEstimate: null },
]);
assert.equal(thin.markers[0].kind, null);
assert.match(thin.beatRateLabel, /n\/a/);

const marks = buildEarningsMarkers([
  { date: "2024-01-01", revenueActual: 100, revenueEstimate: 100, epsActual: 1, epsEstimate: 1 },
  { date: "2024-04-01", revenueActual: 105, revenueEstimate: 100, epsActual: 1, epsEstimate: 1 },
  { date: "2024-07-01", revenueActual: 140, revenueEstimate: 100, epsActual: 1, epsEstimate: 1 },
  { date: "2024-10-01", revenueActual: 60, revenueEstimate: 100, epsActual: 1, epsEstimate: 1 },
]);
assert.ok(marks.markers.some(m => m.kind === "beat"));
assert.ok(marks.markers.some(m => m.kind === "miss"));
const points = [{ date: "2024-01-02", close: 10 }, { date: "2024-07-02", close: 12 }];
const same = attachEarningsToPoints(points, null);
assert.equal(same, points);
const dotted = attachEarningsToPoints(points, marks.markers);
assert.equal(dotted[0].close, 10);
assert.ok((dotted[1] as { _earnKind?: string })._earnKind);

const ui = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
assert.match(ui, /return cone \? attachConeSeries\(base, cone\) : base/);
assert.match(ui, /data-testid="button-scenario-cone"/);
assert.match(ui, /data-testid="button-earnings"/);
assert.match(ui, /data-testid="chart-ampel-label"/);
assert.match(ui, /Anti-Bias Protokoll/);
assert.match(ui, /data-testid="button-dividend"/);
assert.match(ui, /data-testid="button-real10y"/);
assert.equal(ampelBadge(TA_PROTOCOL_SIZE).text, "Starkes Kaufsignal");
assert.equal(ampelBadge(TA_PROTOCOL_SIZE - 1).tone, "yellow");
const partial = conditionCount({ close: 10, ma200: 9 }, null);
assert.equal(partial.complete, false);
assert.match(partial.reason ?? "", /n\/a/);
const row = { close: 12, ma200: 10, ma50: 11, macd: 0.2 };
const ready = conditionCount(row, 0.1);
assert.equal(ready.complete, true);
assert.equal(ready.met, TA_PROTOCOL_SIZE);
const painted = paintAmpelClose([
  { close: 8, ma200: 10, ma50: 9, macd: -0.2 },
  row,
]);
assert.equal(painted[0]._ampel, "red");
assert.equal(painted[1]._closeGreen, 12);
assert.equal(painted[0]._closeGreen, null);
assert.match(ui, /Keine zweite Peer-Linie/);
assert.match(ui, /button-fund-peer/);
assert.doesNotMatch(ui, /data-testid="button-peers"/);
assert.doesNotMatch(ui, /dataKey="_peerPx"/);
assert.doesNotMatch(ui, /analyze-route/);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");

console.log("chart overlays: OK");
