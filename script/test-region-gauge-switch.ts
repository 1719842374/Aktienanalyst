/**
 * Offen_FUTURE_SOLL_IST PR 6 — region buttons read catalog P, US default, no new score.
 * Run: npx tsx script/test-region-gauge-switch.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { regionGaugeView, type RegionSlot, type RegionalCatalogs } from "../shared/recession-regions";

const slot = (name: string, available: boolean, ws: number): RegionSlot => ({
  id: "curve", name, book: "recession", value: available ? "1" : "N/A", rawScore: ws, weight: 1,
  weightedScore: available ? ws : 0, maxWeighted: available ? 4 : 0, zone: "z", source: "s", available,
});
const catalogs: RegionalCatalogs = {
  weights: { US: 0.7, EZ: 0.2, JP: 0.1 },
  regions: [
    { id: "US", label: "USA", weight: 0.7, slots: [slot("a", true, 2)], recessionProbability: 60, correctionProbability: 55 },
    { id: "EZ", label: "Eurozone", weight: 0.2, slots: [slot("k", true, 3), slot("l", true, -4), slot("m", true, 1), slot("n", true, 0)], recessionProbability: 50, correctionProbability: 45 },
    { id: "JP", label: "Japan", weight: 0.1, slots: [slot("x", true, 2), slot("y", false, 0), slot("z", false, 0)], recessionProbability: 75, correctionProbability: null },
  ],
  blendedRecession12m: 60, blendedCorrection12m: 50, actionUsesUsBooks: true,
};

const ez = regionGaugeView(catalogs, "EZ")!;
assert.equal(ez.recessionProbability, 50);
assert.equal(ez.correctionProbability, 45);
assert.equal(ez.scoredSlots, 4);
assert.equal(ez.sparse, false);
assert.deepEqual(ez.topDrivers.map(s => s.name), ["l", "k", "m"], "Top-3 by |score|, zero dropped");

const jp = regionGaugeView(catalogs, "JP")!;
assert.equal(jp.sparse, true, "2 of 3 N/A → hint");
assert.equal(jp.correctionProbability, null, "N/A stays N/A, nothing invented");
assert.deepEqual(jp.topDrivers.map(s => s.name), ["x"]);

assert.equal(regionGaugeView(null, "EZ"), null);
assert.equal(regionGaugeView({ ...catalogs, regions: [] }, "EZ"), null);
// catalog object is not mutated (blend untouched)
assert.equal(catalogs.blendedRecession12m, 60);
assert.deepEqual(catalogs.regions[1].slots.map(s => s.name), ["k", "l", "m", "n"]);

const ui = readFileSync("client/src/components/recession/RegionGaugeSwitch.tsx", "utf8");
assert.match(ui, /useState<RegionId>\("US"\)/, "US is default");
assert.match(ui, /<CurrentAssessment data=\{data\} \/>/, "US keeps the five live gauges");
assert.match(ui, /Handlung bleibt auf den US-Büchern/);
const page = readFileSync("client/src/pages/RecessionDashboard.tsx", "utf8");
assert.match(page, /<RegionGaugeSwitch data=\{data\} regions=\{regions\} \/>/);
console.log("test-region-gauge-switch: OK");
