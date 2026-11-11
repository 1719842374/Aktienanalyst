/**
 * Earnings-Ampel: zwei Lampen und eine Zeile je Quartal.
 * Schwellen stehen nur in EARNINGS_AMPEL_THRESHOLDS.
 * buildEarningsMarkers (Median-Band, eine Basis) bleibt die Chart-Klassifikation.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-earnings-ampel.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildEarningsMarkers, type EarningsMarker } from "../shared/earnings-markers.ts";
import {
  EARNINGS_AMPEL_THRESHOLDS,
  buildEarningsAmpel,
  classifyEarningsSurprise,
} from "../shared/earnings-ampel.ts";
import { EarningsAmpelView } from "../client/src/components/sections/EarningsAmpelBlock.tsx";

(globalThis as { React?: typeof React }).React = React;

const T = EARNINGS_AMPEL_THRESHOLDS;
assert.equal(T.epsBeatPct, 5);
assert.equal(T.epsMissPct, -5);
assert.equal(T.revenueBeatPct, 2);
assert.equal(T.revenueMissPct, -2);
assert.equal(T.inlineColor, "#eab308");

function marker(partial: Partial<EarningsMarker> & Pick<EarningsMarker, "date">): EarningsMarker {
  return {
    kind: null,
    reason: null,
    basis: null,
    revenueActual: null,
    revenueEstimate: null,
    revenueSurprisePct: null,
    epsActual: null,
    epsEstimate: null,
    epsSurprisePct: null,
    ...partial,
  };
}

assert.equal(classifyEarningsSurprise(5, T.epsBeatPct, T.epsMissPct), "beat");
assert.equal(classifyEarningsSurprise(4.999, T.epsBeatPct, T.epsMissPct), "inline");
assert.equal(classifyEarningsSurprise(-5, T.epsBeatPct, T.epsMissPct), "miss");
assert.equal(classifyEarningsSurprise(-4.999, T.epsBeatPct, T.epsMissPct), "inline");
assert.equal(classifyEarningsSurprise(0, T.epsBeatPct, T.epsMissPct), "inline");
assert.equal(classifyEarningsSurprise(2, T.revenueBeatPct, T.revenueMissPct), "beat");
assert.equal(classifyEarningsSurprise(1.999, T.revenueBeatPct, T.revenueMissPct), "inline");
assert.equal(classifyEarningsSurprise(-2, T.revenueBeatPct, T.revenueMissPct), "miss");
assert.equal(classifyEarningsSurprise(-1.999, T.revenueBeatPct, T.revenueMissPct), "inline");
assert.equal(classifyEarningsSurprise(null, T.epsBeatPct, T.epsMissPct), "na");

const bounds = buildEarningsAmpel([
  marker({ date: "2024-03-31", epsActual: 1.05, epsEstimate: 1, epsSurprisePct: 5, revenueActual: 102, revenueEstimate: 100, revenueSurprisePct: 2 }),
  marker({ date: "2024-06-30", epsActual: 1, epsEstimate: 1, epsSurprisePct: 4.999, revenueActual: 100, revenueEstimate: 100, revenueSurprisePct: 1.999 }),
  marker({ date: "2024-09-30", epsActual: 0.95, epsEstimate: 1, epsSurprisePct: -5, revenueActual: 98, revenueEstimate: 100, revenueSurprisePct: -2 }),
  marker({ date: "2024-12-31", epsActual: 1, epsEstimate: 1, epsSurprisePct: -4.999, revenueActual: 100, revenueEstimate: 100, revenueSurprisePct: -1.999 }),
]);
const byDate = Object.fromEntries(bounds.quarters.map(q => [q.date, q]));
assert.equal(byDate["2024-03-31"].eps.lamp, "beat");
assert.equal(byDate["2024-03-31"].revenue.lamp, "beat");
assert.equal(byDate["2024-06-30"].eps.lamp, "inline");
assert.equal(byDate["2024-06-30"].revenue.lamp, "inline");
assert.equal(byDate["2024-09-30"].eps.lamp, "miss");
assert.equal(byDate["2024-09-30"].revenue.lamp, "miss");
assert.equal(byDate["2024-12-31"].eps.lamp, "inline");
assert.equal(byDate["2024-12-31"].revenue.lamp, "inline");
assert.equal(bounds.latest?.date, "2024-12-31");
assert.equal(bounds.quarters.map(q => q.date).join(","), "2024-12-31,2024-09-30,2024-06-30,2024-03-31");

const missingEps = buildEarningsAmpel([
  marker({
    date: "2024-09-30",
    epsActual: null,
    epsEstimate: 1.2,
    epsSurprisePct: null,
    revenueActual: null,
    revenueEstimate: 50,
    revenueSurprisePct: null,
  }),
]);
assert.equal(missingEps.latest?.eps.lamp, "na");
assert.equal(missingEps.latest?.eps.surprisePct, null);
assert.equal(missingEps.latest?.eps.actual, null);
assert.match(missingEps.latest?.eps.reason ?? "", /n\/a — EPS-Ist fehlt/);
assert.equal(missingEps.latest?.revenue.lamp, "na");
assert.match(missingEps.latest?.revenue.reason ?? "", /n\/a — Umsatz-Ist fehlt/);

const zeroEstimate = buildEarningsAmpel([
  marker({ date: "2024-09-30", epsActual: 1, epsEstimate: 0, epsSurprisePct: null, revenueActual: 10, revenueEstimate: 0, revenueSurprisePct: null }),
]);
assert.equal(zeroEstimate.latest?.eps.lamp, "na");
assert.match(zeroEstimate.latest?.eps.reason ?? "", /Schätzung fehlt oder ist 0/);
assert.match(zeroEstimate.latest?.revenue.reason ?? "", /Schätzung fehlt oder ist 0/);
assert.equal(zeroEstimate.latest?.eps.surprisePct, null);

const empty = buildEarningsAmpel([]);
assert.equal(empty.latest, null);
assert.equal(empty.quarters.length, 0);

const chartRows = buildEarningsMarkers([
  { date: "2024-03-31", revenueActual: 103, revenueEstimate: 100, epsActual: 1.06, epsEstimate: 1 },
  { date: "2024-06-30", revenueActual: 103, revenueEstimate: 100, epsActual: 1.06, epsEstimate: 1 },
]);
assert.equal(chartRows.markers[0].basis, "revenue");
assert.equal(chartRows.markers[0].kind, "inline");
assert.equal(chartRows.inlineBandPct, 3);
const lamps = buildEarningsAmpel(chartRows.markers);
assert.equal(lamps.quarters.every(q => q.revenue.lamp === "beat" && q.eps.lamp === "beat"), true);
assert.equal(lamps.quarters[0].revenue.surprisePct, chartRows.markers.find(m => m.date === lamps.quarters[0].date)?.revenueSurprisePct);

const shown = buildEarningsAmpel([
  marker({
    date: "2024-06-30",
    epsActual: 1,
    epsEstimate: 1,
    epsSurprisePct: 0,
    revenueActual: 100,
    revenueEstimate: 100,
    revenueSurprisePct: 0,
    kind: "inline",
    basis: "revenue",
  }),
  marker({
    date: "2024-09-30",
    epsActual: null,
    epsEstimate: 1.2,
    epsSurprisePct: null,
    revenueActual: 80,
    revenueEstimate: null,
    revenueSurprisePct: null,
    kind: null,
    reason: "n/a — Schätzung fehlt oder ist 0, keine Surprise",
    basis: null,
  }),
]);
const html = renderToStaticMarkup(React.createElement(EarningsAmpelView, { model: shown }));
assert.match(html, /data-testid="earnings-ampel"/);
assert.match(html, /data-testid="earnings-ampel-eps"/);
assert.match(html, /data-testid="earnings-ampel-revenue"/);
assert.match(html, /data-lamp="na"/);
assert.match(html, /n\/a — EPS-Ist fehlt/);
assert.match(html, /#eab308/);
assert.equal((html.match(/data-testid="earnings-ampel-row"/g) ?? []).length, 2);
assert.match(html, /EPS Beat ab \+5 %/);
assert.match(html, /Miss ab −5 %/);
assert.match(html, /Umsatz Beat ab \+2 %/);
assert.match(html, /Miss ab −2 %/);
const naRow = html.split('data-testid="earnings-ampel-row"')[1] ?? "";
assert.match(naRow, /n\/a — EPS-Ist fehlt/);
assert.doesNotMatch(naRow, /0,00 %/);

const emptyHtml = renderToStaticMarkup(React.createElement(EarningsAmpelView, { model: empty, notice: "n/a — keine Quartale" }));
assert.match(emptyHtml, /n\/a — keine Quartale/);
assert.equal((emptyHtml.match(/data-testid="earnings-ampel-row"/g) ?? []).length, 0);
assert.doesNotMatch(emptyHtml, /data-lamp="beat"|data-lamp="miss"|data-lamp="inline"/);

const hook = readFileSync("client/src/hooks/useEarningsMarkers.ts", "utf8");
assert.match(hook, /from "@\/lib\/queryClient"/);
assert.match(hook, /apiRequest\(\s*"GET",\s*`\/api\/earnings-markers\//);
assert.match(hook, /\["earnings-markers", ticker\]/);
const block = readFileSync("client/src/components/sections/EarningsAmpelBlock.tsx", "utf8");
assert.match(block, /useEarningsMarkers/);
assert.match(block, /buildEarningsAmpel/);
const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
assert.match(dash, /<EarningsAmpelBlock ticker=\{data\.ticker\} \/>/);
const route = readFileSync("server/earnings-markers-route.ts", "utf8");
assert.match(route, /buildEarningsMarkers/);
assert.doesNotMatch(route, /EARNINGS_AMPEL_THRESHOLDS/);
const classifier = readFileSync("shared/earnings-markers.ts", "utf8");
assert.match(classifier, /median\(sample\.map/);
assert.doesNotMatch(classifier, /epsBeatPct|revenueBeatPct/);

console.log("earnings ampel: OK");
