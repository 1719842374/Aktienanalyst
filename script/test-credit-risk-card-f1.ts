/**
 * F1-20 / F1-21 / F1-24 — Credit-Risiko-Karte in Sektion 10 und PESTEL-Zeile Economic.
 * Markt-Spread BAA10Y (Perzentil), Debt/Equity und Zinsdeckung aus FMP-Ratios.
 * Einstufung aus Perzentil bzw. Peer-Position (Terzile, benannte Parameter). Kein CDS, kein Score, kein CRV.
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-credit-risk-card-f1.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express from "express";
import type { AddressInfo } from "node:net";
import { buildBiasDecision } from "../shared/bias-fixes";
import {
  CREDIT_STANCE_PARAMS,
  creditLevelReading,
  creditMetricReading,
  formatCreditMetric,
  parseCreditRatioRows,
  pestelCreditLine,
} from "../shared/credit";
import type { CreditFundamentalsResponse, CreditPoint, CreditSpreadResponse } from "../shared/schema";

let failed = 0;
let total = 0;
function check(name: string, ok: boolean, detail = "") {
  total++;
  if (ok) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const series = (values: number[]) => values.map((value, i) => ({ date: `${2000 + i}-06-01`, value }));

const levelHigh = creditLevelReading(series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
check("hoher Spread: Perzentil im oberen Terzil, Einstufung angespannt", levelHigh.value === 10 && levelHigh.percentile != null && levelHigh.percentile >= CREDIT_STANCE_PARAMS.stressedPct && levelHigh.stance === "angespannt", JSON.stringify(levelHigh));
const levelLow = creditLevelReading(series([1, 2, 3, 4, 5, 6, 7, 8, 9, 1]));
check("niedriger Spread: unteres Terzil, entspannt", levelLow.value === 1 && levelLow.stance === "entspannt" && (levelLow.percentile ?? 1) <= CREDIT_STANCE_PARAMS.calmPct, JSON.stringify(levelLow));
const levelMid = creditLevelReading(series([1, 2, 3, 4, 5, 6, 7, 8, 9, 5]));
check("mittlerer Spread: Mittelfeld, Schwelle ist das Terzil der Verteilung", levelMid.value === 5 && levelMid.stance === "im Mittelfeld", JSON.stringify(levelMid));
const levelShort = creditLevelReading(series([1, 2]));
check("zu wenig Historie: kein Perzentil, keine Einstufung, kein Ersatzwert 0", levelShort.percentile == null && levelShort.stance == null && levelShort.value === 2 && levelShort.unavailable != null && !/0/.test(levelShort.unavailable), levelShort.unavailable ?? "");
const levelEmpty = creditLevelReading([]);
check("leere BAA10Y-Reihe: n/a, Wert bleibt null", levelEmpty.value == null && levelEmpty.unavailable != null && levelEmpty.stance == null, levelEmpty.unavailable ?? "");

const parsed = parseCreditRatioRows([
  { date: "2023-12-31", debtEquityRatio: 0.4, interestCoverage: 12 },
  { date: "2024-12-31", debtToEquityRatio: 1.5, interestCoverageRatio: 8.5 },
  { date: "2022-12-31", debtEquityRatio: null, interestCoverage: "n/a" },
]);
check("FMP-Aliase: jüngstes Debt/Equity 1.5, Zinsdeckung 8.5", parsed.debtToEquity.value === 1.5 && parsed.interestCoverage.value === 8.5 && parsed.debtToEquity.asOf === "2024-12-31", JSON.stringify(parsed));
check("Historie behält beide Jahre, verwirft null und Text", parsed.debtToEquity.history.length === 2 && parsed.interestCoverage.history.length === 2, JSON.stringify(parsed.debtToEquity.history));
const zeroCov = parseCreditRatioRows([{ date: "2024-12-31", interestCoverage: 0, debtEquityRatio: 0 }]);
check("echte 0 aus FMP bleibt 0 und wird nicht zu n/a", zeroCov.interestCoverage.value === 0 && zeroCov.debtToEquity.value === 0);
const missing = parseCreditRatioRows([{ date: "2024-12-31", priceToEarningsRatio: 20 }]);
check("fehlendes Feld: null und Grund, nicht 0", missing.debtToEquity.value == null && missing.interestCoverage.value == null && /debt/i.test(missing.debtToEquity.unavailable ?? "") && /interest|zins/i.test(missing.interestCoverage.unavailable ?? ""), `${missing.debtToEquity.unavailable} | ${missing.interestCoverage.unavailable}`);
check("leere Ratios: Grund, kein Fake", parseCreditRatioRows([]).debtToEquity.value == null && /leer/i.test(parseCreditRatioRows([]).debtToEquity.unavailable ?? ""));
check("Müll: null mit Grund", parseCreditRatioRows(null).interestCoverage.value == null);

const peerStressed = creditMetricReading({
  value: 4,
  asOf: "2024-12-31",
  unavailable: null,
  ownHistory: [0.2, 0.3, 0.4, 0.5],
  peers: [0.4, 0.6, 0.8],
  direction: "riskUp",
});
check("Peer-Stichprobe schlägt die eigene Historie", peerStressed.basis === "Peers" && peerStressed.sampleSize === 3 && peerStressed.stance === "angespannt" && peerStressed.percentile === 1, JSON.stringify(peerStressed));
const historyFallback = creditMetricReading({
  value: 0.2,
  asOf: "2024-12-31",
  unavailable: null,
  ownHistory: [0.2, 0.8, 1.4, 2.0],
  peers: [0.5],
  direction: "riskUp",
});
check("ein Peer reicht nicht: eigene Historie, niedriges D/E entspannt", historyFallback.basis === "eigene Historie" && historyFallback.stance === "entspannt", JSON.stringify(historyFallback));
const coverageCalm = creditMetricReading({
  value: 20,
  asOf: "2024-12-31",
  unavailable: null,
  ownHistory: [4, 8, 12, 20],
  peers: [],
  direction: "riskDown",
});
check("hohe Zinsdeckung im oberen Terzil ist entspannt (Richtung invertiert)", coverageCalm.basis === "eigene Historie" && coverageCalm.stance === "entspannt" && (coverageCalm.percentile ?? 0) >= CREDIT_STANCE_PARAMS.stressedPct, JSON.stringify(coverageCalm));
const noValue = creditMetricReading({ value: null, asOf: null, unavailable: "FMP-Ratios leer", ownHistory: [1, 2, 3], peers: [1, 2, 3], direction: "riskUp" });
check("fehlender Wert: keine Einstufung aus der Vergleichsgruppe und nicht 0", noValue.value == null && noValue.stance == null && noValue.percentile == null && noValue.basis == null, JSON.stringify(noValue));
check("Anzeige fehlend: n/a — Grund", formatCreditMetric(noValue, 2) === "n/a — FMP-Ratios leer", formatCreditMetric(noValue, 2));
check("Anzeige echte 0", formatCreditMetric({ ...zeroCov.debtToEquity, percentile: null, zScore: null, sampleSize: 1, basis: null, stance: null }, 2) === "0.00");

const line = pestelCreditLine(levelHigh);
check("PESTEL-Zeile nennt BAA10Y, Perzentil und Einstufung", line.includes("BAA10Y") && line.includes("angespannt") && /Perzentil/.test(line) && line.includes("10.00%"), line);
check("PESTEL-Zeile ohne Score und ohne CRV-Wirkung", /kein Score/i.test(line) && /kein CRV/i.test(line) && !/CDS\s*[:=]/.test(line), line);
const lineNa = pestelCreditLine(levelEmpty);
check("PESTEL ohne Daten: n/a — Grund", lineNa.startsWith("Kreditrisiko") && lineNa.includes("n/a —") && !/0\.00%/.test(lineNa), lineNa);

const { loadCreditFundamentals, registerCreditFundamentalsRoute, resetCreditFundamentalsCache } = await import("../server/credit-fundamentals-route");
const rowsFor = (symbol: string) => {
  if (symbol === "MSFT") return [
    { date: "2022-12-31", debtEquityRatio: 0.4, interestCoverage: 20 },
    { date: "2023-12-31", debtEquityRatio: 0.5, interestCoverage: 18 },
    { date: "2024-12-31", debtToEquityRatio: 0.35, interestCoverageRatio: 22 },
  ];
  const peer: Record<string, number> = { AAPL: 1.5, GOOGL: 0.1, ORCL: 0.9 };
  return [{ date: "2024-12-31", debtEquityRatio: peer[symbol], interestCoverage: peer[symbol] != null ? 10 : null }];
};
let fetches = 0;
const loaded = await loadCreditFundamentals("msft", {
  peers: ["AAPL", "GOOGL", "ORCL", "MSFT", "BAD SYMBOL"],
  fetchRatios: async (symbol) => {
    fetches++;
    return rowsFor(symbol);
  },
});
check("Loader: Ticker normalisiert, D/E und Zinsdeckung aus FMP", loaded.ticker === "MSFT" && loaded.debtToEquity.value === 0.35 && loaded.interestCoverage.value === 22 && loaded.source.includes("FMP"), JSON.stringify({ de: loaded.debtToEquity, ic: loaded.interestCoverage }));
check("Loader: Peer-Position (3 Peers, Selbst und Müll verworfen)", loaded.debtToEquity.basis === "Peers" && loaded.debtToEquity.sampleSize === 3, JSON.stringify(loaded.debtToEquity));
check("Loader: ein Abruf je Symbol", fetches === 4, String(fetches));
resetCreditFundamentalsCache();
let fetches2 = 0;
const failLoad = await loadCreditFundamentals("SAP.DE", {
  fetchRatios: async () => {
    fetches2++;
    throw new Error("FMP_API_KEY not set");
  },
});
check("FMP fehlt: beide Kennzahlen n/a mit Grund, Werte null", failLoad.debtToEquity.value == null && failLoad.interestCoverage.value == null && /FMP_API_KEY/.test(failLoad.debtToEquity.unavailable ?? "") && failLoad.note != null, failLoad.debtToEquity.unavailable ?? "");
const again = await loadCreditFundamentals("SAP.DE", {
  fetchRatios: async () => {
    fetches2++;
    throw new Error("FMP_API_KEY not set");
  },
});
check("Fehler werden nicht gecacht", fetches2 === 2 && again.debtToEquity.value == null, String(fetches2));

resetCreditFundamentalsCache();
const app = express();
registerCreditFundamentalsRoute(app, {
  fetchRatios: async () => [{ date: "2024-12-31", debtEquityRatio: 0.42, interestCoverage: 11 }],
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
const res = await fetch(`http://127.0.0.1:${port}/api/credit-fundamentals/VOW3.DE`);
const body = await res.json() as CreditFundamentalsResponse;
check("Route GET /api/credit-fundamentals/:ticker", res.status === 200 && body.ticker === "VOW3.DE" && body.debtToEquity.value === 0.42 && body.interestCoverage.value === 11, JSON.stringify(body));
const bad = await fetch(`http://127.0.0.1:${port}/api/credit-fundamentals/`);
check("Route ohne Ticker bleibt 404", bad.status === 404);
server.close();

const routesSrc = readFileSync("server/routes.ts", "utf8");
check("Route hängt in server/routes.ts", routesSrc.includes("registerCreditFundamentalsRoute") && routesSrc.includes("credit-fundamentals-route"));
const analyzeSrc = readFileSync("server/analyze-route.ts", "utf8");
check("analyze-route.ts unberührt von Credit-Fundamentals", !analyzeSrc.includes("credit-fundamentals") && !analyzeSrc.includes("interestCoverage"));
for (const f of ["server/scoring-integration.ts", "shared/bias-fixes.ts", "client/src/components/sections/Section6.tsx"]) {
  const src = readFileSync(f, "utf8");
  check(`${f} ohne Credit-Karte`, !src.includes("credit-fundamentals") && !src.includes("interestCoverage"));
}

const points: CreditPoint[] = series([1, 2, 3, 4, 5, 6, 7, 8, 9]);
const spread: CreditSpreadResponse = {
  seriesId: "BAA10Y",
  source: "FRED BAA10Y (Moody's Baa − 10Y Treasury)",
  sourceUrl: "https://fred.stlouisfed.org/series/BAA10Y",
  points,
  stress: null,
  note: null,
};
const fundamentals: CreditFundamentalsResponse = loaded;
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
qc.setQueryData(["/api/credit-spread/market"], spread);
qc.setQueryData([`/api/credit-fundamentals/MSFT?peers=${encodeURIComponent("AAPL,GOOGL,ORCL")}`], fundamentals);

const data: any = {
  ticker: "MSFT",
  companyName: "Microsoft",
  currency: "USD",
  description: "Software",
  industry: "Software",
  sector: "Technology",
  revenue: 200e9,
  revenueGrowth: 10,
  fcfMargin: 30,
  forwardPE: 25,
  beta5Y: 0.9,
  governmentExposure: 5,
  catalysts: [{ name: "Cloud", tags: [] }],
  newsItems: [],
  risks: [
    { name: "Credit Quality Deterioration", category: "Gradual", ew: 20, impact: 10, expectedDamage: 2 },
    { name: "Earnings Miss / Guidance Cut", category: "Binary", ew: 15, impact: 20, expectedDamage: 3 },
  ],
  sectorProfile: { sector: "Technology", waccScenarios: { kons: 8, avg: 9, opt: 7 }, growthAssumptions: { g1: 8, g2: 6, terminal: 2.5 } },
  totalDebt: 50e9,
  cashEquivalents: 20e9,
  fcfHaircut: 0,
  fcfTTM: 60e9,
  sharesOutstanding: 7e9,
  currentPrice: 400,
  analystPT: { median: 450 },
  peRatio: 30,
  marketCap: 3e12,
  financialStatements: { incomeStatement: { revenueGrowth: 10 } },
  peerComparison: { peers: [{ ticker: "ORCL" }, { ticker: "AAPL" }, { ticker: "GOOGL" }] },
  pestelAnalysis: {
    factors: [
      { category: "Political", categoryDE: "Politisch", icon: "🏦", factors: [{ name: "Handel", impact: "Neutral", stockCorrelation: "Neutral", stockCorrelationNote: "", severity: "Mittel", description: "x" }], regionalOutlook: "stabil", exposureRating: "Niedrig" },
      { category: "Economic", categoryDE: "Ökonomisch", icon: "📈", factors: [{ name: "Zinsen", impact: "Neutral", stockCorrelation: "Negativ", stockCorrelationNote: "", severity: "Mittel", description: "WACC" }], regionalOutlook: "Zinsen", exposureRating: "Mittel" },
    ],
    overallExposure: "Mittel",
    macroSummary: "Neutral",
    geopoliticalScore: 5,
    interestRateOutlook: "stabil",
    capitalCostImpact: "moderat",
  },
};

(globalThis as any).React = React;
const { Section8 } = await import("../client/src/components/sections/Section8");
const { PestelSection } = await import("../client/src/components/sections/PestelSection");
const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Section8, { data, useLLM: false })));
check("Sektion 10 rendert die Credit-Karte", html.includes('data-testid="credit-risk-card"'), html.slice(0, 200));
check("Karte zeigt BAA10Y und historisches Perzentil", /data-testid="credit-spread-value"[^>]*>[^<]*9\.00%/.test(html) && html.includes('data-testid="credit-spread-percentile"') && /Perzentil/.test(html), html.match(/data-testid="credit-spread-value"[\s\S]{0,180}/)?.[0] ?? "");
check("Karte zeigt Debt/Equity 0.35 und Zinsdeckung 22", html.includes('data-testid="credit-debt-equity"') && html.includes("0.35") && html.includes('data-testid="credit-interest-coverage"') && html.includes("22.00"), "");
check("Karte nennt die Peer-Einstufung und verbietet CDS/Score/CRV", html.includes("Peers") && html.includes("kein Score") && html.includes("kein CRV") && html.includes("kein CDS"), "");
check("Expected Damage der Risikotabelle bleibt 5.0", /Total Expected Damage[\s\S]{0,120}5\.0%/.test(html) || />5\.0%</.test(html), html.match(/Total Expected Damage[\s\S]{0,160}/)?.[0] ?? "");
const emptyQc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const emptyHtml = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: emptyQc }, React.createElement(Section8, { data, useLLM: false })));
const card = emptyHtml.slice(emptyHtml.indexOf('data-testid="credit-risk-card"'), emptyHtml.indexOf('data-testid="credit-risk-card"') + 900);
check("ohne Antwort: n/a im Kartenblock, kein Fake-0.00", card.includes("n/a —") && !card.includes("0.00"), card);

const pestelHtml = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, React.createElement(PestelSection, { data })));
const eco = pestelHtml.indexOf('data-testid="button-pestel-Economic"');
const lineAt = pestelHtml.indexOf('data-testid="pestel-credit-line"');
const nextCat = pestelHtml.indexOf('data-testid="button-pestel-Political"');
check("Economic enthält die Kreditrisiko-Zeile aus BAA10Y", eco >= 0 && lineAt > eco && (nextCat < eco || lineAt < nextCat || nextCat < 0) && pestelHtml.includes("BAA10Y") && pestelHtml.includes("angespannt"), pestelHtml.slice(Math.max(0, eco), eco + 500));

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
check("VOW3 (VWAGY) Score 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718", String(pin.VWAGY.overallScore));
check("SAP Score 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758", String(pin.SAP.overallScore));
check("MSFT Score 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138", String(pin.MSFT.overallScore));
const msftFx = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const before = buildBiasDecision(msftFx);
const after = buildBiasDecision({ ...msftFx, creditSpread: spread, creditFundamentals: fundamentals } as any);
check("MSFT-Fixture: Credit-Felder ändern Score und Rating nicht", before.overallScore === after.overallScore && before.overallRating === after.overallRating, `${before.overallScore} → ${after.overallScore} / ${before.overallRating} → ${after.overallRating}`);

console.log(failed ? `\n${failed}/${total} fehlgeschlagen` : `\nalle ${total} grün`);
process.exit(failed ? 1 : 0);
