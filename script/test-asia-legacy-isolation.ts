/**
 * PR 470: new ASHR/GDP fetches must not replace the Eurostat/OECD prints,
 * and ASHR vol uses the same realizedVol20 as the market chart.
 * Run: npx tsx script/test-asia-legacy-isolation.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { capeReading, durableReading, m2Reading, scoreSeriesStress, vixReading } from "../server/recession";
import {
  applyAsiaSupplement,
  ashrRealizedVolPoints,
  emptyRegionalPrints,
  scoreRegionalCatalogs,
  type RegionScorers,
} from "../server/recession-regions";
import { realizedVol20 } from "../shared/recession-market-charts";

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function day(index: number): string {
  return new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
}

function legacyBlock(src: string): string {
  const start = src.indexOf("async function fetchLegacyRegionalPrints");
  const end = src.indexOf("async function fetchAsiaSupplement");
  if (start === -1 || end === -1 || end < start) return "";
  return src.slice(start, end);
}

console.log("\n=== Legacy-Abruf bleibt von ASHR/BIP getrennt ===");
{
  const src = readFileSync("server/recession-regions.ts", "utf8");
  const block = legacyBlock(src);
  check("Legacy-Funktion ist vom ASHR-Nachzug getrennt", block.length > 0);
  check("Eurostat une_rt_m und sts_inpr_m bleiben im Legacy-Block", block.includes('eurostat("une_rt_m"') && block.includes('eurostat("sts_inpr_m"'));
  check("OECD-IP und FRED JPNPROINDMISMEI bleiben im Legacy-Block", block.includes("OECD_JP_IP") && block.includes("JPNPROINDMISMEI"));
  check(
    "ASHR, Yahoo-Chart und BIP-Gewichte stehen nicht im Legacy-Promise",
    !block.includes("ashrPe(") && !block.includes("gdpUsd(") && !block.includes("fetchYahooDailySeries") && !block.includes("fmpHistoricalPrices"),
  );
  check("fetchRegionalPrints hängt den Nachzug erst nach dem Legacy-Abruf an", /const legacy = await fetchLegacyRegionalPrints\(today\);[\s\S]*fetchAsiaSupplement\(today\)/.test(src));
}

console.log("\n=== Ausfall der neuen Quellen lässt EZ/JP-Drucke stehen ===");
{
  const legacy = emptyRegionalPrints();
  legacy.ezUnemployment = { geo: "EA21", points: [{ date: "2026-08-01", value: 6.4 }] };
  legacy.ezIp = { geo: "EA20", points: [{ date: "2025-08-01", value: 100 }, { date: "2026-08-01", value: 98.9 }] };
  legacy.jpIp = [{ date: "2025-04-01", value: 100 }, { date: "2026-04-01", value: 102.1 }];
  legacy.jpIpSource = "OECD STES JPN.M.PRVM.IX.BTE.Y (DBnomics)";
  const kept = applyAsiaSupplement(legacy, null);
  check("Eurostat-ALQ bleibt EA21", kept.ezUnemployment.geo === "EA21" && kept.ezUnemployment.points[0].value === 6.4);
  check("Eurostat-IP bleibt der EA20-Druck", kept.ezIp.geo === "EA20" && kept.ezIp.points.at(-1)?.value === 98.9);
  check("Japan-IP bleibt die OECD-Serie, nicht der FRED-Stand 2024-03", kept.jpIpSource === legacy.jpIpSource && kept.jpIp.at(-1)?.date === "2026-04-01" && kept.jpIp.at(-1)?.value === 102.1);
  check("ASHR-Vol ist n/a, die Japan-Serie wird nicht geleert", kept.cnVolPoints.length === 0 && kept.cnVolSource.startsWith("n/a —") && kept.jpIp.length === 2);

  const scorers = (): RegionScorers => ({
    money: yoy => m2Reading(yoy),
    credit: spread => ({ ...m2Reading(spread), rawScore: 0, weightedScore: 0, zone: "n/a" }),
    vol: level => vixReading(level),
    valuation: ratio => capeReading(ratio),
    activity: yoy => {
      const reading = durableReading(yoy);
      return { rawScore: reading.rawScore, zone: reading.zone };
    },
    curve: (levels, stressWhenLow) => {
      const scored = scoreSeriesStress(stressWhenLow ? levels.map(value => -value) : levels);
      return { available: scored.available, raw: scored.raw };
    },
  });
  const withGdp = {
    ...kept,
    jpGdpUsd: 4,
    cnGdpUsd: 16,
    jpGdpSource: "FRED MKTGDPJPA646NWDB 2025",
    cnGdpSource: "FRED MKTGDPCNA646NWDB 2025",
  };
  const catalog = scoreRegionalCatalogs({
    prints: withGdp,
    usSlots: [],
    usRecession12m: 40,
    usCorrection12m: 35,
    today: "2026-11-09",
    scorers: scorers(),
  });
  const ez = catalog.regions.find(region => region.id === "EZ")!;
  const jp = catalog.regions.find(region => region.id === "JP")!;
  const ezAct = ez.slots.find(slot => slot.name === "Aktivität EZ")!;
  const jpAct = jp.slots.find(slot => slot.name === "Aktivität JP")!;
  check("Aktivität EZ bleibt ein YoY aus der Eurostat-Serie", ezAct.available && ezAct.value.startsWith("YoY") && ezAct.value.includes("2026-08") && ezAct.source.includes("EA20"), ezAct.value);
  check("Aktivität JP bleibt YoY der OECD-Serie 2026-04", jpAct.available && jpAct.value.includes("2026-04") && jpAct.source.includes("OECD") && !jpAct.value.includes("92.3"), jpAct.value);
}

console.log("\n=== ASHR-Vol aus denselben Schlüssen wie der Marktchart ===");
{
  const closes = Array.from({ length: 40 }, (_, index) => ({ date: day(index), close: 30 + (index % 3) }));
  const points = ashrRealizedVolPoints(closes);
  const direct = realizedVol20(closes);
  check("realizedVol20 liefert Punkte", direct.length > 0 && points.length > 0, String(points.length));
  check("Monatswerte sind die letzten realizedVol20-Drucke", points.every(point => direct.some(row => row.date === point.date && row.value === point.value)));
  const empty = ashrRealizedVolPoints([]);
  check("ohne Schlüsse keine erfundene Vol", empty.length === 0);
}

console.log("\n=== Schmale Kachel bricht die Notiz um ===");
{
  const ui = readFileSync("client/src/components/recession/RegionalCatalogSection.tsx", "utf8");
  check("Kachel darf schmaler werden als die Tabelle", ui.includes('className="min-w-0 rounded-md'));
  check("Notiz umbricht, das Gewicht bleibt sichtbar", ui.includes("break-words") && ui.includes("shrink-0"));
}

console.log(`\n${failed === 0 ? "OK" : "FAIL"} ${total - failed}/${total}`);
if (failed) process.exit(1);
