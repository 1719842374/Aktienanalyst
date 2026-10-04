/**
 * Stocks-velocity gap on the regional books payload.
 * Spec: Offen_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md §1, §3, §4, §7.
 * Run: npx tsx script/test-liquidity-stocks-velocity.ts
 */
import fs from "fs";
import express from "express";
import { excessMoneyGrowth } from "../server/liquidity-regime-math";
import { scoreCatalog, type Obs } from "../server/liquidity-index-math";
import { H_MIN } from "../server/liquidity-index-math";
import {
  PHI,
  absorptionShare,
  buildRegionalStocks,
  pricedInPi,
  rateHalfLifeYears,
  sToUnit,
  tHalfYears,
  velocityFactor,
} from "../server/liquidity-stocks-velocity";
import { registerLiquidityRoute } from "../server/researcher-liquidity-route";
import { buildLiquidityIndex } from "../server/liquidity-index";
import {
  applyCapexRest,
  fetchRegionalStockInputs,
  fiscalRestFromCache,
  parseEurostatJson,
  parseMarketableTotal,
  spelledFredIds,
  stocksFromSeries,
  MSPD_MARKETABLE_URL,
} from "../server/liquidity-stocks-series";
import { DEAD_FRED_SERIES } from "../server/liquidity-briefing-math";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const near = (a: number | null, lo: number, hi: number) => a != null && a >= lo && a <= hi;

console.log("T½ rate = ln2 / ln(1+r)");
const t8 = rateHalfLifeYears(0.08);
ok("r=0.08 → T½^rate in [8.99, 9.01]", near(t8, 8.99, 9.01), String(t8));
const t2 = rateHalfLifeYears(0.02);
ok("r=0.02 → T½^rate in [34.9, 35.1]", near(t2, 34.9, 35.1), String(t2));
ok("floor r at 0.001", rateHalfLifeYears(0) === rateHalfLifeYears(0.001));

console.log("velocity clip");
ok("V=V̄ → factor 1", velocityFactor(1.4, 1.4) === 1);
ok("V=0.5 V̄ → factor 2", velocityFactor(0.7, 1.4) === 2);
ok("ratio above 2 clips to 2", velocityFactor(0.1, 1) === 2);
ok("ratio below 0.5 clips to 0.5", velocityFactor(10, 1) === 0.5);
const same = tHalfYears(0.08, 1.4, 1.4);
ok("V=V̄ → T½ = T½^rate", same != null && t8 != null && Math.abs(same - t8) < 1e-12, String(same));
const stretched = tHalfYears(0.08, 0.7, 1.4);
ok("V=0.5 V̄ stretches T½ by 2", stretched != null && t8 != null && Math.abs(stretched - t8 * 2) < 1e-12, String(stretched));

console.log("π");
ok("φ starts at 0.3", PHI === 0.3);
ok("s_to_unit(0)=0", sToUnit(0) === 0);
ok("s_to_unit(2)=1", sToUnit(2) === 1);
ok("s_to_unit ignores the negative side", sToUnit(-2) === 0);
const a = absorptionShare(0.02, 0.1);
ok("A = ΔM / (φ F/M)", a != null && Math.abs(a - 0.02 / (0.3 * 0.1)) < 1e-12, String(a));
ok("A clips to 1", absorptionShare(1, 0.01) === 1);
ok("A clips to 0", absorptionShare(-0.2, 0.1) === 0);
const pi = pricedInPi({ zR: 2, absorption: 0.5 });
ok("π = 0.6·1 + 0.4·0.5", pi != null && Math.abs(pi - 0.8) < 1e-12, String(pi));
ok("missing ΔM drops channel B and keeps the rate channel", pricedInPi({ zR: 2, absorption: null }) === 1);
ok("missing z_r keeps channel B", pricedInPi({ zR: null, absorption: 0.5 }) === 0.5);

console.log("EMG bit-identical");
const samples: [number, number, number][] = [[5.5, 2, 3], [0, 0, 0], [-1.25, 4.5, 0.25]];
for (const [m, g, c] of samples) {
  const fromRegime = excessMoneyGrowth(m, g, c);
  const fromStocks = buildRegionalStocks({ m2YoY: m, realGdpYoY: g, cpiYoY: c }).excessMoneyGrowth;
  ok(`EMG ${m}-${g}-${c}`, fromStocks === fromRegime, `${fromStocks} vs ${fromRegime}`);
}

