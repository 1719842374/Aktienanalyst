/**
 * FMP-Proxy des Hype-Cycles. Keine Trends-Quelle, kein Live-Call.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-hype-cycle-proxy.ts
 *
 * helper: assessHypeCycle / Stichtag / Auswahlzustand
 * integration: companyFromRows + loadHypeCycle + POST /api/valuechain/hype mit Mocks
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  assessHypeCycle,
  alignHypeSelection,
  gapVsOwnMedian,
  HYPE_WEIGHTS,
  HYPE_HISTORY_YEARS,
  latestFiniteAsOf,
  type HypeCompanyResult,
} from "../shared/hype-cycle.ts";
import { companyFromRows, loadHypeCycle, registerHypeCycleRoute } from "../server/hype-cycle-route.ts";
import { HypeCycleResult } from "../client/src/components/valuechain/HypeCyclePanel.tsx";

const series = (last: number) => [10, 10, 10, 10, last];
const years = ["2020-12-31", "2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31"];

function signalOf(companies: readonly HypeCompanyResult[], ticker: string, id: string) {
  const row = companies.find(c => c.ticker === ticker);
  const signal = row?.signals.find(s => s.id === id);
  assert.ok(row && signal, `${ticker} ${id}`);
  return signal;
}

console.log("helper");

const missing = assessHypeCycle([{
  ticker: "NONE",
  peByYear: [null, null],
  capexIntensityByYear: [],
  epsEstimate: [null],
}]);
{
  const pe = signalOf(missing.companies, "NONE", "valuationVsHistory");
  const capex = signalOf(missing.companies, "NONE", "capexMaterial");
  const rev = signalOf(missing.companies, "NONE", "analystRevisions");
  const news = signalOf(missing.companies, "NONE", "newsVolume");
  assert.equal(pe.gap, null);
  assert.match(pe.reason ?? "", /0 von 5 Jahren/);
  assert.equal(pe.coverage.available, 0);
  assert.equal(pe.coverage.required, 5);
  assert.equal(pe.asOf, null);
  assert.match(pe.asOfReason ?? "", /kein Wert/);
  assert.equal(capex.coverage.available, 0);
  assert.match(rev.reason ?? "", /weniger als zwei/);
  assert.equal(rev.coverage.required, 2);
  assert.equal(news.gap, null);
  assert.match(news.reason ?? "", /nicht abgefragt/);
  assert.equal(news.z, null);
  assert.equal(missing.companies[0].compositeZ, null);
  assert.equal(missing.companies[0].weightUsed, 0);
  assert.equal(missing.companies[0].phase, null);
  assert.equal(missing.gartnerDataset, false);
}

const partial = assessHypeCycle([{
  ticker: "PART",
  peByYear: [8, 9, 11],
  peAsOf: ["2022-12-31", "2023-12-31", "2024-06-30"],
  capexIntensityByYear: [0.1, null],
  capexAsOf: ["2023-12-31", null],
  epsEstimate: [1.5],
  epsAsOf: ["2026-12-31"],
}]);
{
  const pe = signalOf(partial.companies, "PART", "valuationVsHistory");
  const capex = signalOf(partial.companies, "PART", "capexMaterial");
  const rev = signalOf(partial.companies, "PART", "analystRevisions");
  assert.equal(pe.gap, null);
  assert.match(pe.reason ?? "", /3 von 5/);
  assert.equal(pe.coverage.available, 3);
  assert.equal(pe.asOf, "2024-06-30");
  assert.equal(capex.coverage.available, 1);
  assert.equal(capex.asOf, "2023-12-31");
  assert.equal(rev.coverage.available, 1);
  assert.equal(rev.asOf, "2026-12-31");
  assert.equal(partial.companies[0].compositeZ, null);
}

const flatCapex = [0.2, 0.2, 0.2, 0.2, 0.2];
const hype = assessHypeCycle([
  { ticker: "A", peByYear: series(10), capexIntensityByYear: flatCapex, epsEstimate: [1, 1], peAsOf: years, capexAsOf: years, epsAsOf: ["2025-12-31", "2026-12-31"] },
  { ticker: "B", peByYear: series(20), capexIntensityByYear: [0.2, 0.2, 0.2, 0.2, 0.4], epsEstimate: [1, 1.2], peAsOf: years, capexAsOf: years, epsAsOf: ["2025-12-31", "2026-12-31"] },
]);
{
  assert.equal(HYPE_HISTORY_YEARS, 5);
  assert.ok(Math.abs(HYPE_WEIGHTS.valuationVsHistory + HYPE_WEIGHTS.capexMaterial + HYPE_WEIGHTS.analystRevisions - 0.55) < 1e-9);
  const a = hype.companies.find(c => c.ticker === "A");
  const b = hype.companies.find(c => c.ticker === "B");
  assert.ok(a && b);
  assert.equal(signalOf(hype.companies, "A", "capexMaterial").gap, 0);
  assert.equal(signalOf(hype.companies, "B", "capexMaterial").gap, 1);
  assert.equal(signalOf(hype.companies, "A", "valuationVsHistory").asOf, "2024-12-31");
  assert.equal(signalOf(hype.companies, "A", "valuationVsHistory").coverage.available, 5);
  assert.equal(signalOf(hype.companies, "A", "analystRevisions").asOf, "2026-12-31");
  assert.equal(signalOf(hype.companies, "A", "newsVolume").gap, null);
  assert.ok(a.weightUsed > 0 && a.weightUsed < 1);
  assert.ok(Math.abs(a.weightUsed - 0.55) < 1e-9);
  assert.ok(Math.abs(b.weightUsed - 0.55) < 1e-9);
  assert.equal(b.phase, "Peak of Inflated Expectations");
  assert.equal(a.phase, "Plateau of Productivity");
  assert.equal(hype.gartnerDataset, false);
  assert.equal(hype.proxy, "fmp-history");
  assert.ok(hype.notes.some(n => n.includes("Kein Gartner-Datensatz")));
  assert.ok(hype.notes.some(n => n.includes("nicht aktiv")));
  const s = Math.sqrt(0.5);
  assert.ok(a.compositeZ != null && Math.abs(a.compositeZ - -s) < 1e-9);
  assert.ok(b.compositeZ != null && Math.abs(b.compositeZ - s) < 1e-9);
  assert.equal("overallScore" in a, false);
}

const renorm = assessHypeCycle([
  { ticker: "A", peByYear: series(10), capexIntensityByYear: [null, null, null, null, null], epsEstimate: [1, 1] },
  { ticker: "B", peByYear: series(20), capexIntensityByYear: [null, null, null, null, null], epsEstimate: [1, 1.2] },
]);
{
  assert.ok(Math.abs(renorm.companies[0].weightUsed - 0.35) < 1e-9);
  assert.equal(signalOf(renorm.companies, "A", "capexMaterial").z, null);
  assert.notEqual(renorm.companies[0].compositeZ, 0);
  assert.ok(renorm.companies[0].compositeZ != null);
}

assert.match(gapVsOwnMedian([0, 0, 0, 0, 0]).reason ?? "", /Median ist 0/);
assert.deepEqual(latestFiniteAsOf([1, 2], [null, "  "]), { asOf: null, asOfReason: "n/a — letzter Wert ohne Datum" });

const kept = alignHypeSelection({ selection: "semiconductors|NVDA", body: { companies: ["NVDA"] }, error: null }, "semiconductors|NVDA");
assert.deepEqual(kept.body, { companies: ["NVDA"] });
const cleared = alignHypeSelection(kept, "software|SAP");
assert.equal(cleared.body, null);
assert.equal(cleared.error, null);
assert.equal(cleared.selection, "software|SAP");

const markup = renderToStaticMarkup(createElement(HypeCycleResult, { data: { ...hype, skipped: [] } }));
assert.match(markup, /Kein Gartner-Datensatz/);
assert.match(markup, /nicht Gartner/);
assert.match(markup, /kein Aktien-Score/);
assert.match(markup, /2024-12-31/);
assert.match(markup, /5\/5/);
assert.match(markup, /FMP ratios priceToEarningsRatio/);
assert.match(markup, /nicht abgefragt/);
assert.doesNotMatch(markup, /overallScore|ATTRAKTIV/);
const partialMarkup = renderToStaticMarkup(createElement(HypeCycleResult, { data: { ...partial, skipped: [] } }));
assert.match(partialMarkup, /3 von 5/);
assert.match(partialMarkup, /3\/5/);
assert.match(partialMarkup, /2024-06-30/);
const missingMarkup = renderToStaticMarkup(createElement(HypeCycleResult, { data: { ...missing, skipped: [] } }));
assert.match(missingMarkup, /0 von 5/);
assert.match(missingMarkup, /0\/5/);

console.log("helper: OK");

console.log("integration");

function annual(from: number, count: number, fill: (i: number, year: number) => Record<string, unknown>) {
  return Array.from({ length: count }, (_, i) => {
    const year = from + i;
    return { calendarYear: String(year), date: `${year}-12-31`, ...fill(i, year) };
  });
}

const fullRatios = annual(2020, 5, () => ({ priceToEarningsRatio: 10 }));
const fullIncome = annual(2020, 5, () => ({ revenue: 100 }));
const fullCash = annual(2020, 5, () => ({ capitalExpenditure: -20 }));
const fullEps = [
  { date: "2025-12-31", estimatedEpsAvg: 1 },
  { date: "2026-12-31", epsAvg: 1.2 },
];
const mapped = companyFromRows("nvda", fullRatios, fullIncome, fullCash, fullEps);
assert.equal(mapped.ticker, "nvda");
assert.deepEqual(mapped.peByYear, [10, 10, 10, 10, 10]);
assert.deepEqual(mapped.capexIntensityByYear, [0.2, 0.2, 0.2, 0.2, 0.2]);
assert.deepEqual(mapped.epsEstimate, [1, 1.2]);
assert.equal(mapped.peAsOf?.[4], "2024-12-31");
assert.equal(mapped.epsAsOf?.[1], "2026-12-31");

const alias = companyFromRows(
  "SAP",
  [{ date: "2024-12-31", peRatio: 12 }],
  [{ date: "2024-12-31", revenue: 50 }, { revenue: 10 }],
  [{ date: "2024-12-31", capitalExpenditures: -10 }],
  [{ estimatedEpsAvg: 1 }],
);
assert.deepEqual(alias.peByYear, [12]);
assert.deepEqual(alias.capexIntensityByYear, [0.2]);
assert.match(alias.dataNotes?.join(" ") ?? "", /1 income-statement/);
assert.match(alias.dataNotes?.join(" ") ?? "", /1 analyst-estimates/);

const zeroRevenue = companyFromRows(
  "Z",
  [],
  [{ date: "2024-12-31", revenue: 0 }],
  [{ date: "2024-12-31", capitalExpenditure: -5 }],
  [],
);
assert.deepEqual(zeroRevenue.capexIntensityByYear, [null]);

type Family = "ratios" | "income" | "cashflow" | "estimates";
function mockDeps(books: Record<string, Record<Family, unknown>>, fail: string[] = []) {
  const calls: Record<Family, string[]> = { ratios: [], income: [], cashflow: [], estimates: [] };
  const fetcher = (family: Family) => async (ticker: string) => {
    calls[family].push(ticker);
    if (fail.includes(ticker)) throw new Error("boom");
    return books[ticker]?.[family] ?? [];
  };
  return {
    calls,
    deps: {
      ratios: fetcher("ratios"),
      income: fetcher("income"),
      cashflow: fetcher("cashflow"),
      estimates: fetcher("estimates"),
      budgetBlocked: false,
    },
  };
}

const books = {
  AAA: { ratios: fullRatios, income: fullIncome, cashflow: fullCash, estimates: fullEps },
  BBB: {
    ratios: annual(2020, 5, i => ({ priceToEarningsRatio: 10 + i })),
    income: annual(2020, 3, () => ({ revenue: 80 })),
    cashflow: annual(2020, 3, () => ({ capitalExpenditure: -8 })),
    estimates: [{ date: "2026-12-31", estimatedEpsAvg: 2 }],
  },
};

{
  const first = mockDeps(books);
  const a = await loadHypeCycle([" aaa ", "bad ticker", "AAA"], first.deps);
  assert.deepEqual(a.companies.map(c => c.ticker), ["AAA"]);
  assert.equal(a.skipped.length, 0);
  assert.equal(first.calls.ratios.length, 1);
  assert.equal(signalOf(a.companies, "AAA", "valuationVsHistory").coverage.available, 5);
  assert.equal(signalOf(a.companies, "AAA", "valuationVsHistory").asOf, "2024-12-31");
  assert.equal(a.gartnerDataset, false);

  const second = mockDeps(books);
  const b = await loadHypeCycle(["BBB"], second.deps);
  assert.deepEqual(b.companies.map(c => c.ticker), ["BBB"]);
  assert.notEqual(b.companies[0].ticker, a.companies[0].ticker);
  assert.match(signalOf(b.companies, "BBB", "capexMaterial").reason ?? "", /3 von 5/);
  assert.equal(signalOf(b.companies, "BBB", "analystRevisions").coverage.available, 1);
  assert.equal(second.calls.ratios.join(","), "BBB");
}

{
  const blocked = mockDeps(books);
  blocked.deps.budgetBlocked = true;
  const body = await loadHypeCycle(["AAA", "BBB"], blocked.deps);
  assert.equal(body.companies.length, 0);
  assert.deepEqual(body.skipped, ["AAA", "BBB"]);
  assert.match(body.notes.join(" "), /Budget/);
  assert.match(body.notes.join(" "), /Kein Gartner-Datensatz/);
  assert.equal(blocked.calls.ratios.length + blocked.calls.income.length + blocked.calls.cashflow.length + blocked.calls.estimates.length, 0);
}

{
  const failing = mockDeps(books, ["AAA"]);
  const body = await loadHypeCycle(["AAA", "BBB"], failing.deps);
  assert.deepEqual(body.skipped, ["AAA"]);
  assert.deepEqual(body.companies.map(c => c.ticker), ["BBB"]);
  assert.match(body.notes.join(" "), /Abruf fehlgeschlagen: AAA/);
  assert.equal(failing.calls.ratios.filter(t => t === "AAA").length, 1);
}

{
  const none = mockDeps(books);
  const body = await loadHypeCycle(["***"], none.deps);
  assert.match(body.notes.join(" "), /kein gültiger Ticker/);
  assert.equal(none.calls.estimates.length, 0);
}

async function serve(deps: { ratios: (t: string, n: number) => Promise<unknown>; income: (t: string, n: number) => Promise<unknown>; cashflow: (t: string, n: number) => Promise<unknown>; estimates: (t: string, n: number) => Promise<unknown>; budgetBlocked?: boolean }) {
  const app = express();
  app.use(express.json());
  registerHypeCycleRoute(app, deps);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    post: async (body: unknown) => {
      const r = await fetch(base + "/api/valuechain/hype", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: r.status, json: await r.json() };
    },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

{
  const live = mockDeps(books);
  const http = await serve(live.deps);
  const empty = await http.post({});
  assert.equal(empty.status, 400);
  assert.match(empty.json.error, /tickers fehlt/);
  const first = await http.post({ tickers: ["AAA"] });
  const second = await http.post({ tickers: ["BBB"] });
  assert.equal(first.status, 200);
  assert.equal(first.json.companies[0].ticker, "AAA");
  assert.equal(first.json.gartnerDataset, false);
  assert.equal(second.json.companies[0].ticker, "BBB");
  assert.equal(second.json.proxy, "fmp-history");
  assert.doesNotMatch(JSON.stringify(second.json), /overallScore|email|supabase/);
  await http.close();
}

{
  const blocked = mockDeps(books);
  blocked.deps.budgetBlocked = true;
  const http = await serve(blocked.deps);
  const res = await http.post({ tickers: ["AAA"] });
  assert.equal(res.status, 200);
  assert.equal(res.json.companies.length, 0);
  assert.equal(blocked.calls.ratios.length, 0);
  await http.close();
}

const chainFiles = [
  "shared/hype-cycle.ts",
  "shared/distribution.ts",
  "server/hype-cycle-route.ts",
  "client/src/components/valuechain/HypeCyclePanel.tsx",
].map(f => readFileSync(f, "utf8")).join("\n");
assert.doesNotMatch(chainFiles, /serpapi|trends\.google|@supabase|resend|sendgrid|openrouter/i);
assert.doesNotMatch(chainFiles, /1\.5σ|1\.5\s*\*|>=?\s*1\.5/);
assert.match(readFileSync("client/src/components/valuechain/HypeCyclePanel.tsx", "utf8"), /alignHypeSelection/);
assert.match(readFileSync("client/src/components/valuechain/HypeCyclePanel.tsx", "utf8"), /FMP-Proxy/);
assert.match(readFileSync("client/src/pages/ValueChainDashboard.tsx", "utf8"), /HypeCyclePanel/);
assert.match(readFileSync("client/src/pages/ValueChainDashboard.tsx", "utf8"), /stages\.flatMap/);

const register = readFileSync("server/routes-register.ts", "utf8");
assert.ok(register.indexOf("registerHypeCycleRoute(app)") > register.indexOf("registerValueChainRoutes(app)"));
assert.match(register, /registerPodcastRoute\(app\)/);
assert.match(register, /registerAttraktivNotifyRoute\(app\)/);

for (const file of ["server/analyze-route.ts", "server/routes.ts", "shared/bias-fixes.ts", "server/thesis-strength.ts"]) {
  assert.doesNotMatch(readFileSync(file, "utf8"), /hype-cycle|assessHypeCycle|HYPE_WEIGHTS/);
}
const hypeSrc = readFileSync("shared/hype-cycle.ts", "utf8") + readFileSync("server/hype-cycle-route.ts", "utf8");
assert.doesNotMatch(hypeSrc, /computeOverallScore|analyze-route|bias-fixes|user_subscriptions/);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");

console.log("integration: OK");
console.log("hype proxy: OK");
