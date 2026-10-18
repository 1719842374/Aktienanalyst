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

// Dashboard-Weiche: bewertende Sektionen 1/3/7/8/16/17/20 werden bei Yahoo durch die n/a-Karte ersetzt.
const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
for (const n of [1, 3, 7, 8, 16, 17, 20]) {
  check(`Dashboard: Sektion ${n} hat die Yahoo-Weiche`, new RegExp(`isYahooOnly\\(data\\) \\? <YahooNoValuationCard number=\\{${n}\\}`).test(dash));
}

console.log(fail ? `\n${fail} Fehler` : "\nAlle Checks grün.");
process.exit(fail ? 1 : 0);
