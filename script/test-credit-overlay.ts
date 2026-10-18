/**
 * JOB A1 — Credit-Overlay Stufe 1 (FRED BAA10Y) in der Technischen Analyse. Score unverändert.
 * Ausführen: npx tsx script/test-credit-overlay.ts                 (offline: Fixture MSFT)
 *           npx tsx script/test-credit-overlay.ts --dir <pfad>     (+ alle <TICKER>.json aus <pfad>)
 *           npx tsx script/test-credit-overlay.ts --live           (+ Render-Cache ORCL, MSFT, KO, NVO, SAP.DE; nur Cache-Treffer)
 * Fixtures: script/fixtures/analysis-MSFT.json (bestehend), script/fixtures/credit/BAA10Y-2026-10-11.csv
 * (FRED fredgraph.csv, abgerufen 11.10.2026).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  creditOverlaySeries, creditStressHint, creditStressSignal, marketSpreadLabel, normalizeCreditPoints,
  CREDIT_STRESS_HINT, ISSUER_BOND_NA_NOTE, STRESS_CHANGE_OBS,
} from "../shared/credit";
import { fredCsvObservations } from "../server/fred-csv";
import { loadMarketCreditSpread } from "../server/credit-route";
import { buildBiasDecision } from "../shared/bias-fixes";
import { generateAnalysisHTML } from "../server/pdf-export";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const SNAP = "script/fixtures/credit/BAA10Y-2026-10-11.csv";

// Normalisierung über den gemeinsamen FRED-Kern
const csv = "observation_date,BAA10Y\n2024-01-03,1.70\n2024-01-02,1.65\n2024-01-04,.\nbad,1\n2024-01-03,1.70\n";
assert.deepEqual(normalizeCreditPoints(fredCsvObservations(csv)), [{ date: "2024-01-02", value: 1.65 }, { date: "2024-01-03", value: 1.7 }]);
assert.deepEqual(normalizeCreditPoints(fredCsvObservations("<html>")), []);
assert.deepEqual(normalizeCreditPoints(null), []);
ok("normalizeCreditPoints(fredCsvObservations): sortiert, '.'/Müll/Duplikate verworfen, HTML → []");

// Label exakt
assert.equal(marketSpreadLabel("ORCL"), "Markt-Spread Baa (alle US-Unternehmen) – keine Anleihe von ORCL");
assert.equal(marketSpreadLabel("SAP.DE"), "Markt-Spread Baa (alle US-Unternehmen) – keine Anleihe von SAP.DE");
assert.equal(CREDIT_STRESS_HINT, "Kreditmarkt-Stress steigt");
ok("Label exakt (ORCL, SAP.DE), Hinweis-Text exakt");

// Overlay: as-of, max 7 Tage Lücke, vorher null
const pts = [{ date: "2024-01-02", value: 1.5 }, { date: "2024-01-10", value: 1.6 }];
const ov = creditOverlaySeries([{ date: "2024-01-01" }, { date: "2024-01-05" }, { date: "2024-01-10" }, { date: "2024-01-30" }], pts);
assert.deepEqual(ov.map(p => p.spreadPct), [null, 1.5, 1.6, null]);
assert.equal(ov[1].spreadDate, "2024-01-02");
ok("creditOverlaySeries: letzter Wert ≤ Datum, Lücke > 7 Tage → n/a (kein Fake-Wert)");

// Hinweis nur bei steigendem Spread
const mk = (vals: number[]) => vals.map((value, i) => ({ date: new Date(Date.UTC(2000, 0, 1) + i * 86400000).toISOString().slice(0, 10), value }));
const flat = Array.from({ length: 2000 }, (_, i) => 2 + 0.05 * Math.sin(i / 7));
assert.equal(creditStressSignal(mk(flat))!.rising, false);
assert.equal(creditStressHint(creditStressSignal(mk(flat))), null);
const spike = [...flat, ...Array.from({ length: STRESS_CHANGE_OBS }, (_, i) => 2 + (i + 1) * 0.02)];
const sig = creditStressSignal(mk(spike))!;
assert.equal(sig.rising, true);
assert.ok(creditStressHint(sig)!.startsWith("Kreditmarkt-Stress steigt: "));
const fall = [...flat, ...Array.from({ length: STRESS_CHANGE_OBS }, (_, i) => 2 - (i + 1) * 0.02)];
assert.equal(creditStressSignal(mk(fall))!.rising, false);
assert.equal(creditStressHint(creditStressSignal(mk(fall))), null);
assert.equal(creditStressSignal(mk(flat.slice(0, 100))), null);
ok("Hinweis nur bei Anstieg (> 0 und > P80); flach/fallend/zu kurz → kein Hinweis");

// Echter FRED-Snapshot
const real = normalizeCreditPoints(fredCsvObservations(readFileSync(SNAP, "utf8")));
assert.ok(real.length > 5000 && real[0].date <= "1986-01-02");
const realSig = creditStressSignal(real)!;
console.log(`     BAA10Y Snapshot: ${real[0].date}…${realSig.asOf}, letzter ${realSig.last}%, 3M Δ ${(realSig.change3MPp * 100).toFixed(0)} bp, P80 ${(realSig.percentileThresholdPp * 100).toFixed(0)} bp, rising=${realSig.rising}`);
ok("FRED-Snapshot geparst (ab 1986), Signal berechenbar");

// Route-Loader mit gestubbtem Fetch; FRED weg → n/a
const okResp = await loadMarketCreditSpread({ fetchCsv: async () => readFileSync(SNAP, "utf8") });
assert.equal(okResp.seriesId, "BAA10Y");
assert.equal(okResp.points.length, real.length);
assert.deepEqual(okResp.stress, realSig);
const naResp = await loadMarketCreditSpread({ fetchCsv: async () => null });
assert.deepEqual(naResp.points, []);
assert.equal(naResp.stress, null);
assert.ok(naResp.note);
ok("loadMarketCreditSpread: Daten bzw. n/a ohne Ersatzwert");

// Kein Score-/Fazit-Pfad kennt das Overlay
for (const f of ["shared/bias-fixes.ts", "server/scoring-integration.ts", "server/pdf-export.ts", "server/analyze-route.ts", "client/src/components/sections/SummarySection.tsx"]) {
  const src = readFileSync(f, "utf8");
  assert.ok(!/credit-spread|shared\/credit|fred-csv|BAA10Y/.test(src), `${f} referenziert das Credit-Overlay`);
}
ok("Score-/Fazit-Dateien (bias-fixes, scoring-integration, pdf-export, analyze-route, SummarySection) ohne Credit-Bezug");

// Score + PDF-Fazit exakt unverändert, auch wenn Credit-Daten am Analyseobjekt hängen
const rows: string[] = [];
const cases: Array<{ label: string; load: () => Promise<any | null> }> = [
  { label: "MSFT (Fixture)", load: async () => JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8")) },
];
const dirIdx = process.argv.indexOf("--dir");
if (dirIdx > 0 && process.argv[dirIdx + 1]) {
  const dir = process.argv[dirIdx + 1];
  for (const f of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    cases.push({ label: `${f.replace(/\.json$/, "")} (${path.basename(dir)})`, load: async () => JSON.parse(readFileSync(path.join(dir, f), "utf8")) });
  }
}
if (process.argv.includes("--live")) {
  for (const t of ["ORCL", "MSFT", "KO", "NVO", "SAP.DE"]) {
    cases.push({ label: `${t} (Render-Cache)`, load: async () => {
      const list = await (await fetch("https://aktienanalyst.onrender.com/api/cache")).json() as { items: Array<{ ticker: string }> };
      if (!list.items.some(i => i.ticker === `analyze:${t}:llm:0`)) return null;
      const r = await fetch("https://aktienanalyst.onrender.com/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: t }) });
      return r.ok ? r.json() : null;
    } });
  }
}
const verdict = (h: string) => /FAZIT: ([A-ZÄÖÜ ]+)</.exec(h)?.[1] ?? "n/a";
for (const { label: t, load } of cases) {
  const data = await load();
  if (!data) { rows.push(`| ${t} | n/a (nicht im Cache) | | | | |`); continue; }
  const before = buildBiasDecision(data);
  const withCredit = buildBiasDecision({ ...data, creditSpread: okResp, creditStress: { ...realSig, rising: true } } as any);
  assert.deepEqual(withCredit, before);
  const htmlNo = await generateAnalysisHTML(data);
  const htmlYes = await generateAnalysisHTML({ ...data, creditSpread: okResp, creditStress: { ...realSig, rising: true } });
  assert.equal(verdict(htmlYes), verdict(htmlNo));
  assert.ok(!htmlYes.includes(CREDIT_STRESS_HINT));
  rows.push(`| ${t} | ${before.overallScore.toFixed(4)} | ${before.overallRating} | ${withCredit.overallScore.toFixed(4)} | ${withCredit.overallRating} | ${verdict(htmlNo)} = ${verdict(htmlYes)} |`);
}
console.log("\n| Ticker | Score vorher | Rating vorher | Score nachher | Rating nachher | PDF-Fazit |\n|---|---|---|---|---|---|\n" + rows.join("\n"));
ok("Score/Rating identisch (deepEqual), PDF-Fazit identisch, kein Credit-Text im Fazit");

console.log(`\n${n} Checks grün`);
