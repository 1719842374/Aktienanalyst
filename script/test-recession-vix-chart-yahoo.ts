/**
 * F1-66 / F2-05: Rezessions-Charts (Sektion 9 Markt-RSI, Sektion 10 Vier Märkte) bekommen
 * Yahoo ^VIX, wenn FRED VIXCLS leer ist. Nur Chart-Pfad, der VIX-Score bleibt unberührt.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-recession-vix-chart-yahoo.ts
 */
import * as markets from "../server/recession-markets";
import { buildChartMarket } from "../server/recession-market-charts";
import { CHART_BOOKS } from "../shared/recession-market-charts";

// Stub-Key: fmp.ts liest den Key erst beim Aufruf; alle Requests gehen an das gestubbte fetch.
process.env.FMP_API_KEY = process.env.FMP_API_KEY || "test-stub";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

const day = (iso: string) => Date.parse(iso + "T21:00:00Z") / 1000;
const yahooPayload = {
  chart: { result: [{
    timestamp: [day("2026-10-20"), day("2026-10-21"), day("2026-10-22"), day("2026-10-23")],
    indicators: { quote: [{ close: [18.1, null, 19.03, 19.45] }] },
  }] },
};

const realFetch = globalThis.fetch;
const calls: string[] = [];
function stubFetch(fredOk: boolean, yahooOk: boolean) {
  calls.length = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input);
    calls.push(url);
    if (url.includes("fredgraph.csv")) {
      return fredOk
        ? new Response("observation_date,VIXCLS\n2026-10-22,16.5\n2026-10-23,17.1\n", { status: 200 })
        : new Response("upstream", { status: 503 });
    }
    if (url.includes("finance.yahoo.com/v8/finance/chart/%5EVIX")) {
      return yahooOk ? new Response(JSON.stringify(yahooPayload), { status: 200 }) : new Response("{}", { status: 429 });
    }
    if (url.includes("financialmodelingprep.com/stable/historical-price-eod")) {
      const bars = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"].map((date, i) => ({ date, open: 600 + i, high: 601 + i, low: 599 + i, close: 600 + i, volume: 1e6 }));
      return new Response(JSON.stringify(bars), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  }) as typeof fetch;
}

async function main() {
  console.log("1) Parser");
  const parse = (markets as any).parseYahooChartSeries;
  ok("parseYahooChartSeries exportiert", typeof parse === "function");
  if (typeof parse === "function") {
    const s = parse(yahooPayload);
    ok("Null-Bar übersprungen, 3 Punkte", s.length === 3, JSON.stringify(s));
    ok("letzter Punkt 2026-10-23 = 19.45", s.at(-1)?.date === "2026-10-23" && s.at(-1)?.value === 19.45);
    ok("Müll → []", parse(null).length === 0 && parse({ chart: {} }).length === 0);
  }

  const fb = (markets as any).fetchFredVolWithYahooFallback;
  console.log("2) Fallback-Reihenfolge");
  ok("fetchFredVolWithYahooFallback exportiert", typeof fb === "function");
  if (typeof fb === "function") {
    let yahooCalled = false;
    const r1 = await fb("VIXCLS", "1990-01-01", { fred: async () => [{ date: "2026-10-23", value: 17.1 }], yahoo: async () => { yahooCalled = true; return []; } });
    ok("FRED voll → FRED, kein Yahoo-Call, keine Notiz", r1.vol.length === 1 && r1.volNote === null && !yahooCalled);
    const r2 = await fb("VIXCLS", "1990-01-01", { fred: async () => [], yahoo: async () => parse(yahooPayload) });
    ok("FRED leer → Yahoo-Reihe", r2.vol.length === 3 && r2.vol.at(-1).value === 19.45);
    ok("Notiz nennt Yahoo ^VIX und FRED leer", r2.volNote === "VIX via Yahoo ^VIX (FRED VIXCLS leer)", String(r2.volNote));
    const r3 = await fb("VIXCLS", "1990-01-01", { fred: async () => [], yahoo: async () => [] });
    ok("beide leer → leer + ehrliche Notiz", r3.vol.length === 0 && r3.volNote === "FRED VIXCLS leer, Yahoo ^VIX leer", String(r3.volNote));
    let y4 = false;
    const r4 = await fb("VXNCLS", "2001-01-01", { fred: async () => [], yahoo: async () => { y4 = true; return parse(yahooPayload); } });
    ok("VXNCLS ohne Yahoo-Zwilling: Verhalten wie main", r4.vol.length === 0 && r4.volNote === "FRED VXNCLS leer" && !y4);
    const r5 = await fb("VIXCLS", "2026-10-22", { fred: async () => [], yahoo: async () => parse(yahooPayload) });
    ok("Yahoo-Punkte vor cosd fallen raus", r5.vol.length === 2);
  }

  console.log("3) Verdrahtung über echtes fetch (gestubbt)");
  try {
    stubFetch(false, true);
    const spy = CHART_BOOKS.find(b => b.id === "SPY")!;
    const m = await buildChartMarket(spy, "MAX", null, false);
    ok("Sektion 10 SPY: VIX-Reihe aus Yahoo", m.vol.length === 3 && m.vol.at(-1)?.value === 19.45, `vol=${m.vol.length} note=${m.volNote}`);
    ok("Sektion 10 SPY: Notiz", m.volNote === "VIX via Yahoo ^VIX (FRED VIXCLS leer)", String(m.volNote));
    ok("Yahoo-URL mit period1/period2/interval=1d", calls.some(u => /chart\/%5EVIX\?period1=\d+&period2=\d+&interval=1d/.test(u)));

    stubFetch(true, true);
    const m2 = await buildChartMarket(spy, "MAX", null, false);
    ok("FRED voll: Sektion 10 bleibt FRED, kein Yahoo-Call", m2.vol.at(-1)?.value === 17.1 && m2.volNote === null && !calls.some(u => u.includes("yahoo")));

    stubFetch(false, true);
    const qqq = CHART_BOOKS.find(b => b.id === "QQQ")!;
    const m3 = await buildChartMarket(qqq, "MAX", null, false);
    ok("QQQ (VXNCLS) unverändert: leer + 'FRED VXNCLS leer'", m3.vol.length === 0 && m3.volNote === "FRED VXNCLS leer", String(m3.volNote));

    stubFetch(false, true);
    const r = await markets.buildRegionMarket("US", "MAX" as any);
    ok("Sektion 9 US: VIX-Reihe aus Yahoo", r.vol.length === 3 && r.volLatest === 19.45, `vol=${r.vol.length} note=${r.volNote}`);
    ok("Sektion 9 US: Band aus Yahoo-Wert", r.volBand === "Complacency");
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
