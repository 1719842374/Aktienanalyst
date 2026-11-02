/**
 * Gewinnwachstum und Growth Gap (#/recession). Offline, plus ein Stub-HTTP-Lauf.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-recession-growth.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  GSTAR_NA_REASON,
  GROWTH_GAP_PARAMS,
  LLM_NA_REASON,
  buildGrowthBody,
  describeAnalystEstimates,
  emptyGrowthBody,
  epsPairFromYahooHtml,
  FORWARD_FORMULA_YAHOO_HTML,
  FORWARD_HORIZON,
  FORWARD_OUTLIER,
  GROWTH_HOLDINGS_PARAMS,
  alignConsensusToTtm,
  annualizedFwdPct,
  consensusForOneYear,
  forwardFromEps,
  forwardFromYahooQuoteSummary,
  yahooEpsContext,
  gapReading,
  growthChartPoints,
  growthFazit,
  holdingsFromYahooHtml,
  multplGrowthPrints,
  nextConsensusEps,
  realizedStats,
  sliceGrowthChart,
  weightedHoldingsForward,
  yoyFromAnnualEps,
  type RecessionGrowthBody,
} from "../shared/recession-growth";

(globalThis as any).React = React;

let n = 0;
const ok = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  n++;
  console.log(`✓ ${name}`);
};

const HTML = `
<table>
<tr><th>Date</th><th>Value</th></tr>
<tr><td>Sep 30, 2025</td><td>&#x2002; 16.87%</td></tr>
<tr><td>Just a moment</td><td>no</td></tr>
<tr><td>Jun 30, 2025</td><td>13.58%</td></tr>
<tr><td>not a date</td><td>4%</td></tr>
</table>`;

await ok("Multpl liest Prozent und lässt ungültige Zeilen weg", () => {
  const rows = multplGrowthPrints(HTML);
  assert.deepEqual(rows, [
    { date: "2025-06-30", yoyPct: 13.58 },
    { date: "2025-09-30", yoyPct: 16.87 },
  ]);
  assert.deepEqual(multplGrowthPrints("Just a moment"), []);
});

await ok("Jahres-YoY überspringt ein fehlendes Jahr und eine nicht positive Basis", () => {
  const rows = yoyFromAnnualEps([
    { date: "2018-12-31", eps: 10 },
    { date: "2020-12-31", eps: 20 },
    { date: "2021-12-31", eps: 22 },
    { date: "2022-12-31", eps: -1 },
    { date: "2023-12-31", eps: 5 },
  ]);
  assert.deepEqual(rows.map(r => r.date), ["2021-12-31"]);
  assert.ok(Math.abs(rows[0].yoyPct - 10) < 1e-9);
});

await ok("Forward ist Konsens/TTM − 1, sonst n/a ohne 0", () => {
  const g = forwardFromEps(110, 100, "2026-12-31", "FMP Test");
  assert.equal(g.available, true);
  if (g.available) {
    assert.ok(Math.abs(g.gFwdPct - 10) < 1e-9);
    assert.match(g.formula, /EPS_consensus \/ EPS_TTM/);
  }
  const zero = forwardFromEps(10, 0, "2026-12-31", "x");
  assert.equal(zero.available, false);
  assert.match(zero.available ? "" : zero.reason, /nicht positiv/);
  assert.equal(JSON.stringify(zero).includes("\"gFwdPct\""), false);
  assert.equal(nextConsensusEps([{ date: "2020-01-01", epsAvg: 5 }, { date: "2027-12-31", epsAvg: 8 }], "2026-11-02")?.eps, 8);
  assert.equal(nextConsensusEps([{ date: "2020-01-01", epsAvg: 5 }], "2026-11-02"), null);
});

function quarterly(): { date: string; yoyPct: number }[] {
  const out: { date: string; yoyPct: number }[] = [];
  for (let year = 2016; year <= 2025; year++) {
    for (const md of ["03-31", "06-30", "09-30", "12-31"]) {
      const date = `${year}-${md}`;
      if (date > "2025-09-30") continue;
      out.push({ date, yoyPct: date === "2025-09-30" ? 10 : 4 });
    }
  }
  return out;
}

await ok("Median, σ und Perzentil kommen aus dem 10J-Fenster", () => {
  const stats = realizedStats(quarterly());
  assert.equal(stats.available, true);
  if (!stats.available) return;
  assert.equal(stats.realizedPct, 10);
  assert.equal(stats.asOf, "2025-09-30");
  assert.ok(stats.prints >= GROWTH_GAP_PARAMS.minPrints);
  assert.ok(stats.std10y > 0);
  assert.equal(stats.coneHigh, stats.median10y + GROWTH_GAP_PARAMS.coneSigma * stats.std10y);
  assert.ok(stats.percentile > 50);
});

await ok("zu wenig Drucke bleiben n/a, nicht 0", () => {
  const stats = realizedStats([{ date: "2024-12-31", yoyPct: 5 }]);
  assert.equal(stats.available, false);
  if (!stats.available) assert.match(stats.reason, /^n\/a — /);
});

await ok("Growth Gap warnt ab 2σ und erfindet ohne Forward kein Gap", () => {
  const stats = realizedStats(quarterly());
  assert.equal(stats.available, true);
  if (!stats.available) return;
  const calm = gapReading(stats.realizedPct, "", stats);
  assert.equal(calm.available && calm.direction, "nahe_null");
  assert.equal(calm.available && calm.warn, false);
  const hot = gapReading(stats.realizedPct + stats.std10y * 3, "", stats);
  assert.equal(hot.available && hot.warn, true);
  assert.equal(hot.available && hot.direction, "positiv");
  const missing = gapReading(null, "n/a — Forward-Konsens: FMP nicht konfiguriert", stats);
  assert.equal(missing.available, false);
  if (!missing.available) assert.match(missing.reason, /FMP nicht konfiguriert/);
  assert.equal(JSON.stringify(missing).includes("gapPp"), false);
});

await ok("Chart hält den letzten Druck und interpoliert nicht", () => {
  const price = [
    { date: "2025-09-30", close: 100 },
    { date: "2025-10-31", close: 110 },
    { date: "2026-02-27", close: 120 },
  ];
  const points = growthChartPoints(price, [
    { date: "2025-06-30", yoyPct: 4 },
    { date: "2025-09-30", yoyPct: 10 },
  ], GROWTH_GAP_PARAMS.quarterMaxAgeDays);
  const byDate = Object.fromEntries(points.map(p => [p.date, p.yoyPct]));
  assert.equal(byDate["2025-09-30"], 10);
  assert.equal(byDate["2025-10-31"], 10);
  assert.equal(byDate["2026-02-27"], null);
  assert.ok(!points.some(p => p.yoyPct === 7));
  const sliced = sliceGrowthChart(points, "5Y", "2026-02-27");
  assert.equal(sliced.length, 3);
  assert.equal(sliceGrowthChart(points, "Max", "2026-02-27").length, 3);
});

await ok("g* und LLM bleiben n/a mit Grund, der Kurs bleibt", () => {
  const body = buildGrowthBody({
    index: "SPY",
    price: [{ date: "2025-10-31", close: 500 }],
    priceSource: "yahoo",
    priceError: null,
    realized: quarterly(),
    realizedSource: "Multpl",
    realizedError: null,
    realizedFrequency: "quarterly",
    forward: { available: false, reason: "n/a — Forward-Konsens: FMP nicht konfiguriert" },
    vixPoints: [],
    vixSource: "FRED VIXCLS",
    vixError: "n/a — VIX: Test",
  });
  assert.equal(body.gStar.available, false);
  if (!body.gStar.available) assert.equal(body.gStar.reason, GSTAR_NA_REASON);
  assert.equal(body.llm.reason, LLM_NA_REASON);
  assert.equal(body.impliedGap.available, false);
  assert.equal(body.chart.length, 1);
  assert.equal(body.chart[0].close, 500);
  const unknown = emptyGrowthBody("n/a — unbekannter Index (erlaubt: SPY, VGK, ASHR)");
  assert.equal(unknown.index, null);
  assert.equal(unknown.chart.length, 0);
});

await ok("Cache speichert einen vollständigen Körper nur einmal", async () => {
  const { getRecessionGrowth, resetRecessionGrowthCache } = await import("../server/recession-growth-route");
  resetRecessionGrowthCache();
  let calls = 0;
  const body = buildGrowthBody({
    index: "VGK",
    price: [{ date: "2025-10-31", close: 70 }],
    priceSource: "yahoo",
    priceError: null,
    realized: quarterly(),
    realizedSource: "FMP",
    realizedError: null,
    realizedFrequency: "annual",
    forward: { available: false, reason: "n/a — Forward-Konsens: FMP nicht konfiguriert" },
    vixPoints: [],
    vixSource: "FRED VIXCLS",
    vixError: "n/a — kein VIX",
  });
  const load = async () => { calls++; return body; };
  await getRecessionGrowth("VGK", { now: 1, ttlMs: 1000, load });
  await getRecessionGrowth("VGK", { now: 2, ttlMs: 1000, load });
  assert.equal(calls, 1);
});

await ok("leerer Fehlschlag wird nicht gecacht", async () => {
  const { getRecessionGrowth, resetRecessionGrowthCache } = await import("../server/recession-growth-route");
  resetRecessionGrowthCache();
  let calls = 0;
  const load = async () => { calls++; return emptyGrowthBody("n/a — Multpl nicht erreichbar"); };
  await getRecessionGrowth("ASHR", { now: 10, ttlMs: 1000, load });
  await getRecessionGrowth("ASHR", { now: 11, ttlMs: 1000, load });
  assert.equal(calls, 2);
});

function yahooChart(): string {
  const start = Date.parse("2025-01-02T00:00:00Z") / 1000;
  const timestamp: number[] = [];
  const close: number[] = [];
  for (let i = 0; i < 450; i++) {
    timestamp.push(start + i * 86400);
    close.push(400 + i * 0.1);
  }
  return JSON.stringify({ chart: { result: [{ timestamp, indicators: { quote: [{ close, open: close, high: close, low: close, volume: close.map(() => 1) }] } }] } });
}

function vixCsv(): string {
  const lines = ["observation_date,VIXCLS"];
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.UTC(2024, 0, 2) + i * 86400000);
    lines.push(`${d.toISOString().slice(0, 10)},${12 + (i % 7)}`);
  }
  return lines.join("\n");
}

function multplTable(): string {
  const rows = quarterly().map(p => {
    const [y, m, d] = p.date.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `<tr><td>${months[Number(m) - 1]} ${Number(d)}, ${y}</td><td>${p.yoyPct.toFixed(2)}%</td></tr>`;
  });
  return `<table>${rows.join("")}</table>`;
}

await ok("HTTP-Kette: beide Pfade, n/a ohne erfundene Lücke", async () => {
  const express = (await import("express")).default;
  const { registerRecessionGrowthRoutes, resetRecessionGrowthCache } = await import("../server/recession-growth-route");
  const { setYahooHtmlEnabledForTests } = await import("../server/recession-growth");
  setYahooHtmlEnabledForTests(false);
  resetRecessionGrowthCache();
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("multpl.com")) return new Response(multplTable(), { status: 200, headers: { "content-type": "text/html" } });
    if (u.includes("finance.yahoo.com")) return new Response(yahooChart(), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("fred.stlouisfed.org")) return new Response(vixCsv(), { status: 200, headers: { "content-type": "text/csv" } });
    throw new Error(`unerwartet ${u.slice(0, 80)}`);
  }) as typeof fetch;
  delete process.env.FMP_API_KEY;
  const app = express();
  registerRecessionGrowthRoutes(app);
  const server = await new Promise<import("node:http").Server>(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const port = (server.address() as { port: number }).port;
    const plotRes = await orig(`http://127.0.0.1:${port}/api/recession/earnings-growth/SPY`);
    const gapRes = await orig(`http://127.0.0.1:${port}/api/recession/growth-gap/SPY`);
    const unknown = await orig(`http://127.0.0.1:${port}/api/recession/earnings-growth/QQQ`);
    const plot = await plotRes.json() as RecessionGrowthBody;
    const gap = await gapRes.json() as RecessionGrowthBody;
    const other = await unknown.json() as RecessionGrowthBody;
    assert.equal(plotRes.status, 200);
    assert.equal(gapRes.status, 200);
    assert.equal(plot.index, "SPY");
    assert.equal(plot.stats.available, true);
    assert.equal(gap.growthGap.available, false);
    if (!gap.growthGap.available) assert.match(gap.growthGap.reason, /FMP nicht konfiguriert/);
    assert.equal(gap.gStar.available, false);
    if (!gap.gStar.available) assert.equal(gap.gStar.reason, GSTAR_NA_REASON);
    assert.equal(plot.chart.some(p => p.yoyPct === 10), true);
    assert.equal(plot.chart.some(p => p.yoyPct == null), true);
    assert.equal(plot.chart.some(p => p.yoyPct === 7), false);
    assert.equal(plot.vix.available, true);
    assert.equal(other.index, null);
    assert.match(other.priceError ?? "", /unbekannter Index/);
    assert.equal(JSON.stringify(gap.growthGap).includes("\"gapPp\":0"), false);
  } finally {
    const { setYahooHtmlEnabledForTests } = await import("../server/recession-growth");
    setYahooHtmlEnabledForTests(true);
    globalThis.fetch = orig;
    await new Promise(resolve => server.close(() => resolve(null)));
  }
});

await ok("Karte zeigt den Gap-Grund und kein erfundenes g*", async () => {
  const body = buildGrowthBody({
    index: "SPY",
    price: [{ date: "2025-10-31", close: 500 }, { date: "2025-09-30", close: 490 }],
    priceSource: "yahoo",
    priceError: null,
    realized: quarterly(),
    realizedSource: "Multpl",
    realizedError: null,
    realizedFrequency: "quarterly",
    forward: { available: false, reason: "n/a — Forward-Konsens: FMP nicht konfiguriert" },
    vixPoints: [],
    vixSource: "FRED VIXCLS",
    vixError: "n/a — VIX: Test",
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  client.setQueryData(["/api/recession/earnings-growth", "SPY"], body);
  client.setQueryData(["/api/recession/growth-gap", "SPY"], body);
  const { RecessionGrowthSection } = await import("../client/src/components/recession/RecessionGrowthSection");
  const html = renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(RecessionGrowthSection, { number: 17 })),
  );
  assert.match(html, /Gewinnwachstum &amp; Growth Gap|Gewinnwachstum & Growth Gap/);
  assert.match(html, /FMP nicht konfiguriert/);
  assert.match(html, /braucht Philip/);
  assert.equal(html.includes(">+0,0 %<") || html.includes(">0,0 %<"), false);
  assert.match(html, /data-testid="recession-growth-gap"/);
  assert.match(html, /data-testid="recession-growth-fazit"/);
  assert.match(html, /nearZeroSigma|coneSigma/);
  assert.match(html, /EPS_t \/ EPS_/);
});

await ok("Yahoo +1y/trailingEps ist der Quotient, fehlendes Modul bleibt n/a", () => {
  const raw = {
    defaultKeyStatistics: { trailingEps: { raw: 8.72 } },
    earningsTrend: { trend: [{ period: "+1y", endDate: "2027-09-30", earningsEstimate: { avg: { raw: 9.5687 }, growth: { raw: 0.0806 } } }] },
  };
  const g = forwardFromYahooQuoteSummary(raw, "2026-11-02", "Yahoo Test");
  assert.equal(g.available, true);
  if (g.available) {
    assert.ok(Math.abs(g.gFwdPct - (9.5687 / 8.72 - 1) * 100) < 1e-9);
    assert.match(g.formula, /trailingEps/);
  }
  const missing = forwardFromYahooQuoteSummary({ defaultKeyStatistics: {} }, "2026-11-02", "Yahoo Test");
  assert.equal(missing.available, false);
  if (!missing.available) assert.match(missing.reason, /earningsTrend fehlt/);
  assert.equal(describeAnalystEstimates([], "2026-11-02"), "0 Zeilen");
  assert.match(describeAnalystEstimates([{ date: "2027-12-31", revenueAvg: 1 }], "2026-11-02"), /keine EPS-Felder/);
  const html = String.raw`{\"symbol\":\"NVDA\",\"holdingName\":\"Nvidia\",\"holdingPercent\":{\"raw\":0.0836162,\"fmt\":\"8.36%\"}},{\"symbol\":\"AAPL\",\"holdingName\":\"Apple Inc\",\"holdingPercent\":{\"raw\":0.0735303}}`;
  const rows = holdingsFromYahooHtml(html);
  assert.deepEqual(rows.map(r => r.symbol), ["NVDA", "AAPL"]);
  assert.ok(Math.abs(rows[0].weight - 0.0836162) < 1e-9);
  const pair = epsPairFromYahooHtml(String.raw`\"trailingEps\":{\"raw\":8.72},\"forwardEps\":{\"raw\":9.55226}`);
  const fromHtml = forwardFromEps(pair.forward, pair.trailing, "2026-11-02", "Yahoo Quote-HTML", FORWARD_FORMULA_YAHOO_HTML);
  assert.equal(fromHtml.available, true);
  if (fromHtml.available) {
    assert.ok(Math.abs(fromHtml.gFwdPct - (9.55226 / 8.72 - 1) * 100) < 1e-9);
    assert.equal(fromHtml.formula, FORWARD_FORMULA_YAHOO_HTML);
  }
});

await ok("Horizont über ein Jahr wird auf ein Jahr gerechnet, der nächste Stub nicht", () => {
  const raw = [
    { date: "2026-12-31", epsAvg: 105 },
    { date: "2027-12-31", epsAvg: 121 },
    { date: "2024-12-31", epsAvg: 80 },
  ];
  const picked = consensusForOneYear(raw, "2026-11-02");
  assert.equal(picked?.date, "2027-12-31");
  assert.ok(picked != null && picked.horizonDays <= FORWARD_HORIZON.annualizeAfterDays);
  const plain = annualizedFwdPct(121, 100, picked?.horizonDays ?? 0);
  assert.equal(plain.annualized, false);
  assert.ok(Math.abs(plain.gFwdPct - 21) < 1e-9);
  const long = annualizedFwdPct(121, 100, FORWARD_HORIZON.annualizeAfterDays + 40);
  assert.equal(long.annualized, true);
  const years = (FORWARD_HORIZON.annualizeAfterDays + 40) / FORWARD_HORIZON.oneYearDays;
  assert.ok(Math.abs(long.gFwdPct - ((1.21 ** (1 / years) - 1) * 100)) < 1e-9);
});

await ok("unterschiedliche EPS-Währungen werden umgerechnet, Pence gegen Pfund auch", () => {
  const pence = alignConsensusToTtm(140, "GBp", 1.4, "GBP", null);
  assert.ok(!("error" in pence));
  if (!("error" in pence)) {
    assert.ok(Math.abs(pence.consensus - 1.4) < 1e-9);
    assert.equal(pence.currency, "GBP");
  }
  const fx = alignConsensusToTtm(10, "EUR", 10, "USD", { EUR: 0.8, USD: 1 });
  assert.ok(!("error" in fx));
  if (!("error" in fx)) {
    assert.ok(Math.abs(fx.consensus - 12.5) < 1e-9);
    assert.equal(fx.currency, "USD");
  }
  const missing = alignConsensusToTtm(10, "EUR", 10, "CNY", null);
  assert.ok("error" in missing);
  const html = String.raw`\"currency\":\"GBp\",\"symbol\":\"HSBA.L\" \"financialCurrency\":\"USD\" \"trailingEps\":{\"raw\":1.14},\"forwardEps\":{\"raw\":1.4}`;
  const ctx = yahooEpsContext(html, "HSBA.L");
  assert.equal(ctx.quoteCurrency, "GBp");
  assert.equal(ctx.financialCurrency, "USD");
  assert.equal(ctx.trailing, 1.14);
  assert.equal(ctx.forward, 1.4);
});

await ok("ein einzelnes Holding bleibt n/a, zwei Holdings werden gewichtet", () => {
  const one = weightedHoldingsForward([{ symbol: "AAA", weight: 0.2, gFwdPct: 5 }]);
  assert.equal(one.available, false);
  const two = weightedHoldingsForward([
    { symbol: "AAA", weight: 0.2, gFwdPct: 20 },
    { symbol: "BBB", weight: 0.1, gFwdPct: 10 },
  ]);
  assert.equal(two.available, true);
  if (two.available) {
    assert.ok(Math.abs(two.gFwdPct - (0.2 * 20 + 0.1 * 10) / 0.3) < 1e-9);
    assert.match(two.coverageWarn ?? "", /warnCoverage/);
  }
  const thin = weightedHoldingsForward([
    { symbol: "AAA", weight: 0.05, gFwdPct: 20 },
    { symbol: "BBB", weight: 0.05, gFwdPct: 10 },
  ]);
  assert.equal(thin.available, false);
  if (!thin.available) assert.match(thin.reason, /minCoverage/);
  const basket = weightedHoldingsForward([
    { symbol: "A", weight: 0.1, gFwdPct: 10 },
    { symbol: "B", weight: 0.1, gFwdPct: 12 },
    { symbol: "C", weight: 0.1, gFwdPct: 11 },
    { symbol: "D", weight: 0.1, gFwdPct: 9 },
    { symbol: "E", weight: 0.1, gFwdPct: 400 },
  ]);
  assert.equal(basket.available, true);
  if (basket.available) {
    assert.deepEqual(basket.dropped, ["E"]);
    assert.ok(Math.abs(basket.gFwdPct - (10 + 12 + 11 + 9) / 4) < 1e-9);
    assert.ok(basket.note.includes(String(FORWARD_OUTLIER.robustZMax)));
  }
  assert.equal(GROWTH_HOLDINGS_PARAMS.minCoverage, 0.15);
  assert.equal(GROWTH_HOLDINGS_PARAMS.warnCoverage, 0.5);
  const ashr = weightedHoldingsForward([
    { symbol: "300308.SZ", weight: 0.0364, gFwdPct: 184.7 },
    { symbol: "600519.SS", weight: 0.0318, gFwdPct: 10.7 },
    { symbol: "300750.SZ", weight: 0.0312, gFwdPct: 21.6 },
    { symbol: "300502.SZ", weight: 0.0221, gFwdPct: 242.1 },
    { symbol: "600036.SS", weight: 0.0208, gFwdPct: 7.7 },
    { symbol: "601899.SS", weight: 0.0199, gFwdPct: 29.0 },
    { symbol: "603259.SS", weight: 0.0169, gFwdPct: 13.6 },
    { symbol: "000333.SZ", weight: 0.0162, gFwdPct: 2.1 },
    { symbol: "600900.SS", weight: 0.0142, gFwdPct: 0.5 },
  ]);
  assert.equal(ashr.available, true);
  if (ashr.available) {
    assert.ok(Math.abs(ashr.gFwdPct - 13.393377483443711) < 1e-9, String(ashr.gFwdPct));
    assert.deepEqual(ashr.dropped, ["300308.SZ", "300502.SZ"]);
  }
});

await ok("MAD 0 schaltet auf meanAD um und wirft nicht jeden Nicht-Median hinaus", () => {
  assert.equal(FORWARD_OUTLIER.madZeroFallback, "meanAD");
  const flat = weightedHoldingsForward([
    { symbol: "A", weight: 0.2, gFwdPct: 10 },
    { symbol: "B", weight: 0.2, gFwdPct: 10 },
    { symbol: "C", weight: 0.2, gFwdPct: 10 },
    { symbol: "D", weight: 0.2, gFwdPct: 12 },
    { symbol: "E", weight: 0.2, gFwdPct: 400 },
  ]);
  assert.equal(flat.available, true);
  if (flat.available) {
    assert.deepEqual(flat.dropped, ["E"]);
    assert.ok(flat.used.includes("D"));
    assert.ok(Math.abs(flat.gFwdPct - (10 + 10 + 10 + 12) / 4) < 1e-9);
    assert.match(flat.note, /meanAD/);
  }
  const identical = weightedHoldingsForward([
    { symbol: "A", weight: 0.2, gFwdPct: 10 },
    { symbol: "B", weight: 0.2, gFwdPct: 10 },
    { symbol: "C", weight: 0.2, gFwdPct: 10 },
    { symbol: "D", weight: 0.2, gFwdPct: 10 },
  ]);
  assert.equal(identical.available, true);
  if (identical.available) {
    assert.deepEqual(identical.dropped, []);
    assert.ok(Math.abs(identical.gFwdPct - 10) < 1e-9);
  }
});

await ok("Fazit liest Median-z an nearZeroSigma und coneSigma, nicht an festen Pp", () => {
  const stats = realizedStats(quarterly());
  assert.equal(stats.available, true);
  if (!stats.available) return;
  const calm = growthFazit(stats, gapReading(stats.realizedPct, "", stats));
  assert.equal(calm.available, true);
  if (calm.available) {
    assert.match(calm.text, /nearZeroSigma/);
    assert.match(calm.text, /coneSigma/);
    assert.equal(calm.gapBand, "innerhalb_nearZero");
  }
  const hot = growthFazit(stats, gapReading(stats.realizedPct + stats.std10y * (GROWTH_GAP_PARAMS.coneSigma + 0.5), "", stats));
  assert.equal(hot.available, true);
  if (hot.available) assert.equal(hot.gapBand, "ausserhalb_cone");
  const missing = growthFazit(stats, { available: false, reason: "n/a — Forward-Konsens: Test" });
  assert.equal(missing.available, true);
  if (missing.available) {
    assert.equal(missing.gapBand, null);
    assert.match(missing.text, /Forward-Konsens: Test/);
  }
});

await ok("402 am Index fällt auf Holdings-Konsens, Direkt-Treffer fragt Holdings nicht", async () => {
  const { loadRecessionGrowth } = await import("../server/recession-growth");
  const probes: string[] = [];
  const probe = async (path: string, params: Record<string, string>) => {
    probes.push(`${path}:${params.symbol ?? ""}:${params.period ?? ""}:${params.limit ?? ""}`);
    const symbol = params.symbol;
    if (path === "/analyst-estimates" && symbol === "SPY") return { status: 200, json: [], detail: "" };
    if (path === "/analyst-estimates" && symbol === "^GSPC") return { status: 402, json: null, detail: "Premium Query Parameter: symbol" };
    if (path === "/financial-estimates") return { status: 402, json: null, detail: "Premium Query Parameter" };
    if (path === "/etf/holdings") return { status: 402, json: null, detail: "Premium Query Parameter: ETF holdings" };
    if (path === "/earnings") return { status: 200, json: [{ date: "2026-12-31", epsEstimated: 2 }], detail: "" };
    if (path === "/analyst-estimates" && (symbol === "AAA" || symbol === "BBB")) {
      return { status: 200, json: [{ date: "2027-12-31", epsAvg: symbol === "AAA" ? 12 : 22 }], detail: "" };
    }
    if (path === "/ratios-ttm" && (symbol === "AAA" || symbol === "BBB")) {
      return { status: 200, json: [{ netIncomePerShareTTM: symbol === "AAA" ? 10 : 20 }], detail: "" };
    }
    return { status: 404, json: null, detail: "unbekannt" };
  };
  const deps = {
    loadBars: async () => ({ bars: [{ date: "2025-10-31", close: 500 }], source: "yahoo" as const, error: null }),
    fetchMultpl: async () => multplTable(),
    probeFmp: probe,
    loadIncome: async () => [],
    loadYahooSummary: async (_symbol: string, modules: readonly string[]) => {
      if (modules.includes("topHoldings")) {
        return { topHoldings: { holdings: [
          { symbol: "AAA", holdingPercent: { raw: 0.2 } },
          { symbol: "BBB", holdingPercent: { raw: 0.1 } },
        ] } };
      }
      return { defaultKeyStatistics: {} };
    },
    loadVix: async () => [],
    fmpAvailable: true,
    today: "2026-11-02",
  };
  const mixed = await loadRecessionGrowth("SPY", deps);
  assert.equal(mixed.forward.available, true);
  if (mixed.forward.available) {
    assert.ok(Math.abs(mixed.forward.gFwdPct - (0.2 * 20 + 0.1 * 10) / 0.3) < 1e-6);
    assert.match(mixed.forward.formula, /Σ/);
    assert.match(mixed.forward.source, /Yahoo quoteSummary topHoldings/);
  }
  assert.match(mixed.consensusTrace, /HTTP 402/);
  assert.match(mixed.consensusTrace, /Premium Query Parameter/);
  assert.match(mixed.consensusTrace, /v3 nicht abgefragt/);
  assert.match(mixed.consensusTrace, /Berichtstermine/);
  assert.equal(probes.some(p => p.startsWith("/analyst-estimates:^GSPC") && p.endsWith(":")), true);
  assert.equal(mixed.growthGap.available, true);
  assert.equal(mixed.fazit.available, true);
  if (mixed.fazit.available) assert.match(mixed.fazit.text, /Growth Gap/);

  const directProbes: string[] = [];
  const direct = await loadRecessionGrowth("SPY", {
    ...deps,
    probeFmp: async (path, params) => {
      directProbes.push(path);
      if (path === "/analyst-estimates" && params.symbol === "SPY") return { status: 200, json: [{ date: "2027-12-31", epsAvg: 110 }], detail: "" };
      if (path === "/ratios-ttm" && params.symbol === "SPY") return { status: 200, json: [{ netIncomePerShareTTM: 100 }], detail: "" };
      return { status: 500, json: null, detail: "soll nicht laufen" };
    },
  });
  assert.equal(direct.forward.available, true);
  if (direct.forward.available) assert.ok(Math.abs(direct.forward.gFwdPct - 10) < 1e-9);
  assert.equal(directProbes.includes("/etf/holdings"), false);
});

await ok("Deckung unter minCoverage bleibt am Yahoo-Fallback und in der n/a-Zeile sichtbar", async () => {
  const { loadRecessionGrowth } = await import("../server/recession-growth");
  const yahooTrend = {
    defaultKeyStatistics: { trailingEps: { raw: 10 } },
    earningsTrend: { trend: [{ period: "+1y", endDate: "2027-09-30", earningsEstimate: { avg: { raw: 11 }, growth: { raw: 0.1 } } }] },
  };
  const base = {
    loadBars: async () => ({ bars: [{ date: "2025-10-31", close: 20 }], source: "yahoo" as const, error: null }),
    fetchMultpl: async () => "",
    loadIncome: async () => [],
    loadYahooHtml: async () => ({ status: null, html: null, error: "im Test aus" }),
    loadVix: async () => [],
    fmpAvailable: true,
    today: "2026-11-02",
  };
  const probe = async (path: string, params: Record<string, string>) => {
    const symbol = params.symbol;
    if (path === "/analyst-estimates" && symbol === "ASHR") return { status: 200, json: [], detail: "" };
    if (path === "/financial-estimates") return { status: 404, json: null, detail: "" };
    if (path === "/earnings") return { status: 200, json: [], detail: "" };
    if (path === "/etf/holdings") return { status: 402, json: null, detail: "Premium Query Parameter: ETF holdings" };
    if (path === "/analyst-estimates" && (symbol === "AAA" || symbol === "BBB")) {
      return { status: 200, json: [{ date: "2027-12-31", epsAvg: 12 }], detail: "" };
    }
    if (path === "/ratios-ttm" && (symbol === "AAA" || symbol === "BBB")) {
      return { status: 200, json: [{ netIncomePerShareTTM: 10 }], detail: "" };
    }
    return { status: 404, json: null, detail: "unbekannt" };
  };
  const shown = await loadRecessionGrowth("ASHR", {
    ...base,
    probeFmp: probe,
    loadYahooSummary: async (symbol: string, modules: readonly string[]) => {
      if (modules.includes("topHoldings")) {
        return { topHoldings: { holdings: [
          { symbol: "AAA", holdingPercent: { raw: 0.05 } },
          { symbol: "BBB", holdingPercent: { raw: 0.06 } },
        ] } };
      }
      if (symbol === "ASHR") return yahooTrend;
      return { defaultKeyStatistics: {} };
    },
  });
  assert.equal(shown.forward.available, true);
  if (shown.forward.available) {
    assert.ok(Math.abs(shown.forward.gFwdPct - 10) < 1e-9);
    assert.match(shown.forward.coverageWarn ?? "", /minCoverage/);
    assert.match(shown.forward.coverageWarn ?? "", /Deckung/);
    assert.match(shown.forward.source, /minCoverage/);
  }
  const hidden = await loadRecessionGrowth("ASHR", {
    ...base,
    probeFmp: probe,
    loadYahooSummary: async (_symbol: string, modules: readonly string[]) => {
      if (modules.includes("topHoldings")) {
        return { topHoldings: { holdings: [
          { symbol: "AAA", holdingPercent: { raw: 0.05 } },
          { symbol: "BBB", holdingPercent: { raw: 0.06 } },
        ] } };
      }
      return { defaultKeyStatistics: {} };
    },
  });
  assert.equal(hidden.forward.available, false);
  if (!hidden.forward.available) {
    assert.match(hidden.forward.reason, /minCoverage/);
    assert.match(hidden.forward.reason, /Deckung/);
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  client.setQueryData(["/api/recession/earnings-growth", "SPY"], hidden);
  client.setQueryData(["/api/recession/growth-gap", "SPY"], hidden);
  const { RecessionGrowthSection } = await import("../client/src/components/recession/RecessionGrowthSection");
  const html = renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(RecessionGrowthSection, { number: 17 })),
  );
  assert.match(html, /data-testid="recession-growth-coverage"/);
  assert.match(html, /minCoverage/);
});

await ok("Pins und Score-Pfade bleiben", () => {
  const head = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
  const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
  assert.equal(round6(head.VWAGY.overallScore), 4.735718);
  assert.equal(round6(head.SAP.overallScore), 5.174758);
  assert.equal(round6(head.MSFT.overallScore), 4.058138);
  const glued = [
    "shared/recession-growth.ts",
    "server/recession-growth.ts",
    "server/recession-growth-route.ts",
    "client/src/components/recession/RecessionGrowthSection.tsx",
    "client/src/hooks/useRecessionGrowth.ts",
  ].map(p => readFileSync(p, "utf8")).join("\n");
  assert.equal(/analyze-route|scoring-gates|researcher\.ts/.test(glued), false);
  assert.match(readFileSync("client/src/pages/RecessionDashboard.tsx", "utf8"), /RecessionGrowthSection/);
  assert.match(readFileSync("client/src/hooks/useRecessionGrowth.ts", "utf8"), /\/api\/recession\/earnings-growth/);
  assert.match(readFileSync("client/src/hooks/useRecessionGrowth.ts", "utf8"), /\/api\/recession\/growth-gap/);
  assert.equal(/queryFn\s*:/.test(readFileSync("client/src/hooks/useRecessionGrowth.ts", "utf8")), false);
});

console.log(`\n${n} checks passed`);
