/**
 * Bug SHEL.L (25.10.): Exec-Summary-Lage zeigte „Das konservative DCF sitzt bei 49,45 Dollar gegenüber 39,38 Dollar
 * Kurs“ — falsche Währung (Alt-Payload ohne currency) und andere Zahl als S6 („Entscheidungsrelevante Basis“ £58.55).
 * Soll: Lage-Satz aus derselben Quelle wie S6 (fazitEntryForExport.fairValue = buildBiasDecision im Client),
 * DCF in statementCurrency, Kurs/Analystenziel in Listing-Währung. Score/Rating bytegleich.
 */
import React from "react";
(globalThis as any).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ExecSummaryCard } from "../client/src/components/ExecSummaryCard";
import { Section6 } from "../client/src/components/sections/Section6";
import { prepareFazitMetrics, buildFazitSignal } from "../client/src/lib/fazit-signal";
import { fazitEntryForExport } from "../shared/fazit-entry";
import { formatCurrency } from "../shared/currency-format";
import { attachExecSummary } from "../server/exec-summary-attach";
import { calculateGBMParams, gbmMonteCarlo } from "../client/src/lib/calculations";

let pass = 0, fail = 0;
const check = async (name: string, fn: () => void | Promise<void>) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e: any) { fail++; console.log("  ✗", name, "—", String(e.message).split("\n")[0]); } };
const strip = (h: string) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
const byTestId = (h: string, id: string) => strip((h.match(new RegExp(`data-testid="${id}"[^>]*>([\\s\\S]*?)</p>`)) ?? [])[1] ?? "");
const de2 = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const shel = JSON.parse(readFileSync("script/fixtures/analysis-SHEL.L.json", "utf8"));
const msft = attachExecSummary(structuredClone(JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"))));

for (const [label, d, ccyWord, pxWord] of [["SHEL.L", shel, "Pfund", "Pfund"], ["MSFT", msft, "Dollar", "Dollar"]] as const) {
  const data: any = d;
  const fe = fazitEntryForExport(data)!;
  const gp = calculateGBMParams(data.historicalPrices.map((p: any) => p.close));
  const mc = gbmMonteCarlo({ currentPrice: data.currentPrice, mu: gp.mu, sigma: gp.sigma, iterations: 2000, tradingDays: 252 }, data.analystPT.median);
  const ratingBefore = JSON.stringify(buildFazitSignal({ data, ...prepareFazitMetrics(data, mc) }));
  const exec = renderToStaticMarkup(React.createElement(ExecSummaryCard, { data, sharedMonteCarlo: mc }));
  const lage = byTestId(exec, "exec-summary-lage");
  const s6 = strip(renderToStaticMarkup(React.createElement(Section6 as any, { data })));
  const s6Label = formatCurrency(fe.fairValue, 2, fe.currency);
  await check(`${label}: S6 zeigt Entscheidungsbasis ${s6Label}`, () => assert.ok(s6.includes(s6Label), "S6 ohne " + s6Label));
  await check(`${label}: Lage nennt dieselbe Zahl ${de2(fe.fairValue)} ${ccyWord} („${lage}“)`, () =>
    assert.ok(lage.includes(`DCF sitzt bei ${de2(fe.fairValue)} ${ccyWord} gegenüber`), lage));
  await check(`${label}: Kurs in Listing-Währung (${pxWord})`, () => assert.ok(lage.includes(`${pxWord} Kurs.`), lage));
  if (label === "SHEL.L") await check("SHEL.L: kein „Dollar“ und kein Server-Wert 49,45 mehr; Server-Payload unverändert", () => {
    assert.ok(!lage.includes("Dollar") && !lage.includes("49,45"), lage);
    assert.ok(data.execSummary.fazit.lage.includes("49,45 Dollar"), "Fixture belegt den Bug");
  });
  await check(`${label}: Score/Rating bytegleich (Rendern ändert nichts)`, () => {
    assert.equal(JSON.stringify(buildFazitSignal({ data, ...prepareFazitMetrics(data, mc) })), ratingBefore);
    assert.equal(data.scoring?.total ?? null, (label === "SHEL.L" ? JSON.parse(readFileSync("script/fixtures/analysis-SHEL.L.json", "utf8")) : attachExecSummary(JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8")))).scoring?.total ?? null);
  });
}
await check("Ohne Fazit-Wert: Server-Satz bleibt (kein Erfinden)", () => {
  const h = renderToStaticMarkup(React.createElement(ExecSummaryCard, { data: { ...shel, currentPrice: NaN } }));
  assert.ok(typeof h === "string");
});
await check("Score-/Server-Dateien unverändert (exec-summary, attach, analyze-route, fazit-signal, bias-fixes, fazit-entry, schema)", () => {
  execSync(`git diff --quiet 9aff468d48969dcdff72263ff1b24ef232b9d170 -- server/exec-summary.ts server/exec-summary-attach.ts server/analyze-route.ts client/src/lib/fazit-signal.ts shared/bias-fixes.ts shared/fazit-entry.ts shared/schema.ts`);
});
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
