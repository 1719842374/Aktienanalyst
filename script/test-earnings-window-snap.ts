/**
 * Earnings-Marker nur im Chartfenster. Grenze = erster und letzter Balken.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-earnings-window-snap.ts
 */
import assert from "node:assert/strict";

const { snapEarningsToBar, attachEarningsToPoints, beatRateLabelForWindow } = await import("../shared/earnings-markers.ts");

const week = ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12"];

assert.equal(snapEarningsToBar(week, "2024-01-08"), "2024-01-08", "Event am ersten Balken bleibt");
assert.equal(snapEarningsToBar(week, "2024-01-07"), null, "Event einen Tag vor dem ersten Balken verworfen");
assert.equal(snapEarningsToBar(week, "2024-01-12"), "2024-01-12", "Event am letzten Balken bleibt");
assert.equal(snapEarningsToBar(week, "2024-01-13"), null, "Event nach dem letzten Balken verworfen");
assert.equal(snapEarningsToBar(week, "2024-01-13"), null, "Samstag direkt nach dem letzten Balken verworfen");
assert.equal(snapEarningsToBar(week, "2024-01-14"), null, "Sonntag direkt nach dem letzten Balken verworfen");

const withGap = ["2024-01-05", "2024-01-08", "2024-01-09"];
assert.equal(snapEarningsToBar(withGap, "2024-01-06"), "2024-01-08", "Samstag im Fenster auf den nächsten Handelstag");
assert.equal(snapEarningsToBar(withGap, "2024-01-07"), "2024-01-08", "Sonntag im Fenster auf den nächsten Handelstag");

const marker = (date: string, kind: "beat" | "miss") => ({
  date,
  kind,
  reason: null,
  basis: "revenue" as const,
  revenueActual: kind === "beat" ? 110 : 80,
  revenueEstimate: 100,
  revenueSurprisePct: kind === "beat" ? 10 : -20,
  epsActual: null,
  epsEstimate: null,
  epsSurprisePct: null,
});

const points = week.map(date => ({ date, close: 10 }));
const before = attachEarningsToPoints(points, [marker("2024-01-07", "miss")]);
assert.equal((before[0] as { _earnKind?: string })._earnKind, undefined, "Vorfenster-Event liegt nicht auf dem ersten Balken");
const onFirst = attachEarningsToPoints(points, [marker("2024-01-08", "beat")]);
assert.equal((onFirst[0] as { _earnKind?: string })._earnKind, "beat");

const label = beatRateLabelForWindow(
  [marker("2020-09-30", "miss"), marker("2024-01-08", "beat"), marker("2024-01-15", "beat")],
  week,
);
assert.equal(label, "Revenue Beat 1/1 (100 %)");

console.log("earnings window snap: OK");
