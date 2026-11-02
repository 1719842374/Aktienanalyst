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
  EPS_BASIS,
  FORWARD_FORMULA_EPS,
  FORWARD_FORMULA_YAHOO_HTML,
  FORWARD_HORIZON,
  FORWARD_OUTLIER,
  GROWTH_HOLDINGS_PARAMS,
  adjTtmFromEarnings,
  adjTtmFromYahooAdjusted,
  completeEpsCurrencies,
  consensusFromYahooAdjusted,
  provedAdjustedFiscalYear,
  resolveAdjustedFmpQuarters,
  alignConsensusToTtm,
  annualizedFwdPct,
  consensusForOneYear,
  horizonDays,
  midToMidDays,
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

function powerPct(cons: number, adj: number, t: number): number {
  return ((cons / adj) ** (365 / t) - 1) * 100;
}

await ok("NVDA 84 Tage bis FY-Ende ergibt t=266, META 59 Tage ergibt t=241, t=40 und t=449 ohne Floor und Cap", () => {
  assert.equal(FORWARD_HORIZON.oneYearDays, 365);
  assert.equal(FORWARD_HORIZON.midYearDays, 182);
  assert.equal("stubBelowDays" in FORWARD_HORIZON, false);
  const asOf = "2026-11-02";
  assert.equal(horizonDays(asOf, "2026-12-12"), 40);
  assert.equal(horizonDays(asOf, "2026-12-31"), 59);
  assert.equal(horizonDays(asOf, "2027-01-25"), 84);
  assert.equal(horizonDays(asOf, "2028-01-25"), 449);
  assert.equal(midToMidDays(84), 266);
  assert.equal(midToMidDays(59), 241);
  assert.equal(midToMidDays(40), 222);
  assert.equal(midToMidDays(449), 631);
  for (const t of [40, 449]) {
    const g = annualizedFwdPct(2, 1, t);
    assert.ok("gFwdPct" in g);
    if ("gFwdPct" in g) {
      assert.ok(Math.abs(g.gFwdPct - powerPct(2, 1, t)) < 1e-6, String(g.gFwdPct));
      const floored = powerPct(2, 1, Math.max(t, 90));
      const capped = powerPct(2, 1, Math.min(t, 365));
      if (t < 90) assert.ok(Math.abs(g.gFwdPct - floored) > 1);
      if (t > 365) assert.ok(Math.abs(g.gFwdPct - capped) > 1);
      const linearPct = (2 / 1 - 1) * (365 / t) * 100;
      const epsPerYear = ((2 - 1) / t) * 365;
      assert.ok(Math.abs(g.gFwdPct - linearPct) > 1, `t=${t} g=${g.gFwdPct} linear=${linearPct}`);
      assert.ok(Math.abs(g.gFwdPct - epsPerYear) > 1);
    }
  }
  const nvda = consensusForOneYear([
    { date: "2027-01-25", epsAvg: 2 },
    { date: "2028-01-25", epsAvg: 9 },
  ], asOf);
  assert.equal(nvda?.date, "2027-01-25");
  assert.equal(nvda?.eps, 2);
  assert.equal(nvda?.daysToFyEnd, 84);
  assert.equal(nvda?.horizonDays, 266);
  const meta = consensusForOneYear([
    { date: "2026-12-31", epsAvg: 4 },
    { date: "2027-12-31", epsAvg: 8 },
  ], asOf);
  assert.equal(meta?.date, "2026-12-31");
  assert.equal(meta?.eps, 4);
  assert.equal(meta?.daysToFyEnd, 59);
  assert.equal(meta?.horizonDays, 241);
  const sameDay = consensusForOneYear([
    { date: "2026-11-02", epsAvg: 3 },
    { date: "2027-11-02", epsAvg: 9 },
  ], asOf);
  assert.equal(sameDay?.date, "2026-11-02");
  assert.equal(sameDay?.daysToFyEnd, 0);
  assert.equal(sameDay?.horizonDays, 182);
  const onlyLong = consensusForOneYear([{ date: "2028-01-25", epsAvg: 5 }], asOf);
  assert.equal(onlyLong?.daysToFyEnd, 449);
  assert.equal(onlyLong?.horizonDays, 631);
  assert.equal(onlyLong?.eps, 5);
  const nearNeg = consensusForOneYear([
    { date: "2026-12-12", epsAvg: -1 },
    { date: "2028-01-25", epsAvg: 5 },
  ], asOf);
  assert.equal(nearNeg?.date, "2026-12-12");
  assert.equal(nearNeg?.eps, -1);
  assert.equal(nearNeg?.horizonDays, 222);
  const negCons = annualizedFwdPct(-1, 4, 40);
  assert.ok("reason" in negCons);
  if ("reason" in negCons) assert.match(negCons.reason, /nicht positiv/);
  const negTtm = annualizedFwdPct(5, -2, 84);
  assert.ok("reason" in negTtm);
  if ("reason" in negTtm) assert.match(negTtm.reason, /adjTTM ≤ 0/);
});

