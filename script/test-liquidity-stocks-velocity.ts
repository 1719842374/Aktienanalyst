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

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
