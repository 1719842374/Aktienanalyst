/**
 * JOB W1 — Credit-Overlay (FRED BAA10Y), Fazit-Hinweis, Score unverändert.
 * Ausführen: npx tsx script/test-credit-overlay.ts            (offline: Fixture MSFT)
 *           npx tsx script/test-credit-overlay.ts --live     (+ /api/analyze-Cache von aktienanalyst.onrender.com
 *                                                              für KO, NVO, SAP, ORCL, SAP.DE; nur Cache-Treffer)
 * Fixtures: script/fixtures/analysis-MSFT.json (bestehend), script/fixtures/credit/BAA10Y-2026-10-11.csv
 * (FRED fredgraph.csv, abgerufen 11.10.2026).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  creditOverlaySeries, creditStressHint, creditStressSignal, marketSpreadLabel, parseFredCsv,
  ISSUER_BOND_NA_NOTE, STRESS_CHANGE_OBS,
} from "../shared/credit";
import { loadMarketCreditSpread } from "../server/credit-route";
import { buildBiasDecision } from "../shared/bias-fixes";
import { generateAnalysisHTML } from "../server/pdf-export";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

// Parser
const csv = "observation_date,BAA10Y\n2024-01-03,1.70\n2024-01-02,1.65\n2024-01-04,.\nbad,1\n2024-01-03,1.70\n";
assert.deepEqual(parseFredCsv(csv), [{ date: "2024-01-02", value: 1.65 }, { date: "2024-01-03", value: 1.7 }]);
assert.deepEqual(parseFredCsv("<html>"), []);
assert.deepEqual(parseFredCsv(null), []);
ok("parseFredCsv: sortiert, '.'/Müll/Duplikate verworfen, HTML → []");

// Label exakt
assert.equal(marketSpreadLabel("ORCL"), "Markt-Spread Baa (alle US-Unternehmen) – keine Anleihe von ORCL");
assert.equal(ISSUER_BOND_NA_NOTE, "Unternehmensspezifische Anleiherendite: n/a – keine freie Kursquelle (TRACE/Bloomberg kostenpflichtig)");
ok("Label + n/a-Hinweis exakt");

// Overlay: as-of, max 7 Tage Lücke, vorher null
const pts = [{ date: "2024-01-02", value: 1.5 }, { date: "2024-01-10", value: 1.6 }];
const ov = creditOverlaySeries([{ date: "2024-01-01" }, { date: "2024-01-05" }, { date: "2024-01-10" }, { date: "2024-01-30" }], pts);
assert.deepEqual(ov.map(p => p.spreadPct), [null, 1.5, 1.6, null]);
assert.equal(ov[1].spreadDate, "2024-01-02");
ok("creditOverlaySeries: letzter Wert ≤ Datum, Lücke > 7 Tage → n/a");

// Stress-Signal synthetisch: flach mit kleinem Rauschen, dann starker Anstieg → rising
const mk = (vals: number[]) => vals.map((value, i) => ({ date: new Date(Date.UTC(2000, 0, 1) + i * 86400000).toISOString().slice(0, 10), value }));
const flat = Array.from({ length: 2000 }, (_, i) => 2 + 0.05 * Math.sin(i / 7));
assert.equal(creditStressSignal(mk(flat))!.rising, false);
const spike = [...flat, ...Array.from({ length: STRESS_CHANGE_OBS }, (_, i) => 2 + (i + 1) * 0.02)];
const sig = creditStressSignal(mk(spike))!;
assert.equal(sig.rising, true);
assert.ok(creditStressHint(sig)!.startsWith("Kreditmarkt-Stress steigt"));
assert.equal(creditStressHint(creditStressSignal(mk(flat))), null);
assert.equal(creditStressSignal(mk(flat.slice(0, 100))), null);
ok("creditStressSignal: P80-Regel, zu kurze Historie → null, kein Hinweis ohne Anstieg");

// Echter FRED-Snapshot
const real = parseFredCsv(readFileSync("script/fixtures/credit/BAA10Y-2026-10-11.csv", "utf8"));
assert.ok(real.length > 5000 && real[0].date <= "1986-01-02");
const realSig = creditStressSignal(real)!;
console.log(`     BAA10Y Snapshot: ${real[0].date}…${realSig.asOf}, letzter ${realSig.last}%, 3M Δ ${(realSig.change3MPp * 100).toFixed(0)} bp, P80 ${(realSig.percentileThresholdPp * 100).toFixed(0)} bp, rising=${realSig.rising}`);
ok("FRED-Snapshot geparst (ab 1986), Signal berechenbar");

// Route-Loader mit gestubbtem Fetch; FRED weg → n/a
const okResp = await loadMarketCreditSpread({ fetchCsv: async () => readFileSync("script/fixtures/credit/BAA10Y-2026-10-11.csv", "utf8") });
assert.equal(okResp.seriesId, "BAA10Y");
assert.equal(okResp.points.length, real.length);
const naResp = await loadMarketCreditSpread({ fetchCsv: async () => null });
assert.deepEqual(naResp.points, []);
assert.equal(naResp.stress, null);
ok("loadMarketCreditSpread: Daten bzw. n/a ohne Ersatzwert");

// Score exakt unverändert: Credit-Daten am Analyseobjekt ändern buildBiasDecision nicht.
const rows: string[] = [];
const cases: Array<{ label: string; load: () => Promise<any | null> }> = [
  { label: "MSFT (Fixture)", load: async () => JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8")) },
];
if (process.argv.includes("--live")) {
  for (const t of ["ORCL", "MSFT", "KO", "NVO", "SAP", "SAP.DE"]) {
    cases.push({ label: `${t} (Render-Cache)`, load: async () => {
      // Nur Cache-Treffer verwenden: /api/cache listet die vorhandenen Keys; kein neuer Analyse-Lauf.
      const list = await (await fetch("https://aktienanalyst.onrender.com/api/cache")).json() as { items: Array<{ ticker: string }> };
      if (!list.items.some(i => i.ticker === `analyze:${t}:llm:0`)) return null;
      const r = await fetch("https://aktienanalyst.onrender.com/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: t }) });
      return r.ok ? r.json() : null;
    } });
  }
}
for (const { label: t, load } of cases) {
  const data = await load();
  if (!data) { rows.push(`| ${t} | n/a (nicht im Cache) | | | | | |`); continue; }
  const before = buildBiasDecision(data);
  const withCredit = buildBiasDecision({ ...data, creditSpread: okResp, creditStress: { ...realSig, rising: true } } as any);
  assert.deepEqual(withCredit, before);
  const htmlNo = await generateAnalysisHTML(data, {});
  const htmlYes = await generateAnalysisHTML(data, { creditStress: { ...realSig, rising: true } });
  const verdict = (h: string) => /FAZIT: ([A-ZÄÖÜ ]+)</.exec(h)?.[1];
  assert.equal(verdict(htmlYes), verdict(htmlNo));
  assert.ok(htmlYes.includes('data-testid="pdf-credit-stress"') && !htmlNo.includes("pdf-credit-stress"));
  rows.push(`| ${t} | ${before.overallScore.toFixed(4)} | ${before.overallRating} | ${withCredit.overallScore.toFixed(4)} | ${withCredit.overallRating} | ${verdict(htmlNo)} | ${verdict(htmlYes)} |`);
}
console.log("\n| Ticker | Score vorher | Rating vorher | Score nachher | Rating nachher | PDF-Fazit ohne Hinweis | PDF-Fazit mit Hinweis |\n|---|---|---|---|---|---|---|\n" + rows.join("\n"));
ok("Score/Rating identisch (deepEqual), PDF-Verdict identisch, Hinweis nur als Zusatzzeile");

console.log(`\n${n} Checks grün`);
