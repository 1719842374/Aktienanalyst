/**
 * SUE und feste Totzone. Vorzeichen aus Ist − Konsens.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-earnings-sue.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EARNINGS_LAMP_CONFIG, buildEarningsMarkers, type EarningsRaw } from "../shared/earnings-markers.ts";
import { buildEarningsAmpel } from "../shared/earnings-ampel.ts";
import { EarningsAmpelView } from "../client/src/components/sections/EarningsAmpelBlock.tsx";

(globalThis as { React?: typeof React }).React = React;

const row = (date: string, actual: number | null, estimate: number | null, epsActual: number | null = 1, epsEstimate: number | null = 1): EarningsRaw => ({
  date,
  revenueActual: actual,
  revenueEstimate: estimate,
  epsActual,
  epsEstimate,
});

const savedMode = EARNINGS_LAMP_CONFIG.mode;
const savedConsensus = EARNINGS_LAMP_CONFIG.colorConsensus;
try {
  EARNINGS_LAMP_CONFIG.mode = "sue";
  const sueRows: EarningsRaw[] = [
    ["2024-01-31", -3], ["2024-02-29", -2], ["2024-03-31", -1], ["2024-04-30", 0],
    ["2024-05-31", 0], ["2024-06-30", 1], ["2024-07-31", 2], ["2024-08-31", 3],
  ].map(([date, delta]) => row(String(date), 1 + Number(delta), 1));
  const sue = buildEarningsMarkers(sueRows);
  const byDate = Object.fromEntries(sue.markers.map(marker => [marker.date, marker]));
  assert.equal(byDate["2024-08-31"].revenueLamp, "beat");
  assert.ok((byDate["2024-08-31"].revenueSue ?? 0) > 1);
  assert.equal(byDate["2024-01-31"].revenueLamp, "miss");
  assert.ok((byDate["2024-01-31"].revenueSue ?? 0) < -1);
  assert.equal(byDate["2024-06-30"].revenueLamp, "inline");
  assert.equal(byDate["2024-08-31"].kind, "beat");

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

  const negative = buildEarningsMarkers([
    row("2024-03-31", 100, 100, -0.5, -1),
  ]);
  assert.ok((-0.5 - -1) > 0);
  assert.equal(negative.markers[0].epsLamp, "beat");
  assert.equal(negative.markers[0].epsSurprisePct != null && negative.markers[0].epsSurprisePct > 0, true);

  const missing = buildEarningsMarkers([
    row("2024-03-31", 80, null, null, 1.2),
  ]);
  assert.equal(missing.markers[0].revenueLamp, "na");
  assert.equal(missing.markers[0].epsLamp, "na");
  assert.equal(missing.markers[0].revenueShown, "kein Konsens");
  assert.equal(missing.markers[0].kind, null);

  const dollars = buildEarningsMarkers([
    row("2024-03-31", 0.08, 0.02, 1, 1),
  ]);
  assert.match(dollars.markers[0].revenueShown, /\$/);
  assert.doesNotMatch(dollars.markers[0].revenueShown, /%/);

  const model = buildEarningsAmpel(dollars.markers);
  EARNINGS_LAMP_CONFIG.colorConsensus = true;
  const colored = renderToStaticMarkup(React.createElement(EarningsAmpelView, { model: buildEarningsAmpel(buildEarningsMarkers([row("2024-03-31", 110, 100, 1.2, 1)]).markers) }));
  assert.match(colored, /data-ampel-cell="revenue-estimate"[^>]*data-lamp="beat"/);
  EARNINGS_LAMP_CONFIG.colorConsensus = false;
  const plain = renderToStaticMarkup(React.createElement(EarningsAmpelView, { model: buildEarningsAmpel(buildEarningsMarkers([row("2024-03-31", 110, 100, 1.2, 1)]).markers) }));
  assert.match(plain, /data-ampel-cell="revenue-estimate"[^>]*data-lamp="na"/);
  assert.match(plain, /data-ampel-cell="revenue-actual"[^>]*data-lamp="beat"/);
  assert.doesNotMatch(model.quarters[0]?.revenue.shown ?? "", /%/);
} finally {
  EARNINGS_LAMP_CONFIG.mode = savedMode;
  EARNINGS_LAMP_CONFIG.colorConsensus = savedConsensus;
}

console.log("earnings sue: OK");
