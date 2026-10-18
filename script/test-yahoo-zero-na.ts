/**
 * #252-Rest: Yahoo-Fallback (dataSource 'yahoo') zeigt n/a statt 0 — Section 2 (Section1), Financial Statements (4),
 * Management-Score (19, Dashboard-Weiche), PDF-Export, /api/thesis-strength g* null ≠ 0.
 * Echte Route-Antworten aus dem #252-DoD-Lauf (FIXTURE_DIR, Default /workspace/dod-252: api-head-<T>.json;
 * VOW3.DE/SAP.DE/BMW.DE = FMP 402 → Yahoo live, AAPL/MSFT/SHEL.L = FMP-Prod-JSONs).
 * Run:     npx tsx --tsconfig script/tsconfig.jsx.json script/test-yahoo-zero-na.ts
 * Compare: OUT=/tmp/x ROOT=<worktree> … schreibt die FMP-Renders (Section1, FinancialStatements, PDF-HTML) nach OUT,
 *          danach `diff -r` main vs. Branch (byte-gleich erwartet).
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

let fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); if (!ok) fail++; };
(globalThis as any).React = React;
delete process.env.ANTHROPIC_API_KEY; // PDF-Narrativ deterministisch (n/a-Hinweis)

const ROOT = process.env.ROOT ? process.env.ROOT.replace(/\/$/, "") : "..";
const DIR = process.env.FIXTURE_DIR || "/workspace/dod-252";
const OUT = process.env.OUT;
const ONLY_FMP = !!process.env.ONLY_FMP;
const load = (t: string) => JSON.parse(readFileSync(`${DIR}/api-head-${t}.json`, "utf8"));
const { Section1 } = await import(`${ROOT}/client/src/components/sections/Section1`);
const { FinancialStatements } = await import(`${ROOT}/client/src/components/sections/FinancialStatements`);
const { generateAnalysisHTML } = await import(`${ROOT}/server/pdf-export`);
const wrap = (el: any) => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(QueryClientProvider, { client: new QueryClient() }, el)));
const maskDates = (s: string) => s.replace(/\d{1,2}\.\d{1,2}\.\d{4}(, \d{1,2}:\d{2}:\d{2})?/g, "<DATE>");

for (const t of ["AAPL", "MSFT", "SHEL.L"]) {
  const d = load(t);
  const s1 = wrap(React.createElement(Section1, { data: d, onRefresh: () => {}, onThesisScore: () => {} }));
  const fs = wrap(React.createElement(FinancialStatements, { data: d }));
  const pdf = maskDates(await generateAnalysisHTML(d));
  if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${t}-s1.html`, s1); writeFileSync(`${OUT}/${t}-fs.html`, fs); writeFileSync(`${OUT}/${t}-pdf.html`, pdf); }
  check(`${t} (FMP): kein Yahoo-Hinweis in Section1/FS/PDF`, d.dataSource === "fmp" && !s1.includes("yahoo-no-valuation") && !fs.includes("fs-yahoo-na") && !pdf.includes("pdf-yahoo-na"));
}
if (ONLY_FMP) process.exit(fail ? 1 : 0);

const { YAHOO_NO_VALUATION_NOTICE } = await import("../shared/data-source");
for (const t of ["VOW3.DE", "SAP.DE", "BMW.DE"]) {
  const d = load(t);
  check(`${t}: Route-Antwort dataSource yahoo, Rohwerte 0 / Beta 1 (Ausgangslage)`, d.dataSource === "yahoo" && d.forwardPE === 0 && d.evEbitda === 0 && d.pegRatio === 0 && d.epsAdjFY === 0 && d.epsConsensusNextFY === 0 && d.beta5Y === 1 && d.currency === "EUR");
  const s1 = wrap(React.createElement(Section1, { data: d, onRefresh: () => {}, onThesisScore: () => {} }));
  check(`${t} S2: kein „Fwd: 0.0“`, !s1.includes("Fwd: 0.0") && s1.includes("Fwd: n/a"));
  check(`${t} S2: kein 0.0 / 0.00 / $0.00 als Wert`, !/>0\.0<|>0\.00<|\$0\.00|€0\.00/.test(s1));
  for (const label of ["EV/EBITDA", "EPS adj. FY", "EPS Consensus Next FY", "Forward P/E"]) {
    const re = new RegExp(`${label.replace(/[./]/g, m => "\\" + m)}</(td|div)>.*?>(n/a)<`);
    check(`${t} S2: ${label} = n/a`, re.test(s1));
  }
  check(`${t} S2: PEG n/a, kein Lynch-Badge aus 0-Daten`, /PEG<\/td><td[^>]*><span>n\/a<\/span><\/td>/.test(s1));
  check(`${t} S2: Beta n/a + als Default gekennzeichnet`, /Beta \(5Y\)<\/div><div[^>]*>n\/a<\/div><div[^>]*>Default 1\.00 \(Yahoo, kein Beta\)/.test(s1));
  check(`${t} S2: EPS TTM in €`, s1.includes(`>€${d.epsTTM.toFixed(2)}<`) && !s1.includes(`$${d.epsTTM.toFixed(2)}`));
  check(`${t} S2: Kurs/P/E weiter sichtbar`, s1.includes(`€${d.currentPrice.toFixed(2)}`) && s1.includes(`>${d.peRatio.toFixed(1)}<`));
  const fs = wrap(React.createElement(FinancialStatements, { data: d }));
  check(`${t} S4: Hinweis + n/a, keine $0/0%-Werte, keine „Weak“-Gesundheit`, fs.includes(YAHOO_NO_VALUATION_NOTICE) && fs.includes("fs-yahoo-na") && !/\$0\b|>0%<|Weak/.test(fs) && (fs.match(/>n\/a</g) || []).length >= 15);
  check(`${t} S4: EPS echt in €`, fs.includes(`€${d.epsTTM.toFixed(2)}`));
  const pdf = await generateAnalysisHTML(d);
  check(`${t} PDF: Yahoo-Hinweis, kein Fazit/DCF/CRV, Kurs + EPS in EUR`, pdf.includes('data-testid="pdf-yahoo-na"') && pdf.includes(YAHOO_NO_VALUATION_NOTICE) && !pdf.includes("FAZIT:") && !pdf.includes("CRV Base") && !pdf.includes("$0") && pdf.includes(`${d.currentPrice.toFixed(2)} EUR`) && pdf.includes(`${d.epsTTM.toFixed(2)} EUR`));
}

// Management-Score (19): Dashboard-Weiche → kein /api/management-score-Lauf auf leeren Statements.
const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
check("Dashboard: Sektion 19 hat die Yahoo-Weiche", /isYahooOnly\(data\) \? <YahooNoValuationCard number=\{19\} title="MANAGEMENT-EXECUTION-SCORE"/.test(dash));

// /api/thesis-strength: g* null/undefined/"" → null (vorher Number(null) = 0), Zahl unverändert.
const routes = readFileSync("server/routes.ts", "utf8");
const line = routes.match(/const gStar = (.*);\n/)?.[1] ?? "";
check("routes.ts: gStar-Zeile mit null-Guard", line.startsWith('b.impliedGStar == null || b.impliedGStar === "" ? null : number(b.impliedGStar)'));
const number = (v: any): number | null => { const n = Number(v); return isFinite(n) ? n : null; };
const gStarOf = new Function("b", "number", `return ${line};`) as (b: any, n: typeof number) => number | null;
check("thesis-strength: g* null → null (nicht 0)", gStarOf({ impliedGStar: null }, number) === null && gStarOf({}, number) === null && gStarOf({ impliedGStar: "" }, number) === null);
check("thesis-strength: g* Zahl unverändert (8.02 / 0 / '3.5')", gStarOf({ impliedGStar: 8.021490899885794 }, number) === 8.021490899885794 && gStarOf({ impliedGStar: 0 }, number) === 0 && gStarOf({ impliedGStar: "3.5" }, number) === 3.5);

console.log(fail ? `\n${fail} FAIL` : "\nALL PASS");
process.exit(fail ? 1 : 0);
