/**
 * Gold Miner-Breakeven: adaptive Perzentil-Zonen, kein Lookahead, kein Score.
 * Ausführen: npx tsx script/test-gold-miner-zone.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildGoldAiscSeries, type GoldAiscFile } from "../shared/gold-aisc";
import type { GoldAiscCompanyCode, GoldAiscSeries, GoldAiscValue } from "../shared/schema";
import {
  GOLD_MINER_ZONE_MIN_OBS,
  buildGoldMinerZone,
  percentileRank,
  percentileValue,
} from "../shared/gold-miner-zone";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
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

function companyValue(company: GoldAiscCompanyCode, aisc: number): GoldAiscValue {
  return {
    company,
    quarter: "2024-Q1",
    aisc,
    sourceUrl: "https://example.com/aisc",
    sourceTitle: "synthetisch",
    sourceDate: "2024-06-01",
  };
}

function seriesAt(aisc: number, from: string, extra?: GoldAiscSeries["quarters"][number]): GoldAiscSeries {
  return {
    unit: "USD/oz",
    basis: "by-product",
    method: "mean",
    minCompanies: 2,
    lagDays: 60,
    stressLow: 1.1,
    stressHigh: 1.15,
    companies: {
      NEM: { name: "Newmont", ticker: "NEM", metric: "AISC" },
      B: { name: "Barrick", ticker: "B", metric: "AISC" },
      AEM: { name: "Agnico Eagle", ticker: "AEM", metric: "AISC" },
    },
    quarters: [
      {
        quarter: "2024-Q1",
        periodEnd: "2024-03-31",
        availableFrom: from,
        aisc,
        count: 3,
        values: [companyValue("NEM", aisc), companyValue("B", aisc), companyValue("AEM", aisc)],
      },
      ...(extra ? [extra] : []),
    ],
    gaps: [],
    retrievedAt: "2026-10-18",
    source: "server/data/gold-aisc.json",
    inScore: false,
  };
}

console.log("\nPerzentil linear, Rang 0…100");
{
  const sorted = [1, 2, 3, 4, 5];
  check("P20 linear", Math.abs(percentileValue(sorted, 20) - 1.8) < 1e-12, String(percentileValue(sorted, 20)));
  check("P50 = Median", percentileValue(sorted, 50) === 3);
  check("Rang am Minimum 0", percentileRank(sorted, 1) === 0);
  check("Rang am Maximum 100", percentileRank(sorted, 5) === 100);
  check("Rang invers zur Interpolation", Math.abs(percentileValue(sorted, percentileRank(sorted, 3.4)) - 3.4) < 1e-9);
  let prev = -1;
  let mono = true;
  for (const x of [1, 1.2, 2, 3.4, 4, 5, 9]) {
    const rank = percentileRank(sorted, x);
    if (!(rank >= prev)) mono = false;
    prev = rank;
  }
  check("Score-Rang monoton im Multiple", mono);
  check("konstante Stichprobe Rang 50", percentileRank([2, 2, 2, 2], 2) === 50);
}

console.log("\nseries=null und kurze Historie");
{
  const dates = businessDays("2024-01-02", 40);
  const px = dates.map(date => ({ date, close: 2000 }));
  check("series=null ⇒ null", buildGoldMinerZone(px, null) === null);
  const shortDates = businessDays("2024-01-02", GOLD_MINER_ZONE_MIN_OBS - 1);
  const short = buildGoldMinerZone(
    shortDates.map(date => ({ date, close: 2000 })),
    seriesAt(1000, shortDates[0]),
  );
  check("unter 120 Obs kein null-Return", short !== null);
  check("naReason „Historie < 120 Handelstage“", short?.naReason === "Historie < 120 Handelstage", short?.naReason ?? "");
  check("kurze Historie: latest null, Zonen null, inScore false",
    short?.latest == null && short?.inScore === false && short.points.every(p => p.zone == null) && short.segments.length === 0);
  check("obs zählt nur Tage mit Stufe", short?.thresholds.obs === GOLD_MINER_ZONE_MIN_OBS - 1);
  check("Euphorie-Schwelle nicht gesetzt", short?.thresholds.euph == null && short?.thresholds.pEuphRank === 90);
}

console.log("\nkein Lookahead: Schwelle an Tag d bleibt, wenn danach Daten folgen");
{
  const dates = businessDays("2024-01-02", 350);
  const dayD = dates[149];
  const prefix = dates.slice(0, 150).map(date => ({ date, close: 2000 }));
  const extended = dates.map((date, i) => ({ date, close: i < 150 ? 2000 : 10000 }));
  const series = seriesAt(1000, dates[0]);
  const atD = buildGoldMinerZone(prefix, series)!;
  const later = buildGoldMinerZone(extended, series)!;
  const zoneAtD = atD.points.find(p => p.date === dayD)?.zone;
  const zoneLater = later.points.find(p => p.date === dayD)?.zone;
  const multiples = prefix.map(p => p.close / 1000).sort((a, b) => a - b);
  check("Schwelle Tag d ist P20/P50 nur bis d",
    atD.thresholds.low === percentileValue(multiples, 20) && atD.thresholds.high === percentileValue(multiples, 50));
  check("Zone an Tag d unverändert nach Anhängen", zoneAtD != null && zoneAtD === zoneLater, `${zoneAtD} → ${zoneLater}`);
  check("angehängte Hausse verschiebt die End-Schwelle (P50)", (later.thresholds.high ?? 0) > (atD.thresholds.high ?? 0));
  check("Tag d bleibt profitabel (2×, Stichprobe konstant 2)", zoneAtD === "profitable");
  const lookaheadP50 = percentileValue(extended.map(p => p.close / 1000).sort((a, b) => a - b), 50);
  check("Lookahead-P50 würde Tag d anders einordnen", lookaheadP50 > 2 && zoneLater === "profitable", String(lookaheadP50));
}

console.log("\nmultiple < 1 ⇒ Kapitulation, Score ≤ 10, monoton");
{
  const dates = businessDays("2024-01-02", 201);
  const series = seriesAt(1000, dates[0]);
  const below = buildGoldMinerZone(
    dates.map((date, i) => ({ date, close: i === dates.length - 1 ? 900 : 400 })),
    series,
  )!;
  check("0,9× ist Kapitulation trotz über P50", below.latest?.zone === "capitulation", below.latest?.zone);
  check("Score bei multiple < 1 auf ≤ 10 gekappt", (below.latest?.score ?? 99) <= 10, String(below.latest?.score));
  check("Roh-Rang des Maximums wäre 100", percentileRank(dates.map((_, i) => (i === dates.length - 1 ? 0.9 : 0.4)).sort((a, b) => a - b), 0.9) === 100);

  const scoreAt = (multiple: number) => {
    const built = buildGoldMinerZone(
      dates.map((date, i) => ({ date, close: i === dates.length - 1 ? multiple * 1000 : 2000 })),
      series,
    )!;
    return built.latest!.score;
  };
  const scores = [0.5, 0.9, 2, 4].map(scoreAt);
  check("Score monoton im Multiple", scores.every((s, i) => i === 0 || s >= scores[i - 1]), scores.join(","));
  check("beide Sub-1-Scores ≤ 10", scores[0] <= 10 && scores[1] <= 10, scores.slice(0, 2).join(","));
}

console.log("\nLücke statt Interpolation, Glättung, Ausdünnung");
{
  const dates = businessDays("2024-01-02", 160);
  const gapFrom = dates[140];
  const series = seriesAt(1000, dates[0], {
    quarter: "2024-Q2",
    periodEnd: "2024-06-30",
    availableFrom: gapFrom,
    aisc: null,
    count: 0,
    values: [],
  });
  const built = buildGoldMinerZone(dates.map(date => ({ date, close: 2500 })), series)!;
  const gap = built.points.filter(p => p.date >= gapFrom);
  check("n/a-Stufe ohne Multiple", gap.length > 0 && gap.every(p => p.multiple == null && p.zone == null));
  check("vor der Lücke ist die Stufe da", built.points.some(p => p.date < gapFrom && p.multiple === 2.5));
  check("inScore false", built.inScore === false);

  const many = businessDays("2024-01-02", 900).map(date => ({ date, close: 2000 }));
  const thin = buildGoldMinerZone(many, seriesAt(1000, many[0].date), { maxPoints: 800 })!;
  check("Ausdünnung ≤ 800", thin.points.length <= 800 && thin.points.length > 700, String(thin.points.length));
  check("erster und letzter Tag bleiben", thin.points[0].date === many[0].date && thin.points.at(-1)!.date === many.at(-1)!.date);
  check("Segment-Enden liegen auf gelieferten Punkten",
    thin.segments.every(s => thin.points.some(p => p.date === s.x1) && thin.points.some(p => p.date === s.x2)));
}

console.log("\nechte gold-aisc.json");
{
  const root = process.cwd();
  const file = JSON.parse(readFileSync(path.join(root, "server/data/gold-aisc.json"), "utf8")) as GoldAiscFile;
  const series = buildGoldAiscSeries(file);
  const dates = businessDays("2024-05-30", 700).filter(d => d <= "2026-10-18");
  let close = 2300;
  const px = dates.map(date => {
    close += 1.5;
    return { date, close };
  });
  const zone = buildGoldMinerZone(px, series);
  check("echte JSON liefert eine Zone", zone != null && zone.naReason == null);
  check("obs ≥ 120 seit 2024-05-30", (zone?.thresholds.obs ?? 0) >= 120 && zone?.thresholds.since === "2024-05-30",
    `${zone?.thresholds.obs} ab ${zone?.thresholds.since}`);
  const latest = zone?.latest;
  check("latest.multiple = spot/aisc",
    !!latest && Math.abs(latest.multiple - latest.spot / latest.aisc) < 1e-9,
    latest ? String(latest.multiple) : "kein latest");
  check("letzte Stufe 2026-Q2 Ø 1649", latest?.quarter === "2026-Q2" && latest.aisc === 1649, `${latest?.quarter} ${latest?.aisc}`);
  check("drei Firmen am letzten Quartal", latest?.perCompany.length === 3);
  check("keine Euphorie-Zone und euph null",
    zone?.thresholds.euph == null && zone!.points.every(p => p.zone !== "euphoria") && zone!.segments.every(s => s.zone !== "euphoria"));
  check("Punkte ≤ 800", (zone?.points.length ?? 999) <= 800);
  const src = readFileSync(path.join(root, "shared/gold-miner-zone.ts"), "utf8");
  check("importiert nur goldAiscStepAt aus gold-aisc", /import \{ goldAiscStepAt \} from "\.\/gold-aisc"/.test(src));
  check("keine festen 1,10/1,15-Multiple-Schwellen", !/1\.10|1\.15/.test(src));
  check("zieht minerMetrics nicht ein", !/minerMetrics|classifyMinerZone/.test(src));
}

console.log("\nScore-Pins (VOW3 / SAP / MSFT)");
{
  const pin = JSON.parse(readFileSync(new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
  check("VOW3 (VWAGY) 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718");
  check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758");
  check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138");
}

console.log(failed === 0 ? "\nAlle Gold-Miner-Zonen-Tests grün." : `\n${failed} Test(s) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
