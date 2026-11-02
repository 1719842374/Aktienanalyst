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
  alignConsensusToTtm,
  annualizedFwdPct,
  consensusForOneYear,
  horizonDays,
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

await ok("g_ann bei t=40, 84 und 449 ist ungedämpft, nahes FY bleibt", () => {
  assert.equal(FORWARD_HORIZON.oneYearDays, 365);
  assert.equal("stubBelowDays" in FORWARD_HORIZON, false);
  const asOf = "2026-11-02";
  assert.equal(horizonDays(asOf, "2026-12-12"), 40);
  assert.equal(horizonDays(asOf, "2027-01-25"), 84);
  assert.equal(horizonDays(asOf, "2028-01-25"), 449);
  for (const t of [40, 84, 449]) {
    const g = annualizedFwdPct(2, 1, t);
    assert.ok("gFwdPct" in g);
    if ("gFwdPct" in g) {
      assert.ok(Math.abs(g.gFwdPct - powerPct(2, 1, t)) < 1e-6, String(g.gFwdPct));
      const capped = powerPct(2, 1, Math.max(t, 90));
      if (t < 90) assert.ok(Math.abs(g.gFwdPct - capped) > 1);
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
  assert.equal(nvda?.horizonDays, 84);
  const onlyLong = consensusForOneYear([{ date: "2028-01-25", epsAvg: 5 }], asOf);
  assert.equal(onlyLong?.horizonDays, 449);
  assert.equal(onlyLong?.eps, 5);
  const nearNeg = consensusForOneYear([
    { date: "2026-12-12", epsAvg: -1 },
    { date: "2028-01-25", epsAvg: 5 },
  ], asOf);
  assert.equal(nearNeg?.date, "2026-12-12");
  assert.equal(nearNeg?.eps, -1);
  const negCons = annualizedFwdPct(-1, 4, 40);
  assert.ok("reason" in negCons);
  if ("reason" in negCons) assert.match(negCons.reason, /nicht positiv/);
  const negTtm = annualizedFwdPct(5, -2, 84);
  assert.ok("reason" in negTtm);
  if ("reason" in negTtm) assert.match(negTtm.reason, /adjTTM ≤ 0/);
});

await ok("AVGO-Stub bleibt das nahe FY, Gewicht ist Index × min(1, t/365) × Huber", () => {
  const avgoAsOf = "2026-09-01";
  assert.equal(horizonDays(avgoAsOf, "2026-11-01"), 61);
  const avgo = consensusForOneYear([
    { date: "2026-11-01", epsAvg: 4.2 },
    { date: "2027-11-01", epsAvg: 6.1 },
  ], avgoAsOf);
  assert.equal(avgo?.date, "2026-11-01");
  assert.equal(avgo?.eps, 4.2);
  assert.equal(avgo?.horizonDays, 61);
  const g40 = annualizedFwdPct(3, 4, 40);
  const g84 = annualizedFwdPct(6, 4, 84);
  const g449 = annualizedFwdPct(7, 6, 449);
  assert.ok("gFwdPct" in g40 && "gFwdPct" in g84 && "gFwdPct" in g449);
  if (!("gFwdPct" in g40) || !("gFwdPct" in g84) || !("gFwdPct" in g449)) return;
  const weighted = weightedHoldingsForward([
    { symbol: "AVGO", weight: 0.2, gFwdPct: g40.gFwdPct, tDays: 40 },
    { symbol: "NVDA", weight: 0.15, gFwdPct: g84.gFwdPct, tDays: 84 },
    { symbol: "LONG", weight: 0.12, gFwdPct: g449.gFwdPct, tDays: 449 },
    { symbol: "NEG", weight: 0.05, gFwdPct: null, tDays: 84, excludeReason: "n/a — adjTTM ≤ 0" },
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
  assert.ok(Math.abs((bySymbol.NVDA.gAnnPct ?? 0) - g84.gFwdPct) < 1e-9);
  assert.equal(bySymbol.NVDA.tDays, 84);
  assert.ok(Math.abs((bySymbol.LONG.weight ?? 0) - w449) < 1e-12);
  assert.equal(bySymbol.LONG.tDays, 449);
  assert.equal(bySymbol.NEG.gAnnPct, null);
  assert.equal(bySymbol.NEG.weight, null);
  assert.match(bySymbol.NEG.excludeReason ?? "", /adjTTM ≤ 0/);
  assert.match(weighted.note, /technische Stabilisierung/);
  assert.match(weighted.note, /NEG \(adjTTM ≤ 0\)/);
  assert.match(weighted.coverageWarn ?? "", /NEG 5,00 % \(adjTTM ≤ 0\)|NEG 5,0 % \(adjTTM ≤ 0\)/);
  const gaapGoogl = powerPct(7, 10, 449);
  assert.ok(g449.gFwdPct > 0);
  assert.ok(gaapGoogl < 0);
  assert.ok(Math.abs(g449.gFwdPct - gaapGoogl) > 1);
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
      return { status: 200, json: [0, 1, 2, 3].map(i => ({ date: ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"][i], epsActual: each })), detail: "" };
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
    const tDays = horizonDays("2026-11-02", "2027-12-31");
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
        return { status: 200, json: [25, 25, 25, 25].map((eps, i) => ({ date: ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"][i], epsActual: eps })), detail: "" };
      }
      return { status: 500, json: null, detail: "soll nicht laufen" };
    },
  });
  assert.equal(direct.forward.available, true);
  if (direct.forward.available) {
    const gDirect = annualizedFwdPct(110, 100, horizonDays("2026-11-02", "2027-12-31"));
    assert.ok("gFwdPct" in gDirect);
    if ("gFwdPct" in gDirect) assert.ok(Math.abs(direct.forward.gFwdPct - gDirect.gFwdPct) < 1e-6, String(direct.forward.gFwdPct));
    assert.equal(direct.forward.formula, FORWARD_FORMULA_EPS);
    assert.match(direct.forward.source, /epsActual/);
    assert.match(direct.forward.source, /t=/);
  }
  assert.equal(directProbes.includes("/etf/holdings"), false);
  assert.equal(directProbes.includes("/ratios-ttm"), false);
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
    if (path === "/earnings" && (symbol === "AAA" || symbol === "BBB")) {
      return { status: 200, json: [2.5, 2.5, 2.5, 2.5].map((eps, i) => ({ date: ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"][i], epsActual: eps })), detail: "" };
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

await ok("AMZN/GOOGL gegen GAAP, AVGO-Stub, t=40/84/449 und negatives EPS in der Karte", async () => {
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
  const quarters = (each: number) => ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"].map(date => ({ date, epsActual: each }));
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
      if (path === "/analyst-estimates" && symbol === "AMZN") {
        return { status: 200, json: [{ date: "2027-01-25", epsAvg: 6 }, { date: "2028-01-25", epsAvg: 50 }], detail: "" };
      }
      if (path === "/analyst-estimates" && symbol === "GOOGL") {
        return { status: 200, json: [{ date: "2028-01-25", epsAvg: 7 }], detail: "" };
      }
      if (path === "/analyst-estimates" && symbol === "NEG") {
        return { status: 200, json: [{ date: "2027-01-25", epsAvg: 2 }], detail: "" };
      }
      if (path === "/earnings" && symbol === "AVGO") return { status: 200, json: quarters(1), detail: "" };
      if (path === "/earnings" && symbol === "AMZN") return { status: 200, json: quarters(1), detail: "" };
      if (path === "/earnings" && symbol === "GOOGL") return { status: 200, json: quarters(1.5), detail: "" };
      if (path === "/earnings" && symbol === "NEG") return { status: 200, json: quarters(-1), detail: "" };
      return { status: 404, json: null, detail: "unbekannt" };
    },
    loadIncome: async () => [],
    loadYahooSummary: async (_symbol: string, modules: readonly string[]) => {
      if (modules.includes("topHoldings")) {
        return { topHoldings: { holdings: [
          { symbol: "AVGO", holdingPercent: { raw: 0.2 } },
          { symbol: "AMZN", holdingPercent: { raw: 0.15 } },
          { symbol: "GOOGL", holdingPercent: { raw: 0.12 } },
          { symbol: "NEG", holdingPercent: { raw: 0.05 } },
        ] } };
      }
      return { defaultKeyStatistics: {} };
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
  assert.equal(line.AVGO.tDays, 40);
  assert.ok(Math.abs((line.AVGO.gAnnPct ?? NaN) - powerPct(3, 4, 40)) < 1e-6, String(line.AVGO.gAnnPct));
  assert.ok(Math.abs((line.AVGO.weight ?? NaN) - 0.2 * 40 / 365) < 1e-12);
  assert.equal(line.AMZN.tDays, 84);
  assert.ok(Math.abs((line.AMZN.gAnnPct ?? NaN) - powerPct(6, 4, 84)) < 1e-6, String(line.AMZN.gAnnPct));
  assert.equal(line.GOOGL.tDays, 449);
  assert.ok(Math.abs((line.GOOGL.gAnnPct ?? NaN) - powerPct(7, 6, 449)) < 1e-6);
  assert.ok((line.GOOGL.gAnnPct ?? 0) > 0);
  assert.ok(powerPct(7, 10, 449) < 0);
  assert.equal(line.NEG.gAnnPct, null);
  assert.equal(line.NEG.weight, null);
  assert.match(line.NEG.excludeReason ?? "", /adjTTM ≤ 0/);
  assert.match(body.forward.source, /epsActual/);
  assert.match(body.forward.formula, /min\(1, t_i\/365\)/);
  assert.match(body.forward.source, /technische Stabilisierung/);
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
  assert.match(visible, /Technische Stabilisierung/);
  assert.match(visible, /g ist ungedämpft/);
  assert.match(visible, /recession-growth-holding-AVGO/);
  assert.match(visible, /t 40 Tage/);
  assert.match(visible, /recession-growth-holding-AMZN/);
  assert.match(visible, /t 84 Tage/);
  assert.match(visible, /recession-growth-holding-GOOGL/);
  assert.match(visible, /t 449 Tage/);
  assert.match(visible, /adjTTM ≤ 0/);
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
