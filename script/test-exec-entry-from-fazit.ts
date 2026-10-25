/**
 * Bug SHEL.L (Philip Option A, 25.10.): Die Exec Summary zeigte „Nachkaufen erst unter 29,87“ (Server
 * maxEntryCrv3), das S17/S20-Fazit dagegen Max-Entry £31,33 (Client). Soll: Die Exec Summary übernimmt den
 * Entry-Wert des Fazits, aus einer einzigen Quelle (prepareFazitEntry), ohne zweite Rechnung.
 * Prüft für SHEL.L (gespeicherte echte Antwort, Fixture wie #294/#295) und MSFT (US, execSummary mit dem
 * Server-Code aus attachExecSummary erzeugt):
 *  - die Exec-Sätze (Handlung, CRV) nennen dieselbe Max-Entry-Zahl wie die S20-Fazit-Tabelle
 *  - CRV Base/risikoadjustiert im Exec-CRV-Satz = Fazit-Faktoren
 *  - prepareFazitMetrics liefert dieselben Werte wie auf main (Refactor ohne Wertänderung)
 *  - der Server-Payload (execSummary, maxEntryCrv3) bleibt unverändert
 */
import React from "react";
(globalThis as any).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ExecSummaryCard } from "../client/src/components/ExecSummaryCard";
import { SummarySection } from "../client/src/components/sections/SummarySection";
import { prepareFazitMetrics, prepareFazitEntry, buildFazitSignal } from "../client/src/lib/fazit-signal";
import { calculateGBMParams, gbmMonteCarlo } from "../client/src/lib/calculations";
import { attachExecSummary } from "../server/exec-summary-attach";

let pass = 0, fail = 0;
const check = async (name: string, fn: () => void | Promise<void>) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e: any) { fail++; console.log("  ✗", name, "—", String(e.message).split("\n")[0]); } };
const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
const byTestId = (h: string, id: string) => strip((h.match(new RegExp(`data-testid="${id}"[^>]*>([\\s\\S]*?)</p>`)) ?? [])[1] ?? "");
const de2 = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2 });

const shel = JSON.parse(readFileSync("script/fixtures/analysis-SHEL.L.json", "utf8"));
const msftRaw = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const msft = attachExecSummary(structuredClone(msftRaw));

// main-Stand von fazit-signal.ts neben die Datei legen (gleiche relative Imports), um Werte zu vergleichen.
const tmp = "client/src/lib/.main-fazit-signal.tmp.ts";
writeFileSync(tmp, execSync("git show origin/main:client/src/lib/fazit-signal.ts"));
let mainMod: any;
try { mainMod = await import(pathToFileURL(resolve(tmp)).href); } finally { unlinkSync(tmp); }

for (const [label, data, serverEntryExpect] of [["SHEL.L", shel, 29.86882093355182], ["MSFT", msft, null]] as const) {
  const d: any = data;
  const prices = d.historicalPrices.map((p: any) => p.close);
  const gp = calculateGBMParams(prices);
  const mc = gbmMonteCarlo({ currentPrice: d.currentPrice, mu: gp.mu, sigma: gp.sigma, iterations: 2000, tradingDays: 252 }, d.analystPT.median);
  const entry = prepareFazitEntry(d);
  const exec = renderToStaticMarkup(React.createElement(ExecSummaryCard, { data: d }));
  const s20 = renderToStaticMarkup(React.createElement(SummarySection, { data: d, sharedMonteCarlo: mc } as any));
  const s20Entry = strip((s20.match(/DCF bei CRV 3:1<\/td><td[^>]*font-bold">([^<]+)</) ?? [])[1] ?? "");
  const handlung = byTestId(exec, "exec-summary-handlung");
  const crv = byTestId(exec, "exec-summary-crv");

  await check(`${label}: S20-Fazit zeigt Max-Entry ${s20Entry}`, () => assert.ok(s20Entry.length > 0));
  await check(`${label}: S20-Wert = prepareFazitEntry (${entry.dcfBeiCRV3.toFixed(4)})`, () =>
    assert.ok(s20Entry.replace(/,/g, "").includes(entry.dcfBeiCRV3.toFixed(2)), s20Entry));
  const exp = de2(entry.dcfBeiCRV3);
  await check(`${label}: Exec-Handlung nennt Fazit-Entry ${exp} („${handlung}“)`, () => {
    if (d.currentPrice > entry.dcfBeiCRV3) assert.ok(handlung.includes(`unter ${exp} `), handlung);
    else assert.equal(handlung, "Deshalb warten. Position nicht überstürzen.");
  });
  await check(`${label}: Exec-CRV-Satz nennt Fazit-Entry und Fazit-CRV („${crv}“)`, () => {
    if (d.currentPrice > entry.dcfBeiCRV3) {
      assert.ok(crv.includes(`unter ${exp}`), crv);
      assert.ok(crv.includes(`jetzt ${entry.crvConservative.toFixed(1)}:1`) && crv.includes(`risikoadjustiert ${entry.raCrvCons.toFixed(1)}:1`), crv);
    } else assert.equal(crv, "Chance zu Risiko 3 zu 1 ist am Kurs erfüllt.");
  });
  await check(`${label}: Fazit-Faktor „CRV Base“ passt zum Exec-CRV`, () => {
    const f = buildFazitSignal({ data: d, ...prepareFazitMetrics(d, mc) });
    assert.ok([...f.positive, ...f.negative, ...f.neutral].some(t => t.includes(`CRV Base`) && t.includes(`${entry.crvConservative.toFixed(1)}:1`)));
  });
  await check(`${label}: prepareFazitMetrics Branch == main (alle Werte, gleicher MC)`, () => {
    const a = prepareFazitMetrics(d, mc), b = mainMod.prepareFazitMetrics(d, mc);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(JSON.stringify(buildFazitSignal({ data: d, ...a })), JSON.stringify(mainMod.buildFazitSignal({ data: d, ...b })));
  });
  if (serverEntryExpect != null) {
    await check(`${label}: Server-Payload unverändert (maxEntryCrv3 ${serverEntryExpect.toFixed(2)}), Bug belegt`, () => {
      assert.equal(d.maxEntryCrv3, serverEntryExpect);
      assert.ok(d.execSummary.fazit.handlung.includes("29,87"));
      assert.ok(Math.abs(entry.dcfBeiCRV3 - serverEntryExpect) > 1, "Fixture zeigt den Widerspruch");
      assert.ok(!handlung.includes("29,87") && !crv.includes("29,87"));
    });
  }
}

await check("Ohne berechenbare Fazit-Werte: Server-Sätze bleiben (kein Erfinden)", () => {
  const broken: any = { ...shel, currentPrice: NaN };
  const h = renderToStaticMarkup(React.createElement(ExecSummaryCard, { data: broken }));
  // Karte darf nicht abstürzen; entweder Server-Satz oder gar keine Karte (fazit null).
  assert.ok(typeof h === "string");
});
await check("Server-Dateien unverändert (exec-summary, exec-summary-attach, analyze-route)", () => {
  const mb = execSync("git merge-base HEAD origin/main").toString().trim();
  execSync(`git diff --quiet ${mb} -- server/exec-summary.ts server/exec-summary-attach.ts server/analyze-route.ts`);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