console.log("payload does not move books");
function monthly(n: number, value: number, last?: number): Obs[] {
  const out: Obs[] = [];
  const d = new Date("2023-01-01T00:00:00.000Z");
  for (let i = 0; i < n; i++) {
    out.push({
      date: d.toISOString().slice(0, 10),
      value: i === n - 1 && last != null ? last : value,
    });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

const bundles = { "liqidx_ASIA__jpnassets": { points: monthly(H_MIN + 8, 640, 630) } };
const plain = scoreCatalog("ASIA", bundles);
const withDebt = scoreCatalog("ASIA", bundles, { debtGdpPct: 250 });
ok("JP debt level does not change LI", plain.li === withDebt.li, `${plain.li} vs ${withDebt.li}`);
ok("JP debt level does not change books.M", JSON.stringify(plain.books.M) === JSON.stringify(withDebt.books.M));
ok("JP debt level does not change books.F", JSON.stringify(plain.books.F) === JSON.stringify(withDebt.books.F));
ok("debt level is display only", withDebt.stocks.debtGdpPct === 250);
ok("empty stocks have pi unavailable", plain.stocks.available.pi === false && plain.stocks.pricedIn == null);

const priced = scoreCatalog("US", {}, {
  realRate: 0.08,
  velocity: 1.4,
  velocityHistory: [1.2, 1.4, 1.6],
  fiscalRestBn: 100,
  tMidYears: 0,
  deltaR: 0.004,
  sigmaDeltaR: 0.002,
  deltaMObs: 0.02,
  fiscalOverMoney: 0.1,
});
ok("payload T½ at r=0.08 and V=V̄", near(priced.stocks.tHalfYears, 8.99, 9.01), String(priced.stocks.tHalfYears));
ok("payload π is set when F is present", priced.stocks.pricedIn != null && priced.stocks.available.pi === true, String(priced.stocks.pricedIn));
ok("t_mid 0 leaves PV at F", priced.stocks.unpricedPvBn != null && priced.stocks.pricedIn != null
  && Math.abs(priced.stocks.unpricedPvBn - 100 * (1 - priced.stocks.pricedIn)) < 1e-9,
  String(priced.stocks.unpricedPvBn));
ok("books stay empty objects' shape", Array.isArray(priced.books.M) && Array.isArray(priced.books.F));

const noF = buildRegionalStocks({
  realRate: 0.02,
  velocity: 1,
  velocityHistory: [1],
  fiscalRestBn: null,
});
ok("no capex F → π unavailable", noF.available.pi === false && noF.pricedIn == null && noF.unpricedPvBn == null);
ok("no F still reports T½^rate for r=0.02", near(noF.tHalfYears, 34.9, 35.1), String(noF.tHalfYears));

const src = fs.readFileSync(new URL("../server/liquidity-stocks-velocity.ts", import.meta.url), "utf8");
ok("does not import g* or equity EPR", !src.includes("calcImpliedGStar") && !src.includes("calcEinpreisungsgrad") && !src.includes("catalyst-engine"));

async function withServer(run: (base: string) => Promise<void>) {
  const app = express();
  registerLiquidityRoute(app, {
    buildIndex: async (region) => scoreCatalog(region, {}, region === "EU" ? { debtGdpPct: 90, realRate: 0.02 } : {}),
  });
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

await withServer(async (base) => {
  const eu = await fetch(`${base}/api/researcher/liquidity?region=EU`);
  const body = await eu.json();
  ok("regional route carries stocks", eu.status === 200 && body.stocks?.debtGdpPct === 90, JSON.stringify(body.stocks));
  ok("regional route carries T½", near(body.stocks?.tHalfYears, 34.9, 35.1), String(body.stocks?.tHalfYears));
  ok("regional route keeps books.M and books.F", Array.isArray(body.books?.M) && Array.isArray(body.books?.F));
  ok("π stays unavailable without F", body.stocks?.available?.pi === false);
});

console.log("spelled series ids");
const NOW = new Date("2026-10-03T00:00:00.000Z");
const usIds = spelledFredIds("US");
ok("US ids are the spelled FRED set",
  JSON.stringify(usIds) === JSON.stringify(["GFDEGDQ188S", "DFII10", "DGS10", "CPIAUCSL", "M2V", "M2SL", "GDP", "GDPC1"]),
  usIds.join(","));
ok("EU FRED ids are debt and the long yield",
  JSON.stringify(spelledFredIds("EU")) === JSON.stringify(["GGGDTPEZA188N", "IRLTLT01EZM156N"]));
ok("ASIA FRED ids are debt, JGB10, CPI, the annual CPI fallback and NGDP",
  JSON.stringify(spelledFredIds("ASIA")) === JSON.stringify(["GGGDTAJPA188N", "IRLTLT01JPM156N", "JPNCPIALLMINMEI", "FPCPITOTLZGJPN", "JPNNGDP"]));
ok("dead FRED mirrors are not spelled ids",
  DEAD_FRED_SERIES.every(id => !usIds.includes(id) && !spelledFredIds("EU").includes(id) && !spelledFredIds("ASIA").includes(id)));
ok("MSPD marketable url is not the bills book",
  MSPD_MARKETABLE_URL.includes("security_type_desc:eq:Marketable") && !MSPD_MARKETABLE_URL.includes("security_class_desc:eq:Bills"));

function fredCsv(rows: [string, string][]): string {
  return ["observation_date,VALUE", ...rows.map(r => r.join(","))].join("\n");
}

console.log("series → existing StockInputs");
const flatM2v = [
  { date: "2024-06-01", value: 1.4 },
  { date: "2025-06-01", value: 1.4 },
  { date: "2026-06-01", value: 1.4 },
];
const fromDfii = stocksFromSeries("US", {
  GFDEGDQ188S: [{ date: "2026-07-01", value: 120 }],
  DFII10: [{ date: "2026-09-01", value: 2 }],
  DGS10: [{ date: "2026-09-01", value: 9 }],
  CPIAUCSL: [{ date: "2025-09-01", value: 100 }, { date: "2026-09-01", value: 104 }],
  M2V: flatM2v,
}, NOW);
ok("GFDEGDQ188S 120 is the debt level", fromDfii.debtGdpPct === 120);
ok("DFII10 2.00 is decimal 0.02, not the nominal fallback", fromDfii.realRate === 0.02, String(fromDfii.realRate));
ok("flat M2V is V and its own history", fromDfii.velocity === 1.4 && fromDfii.velocityHistory?.every(v => v === 1.4) === true);
const dfiiRow = buildRegionalStocks(fromDfii);
ok("wired r=0.02 uses the existing T½", near(dfiiRow.tHalfYears, 34.9, 35.1), String(dfiiRow.tHalfYears));
ok("flat M2V keeps the velocity factor at 1", dfiiRow.tHalfYears != null && Math.abs(dfiiRow.tHalfYears - (t2 ?? NaN)) < 1e-9);

const halfM2v = stocksFromSeries("US", {
  DFII10: [{ date: "2026-09-01", value: 2 }],
  M2V: [
    { date: "2024-06-01", value: 2 },
    { date: "2025-06-01", value: 2 },
    { date: "2025-12-01", value: 2 },
    { date: "2026-06-01", value: 1 },
  ],
}, NOW);
const halfRow = buildRegionalStocks(halfM2v);
ok("M2V at half its median stretches T½ by 2", halfRow.tHalfYears != null && t2 != null && Math.abs(halfRow.tHalfYears - t2 * 2) < 1e-9, String(halfRow.tHalfYears));

const fallback = stocksFromSeries("US", {
  DGS10: [{ date: "2026-09-01", value: 6 }],
  CPIAUCSL: [{ date: "2025-09-01", value: 100 }, { date: "2026-09-01", value: 104 }],
}, NOW);
ok("missing DFII10 uses (DGS10 − CPI YoY) / 100", fallback.realRate === 0.02, String(fallback.realRate));
const nominalOnly = stocksFromSeries("US", { DGS10: [{ date: "2026-09-01", value: 6 }] }, NOW);
ok("nominal yield alone is not a real rate", nominalOnly.realRate == null);

const ratio = stocksFromSeries("US", {
  GDP: [{ date: "2024-01-01", value: 20000 }, { date: "2026-01-01", value: 28000 }],
  M2SL: [{ date: "2024-01-01", value: 20000 }, { date: "2026-01-01", value: 20000 }],
}, NOW);
ok("without M2V, V is GDP/M2SL", ratio.velocity === 1.4, String(ratio.velocity));
ok("ratio history keeps both aligned points", JSON.stringify(ratio.velocityHistory) === JSON.stringify([1, 1.4]));
const m2vWins = stocksFromSeries("US", {
  M2V: [{ date: "2026-06-01", value: 1.1 }],
  GDP: [{ date: "2026-01-01", value: 28000 }],
  M2SL: [{ date: "2026-01-01", value: 20000 }],
}, NOW);
ok("official M2V wins over NGDP/M", m2vWins.velocity === 1.1);
const emgInputs = stocksFromSeries("US", {
  M2SL: [{ date: "2025-09-01", value: 100 }, { date: "2026-09-01", value: 105.5 }],
  GDPC1: [{ date: "2025-09-01", value: 100 }, { date: "2026-09-01", value: 102 }],
  CPIAUCSL: [{ date: "2025-09-01", value: 100 }, { date: "2026-09-01", value: 103 }],
}, NOW);
ok("US EMG uses excessMoneyGrowth on M2, GDPC1 and CPI YoY",
  buildRegionalStocks(emgInputs).excessMoneyGrowth === excessMoneyGrowth(5.5, 2, 3),
  String(buildRegionalStocks(emgInputs).excessMoneyGrowth));

const marketable = parseMarketableTotal(JSON.stringify({
  data: [
    { record_date: "2026-08-31", security_class_desc: "Bills", total_mil_amt: "6000000" },
    { record_date: "2026-08-31", security_class_desc: "Notes", total_mil_amt: "14000000" },
    { record_date: "2026-07-31", security_class_desc: "Bonds", total_mil_amt: "9000000" },
  ],
}));
ok("marketable total sums the latest date in bn", marketable?.bn === 20000 && marketable.date === "2026-08-31", JSON.stringify(marketable));
const bonds = stocksFromSeries("US", {
  MSPD_MARKETABLE: [{ date: "2026-08-31", value: 20000 }],
  GDP: [{ date: "2026-07-01", value: 25000 }],
}, NOW);
ok("bond size is bn and percent of GDP", bonds.bondMarketBn === 20000 && bonds.bondMarketGdpPct === 80, JSON.stringify(bonds));

function quarterly(n: number, valueAt: (i: number) => number): Obs[] {
  const out: Obs[] = [];
  const d = new Date("2020-07-01T00:00:00.000Z");
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 10), value: valueAt(i) });
    d.setUTCMonth(d.getUTCMonth() + 3);
  }
  return out;
}
const debtPath = quarterly(24, i => (i < 20 ? 100 : [110, 130, 160, 200][i - 20]));
const trending = stocksFromSeries("US", { GFDEGDQ188S: debtPath }, NOW);
ok("4q debt deltas become a fiscal s(z)", trending.fiscalTrend != null && trending.fiscalTrend > 50, String(trending.fiscalTrend));
ok("debt level stays on the row", trending.debtGdpPct === 200);
const shortDebt = stocksFromSeries("US", {
  GFDEGDQ188S: [{ date: "2025-07-01", value: 118 }, { date: "2026-07-01", value: 120 }],
}, NOW);
ok("short debt history shows the level and leaves the trend empty", shortDebt.debtGdpPct === 120 && shortDebt.fiscalTrend == null);
ok("stale debt is dropped", stocksFromSeries("US", { GFDEGDQ188S: [{ date: "2020-01-01", value: 120 }] }, NOW).debtGdpPct == null);