await ok("AVGO-Stub bleibt das nahe FY, Gewicht ist Index × min(1, t/365) × Huber", async () => {
  const avgoAsOf = "2026-09-01";
  assert.equal(horizonDays(avgoAsOf, "2026-11-01"), 61);
  const avgo = consensusForOneYear([
    { date: "2026-11-01", epsAvg: 4.2 },
    { date: "2027-11-01", epsAvg: 6.1 },
  ], avgoAsOf);
  assert.equal(avgo?.date, "2026-11-01");
  assert.equal(avgo?.eps, 4.2);
  assert.equal(avgo?.daysToFyEnd, 61);
  assert.equal(avgo?.horizonDays, 243);
  const g40 = annualizedFwdPct(3, 4, 40);
  const g84 = annualizedFwdPct(6, 4, 84);
  const g449 = annualizedFwdPct(7, 6, 449);
  assert.ok("gFwdPct" in g40 && "gFwdPct" in g84 && "gFwdPct" in g449);
  if (!("gFwdPct" in g40) || !("gFwdPct" in g84) || !("gFwdPct" in g449)) return;
  const weighted = weightedHoldingsForward([
    { symbol: "AVGO", weight: 0.2, gFwdPct: g40.gFwdPct, tDays: 40, source: "FMP /stable/earnings AVGO" },
    { symbol: "T84", weight: 0.15, gFwdPct: g84.gFwdPct, tDays: 84, source: "FMP /stable/earnings T84" },
    { symbol: "LONG", weight: 0.12, gFwdPct: g449.gFwdPct, tDays: 449, source: "FMP /stable/earnings LONG" },
    { symbol: "NEG", weight: 0.05, gFwdPct: null, tDays: 84, source: null, excludeReason: "n/a — adjTTM ≤ 0" },
  ]);
  assert.equal(weighted.available, true);
  if (!weighted.available) return;
  const w40 = 0.2 * (40 / 365);
  const w84 = 0.15 * (84 / 365);
  const w449 = 0.12 * Math.min(1, 449 / 365);
  const expectG = (w40 * g40.gFwdPct + w84 * g84.gFwdPct + w449 * g449.gFwdPct) / (w40 + w84 + w449);
  assert.ok(Math.abs(weighted.gFwdPct - expectG) < 1e-6, String(weighted.gFwdPct));
  const bySymbol = Object.fromEntries(weighted.lines.map(line => [line.symbol, line]));
  assert.ok(Math.abs((bySymbol.AVGO.gAnnPct ?? 0) - g40.gFwdPct) < 1e-9);
  assert.ok(Math.abs((bySymbol.AVGO.weight ?? 0) - w40) < 1e-12);
  assert.equal(bySymbol.AVGO.tDays, 40);
  assert.equal(bySymbol.AVGO.source, "FMP /stable/earnings AVGO");
  assert.ok(Math.abs((bySymbol.T84.gAnnPct ?? 0) - g84.gFwdPct) < 1e-9);
  assert.equal(bySymbol.T84.tDays, 84);
  assert.ok(Math.abs((bySymbol.LONG.weight ?? 0) - w449) < 1e-12);
  assert.equal(bySymbol.LONG.tDays, 449);
  assert.equal(bySymbol.LONG.source, "FMP /stable/earnings LONG");
  assert.equal(bySymbol.NEG.gAnnPct, null);
  assert.equal(bySymbol.NEG.weight, null);
  assert.equal(bySymbol.NEG.source, null);
  assert.match(bySymbol.NEG.excludeReason ?? "", /adjTTM ≤ 0/);
  assert.match(weighted.note, /technische Stabilisierung/);
  assert.match(weighted.note, /NEG \(adjTTM ≤ 0\)/);
  assert.match(weighted.coverageWarn ?? "", /NEG 5,00 % \(adjTTM ≤ 0\)|NEG 5,0 % \(adjTTM ≤ 0\)/);
  const amznAdj = powerPct(6, 4, 266);
  const amznGaap = powerPct(6, 8, 266);
  assert.ok(Math.abs(amznAdj - amznGaap) > 1);
  const googlAdj = powerPct(7, 6, 631);
  const googlGaap = powerPct(7, 10, 631);
  assert.ok(googlAdj > 0);
  assert.ok(googlGaap < 0);
  const gaapGoogl = powerPct(7, 10, 449);
  assert.ok(g449.gFwdPct > 0);
  assert.ok(gaapGoogl < 0);
  assert.ok(Math.abs(g449.gFwdPct - gaapGoogl) > 1);
  const shown = buildGrowthBody({
    index: "SPY",
    price: [{ date: "2025-10-31", close: 500 }],
    priceSource: "yahoo",
    priceError: null,
    realized: [],
    realizedSource: "FMP",
    realizedError: "n/a — Test",
    realizedFrequency: null,
    forward: {
      available: true,
      gFwdPct: weighted.gFwdPct,
      epsConsensus: null,
      epsTtm: null,
      asOf: "2026-11-02",
      source: weighted.note,
      formula: weighted.formula,
      coverageWarn: weighted.coverageWarn,
      lines: weighted.lines,
    },
    vixPoints: [],
    vixSource: "FRED VIXCLS",
    vixError: "n/a — VIX nur am S&P",
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  client.setQueryData(["/api/recession/earnings-growth", "SPY"], shown);
  client.setQueryData(["/api/recession/growth-gap", "SPY"], shown);
  const { RecessionGrowthSection } = await import("../client/src/components/recession/RecessionGrowthSection");
  const html = renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(RecessionGrowthSection, { number: 17 })),
  );
  const visible = html.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
  assert.match(visible, /t 40 Tage/);
  assert.match(visible, /t 449 Tage/);
  assert.match(visible, /Quelle/);
  assert.match(visible, /FMP \/stable\/earnings LONG/);
  assert.match(visible, /data-testid="recession-growth-coverage"/);
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
    assert.match(two.coverageWarn ?? "", /Geringe Abdeckung: 30,0 % < 50 %/);
    assert.equal((two.coverageWarn ?? "").includes("warnCoverage"), false);
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
    assert.deepEqual(basket.downweighted, ["E"]);
    assert.ok(basket.used.includes("E"));
    assert.match(basket.note, /Huber/);
    assert.match(basket.note, /technische Stabilisierung/);
    const med = 11;
    const mad = 1;
    const zE = FORWARD_OUTLIER.madScale * (400 - med) / mad;
    const hE = FORWARD_OUTLIER.robustZMax / zE;
    const expect = (10 + 12 + 11 + 9 + 400 * hE) / (4 + hE);
    assert.ok(Math.abs(basket.gFwdPct - expect) < 1e-9, String(basket.gFwdPct));
  }
  assert.equal(GROWTH_HOLDINGS_PARAMS.minCoverage, 0.15);
  assert.equal(GROWTH_HOLDINGS_PARAMS.warnCoverage, 0.5);
  const sym = weightedHoldingsForward([
    { symbol: "N", weight: 0.2, gFwdPct: -10 },
    { symbol: "A", weight: 0.2, gFwdPct: -1 },
    { symbol: "Z", weight: 0.2, gFwdPct: 0 },
    { symbol: "B", weight: 0.2, gFwdPct: 1 },
    { symbol: "P", weight: 0.2, gFwdPct: 10 },
  ]);
  assert.equal(sym.available, true);
  if (sym.available) {
    assert.ok(Math.abs(sym.gFwdPct) < 1e-9, String(sym.gFwdPct));
    assert.deepEqual(sym.downweighted, ["N", "P"]);
    assert.ok(sym.used.includes("N") && sym.used.includes("P"));
  }
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
    assert.deepEqual(ashr.downweighted, ["300308.SZ", "300502.SZ"]);
    assert.ok(ashr.used.includes("300308.SZ"));
    assert.ok(Math.abs(ashr.gFwdPct - 13.393377483443711) > 1, String(ashr.gFwdPct));
    assert.equal(ashr.coverageWarn, "Geringe Abdeckung: 21,0 % < 50 %, Huber-Gewicht (MAD-z, Schwelle 2,5, symmetrisch): 300308.SZ, 300502.SZ");
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
    assert.deepEqual(flat.downweighted, ["E"]);
    assert.ok(flat.used.includes("D"));
    assert.ok(flat.used.includes("E"));
    assert.match(flat.note, /meanAD/);
    assert.match(flat.note, /Huber/);
  }
  const identical = weightedHoldingsForward([
    { symbol: "A", weight: 0.2, gFwdPct: 10 },
    { symbol: "B", weight: 0.2, gFwdPct: 10 },
    { symbol: "C", weight: 0.2, gFwdPct: 10 },
    { symbol: "D", weight: 0.2, gFwdPct: 10 },
  ]);
  assert.equal(identical.available, true);
  if (identical.available) {
    assert.deepEqual(identical.downweighted, []);
    assert.ok(Math.abs(identical.gFwdPct - 10) < 1e-9);
  }
  const signedOut = weightedHoldingsForward([
    { symbol: "AAA", weight: 0.1, gFwdPct: 10 },
    { symbol: "BBB", weight: 0.1, gFwdPct: 8 },
    { symbol: "CCC", weight: 0.1, gFwdPct: 9 },
    { symbol: "NEG", weight: 0.05, gFwdPct: null, excludeReason: "n/a — adjTTM ≤ 0" },
  ]);
  assert.equal(signedOut.available, true);
  if (signedOut.available) {
    assert.ok(Math.abs(signedOut.gFwdPct - 9) < 1e-9);
    assert.match(signedOut.note, /NEG \(adjTTM ≤ 0\)/);
    assert.match(signedOut.note, /zählt in der Abdeckung/);
    assert.match(signedOut.coverageWarn ?? "", /NEG 5,0 % \(adjTTM ≤ 0\)/);
  }
});

