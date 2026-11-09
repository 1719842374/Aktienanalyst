/**
 * Chart-Overlays: Earnings Beat/Miss. Peer-Linien bleiben die Schnittstelle von PR #380.
 * Der Szenario-Kegel (#359) bleibt die bestehende Return-Zeile.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-chart-overlays.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { buildEarningsMarkers, attachEarningsToPoints } = await import("../shared/earnings-markers.ts");

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
assert.ok(marks.markers.some(m => m.kind === "inline"));
assert.equal(marks.markers[1].revenueActual, 105);
assert.equal(marks.markers[1].revenueEstimate, 100);
assert.match(marks.beatRateLabel, /^Revenue Beat \d+\/\d+ \(\d+ %\)$/);
const points = [{ date: "2024-01-02", close: 10 }, { date: "2024-07-02", close: 12 }];
const same = attachEarningsToPoints(points, null);
assert.equal(same, points);
const dotted = attachEarningsToPoints(points, marks.markers);
assert.equal(dotted[0].close, 10);
const july = dotted[1] as { _earnKind?: string; _earnRevActual?: number; _earnRevEst?: number; _earnRev?: number; _earnEps?: number };
assert.equal(july._earnKind, "beat");
assert.equal(july._earnRevActual, 140);
assert.equal(july._earnRevEst, 100);
assert.ok(july._earnRev != null && july._earnRev > 0);
assert.equal(july._earnEps, 0);

const ui = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
assert.match(ui, /return cone \? attachConeSeries\(base, cone\) : base/);
assert.match(ui, /data-testid="button-scenario-cone"/);
assert.match(ui, /data-testid="button-earnings"/);
assert.match(ui, /data-testid="earnings-beat-badge"/);
assert.match(ui, /data-testid="earnings-tooltip"/);
assert.match(ui, /Revenue Actual/);
assert.match(ui, /Revenue Estimate/);
assert.match(ui, /EPS Surprise/);
assert.match(ui, /#22c55e/);
assert.match(ui, /#ef4444/);
assert.match(ui, /#94a3b8/);
assert.doesNotMatch(ui, /paintAmpelClose/);
assert.doesNotMatch(ui, /_closeGreen/);
assert.match(ui, /data-testid="chart-ampel-label"/);
assert.match(ui, /data-testid="button-ampel"/);
assert.match(ui, /data-testid="symmetric-ampel-facts"/);
assert.match(ui, /Anti-Bias Protokoll/);
assert.match(ui, /data-testid="button-dividend"/);
assert.match(ui, /data-testid="button-real10y"/);
assert.match(ui, /button-fund-peer/);
assert.match(ui, /dataKey="_peerPx"/);
assert.doesNotMatch(ui, /data-testid="button-peers"/);
assert.doesNotMatch(ui, /analyze-route/);

const route = readFileSync("server/earnings-markers-route.ts", "utf8");
assert.match(route, /income-statement\+analyst-estimates/);
assert.doesNotMatch(route, /fmpEarningsCalendar/);
const { rowsFromStatements, loadEarningsMarkers } = await import("../server/earnings-markers-route.ts");
const joined = rowsFromStatements(
  [{ date: "2024-03-31", revenue: 100, epsdiluted: 1.5 }],
  [{ date: "2024-06-30", revenueAvg: 1, epsAvg: 1 }, { date: "2024-03-31", revenueAvg: 90, epsAvg: 1.2 }],
);
assert.equal(joined.length, 1);
assert.equal(joined[0].revenueActual, 100);
assert.equal(joined[0].revenueEstimate, 90);
assert.equal(joined[0].epsActual, 1.5);
assert.equal(joined[0].epsEstimate, 1.2);
const unmatched = rowsFromStatements(
  [{ date: "2024-03-31", revenue: 100, eps: 1 }],
  [{ date: "2024-06-30", revenueAvg: 50, epsAvg: 2 }],
);
assert.equal(unmatched[0].revenueEstimate, null);
assert.equal(unmatched[0].epsEstimate, null);
const fallback = await loadEarningsMarkers("MSFT", {
  surprises: async () => [],
  income: async () => [
    { date: "2024-03-31", revenue: 110, epsdiluted: 2 },
    { date: "2024-06-30", revenue: 80, epsdiluted: 1 },
  ],
  estimates: async () => [
    { date: "2024-03-31", revenueAvg: 100, epsAvg: 1.5 },
    { date: "2024-06-30", revenueAvg: 100, epsAvg: 1.5 },
  ],
});
assert.equal(fallback.source, "income-statement+analyst-estimates");
assert.match(fallback.note ?? "", /Periodenende/);
assert.match(fallback.beatRateLabel, /^Revenue Beat \d+\/\d+ \(\d+ %\)$/);
let incomeCalled = false;
const primary = await loadEarningsMarkers("NVDA", {
  surprises: async () => [
    { date: "2024-05-01", revenue: 10, revenueEstimated: 9, actualEarningResult: 1, estimatedEarning: 1 },
    { date: "2024-08-01", revenue: 10, revenueEstimated: 12, actualEarningResult: 1, estimatedEarning: 1 },
  ],
  income: async () => { incomeCalled = true; return []; },
  estimates: async () => { incomeCalled = true; return []; },
});
assert.equal(primary.source, "earnings-surprises");
assert.equal(incomeCalled, false);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");

console.log("chart overlays: OK");