const euDebt = stocksFromSeries("EU", {
  GGGDTPEZA188N: [{ date: "2016-01-01", value: 86 }],
  EZ_DEBT_GDP: [{ date: "2026-01-01", value: 88.6 }],
  IRLTLT01EZM156N: [{ date: "2026-09-01", value: 3 }],
}, NOW);
ok("EZ debt prefers live Eurostat over the 2016 FRED mirror", euDebt.debtGdpPct === 88.6);
ok("EZ yield without HICP is not a real rate", euDebt.realRate == null);
ok("ASIA does not borrow the US debt id", stocksFromSeries("ASIA", { GFDEGDQ188S: [{ date: "2026-07-01", value: 250 }] }, NOW).debtGdpPct == null);
ok("JP debt level from 2023 still displays",
  stocksFromSeries("ASIA", { GGGDTAJPA188N: [{ date: "2023-01-01", value: 239.971 }] }, NOW).debtGdpPct === 239.971);
ok("2016 FRED EZ debt alone is stale",
  stocksFromSeries("EU", { GGGDTPEZA188N: [{ date: "2016-01-01", value: 86.558 }] }, NOW).debtGdpPct == null);

const euReal = stocksFromSeries("EU", {
  IRLTLT01EZM156N: [{ date: "2026-09-01", value: 3 }],
  EZ_HICP_YOY: [{ date: "2026-09-01", value: 1 }],
  EZ_DEBT_SEC: [{ date: "2026-01-01", value: 8000 }],
  ECB_NGDP: [{ date: "2026-01-01", value: 2000 }],
  ECB_M3: [
    { date: "2026-01-01", value: 4000 },
    { date: "2026-02-01", value: 4000 },
    { date: "2026-03-01", value: 4000 },
  ],
}, NOW);
ok("EZ r is (IRLTLT01EZM156N − CP00 HICP) / 100", euReal.realRate === 0.02, String(euReal.realRate));
ok("EZ V is annualized NGDP / M3", euReal.velocity === 2, String(euReal.velocity));
ok("EZ debt securities are bn and percent of annualized NGDP",
  euReal.bondMarketBn === 8000 && euReal.bondMarketGdpPct === 100, JSON.stringify(euReal));

