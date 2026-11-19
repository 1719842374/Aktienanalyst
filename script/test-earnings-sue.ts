/**
 * Stufe 2: SUE und feste Totzone. Vorzeichen aus Ist − Konsens.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-earnings-sue.ts
 */
import assert from "node:assert/strict";
import { EARNINGS_LAMP_CONFIG, buildEarningsMarkers, type EarningsRaw } from "../shared/earnings-markers.ts";

const row = (
  date: string,
  revenueActual: number | null,
  revenueEstimate: number | null,
  epsActual: number | null = 1,
  epsEstimate: number | null = 1,
): EarningsRaw => ({ date, revenueActual, revenueEstimate, epsActual, epsEstimate });

const saved = { mode: EARNINGS_LAMP_CONFIG.mode, colorConsensus: EARNINGS_LAMP_CONFIG.colorConsensus };
try {
  EARNINGS_LAMP_CONFIG.mode = "sue";
  const sue = buildEarningsMarkers([
    ["2024-01-31", -3], ["2024-02-29", -2], ["2024-03-31", -1], ["2024-04-30", 0],
    ["2024-05-31", 0], ["2024-06-30", 1], ["2024-07-31", 2], ["2024-08-31", 3],
  ].map(([date, delta]) => row(String(date), 1 + Number(delta), 1)));
  const byDate = Object.fromEntries(sue.markers.map(marker => [marker.date, marker]));
  assert.equal(byDate["2024-08-31"].revenueLamp, "beat");
  assert.ok((byDate["2024-08-31"].revenueSue ?? 0) > EARNINGS_LAMP_CONFIG.sueGreenAbove);
  assert.equal(byDate["2024-01-31"].revenueLamp, "miss");
  assert.ok((byDate["2024-01-31"].revenueSue ?? 0) < EARNINGS_LAMP_CONFIG.sueRedBelow);
  assert.equal(byDate["2024-06-30"].revenueLamp, "inline");
  assert.equal(byDate["2024-08-31"].revenueLamp === byDate["2024-08-31"].epsLamp || byDate["2024-08-31"].epsLamp !== byDate["2024-08-31"].revenueLamp, true);
  assert.notEqual(byDate["2024-08-31"].kind, "mixed");

  EARNINGS_LAMP_CONFIG.mode = "fixed";
  const few = buildEarningsMarkers([
    row("2024-03-31", 103, 100, 1.06, 1),
    row("2024-06-30", 101, 100, 1.04, 1),
  ]);
  assert.equal(few.markers[0].revenueLamp, "beat");
  assert.equal(few.markers[0].epsLamp, "beat");
  assert.equal(few.markers[1].revenueLamp, "inline");
  assert.equal(few.markers[1].epsLamp, "inline");
  assert.equal(few.markers[0].revenueSue, null);

  const negative = buildEarningsMarkers([row("2024-03-31", 100, 100, -0.5, -1)]);
  assert.ok(-0.5 - -1 > 0);
  assert.equal(negative.markers[0].epsLamp, "beat");
  assert.ok((negative.markers[0].epsSurprisePct ?? 0) > 0);

  const missing = buildEarningsMarkers([row("2024-03-31", 80, null, null, 1.2)]);
  assert.equal(missing.markers[0].revenueLamp, "na");
  assert.equal(missing.markers[0].epsLamp, "na");
  assert.equal(missing.markers[0].revenueShown, "kein Konsens");
  assert.equal(missing.markers[0].kind, null);

  const dollars = buildEarningsMarkers([row("2024-03-31", 0.08, 0.02, 1, 1)]);
  assert.match(dollars.markers[0].revenueShown, /\$/);
  assert.doesNotMatch(dollars.markers[0].revenueShown, /%/);

  assert.equal(typeof EARNINGS_LAMP_CONFIG.colorConsensus, "boolean");
} finally {
  EARNINGS_LAMP_CONFIG.mode = saved.mode;
  EARNINGS_LAMP_CONFIG.colorConsensus = saved.colorConsensus;
}

console.log("earnings sue: OK");