await ok("ASHR-Banner und Growth-Gap-Beschriftung stehen im gerenderten Output", async () => {
  const weighted = weightedHoldingsForward([
    { symbol: "300308.SZ", weight: 0.0364, gFwdPct: 184.7 },
    { symbol: "600519.SS", weight: 0.0318, gFwdPct: 10.7 },
    { symbol: "300750.SZ", weight: 0.0312, gFwdPct: 21.6 },
    { symbol: "601318.SS", weight: 0.0229, gFwdPct: null },
    { symbol: "300502.SZ", weight: 0.0221, gFwdPct: 242.1 },
    { symbol: "600036.SS", weight: 0.0208, gFwdPct: 7.7 },
    { symbol: "601899.SS", weight: 0.0199, gFwdPct: 29.0 },
    { symbol: "603259.SS", weight: 0.0169, gFwdPct: 13.6 },
    { symbol: "000333.SZ", weight: 0.0162, gFwdPct: 2.1 },
    { symbol: "600900.SS", weight: 0.0142, gFwdPct: 0.5 },
  ]);
  assert.equal(weighted.available, true);
  if (!weighted.available) return;
  assert.deepEqual(weighted.downweighted, ["300308.SZ", "300502.SZ"]);
  assert.ok(weighted.used.includes("300308.SZ"));
  const banner = "Geringe Abdeckung: 21,0 % < 50 %, Huber-Gewicht (MAD-z, Schwelle 2,5, symmetrisch): 300308.SZ, 300502.SZ, ausgeschlossen: 601318.SS";
  assert.equal(weighted.coverageWarn, banner);
  const body = buildGrowthBody({
    index: "ASHR",
    price: [{ date: "2025-10-31", close: 30 }],
    priceSource: "yahoo",
    priceError: null,
    realized: [],
    realizedSource: "FMP",
    realizedError: "n/a — GET /stable/income-statement?symbol=ASHR ohne YoY-Paar",
    realizedFrequency: null,
    forward: {
      available: true,
      gFwdPct: weighted.gFwdPct,
      epsConsensus: null,
      epsTtm: null,
      asOf: "2026-11-02",
      source: "Yahoo Quote-HTML",
      formula: "g_fwd = Σ (w_i / Σ w) · (EPS_consensus,i / EPS_TTM,i − 1)",
      coverageWarn: weighted.coverageWarn,
    },
    vixPoints: [],
    vixSource: "FRED VIXCLS",
    vixError: "n/a — VIX nur am S&P",
  });
  assert.equal(body.forward.available, true);
  assert.equal(body.growthGap.available, false);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  client.setQueryData(["/api/recession/earnings-growth", "SPY"], body);
  client.setQueryData(["/api/recession/growth-gap", "SPY"], body);
  const { RecessionGrowthSection } = await import("../client/src/components/recession/RecessionGrowthSection");
  const html = renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(RecessionGrowthSection, { number: 17 })),
  );
  const visible = html.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
  const bannerAt = visible.indexOf("recession-growth-coverage");
  assert.ok(bannerAt >= 0, "Banner fehlt im gerenderten Output");
  assert.ok(visible.slice(bannerAt, bannerAt + 500).includes(banner), visible.slice(bannerAt, bannerAt + 500));
  assert.equal(visible.includes("warnCoverage"), false);
  assert.match(visible, /g_fwd \(Forward-Konsens\)/);
  assert.match(visible, /\+28,6 %/);
  const gapAt = visible.indexOf("recession-growth-gap");
  const gapHtml = visible.slice(gapAt, gapAt + 700);
  assert.match(gapHtml, /Growth Gap \(g_fwd − g_realized\)/);
  assert.match(gapHtml, /g_fwd ist gesetzt\. g_realized fehlt, die Differenz bleibt n\/a\./);
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
    if (path === "/earnings" && (symbol === "AAA" || symbol === "BBB")) {
      const each = symbol === "AAA" ? 2.5 : 5;
      return { status: 200, json: [0, 1, 2, 3].map(i => {
        const date = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"][i];
        return { date, fiscalDateEnding: date, epsActual: each };
      }), detail: "" };
    }
    if (path === "/earnings") return { status: 200, json: [{ date: "2026-12-31", epsEstimated: 2 }], detail: "" };
    if (path === "/analyst-estimates" && (symbol === "AAA" || symbol === "BBB")) {
      return { status: 200, json: [{ date: "2027-12-31", epsAvg: symbol === "AAA" ? 12 : 22 }], detail: "" };
    }
    return { status: 404, json: null, detail: "unbekannt" };
  };
  const deps = {
    loadBars: async () => ({ bars: [{ date: "2025-10-31", close: 500 }], source: "yahoo" as const, error: null }),
    fetchMultpl: async () => multplTable(),
    probeFmp: probe,
    loadIncome: async () => [],
    loadYahooSummary: async (symbol: string, modules: readonly string[]) => {
      if (modules.includes("topHoldings")) {
        return { topHoldings: { holdings: [
          { symbol: "AAA", holdingPercent: { raw: 0.2 } },
          { symbol: "BBB", holdingPercent: { raw: 0.1 } },
        ] } };
      }
      if (!modules.includes("earningsTrendNonGaap")) return { defaultKeyStatistics: {} };
      const fy = symbol === "AAA" ? 12 : symbol === "BBB" ? 22 : null;
      const each = symbol === "AAA" ? 2.5 : symbol === "BBB" ? 5 : null;
      if (fy == null || each == null) return { defaultKeyStatistics: {} };
      const ends = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
      return {
        earningsHistoryNonGaap: { history: ends.map(date => ({ epsActual: { raw: each }, quarter: { fmt: date }, currency: "USD" })) },
        earningsTrendNonGaap: { trend: [{ period: "0y", endDate: "2027-12-31", earningsEstimate: { avg: { raw: fy }, earningsCurrency: "USD" } }] },
      };
    },
    loadVix: async () => [],
    fmpAvailable: true,
    today: "2026-11-02",
  };
  const mixed = await loadRecessionGrowth("SPY", deps);
  assert.equal(mixed.forward.available, true);
  if (mixed.forward.available) {
    const tDays = midToMidDays(horizonDays("2026-11-02", "2027-12-31"));
    const gA = annualizedFwdPct(12, 10, tDays);
    const gB = annualizedFwdPct(22, 20, tDays);
    assert.ok("gFwdPct" in gA && "gFwdPct" in gB);
    if ("gFwdPct" in gA && "gFwdPct" in gB) {
      assert.ok(Math.abs(mixed.forward.gFwdPct - (0.2 * gA.gFwdPct + 0.1 * gB.gFwdPct) / 0.3) < 1e-6, String(mixed.forward.gFwdPct));
    }
    assert.match(mixed.forward.formula, /Σ/);
    assert.match(mixed.forward.source, /Yahoo quoteSummary topHoldings/);
    assert.match(mixed.forward.source, /epsActual/);
    assert.equal(probes.some(p => p.startsWith("/ratios-ttm")), false);
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
      if (path === "/earnings" && params.symbol === "SPY") {
        return { status: 200, json: [25, 25, 25, 25].map((eps, i) => {
          const date = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"][i];
          return { date, fiscalDateEnding: date, epsActual: eps };
        }), detail: "" };
      }
      return { status: 500, json: null, detail: "soll nicht laufen" };
    },
    loadYahooSummary: async (symbol: string, modules: readonly string[]) => {
      if (!(symbol === "SPY" && modules.includes("earningsTrendNonGaap"))) return { defaultKeyStatistics: {} };
      const ends = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
      return {
        earningsHistoryNonGaap: { history: ends.map(date => ({ epsActual: { raw: 25 }, quarter: { fmt: date }, currency: "USD" })) },
        earningsTrendNonGaap: { trend: [{ period: "0y", endDate: "2027-12-31", earningsEstimate: { avg: { raw: 110 }, earningsCurrency: "USD" } }] },
      };
    },
  });
  assert.equal(direct.forward.available, true);
  if (direct.forward.available) {
    const gDirect = annualizedFwdPct(110, 100, midToMidDays(horizonDays("2026-11-02", "2027-12-31")));
    assert.ok("gFwdPct" in gDirect);
    if ("gFwdPct" in gDirect) assert.ok(Math.abs(direct.forward.gFwdPct - gDirect.gFwdPct) < 1e-6, String(direct.forward.gFwdPct));
    assert.equal(direct.forward.formula, FORWARD_FORMULA_EPS);
    assert.match(direct.forward.source, /epsActual/);
    assert.match(direct.forward.source, /t=/);
  }
  assert.equal(directProbes.includes("/etf/holdings"), false);
  assert.equal(directProbes.includes("/ratios-ttm"), false);
});

