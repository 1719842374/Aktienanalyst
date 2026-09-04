/**
 * npx tsx script/test-portfolio-capm-er.ts
 */
import { computeCapmExpectedReturn } from "../client/src/lib/portfolio/capmExpectedReturn";

function series(start: string, n: number, startPx: number, daily: number) {
  const out: { date: string; close: number }[] = [];
  const d0 = new Date(start + "T00:00:00Z");
  let px = startPx;
  for (let i = 0; i < n; i++) {
    const d = new Date(d0.getTime() + i * 86400000);
    out.push({ date: d.toISOString().slice(0, 10), close: px });
    px *= 1 + daily;
  }
  return out;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const mkt = series("2024-01-01", 80, 100, 0.0004);
const hi = series("2024-01-01", 80, 50, 0.0008);
const empty = computeCapmExpectedReturn({
  tickers: [],
  historicalPricesByTicker: {},
  benchmarkTicker: "SPY",
  benchmarkPrices: mkt,
  rfAnnual: 0.03,
});
assert(empty.available === false, "empty available");

const short = computeCapmExpectedReturn({
  tickers: ["AAA"],
  historicalPricesByTicker: { AAA: series("2024-01-01", 10, 10, 0.001) },
  benchmarkTicker: "SPY",
  benchmarkPrices: mkt,
  rfAnnual: 0.03,
});
assert(short.available === false, "short hist");

const ok = computeCapmExpectedReturn({
  tickers: ["HI"],
  weightsByTicker: { HI: 1 },
  historicalPricesByTicker: { HI: hi },
  benchmarkTicker: "SPY",
  benchmarkPrices: mkt,
  rfAnnual: 0.03,
});
assert(ok.available === true, "ok available");
assert(ok.muPortfolio != null && ok.muPortfolio > 0.03, `mu_p=${ok.muPortfolio}`);
assert(ok.rows[0].beta > 1, `beta=${ok.rows[0].beta}`);

const beta1 = computeCapmExpectedReturn({
  tickers: ["M"],
  weightsByTicker: { M: 1 },
  historicalPricesByTicker: { M: mkt },
  benchmarkTicker: "SPY",
  benchmarkPrices: mkt,
  rfAnnual: 0.04,
});
assert(Math.abs(beta1.rows[0].beta - 1) < 1e-9, `beta self ${beta1.rows[0].beta}`);
assert(Math.abs(beta1.muPortfolio! - beta1.muMarket!) < 1e-12, "mu_p = mu_m when beta=1");

console.log("test-portfolio-capm-er: ok");
