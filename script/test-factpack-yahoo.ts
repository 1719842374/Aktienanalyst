/**
 * F2-09: SPY factpack PE/EPS from Yahoo only when FMP left them empty.
 * quoteSummary first, timeseries without a crumb second. No invented YoY.
 * Run: npx tsx script/test-factpack-yahoo.ts
 */
import { readFileSync } from "node:fs";
import { naWithReason, displayNa } from "../shared/recession-market-charts";
import { yahooFundamentalsWhenFmpEmpty } from "../server/factpack-yahoo";

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const qs = {
  summaryDetail: { trailingPE: { raw: 28.4 } },
  defaultKeyStatistics: { trailingEps: { raw: 20 } },
};

console.log("\n=== Yahoo only fills an empty FMP PE ===");
{
  let timeseriesCalls = 0;
  const fromQs = await yahooFundamentalsWhenFmpEmpty("SPY", 568, {
    quoteSummary: async () => qs,
    timeseries: async () => {
      timeseriesCalls++;
      return { pe: 1, eps: 1, source: "Yahoo timeseries", status: "ok" };
    },
  });
  check("quoteSummary trailingPE wins and timeseries is not called", fromQs.pe === 28.4 && fromQs.eps === 20 && fromQs.source === "Yahoo quoteSummary summaryDetail.trailingPE" && timeseriesCalls === 0, JSON.stringify(fromQs));

  const fromEps = await yahooFundamentalsWhenFmpEmpty("SPY", 200, {
    quoteSummary: async () => ({ defaultKeyStatistics: { trailingEps: { raw: 10 } } }),
    timeseries: async () => ({ pe: null, eps: null, source: null, status: "no_data" }),
  });
  check("EPS without a PE becomes price/EPS for the same symbol", fromEps.pe === 20 && fromEps.eps === 10 && fromEps.source?.includes("Kurs/EPS") === true, JSON.stringify(fromEps));

  const fromTs = await yahooFundamentalsWhenFmpEmpty("SPY", 500, {
    quoteSummary: async () => null,
    timeseries: async () => ({ pe: 22.5, eps: 22.2, source: "Yahoo timeseries", status: "ok" }),
  });
  check("a missing crumb falls through to timeseries", fromTs.pe === 22.5 && fromTs.source === "Yahoo timeseries" && fromTs.naReason === null, JSON.stringify(fromTs));

  const none = await yahooFundamentalsWhenFmpEmpty("SPY", 500, {
    quoteSummary: async () => null,
    timeseries: async () => ({ pe: null, eps: null, source: null, status: "no_data" }),
  });
  check("both empty stay null and name the reason", none.pe === null && none.eps === null && none.naReason === "n/a — FMP ohne PE/EPS, Yahoo quoteSummary leer, Yahoo timeseries ohne EPS", none.naReason ?? "");
  check("the reason uses the n/a dash", naWithReason("FMP ohne PE/EPS") === "n/a — FMP ohne PE/EPS");
  check("a filled PE does not turn into n/a", displayNa(28.4, "28,4", none.naReason, "PE") === "28,4");
  check("an empty PE shows the reason", displayNa(null, "n/a", none.naReason, "PE") === none.naReason);
}

console.log("\n=== SPY factpack path only, analyze-route untouched ===");
{
  const charts = readFileSync(new URL("../server/recession-market-charts.ts", import.meta.url), "utf8");
  const load = charts.slice(charts.indexOf("async function loadValuation"), charts.indexOf("export async function buildChartMarket"));
  check("loadValuation asks Yahoo only for SPY when PE is null", load.includes('book.etf === "SPY"') && load.includes("core.pe == null") && load.includes("yahooFundamentalsWhenFmpEmpty"));
  check("YoY is not assigned from a single trailing EPS", !/epsYoy\s*=\s*[^=]/.test(load));
  const ui = readFileSync(new URL("../client/src/components/recession/RecessionMarketChartsSection.tsx", import.meta.url), "utf8");
  check("the factpack PE cell uses displayNa", ui.includes("displayNa"));
  const analyze = readFileSync(new URL("../server/analyze-route.ts", import.meta.url), "utf8");
  check("analyze-route does not import the factpack fallback", !analyze.includes("factpack-yahoo"));
}

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
