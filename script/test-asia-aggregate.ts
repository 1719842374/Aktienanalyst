/**
 * Offen_WORK_BUFFETT_ASIA_10Y §2 + Asia-Benchmark ^TPX.
 * Dritter Markt: China über ASHR (Philip). Nur Katalog-Anzeige.
 * US-Handlung, REGION_WEIGHT und Aktien-Score bleiben.
 * Run: npx tsx script/test-asia-aggregate.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { capeReading, scoreSeriesStress, vixReading } from "../server/recession";
import {
  emptyRegionalPrints,
  scoreRegionalCatalogs,
  type RegionalPrints,
  type RegionScorers,
} from "../server/recession-regions";
import {
  ASIA_GDP_USD,
  asiaGdpWeights,
  blendWeighted,
  bookProbability,
  catalogProbability,
  monthEndSeries,
  realizedVol20,
  regionGaugeView,
  type DatedPoint,
} from "../shared/recession-regions";
import * as regionsServer from "../server/recession-regions";

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

const TODAY = "2026-11-01";

function months(start: string, count: number, valueAt: (index: number) => number): DatedPoint[] {
  const [year, month] = start.split("-").map(Number);
  const points: DatedPoint[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(year, month - 1 + i, 1));
    points.push({
      date: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`,
      value: valueAt(i),
    });
  }
  return points;
}

function scorers(): RegionScorers {
  return {
    money: () => vixReading(NaN),
    credit: () => vixReading(NaN),
    vol: level => vixReading(level),
    valuation: ratio => capeReading(ratio),
    activity: () => ({ rawScore: 0, zone: "n/a" }),
    curve: (levels, stressWhenLow) => {
      const scored = scoreSeriesStress(stressWhenLow ? levels.map(value => -value) : levels);
      return { available: scored.available, raw: scored.raw };
    },
  };
}

function prints(partial: Partial<RegionalPrints> = {}): RegionalPrints {
  return { ...emptyRegionalPrints(), ...partial };
}

function score(partial: Partial<RegionalPrints> = {}, usRecession12m = 40, usCorrection12m = 35) {
  return scoreRegionalCatalogs({
    prints: prints(partial),
    usSlots: [],
    usRecession12m,
    usCorrection12m,
    today: TODAY,
    scorers: scorers(),
  });
}

function asiaOf(partial: Partial<RegionalPrints> = {}) {
  return score(partial).regions.find(region => region.id === "JP")!;
}

const volHistory = months("2023-01", 36, index => (index === 35 ? 80 : 18));

console.log("\n=== §2 Asien = Japan + China (ASHR), Anzeige ===");
{
  const named = asiaGdpWeights({
    jp: { gdpUsd: 4, source: `FRED ${ASIA_GDP_USD.JP} 2025` },
    cn: { gdpUsd: 16, source: `FRED ${ASIA_GDP_USD.CN} 2025` },
  });
  check("BIP-Serien sind benannt, kein festes 1/1", ASIA_GDP_USD.JP === "MKTGDPJPA646NWDB" && ASIA_GDP_USD.CN === "MKTGDPCNA646NWDB" && named.jp.weight === 0.2 && named.cn.weight === 0.8);
  const missing = asiaGdpWeights({
    jp: { gdpUsd: 4, source: `FRED ${ASIA_GDP_USD.JP} 2025` },
    cn: { gdpUsd: null, source: `n/a — FRED ${ASIA_GDP_USD.CN} leer` },
  });
  check("fehlendes China-BIP ist n/a, Japan wird auf 1 normiert", missing.cn.weight == null && missing.jp.weight === 1 && missing.text.includes("n/a") && missing.text.includes("normiert"));
  const none = asiaGdpWeights({
    jp: { gdpUsd: null, source: `n/a — FRED ${ASIA_GDP_USD.JP} leer` },
    cn: { gdpUsd: 0, source: `n/a — FRED ${ASIA_GDP_USD.CN} leer` },
  });
  check("0 ist kein BIP-Anteil", none.jp.weight == null && none.cn.weight == null && none.text.includes("n/a"));
  const empty = asiaOf();
  check("Label ist Asien", empty.label === "Asien", empty.label);
  check("Gewicht der Region bleibt 0.10", empty.weight === 0.1);
  const chinaVol = empty.slots.find(slot => slot.name === "Vol China (ASHR)");
  const chinaPe = empty.slots.find(slot => slot.name === "KGV China (ASHR)");
  check("leere ASHR-Vol ist ein Slot", chinaVol != null);
  check(
    "leere ASHR-Vol ist n/a mit Grund, ohne Score",
    !!chinaVol && !chinaVol.available && chinaVol.maxWeighted === 0 && chinaVol.weightedScore === 0 && chinaVol.value.startsWith("n/a —") && !/^0([.,]0)?%/.test(chinaVol.value),
    chinaVol?.value,
  );
  check(
    "leeres ASHR-KGV ist n/a mit Grund",
    !!chinaPe && !chinaPe.available && chinaPe.maxWeighted === 0 && chinaPe.value.startsWith("n/a —"),
    chinaPe?.value,
  );
  check("Japan-JNVI bleibt geschlossen", empty.slots.find(slot => slot.name === "JNVI")?.available === false);
  check("Hinweis nennt ASHR, ^TPX und n/a ohne festes 1/1", (empty.note ?? "").includes("ASHR") && (empty.note ?? "").includes("^TPX") && (empty.note ?? "").includes("n/a") && !(empty.note ?? "").includes("1/1"), empty.note);

  const quiet = score();
  const withChina = score({ cnVolPoints: volHistory, cnVolSource: "Yahoo ASHR, realisierte Vol 20T annualisiert" });
  const asia = withChina.regions.find(region => region.id === "JP")!;
  const scoredVol = asia.slots.find(slot => slot.name === "Vol China (ASHR)")!;
  check("hohe eigene Vol wird gewertet", scoredVol.available && scoredVol.weightedScore !== 0 && scoredVol.maxWeighted === 4, `${scoredVol.weightedScore} ${scoredVol.zone}`);
  check("Zone kommt aus der eigenen Historie (s(z))", scoredVol.zone.includes("s(z)"), scoredVol.zone);
  check("US-Katalog bleibt leer und ohne China", withChina.regions.find(r => r.id === "US")!.slots.length === 0);
  const ezNames = (catalog: ReturnType<typeof score>, id: "EZ") => catalog.regions.find(r => r.id === id)!.slots.map(s => `${s.name}:${s.available}:${s.weightedScore}`).join("|");
  check("Europa-Slots unverändert, wenn China Daten hat", ezNames(quiet, "EZ") === ezNames(withChina, "EZ"));
  check("Handlung bleibt auf den US-Büchern", withChina.actionUsesUsBooks === true);
  check("Regionsgewichte bleiben 0.70 / 0.20 / 0.10", withChina.weights.US === 0.7 && withChina.weights.EZ === 0.2 && withChina.weights.JP === 0.1);

  check("ohne BIP bleibt die Katalog-P n/a, der Vol-Slot bleibt gewertet", asia.correctionProbability == null && scoredVol.available, String(asia.correctionProbability));
  const view = regionGaugeView(withChina, "JP")!;
  check("Gauge liest die aggregierte P", view.label === "Asien" && view.correctionProbability === asia.correctionProbability);
  check("Top-Treiber enthalten die China-Vol", view.topDrivers.some(slot => slot.name === "Vol China (ASHR)"));

  const short = asiaOf({ cnVolPoints: volHistory.slice(0, 3), cnVolSource: "Yahoo ASHR, realisierte Vol 20T annualisiert" });
  const shortVol = short.slots.find(slot => slot.name === "Vol China (ASHR)")!;
  check("kurze ASHR-Historie bleibt n/a und zählt nicht", !shortVol.available && shortVol.maxWeighted === 0 && shortVol.value.startsWith("n/a —"), shortVol.value);
  check("kurze Historie ändert die leere Korrektur-P nicht", short.correctionProbability == null);

  const gdpPrints = {
    jpPe: 28,
    jpPeSource: "FMP ^TPX PE TTM",
    cnVolPoints: volHistory,
    cnVolSource: "Yahoo ASHR, realisierte Vol 20T annualisiert",
    ezPe: 28,
    ezPeSource: "FMP ^STOXX PE TTM",
    jpGdpUsd: 4,
    cnGdpUsd: 16,
    jpGdpSource: `FRED ${ASIA_GDP_USD.JP} 2025`,
    cnGdpSource: `FRED ${ASIA_GDP_USD.CN} 2025`,
  };
  const both = score(gdpPrints);
  const bothAsia = both.regions.find(region => region.id === "JP")!;
  const bothJp = bothAsia.slots.filter(slot => !slot.name.includes("China"));
  const bothCn = bothAsia.slots.filter(slot => slot.name.includes("China"));
  const weights = asiaGdpWeights({
    jp: { gdpUsd: 4, source: gdpPrints.jpGdpSource },
    cn: { gdpUsd: 16, source: gdpPrints.cnGdpSource },
  });
  const bothPeer = blendWeighted([
    { weight: weights.jp.weight ?? Number.NaN, probability: catalogProbability(bothJp, "correction") },
    { weight: weights.cn.weight ?? Number.NaN, probability: catalogProbability(bothCn, "correction") },
  ]);
  const equalPeer = blendWeighted([
    { weight: 1, probability: catalogProbability(bothJp, "correction") },
    { weight: 1, probability: catalogProbability(bothCn, "correction") },
  ]);
  check(
    "BIP-Anteil mischt ^TPX und ASHR, nicht 1/1 und nicht die Zeilensumme",
    bothAsia.correctionProbability === bothPeer && bothPeer !== equalPeer && bothAsia.correctionProbability !== catalogProbability(bothAsia.slots, "correction"),
    `${bothAsia.correctionProbability} vs ${bothPeer} vs gleich ${equalPeer}`,
  );
  const equalBlend = blendWeighted([
    { weight: 0.7, probability: 35 },
    { weight: 0.2, probability: both.regions.find(r => r.id === "EZ")!.correctionProbability },
    { weight: 0.1, probability: equalPeer },
  ]);
  console.log(`  ℹ️  Vorher/Nachher Korrektur: Asien ${equalPeer} → ${bothAsia.correctionProbability}; Blend ${equalBlend} → ${both.blendedCorrection12m}`);
  console.log(`  ℹ️  US-Slots ${both.regions.find(r => r.id === "US")!.slots.length}, EZ-Korr ${both.regions.find(r => r.id === "EZ")!.correctionProbability}`);
  check("US-Katalog und EZ-Korrektur bleiben bei der BIP-Mischung", both.regions.find(r => r.id === "US")!.slots.length === 0 && both.regions.find(r => r.id === "EZ")!.correctionProbability === catalogProbability(both.regions.find(r => r.id === "EZ")!.slots, "correction"));
  const tpx = bothAsia.slots.find(slot => slot.name === "TOPIX/CAPE JP")!;
  check("^TPX-Quelle bleibt am Japan-Slot", tpx.available && tpx.source === "FMP ^TPX PE TTM" && tpx.rawScore === capeReading(28).rawScore);

  const usIn = 40;
  const usCorr = 35;
  check(
    "Blend nutzt die US-Eingangs-P und die aggregierte Asien-P",
    both.blendedRecession12m === blendWeighted([
      { weight: 0.7, probability: usIn },
      { weight: 0.2, probability: both.regions.find(r => r.id === "EZ")!.recessionProbability },
      { weight: 0.1, probability: bothAsia.recessionProbability },
    ]) && both.blendedCorrection12m === blendWeighted([
      { weight: 0.7, probability: usCorr },
      { weight: 0.2, probability: both.regions.find(r => r.id === "EZ")!.correctionProbability },
      { weight: 0.1, probability: bothAsia.correctionProbability },
    ]),
  );
  check("bookProbability bleibt die bestehende Rundung", bookProbability(0, 12.6) === 50);
  check("Notiz nennt den BIP-Anteil", (bothAsia.note ?? "").includes("BIP-Anteil") && (bothAsia.note ?? "").includes("20,0 %") && (bothAsia.note ?? "").includes("80,0 %"), bothAsia.note);
  const onlyJp = score({ ...gdpPrints, cnGdpUsd: null, cnGdpSource: `n/a — FRED ${ASIA_GDP_USD.CN} leer` });
  const onlyAsia = onlyJp.regions.find(region => region.id === "JP")!;
  check(
    "fehlendes China-BIP lässt die China-Vol aus der P, Japan bleibt",
    onlyAsia.correctionProbability === catalogProbability(onlyAsia.slots.filter(slot => !slot.name.includes("China")), "correction")
      && (onlyAsia.note ?? "").includes("Gewicht China n/a")
      && (onlyAsia.note ?? "").includes("normiert"),
    `${onlyAsia.correctionProbability} ${onlyAsia.note}`,
  );
  check("EZ-P ändert sich durch das fehlende China-BIP nicht", onlyJp.regions.find(r => r.id === "EZ")!.correctionProbability === both.regions.find(r => r.id === "EZ")!.correctionProbability);
}

console.log("\n=== ^TPX und ASHR-KGV: echter Druck oder n/a — Grund ===");
{
  const pick = (regionsServer as { pickIndexPe?: Function }).pickIndexPe;
  check("pickIndexPe ist exportiert", typeof pick === "function");
  if (typeof pick === "function") {
    const fmp = pick({ fmp: { value: 14.2, source: "FMP ^TPX PE TTM" }, yahoo: null, symbol: "^TPX", today: TODAY });
    check("FMP ^TPX gewinnt vor Yahoo", fmp.value === 14.2 && fmp.source === "FMP ^TPX PE TTM");
    const yahoo = pick({
      fmp: null,
      yahoo: { pe: 16.5, status: "ok", httpStatus: 200, epsAsOf: "2026-09-30" },
      symbol: "^TPX",
      today: TODAY,
    });
    check("Yahoo ^TPX KGV wird übernommen", yahoo.value === 16.5 && yahoo.source.includes("^TPX") && yahoo.source.includes("2026-09-30"), yahoo.source);
    const stale = pick({
      fmp: null,
      yahoo: { pe: 16.5, status: "ok", httpStatus: 200, epsAsOf: "2020-01-15" },
      symbol: "^TPX",
      today: TODAY,
    });
    check("altes Yahoo-KGV ist n/a, kein erfundener Wert", stale.value == null && stale.source.startsWith("n/a —") && !stale.source.includes("16.5"), stale.source);
    const none = pick({ fmp: null, yahoo: { pe: null, status: "no_data", httpStatus: 200, epsAsOf: null }, symbol: "^TPX", today: TODAY });
    check("ohne FMP und ohne Yahoo: n/a — Grund", none.value == null && none.source.startsWith("n/a —") && none.source.includes("no_data"), none.source);
    const bogus = pick({ fmp: { value: 0, source: "FMP ^TPX PE TTM" }, yahoo: null, symbol: "^TPX", today: TODAY });
    check("PE 0 ist kein Druck", bogus.value == null && bogus.source.startsWith("n/a —"), bogus.source);
  }
}

console.log("\n=== ASHR realisierte Vol, Monatswerte ===");
{
  const flat = Array.from({ length: 40 }, (_, i) => ({ date: `2024-01-${String((i % 27) + 1).padStart(2, "0")}`, close: 30 }));
  const series = realizedVol20(flat.map((bar, i) => ({ date: `2024-03-${String(i + 1).padStart(2, "0")}`, close: bar.close })));
  check("flacher Kurs hat eine Vol von 0, das ist gerechnet", series.length > 0 && series.every(point => point.value === 0), String(series.length));
  const wave = Array.from({ length: 30 }, (_, i) => ({ date: `2024-06-${String(i + 1).padStart(2, "0")}`, close: 20 + (i % 2 === 0 ? 1 : 0) }));
  const waved = realizedVol20(wave);
  check("schwankender Kurs hat positive Vol", waved.length > 0 && waved.at(-1)!.value > 0, String(waved.at(-1)?.value));
  const monthly = monthEndSeries([
    { date: "2024-01-02", value: 10 },
    { date: "2024-01-31", value: 12 },
    { date: "2024-02-03", value: 11 },
  ]);
  check("Monatsserie behält den letzten Druck", monthly.length === 2 && monthly[0].value === 12 && monthly[1].value === 11, JSON.stringify(monthly));
}

console.log("\n=== UI-Kette: Button, Hinweis, Blend-Beschriftung ===");
{
  const gauge = readFileSync("client/src/components/recession/RegionGaugeSwitch.tsx", "utf8");
  const catalog = readFileSync("client/src/components/recession/RegionalCatalogSection.tsx", "utf8");
  const hook = readFileSync("client/src/hooks/useRecessionCatalog.ts", "utf8");
  const dashboard = readFileSync("client/src/pages/RecessionDashboard.tsx", "utf8");
  check("Button heißt Asien", gauge.includes('label: "Asien"') && !gauge.includes("Asien (Japan)"));
  check("Gauge zeigt die Server-Notiz", gauge.includes("region-view-note") && gauge.includes("view.note"));
  check("Katalog zeigt die Notiz und Asien im Blend", catalog.includes("catalog-note-") && catalog.includes("Asien"));
  check("Hook liest regions aus dem POST-Payload", hook.includes("data?.regions"));
  check("Dashboard hängt den Katalog an den einen POST", dashboard.includes('apiRequest("POST", "/api/analyze-recession"') && dashboard.includes("useRecessionCatalog"));
  check("Buffett-Panel bleibt auf der Rezessionsseite", dashboard.includes("<BuffettRatioPanel"));
  const stock = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
  check("Aktienanalyse mountet keine Buffett-Karte", !stock.includes("BuffettMacroCard"));
}

console.log("\n=== Aktien-Score unverändert (Fixture-Pin) ===");
{
  const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
  check("VOW3 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718", String(pin.VWAGY.overallScore));
  check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758", String(pin.SAP.overallScore));
  check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138", String(pin.MSFT.overallScore));
  const { buildBiasDecision } = await import("../shared/bias-fixes");
  const msft = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
  const before = buildBiasDecision(msft);
  const after = buildBiasDecision({ ...msft, regions: score({ cnVolPoints: volHistory }) });
  check("MSFT-Fixture: Asien-Katalog ändert overallScore nicht", before.overallScore === after.overallScore && before.overallRating === after.overallRating, `${before.overallScore}`);
  console.log(`  ℹ️  MSFT-Analysefixture buildBiasDecision ${before.overallScore} (${before.overallRating}), unverändert mit Asien-Katalog`);
  console.log("  ℹ️  VOW3/SAP/MSFT-Pin steht in expectOldHead; die Route prüft script/test-shel-gbp-paths.ts");
}

console.log(`\n${failed === 0 ? "OK" : "FAIL"} ${total - failed}/${total}`);
if (failed) process.exit(1);
