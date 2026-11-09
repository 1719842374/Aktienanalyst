/**
 * F2-10: US / Eurozone / Japan with the sources that are already fixed.
 * A missing print stays closed. The same VIX level scores the same zone
 * whether it came from FRED or from Yahoo. Stale Google Trends keeps ×1.7
 * (F4-07 braucht Philip). Run: npx tsx script/test-recession-fixed-sources.ts
 */
import {
  googleReading,
  resolveVixLevel,
  vixReading,
} from "../server/recession";
import {
  emptyRegionalPrints,
  scoreRegionalCatalogs,
  usSlotsFromIndicators,
  type RegionScorers,
} from "../server/recession-regions";
import { REGION_WEIGHT } from "../shared/recession-regions";

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

function yahooVix(close: number | null) {
  return () => close == null ? null : {
    chart: { result: [{ timestamp: [Date.parse("2026-11-02T00:00:00Z") / 1000], indicators: { quote: [{ close: [close] }] } }] },
  };
}

const scorers: RegionScorers = {
  money: () => ({ value: "", rawScore: 0, weight: 1, weightedScore: 0, maxWeighted: 3, zone: "n" }),
  credit: () => ({ value: "", rawScore: 0, weight: 1, weightedScore: 0, maxWeighted: 4, zone: "n" }),
  vol: level => vixReading(level),
  valuation: () => ({ value: "", rawScore: 0, weight: 1, weightedScore: 0, maxWeighted: 4, zone: "n" }),
  activity: () => ({ rawScore: 0, zone: "n" }),
  curve: () => ({ available: false, raw: 0 }),
};

console.log("\n=== VIX Yahoo fills only an empty FRED print ===");
{
  const fred = resolveVixLevel(16.4, yahooVix(99));
  check("a finite FRED print is not replaced", fred.value === 16.4 && fred.source === "FRED VIXCLS", JSON.stringify(fred));
  const yahoo = resolveVixLevel(Number.NaN, yahooVix(18.2));
  check("an empty FRED print uses Yahoo ^VIX", yahoo.value === 18.2 && yahoo.source.startsWith("Yahoo ^VIX"), JSON.stringify(yahoo));
  const none = resolveVixLevel(Number.NaN, yahooVix(null));
  check("both empty stay NaN", !Number.isFinite(none.value));
  const fromFred = vixReading(18.2, "FRED VIXCLS");
  const fromYahoo = vixReading(yahoo.value, yahoo.source);
  check("the same level keeps the same zone and weight", fromFred.rawScore === fromYahoo.rawScore && fromFred.weight === fromYahoo.weight && fromFred.maxWeighted === fromYahoo.maxWeighted && fromYahoo.source.startsWith("Yahoo ^VIX"), `${fromFred.zone} vs ${fromYahoo.zone}`);
  const closed = vixReading(none.value, none.source);
  check("no print is closed, not a neutral zero inside the max", closed.available === false && closed.maxWeighted === 0 && closed.weight === 0 && closed.value === "N/A");
}

console.log("\n=== regions: closed slots stay out, US action stays ===");
{
  const vix = vixReading(18.2, "Yahoo ^VIX 2026-11-02 (Fallback, FRED VIXCLS leer)");
  const usSlots = usSlotsFromIndicators([
    { name: "VIX", group: "correction", value: vix.value, rawScore: vix.rawScore, weight: vix.weight, weightedScore: vix.weightedScore, maxWeighted: vix.maxWeighted, zone: vix.zone, source: vix.source, available: vix.available },
    { name: "VIX-Proxy", group: "correction", value: "18.2", rawScore: 0, weight: 1, weightedScore: 0, maxWeighted: 4, zone: "Proxy", source: "Proxy", available: true },
  ]);
  const vol = usSlots.find(slot => slot.id === "vol");
  check("the US vol slot is the VIX row, not the proxy", vol?.source.startsWith("Yahoo ^VIX") === true && vol?.name === "VIX" && vol.available === true, JSON.stringify(vol));

  const prints = emptyRegionalPrints();
  const catalog = scoreRegionalCatalogs({
    prints,
    usSlots,
    usRecession12m: 40,
    usCorrection12m: 35,
    today: "2026-11-02",
    scorers,
  });
  const ez = catalog.regions.find(region => region.id === "EZ")!;
  const jp = catalog.regions.find(region => region.id === "JP")!;
  const ezCurve = ez.slots.find(slot => slot.id === "curve")!;
  const ezVol = ez.slots.find(slot => slot.id === "vol")!;
  const jpVol = jp.slots.find(slot => slot.id === "vol")!;
  check("an empty EZ curve is closed and not interpolated", !ezCurve.available && ezCurve.maxWeighted === 0 && ezCurve.value === "N/A", ezCurve.value);
  check("an empty VSTOXX is closed", !ezVol.available && ezVol.maxWeighted === 0 && ezVol.source === "STOXX V2TX");
  check("JNVI stays closed without a series", !jpVol.available && jpVol.value === "N/A");
  check("weights stay 0.70 / 0.20 / 0.10", catalog.weights.US === REGION_WEIGHT.US && catalog.weights.EZ === REGION_WEIGHT.EZ && catalog.weights.JP === REGION_WEIGHT.JP);
  check("the action flag stays on the US books", catalog.actionUsesUsBooks === true);
  const ezCorrectionMax = ez.slots.filter(slot => slot.book === "correction" && slot.available).reduce((sum, slot) => sum + slot.maxWeighted, 0);
  check("closed EZ correction slots add no max", ezCorrectionMax === 0, String(ezCorrectionMax));
}

console.log("\n=== F4-07 weight stays (braucht Philip) ===");
{
  const stale = googleReading(59.1, "cached", { ageHours: 30, isStale: true });
  const live = googleReading(59.1);
  check("a stale print keeps weight 1.7 and max 11.9", stale.weight === 1.7 && stale.maxWeighted === 11.9 && stale.weightedScore === live.weightedScore && stale.isStale === true, `w=${stale.weight}`);
  const closed = googleReading(null);
  check("no print is out of net and max", closed.available === false && closed.maxWeighted === 0 && closed.weight === 0);
}

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
