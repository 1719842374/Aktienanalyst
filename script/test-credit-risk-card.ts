/**
 * Kreditrisiko-Karte in Sektion 10 „Risikoinversion“ (Future_SOLL_IST_DETAIL_35ead515 F1-21 mit F1-20).
 * Datenfluss: echtes Section8 (react-dom + script/lib/fake-dom) → CreditRiskCard → useMarketCreditSpread /
 * useCompanyCreditMetrics (Standard-Fetcher queryClient) → echte Express-Routen /api/credit-spread/market
 * (server/credit-route.ts → server/fred-csv.ts fetchFredCsv) und /api/credit-risk/company/:ticker
 * (server/credit-risk-route.ts → server/fmp.ts fmpIncomeStatement → fmpFetch). Gemockt ist nur globales fetch
 * für FRED und FMP; FMP_API_KEY ist ein Dummy-Wert (kein echter Key, kein Netz).
 * Fixtures: script/fixtures/credit/BAA10Y-2026-10-11.csv (bestehend, #253), script/fixtures/credit-risk/
 * fmp-income-MSFT-FY2026.json (FMP-Format, Werte aus SEC EDGAR, siehe _source), analysis-MSFT.json, analysis-SPY.json.
 * Ausführen (Repo-Root): npx tsx --tsconfig script/tsconfig.jsx.json script/test-credit-risk-card.ts
 */
import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { installFakeDom, findByTestId, FakeElement, FakeText, type FakeNode } from "./lib/fake-dom";

(globalThis as any).React = React;
let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const MAIN = "35ead515c4c4380e8a194b9e3f4d6195fa0ec399";
const BAA = readFileSync("script/fixtures/credit/BAA10Y-2026-10-11.csv", "utf8");
const INCOME = JSON.parse(readFileSync("script/fixtures/credit-risk/fmp-income-MSFT-FY2026.json", "utf8")).rows;
const MSFT = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const SPY = JSON.parse(readFileSync("script/fixtures/analysis-SPY.json", "utf8"));
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" });
const { doc } = installFakeDom();
const keepAlive = setInterval(() => {}, 1000);

