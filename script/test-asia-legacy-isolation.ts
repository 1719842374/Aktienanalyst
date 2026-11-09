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
  catalogUnemploymentFromRegional,
  ashrPeFromProbes,
  ashrPriceSource,
  ashrRealizedVolPoints,
  bounded,
  emptyRegionalPrints,
  eurostatAttemptPlan,
  eurostatStep,
  jpActivitySource,
  loadAshrCloses,
  oecdAttemptPlan,
  runAsiaSupplement,
  scoreRegionalCatalogs,
  ASIA_FMP_TIMEOUT_MS,
  EUROSTAT_RETRY_MS,
  OECD_RETRY_MS,
  type RegionScorers,
} from "../server/recession-regions";
import { fetchYahooTimeseriesFundamentals } from "../server/yahoo-fetcher";
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
  const end = src.indexOf("export function applyAsiaSupplement");
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
  check("fetchRegionalPrints hängt den Nachzug erst nach dem Legacy-Abruf an", /const legacy = await fetchLegacyRegionalPrints\(today, ezUnemployment\);[\s\S]*runAsiaSupplement\(today\)/.test(src));
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

  const emptyEa20 = emptyRegionalPrints();
  emptyEa20.ezUnemployment = { geo: "EA20", points: [] };
  emptyEa20.ezIp = { geo: "EA20", points: [{ date: "2025-08-01", value: 100 }, { date: "2026-08-01", value: 98.9 }] };
  const shared = catalogUnemploymentFromRegional({
    geo: "EA21",
    rows: Array.from({ length: 20 }, (_, index) => ({ date: day(index), value: 6 })),
  });
  const filled = scoreRegionalCatalogs({
    prints: emptyEa20,
    ezUnemployment: shared,
    usSlots: [],
    usRecession12m: 35,
    usCorrection12m: 80,
    today: "2026-11-09",
    scorers: scorers(),
  });
  const labor = filled.regions.find(region => region.id === "EZ")!.slots.find(slot => slot.id === "labor")!;
  const activity = filled.regions.find(region => region.id === "EZ")!.slots.find(slot => slot.name === "Aktivität EZ")!;
  check(
    "EA20 leer wird im Slot zu EA21",
    labor.available === true && labor.value === "+0.00 pp" && labor.source === "Eurostat une_rt_m EA21 (EA20 ohne Werte)" && activity.source.includes("EA20"),
    `${labor.available} ${labor.value} ${labor.source}`,
  );
  const occupied = scoreRegionalCatalogs({
    prints: withGdp,
    ezUnemployment: shared,
    usSlots: [],
    usRecession12m: 40,
    usCorrection12m: 35,
    today: "2026-11-09",
    scorers: scorers(),
  });
  const keptLabor = occupied.regions.find(region => region.id === "EZ")!.slots.find(slot => slot.id === "labor")!;
  check("vorhandene ALQ-Punkte werden nicht durch EA21 ersetzt", keptLabor.source === "Eurostat une_rt_m EA21" && !keptLabor.source.includes("ohne Werte"));
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

