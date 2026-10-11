/** JOB 20: Div. Yield in Section 4 (Financial Statements) = dieselbe Quelle/Funktion wie die Section-1-Kachel (#237). */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { dividendKpiDisplay } from "../client/src/lib/dividendKpi";
import { dividendKpiFromHistory } from "../shared/dividends";

let fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); if (!ok) fail++; };
(globalThis as any).React = React; // Komponenten nutzen das automatische JSX-Runtime im Vite-Build
const { FinancialStatements } = await import("../client/src/components/sections/FinancialStatements");
const fx = JSON.parse(readFileSync("script/fixtures/dividend-kpi-live.json", "utf8"));

const fs = {
  incomeStatement: { revenue: 1e10, revenueGrowth: 5, grossProfit: 6e9, grossMargin: 60, operatingIncome: 3e9, operatingMargin: 30, netIncome: 2e9, netMargin: 20, ebitda: 3.5e9, ebitdaMargin: 35, eps: 2, epsGrowth: 5 },
  balanceSheet: { totalAssets: 5e10, totalEquity: 2e10, totalDebt: 1e10, cashEquivalents: 5e9, netDebt: 5e9, debtToEquity: 0.5 },
  cashFlow: { operatingCashFlow: 3e9, capex: -5e8, fcf: 2.5e9, fcfMargin: 25, fcfPerShare: 1.2 },
  health: "Good", healthReasons: [],
};

const out: string[] = [];
for (const t of ["KO", "NVO", "AMZN"]) {
  const f = fx[t];
  const data: any = { ticker: t, currency: f.currency, dividendYield: f.dividendYieldFY, ohlcvData: f.bars, historicalPrices: f.bars, financialStatements: fs, marketCap: 1e11, fcfAvailable: true };
  const disp = dividendKpiDisplay(data, f.dividends);
  const tile = dividendKpiFromHistory(f.dividends, f.bars.at(-1), f.currency);
  if (tile.kind === "ttm") check(`${t}: Section-4-Wert = Kachel-TTM ${tile.yieldPct.toFixed(2)}%`, disp?.value === `${tile.yieldPct.toFixed(2)}%`);
  else check(`${t}: ohne TTM → GJ (FMP) oder null`, disp == null ? !(f.dividendYieldFY > 0) : disp.sub === "GJ (FMP)");
  const qc = new QueryClient();
  qc.setQueryData(["dividends", "v2", t], f.dividends); // #244: query key v2 (pence fix)
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, React.createElement(FinancialStatements, { data })));
  const m = html.match(/data-testid="fs-div-yield">Div\. Yield: <span class="font-mono">([^<]+)</);
  out.push(`| ${t} | ${disp?.value ?? "n/a"} | ${m?.[1]} |`);
  check(`${t}: gerenderte Section 4 zeigt denselben Wert`, m?.[1] === (disp ? disp.value : "n/a"));
}
const s1 = readFileSync("client/src/components/sections/Section1.tsx", "utf8");
const s4 = readFileSync("client/src/components/sections/FinancialStatements.tsx", "utf8");
check("Section 1 und Section 4 nutzen denselben Hook", s1.includes("useDividendKpi(data)") && s4.includes("useDividendKpi(data)"));
check("eine Query mit Key [\"dividends\",\"v2\",ticker]", /queryKey: \["dividends", "v2", ticker\]/.test(readFileSync("client/src/lib/useDividendHistory.ts", "utf8")));
check("kein eigener Rechenweg in Section 4", !/dividendYield\s*[*/]|dividendKpiFromHistory/.test(s4));
console.log("| Ticker | Kachel Section 1 | Section 4 |\n|---|---|---|\n" + out.join("\n"));
console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