await ok("Deckung unter minCoverage bleibt n/a, Yahoo +1y mit t=null hebt den Index nicht", async () => {
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
    if (path === "/earnings" && (symbol === "AAA" || symbol === "BBB")) {
      return { status: 200, json: [2.5, 2.5, 2.5, 2.5].map((eps, i) => {
        const date = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"][i];
        return { date, fiscalDateEnding: date, epsActual: eps };
      }), detail: "" };
    }
    if (path === "/earnings") return { status: 200, json: [], detail: "" };
    if (path === "/etf/holdings") return { status: 402, json: null, detail: "Premium Query Parameter: ETF holdings" };
    if (path === "/analyst-estimates" && (symbol === "AAA" || symbol === "BBB")) {
      return { status: 200, json: [{ date: "2027-12-31", epsAvg: 12 }], detail: "" };
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
      if ((symbol === "AAA" || symbol === "BBB") && modules.includes("earningsTrendNonGaap")) {
        const ends = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
        return {
          earningsHistoryNonGaap: { history: ends.map(date => ({ epsActual: { raw: 2.5 }, quarter: { fmt: date }, currency: "USD" })) },
          earningsTrendNonGaap: { trend: [{ period: "0y", endDate: "2027-12-31", earningsEstimate: { avg: { raw: 12 }, earningsCurrency: "USD" } }] },
        };
      }
      return { defaultKeyStatistics: {} };
    },
  });
  assert.equal(shown.forward.available, false);
  if (!shown.forward.available) {
    assert.match(shown.forward.reason, /minCoverage/);
    assert.match(shown.forward.reason, /Deckung/);
    assert.equal("gFwdPct" in shown.forward, false);
    assert.equal(JSON.stringify(shown.forward).includes("trailingEps"), false);
    assert.ok((shown.forward.lines ?? []).some(line => line.symbol === "AAA" && line.gAnnPct != null));
  }
  const hidden = await loadRecessionGrowth("ASHR", {
    ...base,
    probeFmp: probe,
    loadYahooSummary: async (symbol: string, modules: readonly string[]) => {
      if (modules.includes("topHoldings")) {
        return { topHoldings: { holdings: [
          { symbol: "AAA", holdingPercent: { raw: 0.05 } },
          { symbol: "BBB", holdingPercent: { raw: 0.06 } },
        ] } };
      }
      if ((symbol === "AAA" || symbol === "BBB") && modules.includes("earningsTrendNonGaap")) {
        const ends = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
        return {
          earningsHistoryNonGaap: { history: ends.map(date => ({ epsActual: { raw: 2.5 }, quarter: { fmt: date }, currency: "USD" })) },
          earningsTrendNonGaap: { trend: [{ period: "0y", endDate: "2027-12-31", earningsEstimate: { avg: { raw: 12 }, earningsCurrency: "USD" } }] },
        };
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

await ok("NVDA t=266, META t=241, AMZN/GOOGL GAAP gegen adjusted, AVGO-Stub und Quelle in der Karte", async () => {
  const asOf = "2026-11-02";
  const parsed = adjTtmFromEarnings([
    { date: "2026-09-30", epsActual: 1.5, netIncomePerShareTTM: 10 },
    { date: "2026-06-30", epsActual: 1.5 },
    { date: "2026-03-31", epsActual: 1.5 },
    { date: "2025-12-31", epsActual: 1.5 },
    { date: "2025-09-30", epsActual: 9 },
    { date: "2026-12-31", epsActual: 20, period: "FY" },
    { date: "2026-12-31", epsEstimated: 8 },
  ], asOf);
  assert.equal(parsed.quarters.length, EPS_BASIS.reportedQuarters);
  assert.equal(parsed.adjTtm, 6);
  assert.equal(parsed.unusableReason, null);
  const { loadRecessionGrowth } = await import("../server/recession-growth");
  const probes: string[] = [];
  const calendarEnds = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
  const januaryEnds = ["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"];
  const endsFor = (symbol: string) => (symbol === "NVDA" || symbol === "AMZN" || symbol === "GOOGL" || symbol === "NEG") ? januaryEnds : calendarEnds;
  const quarters = (symbol: string, each: number) => endsFor(symbol).map(date => ({ date, fiscalDateEnding: date, epsActual: each }));
  const body = await loadRecessionGrowth("SPY", {
    loadBars: async () => ({ bars: [{ date: "2025-10-31", close: 500 }], source: "yahoo" as const, error: null }),
    fetchMultpl: async () => multplTable(),
    probeFmp: async (path, params) => {
      probes.push(path);
      const symbol = params.symbol;
      if (path === "/ratios-ttm") return { status: 200, json: [{ netIncomePerShareTTM: symbol === "GOOGL" ? 10 : 8 }], detail: "" };
      if (path === "/analyst-estimates" && (symbol === "SPY" || symbol === "^GSPC")) return { status: 200, json: [], detail: "" };
      if (path === "/financial-estimates") return { status: 404, json: null, detail: "" };
      if (path === "/etf/holdings") return { status: 402, json: null, detail: "" };
      if (path === "/earnings" && symbol === "SPY") return { status: 200, json: [{ date: "2026-12-31", epsEstimated: 1 }], detail: "" };
      if (path === "/analyst-estimates" && symbol === "AVGO") {
        return { status: 200, json: [{ date: "2026-12-12", epsAvg: 3 }, { date: "2027-12-12", epsAvg: 99 }], detail: "" };
      }
      if (path === "/analyst-estimates" && symbol === "NVDA") {
        return { status: 200, json: [{ date: "2027-01-25", epsAvg: 2 }, { date: "2028-01-25", epsAvg: 9 }], detail: "" };
      }
      if (path === "/analyst-estimates" && symbol === "META") {
        return { status: 200, json: [{ date: "2026-12-31", epsAvg: 5 }, { date: "2027-12-31", epsAvg: 8 }], detail: "" };
      }
      if (path === "/analyst-estimates" && symbol === "AMZN") {
        return { status: 200, json: [{ date: "2027-01-25", epsAvg: 6 }, { date: "2028-01-25", epsAvg: 50 }], detail: "" };
      }
      if (path === "/analyst-estimates" && symbol === "GOOGL") {
        return { status: 200, json: [{ date: "2028-01-25", epsAvg: 7 }], detail: "" };
      }
      if (path === "/analyst-estimates" && symbol === "NEG") {
        return { status: 200, json: [{ date: "2027-01-25", epsAvg: 2 }], detail: "" };
      }
      if (path === "/earnings" && symbol === "AVGO") return { status: 200, json: quarters("AVGO", 1), detail: "" };
      if (path === "/earnings" && symbol === "NVDA") return { status: 200, json: quarters("NVDA", 1), detail: "" };
      if (path === "/earnings" && symbol === "META") return { status: 200, json: quarters("META", 2), detail: "" };
      if (path === "/earnings" && symbol === "AMZN") return { status: 200, json: quarters("AMZN", 1), detail: "" };
      if (path === "/earnings" && symbol === "GOOGL") return { status: 200, json: quarters("GOOGL", 1.5), detail: "" };
      if (path === "/earnings" && symbol === "NEG") return { status: 200, json: quarters("NEG", -1), detail: "" };
      return { status: 404, json: null, detail: "unbekannt" };
    },
    loadIncome: async () => [],
    loadYahooSummary: async (symbol: string, modules: readonly string[]) => {
      if (modules.includes("topHoldings")) {
        return { topHoldings: { holdings: [
          { symbol: "AVGO", holdingPercent: { raw: 0.08 } },
          { symbol: "NVDA", holdingPercent: { raw: 0.07 } },
          { symbol: "META", holdingPercent: { raw: 0.06 } },
          { symbol: "AMZN", holdingPercent: { raw: 0.05 } },
          { symbol: "GOOGL", holdingPercent: { raw: 0.04 } },
          { symbol: "NEG", holdingPercent: { raw: 0.03 } },
        ] } };
      }
      const spec: Record<string, { each: number; fy: number; end: string }> = {
        AVGO: { each: 1, fy: 3, end: "2026-12-12" },
        NVDA: { each: 1, fy: 2, end: "2027-01-25" },
        META: { each: 2, fy: 5, end: "2026-12-31" },
        AMZN: { each: 1, fy: 6, end: "2027-01-25" },
        GOOGL: { each: 1.5, fy: 7, end: "2028-01-25" },
      };
      const picked = spec[symbol];
      if (!picked || !modules.includes("earningsTrendNonGaap")) return { defaultKeyStatistics: {} };
      const ends = endsFor(symbol);
      return {
        earningsHistoryNonGaap: { history: ends.map(date => ({ epsActual: { raw: picked.each }, quarter: { fmt: date }, currency: "USD" })) },
        earningsTrendNonGaap: { trend: [{ period: "0y", endDate: picked.end, earningsEstimate: { avg: { raw: picked.fy }, earningsCurrency: "USD" } }] },
      };
    },
    loadYahooHtml: async () => ({ status: null, html: null, error: "im Test aus" }),
    loadVix: async () => [],
    fmpAvailable: true,
    today: asOf,
  });
  assert.equal(probes.includes("/ratios-ttm"), false);
  assert.equal(body.forward.available, true);
  if (!body.forward.available) return;
  const line = Object.fromEntries((body.forward.lines ?? []).map(row => [row.symbol, row]));
  assert.equal(line.AVGO.tDays, 222);
  assert.ok(Math.abs((line.AVGO.gAnnPct ?? NaN) - powerPct(3, 4, 222)) < 1e-6, String(line.AVGO.gAnnPct));
  assert.match(line.AVGO.source ?? "", /epsActual/);
  assert.match(line.AVGO.source ?? "", /2026-12-12 \+ 182/);
  assert.equal(line.NVDA.tDays, 266);
  assert.ok(Math.abs((line.NVDA.gAnnPct ?? NaN) - powerPct(2, 4, 266)) < 1e-6, String(line.NVDA.gAnnPct));
  assert.match(line.NVDA.source ?? "", /84 Tage bis FY-Ende 2027-01-25 \+ 182/);
  assert.equal(line.META.tDays, 241);
  assert.ok(Math.abs((line.META.gAnnPct ?? NaN) - powerPct(5, 8, 241)) < 1e-6, String(line.META.gAnnPct));
  assert.match(line.META.source ?? "", /59 Tage bis FY-Ende 2026-12-31 \+ 182/);
  const amznT = 266;
  const googlT = 631;
  assert.equal(line.AMZN.tDays, amznT);
  assert.ok(Math.abs((line.AMZN.gAnnPct ?? NaN) - powerPct(6, 4, amznT)) < 1e-6, String(line.AMZN.gAnnPct));
  assert.ok(Math.abs(powerPct(6, 4, amznT) - powerPct(6, 8, amznT)) > 1);
  assert.equal(line.GOOGL.tDays, googlT);
  assert.ok(Math.abs((line.GOOGL.gAnnPct ?? NaN) - powerPct(7, 6, googlT)) < 1e-6, String(line.GOOGL.gAnnPct));
  assert.ok(powerPct(7, 6, googlT) > 0);
  assert.ok(powerPct(7, 10, googlT) < 0);
  assert.equal(line.NEG.gAnnPct, null);
  assert.equal(line.NEG.weight, null);
  assert.match(line.NEG.excludeReason ?? "", /adjTTM ≤ 0/);
  assert.match(body.forward.source, /epsActual/);
  assert.match(body.forward.formula, /Tage bis FY-Ende \+ 182/);
  assert.match(body.forward.formula, /min\(1, t_i\/365\)/);
  assert.match(body.forward.source, /technische Stabilisierung/);
  assert.match(body.forward.coverageWarn ?? "", /Geringe Abdeckung/);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  client.setQueryData(["/api/recession/earnings-growth", "SPY"], body);
  client.setQueryData(["/api/recession/growth-gap", "SPY"], body);
  const { RecessionGrowthSection } = await import("../client/src/components/recession/RecessionGrowthSection");
  const html = renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(RecessionGrowthSection, { number: 17 })),
  );
  const visible = html.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
  assert.match(visible, /Tage bis FY-Ende \+ 182/);
  assert.match(visible, /Technische Stabilisierung/);
  assert.match(visible, /g ist ungedämpft/);
  assert.match(visible, /recession-growth-holding-NVDA/);
  assert.match(visible, /t 266 Tage/);
  assert.match(visible, /recession-growth-holding-META/);
  assert.match(visible, /t 241 Tage/);
  assert.match(visible, /Quelle/);
  assert.match(visible, /epsActual/);
  assert.match(visible, /data-testid="recession-growth-coverage"/);
  assert.match(visible, /adjTTM ≤ 0/);
});

await ok("META adjTTM ist die non-GAAP-Summe 29,77, nicht der GAAP-Mix 32,90", () => {
  const asOf = "2026-11-02";
  const raw = {
    earningsHistoryGaap: { history: [
      { epsActual: { raw: 8.88 }, quarter: { fmt: "2025-12-31" }, currency: "USD" },
      { epsActual: { raw: 10.44 }, quarter: { fmt: "2026-03-31" }, currency: "USD" },
      { epsActual: { raw: 6.18 }, quarter: { fmt: "2026-06-30" }, currency: "USD" },
      { epsActual: { raw: 3.83 }, quarter: { fmt: "2026-09-30" }, currency: "USD" },
    ] },
    earningsHistoryNonGaap: { history: [
      { epsActual: { raw: 8.88 }, quarter: { fmt: "2025-12-31" }, currency: "USD" },
      { epsActual: { raw: 7.31 }, quarter: { fmt: "2026-03-31" }, currency: "USD" },
      { epsActual: { raw: 6.18 }, quarter: { fmt: "2026-06-30" }, currency: "USD" },
      { epsActual: { raw: 7.4 }, quarter: { fmt: "2026-09-30" }, currency: "USD" },
    ] },
    earningsTrendNonGaap: { trend: [
      { period: "0y", endDate: "2026-12-31", earningsEstimate: { avg: { raw: 29.7896 }, earningsCurrency: "USD" } },
      { period: "+1y", endDate: "2027-12-31", earningsEstimate: { avg: { raw: 35.42861 }, earningsCurrency: "USD" } },
    ] },
    defaultKeyStatistics: { trailingEps: { raw: 29.31 } },
  };
  const parsed = adjTtmFromYahooAdjusted(raw, asOf);
  assert.equal(parsed.unusableReason, null);
  assert.deepEqual(parsed.quarters.map(row => row.eps), [7.4, 6.18, 7.31, 8.88]);
  assert.ok(Math.abs((parsed.adjTtm ?? 0) - 29.77) < 1e-9, String(parsed.adjTtm));
  const mixed = 8.88 + 10.44 + 6.18 + 7.4;
  assert.ok(Math.abs(mixed - 32.9) < 1e-9);
  assert.ok(Math.abs((parsed.adjTtm ?? 0) - mixed) > 1);
  const fy = consensusFromYahooAdjusted(raw, asOf);
  assert.equal(fy?.date, "2026-12-31");
  assert.equal(fy?.eps, 29.7896);
  assert.equal(fy?.horizonDays, 241);
  assert.ok((parsed.adjTtm ?? 0) < 29.7896);
  assert.ok(mixed > 29.7896);
});

await ok("Ticker ohne 4 Quartale adjusted und ohne t bleibt n/a, Yahoo-4Q zählt mit Quelle", async () => {
  const asOf = "2026-11-02";
  const { loadRecessionGrowth } = await import("../server/recession-growth");
  const quarters = (each: number) => ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"].map(date => ({ date, fiscalDateEnding: date, epsActual: each }));
  const yahoo4 = {
    earningsHistoryNonGaap: { history: quarters(1).map(row => ({ epsActual: { raw: row.epsActual }, quarter: { fmt: row.date }, currency: "USD" })) },
    earningsTrendNonGaap: { trend: [
      { period: "0y", endDate: "2027-06-30", earningsEstimate: { avg: { raw: 5 }, earningsCurrency: "USD" } },
      { period: "+1y", endDate: "2028-06-30", earningsEstimate: { avg: { raw: 9 }, earningsCurrency: "USD" } },
    ] },
    defaultKeyStatistics: { trailingEps: { raw: 99 } },
  };
  const body = await loadRecessionGrowth("SPY", {
    loadBars: async () => ({ bars: [{ date: "2025-10-31", close: 500 }], source: "yahoo" as const, error: null }),
    fetchMultpl: async () => multplTable(),
    probeFmp: async (path, params) => {
      const symbol = params.symbol;
      if (path === "/analyst-estimates" && (symbol === "SPY" || symbol === "^GSPC")) return { status: 200, json: [], detail: "" };
      if (path === "/financial-estimates") return { status: 404, json: null, detail: "" };
      if (path === "/etf/holdings") return { status: 402, json: null, detail: "" };
      if (path === "/earnings" && symbol === "SPY") return { status: 200, json: [], detail: "" };
      if (path === "/analyst-estimates" && symbol === "AAA") return { status: 200, json: [{ date: "2027-12-31", epsAvg: 12 }], detail: "" };
      if (path === "/earnings" && symbol === "AAA") return { status: 200, json: quarters(2.5), detail: "" };
      if (path === "/earnings" && symbol === "Y4") return { status: 200, json: [], detail: "" };
      if (path === "/analyst-estimates" && (symbol === "Y4" || symbol === "NA" || symbol === "NONE")) return { status: 200, json: [], detail: "" };
      if (path === "/earnings") return { status: 200, json: [], detail: "" };
      return { status: 404, json: null, detail: "unbekannt" };
    },
    loadIncome: async () => [],
    loadYahooSummary: async (symbol: string, modules: readonly string[]) => {
      if (modules.includes("topHoldings")) {
        return { topHoldings: { holdings: [
          { symbol: "AAA", holdingPercent: { raw: 0.25 } },
          { symbol: "Y4", holdingPercent: { raw: 0.2 } },
          { symbol: "NA", holdingPercent: { raw: 0.08 } },
          { symbol: "NONE", holdingPercent: { raw: 0.05 } },
        ] } };
      }
      if (symbol === "Y4" && modules.includes("earningsHistoryNonGaap")) return yahoo4;
      if (symbol === "AAA" && modules.includes("earningsTrendNonGaap")) {
        const ends = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
        return {
          earningsHistoryNonGaap: { history: ends.map(date => ({ epsActual: { raw: 2.5 }, quarter: { fmt: date }, currency: "USD" })) },
          earningsTrendNonGaap: { trend: [{ period: "0y", endDate: "2027-12-31", earningsEstimate: { avg: { raw: 12 }, earningsCurrency: "USD" } }] },
        };
      }
      if (symbol === "NA") {
        return {
          defaultKeyStatistics: { trailingEps: { raw: 10 } },
          earningsTrend: { trend: [{ period: "+1y", endDate: "2027-12-31", earningsEstimate: { avg: { raw: 11 }, growth: { raw: 0.1 } } }] },
        };
      }
      return { defaultKeyStatistics: { trailingEps: { raw: 10 } } };
    },
    loadYahooHtml: async () => ({ status: null, html: null, error: "im Test aus" }),
    loadVix: async () => [],
    fmpAvailable: true,
    today: asOf,
  });
  assert.equal(body.forward.available, true);
  if (!body.forward.available) return;
  const line = Object.fromEntries((body.forward.lines ?? []).map(row => [row.symbol, row]));
  const y4t = midToMidDays(horizonDays(asOf, "2027-06-30"));
  const y4 = annualizedFwdPct(5, 4, y4t);
  assert.ok("gFwdPct" in y4);
  if ("gFwdPct" in y4) assert.ok(Math.abs((line.Y4.gAnnPct ?? NaN) - y4.gFwdPct) < 1e-6, String(line.Y4.gAnnPct));
  assert.match(line.Y4.source ?? "", /earningsHistoryNonGaap/);
  assert.match(line.Y4.source ?? "", /2026-09-30=1/);
  assert.equal((line.Y4.source ?? "").includes("trailingEps"), false);
  assert.equal(line.Y4.tDays, y4t);
  assert.equal(line.NA.gAnnPct, null);
  assert.equal(line.NA.weight, null);
  assert.match(line.NA.excludeReason ?? "", /keine 4 Quartale adjusted und kein Horizont t/);
  assert.equal(line.NONE.gAnnPct, null);
  assert.match(line.NONE.excludeReason ?? "", /keine 4 Quartale adjusted und kein Horizont t/);
  assert.match(body.forward.coverageWarn ?? "", /45,0 %/);
  assert.match(body.forward.coverageWarn ?? "", /NA /);
  assert.match(body.forward.coverageWarn ?? "", /NONE /);
  assert.equal((body.forward.source ?? "").includes("Horizont 1J (+1y)"), false);
  const covered = (line.AAA.indexWeight + line.Y4.indexWeight) * 100;
  const withNa = covered + line.NA.indexWeight * 100 + line.NONE.indexWeight * 100;
  assert.ok(covered < withNa);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  client.setQueryData(["/api/recession/earnings-growth", "SPY"], body);
  client.setQueryData(["/api/recession/growth-gap", "SPY"], body);
  const { RecessionGrowthSection } = await import("../client/src/components/recession/RecessionGrowthSection");
  const html = renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(RecessionGrowthSection, { number: 17 })),
  );
  const visible = html.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
  assert.match(visible, /recession-growth-holding-NA/);
  assert.match(visible, /keine 4 Quartale adjusted und kein Horizont t/);
  assert.match(visible, /recession-growth-holding-Y4/);
  assert.match(visible, /earningsHistoryNonGaap/);
  assert.match(visible, /data-testid="recession-growth-coverage"/);
  assert.match(visible, /45,0 %/);
});