const jpRow = stocksFromSeries("ASIA", {
  GGGDTAJPA188N: [{ date: "2023-01-01", value: 250 }],
  IRLTLT01JPM156N: [{ date: "2026-09-01", value: 4 }],
  JPNCPIALLMINMEI: [{ date: "2025-09-01", value: 100 }, { date: "2026-09-01", value: 102 }],
  JPNNGDP: [{ date: "2026-04-01", value: 600 }],
  BOJ_M2: [
    { date: "2026-04-01", value: 500 },
    { date: "2026-05-01", value: 500 },
    { date: "2026-06-01", value: 500 },
  ],
}, NOW);
ok("JP r is (JGB10 − CPI YoY) / 100", jpRow.realRate === 0.02, String(jpRow.realRate));
const jpFallback = stocksFromSeries("ASIA", {
  IRLTLT01JPM156N: [{ date: "2026-08-01", value: 2.94 }],
  JPNCPIALLMINMEI: [{ date: "2020-06-01", value: 100 }, { date: "2021-06-01", value: 101 }],
  FPCPITOTLZGJPN: [{ date: "2025-01-01", value: 3 }],
}, NOW);
ok("stale JP monthly CPI falls back to the annual percent", jpFallback.realRate != null && Math.abs(jpFallback.realRate - (2.94 - 3) / 100) < 1e-12, String(jpFallback.realRate));
ok("JP V is NGDP / M2 without a second annualization", jpRow.velocity === 1.2, String(jpRow.velocity));
ok("JP debt level stays off the score inputs", jpRow.debtGdpPct === 250 && jpRow.fiscalTrend == null);

