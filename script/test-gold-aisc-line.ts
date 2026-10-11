/**
 * Future_10 AISC-Linie: Datenvalidierung, Stresszone, n/a-Pfad, Verdrahtung. Ohne Netzwerk.
 * Ausführen: npx tsx script/test-gold-aisc-line.ts
 */
import { readFileSync } from "node:fs";
import {
  GOLD_AISC_ENTRIES, GOLD_AISC_QUARTERS, GOLD_AISC_QUARTERLY, GOLD_AISC_MIN_COMPANIES,
  buildGoldAiscQuarterly, goldAiscAt, goldAiscByDate, goldAiscSteps, goldAiscStress, quarterPeriodEnd,
  type GoldAiscEntry,
} from "../shared/data/gold-aisc-quarterly";
import { scoreGoldAdaptive, type GoldAdaptiveInput } from "../server/gold-adaptive-score";
import { buildGoldAiscStressGate, runRealYieldGoldModel } from "../server/gold-realyield-model";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\nDatenvalidierung");
{
  const companies = new Set(["Newmont", "Barrick", "Agnico Eagle"]);
  const bad = GOLD_AISC_ENTRIES.filter(e =>
    !companies.has(e.company) || !GOLD_AISC_QUARTERS.includes(e.quarter) || !Number.isInteger(e.aisc)
    || e.aisc < 600 || e.aisc > 3000 || !/^https:\/\/www\.sec\.gov\//.test(e.sourceUrl)
    || !/^\d{4}-\d{2}-\d{2}$/.test(e.publishedAt) || e.publishedAt <= quarterPeriodEnd(e.quarter) || !e.sourceTitle);
  check("jeder Eintrag: Firma, Quartal, AISC 600–3000 USD/oz, SEC-URL, Datum nach Quartalsende", bad.length === 0, JSON.stringify(bad[0]));
  const keys = GOLD_AISC_ENTRIES.map(e => `${e.company}|${e.quarter}`);
  check("keine Dubletten Firma×Quartal", new Set(keys).size === keys.length);
  check("mindestens 8 Quartale", GOLD_AISC_QUARTERS.length >= 8);
  check("Quartale lückenlos aufsteigend", GOLD_AISC_QUARTERS.every((q, i) => i === 0 || quarterPeriodEnd(q) > quarterPeriodEnd(GOLD_AISC_QUARTERS[i - 1])));
  check("quarterPeriodEnd 2025-Q1 = 2025-03-31", quarterPeriodEnd("2025-Q1") === "2025-03-31");
  check("quarterPeriodEnd 2024-Q4 = 2024-12-31", quarterPeriodEnd("2024-Q4") === "2024-12-31");
  for (const q of GOLD_AISC_QUARTERLY) {
    const vals = q.companies.map(c => c.aisc);
    const expect = vals.length >= GOLD_AISC_MIN_COMPANIES ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    if (q.aisc !== expect) check(`Ø ${q.quarter}`, false, `${q.aisc} vs ${expect}`);
  }
  check("Ø je Quartal = arithmetisches Mittel der Firmenwerte", true);
  check("Stichprobe Barrick 2026-Q2 = 1866", GOLD_AISC_ENTRIES.find(e => e.company === "Barrick" && e.quarter === "2026-Q2")?.aisc === 1866);
  check("2026-Q2 Ø = 1649 (1621/1866/1459)", GOLD_AISC_QUARTERLY.find(q => q.quarter === "2026-Q2")?.aisc === 1649);
}

console.log("\nn/a-Pfad (weniger als 2 Werte, keine Schätzung)");
{
  const one: GoldAiscEntry[] = [{ company: "Barrick", quarter: "2027-Q1", aisc: 1800, sourceUrl: "https://www.sec.gov/x", sourceTitle: "t", publishedAt: "2027-05-01" }];
  const q = buildGoldAiscQuarterly([...GOLD_AISC_ENTRIES, ...one], [...GOLD_AISC_QUARTERS, "2027-Q1", "2027-Q2"]);
  const q1 = q.find(x => x.quarter === "2027-Q1")!, q2 = q.find(x => x.quarter === "2027-Q2")!;
  check("1 Wert → aisc null (n/a)", q1.aisc === null && q1.count === 1);
  check("0 Werte → aisc null (n/a)", q2.aisc === null && q2.count === 0);
  check("n/a-Quartale fehlen in den Score-Stufen", goldAiscSteps(q).length === q.filter(x => x.aisc != null).length);
  check("n/a-Quartal beendet die Stufe (kein Fortschreiben)", goldAiscAt("2027-06-01", q) === null);
  check("vor erstem Quartal → null", goldAiscAt("2024-01-01") === null);
  check("Datum vor availableFrom nutzt Vorquartal", goldAiscAt("2026-08-13")?.quarter === "2026-Q1" && goldAiscAt("2026-08-14")?.quarter === "2026-Q2");
  const gate = buildGoldAiscStressGate(4000, null);
  check("Gate ohne AISC inaktiv, Begründung 'nicht verfügbar'", !gate.active && /nicht verfügbar/.test(gate.rationale));
}

