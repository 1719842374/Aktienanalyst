/**
 * Vorher/Nachher für den Rezessions-Score.
 * Vorher = Zonentabelle buffettReading auf derselben Quote.
 * Nachher = Residual-Score aus der Regression, wie runRecessionAnalysis ihn schreibt.
 * Lauf: npx tsx script/report-buffett-regression-score.ts
 */
import { anchoredRecessionProbability, buffettReading, probabilityFromNet, runRecessionAnalysis, scoredTotals, type IndicatorResult } from "../server/recession";
import { loadUsBuffettPack } from "../server/buffett-route";
import { blendWeighted, catalogProbability, REGION_WEIGHT } from "../shared/recession-regions";
import { usSlotsFromIndicators } from "../server/recession-regions";

function zoneBuffett(slot: IndicatorResult): IndicatorResult {
  if (!slot.name.includes("Buffett") || slot.available === false) return slot;
  const ratio = parseFloat(slot.value);
  if (!Number.isFinite(ratio)) return slot;
  const zone = buffettReading(ratio);
  return {
    ...slot,
    rawScore: zone.rawScore,
    weight: zone.weight,
    weightedScore: zone.weightedScore,
    maxWeighted: zone.maxWeighted,
    zone: zone.zone,
  };
}

function books(indicators: IndicatorResult[], nyFed: number | null): { recession12m: number; correction12m: number } {
  const coincident = indicators.filter(indicator => indicator.subgroup === "coincident");
  const leading = indicators.filter(indicator => indicator.subgroup === "leading");
  const full = indicators.filter(indicator => indicator.subgroup === "full");
  const sentiment = indicators.filter(indicator => indicator.subgroup === "sentiment");
  const valuation = indicators.filter(indicator => indicator.subgroup === "valuation" || indicator.subgroup === "sentiment_ext");
  const recessionTotals = scoredTotals([...coincident, ...leading, ...full]);
  const sentimentTotals = scoredTotals(sentiment);
  const valuationTotals = scoredTotals(valuation);
  const anchored = anchoredRecessionProbability(
    recessionTotals.net,
    recessionTotals.max,
    nyFed != null && Number.isFinite(nyFed) ? nyFed : null,
  );
  return {
    recession12m: anchored.probability,
    correction12m: probabilityFromNet(sentimentTotals.net + valuationTotals.net, sentimentTotals.max + valuationTotals.max),
  };
}

function cell(value: string | number | null | undefined): string {
  if (typeof value === "string") return value;
  return value == null || !Number.isFinite(value) ? "n/a" : String(value);
}

const pack = await loadUsBuffettPack();
const fit = pack.regression;
console.log("\n=== Regression ===");
console.log(JSON.stringify({
  available: fit.available,
  reason: fit.reason,
  n: fit.n,
  intercept: fit.intercept,
  coefficients: fit.coefficients,
  fitted: fit.fitted,
  residual: fit.residual,
  residualZ: fit.residualZ,
  residualPercentile: fit.residualPercentile,
  rawScore: fit.rawScore,
  weightedScore: fit.weightedScore,
  zone: fit.zone,
  sectorNote: fit.sectorNote,
  carriedRegressors: fit.carriedRegressors,
  curvePoints: fit.curve.length,
}, null, 2));

const after = await runRecessionAnalysis();
const beforeIndicators = after.indicators.map(zoneBuffett);
const afterBuffett = after.indicators.find(indicator => indicator.name.includes("Buffett"));
const beforeBuffett = beforeIndicators.find(indicator => indicator.name.includes("Buffett"));
const correction = after.subgroups.find(group => group.name === "correction_full");
const recession = after.subgroups.find(group => group.name === "recession_full");
if (!correction || !recession || !afterBuffett || !beforeBuffett) {
  throw new Error("Subgruppen oder Buffett-Slot fehlen");
}
const beforeBooks = books(beforeIndicators, after.nyFedValue);
const afterBooks = books(after.indicators, after.nyFedValue);
const beforeCorrection = beforeBooks.correction12m;
const beforeRecession = beforeBooks.recession12m;

const beforeUs = usSlotsFromIndicators(beforeIndicators);
const afterUs = usSlotsFromIndicators(after.indicators);
const beforeUsRec = catalogProbability(beforeUs, "recession");
const afterUsRec = catalogProbability(afterUs, "recession");
const beforeUsCorr = catalogProbability(beforeUs, "correction");
const afterUsCorr = catalogProbability(afterUs, "correction");

const ez = after.regions?.regions.find(region => region.id === "EZ") ?? null;
const jp = after.regions?.regions.find(region => region.id === "JP") ?? null;
const beforeBlendRec = blendWeighted([
  { weight: REGION_WEIGHT.US, probability: beforeRecession },
  { weight: REGION_WEIGHT.EZ, probability: ez?.recessionProbability ?? null },
  { weight: REGION_WEIGHT.JP, probability: jp?.recessionProbability ?? null },
]);
const afterBlendRec = after.regions?.blendedRecession12m ?? null;
const beforeBlendCorr = blendWeighted([
  { weight: REGION_WEIGHT.US, probability: beforeCorrection },
  { weight: REGION_WEIGHT.EZ, probability: ez?.correctionProbability ?? null },
  { weight: REGION_WEIGHT.JP, probability: jp?.correctionProbability ?? null },
]);
const afterBlendCorr = blendWeighted([
  { weight: REGION_WEIGHT.US, probability: afterBooks.correction12m },
  { weight: REGION_WEIGHT.EZ, probability: ez?.correctionProbability ?? null },
  { weight: REGION_WEIGHT.JP, probability: jp?.correctionProbability ?? null },
]);

console.log("\n=== Vorher/Nachher ===");
console.log(`Buffett Wert ${afterBuffett.value} | vorher Zone ${beforeBuffett.zone} Roh ${beforeBuffett.rawScore} gewichtet ${beforeBuffett.weightedScore} | nachher ${afterBuffett.zone} Roh ${afterBuffett.rawScore} gewichtet ${afterBuffett.weightedScore}`);
console.log(`Korrektur-Formel nachher: ${correction.formula}`);
const rows = [
  ["USA Headline 12M", beforeRecession, afterBooks.recession12m, beforeCorrection, afterBooks.correction12m],
  ["USA Katalog", beforeUsRec, afterUsRec, beforeUsCorr, afterUsCorr],
  ["Eurozone Katalog", ez?.recessionProbability, ez?.recessionProbability, ez?.correctionProbability, ez?.correctionProbability],
  ["Asien Katalog (Japan)", jp?.recessionProbability, jp?.recessionProbability, jp?.correctionProbability, jp?.correctionProbability],
  ["Blend 0,70/0,20/0,10", beforeBlendRec, afterBlendRec, beforeBlendCorr, afterBlendCorr],
];
console.log("Region | Rezession vorher | Rezession nachher | Korrektur vorher | Korrektur nachher");
for (const row of rows) console.log(row.map(cell).join(" | "));
const jpSlots = jp?.slots.map(slot => `${slot.name} ${slot.available ? slot.value : "n/a"}`).join("; ") ?? "";
console.log(`Asien-Slots: ${jpSlots}`);
console.log(`Antwort Rezession ${recession.probability} / Korrektur ${correction.probability} | neu gerechnet ${afterBooks.recession12m} / ${afterBooks.correction12m}`);
console.log(`Blend Korrektur aus der Antwort: ${after.regions?.blendedCorrection12m ?? "n/a"} | neu gerechnet ${cell(afterBlendCorr)}`);
