/**
 * Lokale Vorbereitung §2: Japan+China über das bestehende BIP-Gewicht.
 * Produktionsfunktionen und UI-Render. Kein Netz, kein bezahlter Provider.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-asia-gdp-mix.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { capeReading, m2Reading, scoreSeriesStress, vixReading } from "../server/recession";
import {
  ashrPeFromProbes,
  emptyRegionalPrints,
  scoreRegionalCatalogs,
  type RegionalPrints,
  type RegionScorers,
} from "../server/recession-regions";
import {
  ASIA_GDP_USD,
  asiaGdpWeights,
  blendWeighted,
  regionGaugeView,
  type DatedPoint,
  type RegionSlot,
} from "../shared/recession-regions";
import { buildRecessionChatContext } from "../shared/chat-context";
import { RECESSION_FALLBACK_DATA } from "../client/src/lib/recessionFallbackData";
import { RegionalCatalogSection } from "../client/src/components/recession/RegionalCatalogSection";
import { RegionGaugeSwitch } from "../client/src/components/recession/RegionGaugeSwitch";

(globalThis as any).React = React;

const TODAY = "2026-11-08";
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
    money: yoy => m2Reading(yoy),
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

const volHistory = months("2023-01", 36, index => (index === 35 ? 80 : 18));
const JP_GDP = `FRED ${ASIA_GDP_USD.JP} 2025`;
const CN_GDP = `FRED ${ASIA_GDP_USD.CN} 2025`;
const CN_VOL = "Yahoo ASHR, realisierte Vol 20T annualisiert";

function prints(partial: Partial<RegionalPrints> = {}): RegionalPrints {
  return { ...emptyRegionalPrints(), ...partial };
}

const usSlot: RegionSlot = {
  id: "labor",
  name: "Sahm-Regel",
  book: "recession",
  value: "+0.10 pp",
  rawScore: -3,
  weight: 1,
  weightedScore: -3,
  maxWeighted: 4,
  zone: "<0.5pp",
  source: "FRED SAHMREALTIME",
  available: true,
};

function score(partial: Partial<RegionalPrints> = {}) {
  return scoreRegionalCatalogs({
    prints: prints({
      ezPe: 22,
      ezPeSource: "FMP ^STOXX PE TTM",
      ...partial,
    }),
    usSlots: [usSlot],
    usRecession12m: 40,
    usCorrection12m: 35,
    today: TODAY,
    scorers: scorers(),
  });
}

function side(catalog: ReturnType<typeof score>, id: "US" | "EZ" | "JP") {
  return catalog.regions.find(region => region.id === id)!;
}

function fingerprint(catalog: ReturnType<typeof score>, id: "US" | "EZ") {
  const region = side(catalog, id);
  return region.slots.map(slot => `${slot.name}|${slot.available}|${slot.value}|${slot.weightedScore}|${slot.maxWeighted}|${slot.zone}`).join("||");
}

const both = score({
  jpPe: 28,
  jpPeSource: "FMP ^TPX PE TTM",
  jpM2Yoy: 2,
  cnVolPoints: volHistory,
  cnVolSource: CN_VOL,
  cnPe: 14,
  cnPeSource: "FMP ASHR PE TTM",
  jpGdpUsd: 4,
  cnGdpUsd: 16,
  jpGdpSource: JP_GDP,
  cnGdpSource: CN_GDP,
});
const chinaGdpMissing = score({
  jpPe: 28,
  jpPeSource: "FMP ^TPX PE TTM",
  cnVolPoints: volHistory,
  cnVolSource: CN_VOL,
  cnPe: 14,
  cnPeSource: "FMP ASHR PE TTM",
  jpGdpUsd: 4,
  cnGdpUsd: null,
  jpGdpSource: JP_GDP,
  cnGdpSource: `n/a — FRED ${ASIA_GDP_USD.CN} leer`,
});
const japanGdpMissing = score({
  jpPe: 28,
  jpPeSource: "FMP ^TPX PE TTM",
  cnVolPoints: volHistory,
  cnVolSource: CN_VOL,
  cnPe: 14,
  cnPeSource: "FMP ASHR PE TTM",
  jpGdpUsd: null,
  cnGdpUsd: 16,
  jpGdpSource: `n/a — FRED ${ASIA_GDP_USD.JP} leer`,
  cnGdpSource: CN_GDP,
});
const slotsMissingGdpPresent = score({
  jpPe: 28,
  jpPeSource: "FMP ^TPX PE TTM",
  jpGdpUsd: 4,
  cnGdpUsd: 16,
  jpGdpSource: JP_GDP,
  cnGdpSource: CN_GDP,
});
const gdpMissingSlotsPresent = score({
  jpPe: 28,
  jpPeSource: "FMP ^TPX PE TTM",
  cnVolPoints: volHistory,
  cnVolSource: CN_VOL,
  cnPe: 14,
  cnPeSource: "FMP ASHR PE TTM",
});
const bothMissing = score();
const shortVol = score({
  jpGdpUsd: 4,
  cnGdpUsd: 16,
  jpGdpSource: JP_GDP,
  cnGdpSource: CN_GDP,
  cnVolPoints: volHistory.slice(0, 3),
  cnVolSource: CN_VOL,
  jpPe: 28,
  jpPeSource: "FMP ^TPX PE TTM",
});

console.log("\n=== Produktionskatalog, BIP 4 zu 16 ===");
{
  const asia = side(both, "JP");
  const weights = asiaGdpWeights({
    jp: { gdpUsd: 4, source: JP_GDP },
    cn: { gdpUsd: 16, source: CN_GDP },
  });
  check("Serien sind die bestehenden Weltbank-FRED-IDs", ASIA_GDP_USD.JP === "MKTGDPJPA646NWDB" && ASIA_GDP_USD.CN === "MKTGDPCNA646NWDB");
  check("4 zu 16 ist 20/80, kein 1/1", weights.jp.weight === 0.2 && weights.cn.weight === 0.8);
  check("Label Asien, interne ID bleibt JP, Regionsgewicht 0.10", asia.label === "Asien" && asia.id === "JP" && asia.weight === 0.1);
  check("Notiz nennt 20,0 % und 80,0 %", (asia.note ?? "").includes("20,0 %") && (asia.note ?? "").includes("80,0 %"), asia.note);
  const vol = asia.slots.find(slot => slot.name === "Vol China (ASHR)")!;
  const pe = asia.slots.find(slot => slot.name === "KGV China (ASHR)")!;
  const tpx = asia.slots.find(slot => slot.name === "TOPIX/CAPE JP")!;
  check("China-Vol bleibt gewertet und trägt den Monat", vol.available && vol.value.includes("20T") && /\d{4}-\d{2}/.test(vol.value) && vol.source === CN_VOL, vol.value);
  check("China-KGV bleibt die übergebene FMP-Quelle", pe.available && pe.source === "FMP ASHR PE TTM" && pe.value === "14.0", pe.value);
  check("TOPIX-Quelle unverändert am Japan-Slot", tpx.available && tpx.source === "FMP ^TPX PE TTM" && tpx.rawScore === capeReading(28).rawScore);
  check("Rezession: China hat keinen Rezessions-Slot und steht nicht in der P", (asia.note ?? "").includes("Rezession: China nicht in der Katalog-P."));
  check("Korrektur: beide Seiten stehen in der Notiz", (asia.note ?? "").includes("Korrektur: Japan und China in der Katalog-P."));
  const view = regionGaugeView(both, "JP")!;
  check("Gauge-P ist die Katalog-P", view.recessionProbability === asia.recessionProbability && view.correctionProbability === asia.correctionProbability);
  check("Top-3 sind gewertete Slots dieser P", view.topDrivers.every(slot => asia.slots.some(item => item.name === slot.name && item.available && item.weightedScore !== 0)));
  check("China-Vol ist Treiber, weil die Korrektur-Seite beiträgt", view.topDrivers.some(slot => slot.name === "Vol China (ASHR)"));
  check("Coverage zählt nur verfügbare Slots", view.scoredSlots === asia.slots.filter(slot => slot.available).length && view.totalSlots === asia.slots.length);
  check(
    "Regionsblend nutzt die Produktions-P und die alten Gewichte",
    both.blendedRecession12m === blendWeighted([
      { weight: 0.7, probability: 40 },
      { weight: 0.2, probability: side(both, "EZ").recessionProbability },
      { weight: 0.1, probability: asia.recessionProbability },
    ]) && both.blendedCorrection12m === blendWeighted([
      { weight: 0.7, probability: 35 },
      { weight: 0.2, probability: side(both, "EZ").correctionProbability },
      { weight: 0.1, probability: asia.correctionProbability },
    ]),
  );
  console.log(`  ℹ️  Katalog Rez ${asia.recessionProbability} Korr ${asia.correctionProbability} Blend ${both.blendedRecession12m}/${both.blendedCorrection12m}`);
  console.log(`  ℹ️  Top ${view.topDrivers.map(slot => slot.name).join(", ")}`);
}

console.log("\n=== fehlende Seite, Slots ohne BIP, beides fehlend ===");
{
  const missing = side(chinaGdpMissing, "JP");
  const vol = missing.slots.find(slot => slot.name === "Vol China (ASHR)")!;
  const view = regionGaugeView(chinaGdpMissing, "JP")!;
  check("fehlendes China-BIP normiert Japan auf 100 % und nennt n/a einmal", (missing.note ?? "").includes("Gewicht China n/a — FRED") && (missing.note ?? "").includes("100 %") && !(missing.note ?? "").includes("n/a — n/a"), missing.note);
  check("China-Vol bleibt als Druck sichtbar, zählt nicht in der P", !vol.available && vol.maxWeighted === 0 && vol.zone === "nicht in der Katalog-P" && vol.value.includes("20T"), vol.value);
  check("Top-3 enthält die nicht beitragende China-Vol nicht", !view.topDrivers.some(slot => slot.name === "Vol China (ASHR)"));
  check("Korrektur-P bei fehlendem China-BIP ist die Japan-Seite", missing.correctionProbability === side(slotsMissingGdpPresent, "JP").correctionProbability, String(missing.correctionProbability));
  check("4-zu-16-Korrektur unterscheidet sich von der Japan-100%-Korrektur", side(both, "JP").correctionProbability !== missing.correctionProbability, `${side(both, "JP").correctionProbability} vs ${missing.correctionProbability}`);

  const onlyCn = side(japanGdpMissing, "JP");
  const onlyView = regionGaugeView(japanGdpMissing, "JP")!;
  const tpx = onlyCn.slots.find(slot => slot.name === "TOPIX/CAPE JP")!;
  check("fehlendes Japan-BIP normiert China auf 100 %", (onlyCn.note ?? "").includes("Gewicht Japan n/a — FRED") && (onlyCn.note ?? "").includes("100 %") && !(onlyCn.note ?? "").includes("n/a — n/a"), onlyCn.note);
  check("TOPIX bleibt sichtbar und ist nicht Treiber, China-Vol ist Treiber", !tpx.available && tpx.zone === "nicht in der Katalog-P" && onlyView.topDrivers.some(slot => slot.name === "Vol China (ASHR)") && !onlyView.topDrivers.some(slot => slot.name === "TOPIX/CAPE JP"));
  check("Rezession ohne Japan-Gewicht ist n/a", onlyCn.recessionProbability == null);

  const noSlots = side(slotsMissingGdpPresent, "JP");
  const noVol = noSlots.slots.find(slot => slot.name === "Vol China (ASHR)")!;
  check("BIP da, China-Druck fehlt: n/a mit Grund, nicht in der Korrektur-P", !noVol.available && noVol.value.startsWith("n/a —") && (noSlots.note ?? "").includes("Korrektur: China nicht in der Katalog-P."), noVol.value);
  check("Notiz behält den BIP-Anteil, obwohl China keine Slots hat", (noSlots.note ?? "").includes("20,0 %") && (noSlots.note ?? "").includes("80,0 %"), noSlots.note);

  const none = side(gdpMissingSlotsPresent, "JP");
  check("beide BIP fehlen: beide Gewichte n/a, Katalog-P n/a", none.recessionProbability == null && none.correctionProbability == null && (none.note ?? "").includes("Gewicht Japan n/a —") && (none.note ?? "").includes("Gewicht China n/a —") && !(none.note ?? "").includes("n/a — n/a"), none.note);
  check("gewertete Drucke ohne BIP sind keine Top-Treiber", regionGaugeView(gdpMissingSlotsPresent, "JP")!.topDrivers.length === 0);

  const empty = side(bothMissing, "JP");
  check("leere Drucke und leeres BIP: China-Slots n/a, kein erfundener Wert", empty.slots.filter(slot => slot.name.includes("China")).every(slot => !slot.available && slot.maxWeighted === 0 && slot.value.startsWith("n/a —")));
  const short = side(shortVol, "JP").slots.find(slot => slot.name === "Vol China (ASHR)")!;
  check("kurze ASHR-Historie bleibt n/a und ungewertet", !short.available && short.maxWeighted === 0 && short.value.startsWith("n/a —") && short.value.includes("Monate"), short.value);
}

console.log("\n=== US und Eurozone unverändert ===");
{
  const catalogs = [both, chinaGdpMissing, japanGdpMissing, slotsMissingGdpPresent, gdpMissingSlotsPresent, bothMissing, shortVol];
  const us0 = fingerprint(both, "US");
  const ez0 = fingerprint(both, "EZ");
  check("US-Fingerabdruck gleich in allen Fällen", catalogs.every(catalog => fingerprint(catalog, "US") === us0));
  check("Eurozone-Fingerabdruck gleich in allen Fällen", catalogs.every(catalog => fingerprint(catalog, "EZ") === ez0));
  check("Gewichte bleiben 0.70 / 0.20 / 0.10 und die Handlung auf den US-Büchern", catalogs.every(catalog => catalog.weights.US === 0.7 && catalog.weights.EZ === 0.2 && catalog.weights.JP === 0.1 && catalog.actionUsesUsBooks === true));
  check("US-Slot ist weiterhin die Sahm-Zeile", side(both, "US").slots.length === 1 && side(both, "US").slots[0].name === "Sahm-Regel" && side(both, "US").slots[0].weightedScore === -3);
  check("Eurozone-KGV bleibt 22.0 aus der Fixture", side(both, "EZ").slots.find(slot => slot.name === "STOXX 600 PE")!.value === "22.0");
}

console.log("\n=== ASHR-KGV: echter Druck oder n/a, TOPIX unangetastet ===");
{
  const fmp = ashrPeFromProbes({ fmp: { value: 14.2, source: "FMP ASHR PE TTM" }, yahoo: null, today: TODAY });
  check("FMP ASHR gewinnt", fmp.value === 14.2 && fmp.source === "FMP ASHR PE TTM");
  const yahoo = ashrPeFromProbes({
    fmp: null,
    yahoo: { pe: 16.5, status: "ok", httpStatus: 200, epsAsOf: "2026-09-30" },
    today: TODAY,
  });
  check("Yahoo ASHR übernimmt Datum und Wert", yahoo.value === 16.5 && yahoo.source.includes("2026-09-30"), yahoo.source);
  const stale = ashrPeFromProbes({
    fmp: null,
    yahoo: { pe: 16.5, status: "ok", httpStatus: 200, epsAsOf: "2020-01-15" },
    today: TODAY,
  });
  check("altes Yahoo-KGV ist n/a und enthält den Wert nicht", stale.value == null && stale.source.startsWith("n/a —") && !stale.source.includes("16.5"), stale.source);
  const none = ashrPeFromProbes({ fmp: null, yahoo: { pe: null, status: "no_data", httpStatus: 200, epsAsOf: null }, today: TODAY });
  check("ohne Druck: n/a mit Grund", none.value == null && none.source.startsWith("n/a —") && none.source.includes("no_data"), none.source);
  const zero = ashrPeFromProbes({ fmp: { value: 0, source: "FMP ASHR PE TTM" }, yahoo: null, today: TODAY });
  check("KGV 0 ist kein Druck", zero.value == null && zero.source.startsWith("n/a —"), zero.source);
  const src = readFileSync("server/recession-regions.ts", "utf8");
  const topix = src.slice(src.indexOf("async function topixPe"), src.indexOf("export interface AshrPeProbe"));
  check("TOPIX bleibt FMP indexPe, ohne Yahoo", topix.includes("indexPe([\"^TPX\", \"1306.T\"])") && !topix.includes("Yahoo") && !topix.includes("ashrPe"));
}

console.log("\n=== Response, Kachel, Chat ===");
{
  const asia = side(both, "JP");
  const html = renderToStaticMarkup(React.createElement(RegionalCatalogSection, { catalogs: both }));
  check("Kachel zeigt Asien, die Produktions-Korrektur und die Notiz", html.includes("Asien") && html.includes(`${asia.correctionProbability}%`) && html.includes("20,0 %") && html.includes("80,0 %") && html.includes("Vol China (ASHR)"));
  check("Blend-Text sagt Asien 0.10", html.includes("US 0.70 / EZ 0.20 / Asien 0.10"));
  const demotedHtml = renderToStaticMarkup(React.createElement(RegionalCatalogSection, { catalogs: chinaGdpMissing }));
  check("Kachel der fehlenden Seite zeigt den Druck und die Zone außerhalb der P", demotedHtml.includes("nicht in der Katalog-P") && demotedHtml.includes("20T") && demotedHtml.includes("Gewicht China n/a"));
  const chat = buildRecessionChatContext(RECESSION_FALLBACK_DATA, { hasRegions: true, regions: both });
  const facts = chat.sections.find(section => section.key === "regionen")?.facts as Record<string, unknown>;
  check("Chat-Label ist Asien und die Korrektur-P stimmt mit der Kachel", String(facts.region_JP).startsWith("Asien:") && String(facts.region_JP).includes(`Katalog Korr. ${asia.correctionProbability}%`));
  check("Chat-Gewichte sagen Asien 0.10", facts.gewichte === "US 0.70 / EZ 0.20 / Asien 0.10");
  check("Chat-Slot enthält den China-Vol-Wert aus dem Katalog", String(facts.slots_JP).includes("Vol China (ASHR)") && String(facts.slots_JP).includes(asia.slots.find(slot => slot.name === "Vol China (ASHR)")!.value));
  const gaugeHtml = renderToStaticMarkup(React.createElement(RegionGaugeSwitch, { data: RECESSION_FALLBACK_DATA as any, regions: both }));
  check("Gauge-Button heißt Asien", gaugeHtml.includes("Asien") && !gaugeHtml.includes("Asien (Japan)"));
  const gaugeSrc = readFileSync("client/src/components/recession/RegionGaugeSwitch.tsx", "utf8");
  const page = readFileSync("client/src/pages/RecessionDashboard.tsx", "utf8");
  check("Gauge bindet Notiz und Top-3 an die Server-Sicht", gaugeSrc.includes("region-view-note") && gaugeSrc.includes("view.topDrivers") && gaugeSrc.includes('label: "Asien"'));
  check("Sektion 8 heißt Asien und hängt am bestehenden POST", page.includes("Regionale Kataloge (US / Eurozone / Asien)") && page.includes('apiRequest("POST", "/api/analyze-recession"') && page.includes("useRecessionCatalog"));
  console.log("  ℹ️  SSR zeigt den Button und die Kachel. Kein Klick, kein Browser, kein Live-PASS.");
}

console.log(`\n${failed === 0 ? "OK" : "FAIL"} ${total - failed}/${total}`);
if (failed) process.exit(1);