console.log("\nStresszone");
{
  check("Preis < AISC → below", goldAiscStress(1500, 1600) === "below");
  check("Preis < AISC×1,10 → stress", goldAiscStress(1700, 1600) === "stress");
  check("Preis < AISC×1,15 → watch", goldAiscStress(1800, 1600) === "watch");
  check("Preis ≥ AISC×1,15 → ok", goldAiscStress(1840, 1600) === "ok");
  check("ohne AISC → na", goldAiscStress(1840, null) === "na");
  check("Gate aktiv unter ×1,15", buildGoldAiscStressGate(1800, 1600).active);
  check("Gate hart unter AISC", buildGoldAiscStressGate(1500, 1600).severity === "hard");
  check("Gate inaktiv weit darüber", !buildGoldAiscStressGate(4400, 1649).active);
}

console.log("\nEine Reihe für Gate und Supply-Layer");
{
  const closes: { date: string; close: number }[] = [];
  const real: { date: string; value: number }[] = [];
  const start = Date.parse("2024-06-03T00:00:00Z");
  for (let i = 0; i < 600; i++) {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    closes.push({ date, close: 2300 + i * 3 + Math.sin(i / 7) * 40 });
    real.push({ date, value: 2 - i * 0.001 });
  }
  const model = runRealYieldGoldModel(closes, real, goldAiscByDate(closes.map(c => c.date)), goldAiscAt(closes[closes.length - 1].date)?.aisc ?? null);
  const g = model.gates.find(x => x.id === "GOLD_AISC_STRESS")!;
  check("Gate liest AISC der Reihe (Begründung mit Abstand statt 'nicht verfügbar')", /Abstand zu AISC|über AISC/.test(g.rationale), g.rationale);
  const base: GoldAdaptiveInput = {
    closes, volumes: null, volumeSource: null, real10Y: real, fedFunds: [], m2: [], walcl: [], tga: [], rrpBillions: null,
    breakeven: [], dxy: [], aisc: null, regime: null, newsFlag: null, gis: 0.3, now: "2026-01-01T00:00:00Z",
  } as GoldAdaptiveInput;
  const before = scoreGoldAdaptive(base).layers.find(l => l.id === "supply")!;
  const after = scoreGoldAdaptive({ ...base, aisc: goldAiscSteps() }).layers.find(l => l.id === "supply")!;
  check("vorher Supply n/a", before.signals.every(s => !s.available));
  check("nachher Supply mit Wert", after.signals.some(s => s.available), JSON.stringify(after.signals[0]));
}

console.log("\nVerdrahtung (Quelltext)");
{
  const routes = readFileSync(new URL("../server/gold-routes.ts", import.meta.url), "utf8");
  check("Route übergibt goldAiscSteps() an scoreGoldAdaptive", /aisc:\s*goldAiscSteps\(\)/.test(routes));
  check("Route übergibt AISC an runRealYieldGoldModel", /goldAiscByDate\(/.test(routes) && /goldAiscAt\(lastGoldDate\)/.test(routes));
  const chart = readFileSync(new URL("../client/src/components/gold/GoldPriceChart.tsx", import.meta.url), "utf8");
  check("Chip heißt 'Inflations-BE (T10YIE)'", chart.includes('label: "Inflations-BE (T10YIE)"') && !chart.includes('label: "Breakeven"'));
  check("Chip 'AISC (Minen-Breakeven)' vorhanden", chart.includes("AISC (Minen-Breakeven)") && chart.includes('data-testid="toggle-gold-aisc"'));
  check("AISC gestuft auf der Preisachse (kein yAxisId)", /type="stepAfter" dataKey="aisc"/.test(chart) && !/dataKey="aisc"[^>]*yAxisId/.test(chart));
  check("Chart nutzt dieselbe Datei", chart.includes("shared/data/gold-aisc-quarterly"));
  check("Stresszone ×1,10/×1,15 schattiert", chart.includes("GOLD_AISC_STRESS_LOW") && chart.includes("GOLD_AISC_STRESS_HIGH") && /ReferenceArea x1=\{b\.x1\}/.test(chart));
  const analyze = readFileSync(new URL("../server/analyze-route.ts", import.meta.url), "utf8");
  check("analyze-route.ts ohne AISC-Bezug", !/aisc/i.test(analyze));
}

if (failed) { console.error(`\n❌ ${failed} Gold-AISC-Checks fehlgeschlagen`); process.exit(1); }
console.log("\n✅ Alle Gold-AISC-Checks bestanden");
