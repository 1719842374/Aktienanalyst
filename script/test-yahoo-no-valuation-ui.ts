/**
 * C1 / PR #252 Client-Seite: n/a-Karte + Hinweis bei dataSource 'yahoo', FMP-Analysen unverändert.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-yahoo-no-valuation-ui.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

let fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); if (!ok) fail++; };
(globalThis as any).React = React;

const { isYahooOnly, YAHOO_NO_VALUATION_NOTICE } = await import("../shared/data-source");
const { YahooNoValuationCard } = await import("../client/src/components/YahooNoValuationCard");
const { Section1 } = await import("../client/src/components/sections/Section1");

check("isYahooOnly: 'yahoo' → true, 'fmp'/fehlend/null → false",
  isYahooOnly({ dataSource: "yahoo" }) && !isYahooOnly({ dataSource: "fmp" }) && !isYahooOnly({}) && !isYahooOnly(null));
check("Hinweistext", YAHOO_NO_VALUATION_NOTICE === "Yahoo-Daten – keine Bewertung");

const card = renderToStaticMarkup(React.createElement(YahooNoValuationCard, { number: 7, title: "DCF-MODELL (FCFF)", data: { valuationNotice: YAHOO_NO_VALUATION_NOTICE } }));
check("n/a-Karte: Hinweis + n/a + Sektionsnummer", card.includes(YAHOO_NO_VALUATION_NOTICE) && card.includes('data-testid="yahoo-na-7"') && card.includes(">n/a<") && card.includes("DCF-MODELL (FCFF)"));

// Fixture aus #249 (echte SHEL.L-Antwort); Yahoo-Variante = dieselben Kursdaten mit dataSource 'yahoo'.
const fx = JSON.parse(readFileSync("script/fixtures/lse-dividends-live.json", "utf8"));
const wrap = (el: any) => {
  const qc = new QueryClient();
  qc.setQueryData(["dividends", "v2", "SHEL.L"], fx["SHEL.L"].dividends);
  return renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(QueryClientProvider, { client: qc }, el)));
};
const fmp = { ...fx._analyzeSHEL };
const yahoo = { ...fx._analyzeSHEL, dataSource: "yahoo", valuationNotice: YAHOO_NO_VALUATION_NOTICE };
const s1Fmp = wrap(React.createElement(Section1, { data: fmp, onRefresh: () => {}, onThesisScore: () => {} }));
const s1Yahoo = wrap(React.createElement(Section1, { data: yahoo, onRefresh: () => {}, onThesisScore: () => {} }));
check("Section1 FMP: kein Yahoo-Hinweis", !s1Fmp.includes("yahoo-no-valuation"));
check("Section1 Yahoo: Hinweis „Yahoo-Daten – keine Bewertung“ oben", s1Yahoo.includes('data-testid="yahoo-no-valuation"') && s1Yahoo.includes(YAHOO_NO_VALUATION_NOTICE));
check("Section1 Yahoo: Kurs weiterhin sichtbar", s1Yahoo.includes("Price"));

// Dashboard-Weiche: bewertende Sektionen 1/3/6/7/8/10/16/17/20 werden bei Yahoo durch die n/a-Karte ersetzt.
const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
for (const n of [1, 3, 6, 7, 8, 10, 16, 17, 20]) {
  check(`Dashboard: Sektion ${n} hat die Yahoo-Weiche`, new RegExp(`isYahooOnly\\(data\\) \\? <YahooNoValuationCard number=\\{${n}\\}`).test(dash));
}

// Null-Sicherheit mit echter Route-Antwort (VOW3.DE, FMP 402 → Yahoo; dcfFairValue/upsidePotential/impliedGStar = null):
// alle Sektionen, die Dashboard bei Yahoo NICHT durch die n/a-Karte ersetzt, rendern ohne Fehler (sonst ErrorBoundary).
// Quelle: YAHOO_JSON (OUT von test-yahoo-no-valuation-route.ts) oder frischer Lauf des Route-Harness.
let yahooJsonPath = process.env.YAHOO_JSON;
if (!yahooJsonPath) {
  const { execFileSync } = await import("child_process");
  yahooJsonPath = `${(await import("os")).tmpdir()}/yahoo-no-valuation-route-${process.pid}.json`;
  execFileSync(process.execPath, [...process.execArgv, "script/test-yahoo-no-valuation-route.ts"], { env: { ...process.env, OUT: yahooJsonPath, NO_ASSERT: "1" }, stdio: "ignore" });
}
const vw = JSON.parse(readFileSync(yahooJsonPath, "utf8"))["VOW3.DE"].body;
check("Route-Antwort VOW3.DE: dataSource yahoo, DCF/Upside/g* = null", vw.dataSource === "yahoo" && vw.dcfFairValue === null && vw.upsidePotential === null && vw.impliedGStar === null);
const wrapVw = (el: any) => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(QueryClientProvider, { client: new QueryClient() }, el)));
const S = (f: string) => import(`../client/src/components/sections/${f}`);
const kept: Array<[string, () => Promise<any>]> = [
  ["Section1 (2)", async () => React.createElement((await S("Section1")).Section1, { data: vw, onRefresh: () => {}, onThesisScore: () => {} })],
  ["FinancialStatements (4)", async () => React.createElement((await S("FinancialStatements")).FinancialStatements, { data: vw })],
  ["Section3 (5)", async () => React.createElement((await S("Section3")).Section3, { data: vw })],
  ["Section7 (9)", async () => React.createElement((await S("Section7")).Section7, { data: vw })],
  ["Section9 (11)", async () => React.createElement((await S("Section9")).Section9, { data: vw })],
  ["TechnicalChart (12)", async () => React.createElement((await S("TechnicalChart")).TechnicalChart, { data: vw })],
  ["MoatPorterSection (13)", async () => React.createElement((await S("MoatPorterSection")).MoatPorterSection, { data: vw })],
  ["PestelSection (14)", async () => React.createElement((await S("PestelSection")).PestelSection, { data: vw })],
  ["MacroCorrelationsSection (15)", async () => React.createElement((await S("MacroCorrelationsSection")).MacroCorrelationsSection, { data: vw })],
  ["MonteCarloSection (18)", async () => React.createElement((await S("MonteCarloSection")).MonteCarloSection, { data: vw, sharedResult: null })],
  ["ManagementScoreSection (19)", async () => React.createElement((await S("ManagementScoreSection")).ManagementScoreSection, { data: vw, onScore: () => {} })],
];
const html: Record<string, string> = {};
for (const [name, mk] of kept) {
  let err = "";
  try { html[name] = wrapVw(await mk()); } catch (e: any) { err = e?.message ?? String(e); }
  check(`VOW3.DE ${name}: rendert ohne Fehler${err ? ` (${err})` : ""}`, !err && (html[name] ?? "").length > 0);
}
const s1 = html["Section1 (2)"] ?? "";
check("VOW3.DE Section1: Hinweis + Thesis Strength Score n/a (kein Score-Lauf)", s1.includes('data-testid="yahoo-no-valuation"') && s1.includes('data-testid="thesis-strength-yahoo-na"') && !s1.includes("Thesis-Score berechnen"));
const s9 = html["Section9 (11)"] ?? "";
check("VOW3.DE Section9: DCF Growth Adj. = n/a, kein DCF-Hinweisbanner", s9.includes(`n/a (${YAHOO_NO_VALUATION_NOTICE})`) && !s9.includes("DCF Growth Adjustment aktiv") && !s9.includes("DCF Growth Adjustment ausgesetzt"));
// MonteCarlo rechnet erst im Effect (SSR zeigt den Ladebalken) → P(reach Analyst PT) per Quelltext geprüft.
check("MonteCarlo: P(reach Analyst PT) bei Yahoo n/a", /isYahooOnly\(data\) \? "n\/a" : formatPercentNoSign\(result\.analystPTProb/.test(readFileSync("client/src/components/sections/MonteCarloSection.tsx", "utf8")));
// FMP unverändert: Section9 mit SHEL.L ohne Yahoo-Text
const s9Fmp = wrap(React.createElement((await S("Section9")).Section9, { data: fmp }));
check("Section9 FMP (SHEL.L): kein Yahoo-n/a", !s9Fmp.includes(YAHOO_NO_VALUATION_NOTICE) && s9Fmp.includes("DCF Growth Adj."));

console.log(fail ? `\n${fail} Fehler` : "\nAlle Checks grün.");
process.exit(fail ? 1 : 0);