await ok("FMP-Pfad META: epsActual 10,44 wird nicht zur Summe 32,90", async () => {
  const asOf = "2026-11-02";
  const fmp = [
    { date: "2026-10-21", fiscalDateEnding: "2026-09-30", epsActual: 7.4, epsEstimated: 6.85 },
    { date: "2026-07-29", fiscalDateEnding: "2026-06-30", epsActual: 6.18, epsEstimated: 7.4 },
    { date: "2026-04-29", fiscalDateEnding: "2026-03-31", epsActual: 10.44, epsEstimated: 6.7 },
    { date: "2026-01-28", fiscalDateEnding: "2025-12-31", epsActual: 8.88, epsEstimated: 8.18 },
  ];
  const yahoo = {
    earningsHistoryNonGaap: { history: [
      { epsActual: { raw: 7.4 }, quarter: { fmt: "2026-09-30" }, currency: "USD" },
      { epsActual: { raw: 6.18 }, quarter: { fmt: "2026-06-30" }, currency: "USD" },
      { epsActual: { raw: 7.31 }, quarter: { fmt: "2026-03-31" }, currency: "USD" },
      { epsActual: { raw: 8.88 }, quarter: { fmt: "2025-12-31" }, currency: "USD" },
    ] },
    earningsTrendNonGaap: { trend: [
      { period: "0y", endDate: "2026-12-31", earningsEstimate: { avg: { raw: 29.7896 }, earningsCurrency: "USD" } },
      { period: "+1y", endDate: "2027-12-31", earningsEstimate: { avg: { raw: 35.42861 }, earningsCurrency: "USD" } },
    ] },
  };
  const mixed = 7.4 + 6.18 + 10.44 + 8.88;
  assert.ok(Math.abs(mixed - 32.9) < 1e-9);
  const clarified = resolveAdjustedFmpQuarters(fmp, yahoo, asOf);
  assert.equal(clarified.unusableReason, null);
  assert.ok(Math.abs((clarified.adjTtm ?? 0) - (7.4 + 6.18 + 7.31 + 8.88)) < 1e-9, String(clarified.adjTtm));
  assert.ok(Math.abs((clarified.adjTtm ?? 0) - mixed) > 1);
  const swapped = clarified.quarters.find(row => row.date === "2026-04-29");
  assert.equal(swapped?.source, "yahoo-nongaap");
  assert.equal(swapped?.yahooChecked, true);
  assert.equal(swapped?.eps, 7.31);
  assert.equal(swapped?.fmpEps, 10.44);
  assert.equal(horizonDays("2026-03-31", "2026-04-29"), 29);
  const beforeAnyEnd = resolveAdjustedFmpQuarters([
    { date: "2024-01-15", fiscalDateEnding: "2024-01-31", epsActual: 1 },
    { date: "2024-04-15", fiscalDateEnding: "2024-04-30", epsActual: 1 },
    { date: "2024-07-15", fiscalDateEnding: "2024-07-31", epsActual: 1 },
    { date: "2024-10-15", fiscalDateEnding: "2024-10-31", epsActual: 1 },
  ], yahoo, asOf);
  assert.equal(beforeAnyEnd.adjTtm, null);
  assert.match(beforeAnyEnd.unusableReason ?? "", /nicht auf ein Yahoo-NonGaap-Quartalsende gelegt/);
  const { loadRecessionGrowth } = await import("../server/recession-growth");
  const base = {
    loadBars: async () => ({ bars: [{ date: "2025-10-31", close: 500 }], source: "yahoo" as const, error: null }),
    fetchMultpl: async () => multplTable(),
    loadIncome: async () => [],
    loadYahooHtml: async () => ({ status: null, html: null, error: "im Test aus" }),
    loadVix: async () => [],
    fmpAvailable: true,
    today: asOf,
  };
  const probe = async (path: string, params: Record<string, string>) => {
    if (path === "/analyst-estimates" && params.symbol === "SPY") {
      return { status: 200, json: [{ date: "2027-12-31", epsAvg: 30, currency: "USD" }], detail: "" };
    }
    if (path === "/earnings" && params.symbol === "SPY") return { status: 200, json: fmp, detail: "" };
    if (path === "/analyst-estimates" || path === "/financial-estimates") return { status: 200, json: [], detail: "" };
    return { status: 404, json: null, detail: "unbekannt" };
  };
  const withYahoo = await loadRecessionGrowth("SPY", {
    ...base,
    probeFmp: probe,
    loadYahooSummary: async (_symbol: string, modules: readonly string[]) => (
      modules.includes("earningsHistoryNonGaap") ? yahoo : null
    ),
  });
  assert.equal(withYahoo.forward.available, true);
  if (!withYahoo.forward.available) return;
  assert.ok(Math.abs((withYahoo.forward.epsTtm ?? 0) - 29.77) < 1e-9, String(withYahoo.forward.epsTtm));
  assert.match(withYahoo.forward.source, /Yahoo NonGaap/);
  assert.match(withYahoo.forward.source, /10\.44/);
  const fromMix = annualizedFwdPct(30, mixed, midToMidDays(horizonDays(asOf, "2027-12-31")));
  assert.ok("gFwdPct" in fromMix);
  if ("gFwdPct" in fromMix) assert.ok(Math.abs(withYahoo.forward.gFwdPct - fromMix.gFwdPct) > 1);
  assert.match(withYahoo.forward.source, /offenes FY/);
});