const eurostat = parseEurostatJson(JSON.stringify({
  value: { "0": 87.4, "1": 88.6 },
  dimension: { time: { category: { index: { "2024-Q1": 0, "2026-Q1": 1 } } } },
}));
ok("Eurostat JSON keeps quarter starts", eurostat[1]?.date === "2026-01-01" && eurostat[1]?.value === 88.6, JSON.stringify(eurostat));

ok("capex prose budgets are not F", fiscalRestFromCache({ programmes: [{ amountUSD: "$369B" }] }).fiscalRestBn == null);
ok("numeric capex rest is F", fiscalRestFromCache({ fiscalRestBn: 40, tMidYears: 0 }).fiscalRestBn === 40
  && fiscalRestFromCache({ fiscalRestBn: 40, tMidYears: 0 }).tMidYears === 0);
const withRest = applyCapexRest(
  { realRate: 0.02, deltaR: 0.004, sigmaDeltaR: 0.002, deltaMObs: 0.02, moneyStockBn: 20000 },
  { fiscalRestBn: 40, tMidYears: 0 },
);
ok("F/M uses the money stock", withRest.fiscalOverMoney === 40 / 20000, String(withRest.fiscalOverMoney));
const pricedRest = buildRegionalStocks(withRest);
ok("numeric F turns π on", pricedRest.available.pi === true && pricedRest.pricedIn != null, String(pricedRest.pricedIn));

