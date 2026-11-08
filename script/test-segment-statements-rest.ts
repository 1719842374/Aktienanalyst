/**
 * Segment-Unterposten und Jahresabschluss ohne Live-FMP.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-segment-statements-rest.ts
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import express from "express";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildFinancialHistory, fcfOf, marginPct } from "../shared/financial-history";
import { balanceSankey, incomeSankey } from "../shared/statement-sankey";
import {
  assignProvenHints,
  buildSegmentSupplement,
  segmentGrowthOverrides,
  type OfficialSegment,
} from "../shared/segment-supplement";
import { registerFinancialHistoryRoute } from "../server/financial-history-route";
import { registerSegmentSupplementRoute } from "../server/segment-supplement-route";
import { registerRoutes } from "../server/routes-register";
import { registerApiNotFound } from "../server/api-not-found";
import { AnnualFinancials, AnnualFinancialsView, fetchFinancialHistory } from "../client/src/components/sections/AnnualFinancials";
import { StatementSankey } from "../client/src/components/sections/StatementSankey";
import {
  SegmentSupplementBody,
  UnregisteredRouteError,
  fetchSegmentSupplement,
} from "../client/src/components/sections/SegmentSupplementView";

function htmlOf(node: React.ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, node));
}

function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const parents: OfficialSegment[] = [
  { name: "Alpha", percentage: 60, reportedGrowthPct: 4 },
  { name: "Beta", percentage: 40, reportedGrowthPct: null },
];
const history = [
  { fiscalYear: "2022", name: "Alpha", revenue: 100 },
  { fiscalYear: "2023", name: "Alpha", revenue: 110 },
  { fiscalYear: "2024", name: "Alpha", revenue: 121 },
  { fiscalYear: "2022", name: "Beta", revenue: 50 },
  { fiscalYear: "2024", name: "Beta", revenue: 80 },
];
const supplement = buildSegmentSupplement(parents, history, [
  { parent: "Alpha", name: "Hinweis", shareOfParentPct: 25, source: "Fixture-Quelle" },
  { parent: "Alpha", name: "Offen", shareOfParentPct: null, source: "Fixture-Quelle", note: "ohne Zahl" },
  { parent: "Alpha", name: "Beta", shareOfParentPct: 10, source: "Fixture-Quelle" },
  { parent: "Niemand", name: "Fremd", shareOfParentPct: 10, source: "Fixture-Quelle" },
  { parent: "Alpha", name: "Leer", shareOfParentPct: 10, source: "  " },
  { parent: "Alpha", name: "Zu hoch", shareOfParentPct: 150, source: "Fixture-Quelle" },
]);

assert.deepEqual(supplement.parents, parents);
assert.equal(supplement.reportedSharePct, 100);
assert.equal(supplement.subItems.some((item) => item.name === "Beta"), false);
assert.equal(supplement.subItems.find((item) => item.name === "Hinweis")?.shareOfParentPct, 25);
assert.equal(supplement.subItems.find((item) => item.name === "Offen")?.shareOfParentPct, null);
assert.match(supplement.subItems.find((item) => item.name === "Offen")?.label ?? "", /nicht schätzbar/);
assert.equal(supplement.subItems.find((item) => item.name === "Zu hoch")?.shareOfParentPct, null);
assert.equal(supplement.growth[0].nextYearGrowthPct, 10);
assert.equal(supplement.growth[0].override, true);
assert.equal(supplement.growth[0].reportedGrowthPct, 4);
assert.match(supplement.growth[0].source ?? "", /revenue-product-segmentation/);
assert.equal(supplement.growth[1].nextYearGrowthPct, null);
assert.match(supplement.growth[1].label, /nicht schätzbar/);
assert.match(supplement.undisclosedNote, /nicht in die Top-Level-Summe/);

const negativeParents: OfficialSegment[] = [
  { name: "Negativ", percentage: -10, reportedGrowthPct: null },
  { name: "Rest", percentage: 110, reportedGrowthPct: null },
];
const negativeShare = buildSegmentSupplement(negativeParents, [], []);
assert.equal(negativeShare.reportedSharePct, 100);
assert.equal(negativeShare.parents[0].percentage, -10);
assert.match(negativeShare.undisclosedNote, /nicht schätzbar/);

const over = assignProvenHints(parents, [
  { parent: "Alpha", name: "Eins", shareOfParentPct: 70, source: "Quelle A" },
  { parent: "Alpha", name: "Zwei", shareOfParentPct: 50, source: "Quelle B" },
]);
assert.equal(over.childShareNotes.length, 1);
assert.equal(over.items[0].shareOfParentPct, 70);
const rejected = assignProvenHints(parents, [
  { parent: "Alpha", name: "Beta", shareOfParentPct: 10, source: "Fixture-Quelle" },
  { parent: "Niemand", name: "Fremd", shareOfParentPct: 10, source: "Fixture-Quelle" },
  { parent: "Alpha", name: "Leer", shareOfParentPct: 10, source: "  " },
]);
assert.match(rejected.dropped.join("\n"), /kein neues Top-Level-Segment/);
assert.match(rejected.dropped.join("\n"), /Elternsegment/);
assert.match(rejected.dropped.join("\n"), /keine Quelle/);

const skipped = segmentGrowthOverrides(
  [{ name: "Alpha", percentage: 100, reportedGrowthPct: null }],
  [
    { fiscalYear: "2022", name: "Alpha", revenue: 100 },
    { fiscalYear: "2023", name: "Alpha", revenue: -40 },
    { fiscalYear: "2024", name: "Alpha", revenue: 80 },
  ],
);
assert.equal(skipped[0].nextYearGrowthPct, null);

const incomplete = buildSegmentSupplement(
  [{ name: "Alpha", percentage: null, reportedGrowthPct: 3 }],
  history,
  [],
);
assert.equal(incomplete.reportedSharePct, null);
assert.match(incomplete.reportedShareReason ?? "", /unvollständig/);
assert.equal(incomplete.growth[0].reportedGrowthPct, 3);

const years = [];
for (let year = 2014; year <= 2024; year += 1) {
  years.push({
    date: `${year}-12-31`,
    fiscalYear: year,
    reportedCurrency: "EUR",
    revenue: year === 2024 ? 2.5e9 : 2e9,
    grossProfit: 1e9,
    operatingIncome: 4e8,
    netIncome: year === 2024 ? -1.5e8 : 2e8,
  });
}
const built = buildFinancialHistory({
  income: years,
  balance: [
    { fiscalYear: 2023, reportedCurrency: "EUR", totalAssets: 10e9, totalStockholdersEquity: 4e9, totalDebt: 1e9, cashAndCashEquivalents: 5e8 },
    { fiscalYear: 2024, reportedCurrency: "EUR", totalAssets: 9e9, totalStockholdersEquity: -2e9, totalDebt: 3e9, cashAndCashEquivalents: 1e8 },
  ],
  cashflow: [
    { fiscalYear: 2024, reportedCurrency: "EUR", freeCashFlow: -5e7 },
    { fiscalYear: 2023, reportedCurrency: "EUR", operatingCashFlow: 10, capitalExpenditure: -4 },
  ],
});
assert.equal(built.years.length, 10);
assert.equal(built.years[0].fiscalYear, "2015");
assert.match(built.years[0].revenueYoy.reason ?? "", /erstes Jahr/);
assert.equal(built.currency, "EUR");
assert.equal(built.years.at(-1)?.netIncome, -1.5e8);
assert.equal(built.years.at(-1)?.totalEquity, -2e9);
assert.equal(built.years.at(-1)?.fcf, -5e7);
assert.equal(built.years.find((year) => year.fiscalYear === "2023")?.fcf, 6);
assert.equal(fcfOf({}).fcf, null);
assert.equal(marginPct(10, 0).pct, null);
assert.match(marginPct(10, -5).reason ?? "", /nicht positiv/);

const gapped = buildFinancialHistory({
  income: [
    { fiscalYear: 2020, reportedCurrency: "USD", revenue: 100, netIncome: 10 },
    { fiscalYear: 2022, reportedCurrency: "EUR", revenue: 0, netIncome: 5 },
  ],
  balance: [],
  cashflow: [],
});
assert.equal(gapped.currency, null);
assert.match(gapped.currencyNote ?? "", /mehrere Berichtswährungen/);
assert.match(gapped.years[1].revenueYoy.reason ?? "", /angrenzende Vorperiode/);
assert.equal(gapped.years[1].netMarginPct, null);

const blankCurrency = buildFinancialHistory({
  income: [{ fiscalYear: 2024, revenue: 1e9, netIncome: 1 }],
  balance: [],
  cashflow: [],
});
assert.equal(blankCurrency.currency, null);
assert.match(blankCurrency.currencyNote ?? "", /keine globale Zuordnung/);

const reportedZero = fcfOf({ freeCashFlow: 0, operatingCashFlow: 40, capitalExpenditure: -10 });
assert.equal(reportedZero.fcf, 0);
assert.equal(reportedZero.reason, null);
const missingFcf = fcfOf({ operatingCashFlow: 5, capitalExpenditure: -5 });
assert.equal(missingFcf.fcf, null);
const nonFiniteFcf = fcfOf({ freeCashFlow: Number.NaN, operatingCashFlow: 8, capitalExpenditure: -3 });
assert.equal(nonFiniteFcf.fcf, 5);

const mixedCurrency = buildFinancialHistory({
  income: [
    { fiscalYear: 2023, reportedCurrency: "EUR", revenue: 100, netIncome: 10 },
    { fiscalYear: 2024, reportedCurrency: "USD", revenue: 110, netIncome: 12 },
  ],
  balance: [],
  cashflow: [
    { fiscalYear: 2024, reportedCurrency: "USD", freeCashFlow: 0, operatingCashFlow: 40, capitalExpenditure: -10 },
  ],
});
assert.equal(mixedCurrency.currency, null);
assert.match(mixedCurrency.currencyNote ?? "", /keine Umrechnung/);
assert.equal(mixedCurrency.years[1].revenueYoy.value, null);
assert.match(mixedCurrency.years[1].revenueYoy.reason ?? "", /EUR und USD/);
assert.equal(mixedCurrency.years[1].fcf, 0);
assert.equal(mixedCurrency.years[1].incomeCurrency, "USD");
assert.equal(mixedCurrency.years[0].incomeCurrency, "EUR");

const partialCurrency = buildFinancialHistory({
  income: [
    { fiscalYear: 2023, reportedCurrency: "EUR", revenue: 100 },
    { fiscalYear: 2024, revenue: 110 },
  ],
  balance: [],
  cashflow: [],
});
assert.equal(partialCurrency.currency, null);
assert.match(partialCurrency.currencyNote ?? "", /keine globale Zuordnung/);
assert.equal(partialCurrency.years[1].revenueYoy.value, null);
assert.match(partialCurrency.years[1].revenueYoy.reason ?? "", /fehlt/);
assert.equal(partialCurrency.years[0].incomeCurrency, "EUR");
assert.equal(partialCurrency.years[1].incomeCurrency, null);

const sameCurrency = buildFinancialHistory({
  income: [
    { fiscalYear: 2023, reportedCurrency: "EUR", revenue: 100 },
    { fiscalYear: 2024, reportedCurrency: "EUR", revenue: 110 },
  ],
  balance: [],
  cashflow: [],
});
assert.equal(sameCurrency.currency, "EUR");
assert.equal(sameCurrency.years[1].revenueYoy.value, 10);

const mismatchedSankey = incomeSankey({
  segments: [{ name: "Alt", revenue: 40, fiscalYear: "2020", currency: "USD" }],
  revenue: 100,
  grossProfit: 40,
  operatingIncome: 10,
  netIncome: 5,
  statementYear: "2024",
  statementCurrency: "EUR",
});
assert.equal(mismatchedSankey.links.some((link) => link.source === "Alt"), false);
assert.match(mismatchedSankey.notes.join(" "), /Segmentjahr passt nicht/);
assert.match(mismatchedSankey.notes.join(" "), /nicht gleich/);
const missingMetaSankey = incomeSankey({
  segments: [{ name: "Alt", revenue: 40 }],
  revenue: 100,
  grossProfit: 40,
  operatingIncome: 10,
  netIncome: 5,
  statementYear: "2024",
  statementCurrency: "EUR",
});
assert.equal(missingMetaSankey.links.some((link) => link.source === "Alt"), false);
assert.match(missingMetaSankey.notes.join(" "), /Segmentjahr fehlt/);
assert.match(missingMetaSankey.notes.join(" "), /Segmentwährung fehlt/);

const incomeModel = incomeSankey({
  segments: [
    { name: "Alpha", revenue: 80, fiscalYear: "2024", currency: "EUR" },
    { name: "Beta", revenue: 80, fiscalYear: "2024", currency: "EUR" },
    { name: "Leer", revenue: 0, fiscalYear: "2024", currency: "EUR" },
  ],
  revenue: 100,
  grossProfit: 40,
  operatingIncome: 10,
  netIncome: -5,
  statementYear: "2024",
  statementCurrency: "EUR",
});
assert.ok(incomeModel.links.every((link) => link.value > 0));
assert.equal(incomeModel.links.some((link) => link.source === "Alpha"), false);
assert.match(incomeModel.notes.join(" "), /negativ/);
const balanceModel = balanceSankey({ totalAssets: 100, totalEquity: -20, totalDebt: 30 });
assert.ok(balanceModel.links.every((link) => link.value > 0));
assert.equal(balanceModel.links.some((link) => link.target === "Eigenkapital"), false);
assert.equal(balanceModel.links.find((link) => link.target === "Schulden")?.value, 30);
assert.match(balanceModel.notes.join(" "), /negativ/);

const app = express();
app.use(express.json());
let incomeCalls = 0;
registerFinancialHistoryRoute(app, {
  fmpAvailable: () => true,
  income: async () => {
    incomeCalls += 1;
    return [{ fiscalYear: 2024, reportedCurrency: "EUR", revenue: 2.5e9, grossProfit: 1e9, operatingIncome: 4e8, netIncome: -1.5e8 }];
  },
  balance: async () => [{ fiscalYear: 2024, reportedCurrency: "EUR", totalAssets: 9e9, totalStockholdersEquity: -2e9, totalDebt: 3e9 }],
  cashflow: async () => [{ fiscalYear: 2024, reportedCurrency: "EUR", freeCashFlow: -5e7 }],
});
let rawCalls = 0;
registerSegmentSupplementRoute(app, {
  fmpAvailable: () => true,
  raw: async () => {
    rawCalls += 1;
    return [
      { fiscalYear: 2022, date: "2022-12-31", data: { Alpha: 100, Beta: 50 } },
      { fiscalYear: 2023, date: "2023-12-31", data: { Alpha: 110, Beta: 40 } },
      { fiscalYear: 2024, date: "2024-12-31", data: { Alpha: 121, Beta: 80 } },
    ];
  },
  hints: async () => [{ parent: "Alpha", name: "Hinweis", shareOfParentPct: 25, source: "Fixture-Quelle" }],
});
const server = await listen(app);

try {
  const bad = await fetch(`${server.base}/api/financial-history/nicht%20gut`);
  assert.equal(bad.status, 400);
  const historyRes = await fetchFinancialHistory("msft", (method, url) => fetch(`${server.base}${url}`, { method }));
  assert.equal(historyRes.ticker, "MSFT");
  assert.equal(historyRes.currency, "EUR");
  assert.equal(historyRes.years[0].netIncome, -1.5e8);
  assert.equal(historyRes.years[0].totalEquity, -2e9);
  assert.equal(incomeCalls, 1);

  const ignored = await fetchSegmentSupplement(
    { ticker: "msft", segments: parents },
    (method, url, data) => fetch(`${server.base}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(data as object), hints: [{ parent: "Alpha", name: "Erfunden", shareOfParentPct: 99, source: "Client" }] }),
    }),
  );
  assert.equal(ignored.reportedSharePct, 100);
  assert.equal(ignored.subItems.length, 1);
  assert.equal(ignored.subItems[0].name, "Hinweis");
  assert.equal(ignored.subItems[0].source, "Fixture-Quelle");
  assert.equal(ignored.growth.find((row) => row.name === "Alpha")?.nextYearGrowthPct, 10);
  assert.equal(rawCalls, 1);

  const invalid = await fetch(`${server.base}/api/segment-supplement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: "MSFT", segments: [{ name: "Alpha", percentage: "60" }] }),
  });
  assert.equal(invalid.status, 400);

  const table = htmlOf(React.createElement(AnnualFinancials, {
    ticker: "MSFT",
    segments: [{ name: "Alpha", revenue: 60 }],
    history: historyRes,
  }));
  assert.match(table, /data-testid="annual-table"/);
  assert.match(table, /cell-revenue-2024/);
  assert.match(table, /€2\.5B/);
  assert.match(table, /-€150\.0M/);
  assert.match(table, /-€2\.0B/);
  assert.doesNotMatch(table, /\$/);
  const mixedHtml = renderToStaticMarkup(React.createElement(AnnualFinancialsView, {
    history: { ticker: "MIX", source: "fmp", ...mixedCurrency },
    segments: [{ name: "Alt", revenue: 40, fiscalYear: "2020", currency: "USD" }],
    view: "table",
  }));
  assert.match(mixedHtml, /EUR und USD/);
  assert.match(mixedHtml, /data-testid="annual-currency-note"/);
  assert.match(mixedHtml, /€100/);
  assert.match(mixedHtml, /\$110/);
  assert.match(mixedHtml, /\$0/);
  const sankeyMismatchHtml = renderToStaticMarkup(React.createElement(AnnualFinancialsView, {
    history: { ticker: "MIX", source: "fmp", ...mixedCurrency },
    segments: [{ name: "Alt", revenue: 40, fiscalYear: "2020", currency: "EUR" }],
    view: "sankey",
  }));
  assert.match(sankeyMismatchHtml, /Segmentjahr passt nicht/);
  assert.match(sankeyMismatchHtml, /nicht gleich/);
  assert.doesNotMatch(sankeyMismatchHtml, /title="Alt"/);
  const sankeyHtml = renderToStaticMarkup(React.createElement(AnnualFinancialsView, {
    history: historyRes,
    segments: [{ name: "Alpha", revenue: 60 }, { name: "Beta", revenue: 80 }],
    view: "sankey",
  }));
  assert.match(sankeyHtml, /data-testid="statement-sankey"/);
  assert.match(sankeyHtml, /negativ/);
  const incomeHtml = renderToStaticMarkup(React.createElement(StatementSankey, { model: incomeModel }));
  assert.match(incomeHtml, /Segmentumsätze übersteigen/);
  assert.doesNotMatch(incomeHtml, />0</);

  const segmentHtml = renderToStaticMarkup(React.createElement(SegmentSupplementBody, { data: ignored }));
  assert.match(segmentHtml, /data-testid="segment-supplement"/);
  assert.match(segmentHtml, /pl-8/);
  assert.match(segmentHtml, /Top-Level-Summe 100\.0 %/);
  assert.match(segmentHtml, /25\.0 % vom Elternsegment/);
  assert.match(segmentHtml, /Quelle: Fixture-Quelle/);
  assert.match(segmentHtml, /Override \+10\.0 %/);
  assert.doesNotMatch(segmentHtml, /Erfunden/);
} finally {
  await server.close();
}

const closed = express();
closed.use(express.json());
registerFinancialHistoryRoute(closed, {
  fmpAvailable: () => false,
  income: async () => { throw new Error("live"); },
  balance: async () => { throw new Error("live"); },
  cashflow: async () => { throw new Error("live"); },
});
registerSegmentSupplementRoute(closed, {
  fmpAvailable: () => false,
  raw: async () => { throw new Error("live"); },
  hints: async () => [],
});
const closedServer = await listen(closed);
try {
  const quiet = await fetchFinancialHistory("MSFT", (method, url) => fetch(`${closedServer.base}${url}`, { method }));
  assert.match(quiet.note ?? "", /FMP_API_KEY fehlt/);
  assert.equal(quiet.years.length, 0);
  const quietSegments = await fetchSegmentSupplement(
    { ticker: "MSFT", segments: parents },
    (method, url, data) => fetch(`${closedServer.base}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  );
  assert.match(quietSegments.growth[0].label, /FMP_API_KEY fehlt/);
  assert.match(quietSegments.growth[0].label, /nicht schätzbar/);
  assert.equal(quietSegments.subItems.length, 0);
} finally {
  await closedServer.close();
}

const missing = express();
missing.use("/api", (_req, res) => {
  res.status(404).json({ error: "not_found", message: "Unknown API route" });
});
const missingServer = await listen(missing);
try {
  await assert.rejects(
    () => fetchFinancialHistory("MSFT", (method, url) => fetch(`${missingServer.base}${url}`, { method })),
    (error: unknown) => error instanceof UnregisteredRouteError,
  );
} finally {
  await missingServer.close();
}

const section2 = readFileSync("client/src/components/sections/Section2.tsx", "utf8");
const statements = readFileSync("client/src/components/sections/FinancialStatements.tsx", "utf8");
const register = readFileSync("server/routes-register.ts", "utf8");
const routes = readFileSync("server/routes.ts", "utf8");
const fmp = readFileSync("server/fmp.ts", "utf8");
assert.match(section2, /SegmentSupplementView/);
assert.match(section2, /SegmentGrowthReadout/);
assert.doesNotMatch(section2, /BrowserSpeech|speechSynthesis|PodcastTranscript/);
assert.match(statements, /AnnualFinancials/);
assert.match(statements, /Income Statement \(TTM\)/);
assert.match(statements, /Margen-Wasserfall/);
assert.match(register, /registerFinancialHistoryRoute\(app\)/);
assert.match(register, /registerSegmentSupplementRoute\(app\)/);
const valueChainAt = register.indexOf("registerValueChainRoutes(app)");
const historyAt = register.indexOf("registerFinancialHistoryRoute(app)");
const supplementAt = register.indexOf("registerSegmentSupplementRoute(app)");
assert.ok(valueChainAt >= 0 && historyAt > valueChainAt && supplementAt > historyAt);
assert.doesNotMatch(routes, /financial-history-route|segment-supplement-route/);
assert.doesNotMatch(fmp, /fmpProductSegmentationRaw/);
for (const file of [
  "shared/financial-history.ts",
  "shared/statement-sankey.ts",
  "shared/segment-supplement.ts",
  "server/financial-history-route.ts",
  "server/segment-supplement-route.ts",
  "client/src/components/sections/AnnualFinancials.tsx",
  "client/src/components/sections/SegmentSupplementView.tsx",
]) {
  const source = readFileSync(file, "utf8");
  assert.doesNotMatch(source, /function piotroski|waccRoicSignal|callLLMJson|OPENROUTER_API_KEY|FSD \/ Software|73\.3/);
}

const indexSource = readFileSync("server/index.ts", "utf8");
assert.match(indexSource, /import \{ registerRoutes \} from "\.\/routes-register"/);
assert.match(indexSource, /await registerRoutes\(httpServer, app\)/);
assert.match(indexSource, /registerApiNotFound\(app\)/);

const savedFmpKey = process.env.FMP_API_KEY;
const savedFmpKeyAlt = process.env.FMP_API_key;
delete process.env.FMP_API_KEY;
delete process.env.FMP_API_key;
const hub = express();
hub.use(express.json());
const hubHttp = createServer(hub);
await registerRoutes(hubHttp, hub);
registerApiNotFound(hub);
const hubServer = await listen(hub);
try {
  delete process.env.FMP_API_KEY;
  delete process.env.FMP_API_key;
  const historyResponse = await fetch(`${hubServer.base}/api/financial-history/MSFT`);
  assert.equal(historyResponse.status, 200);
  assert.match(historyResponse.headers.get("content-type") || "", /json/);
  const historyBody = await historyResponse.json() as {
    ticker: string;
    years: unknown[];
    currency: string | null;
    note: string | null;
    source: string;
  };
  assert.equal(historyBody.ticker, "MSFT");
  assert.deepEqual(historyBody.years, []);
  assert.equal(historyBody.currency, null);
  assert.match(historyBody.note ?? "", /FMP_API_KEY fehlt/);
  assert.equal(historyBody.source, "fmp");
  console.log("hub GET /api/financial-history/MSFT", historyResponse.status, JSON.stringify(historyBody));
  const viaUi = await fetchFinancialHistory("msft", (method, url) => fetch(`${hubServer.base}${url}`, { method }));
  assert.equal(viaUi.ticker, "MSFT");
  assert.equal(viaUi.years.length, 0);

  const badHistory = await fetch(`${hubServer.base}/api/financial-history/nicht%20gut`);
  assert.equal(badHistory.status, 400);
  assert.match(badHistory.headers.get("content-type") || "", /json/);

  const segmentResponse = await fetch(`${hubServer.base}/api/segment-supplement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ticker: "MSFT",
      segments: [{ name: "Alpha", percentage: 100, reportedGrowthPct: null }],
      hints: [{ parent: "Alpha", name: "Erfunden", shareOfParentPct: 12, source: "Client" }],
    }),
  });
  assert.equal(segmentResponse.status, 200);
  const segmentBody = await segmentResponse.json() as {
    ticker: string;
    parents: { name: string; percentage: number | null }[];
    subItems: unknown[];
    reportedSharePct: number | null;
    growth: { label: string; nextYearGrowthPct: number | null }[];
    source: string;
  };
  assert.equal(segmentBody.ticker, "MSFT");
  assert.equal(segmentBody.reportedSharePct, 100);
  assert.equal(segmentBody.parents[0].percentage, 100);
  assert.deepEqual(segmentBody.subItems, []);
  assert.equal(segmentBody.growth[0].nextYearGrowthPct, null);
  assert.match(segmentBody.growth[0].label, /FMP_API_KEY fehlt/);
  assert.match(segmentBody.growth[0].label, /nicht schätzbar/);
  assert.equal(segmentBody.source, "fmp");
  console.log("hub POST /api/segment-supplement", segmentResponse.status, JSON.stringify({
    ticker: segmentBody.ticker,
    reportedSharePct: segmentBody.reportedSharePct,
    subItems: segmentBody.subItems,
    growth: segmentBody.growth,
    source: segmentBody.source,
  }));
  const viaSegmentUi = await fetchSegmentSupplement(
    { ticker: "MSFT", segments: [] },
    (method, url, data) => fetch(`${hubServer.base}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  );
  assert.equal(viaSegmentUi.reportedSharePct, null);
  assert.match(viaSegmentUi.reportedShareReason ?? "", /keine gemeldeten Segmente/);
  assert.deepEqual(viaSegmentUi.subItems, []);

  const badSegment = await fetch(`${hubServer.base}/api/segment-supplement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: "MSFT", segments: [{ name: "Alpha", percentage: "100" }] }),
  });
  assert.equal(badSegment.status, 400);

  const unknown = await fetch(`${hubServer.base}/api/this-route-does-not-exist-465`);
  assert.equal(unknown.status, 404);
  const unknownBody = await unknown.json() as { error?: string };
  assert.equal(unknownBody.error, "not_found");
  console.log("hub GET unknown", unknown.status, JSON.stringify(unknownBody));

  const oldSegmentGrowth = await fetch(`${hubServer.base}/api/segment-growth/!!!`);
  assert.equal(oldSegmentGrowth.status, 400);
  assert.notEqual(oldSegmentGrowth.status, 404);
  const oldBody = await oldSegmentGrowth.json() as { error?: string };
  assert.notEqual(oldBody.error, "not_found");
  console.log("hub GET /api/segment-growth/!!!", oldSegmentGrowth.status, JSON.stringify(oldBody));
} finally {
  await hubServer.close();
  hubHttp.close();
  if (savedFmpKey === undefined) delete process.env.FMP_API_KEY;
  else process.env.FMP_API_KEY = savedFmpKey;
  if (savedFmpKeyAlt === undefined) delete process.env.FMP_API_key;
  else process.env.FMP_API_key = savedFmpKeyAlt;
}
console.log("segment statements rest: OK");
