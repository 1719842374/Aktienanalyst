/** JOB 23: restliche $ → Listing-Währung, .L-Kursziel 0 → n/a, Code-Währungen mit Leerzeichen, Buffett Max 375 px. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { currencySymbol, formatCurrency, formatTarget, statementCurrency } from "../client/src/lib/formatters";

let fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); if (!ok) fail++; };
(globalThis as any).React = React;

// (d) Codes ohne Symbol: geschütztes Leerzeichen (recharts trennt normale Leerzeichen und klebt sie zusammen)
check("CAD → 'CAD\\u00A0171'", formatCurrency(171, 0, "CAD") === "CAD\u00A0171" && currencySymbol("CAD") === "CAD\u00A0");
check("Symbole unverändert: £/$/€", currencySymbol("GBP") === "£" && currencySymbol("USD") === "$" && currencySymbol(undefined) === "$");
// (b) Kursziel
check("Kursziel 0/null/NaN → n/a", formatTarget(0, "GBP") === "n/a" && formatTarget(null, "GBP") === "n/a" && formatTarget(NaN, "GBP") === "n/a");
check("Kursziel > 0 → £45.00", formatTarget(45, "GBP") === "£45.00");
check("statementCurrency: USD nur nach Server-Umrechnung", statementCurrency({ currency: "GBP" }) === "GBP" && statementCurrency({ currency: "EUR", currencyInfo: { converted: true } }) === "USD");

// (a) keine Ein-Argument-Aufrufe (= festes $) mehr in den Sektionen
const files = ["Section2", "Section5", "Section6", "Section8", "MonteCarloSection", "SummarySection", "FinancialStatements"].map(f => `client/src/components/sections/${f}.tsx`).concat("client/src/lib/fazit-signal.ts");
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const bare = [...src.matchAll(/formatCurrency\(([^(),]|\([^()]*\))+\)/g)].length + [...src.matchAll(/formatLargeNumber\(([^(),]|\([^()]*\))+\)/g)].length;
  const fixedDollar = /`\$\$\{/.test(src);
  check(`${f.split("/").pop()}: kein festes $ (Ein-Argument-Formatter: ${bare}, \`$\${…}: ${fixedDollar})`, bare === 0 && !fixedDollar);
}

// gerendert mit echter SHEL.L-Antwort (Fixture aus #249)
const fx = JSON.parse(readFileSync("script/fixtures/lse-dividends-live.json", "utf8"));
const shel = { ...fx._analyzeSHEL };
const wrap = (el: any) => {
  const qc = new QueryClient();
  qc.setQueryData(["dividends", "v2", "SHEL.L"], fx["SHEL.L"].dividends);
  return renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(QueryClientProvider, { client: qc }, el)));
};
const { Section1 } = await import("../client/src/components/sections/Section1");
const s1 = wrap(React.createElement(Section1, { data: shel, onRefresh: () => {}, onThesisScore: () => {} }));
check("Section 1 SHEL.L: Median/High/Low PT n/a statt £0.00", shel.analystPT.median === 0 && !s1.includes("£0.00") && (s1.match(/n\/a/g)?.length ?? 0) >= 3);
const { FinancialStatements } = await import("../client/src/components/sections/FinancialStatements");
const s4 = wrap(React.createElement(FinancialStatements, { data: shel }));
check("Financial Statements SHEL.L in £, ohne $", /£[0-9.]+[BMT]/.test(s4) && !/\$[0-9]/.test(s4));
for (const [name, mod, comp] of [["Section6 (CRV)", "Section6", "Section6"], ["Section8 (Risikoinversion)", "Section8", "Section8"], ["Section5 (DCF)", "Section5", "Section5"]] as const) {
  try {
    const M = await import(`../client/src/components/sections/${mod}`);
    const html = wrap(React.createElement((M as any)[comp], { data: shel }));
    check(`${name} SHEL.L: £ und kein $Betrag`, html.includes("£") && !/\$[0-9]/.test(html));
  } catch (e: any) { check(`${name} rendert (${e?.message})`, false); }
}

// (c) Buffett Max 375 px
const bp = readFileSync("client/src/components/recession/BuffettRatioPanel.tsx", "utf8");
check("Buffett: Label unter Callout-Box, wenn die Box bis an den Punkt reicht", bp.includes("const calloutCoversLabel = showCallout && boxX + boxW > x - 80;") && bp.includes("y={lastLabelY}"));
// Geometrie wie im Panel: 375 px → boxW 236, boxX = x - 252; 1440 px → boxW 292, boxX = x - 420
const geo = (wide: boolean, x: number) => { const boxW = wide ? 292 : 236; const boxX = Math.max(8, x - boxW - (wide ? 128 : 16)); return boxX + boxW > x - 80; };
check("375 px (x≈300): Box überdeckt → Label darunter; 1440 px: unverändert", geo(false, 300) && !geo(true, 900));

console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