async function main() {
  const { companyCreditFromIncome, debtToEquityOf, emptyCompanyCredit } = await import("../shared/credit-risk");
  const { normalizeCreditPoints, creditStressSignal } = await import("../shared/credit");
  const { fredCsvObservations } = await import("../server/fred-csv");

  // ── 1. Reine Logik ──
  const cov = companyCreditFromIncome("MSFT", INCOME);
  assert.equal(cov.operatingIncome, 155237000000); assert.equal(cov.interestExpense, 3051000000);
  assert.ok(Math.abs(cov.interestCoverage! - 155237 / 3051) < 1e-9); assert.equal(cov.fiscalYear, "2026"); assert.equal(cov.fiscalDate, "2026-06-30"); assert.equal(cov.note, null);
  assert.equal(companyCreditFromIncome("X", [{ operatingIncome: 10, interestExpense: -4 }]).interestCoverage, 2.5, "Vorzeichen Zinsaufwand → Betrag");
  assert.equal(companyCreditFromIncome("X", [{ operatingIncome: -10, interestExpense: 4 }]).interestCoverage, -2.5, "negatives EBIT bleibt negativ");
  for (const [rows, note] of [[[{ operatingIncome: 10, interestExpense: 0 }], "kein Zinsaufwand ausgewiesen"], [[{ operatingIncome: 10 }], "Zinsaufwand fehlt in der FMP-GuV"],
    [[{ interestExpense: 3 }], "Operating Income fehlt in der FMP-GuV"], [[], "FMP ohne Gewinn- und Verlustrechnung"], [null, "FMP ohne Gewinn- und Verlustrechnung"], [{ error: "x" }, "FMP ohne Gewinn- und Verlustrechnung"]] as const) {
    const r = companyCreditFromIncome("X", rows);
    assert.equal(r.interestCoverage, null); assert.equal(r.note, note);
  }
  assert.deepEqual(debtToEquityOf(MSFT.financialStatements.balanceSheet), { value: MSFT.financialStatements.balanceSheet.debtToEquity, note: null });
  assert.deepEqual(debtToEquityOf(SPY.financialStatements.balanceSheet), { value: null, note: "Eigenkapital ≤ 0 oder fehlt" }, "SPY: Payload-D/E 0 bei EK 0 ist kein Messwert");
  assert.equal(debtToEquityOf(undefined).value, null);
  assert.equal(debtToEquityOf({ totalEquity: 10, debtToEquity: undefined }).value, null);
  ok(`Zinsdeckung MSFT GJ 2026 = 155.237 / 3.051 Mio. = ${cov.interestCoverage!.toFixed(2)}x; 0/fehlend/leer → n/a mit Grund; D/E MSFT ${MSFT.financialStatements.balanceSheet.debtToEquity.toFixed(4)}, SPY (EK 0) → n/a statt 0`);

  // ── 2. Echte Routen, nur fetch für FRED/FMP gemockt ──
  process.env.FMP_API_KEY = "dummy-test-key";
  const express = (await import("express")).default;
  const { registerCreditRoute, resetCreditSpreadCache } = await import("../server/credit-route");
  const { registerCreditRiskRoute, resetCompanyCreditCache } = await import("../server/credit-risk-route");
  const app = express();
  registerCreditRoute(app);
  registerCreditRiskRoute(app);
  app.post("/api/refresh-risks", (_q, r) => r.json({}));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;
  let mode: "ok" | "fail" | "html" = "ok";
  const upstream: string[] = [], client: string[] = [];
  (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://fred.stlouisfed.org/")) { upstream.push(url); return mode === "ok" ? new Response(BAA, { status: 200 }) : new Response("err", { status: 503 }); }
    if (url.startsWith("https://financialmodelingprep.com/")) {
      upstream.push(url.replace(/apikey=[^&]+/, "apikey=***"));
      return mode === "ok" ? new Response(JSON.stringify(INCOME), { status: 200, headers: { "content-type": "application/json" } }) : new Response("err", { status: 500 });
    }
    if (url.startsWith("/api/")) {
      client.push(url);
      if (mode === "html" && url.startsWith("/api/credit")) return new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } });
      return realFetch(base + url, init);
    }
    throw new Error(`unerwarteter Abruf ${url}`);
  };

  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { Section8 } = await import("../client/src/components/sections/Section8");
  const act = (React as any).act as (cb: () => Promise<void> | void) => Promise<void>;
  const textOf = (nd: FakeNode | null): string => !nd ? "" : nd instanceof FakeText ? nd.nodeValue : nd.childNodes.map(textOf).join("");
  const origErr = console.error, origWarn = console.warn, origLog = console.log;
  const quiet = () => { console.error = () => {}; console.warn = () => {}; console.log = () => {}; };
  const loud = () => { console.error = origErr; console.warn = origWarn; console.log = origLog; };

  async function mount(data: any, until: string[]) {
    const c = doc.createElement("div"); doc.body.appendChild(c);
    const root = createRoot(c as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    quiet();
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Section8, { data }))); });
    for (let i = 0; i < 200 && !until.every(id => findByTestId(c, id)); i++) await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    loud();
    return { c, root };
  }
  const t = (c: FakeNode, id: string) => textOf(findByTestId(c, id));

  const pts = normalizeCreditPoints(fredCsvObservations(BAA));
  const stress = creditStressSignal(pts)!;
  const lastPt = pts[pts.length - 1];
  {
    const { c, root } = await mount(MSFT, ["credit-market-value", "credit-coverage-value"]);
    assert.ok(findByTestId(c, "credit-risk-card"), "Karte in Sektion 10 gerendert");
    assert.equal(t(c, "credit-market-value"), `${lastPt.value.toFixed(2)}%`);
    assert.ok(textOf(findByTestId(c, "credit-market")).includes(`Stand ${lastPt.date}`));
    const bp = `${stress.change3MPp >= 0 ? "+" : ""}${Math.round(stress.change3MPp * 100)} bp`;
    assert.equal(t(c, "credit-market-3m"), `3M: ${bp} · Rang P${Math.round(stress.percentileRank)} der 3M-Änderungen (20J)`);
    assert.equal(!!findByTestId(c, "credit-stress-hint"), stress.rising);
    assert.equal(t(c, "credit-de-value"), MSFT.financialStatements.balanceSheet.debtToEquity.toFixed(2));
    assert.equal(t(c, "credit-coverage-value"), `${(155237 / 3051).toFixed(1)}x`);
    assert.ok(textOf(findByTestId(c, "credit-coverage")).includes("GJ 2026 (Stichtag 2026-06-30)"));
    assert.ok(t(c, "credit-issuer-na").startsWith("CDS 5J, längste Anleihe-Rendite, Rating: n/a"));
    assert.ok(textOf(c).includes("Markt-Spread Baa (alle US-Unternehmen) – keine Anleihe von MSFT"));
    assert.deepEqual([...new Set(client.filter(u => u.startsWith("/api/credit")))].sort(), ["/api/credit-risk/company/MSFT", "/api/credit-spread/market"]);
    assert.ok(upstream.includes("https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAA10Y"), upstream.join(" | "));
    assert.ok(upstream.some(u => u.startsWith("https://financialmodelingprep.com/stable/income-statement?") && u.includes("symbol=MSFT") && u.includes("limit=1")), upstream.join(" | "));
    console.log(`     OK-Zustand MSFT: Markt-Spread ${lastPt.value.toFixed(2)}% (Stand ${lastPt.date}), 3M ${bp}, Rang P${Math.round(stress.percentileRank)}, Hinweis ${stress.rising ? "an" : "aus"}; D/E ${t(c, "credit-de-value")}; Zinsdeckung ${t(c, "credit-coverage-value")}`);
    quiet(); await act(async () => { root.unmount(); }); loud();
  }
  ok("Datenpfad Section8 → CreditRiskCard → Hooks → /api/credit-spread/market (fetchFredCsv BAA10Y) + /api/credit-risk/company/MSFT (fmpFetch income-statement limit=1): Werte exakt aus den Fixtures");

  // n/a: FRED 503, FMP 500, SPY ohne Eigenkapital
  resetCreditSpreadCache(); resetCompanyCreditCache(); mode = "fail";
  {
    const { c, root } = await mount({ ...SPY, ticker: "SPY" }, ["credit-market-na", "credit-coverage-na"]);
    assert.equal(t(c, "credit-market-na"), "n/a — FRED nicht erreichbar oder leer");
    assert.equal(t(c, "credit-coverage-na"), "n/a — FMP-Fehler HTTP 500");
    assert.equal(t(c, "credit-de-na"), "n/a — Eigenkapital ≤ 0 oder fehlt");
    for (const id of ["credit-market-value", "credit-coverage-value", "credit-de-value", "credit-stress-hint"]) assert.ok(!findByTestId(c, id), id);
    quiet(); await act(async () => { root.unmount(); }); loud();
  }
  ok("FRED 503 + FMP 500 + SPY (EK 0) → drei Mal n/a mit Grund, kein Wert, kein Stress-Hinweis");

  // n/a: Route fehlt (SPA-HTML → getQueryFn null), FMP ohne Key
  mode = "html";
  {
    const { c, root } = await mount(MSFT, ["credit-market-na", "credit-coverage-na"]);
    assert.equal(t(c, "credit-market-na"), "n/a — FRED BAA10Y nicht erreichbar");
    assert.equal(t(c, "credit-coverage-na"), "n/a — FMP nicht erreichbar");
    assert.equal(t(c, "credit-de-value"), MSFT.financialStatements.balanceSheet.debtToEquity.toFixed(2), "D/E kommt aus dem Payload, unabhängig von den Routen");
    quiet(); await act(async () => { root.unmount(); }); loud();
  }
  mode = "ok"; resetCompanyCreditCache();
  delete process.env.FMP_API_KEY;
  const noKey = await (await realFetch(`${base}/api/credit-risk/company/MSFT`)).json();
  assert.deepEqual(noKey, emptyCompanyCredit("MSFT", "FMP nicht konfiguriert"));
  assert.equal((await realFetch(`${base}/api/credit-risk/company/${encodeURIComponent("bad ticker!")}`)).status, 400);
  ok("Route fehlt (HTML) → n/a; ohne FMP_API_KEY → n/a „FMP nicht konfiguriert“; ungültiger Ticker → 400");

  // ── 3. Kein Score-/Bewertungspfad berührt ──
  const changed = [...git("diff", "--name-only", MAIN).trim().split("\n"), ...git("ls-files", "--others", "--exclude-standard").trim().split("\n")].filter(Boolean).sort();
  for (const f of ["server/analyze-route.ts", "server/researcher.ts", "shared/schema.ts", "shared/bias-fixes.ts", "server/scoring-integration.ts", "server/pdf-export.ts", "client/src/lib/calculations.ts", "client/src/components/sections/SummarySection.tsx"]) assert.ok(!changed.includes(f), f);
  const s8diff = git("diff", MAIN, "--", "client/src/components/sections/Section8.tsx").split("\n").filter(l => /^[+-][^+-]/.test(l));
  assert.ok(s8diff.every(l => l.startsWith("+")), "Section8: nichts entfernt");
  assert.deepEqual(s8diff.map(l => l.slice(1).trim()), [
    'import { CreditRiskCard } from "./CreditRiskCard";',
    "{/* Kreditrisiko-Karte (F1-21/F1-20): FRED BAA10Y + FMP-Verschuldung/Zinsdeckung. Nur Anzeige — fließt nicht in",
    "Total Expected Damage, Risk-Adjusted Target oder Inverted DCF oben/unten. */}",
    "<CreditRiskCard data={data} />",
  ], s8diff.join("\n"));
  const card = readFileSync("client/src/components/sections/CreditRiskCard.tsx", "utf8");
  assert.ok(!/setRisks|expectedDamage|totalExpectedDamage|invertedDcf|calculateDCF/.test(card), "Karte liest/schreibt keine Risiko-/DCF-Größen");
  for (const f of ["shared/bias-fixes.ts", "server/scoring-integration.ts", "server/pdf-export.ts", "server/analyze-route.ts"]) assert.ok(!/credit-risk|interestCoverage|CreditRiskCard/.test(readFileSync(f, "utf8")), f);

  const { buildBiasDecision } = await import("../shared/bias-fixes");
  const { generateAnalysisHTML } = await import("../server/pdf-export");
  const market = await (await realFetch(`${base}/api/credit-spread/market`)).json();
  const verdict = (h: string) => /FAZIT: ([A-ZÄÖÜ ]+)</.exec(h)?.[1] ?? "n/a";
  for (const [name, d] of [["MSFT", MSFT], ["SPY", SPY]] as const) {
    const extra = { creditSpread: market, companyCredit: companyCreditFromIncome(name, name === "MSFT" ? INCOME : []) };
    const before = buildBiasDecision(d), after = buildBiasDecision({ ...d, ...extra } as any);
    assert.deepEqual(after, before);
    quiet();
    const h0 = await generateAnalysisHTML(d), h1 = await generateAnalysisHTML({ ...d, ...extra });
    loud();
    assert.equal(verdict(h1), verdict(h0));
    console.log(`     ${name}: ohne Credit-Daten ${before.overallScore.toFixed(4)} ${before.overallRating} · mit ${after.overallScore.toFixed(4)} ${after.overallRating} (deepEqual) · PDF-Fazit ${verdict(h0)} = ${verdict(h1)}`);
  }
  assert.equal(buildBiasDecision(MSFT).overallScore.toFixed(4), "5.6381"); assert.equal(buildBiasDecision(MSFT).overallRating, "NEUTRAL");
  ok("analyze-route/researcher/schema/Score-Dateien unverändert; Section8 nur +Import +Karte; Score/Rating deepEqual mit und ohne Credit-Daten (MSFT 5.6381 NEUTRAL, SPY), PDF-Fazit gleich");

  server.close(); clearInterval(keepAlive);
  console.log(`\n${n} Checks grün`);
  process.exit(0);
}
main().catch(e => { process.stderr.write(`${e?.stack ?? e}\n`); process.exit(1); });