await ok("LSE: fehlende EPS-Währung, GBp nur bei Faktor 100, sonst die Filingswährung", async () => {
  const pence = completeEpsCurrencies(140, "GBp", 1.4, "GBP");
  assert.equal(pence.consensusCcy, "GBp");
  assert.equal(pence.ttmCcy, "GBP");
  assert.equal(pence.inferred, null);
  const aligned = alignConsensusToTtm(140, pence.consensusCcy, 1.4, pence.ttmCcy, null);
  assert.ok(!("error" in aligned));
  if (!("error" in aligned)) {
    assert.ok(Math.abs(aligned.consensus - 1.4) < 1e-9);
    assert.ok(Math.abs(aligned.ttm - 1.4) < 1e-9);
  }
  const usd = completeEpsCurrencies(1.6, null, 1.6, "USD");
  assert.equal(usd.consensusCcy, "USD");
  assert.equal(usd.ttmCcy, "USD");
  assert.equal((usd.inferred ?? "").includes("100"), false);
  const asOf = "2026-11-02";
  const { loadRecessionGrowth } = await import("../server/recession-growth");
  const ends = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
  const reports = ["2026-01-30", "2026-04-30", "2026-07-30", "2026-10-30"];
  const q = (each: number, currency?: string) => reports.map((date, index) => ({
    date,
    fiscalDateEnding: ends[index],
    epsActual: each,
    ...(currency ? { reportedCurrency: currency } : {}),
  }));
  const body = await loadRecessionGrowth("VGK", {
    loadBars: async () => ({ bars: [{ date: "2025-10-31", close: 70 }], source: "yahoo" as const, error: null }),
    fetchMultpl: async () => "",
    probeFmp: async (path, params) => {
      const symbol = params.symbol;
      if (path === "/analyst-estimates" && (symbol === "VGK" || symbol === "FEZ")) return { status: 200, json: [], detail: "" };
      if (path === "/financial-estimates") return { status: 404, json: null, detail: "" };
      if (path === "/etf/holdings") return { status: 402, json: null, detail: "" };
      if (path === "/analyst-estimates" && symbol === "HSBA.L") return { status: 200, json: [{ date: "2026-12-31", epsAvg: 1.6 }], detail: "" };
      if (path === "/earnings" && symbol === "HSBA.L") return { status: 200, json: q(0.4), detail: "" };
      if (path === "/analyst-estimates" && symbol === "SHEL.L") return { status: 200, json: [{ date: "2027-12-31", epsAvg: 140, currency: "GBp" }], detail: "" };
      if (path === "/earnings" && symbol === "SHEL.L") return { status: 200, json: q(0.35, "GBP"), detail: "" };
      if (path === "/analyst-estimates" && symbol === "AZN.L") return { status: 200, json: [{ date: "2026-12-31", epsAvg: 10 }], detail: "" };
      if (path === "/earnings" && symbol === "AZN.L") return { status: 200, json: q(2.5), detail: "" };
      if (path === "/analyst-estimates" && symbol === "BAD.L") return { status: 200, json: [{ date: "2026-12-31", epsAvg: 160 }], detail: "" };
      if (path === "/earnings" && symbol === "BAD.L") return { status: 200, json: q(0.4), detail: "" };
      return { status: 404, json: null, detail: "unbekannt" };
    },
    loadIncome: async () => [],
    loadYahooSummary: async (symbol: string, modules: readonly string[]) => {
      if (modules.includes("topHoldings")) {
        return { topHoldings: { holdings: [
          { symbol: "HSBA.L", holdingPercent: { raw: 0.2 } },
          { symbol: "SHEL.L", holdingPercent: { raw: 0.15 } },
          { symbol: "AZN.L", holdingPercent: { raw: 0.12 } },
          { symbol: "BAD.L", holdingPercent: { raw: 0.08 } },
        ] } };
      }
      if (!modules.includes("earningsHistoryNonGaap")) return null;
      const spec = symbol === "HSBA.L" ? { each: 0.4, ccy: "USD", fy: 1.6 }
        : symbol === "AZN.L" ? { each: 2.5, ccy: "USD", fy: 10 }
        : symbol === "SHEL.L" ? { each: 0.35, ccy: "GBP", fy: 1.4 }
        : symbol === "BAD.L" ? { each: 0.4, ccy: "USD", fy: 1.6 }
        : null;
      if (!spec) return null;
      return {
        earningsHistoryNonGaap: {
          history: ends.map(date => ({
            epsActual: { raw: spec.each },
            quarter: { fmt: date },
            currency: spec.ccy,
          })),
        },
        earningsTrendNonGaap: {
          trend: [
            { period: "0y", endDate: "2026-12-31", earningsEstimate: { avg: { raw: spec.fy }, earningsCurrency: spec.ccy } },
            { period: "+1y", endDate: "2027-12-31", earningsEstimate: { avg: { raw: spec.fy + 1 }, earningsCurrency: spec.ccy } },
          ],
        },
      };
    },
    loadYahooHtml: async () => ({ status: null, html: null, error: "im Test aus" }),
    loadVix: async () => [],
    fmpAvailable: true,
    today: asOf,
  });
  assert.equal(body.forward.available, true);
  if (!body.forward.available) return;
  const line = Object.fromEntries((body.forward.lines ?? []).map(row => [row.symbol, row]));
  for (const symbol of ["HSBA.L", "SHEL.L", "AZN.L"]) {
    assert.equal(line[symbol].excludeReason, null, `${symbol} ${line[symbol].excludeReason}`);
    assert.ok(Math.abs(line[symbol].gAnnPct ?? 99) < 1e-6, `${symbol} ${line[symbol].gAnnPct}`);
  }
  assert.match(line["SHEL.L"].source ?? "", /offenes FY 2026-12-31/);
  assert.match(line["SHEL.L"].source ?? "", /GBP/);
  assert.match(body.consensusTrace, /SHEL\.L: FMP-FY 2027-12-31 ist nicht das offene NonGaap-FY/);
  assert.equal((line["HSBA.L"].source ?? "").includes("pencePerPound"), false);
  assert.match(line["HSBA.L"].source ?? "", /USD/);
  assert.match(line["AZN.L"].source ?? "", /USD/);
  assert.equal(line["BAD.L"].excludeReason, null, line["BAD.L"].excludeReason ?? "");
  assert.match(line["BAD.L"].source ?? "", /offenes FY 2026-12-31/);
  assert.match(body.consensusTrace, /nicht das offene NonGaap-FY/);
  assert.equal(body.consensusTrace.includes("Währung fehlt auf einer EPS-Seite"), false);
});

