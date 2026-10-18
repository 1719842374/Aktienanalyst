/**
 * JOB 22: LSE-UI-Follow-ups zu #244/#245 (Tester-FAIL auf Prod 582844ef, /workspace/dod-582844ef).
 * 1) £ statt $ (Header, KPIs, Chart)  2) fx-partial-warning nur bei fehlender FX
 * 3) Div.-Yield-Kachel deterministisch (kein GJ-Zwischenwert beim Laden; .L nur TTM, sonst n/a)
 * 4) Buffett Max: Label am letzten Punkt + Leerzeichen im Callout.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { currencySymbol, formatCurrency, formatLargeNumber } from "../client/src/lib/formatters";
import { dividendKpiDisplay } from "../client/src/lib/dividendKpi";
import { isMinorUnitListingTicker, listingFxWarning } from "../shared/listing-units";

let fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); if (!ok) fail++; };
(globalThis as any).React = React;

// ── 1) Währungssymbol ──
check("GBP → £, USD → $, EUR → €", currencySymbol("GBP") === "£" && currencySymbol("USD") === "$" && currencySymbol("EUR") === "€");
check("ohne Währung bleibt $ (bisheriges Verhalten)", currencySymbol(undefined) === "$" && formatCurrency(12.3) === "$12.30" && formatLargeNumber(2.5e9) === "$2.50B");
check("GBp (FX fehlt) bleibt als Code, nicht £", currencySymbol("GBp") === "GBp\u00A0");
check("unbekannte Währung als Code statt $", currencySymbol("CHF") === "CHF\u00A0");
check("SHEL.L: £37.94 / £209.92B", formatCurrency(37.935, 2, "GBP") === "£37.94" && formatLargeNumber(209.92e9, "GBP") === "£209.92B");
const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
check("Header nutzt Listing-Währung", dash.includes("{formatCurrency(data.currentPrice, 2, data.currency)}") && !dash.includes("${data.currentPrice.toFixed(2)}"));
const ta = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
check("Chart: Y-Achse + Tooltip + MA-Pills mit ccy", ta.includes("tickFormatter={(v: number) => `${ccy}${v.toFixed(0)}`}") && ta.includes("{ccy}{dp.close.toFixed(2)}") && ta.includes("`MA200: ${ccy}"));
check("Chart: kein festes $ mehr vor Kurswerten", !/`\$\$\{|>\$\{(dp|s\.|measure|Number)/.test(ta));

// ── Section 1 gerendert (KPIs + fx-partial-warning) ──
const { Section1 } = await import("../client/src/components/sections/Section1");
const fx = JSON.parse(readFileSync("script/fixtures/lse-dividends-live.json", "utf8"));
function s1Data(ticker: string, currency: string, extra: any = {}): any {
  // echte SHEL.L-/api/analyze-Antwort (Prod 582844ef, große Arrays gekürzt), Ticker/Währung je Fall überschrieben
  return { ...fx._analyzeSHEL, ticker, currency, ...extra };
}
function render(data: any, history?: any): string {
  const qc = new QueryClient();
  if (history !== undefined) qc.setQueryData(["dividends", "v2", data.ticker], history);
  try {
    return renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(QueryClientProvider, { client: qc }, React.createElement(Section1, { data, onRefresh: () => {}, onThesisScore: () => {} }))));
  } catch (e: any) { console.log("render error:", e?.message); return ""; }
}
const gbp = render(s1Data("SHEL.L", "GBP"), fx["SHEL.L"].dividends);
check("Section 1 SHEL.L rendert", gbp.length > 0);
check("KPI Price £37.94, Market Cap £209.92B, kein $37.94", gbp.includes("£37.94") && gbp.includes("£209.92B") && !gbp.includes("$37.94"));
check("EPS in £", gbp.includes("£2.31") && gbp.includes("£4.58"));
// ── 2) fx-partial-warning ──
check("FX vorhanden (GBP): KEIN fx-partial-warning", !gbp.includes('data-testid="fx-partial-warning"') && listingFxWarning("GBP") === null);
const gbx = render(s1Data("SHEL.L", "GBp"), fx["SHEL.L"].dividends);
check("FX fehlt (GBp): fx-partial-warning sichtbar", gbx.includes('data-testid="fx-partial-warning"') && gbx.includes("FX GBPUSD fehlt"));
const usd = render(s1Data("MSFT", "USD", { dividendYield: 0.68 }), { currency: "USD", source: "fmp", events: [] });
check("USD-Ticker: $ und kein fx-partial-warning", usd.includes("$37.94") && !usd.includes('data-testid="fx-partial-warning"'));

// ── 3) Div. Yield deterministisch ──
console.log("\n| Ticker | API GJ (FMP) | Kachel vorher (je nach Timing) | Kachel nachher |\n|---|---|---|---|");
const expectTtm: Record<string, string> = { "SHEL.L": "2.97%", "AZN.L": "1.99%", "ULVR.L": "3.53%" };
for (const t of Object.keys(expectTtm)) {
  const f = fx[t];
  const data = { ticker: t, currency: f.currency, dividendYield: f.dividendYieldFY, ohlcvData: f.bars };
  const runs = new Set([0, 1, 2].map(() => dividendKpiDisplay(data, f.dividends)?.value));
  const d = dividendKpiDisplay(data, f.dividends);
  check(`${t}: TTM ${expectTtm[t]} (GBP-Dividende / GBP-Kurs), mehrfach gleich`, d?.value === expectTtm[t] && runs.size === 1);
  check(`${t}: kein GJ-Zusatz (FMP-GJ nicht in Listing-Währung)`, d?.sub === "TTM");
  check(`${t}: beim Laden Platzhalter statt GJ ${f.dividendYieldFY}%`, dividendKpiDisplay(data, undefined, { pending: true })?.value === "…");
  check(`${t}: Historie leer/Fehler → n/a statt GJ`, dividendKpiDisplay(data, null)?.value === "n/a");
  console.log(`| ${t} | ${f.dividendYieldFY}% | ${f.dividendYieldFY.toFixed(2)}% (vor Laden) oder ${expectTtm[t]} | ${d?.value} |`);
}
const ko = { ticker: "KO", currency: "USD", dividendYield: 2.92, ohlcvData: [{ date: "2026-10-09", close: 70 }] };
check("Nicht-.L ohne TTM: GJ (FMP) bleibt wie bisher", dividendKpiDisplay(ko, null)?.sub === "GJ (FMP)");
check("Nicht-.L beim Laden: ebenfalls Platzhalter", dividendKpiDisplay(ko, undefined, { pending: true })?.value === "…");
check("isMinorUnitListingTicker", isMinorUnitListingTicker("SHEL.L") && isMinorUnitListingTicker("NPN.JO") && !isMinorUnitListingTicker("MSFT") && !isMinorUnitListingTicker("SAP.DE"));
check("gerenderte Kachel SHEL.L = 2.97%", gbp.includes("2.97%") && !gbp.includes("3.98%"));
const hook = readFileSync("client/src/lib/useDividendHistory.ts", "utf8");
check("nur ein Query-Key [\"dividends\",\"v2\",ticker] im Client", /queryKey: \["dividends", "v2", ticker\]/.test(hook));

// ── 4) Buffett Max ──
const bp = readFileSync("client/src/components/recession/BuffettRatioPanel.tsx", "utf8");
check("Max: Label am letzten Punkt (nicht mehr an !showCallout gebunden)", bp.includes("{lastPointLabel(last) && (") && !bp.includes("{!showCallout && lastPointLabel(last)"));
check("Callout: Leerzeichen nach Datum und nach 'BIP,'", bp.includes('{last.proxy ? ` (via ${last.proxy})` : ""}{" "}</text>') && bp.includes("Marktwert zum BIP, `"));

console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
