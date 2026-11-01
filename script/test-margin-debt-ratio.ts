/**
 * Margin-Debt-Ratio im TA-Chart.
 * FINRA-Debit / Marktkapitalisierung, sonst BIP. Achse = z der eigenen Historie.
 *   npx tsx script/test-margin-debt-ratio.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  finraLeverage,
  leverageSchema,
  marginDebtRatio,
  marketsResponseSchema,
} from "../shared/recession-market-charts.ts";
import { asOfJoin, maxAgeFor } from "../shared/recession-ta.ts";
import { WILSHIRE_DOLLARS_PER_POINT_BN } from "../server/buffett-route.ts";

const asOf = "2026-11-01";
const debit = [
  { date: "2026-01-01", debitMillions: 1_000_000 },
  { date: "2026-02-01", debitMillions: 0 },
  { date: "2026-02-01", debitMillions: 1_000_000 },
  { date: "2026-03-01", debitMillions: 1_000_000 },
];
const cap = [
  { date: "2026-01-01", value: 10_000 },
  { date: "2026-03-01", value: 20_000 },
];

const block = marginDebtRatio(debit, cap, [], asOf);
assert.equal(block.basis, "marketCap");
assert.equal(block.reason, null);
assert.equal(block.points.length, 3);
assert.equal(block.points[0].ratioPct, 10);
assert.equal(block.points[1].date, "2026-02-01");
assert.equal(block.points[1].ratioPct, 10, "Februar hält den Januar-Nenner, keine Interpolation");
assert.notEqual(block.points[1].ratioPct, (1000 / 15_000) * 100);
assert.equal(block.points[2].ratioPct, 5);
assert.ok(block.points.every((p) => p.z !== 0));
assert.equal(block.points[0].percentile, 100);
assert.equal(block.points[2].percentile, 33.33);
assert.equal(block.latest?.percentile, 33.33);
assert.equal(WILSHIRE_DOLLARS_PER_POINT_BN, 1.05);

const stepped = asOfJoin(
  ["2026-01-01", "2026-02-01", "2026-02-15", "2026-03-01"],
  block.points.map((p) => ({ date: p.date, value: p.z })),
  maxAgeFor("monthly"),
);
assert.equal(stepped[0], block.points[0].z);
assert.equal(stepped[1], block.points[0].z);
assert.equal(stepped[2], block.points[0].z);
assert.equal(stepped[3], block.points[2].z);
assert.notEqual(stepped[1], (block.points[0].z + block.points[2].z) / 2);

const staleCap = [{ date: "2020-01-01", value: 10_000 }];
const gdp = [
  { date: "2026-01-01", value: 20_000 },
  { date: "2026-04-01", value: 25_000 },
];
const viaGdp = marginDebtRatio(
  [
    { date: "2026-02-01", debitMillions: 1_000_000 },
    { date: "2026-05-01", debitMillions: 1_000_000 },
  ],
  staleCap,
  gdp,
  asOf,
);
assert.equal(viaGdp.basis, "gdp");
assert.match(viaGdp.denominator, /Marktkapitalisierung nicht verfügbar/);
assert.equal(viaGdp.points[0].ratioPct, 5);
assert.equal(viaGdp.points[1].ratioPct, 4);

const missing = marginDebtRatio(debit, [], [], asOf);
assert.equal(missing.basis, null);
assert.equal(missing.points.length, 0);
assert.equal(missing.latest, null);
assert.match(missing.reason ?? "", /n\/a|nicht verfügbar/);
assert.equal(JSON.stringify(missing).includes('"z":0'), false);

const constant = marginDebtRatio(
  [
    { date: "2026-01-01", debitMillions: 1_000_000 },
    { date: "2026-02-01", debitMillions: 1_000_000 },
  ],
  [{ date: "2026-01-01", value: 10_000 }],
  [],
  asOf,
);
assert.equal(constant.points.length, 0);
assert.match(constant.reason ?? "", /konstant/);

const monthly = Array.from({ length: 40 }, (_, i) => ({
  date: `2023-${String((i % 12) + 1).padStart(2, "0")}-01`,
  debitMillions: 1_000_000 + i * 10_000,
}));
const strip = finraLeverage(monthly, "1Y", block);
assert.ok(strip);
assert.equal(strip.points.length, 12);
assert.equal(strip.marginRatio, block);
assert.equal(leverageSchema.safeParse({ ...strip, marginRatio: undefined }).success, false);
const parsed = leverageSchema.parse(strip);
assert.equal(parsed.seriesId, "FINRA_MARGIN_DEBIT");
assert.equal(parsed.marginRatio?.basis, "marketCap");

function market(id: "SPY" | "QQQ" | "VGK" | "ASHR", leverage: typeof strip) {
  return {
    id,
    etf: id,
    name: id,
    volId: "VIXCLS",
    volKind: "implied" as const,
    bandsAnalog: false,
    volYMax: 90 as const,
    volNote: null,
    ohlcv: [],
    vol: [],
    marks: [],
    snapshot: {
      pe: null, peFwd: null, peg: null, pegFwd: null, pegKind: null, pegFwdKind: null,
      epsYoy: null, rsi: null, macdHist: null, missing: null,
    },
    leverage,
    leverageNote: leverage ? null : "FINRA Margin Debit nicht lieferbar",
    valuationLabel: "ETF-Proxy",
  };
}
const body = marketsResponseSchema.parse({
  asOf: "2026-09-01",
  window: "MAX",
  markets: [
    market("SPY", strip),
    market("QQQ", null),
    market("VGK", null),
    market("ASHR", null),
  ],
});
assert.equal(body.markets.find((m) => m.id === "SPY")?.leverage?.marginRatio?.points.length, 3);
assert.equal(body.markets.find((m) => m.id === "VGK")?.leverage, null);

const server = readFileSync("server/recession-market-charts.ts", "utf8");
assert.equal(server.split("margin-statistics.xlsx").length - 1, 1);
assert.match(server, /fetchFinraMarginDebit/);
assert.match(server, /marginDebtRatio/);
assert.match(server, /fredLevels\("WILL5000PR", WILSHIRE_DOLLARS_PER_POINT_BN\)/);
assert.match(server, /fredLevels\("GDP", 1\)/);
assert.match(server, /fetchFredCsv\(seriesId, SERIES_FLOOR\)/);

const hook = readFileSync("client/src/hooks/useFinraMarginRatio.ts", "utf8");
assert.match(hook, /apiRequest/);
assert.match(hook, /\/api\/analyze-recession\/markets\?window=MAX/);
assert.match(hook, /marketsResponseSchema/);
assert.doesNotMatch(hook, /\?\? 0|overallScore|analyze-route/);

const ui = readFileSync("client/src/components/recession/RecessionTaSection.tsx", "utf8");
assert.match(ui, /data-testid="button-ta-margin"/);
assert.match(ui, /useFinraMarginRatio/);
assert.match(ui, /testId="chart-ta-margin"/);
assert.match(ui, /data-testid="margin-debt-overlay-status"/);
assert.match(ui, /step: true/);
assert.match(ui, /refLines=\{\[\]\}/);
assert.match(ui, /n\/a —/);
assert.doesNotMatch(ui, /dataKey="_peerPx"|overallScore/);

const chart = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
assert.match(chart, /return cone \? attachConeSeries\(base, cone\) : base/);
assert.match(chart, /data-testid="button-scenario-cone"/);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");

console.log("margin debt ratio: OK");
