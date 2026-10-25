/**
 * Konfliktmatrix für BTC, Gold und Rezession (Future_Work §8). Nur Darstellung.
 * Stubs: Gold und Rezession aus Live-Antworten (https://aktienanalyst.onrender.com/api/analyze-gold und
 * POST /api/analyze-recession, 25.10.2026, auf die gelesenen Felder gekürzt); BTC aus BTC_FALLBACK_DATA.
 * Prüft außerdem, dass die Aktien-Matrix (ConflictMatrixPanel ohne note) unverändert rendert.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-asset-conflict-matrix.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { btcConflictMatrix, goldConflictMatrix, recessionConflictMatrix, recessionProbSignal, ASSET_CONFLICT_NOTE } from "../shared/asset-conflict-matrix";
import { buildConflictMatrix } from "../shared/conflict-matrix";
import { BTC_FALLBACK_DATA } from "../client/src/lib/btcFallbackData";
import { ConflictMatrixPanel } from "../client/src/components/sections/ConflictMatrixPanel";
import { AssetConflictSummary } from "../client/src/components/sections/AssetConflictSummary";

(globalThis as any).React = React;
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/asset-conflict/${name}`, import.meta.url), "utf8"));
const sig = (m: { cells: { id: string; signal: string }[] }) => Object.fromEntries(m.cells.map(c => [c.id, c.signal]));

// BTC (Fallback-Daten): GIS 0.2, Power 0.5, Zyklus −0.3, Technik 0/4, F&G 13 (Extreme Fear → konträr positiv)
const btc = btcConflictMatrix(BTC_FALLBACK_DATA as any);
assert.equal(btc.cells.length, 5);
assert.deepEqual(sig(btc), { gis: "positiv", powerLaw: "positiv", cycle: "negativ", technical: "negativ", sentiment: "positiv" });
assert.equal(btc.divergent, true);
assert.equal(btc.cells.find(c => c.id === "sentiment")!.value, "13 (Extreme Fear)");

// Gold (live 25.10.2026): GIS 0.50, adaptiv −0.10, FV −4.2 % im Band, Regime stress, Technik +1
const gold = goldConflictMatrix(fixture("gold-live.json"));
assert.deepEqual(sig(gold), { gis: "positiv", adaptive: "negativ", realYieldFv: "neutral", regime: "negativ", technical: "positiv" });
assert.equal(gold.cells.find(c => c.id === "realYieldFv")!.value, "-4.2% · im Band");
assert.equal(gold.divergent, true);

// Rezession (live 25.10.2026): 40 / 40 / 30 / 50 / 80 %
const rec = recessionConflictMatrix(fixture("recession-live.json").subgroups);
assert.deepEqual(sig(rec), { recession_coincident: "neutral", recession_leading: "neutral", recession_full: "neutral", correction_sentiment: "negativ", correction_full: "negativ" });
assert.equal(rec.summary, "Gleichgerichtet negativ (2/5).");
assert.equal(recessionProbSignal(29), "positiv"); assert.equal(recessionProbSignal(NaN), "n/a");

// Fehlende Werte → n/a, nichts erfunden, n/a zählt nicht
for (const m of [btcConflictMatrix(null), goldConflictMatrix({}), recessionConflictMatrix([])]) {
  assert.equal(m.cells.length, 5);
  assert.ok(m.cells.every(c => c.signal === "n/a" && c.value === "n/a"), JSON.stringify(m.cells));
  assert.equal(m.positives + m.negatives, 0); assert.equal(m.summary, "Kein klares Signal.");
}
const partialGold = goldConflictMatrix({ gis: -0.1, realYieldModel: null, adaptiveScore: { score: null } });
assert.deepEqual(sig(partialGold), { gis: "negativ", adaptive: "n/a", realYieldFv: "n/a", regime: "n/a", technical: "n/a" });

// Aktie unverändert: gleiche Zusammenfassung, gleicher Fußtext
const stock = buildConflictMatrix({ qualityScore: 80, marginDeltaYoYPp: 1, relativeGrowthDeltaYoYPp: 2, reverseDcfRating: "realistic", impliedGrowth: 3, technical: { priceAboveMA200: true, ma50AboveMA200: true, macdAboveZero: true, macdRising: true }, catalystUpsidePct: 15 });
assert.equal(stock.summary, "Gleichgerichtet positiv (5/5).");
const stockHtml = renderToStaticMarkup(React.createElement(ConflictMatrixPanel, { matrix: stock }));
assert.ok(stockHtml.includes("Nur Darstellung: fünf Dimensionen nebeneinander, Divergenz explizit. Rating und Score im Fazit unverändert. n/a zählt nicht."));
for (const id of ["quality", "trend", "reverseDcf", "technical", "catalysts"]) assert.ok(stockHtml.includes(`data-testid="conflict-cell-${id}"`));

// Asset-Render: Matrix + Detail-Tabelle mit fünf Zeilen
const goldHtml = renderToStaticMarkup(React.createElement(AssetConflictSummary, { matrix: gold }));
assert.ok(goldHtml.includes(ASSET_CONFLICT_NOTE));
assert.ok(goldHtml.includes('data-testid="asset-conflict-table"'));
assert.equal((goldHtml.match(/<tr>/g) ?? []).length, 5);

console.log("asset conflict matrix: OK");
