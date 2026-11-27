/**
 * Anzeige-Teil Gold-Miner-Breakeven.
 * availableFrom = max(Quartalsende + 60 Tage, sourceDate der Firmen in der Stufe).
 * Perzentil über Quartale, die am Stichtag verfügbar waren, nicht über Handelstage.
 * inScore bleibt false. Schwellen 1,10/1,15, Euphorie, Score-Kappung und Entry bleiben.
 *
 * Auf main ed1e98cd rot (Exit ≠ 0): die Stufe beginnt dort am Quartalsende + 60,
 * das Perzentil zählt jeden Handelstag.
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-gold-miner-breakeven-availability.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  GOLD_AISC_LAG_DAYS,
  GOLD_AISC_STRESS_HIGH,
  GOLD_AISC_STRESS_LOW,
  buildGoldAiscSeries,
  goldAiscStepAt,
  type GoldAiscFile,
} from "../shared/gold-aisc";
import { buildGoldMinerZone, percentileValue } from "../shared/gold-miner-zone";
import type { GoldAiscCompanyCode, GoldAiscSeries, GoldAiscValue } from "../shared/schema";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function businessDays(start: string, count: number): string[] {
  const out: string[] = [];
  let t = Date.parse(`${start}T00:00:00Z`);
  while (out.length < count) {
    const d = new Date(t);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

function companyValue(company: GoldAiscCompanyCode, quarter: string, aisc: number, sourceDate: string): GoldAiscValue {
  return {
    company,
    quarter,
    aisc,
    sourceUrl: "https://example.com/aisc",
    sourceTitle: "synthetisch",
    sourceDate,
  };
}

console.log("\navailableFrom = max(Quartalsende + 60, spätestes sourceDate)");
{
  const root = process.cwd();
  const file = JSON.parse(readFileSync(path.join(root, "server/data/gold-aisc.json"), "utf8")) as GoldAiscFile;
  const series = buildGoldAiscSeries(file);
  const q1 = series.quarters.find(step => step.quarter === "2024-Q1")!;
  const sources = q1.values.map(value => value.sourceDate).sort();
  check("2024-Q1 enthält NEM erst am 2026-02-19", sources[sources.length - 1] === "2026-02-19", sources.join(","));
  check(
    "2024-Q1 availableFrom ist 2026-02-19, nicht das Lag 2024-05-30",
    q1.availableFrom === "2026-02-19" && q1.availableFrom !== addDays(q1.periodEnd, GOLD_AISC_LAG_DAYS),
    q1.availableFrom,
  );
  check(
    "am 2024-05-30 ist 2024-Q1 nicht sichtbar; es gilt 2023-Q4",
    goldAiscStepAt(series, "2024-05-30")?.quarter === "2023-Q4",
    goldAiscStepAt(series, "2024-05-30")?.quarter,
  );
  check(
    "am 2026-02-18 liegt 2024-Q1 weiter in der Zukunft",
    goldAiscStepAt(series, "2026-02-18")?.quarter === "2023-Q4",
    goldAiscStepAt(series, "2026-02-18")?.quarter,
  );
  check(
    "am 2026-02-19 gilt die zuletzt verfügbare Stufe 2025-Q3, nicht ein späteres Quartal",
    goldAiscStepAt(series, "2026-02-19")?.quarter === "2025-Q3",
    goldAiscStepAt(series, "2026-02-19")?.quarter,
  );
  const q2020 = series.quarters.find(step => step.quarter === "2020-Q2")!;
  check(
    "2020-Q2 wartet auf Barrick (2020-11-06), nicht auf das frühere NEM-Datum und nicht nur auf das Lag",
    q2020.availableFrom === "2020-11-06",
    q2020.availableFrom,
  );
  check(
    "am 2020-09-30 gilt 2020-Q1, Barrick 2020-Q2 ist noch nicht veröffentlicht",
    goldAiscStepAt(series, "2020-09-30")?.quarter === "2020-Q1",
    goldAiscStepAt(series, "2020-09-30")?.quarter,
  );
  const q2016 = series.quarters[0];
  check(
    "2016-Q3 bleibt am Lag, wenn jede Quelle davor liegt",
    q2016.quarter === "2016-Q3" && q2016.availableFrom === "2016-11-29",
    `${q2016.quarter} ${q2016.availableFrom}`,
  );
  check("inScore der Reihe bleibt false", series.inScore === false);
  check("1,10 und 1,15 bleiben im Modul", GOLD_AISC_STRESS_LOW === 1.1 && GOLD_AISC_STRESS_HIGH === 1.15);
}

console.log("\nein später veröffentlichtes früheres Quartal verdeckt kein schon bekanntes späteres");
{
  const companies = {
    NEM: { name: "Newmont", ticker: "NEM", metric: "AISC" },
    B: { name: "Barrick", ticker: "B", metric: "AISC" },
    AEM: { name: "Agnico Eagle", ticker: "AEM", metric: "AISC" },
  };
  const values: GoldAiscValue[] = [
    companyValue("NEM", "2024-Q1", 1400, "2026-02-19"),
    companyValue("B", "2024-Q1", 1500, "2026-02-19"),
    companyValue("AEM", "2024-Q1", 1300, "2026-02-19"),
    companyValue("NEM", "2024-Q2", 1410, "2024-07-20"),
    companyValue("B", "2024-Q2", 1510, "2024-07-25"),
    companyValue("AEM", "2024-Q2", 1310, "2024-07-22"),
  ];
  const file: GoldAiscFile = {
    unit: "USD/oz",
    basis: "by-product",
    retrievedAt: "2026-03-01",
    companies,
    values,
  };
  const series = buildGoldAiscSeries(file);
  const q1 = series.quarters.find(step => step.quarter === "2024-Q1")!;
  const q2 = series.quarters.find(step => step.quarter === "2024-Q2")!;
  check("Q1 availableFrom 2026-02-19", q1.availableFrom === "2026-02-19", q1.availableFrom);
  check("Q2 availableFrom 2024-08-29 (Lag nach den Quellen)", q2.availableFrom === "2024-08-29", q2.availableFrom);
  check(
    "am 2024-09-01 gilt Q2, obwohl Q1 in der Datei früher steht und noch nicht veröffentlicht ist",
    goldAiscStepAt(series, "2024-09-01")?.quarter === "2024-Q2" && goldAiscStepAt(series, "2024-09-01")?.aisc === q2.aisc,
    goldAiscStepAt(series, "2024-09-01")?.quarter,
  );
  check("Q2-Mittelwert bleibt der belegte Ø, nichts wird geschätzt", q2.aisc === Math.round((1410 + 1510 + 1310) / 3));
}

console.log("\nPerzentil über Quartale, nur bis zum Stichtag");
{
  const dates = businessDays("2024-01-02", 161);
  const q2From = dates[150];
  const companies = {
    NEM: { name: "Newmont", ticker: "NEM", metric: "AISC" },
    B: { name: "Barrick", ticker: "B", metric: "AISC" },
    AEM: { name: "Agnico Eagle", ticker: "AEM", metric: "AISC" },
  };
  const step = (quarter: string, periodEnd: string, from: string, aisc: number) => ({
    quarter,
    periodEnd,
    availableFrom: from,
    aisc,
    count: 3,
    values: [
      companyValue("NEM", quarter, aisc, from),
      companyValue("B", quarter, aisc, from),
      companyValue("AEM", quarter, aisc, from),
    ],
  });
  const series: GoldAiscSeries = {
    unit: "USD/oz",
    basis: "by-product",
    method: "mean",
    minCompanies: 2,
    lagDays: 60,
    stressLow: 1.1,
    stressHigh: 1.15,
    companies,
    quarters: [
      step("2024-Q1", "2024-03-31", dates[0], 1000),
      step("2024-Q2", "2024-06-30", q2From, 1000),
      step("2024-Q3", "2024-09-30", dates[160], 1000),
    ],
    gaps: [],
    retrievedAt: "2026-01-01",
    source: "server/data/gold-aisc.json",
    inScore: false,
  };
  const prices = dates.map((date, index) => {
    if (index < 150) return { date, close: 1000 };
    if (index < 160) return { date, close: 2000 };
    return { date, close: 1200 };
  });
  const zone = buildGoldMinerZone(prices, series)!;
  const quarterly = [1, 1.2, 2].sort((a, b) => a - b);
  const expectedP20 = percentileValue(quarterly, 20);
  check("Zone vorhanden, inScore false, Euphorie leer", zone != null && zone.inScore === false && zone.thresholds.euph == null && zone.naReason == null);
  check(
    "P20 ist das Quartals-Perzentil 1,08, nicht das Tages-Perzentil 1",
    zone.thresholds.low != null && Math.abs(zone.thresholds.low - expectedP20) < 1e-9 && Math.abs(expectedP20 - 1.08) < 1e-9,
    `P20 ${zone.thresholds.low} erwartet ${expectedP20}`,
  );
  check(
    "Score ist der Rang des aktuellen Quartals in den drei Quartalen (50), nicht der Tagesrang",
    zone.latest != null && Math.abs(zone.latest.score - 50) < 1e-9 && zone.latest.multiple === 1.2,
    `score ${zone.latest?.score} ×${zone.latest?.multiple}`,
  );
  const beforeQ3 = buildGoldMinerZone(prices.slice(0, 160), series)!;
  const two = percentileValue([1, 2], 20);
  check(
    "vor Q3 fehlen dessen Tage; P20 bleibt das Perzentil von Q1 und Q2",
    beforeQ3.latest?.quarter === "2024-Q2"
      && beforeQ3.thresholds.low != null
      && Math.abs(beforeQ3.thresholds.low - two) < 1e-9
      && Math.abs(two - 1.2) < 1e-9,
    `P20 ${beforeQ3.thresholds.low} Quartal ${beforeQ3.latest?.quarter}`,
  );
  const duringQ1 = buildGoldMinerZone(prices.slice(0, 150), series)!;
  check(
    "vor Q2 besteht die Stichprobe aus einem Quartal",
    duringQ1.latest?.quarter === "2024-Q1" && duringQ1.thresholds.low === 1 && duringQ1.thresholds.high === 1,
    `P20 ${duringQ1.thresholds.low} P50 ${duringQ1.thresholds.high} ${duringQ1.latest?.quarter}`,
  );
}

console.log(failed === 0 ? "\nVerfügbarkeit und Quartals-Perzentil grün." : `\n${failed} Test(s) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