await ok("vier Namen unter minCoverage sind n/a mit Deckung, nicht eine Zahl", async () => {
  const asOf = "2026-11-02";
  const { loadRecessionGrowth } = await import("../server/recession-growth");
  const names = ["AAA", "BBB", "CCC", "DDD"];
  const body = await loadRecessionGrowth("SPY", {
    loadBars: async () => ({ bars: [{ date: "2025-10-31", close: 500 }], source: "yahoo" as const, error: null }),
    fetchMultpl: async () => multplTable(),
    probeFmp: async (path, params) => {
      const symbol = params.symbol;
      if (path === "/analyst-estimates" && (symbol === "SPY" || symbol === "^GSPC")) return { status: 200, json: [], detail: "" };
      if (path === "/financial-estimates") return { status: 404, json: null, detail: "" };
      if (path === "/etf/holdings") return { status: 402, json: null, detail: "" };
      if (path === "/analyst-estimates" && names.includes(symbol ?? "")) {
        return { status: 200, json: [{ date: "2027-12-31", epsAvg: 12, currency: "USD" }], detail: "" };
      }
      if (path === "/earnings" && names.includes(symbol ?? "")) {
        return { status: 200, json: ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"].map(date => ({ date, fiscalDateEnding: date, epsActual: 2.5, epsEstimated: 2.5 })), detail: "" };
      }
      return { status: 404, json: null, detail: "unbekannt" };
    },
    loadIncome: async () => [],
    loadYahooSummary: async (symbol: string, modules: readonly string[]) => {
      if (modules.includes("topHoldings")) {
        return { topHoldings: { holdings: names.map(symbol => ({ symbol, holdingPercent: { raw: 0.03 } })) } };
      }
      if (!names.includes(symbol) || !modules.includes("earningsTrendNonGaap")) return null;
      const ends = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
      return {
        earningsHistoryNonGaap: { history: ends.map(date => ({ epsActual: { raw: 2.5 }, quarter: { fmt: date }, currency: "USD" })) },
        earningsTrendNonGaap: { trend: [{ period: "0y", endDate: "2027-12-31", earningsEstimate: { avg: { raw: 12 }, earningsCurrency: "USD" } }] },
      };
    },
    loadYahooHtml: async () => ({ status: null, html: null, error: "im Test aus" }),
    loadVix: async () => [],
    fmpAvailable: true,
    today: asOf,
  });
  assert.equal(body.forward.available, false);
  if (body.forward.available) return;
  assert.match(body.forward.reason, /Deckung/);
  assert.match(body.forward.reason, /minCoverage/);
  assert.match(body.forward.reason, /4 Namen/);
  assert.equal("gFwdPct" in body.forward, false);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  client.setQueryData(["/api/recession/earnings-growth", "SPY"], body);
  client.setQueryData(["/api/recession/growth-gap", "SPY"], body);
  const { RecessionGrowthSection } = await import("../client/src/components/recession/RecessionGrowthSection");
  const html = renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(RecessionGrowthSection, { number: 17 })),
  );
  const visible = html.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
  assert.match(visible, /data-testid="recession-growth-coverage"/);
  assert.match(visible, /Deckung 12,0 % < minCoverage 15 %, 4 Namen/);
  const forwardAt = visible.indexOf("recession-growth-forward");
  assert.match(visible.slice(forwardAt, forwardAt + 500), /minCoverage/);
});

await ok("AAPL Fiskaljahr September: fiscalDateEnding ordnet den Monat, sonst das Meldetag-Fenster", () => {
  const asOf = "2026-11-02";
  const yahoo = {
    earningsHistoryNonGaap: {
      history: [
        { epsActual: { raw: 1.85 }, quarter: { fmt: "2025-09-30" }, currency: "USD" },
        { epsActual: { raw: 2.84 }, quarter: { fmt: "2025-12-31" }, currency: "USD" },
        { epsActual: { raw: 2.01 }, quarter: { fmt: "2026-03-31" }, currency: "USD" },
        { epsActual: { raw: 2.02 }, quarter: { fmt: "2026-06-30" }, currency: "USD" },
        { epsActual: { raw: 2.06 }, quarter: { fmt: "2026-09-30" }, currency: "USD" },
      ],
    },
  };
  const reported = [
    { date: "2025-10-30", fiscalDateEnding: "2025-09-27", epsActual: 1.85 },
    { date: "2026-01-29", fiscalDateEnding: "2025-12-27", epsActual: 2.84 },
    { date: "2026-04-30", fiscalDateEnding: "2026-03-28", epsActual: 2.01 },
    { date: "2026-07-30", fiscalDateEnding: "2026-06-27", epsActual: 2.02 },
    { date: "2026-10-30", fiscalDateEnding: "2026-09-26", epsActual: 2.06 },
  ];
  const shifted = resolveAdjustedFmpQuarters(reported, yahoo, asOf);
  assert.equal(shifted.unusableReason, null, shifted.unusableReason ?? "");
  assert.ok(Math.abs((shifted.adjTtm ?? 0) - (2.84 + 2.01 + 2.02 + 2.06)) < 1e-9, String(shifted.adjTtm));
  assert.ok(Math.abs((shifted.adjTtm ?? 0) - 8.93) < 1e-9);
  const january = shifted.quarters.find(row => row.date === "2026-01-29");
  assert.equal(january?.eps, 2.84);
  assert.ok(Math.abs((january?.eps ?? 0) - 1.85) > 0.5);
  assert.equal(shifted.quarters.find(row => row.date === "2026-10-30")?.eps, 2.06);
  const throughJune = {
    earningsHistoryNonGaap: {
      history: yahoo.earningsHistoryNonGaap.history.filter(row => row.quarter.fmt !== "2026-09-30"),
    },
  };
  const stale = resolveAdjustedFmpQuarters(reported.filter(row => row.date !== "2026-10-30"), throughJune, asOf);
  assert.equal(stale.unusableReason, null, stale.unusableReason ?? "");
  assert.ok(Math.abs((stale.adjTtm ?? 0) - (1.85 + 2.84 + 2.01 + 2.02)) < 1e-9, String(stale.adjTtm));
  assert.equal(stale.quarters.find(row => row.date === "2026-01-29")?.eps, 2.84);
  const september = stale.quarters.find(row => row.date === "2025-10-30");
  assert.equal(september?.eps, 1.85);
  const byReport = resolveAdjustedFmpQuarters([
    { date: "2025-10-30", epsActual: 9 },
    { date: "2026-01-29", epsActual: 9 },
    { date: "2026-04-30", epsActual: 9 },
    { date: "2026-07-30", epsActual: 9 },
  ], throughJune, asOf);
  assert.equal(byReport.unusableReason, null, byReport.unusableReason ?? "");
  assert.equal(byReport.quarters.find(row => row.date === "2026-01-29")?.eps, 2.84);
  assert.equal(byReport.quarters.find(row => row.date === "2025-10-30")?.eps, 1.85);
  const saturday = resolveAdjustedFmpQuarters([
    { date: "2025-09-27", epsActual: 9 },
    { date: "2025-12-27", epsActual: 9 },
    { date: "2026-03-28", epsActual: 9 },
    { date: "2026-06-27", epsActual: 9 },
  ], throughJune, asOf);
  assert.equal(saturday.adjTtm, null);
  assert.match(saturday.unusableReason ?? "", /Zeitfenster/);
  assert.equal(saturday.quarters.some(row => row.eps === 1.85), false);
});

await ok("AMZN, GOOGL und MU: adjusted Konsens nur im eigenen Fiskaljahr, mit t und Exponent", () => {
  const live = JSON.parse(readFileSync("script/fixtures/recession-yahoo-fy-2026-11-02.json", "utf8")) as {
    names: Record<string, {
      quarters: { end: string; nonGaap: number }[];
      nonGaapFy: { period: string; end: string; avg: number }[];
    }>;
  };
  const asOf = "2026-11-02";
  for (const symbol of ["AMZN", "GOOGL", "MU"]) {
    const book = live.names[symbol];
    const raw = {
      earningsHistoryNonGaap: {
        history: book.quarters.map(row => ({ epsActual: { raw: row.nonGaap }, quarter: { fmt: row.end }, currency: "USD" })),
      },
      earningsTrendNonGaap: {
        trend: book.nonGaapFy.map(row => ({
          period: row.period,
          endDate: row.end,
          earningsEstimate: { avg: { raw: row.avg }, earningsCurrency: "USD" },
        })),
      },
    };
    const proved = provedAdjustedFiscalYear(raw, book.quarters.map(row => row.end), asOf);
    assert.ok(!("reason" in proved), `${symbol} ${"reason" in proved ? proved.reason : ""}`);
    if ("reason" in proved) return;
    const open = book.nonGaapFy.find(row => row.end >= asOf);
    assert.equal(proved.date, open?.end, symbol);
    assert.equal(proved.eps, open?.avg, symbol);
    assert.equal(proved.fiscalYearEnd, book.nonGaapFy.find(row => row.period === "0y")?.end, symbol);
    const t = midToMidDays(horizonDays(asOf, proved.date));
    assert.equal(proved.horizonDays, t, symbol);
    const exponent = FORWARD_HORIZON.oneYearDays / t;
    const grown = annualizedFwdPct(proved.eps, book.quarters.reduce((sum, row) => sum + row.nonGaap, 0), t);
    assert.ok("gFwdPct" in grown, symbol);
    if ("gFwdPct" in grown) assert.ok(Number.isFinite(grown.gFwdPct), `${symbol} ${exponent}`);
  }
  const muEnds = live.names.MU.quarters.map(row => row.end);
  const wrong = provedAdjustedFiscalYear({
    earningsTrendNonGaap: {
      trend: [{ period: "0y", endDate: "2026-12-31", earningsEstimate: { avg: { raw: 10 }, earningsCurrency: "USD" } }],
    },
  }, muEnds, asOf);
  assert.ok("reason" in wrong);
  if ("reason" in wrong) assert.match(wrong.reason, /Quartalen/);
  const unlabeled = provedAdjustedFiscalYear({
    earningsTrend: { trend: [{ period: "0y", endDate: "2026-12-31", earningsEstimate: { avg: { raw: 12.80814 } } }] },
  }, live.names.AMZN.quarters.map(row => row.end), asOf);
  assert.ok("reason" in unlabeled);
  if ("reason" in unlabeled) assert.match(unlabeled.reason, /adjusted/);
});

