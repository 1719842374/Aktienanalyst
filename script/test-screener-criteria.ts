/**
 * Custom Criteria auf bereits geladenen Kandidaten.
 * Kein Netz, kein Secret. Der Researcher-POST und GET /api/screener bleiben die Presets.
 *
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-screener-criteria.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAP_NEGATIVE_NOTE,
  CAP_RANGE_NOTE,
  CAP_SCALE_NOTE,
  LOADED_UNIVERSE_NOTE,
  MISSING_COUNTRY,
  MISSING_FORWARD_PE,
  MISSING_INDUSTRY,
  MISSING_MARKET_CAP,
  MISSING_ROIC,
  NON_NUMERIC_NOTE,
  RESEARCHER_MARKET_CAP_USD_PER_MILLION,
  UNDERVALUED_SCREEN_PRESET,
  criteriaFromInputs,
  emptyCriteria,
  emptyDraft,
  projectLoadedScreen,
  rowFromLoadedCandidate,
} from "../shared/custom-screen.ts";

const full = {
  marketCap: 2e9,
  industry: "Software",
  country: "DE",
  roic: 15,
  forwardPe: 12,
};

function draft(over: Partial<ReturnType<typeof emptyDraft>> = {}) {
  return { ...emptyDraft(), ...over };
}

const inactive = projectLoadedScreen(
  [{ ticker: "A", ...full }, { ticker: "B", marketCap: 0, sector: "Banks", pe: 8 }],
  rowFromLoadedCandidate,
  emptyCriteria(),
);
assert.deepEqual(inactive.visible.map((row) => row.ticker), ["A", "B"]);
assert.deepEqual(inactive.skipped, []);

const blank = criteriaFromInputs(draft({
  marketCapMin: "  ",
  marketCapMax: "",
  industry: "   ",
  country: "",
  roicMin: "",
  forwardPeMax: "",
}), 1);
assert.deepEqual(blank.criteria, emptyCriteria());
assert.deepEqual(blank.notes, []);
const blankApplied = projectLoadedScreen(
  [{ ticker: "A", marketCap: null, industry: "", country: null, roic: null, forwardPE: 0 }],
  rowFromLoadedCandidate,
  blank.criteria,
);
assert.equal(blankApplied.visible.length, 1);
assert.deepEqual(blankApplied.skipped, []);

const garbage = criteriaFromInputs(draft({ roicMin: "hoch", forwardPeMax: "n/a" }), 1);
assert.equal(garbage.criteria.roicMin, null);
assert.equal(garbage.criteria.forwardPeMax, null);
assert.deepEqual(garbage.notes, [NON_NUMERIC_NOTE]);
const garbageApplied = projectLoadedScreen(
  [{ ticker: "A", roic: null, forwardPE: 0 }],
  rowFromLoadedCandidate,
  garbage.criteria,
);
assert.equal(garbageApplied.visible.length, 1);

const million = criteriaFromInputs(draft({ marketCapMin: "1000", marketCapMax: "500000" }), RESEARCHER_MARKET_CAP_USD_PER_MILLION);
assert.equal(million.criteria.marketCapMin, 1e9);
assert.equal(million.criteria.marketCapMax, 5e11);
const dollars = criteriaFromInputs(draft({ marketCapMin: "1000000000" }), 1);
assert.equal(dollars.criteria.marketCapMin, 1e9);

const mcap = projectLoadedScreen(
  [
    { ticker: "BIG", marketCap: 2e9 },
    { ticker: "SMALL", marketCap: 5e8 },
    { ticker: "ZERO", marketCap: 0 },
  ],
  rowFromLoadedCandidate,
  dollars.criteria,
);
assert.deepEqual(mcap.visible.map((row) => row.ticker), ["BIG"]);
assert.deepEqual(mcap.skipped, [MISSING_MARKET_CAP]);
assert.equal(rowFromLoadedCandidate({ marketCap: 0 }).marketCap, null);

const industry = projectLoadedScreen(
  [
    { ticker: "SOFT", industry: "Application Software", sector: "Utilities" },
    { ticker: "BANK", industry: "Banks", sector: "Software" },
    { ticker: "SECTOR_ONLY", sector: "Software", pe: 11 },
  ],
  rowFromLoadedCandidate,
  criteriaFromInputs(draft({ industry: "soft" }), 1).criteria,
);
assert.deepEqual(industry.visible.map((row) => row.ticker), ["SOFT"]);
assert.deepEqual(industry.skipped, [MISSING_INDUSTRY]);
assert.equal(rowFromLoadedCandidate({ sector: "Software" }).industry, null);

const country = projectLoadedScreen(
  [
    { ticker: "DE", country: "DE" },
    { ticker: "GER", country: "Germany" },
    { ticker: "US", country: "US" },
    { ticker: "NONE", marketCap: 2e9 },
  ],
  rowFromLoadedCandidate,
  criteriaFromInputs(draft({ country: "de" }), 1).criteria,
);
assert.deepEqual(country.visible.map((row) => row.ticker), ["DE"]);
assert.deepEqual(country.skipped, [MISSING_COUNTRY]);
const countryWord = projectLoadedScreen(
  [{ ticker: "GER", country: "Germany" }, { ticker: "DE", country: "DE" }],
  rowFromLoadedCandidate,
  criteriaFromInputs(draft({ country: "germ" }), 1).criteria,
);
assert.deepEqual(countryWord.visible.map((row) => row.ticker), ["GER"]);

const roicPass = projectLoadedScreen(
  [{ ticker: "ZERO", roic: 0 }, { ticker: "HIGH", roic: 15 }, { ticker: "NEG", roic: -2 }],
  rowFromLoadedCandidate,
  criteriaFromInputs(draft({ roicMin: "0" }), 1).criteria,
);
assert.deepEqual(roicPass.visible.map((row) => row.ticker), ["ZERO", "HIGH"]);
const roicMissing = projectLoadedScreen(
  [{ ticker: "NONE" }, { ticker: "ZERO", roic: 0 }],
  rowFromLoadedCandidate,
  criteriaFromInputs(draft({ roicMin: "10" }), 1).criteria,
);
assert.deepEqual(roicMissing.visible.map((row) => row.ticker), []);
assert.deepEqual(roicMissing.skipped, [MISSING_ROIC]);
assert.equal(rowFromLoadedCandidate({ roic: 0 }).roic, 0);
assert.equal(rowFromLoadedCandidate({}).roic, null);

const forward = projectLoadedScreen(
  [
    { ticker: "CHEAP", forwardPE: 12, pe: 40 },
    { ticker: "RICH", forwardPE: 25, pe: 8 },
    { ticker: "TRAILING", pe: 9, forwardPE: 0 },
  ],
  rowFromLoadedCandidate,
  criteriaFromInputs(draft({ forwardPeMax: "20" }), 1).criteria,
);
assert.deepEqual(forward.visible.map((row) => row.ticker), ["CHEAP"]);
assert.deepEqual(forward.skipped, [MISSING_FORWARD_PE]);
assert.equal(rowFromLoadedCandidate({ pe: 9, forwardPE: 0 }).forwardPe, null);
assert.equal(rowFromLoadedCandidate({ forwardPE: -5 }).forwardPe, -5);
assert.equal(rowFromLoadedCandidate({ marketCap: -5 }).marketCap, -5);
const negativeForward = projectLoadedScreen(
  [
    { ticker: "LOSS", forwardPE: -5, marketCap: 2e9 },
    { ticker: "NONE", forwardPE: 0, marketCap: 2e9 },
  ],
  rowFromLoadedCandidate,
  criteriaFromInputs(draft({ forwardPeMax: "20" }), 1).criteria,
);
assert.deepEqual(negativeForward.visible.map((row) => row.ticker), ["LOSS"]);
assert.deepEqual(negativeForward.skipped, [MISSING_FORWARD_PE]);
const tighter = projectLoadedScreen(
  [{ ticker: "LOSS", forwardPE: -5 }],
  rowFromLoadedCandidate,
  criteriaFromInputs(draft({ forwardPeMax: "-10" }), 1).criteria,
);
assert.deepEqual(tighter.visible, []);
assert.deepEqual(tighter.skipped, []);

const crossed = criteriaFromInputs(draft({ marketCapMin: "2000", marketCapMax: "1000" }), 1);
assert.equal(crossed.criteria.marketCapMin, null);
assert.equal(crossed.criteria.marketCapMax, null);
assert.deepEqual(crossed.notes, [CAP_RANGE_NOTE]);
const crossedRows = projectLoadedScreen(
  [{ ticker: "A", marketCap: 1500 }, { ticker: "B", marketCap: 2500 }],
  rowFromLoadedCandidate,
  crossed.criteria,
);
assert.deepEqual(crossedRows.visible.map((row) => row.ticker), ["A", "B"]);

const negativeCaps = criteriaFromInputs(draft({ marketCapMin: "-5", marketCapMax: "-1" }), 1);
assert.equal(negativeCaps.criteria.marketCapMin, null);
assert.equal(negativeCaps.criteria.marketCapMax, null);
assert.deepEqual(negativeCaps.notes, [CAP_NEGATIVE_NOTE]);
const negativeCapRows = projectLoadedScreen(
  [{ ticker: "A", marketCap: 2e9 }],
  rowFromLoadedCandidate,
  negativeCaps.criteria,
);
assert.deepEqual(negativeCapRows.visible.map((row) => row.ticker), ["A"]);

const overflow = criteriaFromInputs(draft({ marketCapMin: "1e308" }), RESEARCHER_MARKET_CAP_USD_PER_MILLION);
assert.equal(Number.isFinite(1e308), true);
assert.equal(Number.isFinite(1e308 * RESEARCHER_MARKET_CAP_USD_PER_MILLION), false);
assert.equal(overflow.criteria.marketCapMin, null);
assert.deepEqual(overflow.notes, [CAP_SCALE_NOTE]);
const overflowRows = projectLoadedScreen(
  [{ ticker: "A", marketCap: 2e9 }, { ticker: "B", marketCap: 5e8 }],
  rowFromLoadedCandidate,
  overflow.criteria,
);
assert.deepEqual(overflowRows.visible.map((row) => row.ticker), ["A", "B"]);
const cleared = criteriaFromInputs(emptyDraft(), RESEARCHER_MARKET_CAP_USD_PER_MILLION);
assert.deepEqual(cleared.criteria, emptyCriteria());

const loaded13F = {
  screenedStocks: [
    { ticker: "AAPL", marketCap: 3e12, forwardPE: 28, sector: "Technology", pe: 32 },
    { ticker: "X", marketCap: 4e9, forwardPE: 11, sector: "Technology", pe: 14 },
  ],
};
const echoed = projectLoadedScreen(
  loaded13F.screenedStocks,
  rowFromLoadedCandidate,
  criteriaFromInputs(draft({ forwardPeMax: "20" }), 1).criteria,
);
assert.deepEqual(echoed.visible.map((row) => row.ticker), ["X"]);
assert.ok(echoed.unavailable.includes(MISSING_INDUSTRY));
assert.ok(echoed.unavailable.includes(MISSING_COUNTRY));
assert.ok(echoed.unavailable.includes(MISSING_ROIC));
assert.equal(echoed.unavailable.includes(MISSING_FORWARD_PE), false);
assert.equal(LOADED_UNIVERSE_NOTE.includes("Kein Volluniversum"), true);

const ranked = projectLoadedScreen(
  [
    { ticker: "FIRST", industry: "Banks", moatScore: 1 },
    { ticker: "SECOND", industry: "Software", moatScore: 9 },
    { ticker: "THIRD", industry: "Application Software", moatScore: 3 },
  ],
  rowFromLoadedCandidate,
  criteriaFromInputs(draft({ industry: "soft" }), 1).criteria,
);
assert.deepEqual(ranked.visible.map((row) => row.ticker), ["SECOND", "THIRD"]);

assert.deepEqual(projectLoadedScreen([], rowFromLoadedCandidate, emptyCriteria()).unavailable, []);

assert.equal(UNDERVALUED_SCREEN_PRESET.marketCapMin, 1000);
assert.equal(UNDERVALUED_SCREEN_PRESET.marketCapMax, 500000);
assert.equal(UNDERVALUED_SCREEN_PRESET.peMax, 30);
assert.equal(UNDERVALUED_SCREEN_PRESET.revenueGrowthMin, 5);

const researcher = readFileSync("client/src/pages/Researcher.tsx", "utf8");
assert.match(researcher, /body\.marketCapMin = 1000/);
assert.match(researcher, /body\.marketCapMax = 500000/);
assert.match(researcher, /body\.peMax = 30/);
assert.match(researcher, /body\.revenueGrowthMin = 5/);
assert.doesNotMatch(researcher, /custom-screen/);

const dashboard = readFileSync("client/src/pages/ScreenerDashboard.tsx", "utf8");
assert.match(dashboard, /\/api\/screener\$\{force \? "\?force=true" : ""\}/);
assert.match(dashboard, /screener-custom-criteria/);
assert.match(dashboard, /rowFromLoadedCandidate/);

const panel = readFileSync("client/src/components/researcher/ScreenerPanel.tsx", "utf8");
assert.match(panel, /custom-screen-form/);
assert.match(panel, /rowFromLoadedCandidate/);
assert.match(panel, /RESEARCHER_MARKET_CAP_USD_PER_MILLION/);

console.log("screener criteria: OK");