console.log("\n=== FMP-Timeout erreicht Yahoo und bricht den ersten Abruf ab ===");
{
  const closes = Array.from({ length: 40 }, (_, index) => ({ date: day(index), value: 30 + (index % 3) }));
  let fmpAborted = false;
  const loaded = await loadAshrCloses("2020-01-01", {
    timeoutMs: 40,
    fmp: signal => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        fmpAborted = true;
        reject(new Error("aborted"));
      });
    }),
    yahoo: async () => closes,
  });
  check("hängendes FMP wird abgebrochen und Yahoo liefert die Schlüsse", fmpAborted && loaded.via === "yahoo" && loaded.reason === "ok" && loaded.closes.length === 40);
  const empty = await loadAshrCloses("2020-01-01", {
    timeoutMs: 50,
    fmp: async () => [],
    yahoo: async () => [],
  });
  check("beide leer bleibt leer und ist keine Zeitüberschreitung", empty.via === "none" && empty.reason === "empty");
  const slow = await loadAshrCloses("2020-01-01", {
    timeoutMs: 30,
    fmp: signal => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
    yahoo: signal => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
  });
  check("beide Zeitüberschreitungen heißen timeout, nicht leer", slow.reason === "timeout" && slow.via === "none");
  let sawAbort = false;
  const timed = await bounded(signal => new Promise<string>((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      sawAbort = true;
      reject(new Error("aborted"));
    });
  }), 30, "fallback");
  check("bounded bricht das Signal ab und gibt den Fallback", timed.timedOut && timed.value === "fallback" && sawAbort);
  const mixed = ashrPeFromProbes({
    fmp: null,
    yahoo: { pe: 12.5, status: "ok", httpStatus: 200, epsAsOf: "2026-09-30" },
    today: "2026-11-09",
    priceSource: "fmp",
  });
  check("FMP-Kurs plus Yahoo-EPS ist als Mischquelle benannt", mixed.value === 12.5 && mixed.source.includes("Kurs FMP") && mixed.source.includes("trailingDilutedEPS Yahoo"), mixed.source);
  const thrown = applyAsiaSupplement(emptyRegionalPrints(), null);
  check("ein geworfener Nachzug lässt die leeren Legacy-Felder stehen und setzt ASHR auf n/a", thrown.cnVolSource.startsWith("n/a —") && thrown.jpIpSource === "FRED JPNPROINDMISMEI");
  const src = readFileSync("server/recession-regions.ts", "utf8");
  check("leerer Katalog nennt FMP und Yahoo, nicht nur den alten Yahoo-Satz", src.includes("cnVolSource: \"n/a — ASHR ohne Tagesschlüsse für realisierte Vol 20T (FMP leer; Yahoo leer)\""));
  check("OECD leer oder HTML wird einmal kurz wiederholt, ein Timeout nicht", oecdAttemptPlan(null) === "use" && oecdAttemptPlan("leer") === "retry" && oecdAttemptPlan("HTML") === "retry" && oecdAttemptPlan("HTTP 503") === "retry" && oecdAttemptPlan("Timeout") === "stop" && OECD_RETRY_MS <= 8000);
  check("fällt OECD nach der Wiederholung aus, nennt die Quelle den Grund", jpActivitySource(false, 0, "empty") === "FRED JPNPROINDMISMEI; OECD nach Wiederholung leer oder HTML");
  check("ein OECD-Timeout heißt Zeitüberschreitung", jpActivitySource(false, 0, "timeout") === "FRED JPNPROINDMISMEI; OECD Zeitüberschreitung");
  check("ein OECD-HTTP-Fehler heißt nicht leer", jpActivitySource(false, 0, "http") === "FRED JPNPROINDMISMEI; OECD HTTP-Fehler");
  check("ältere OECD-Daten ohne zweite Abfrage heißen nicht Wiederholung", jpActivitySource(false, 3) === "FRED JPNPROINDMISMEI; OECD älter als FRED" && jpActivitySource(true, 3).includes("OECD"));
  check("EA20 wird bei leerer erster Antwort wiederholt, bevor EA21 kommt", eurostatStep(0, false) === "retry" && eurostatStep(0, true) === "next" && eurostatStep(2, false) === "use");
  check("ein 20s-Hänger von EA20 startet keine zweite Frist", eurostatAttemptPlan({ pointCount: 0, alreadyRetried: false, why: "Timeout", dataset: "sts_inpr_m", httpStatus: null, hasNext: true }) === "next");
  check("sts_inpr_m leer bleibt eine kurze Wiederholung", eurostatAttemptPlan({ pointCount: 0, alreadyRetried: false, why: "leer", dataset: "sts_inpr_m", httpStatus: 200, hasNext: true }) === "retry" && EUROSTAT_RETRY_MS <= 8000);
  check("une_rt_m EA20 mit 0 Werten geht direkt zu EA21", eurostatAttemptPlan({ pointCount: 0, alreadyRetried: false, why: null, dataset: "une_rt_m", httpStatus: 200, hasNext: true }) === "next");
  check("Eurostat loggt den Fallback-Grund", src.includes("Eurostat ${dataset} ${geo} nach Wiederholung"));
  check("ein Yahoo-Chart-Kurs trägt kein Kurs-FMP-Label", ashrPriceSource("yahoo", 30.5) == null && ashrPriceSource("fmp", 30.5) === "fmp");
  const yahooKurs = ashrPeFromProbes({
    fmp: null,
    yahoo: { pe: 11, status: "ok", httpStatus: 200, epsAsOf: "2026-09-30" },
    today: "2026-11-09",
    priceSource: ashrPriceSource("yahoo", 30.5),
  });
  check("Yahoo-via nennt den Kurs nicht FMP", yahooKurs.value === 11 && !yahooKurs.source.includes("Kurs FMP"), yahooKurs.source);
  const blockStart = Date.now();
  let blockAborted = false;
  const blocked = await runAsiaSupplement("2026-11-09", 40, (_cosd, deps) => new Promise(resolve => {
    deps.parent?.addEventListener("abort", () => {
      blockAborted = true;
      resolve({ closes: [], via: "none", reason: "timeout" });
    });
  }), {
    gdp: async id => ({ value: null, source: `n/a — FRED ${id} Zeitüberschreitung` }),
  });
  check(
    "der Asien-Block endet an der Gesamtfrist mit n/a Zeitüberschreitung",
    blockAborted && Date.now() - blockStart < 300 && blocked.cnVolSource.includes("Zeitüberschreitung") && blocked.cnPeSource.includes("Zeitüberschreitung"),
    `${Date.now() - blockStart}ms ${blocked.cnVolSource}`,
  );
  const keptCloses = Array.from({ length: 40 }, (_, index) => ({ date: day(index), close: 30 + (index % 3) }));
  const keptStart = Date.now();
  let ratiosAborted = false;
  const kept = await runAsiaSupplement("2026-11-09", 80, async () => ({ closes: keptCloses, via: "fmp", reason: "ok" }), {
    pe: (_today, _lastClose, signal) => new Promise(resolve => {
      const stop = () => {
        ratiosAborted = true;
        resolve({ value: null, source: "n/a — ASHR KGV Zeitüberschreitung" });
      };
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    }),
    gdp: async id => ({ value: id.includes("JPA") ? 4e12 : 16e12, source: `FRED ${id} 2024` }),
  });
  check(
    "ratios-ttm hängt, BIP bleibt",
    ratiosAborted
      && kept.jpGdpUsd === 4e12
      && kept.cnGdpUsd === 16e12
      && kept.jpGdpSource.includes("2024")
      && !kept.jpGdpSource.includes("Zeitüberschreitung")
      && !kept.cnGdpSource.includes("Zeitüberschreitung")
      && kept.cnVolPoints.length > 0
      && kept.cnVolSource.includes("FMP")
      && kept.cnPe == null
      && kept.cnPeSource.includes("Zeitüberschreitung")
      && Date.now() - keptStart < 500,
    `${Date.now() - keptStart}ms ${kept.jpGdpSource} vol=${kept.cnVolSource}`,
  );
  const ashrStart = Date.now();
  let ashrGdpCalls = 0;
  const ashrHung = await runAsiaSupplement("2026-11-09", 80, (_cosd, deps) => new Promise(resolve => {
    deps.parent?.addEventListener("abort", () => resolve({ closes: [], via: "none", reason: "timeout" }));
  }), {
    gdp: async id => {
      ashrGdpCalls += 1;
      return { value: id.includes("JPA") ? 4e12 : 16e12, source: `FRED ${id} 2024` };
    },
  });
  check(
    "ASHR hängt, BIP bleibt",
    ashrGdpCalls === 2
      && ashrHung.jpGdpUsd === 4e12
      && ashrHung.cnGdpUsd === 16e12
      && ashrHung.jpGdpSource.includes("2024")
      && !ashrHung.jpGdpSource.includes("Zeitüberschreitung")
      && !ashrHung.cnGdpSource.includes("Zeitüberschreitung")
      && ashrHung.cnVolSource.includes("Zeitüberschreitung")
      && Date.now() - ashrStart < 500,
    `${Date.now() - ashrStart}ms calls=${ashrGdpCalls} ${ashrHung.jpGdpSource} vol=${ashrHung.cnVolSource}`,
  );
  const yahooStart = Date.now();
  let yahooAt = -1;
  const yahooAfterFmp = await loadAshrCloses("2020-01-01", {
    fmpTimeoutMs: 40,
    timeoutMs: 2000,
    fmp: signal => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
    yahoo: async () => keptCloses.map(bar => ({ date: bar.date, value: bar.close })),
  });
  yahooAt = Date.now() - yahooStart;
  check(
    "FMP-Teilfrist lässt den Yahoo-Fallback vor der Blockfrist starten",
    yahooAfterFmp.via === "yahoo" && yahooAfterFmp.closes.length === 40 && yahooAt < 300 && ASIA_FMP_TIMEOUT_MS <= 5000,
    `${yahooAt}ms via=${yahooAfterFmp.via}`,
  );
  const aborted = new AbortController();
  aborted.abort();
  const chartStart = Date.now();
  const chart = await fetchYahooTimeseriesFundamentals("ASHR", { signal: aborted.signal });
  check("ein abgebrochenes ASHR-KGV startet die Yahoo-Chart-Meta nicht neu", Date.now() - chartStart < 300 && chart.status === "no_meta", `${Date.now() - chartStart}ms ${chart.status}`);
  const yahooSrc = readFileSync("server/yahoo-fetcher.ts", "utf8");
  check("die Chart-Meta bekommt das AbortSignal", yahooSrc.includes("fetchYahooChartMetaWithPrice(sym, opts.signal)") && yahooSrc.includes("if (opts.signal?.aborted) return value;"));
}

console.log("\n=== Recession-Seite hält unten Abstand zu den fixen Buttons ===");
{
  const page = readFileSync("client/src/pages/RecessionDashboard.tsx", "utf8");
  check("nur die Recession-Seite bekommt mehr unteren Abstand", page.includes("pb-28 sm:pb-0"));
}

console.log("\n=== Schmale Kachel bricht die Notiz um ===");
{
  const ui = readFileSync("client/src/components/recession/RegionalCatalogSection.tsx", "utf8");
  check("Kachel darf schmaler werden als die Tabelle", ui.includes('className="min-w-0 rounded-md'));
  check("Notiz umbricht, das Gewicht bleibt sichtbar", ui.includes("break-words") && ui.includes("shrink-0"));
}

console.log(`\n${failed === 0 ? "OK" : "FAIL"} ${total - failed}/${total}`);
if (failed) process.exit(1);