await ok("Konsens ohne adjusted-Nachweis ist n/a, ein großes adjusted g bleibt im Mittel", async () => {
  const asOf = "2026-11-02";
  const { loadRecessionGrowth } = await import("../server/recession-growth");
  const ends = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
  const quarters = (each: number) => ends.map(date => ({ date, fiscalDateEnding: date, epsActual: each }));
  const yahooFor = (each: number, fy: number) => ({
    earningsHistoryNonGaap: {
      history: ends.map(date => ({ epsActual: { raw: each }, quarter: { fmt: date }, currency: "USD" })),
    },
    earningsTrendNonGaap: {
      trend: [{ period: "0y", endDate: "2026-12-31", earningsEstimate: { avg: { raw: fy }, earningsCurrency: "USD" } }],
    },
  });
  const body = await loadRecessionGrowth("SPY", {
    loadBars: async () => ({ bars: [{ date: "2025-10-31", close: 500 }], source: "yahoo" as const, error: null }),
    fetchMultpl: async () => multplTable(),
    probeFmp: async (path, params) => {
      const symbol = params.symbol;
      if (path === "/analyst-estimates" && (symbol === "SPY" || symbol === "^GSPC")) return { status: 200, json: [], detail: "" };
      if (path === "/financial-estimates") return { status: 404, json: null, detail: "" };
      if (path === "/etf/holdings") return { status: 402, json: null, detail: "" };
      if (path === "/analyst-estimates" && symbol === "PLAIN") {
        return { status: 200, json: [{ date: "2026-12-31", epsAvg: 12.80814, currency: "USD" }], detail: "" };
      }
      if (path === "/earnings" && symbol === "PLAIN") return { status: 200, json: quarters(1.84965), detail: "" };
      if (path === "/analyst-estimates" && symbol === "BIG") {
        return { status: 200, json: [{ date: "2026-12-31", epsAvg: 4, currency: "USD" }], detail: "" };
      }
      if (path === "/earnings" && symbol === "BIG") return { status: 200, json: quarters(1), detail: "" };
      if (path === "/analyst-estimates" && symbol === "OK") {
        return { status: 200, json: [{ date: "2026-12-31", epsAvg: 5, currency: "USD" }], detail: "" };
      }
      if (path === "/earnings" && symbol === "OK") return { status: 200, json: quarters(1), detail: "" };
      return { status: 404, json: null, detail: "unbekannt" };
    },
    loadIncome: async () => [],
    loadYahooSummary: async (symbol: string, modules: readonly string[]) => {
      if (modules.includes("topHoldings")) {
        return { topHoldings: { holdings: [
          { symbol: "PLAIN", holdingPercent: { raw: 0.2 } },
          { symbol: "BIG", holdingPercent: { raw: 0.2 } },
          { symbol: "OK", holdingPercent: { raw: 0.2 } },
        ] } };
      }
      if (!modules.includes("earningsHistoryNonGaap")) return null;
      if (symbol === "PLAIN") {
        return { earningsHistoryNonGaap: yahooFor(1.84965, 99).earningsHistoryNonGaap };
      }
      if (symbol === "BIG") return yahooFor(1, 20);
      if (symbol === "OK") return yahooFor(1, 5);
      return null;
    },
    loadYahooHtml: async () => ({ status: null, html: null, error: "im Test aus" }),
    loadVix: async () => [],
    fmpAvailable: true,
    today: asOf,
  });
  assert.equal(body.forward.available, true);
  if (!body.forward.available) return;
  const line = Object.fromEntries((body.forward.lines ?? []).map(row => [row.symbol, row]));
  assert.equal(line.PLAIN.gAnnPct, null);
  assert.match(line.PLAIN.excludeReason ?? "", /adjusted/);
  assert.match(line.PLAIN.excludeReason ?? "", /12\.8081/);
  const tDays = midToMidDays(horizonDays(asOf, "2026-12-31"));
  const huge = annualizedFwdPct(20, 4, tDays);
  assert.ok("gFwdPct" in huge);
  if ("gFwdPct" in huge) {
    assert.ok(huge.gFwdPct > 100, String(huge.gFwdPct));
    assert.ok(Math.abs((line.BIG.gAnnPct ?? NaN) - huge.gFwdPct) < 1e-6, String(line.BIG.gAnnPct));
  }
  assert.match(line.BIG.source ?? "", /adjusted/);
  assert.equal(body.forward.lines?.some(row => row.symbol === "PLAIN" && row.weight != null), false);
  const calm = annualizedFwdPct(5, 4, tDays);
  assert.ok("gFwdPct" in calm && "gFwdPct" in huge);
  if ("gFwdPct" in calm && "gFwdPct" in huge) {
    assert.ok(Math.abs(body.forward.gFwdPct - (huge.gFwdPct + calm.gFwdPct) / 2) < 1e-6, String(body.forward.gFwdPct));
  }
});

await ok("echte Yahoo-Abstände: Meldetag auf das letzte Quartalsende, ASML Q3 bleibt 11,82", () => {
  const live = JSON.parse(readFileSync("script/fixtures/recession-yahoo-fy-2026-11-02.json", "utf8")) as {
    names: Record<string, {
      quarters: { end: string; reported: string; nonGaap: number; gaap: number }[];
      nonGaapFy: { period: string; end: string; avg: number }[];
      gaapFy: { period: string; end: string; avg: number }[];
    }>;
  };
  const asOf = "2026-11-02";
  for (const symbol of ["META", "AMZN", "GOOGL", "GOOG", "MU", "ASML", "SHEL.L"]) {
    const book = live.names[symbol];
    const fmp = book.quarters.map(row => ({ date: row.reported, fiscalDateEnding: row.end, epsActual: row.gaap }));
    const yahoo = {
      earningsHistoryNonGaap: {
        history: book.quarters.map(row => ({
          epsActual: { raw: row.nonGaap },
          quarter: { fmt: row.end },
          currency: "USD",
        })),
      },
    };
    const got = resolveAdjustedFmpQuarters(fmp, yahoo, asOf);
    const nonGaap = book.quarters.reduce((sum, row) => sum + row.nonGaap, 0);
    const gaap = book.quarters.reduce((sum, row) => sum + row.gaap, 0);
    assert.equal(got.unusableReason, null, `${symbol} ${got.unusableReason}`);
    assert.ok(Math.abs((got.adjTtm ?? 0) - nonGaap) < 1e-6, `${symbol} ${got.adjTtm} != ${nonGaap}`);
    if (Math.abs(nonGaap - gaap) > 0.05) {
      assert.ok(Math.abs((got.adjTtm ?? 0) - gaap) > 0.05, symbol);
    }
    assert.ok(got.quarters.every(row => row.yahooChecked), symbol);
  }
  const asml = live.names.ASML.quarters.find(row => row.end === "2026-09-30");
  assert.ok(asml);
  assert.ok(Math.abs((asml?.nonGaap ?? 0) - 11.8193) < 1e-6);
  assert.ok((asml?.gaap ?? 0) > (asml?.nonGaap ?? 0));
  const others = live.names.ASML.quarters.filter(row => row.end !== "2026-09-30").map(row => row.nonGaap);
  assert.ok(others.every(eps => eps > 7 && eps < 8), others.join(","));
  const meta = live.names.META;
  const metaTtm = meta.quarters.reduce((sum, row) => sum + row.nonGaap, 0);
  assert.ok(Math.abs(metaTtm - 29.77) < 1e-6);
  const open = meta.nonGaapFy.find(row => row.period === "0y");
  const next = meta.nonGaapFy.find(row => row.period === "+1y");
  assert.equal(open?.end, "2026-12-31");
  assert.equal(next?.end, "2027-12-31");
  const tOpen = midToMidDays(horizonDays(asOf, open?.end ?? ""));
  const grown = annualizedFwdPct(open?.avg ?? 0, metaTtm, tOpen);
  assert.ok("gFwdPct" in grown);
  const jumped = annualizedFwdPct(next?.avg ?? 0, metaTtm, midToMidDays(horizonDays(asOf, next?.end ?? "")));
  assert.ok("gFwdPct" in jumped);
  if ("gFwdPct" in grown && "gFwdPct" in jumped) assert.ok(Math.abs(grown.gFwdPct - jumped.gFwdPct) > 1);
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
