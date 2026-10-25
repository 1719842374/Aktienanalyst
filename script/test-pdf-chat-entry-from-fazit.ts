/**
 * Bug SHEL.L (25.10.2026): PDF und Chat zeigen den Max-Entry (CRV 3:1) des S17-Fazits (£31.33),
 * gleiche Quelle wie die Exec Summary Option A (fazit-signal.ts). Vorher: PDF eigene Formel
 * ($18.76), Exec-Summary-Server-Satz 29,87, Chat ohne Fazit-Entry.
 * Prüft offline (Fixtures SHEL.L + MSFT):
 *  - PDF S6-Zeile und Faktor-Text = Fazit-Wert, alter PDF-Wert taucht nicht mehr auf
 *  - PDF-Verdict, Faktorzahlen und Signal-Score-Zeile bytegleich zu main
 *  - Client-Fazit Score/Rating und data.scoring bytegleich (keine Mutation)
 *  - Chat-Kontext: S1/S20 tragen den Fazit-Entry, alle anderen Sektionen bytegleich
 *  - n/a statt Ersatzwert, wenn das Fazit nicht berechenbar ist
 * SHOTS=1 schreibt Belege (HTML/JSON vorher/nachher) nach /workspace/fazitpdf-shots/.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateAnalysisHTML, pdfMaxEntryRow, buildNarrativePrompt } from "../server/pdf-export";
import { attachExecSummary } from "../server/exec-summary-attach";
import { buildStockChatContext } from "../shared/chat-context";
import { fazitEntryForExport, withFazitEntryChatFacts } from "../shared/fazit-entry";
import { computeFazitEntry } from "../shared/fazit-entry";
import * as clientReexport from "../client/src/lib/fazitEntryExport";
import { formatCurrency as fmtClient, currencySymbol as symClient, statementCurrency as scClient } from "../client/src/lib/formatters";
import { prepareFazitMetrics, buildFazitSignal } from "../client/src/lib/fazit-signal";
import { calculateGBMParams, gbmMonteCarlo } from "../client/src/lib/calculations";

let pass = 0, fail = 0;
const check = async (name: string, fn: () => void | Promise<void>) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e: any) { fail++; console.log("  ✗", name, "—", String(e.message).split("\n")[0]); } };
const SHOTS = process.env.SHOTS === "1";
const OUT = "/workspace/fazitpdf-shots";
if (SHOTS) mkdirSync(OUT, { recursive: true });

// main-Stand von pdf-export.ts neben die Datei legen (gleiche relative Imports) für den Vorher-Vergleich.
const tmp = "server/.main-pdf-export.tmp.ts";
let mainPdf: any;
let mainRef = "origin/main";
try { execSync(`git rev-parse --verify -q ${mainRef}`, { stdio: "ignore" }); } catch { mainRef = "HEAD~0"; }
writeFileSync(tmp, execSync(`git show ${mainRef}:server/pdf-export.ts`));
try { mainPdf = await import(pathToFileURL(resolve(tmp)).href); } finally { unlinkSync(tmp); }

delete process.env.ANTHROPIC_API_KEY; // kein LLM im Test
const verdictBits = (h: string) => [
  (h.match(/<div class="verdict-text">[^<]*<\/div>/) ?? [""])[0],
  (h.match(/<div class="verdict-sub">[^<]*<\/div>/) ?? [""])[0],
  (h.match(/Signal-Score<\/span><span class="row-val">[^<]*</) ?? [""])[0],
  (h.match(/Positive Faktoren \(\d+\)/) ?? [""])[0],
  (h.match(/Negative Faktoren \(\d+\)/) ?? [""])[0],
  (h.match(/Neutral \(\d+\)/) ?? [""])[0],
].join("\n");
const stripDates = (h: string) => h.replace(/\d{1,2}\.\d{1,2}\.\d{4}(, \d{1,2}:\d{2}:\d{2})?/g, "<datum>");

const shel = JSON.parse(readFileSync("script/fixtures/analysis-SHEL.L.json", "utf8"));
const msft = attachExecSummary(JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8")));

for (const [label, data, expLabel] of [["SHEL.L", shel, "£31.33"], ["MSFT", msft, null]] as const) {
  const d: any = data;
  const before = JSON.stringify(d);
  const fe = fazitEntryForExport(d);
  const m = prepareFazitMetrics(d, (() => { const gp = calculateGBMParams(d.historicalPrices.map((p: any) => p.close)); return gbmMonteCarlo({ currentPrice: d.currentPrice, mu: gp.mu, sigma: gp.sigma, iterations: 2000, tradingDays: 252 }, d.analystPT.median); })());
  const sig = buildFazitSignal({ data: d, ...m });

  await check(`${label}: Fazit-Entry = prepareFazitMetrics.dcfBeiCRV3 (${m.dcfBeiCRV3.toFixed(4)})`, () => {
    assert.ok(fe); assert.equal(fe!.maxEntry, m.dcfBeiCRV3); assert.equal(fe!.crvBase, m.crvConservative); assert.equal(fe!.crvRiskAdj, m.raCrvCons);
  });
  if (expLabel) await check(`${label}: Label ${expLabel}`, () => assert.equal(fe!.label, expLabel));

  const htmlNew = await generateAnalysisHTML(structuredClone(d));
  const htmlOld = await mainPdf.generateAnalysisHTML(structuredClone(d));
  const oldEntry = (htmlOld.match(/Max-Entry \(CRV 3:1\)<\/span><span class="row-val">([^<]+)</) ?? [])[1];
  const newEntry = (htmlNew.match(/data-testid="pdf-max-entry"><span class="row-label">Max-Entry \(CRV 3:1\)<\/span><span class="row-val">([^<]+)</) ?? [])[1];

  await check(`${label}: PDF S6 Max-Entry ${oldEntry} → ${newEntry} (= Fazit ${fe!.label})`, () => assert.equal(newEntry, fe!.label));
  await check(`${label}: alter PDF-Wert ${oldEntry} taucht nicht mehr auf`, () => assert.ok(!htmlNew.includes(oldEntry!), oldEntry));
  await check(`${label}: PDF-Faktor nennt Fazit-Entry`, () => assert.ok(htmlNew.includes(`Max-Entry (${fe!.label})`)));
  await check(`${label}: PDF Verdict/Faktorzahlen/Signal-Score bytegleich zu main`, () => assert.equal(verdictBits(htmlNew), verdictBits(htmlOld)));
  await check(`${label}: PDF-Diff zu main nur Max-Entry-Stellen`, () => {
    const a = stripDates(htmlOld).split("\n"), b = stripDates(htmlNew).split("\n");
    const changed = b.filter(x => !a.includes(x));
    for (const line of changed) assert.ok(/Max-Entry|Gleicher Wert wie das Fazit/.test(line), line.slice(0, 160));
  });
  await check(`${label}: data.scoring/Analyse unverändert (keine Mutation)`, () => assert.equal(JSON.stringify(d), before));
  await check(`${label}: Client-Fazit Score/Rating (${sig.score} / ${sig.rating}) unverändert durch Export`, () => {
    const sig2 = buildFazitSignal({ data: d, ...m });
    assert.equal(`${sig2.score}|${sig2.rating}`, `${sig.score}|${sig.rating}`);
  });

  const ctxOld = buildStockChatContext(d);
  const ctxNew = withFazitEntryChatFacts(ctxOld, d);
  await check(`${label}: Chat S1/S20 maxEntryCRV3_fazit = ${Math.round(fe!.maxEntry * 100) / 100}`, () => {
    for (const id of [1, 20]) {
      const s = ctxNew.sections.find(x => x.id === id)!;
      assert.equal(s.facts.maxEntryCRV3_fazit, Math.round(fe!.maxEntry * 100) / 100);
      assert.equal(s.facts.maxEntryCRV3_fazit_text, fe!.label);
    }
  });
  await check(`${label}: Chat übrige Sektionen/Gates/Score bytegleich`, () => {
    assert.equal(JSON.stringify(ctxNew.gates), JSON.stringify(ctxOld.gates));
    for (const s of ctxOld.sections) if (s.id !== 1 && s.id !== 20) assert.equal(JSON.stringify(ctxNew.sections.find(x => x.id === s.id)), JSON.stringify(s));
    const s20o = ctxOld.sections.find(x => x.id === 20)!.facts, s20n = ctxNew.sections.find(x => x.id === 20)!.facts;
    for (const k of Object.keys(s20o)) assert.equal(s20n[k], s20o[k], k);
  });

  if (SHOTS) {
    const t = label.replace(/\W/g, "_");
    writeFileSync(`${OUT}/pdf-${t}-vorher.html`, htmlOld);
    writeFileSync(`${OUT}/pdf-${t}-nachher.html`, htmlNew);
    writeFileSync(`${OUT}/chat-context-${t}-vorher.json`, JSON.stringify(ctxOld, null, 2));
    writeFileSync(`${OUT}/chat-context-${t}-nachher.json`, JSON.stringify(ctxNew, null, 2));
    writeFileSync(`${OUT}/score-rating-${t}.json`, JSON.stringify({ pdfVerdictBits_vorher: verdictBits(htmlOld), pdfVerdictBits_nachher: verdictBits(htmlNew), fazitScore: sig.score, fazitRating: sig.rating, scoringFinalScore: d.scoring?.finalScore ?? null, execSummaryServer: d.execSummary?.fazit?.handlung ?? null, maxEntry_pdf_vorher: oldEntry, maxEntry_pdf_nachher: newEntry, maxEntry_fazit: fe!.label }, null, 2));
  }
}

await check("n/a: Analyse ohne Kurs → kein Ersatzwert", () => {
  assert.equal(fazitEntryForExport({ ...shel, currentPrice: undefined }), null);
  assert.ok(pdfMaxEntryRow(null).includes("n/a — Fazit-Wert nicht berechenbar"));
  const c = withFazitEntryChatFacts(buildStockChatContext(shel), { ...shel, currentPrice: undefined });
  assert.equal(c.sections.find(x => x.id === 1)!.facts.maxEntryCRV3_fazit, null);
});

await check("server/pdf-export.ts + shared/fazit-entry.ts importieren nichts aus client/", () => {
  for (const f of ["server/pdf-export.ts", "shared/fazit-entry.ts", "shared/currency-format.ts"]) {
    assert.ok(!/from ['"][^'"]*client\//.test(readFileSync(f, "utf8")), f);
  }
});
await check("Drift-Guard: computeFazitEntry === prepareFazitMetrics (SHEL.L, MSFT)", () => {
  for (const d of [shel, msft]) {
    const a = computeFazitEntry(d); const b: any = prepareFazitMetrics(d, {} as any);
    assert.equal(a.decisionPerShare, b.bias.decisionPerShare ?? a.decisionPerShare);
    for (const k of ["worstCase", "crvConservative", "dcfBeiCRV3", "totalExpDmg", "raCrvCons"] as const) assert.equal(a[k], b[k], `${d.ticker} ${k}`);
  }
});
await check("Client-Re-Exporte zeigen auf dieselben shared-Funktionen", () => {
  assert.equal(clientReexport.fazitEntryForExport, fazitEntryForExport);
  assert.equal(clientReexport.withFazitEntryChatFacts, withFazitEntryChatFacts);
  assert.equal(fmtClient(1234.5, 2, "GBP"), "£1,234.50");
  assert.equal(symClient("GBp"), "GBp\u00A0");
  assert.equal(scClient({ ticker: "SAP.DE", currency: "EUR" }), "USD");
  assert.equal(scClient({ ticker: "SHEL.L", currency: "GBP" }), "GBP");
});
await check("LLM-Prompt: SHEL.L mit £ (kein $), MSFT mit $", () => {
  const fz = (d: any) => ({ konsDCF: 30, crvCons: 1, raCrvCons: 1, dcfBeiCRV3: fazitEntryForExport(d)!.maxEntry, totalExpDmg: 1, worstCase: 20, totalGB: 1, ptUp: 5, allBuy: false, verdict: "X", pos: [], neg: [] });
  const ps = buildNarrativePrompt(shel, fz(shel));
  assert.ok(ps.includes("- Max-Entry (CRV 3:1): £31.33"), "Max-Entry £");
  assert.ok(ps.includes(`- Kurs: £${shel.currentPrice.toFixed(2)}`), "Kurs £");
  assert.ok(!/\$\d/.test(ps), "kein $-Betrag");
  const pm = buildNarrativePrompt(msft, fz(msft));
  assert.ok(pm.includes("- Max-Entry (CRV 3:1): $340.78") && pm.includes(`- Kurs: $${msft.currentPrice.toFixed(2)}`));
});
if (process.env.TABLE_C === "1") {
  for (const d of [shel, msft]) {
    const fe = fazitEntryForExport(d)!; const es: any = attachExecSummary(JSON.parse(JSON.stringify(d))).execSummary;
    console.log("TABLE_C", d.ticker, JSON.stringify({ fazit: [fe.label, fe.crvBase, fe.crvRiskAdj], server: { crvLine: es?.crvLine, handlung: es?.fazit?.handlung } }));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
