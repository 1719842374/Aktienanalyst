/**
 * Future_10 §5 (B1) — AISC-Linie im Gold-Chart: belegte Quartalsdaten, Ø-Stufen, Stresszone, kein Score-Einfluss.
 * Ausführen: npx tsx script/test-gold-aisc-line.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  aiscBands,
  aiscStressRuns,
  attachAiscToChart,
  buildGoldAiscSeries,
  goldAiscStepAt,
  goldAiscStress,
  quarterPeriodEnd,
  validateGoldAiscFile,
  type GoldAiscFile,
} from "../shared/gold-aisc";
import { loadGoldAiscSeries } from "../server/gold-aisc";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const root = process.cwd();
const file = JSON.parse(readFileSync(path.join(root, "server/data/gold-aisc.json"), "utf8")) as GoldAiscFile;

console.log("\nDatei server/data/gold-aisc.json ist belegt");
{
  const errors = validateGoldAiscFile(file);
  check("Validierung ohne Fehler", errors.length === 0, errors.join("; "));
  check("30 Werte (NEM/B/AEM × 2024-Q1…2026-Q2)", file.values.length === 30, String(file.values.length));
  check("jeder Wert hat https-Quelle + Datum", file.values.every(v => /^https:\/\//.test(v.sourceUrl) && /^\d{4}-\d{2}-\d{2}$/.test(v.sourceDate)));
  check("jede Quelle liegt nach dem Quartalsende", file.values.every(v => v.sourceDate > quarterPeriodEnd(v.quarter)));
  const nem = (q: string) => file.values.find(v => v.company === "NEM" && v.quarter === q)?.aisc;
  check("Stichprobe NEM 2025-Q4 = 1302", nem("2025-Q4") === 1302);
  check("Stichprobe B 2026-Q2 = 1866", file.values.find(v => v.company === "B" && v.quarter === "2026-Q2")?.aisc === 1866);
  check("Stichprobe AEM 2024-Q1 = 1190", file.values.find(v => v.company === "AEM" && v.quarter === "2024-Q1")?.aisc === 1190);
  const bad = validateGoldAiscFile({ ...file, values: [...file.values, { ...file.values[0], sourceUrl: "http://x" }] });
  check("Validierung erkennt Duplikat + Nicht-https", bad.some(e => /doppelt/i.test(e)) && bad.some(e => /https/i.test(e)), bad.join("; "));
}

console.log("\nØ-Stufen und Verfügbarkeit (Quartalsende + 60 Tage)");
const series = buildGoldAiscSeries(file);
{
  const expected: Record<string, number> = {
    "2024-Q1": 1346, "2024-Q2": 1360, "2024-Q3": 1445, "2024-Q4": 1362,
    "2025-Q1": 1468, "2025-Q2": 1449, "2025-Q3": 1405, "2025-Q4": 1467,
    "2026-Q1": 1407, "2026-Q2": 1649,
  };
  check("10 Quartale", series.quarters.length === 10, String(series.quarters.length));
  check("keine Lücken im Bereich", series.gaps.length === 0, series.gaps.join(","));
  for (const q of series.quarters) check(`${q.quarter} Ø ${q.aisc} (n=${q.count})`, q.aisc === expected[q.quarter] && q.count === 3, `erwartet ${expected[q.quarter]}`);
  const q4 = series.quarters.find(q => q.quarter === "2025-Q4")!;
  check("2025-Q4 periodEnd 2025-12-31, availableFrom 2026-03-01", q4.periodEnd === "2025-12-31" && q4.availableFrom === "2026-03-01", `${q4.periodEnd} ${q4.availableFrom}`);
  check("inScore=false", series.inScore === false);
  check("vor erster Stufe → null", goldAiscStepAt(series, "2024-05-29") === null);
  check("2024-05-30 → 2024-Q1", goldAiscStepAt(series, "2024-05-30")?.quarter === "2024-Q1");
  check("2026-10-18 → 2026-Q2 (Q3 erst ab 2026-11-29)", goldAiscStepAt(series, "2026-10-18")?.quarter === "2026-Q2");
  check("kein Lookahead: 2026-08-28 → 2026-Q1", goldAiscStepAt(series, "2026-08-28")?.quarter === "2026-Q1");
}

console.log("\nn/a statt Schätzung bei < 2 Firmen");
{
  const thin: GoldAiscFile = { ...file, values: file.values.filter(v => !(v.quarter === "2025-Q2" && v.company !== "NEM")) };
  const s = buildGoldAiscSeries(thin);
  const q = s.quarters.find(x => x.quarter === "2025-Q2")!;
  check("2025-Q2 nur NEM → aisc null, count 1", q.aisc === null && q.count === 1);
  check("Lücken gelistet", s.gaps.includes("B 2025-Q2") && s.gaps.includes("AEM 2025-Q2"), s.gaps.join(","));
  check("Datum in n/a-Stufe → null", goldAiscStepAt(s, "2025-09-15") === null);
  const two = buildGoldAiscSeries({ ...file, values: file.values.filter(v => !(v.quarter === "2025-Q2" && v.company === "AEM")) });
  check("2 Firmen → Ø aus 2", two.quarters.find(x => x.quarter === "2025-Q2")!.aisc === Math.round((1375 + 1684) / 2));
}

console.log("\nStresszone AISC × 1,10–1,15");
{
  check("unter AISC → below", goldAiscStress(990, 1000) === "below");
  check("1000…1099 → stress", goldAiscStress(1000, 1000) === "stress" && goldAiscStress(1099, 1000) === "stress");
  check("1100…1149 → watch", goldAiscStress(1100, 1000) === "watch" && goldAiscStress(1149, 1000) === "watch");
  check("≥ 1150 → ok", goldAiscStress(1150, 1000) === "ok");
  check("keine AISC → na", goldAiscStress(1000, null) === "na");
  const pts = [
    { date: "2026-03-02", price: 4000 },
    { date: "2026-03-03", price: 1500 },
    { date: "2026-03-04", price: 1600 },
    { date: "2026-03-05", price: 3000 },
    { date: "2026-06-01", price: 1400 },
  ];
  const withA = attachAiscToChart(pts, series);
  check("Punkte erhalten aisc der gültigen Stufe", withA[0].aisc === 1467 && withA[0].aiscQuarter === "2025-Q4" && withA[4].aiscQuarter === "2026-Q1");
  check("Originalfelder bleiben", withA.every((p, i) => p.price === pts[i].price && p.date === pts[i].date));
  check("Stress-Flag", withA.map(p => p.aiscStress).join() === "false,true,true,false,true");
  const bands = aiscBands(withA);
  check("Bänder je Stufe", bands.length === 2 && bands[0].x1 === "2026-03-02" && bands[0].x2 === "2026-03-05" && bands[1].quarter === "2026-Q1");
  const runs = aiscStressRuns(withA);
  check("Stress-Läufe", runs.length === 2 && runs[0].x1 === "2026-03-03" && runs[0].x2 === "2026-03-04", JSON.stringify(runs));
  check("ohne Serie → aisc null, kein Stress", attachAiscToChart(pts, null).every(p => p.aisc === null && !p.aiscStress));
}

console.log("\nServer-Loader + Verdrahtung");
{
  const loaded = loadGoldAiscSeries();
  check("loadGoldAiscSeries() liefert Serie", !!loaded && loaded.quarters.length === 10 && loaded.quarters.at(-1)!.aisc === 1649);
  check("ungültige Datei → null", loadGoldAiscSeries(path.join(root, "server/data/does-not-exist.json")) === null);
  const routes = readFileSync(path.join(root, "server/gold-routes.ts"), "utf8");
  check("gold-routes liefert aiscLine aus dem Loader", /aiscLine:\s*loadGoldAiscSeries\(\)/.test(routes));
  check("supplySignal-Platzhalter `aisc: null` unverändert (B2)", /aisc:\s*null/.test(routes));
  check("getTechnicalScore vorhanden", /function getTechnicalScore\(/.test(routes));
  const gisBlock = routes.slice(routes.indexOf("indicators"), routes.indexOf("aiscLine"));
  check("AISC fließt nicht in Indikatoren/GIS", !/loadGoldAiscSeries|aiscLine/.test(gisBlock));
  const analyze = readFileSync(path.join(root, "server/analyze-route.ts"), "utf8");
  check("analyze-route.ts kennt AISC nicht", !/gold-aisc|aiscLine/.test(analyze));
  const schema = readFileSync(path.join(root, "shared/gold-schema.ts"), "utf8");
  check("GoldAnalysis.aiscLine typisiert", /aiscLine\?:\s*GoldAiscSeries \| null/.test(schema));
  const chart = readFileSync(path.join(root, "client/src/components/gold/GoldPriceChart.tsx"), "utf8");
  check("Chip heißt „Inflations-BE (T10YIE)“", chart.includes('label: "Inflations-BE (T10YIE)"') && !/label: "Breakeven"/.test(chart));
  check("Chart zeichnet stepAfter-AISC", /type="stepAfter" dataKey="aisc"/.test(chart));
  check("Status-Zeile vorhanden", chart.includes('data-testid="gold-aisc-status"'));
}

console.log(failed === 0 ? "\nAlle AISC-Tests grün." : `\n${failed} Test(s) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
