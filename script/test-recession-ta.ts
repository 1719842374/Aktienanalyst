/** WORK_RECESSION_TA_CHART — pure contract + reuse of stock Section 12. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RECESSION_TA_BOOKS, asOfJoin, diffSeries, maxAgeFor, normalizeBars, parseTaRegion,
} from "../shared/recession-ta";
import { bannerProbabilities, recessionTaAsStock, technicalIndicatorsFromBars } from "../client/src/lib/recessionTaModel";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`✓ ${name}`); };

ok("books: SPY / VGK / ASHR + FRED ids from spec", () => {
  assert.equal(RECESSION_TA_BOOKS.US.etf, "SPY");
  assert.equal(RECESSION_TA_BOOKS.EU.etf, "VGK");
  assert.equal(RECESSION_TA_BOOKS.AS.etf, "ASHR");
  assert.deepEqual(RECESSION_TA_BOOKS.US.series.vol?.fred, ["VIXCLS"]);
  assert.deepEqual(RECESSION_TA_BOOKS.US.series.curve?.fred, ["T10Y2Y"]);
  assert.deepEqual(RECESSION_TA_BOOKS.US.series.spread?.fred, ["BAA10Y"]);
  assert.deepEqual(RECESSION_TA_BOOKS.EU.series.curve?.fred, ["IRLTLT01EZM156N", "IR3TIB01EZM156N"]);
  assert.deepEqual(RECESSION_TA_BOOKS.EU.series.spread?.fred, ["BAMLHE00EHYIOAS"]);
  assert.equal(RECESSION_TA_BOOKS.AS.series.curve, undefined);
  assert.equal(parseTaRegion("eu"), "EU");
  assert.equal(parseTaRegion("xx"), "US");
});

ok("diffSeries: EZ curve = 10J − 3M on common dates", () => {
  const d = diffSeries([{ date: "2024-01-01", value: 3 }, { date: "2024-02-01", value: 2.5 }], [{ date: "2024-01-01", value: 3.9 }]);
  assert.deepEqual(d, [{ date: "2024-01-01", value: -0.9 }]);
});

ok("asOfJoin: last print ≤ date, stale → null (gap, not invented)", () => {
  const pts = [{ date: "2024-01-02", value: 1 }, { date: "2024-01-10", value: 2 }];
  assert.deepEqual(asOfJoin(["2024-01-01", "2024-01-03", "2024-01-09", "2024-01-20"], pts, maxAgeFor("daily")), [null, 1, 1, null]);
  assert.deepEqual(asOfJoin(["2024-02-15"], [{ date: "2024-01-01", value: 5 }], maxAgeFor("monthly")), [5]);
});

ok("normalizeBars: ascending, dedup, drops bad rows", () => {
  const b = normalizeBars([
    { date: "2024-01-03", close: 2, volume: 5 },
    { date: "2024-01-02", close: 1, open: 0.9, high: 1.1, low: 0.8 },
    { date: "bad", close: 3 },
    { date: "2024-01-04", close: NaN },
  ]);
  assert.deepEqual(b.map(x => x.date), ["2024-01-02", "2024-01-03"]);
  assert.equal(b[1].open, 2);
});

const bars = Array.from({ length: 400 }, (_, i) => {
  const d = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  const close = 100 + i * 0.5;
  return { date: d, open: close, high: close, low: close, close, volume: 1000 };
});

ok("technicalIndicatorsFromBars: same 4 conditions as stock (uptrend → all true)", () => {
  const ti = technicalIndicatorsFromBars(bars)!;
  assert.equal(ti.maData.length, 400);
  assert.equal(ti.currentStatus.priceAboveMA200, true);
  assert.equal(ti.currentStatus.ma50AboveMA200, true);
  assert.equal(ti.currentStatus.macdAboveZero, true);
  assert.equal(technicalIndicatorsFromBars([]), null);
});

ok("recessionTaAsStock feeds TechnicalChart fields only", () => {
  const s: any = recessionTaAsStock({ region: "US", label: "US", etf: "SPY", ohlcv: bars, ohlcvSource: "yahoo", ohlcvError: null, series: [] });
  assert.equal(s.ticker, "SPY");
  assert.equal(s.ohlcvData.length, 400);
  assert.equal(s.historyDataSource, "yahoo");
  assert.equal("fairValue" in s, false);
});

ok("banner: recession_full / correction_full, n/a when missing", () => {
  const b = bannerProbabilities({
    subgroups: [{ name: "recession_full", probability: 30, finalProbability: 27 }, { name: "correction_full", probability: 41 }],
    topDrivers: ["a", "b", "c", "d"],
  });
  assert.deepEqual(b, { recession12m: 27, correction12m: 41, drivers: ["a", "b", "c"] });
  assert.deepEqual(bannerProbabilities(null), { recession12m: null, correction12m: null, drivers: [] });
});

ok("reuse: stock Section 12 defaults unchanged, recession uses TechnicalChart", () => {
  const tc = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
  assert.match(tc, /sectionNumber = 12/);
  assert.match(tc, /title = "Technische Analyse"/);
  assert.match(tc, /subtitle = "Interactive Chart – MA \/ MACD \/ RSI \/ BB \/ Volume"/);
  assert.match(tc, /STOCK_RANGE_PRESETS = \["3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y"\]/);
  const sec = readFileSync("client/src/components/recession/RecessionTaSection.tsx", "utf8");
  assert.match(sec, /<TechnicalChart/);
  assert.match(sec, /"1Y", "3Y", "5Y", "10Y", "Max"/);
  const route = readFileSync("server/recession-ta-route.ts", "utf8");
  assert.doesNotMatch(route, /from "\.\/(analyze-route|researcher|scoring)/);
});

console.log(`\n${n} checks passed`);