const trendLevels = monthly(H_MIN + 8, 100, 110);
const mixed = scoreCatalog("EU", {
  "liqidx_EU__ecbdfr": { points: trendLevels },
  "liqidx_EU__app_pepp": { points: trendLevels },
});
const pinned = scoreCatalog("EU", {
  "liqidx_EU__ecbdfr": { points: trendLevels },
  "liqidx_EU__app_pepp": { points: trendLevels },
}, { moneyTrend: 12 });
ok("money trend mixes the existing rate and policy scores", mixed.stocks.moneyTrend != null && mixed.stocks.moneyTrend >= 0 && mixed.stocks.moneyTrend <= 100, String(mixed.stocks.moneyTrend));
ok("a passed money trend is kept", pinned.stocks.moneyTrend === 12);
ok("money trend does not move li or books", mixed.li === pinned.li && JSON.stringify(mixed.books) === JSON.stringify(pinned.books));

console.log("fetch wires spelled urls into the payload");
const seenUrls: string[] = [];
const seenKeys: string[] = [];
const fetched = await fetchRegionalStockInputs("US", {
  now: NOW,
  cache: { get: () => null, set: (key) => seenKeys.push(key) },
  fetchText: async (url) => {
    seenUrls.push(url);
    if (url.includes("id=GFDEGDQ188S")) return fredCsv([["2026-07-01", "120"]]);
    if (url.includes("id=DFII10")) return fredCsv([["2026-09-01", "2.00"]]);
    if (url.includes("id=M2V")) return fredCsv([["2025-06-01", "1.4"], ["2026-06-01", "1.4"]]);
    if (url.includes("id=GDP")) return fredCsv([["2026-07-01", "25000"]]);
    if (url.includes("mspd_table_1")) return JSON.stringify({
      data: [
        { record_date: "2026-08-31", total_mil_amt: "6000000" },
        { record_date: "2026-08-31", total_mil_amt: "14000000" },
      ],
    });
    return fredCsv([]);
  },
});
ok("fetch asks for each spelled US series",
  ["GFDEGDQ188S", "DFII10", "DGS10", "CPIAUCSL", "M2V", "M2SL", "GDP"].every(id => seenUrls.some(u => u.includes(`id=${id}`)))
  && seenUrls.some(u => u.includes("security_type_desc:eq:Marketable") && !u.includes("security_class_desc:eq:Bills")));
ok("fetch asks for GDPC1 as the EMG real-GDP input", seenUrls.some(u => u.includes("id=GDPC1")));
ok("US fetch does not ask for a dead mirror or a JP id",
  !seenUrls.some(u => u.includes("JPN") || DEAD_FRED_SERIES.some(id => u.includes(id))));
ok("fetch cache keys stay off the catalog", seenKeys.every(k => k.startsWith("liqidx_stocks_US__")) && !seenKeys.some(k => k.includes("WALCL")));
ok("fetched debt, rate, M2V and bonds", fetched.debtGdpPct === 120 && fetched.realRate === 0.02 && fetched.velocity === 1.4 && fetched.bondMarketBn === 20000,
  JSON.stringify(fetched));
const fetchedRow = buildRegionalStocks(fetched);
ok("fetched r=0.02 still uses the existing T½", near(fetchedRow.tHalfYears, 34.9, 35.1), String(fetchedRow.tHalfYears));

const euUrls: string[] = [];
await fetchRegionalStockInputs("EU", {
  now: NOW,
  cache: { get: () => null, set: () => {} },
  fetchText: async (url) => {
    euUrls.push(url);
    if (url.includes("GGGDTPEZA188N")) return fredCsv([["2026-01-01", "88.4"]]);
    return null;
  },
});
ok("EZ fetch asks for the named yield, Eurostat debt, HICP, M3 and NGDP",
  euUrls.some(u => u.includes("GGGDTPEZA188N"))
  && euUrls.some(u => u.includes("IRLTLT01EZM156N"))
  && euUrls.some(u => u.includes("gov_10q_ggdebt") && u.includes("na_item=GD"))
  && euUrls.some(u => u.includes("gov_10q_ggdebt") && u.includes("na_item=F3"))
  && euUrls.some(u => u.includes("prc_hicp_manr") && u.includes("coicop=CP00"))
  && euUrls.some(u => u.includes("/BSI/"))
  && euUrls.some(u => u.includes("/MNA/"))
  && euUrls.every(u => !DEAD_FRED_SERIES.some(id => u.includes(id))));
const asiaUrls: string[] = [];
const asiaFetched = await fetchRegionalStockInputs("ASIA", {
  now: NOW,
  cache: { get: () => null, set: () => {} },
  readFiscalRest: () => ({ fiscalRestBn: null, tMidYears: null }),
  fetchText: async (url) => {
    asiaUrls.push(url);
    if (url.includes("id=GGGDTAJPA188N")) return fredCsv([["2023-01-01", "239.971"]]);
    if (url.includes("id=IRLTLT01JPM156N")) return fredCsv([["2026-09-01", "4"]]);
    if (url.includes("id=JPNCPIALLMINMEI")) return fredCsv([["2025-09-01", "100"], ["2026-09-01", "102"]]);
    if (url.includes("id=JPNNGDP")) return fredCsv([["2026-04-01", "600"]]);
    if (url.includes("stat-search.boj.or.jp")) {
      return [
        "MAM1NAM2M2MO,M2,100 million yen,MONTHLY,Money Stock,20260909,202604,5000",
        "MAM1NAM2M2MO,M2,100 million yen,MONTHLY,Money Stock,20260909,202605,5000",
        "MAM1NAM2M2MO,M2,100 million yen,MONTHLY,Money Stock,20260909,202606,5000",
      ].join("\n");
    }
    return null;
  },
});
ok("ASIA fetch asks for debt, JGB10, CPI, NGDP and BoJ M2",
  ["GGGDTAJPA188N", "IRLTLT01JPM156N", "JPNCPIALLMINMEI", "FPCPITOTLZGJPN", "JPNNGDP"].every(id => asiaUrls.some(u => u.includes(`id=${id}`)))
  && asiaUrls.some(u => u.includes("stat-search.boj.or.jp"))
  && asiaUrls.every(u => !DEAD_FRED_SERIES.some(id => u.includes(id))));
ok("ASIA fetch maps debt, r and V",
  asiaFetched.debtGdpPct === 239.971 && asiaFetched.realRate === 0.02 && asiaFetched.velocity === 1.2,
  JSON.stringify(asiaFetched));

const walcl = monthly(H_MIN + 8, 100, 140);
const bundle = async (s: { cacheKey: string }) => s.cacheKey === "liqidx_US__WALCL" ? { points: walcl } : { points: [] };
const indexed = await buildLiquidityIndex("US", {
  now: NOW,
  cache: { get: () => null, set: () => {} },
  fetchBundle: bundle,
  fetchStocks: async () => fetched,
});
const bare = await buildLiquidityIndex("US", {
  now: NOW,
  cache: { get: () => null, set: () => {} },
  fetchBundle: bundle,
  fetchStocks: async () => ({}),
});
ok("stock inputs do not move li", indexed.li === bare.li, `${indexed.li} vs ${bare.li}`);
ok("stock inputs do not move books", JSON.stringify(indexed.books) === JSON.stringify(bare.books));
ok("builder passes spelled inputs through", indexed.stocks.debtGdpPct === 120 && near(indexed.stocks.tHalfYears, 34.9, 35.1), String(indexed.stocks.tHalfYears));

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
