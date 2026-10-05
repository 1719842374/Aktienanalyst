/**
 * Offen_WORK_RECESSION_SOURCES.md — remaining source gaps on main.
 * NY-Fed anchor is the FRED percent, activity is INDPRO/TCU without an ISM score,
 * the response carries asOf + schemaVersion, and the action follows P_korr12 / P_rez12.
 * Run: npx tsx script/test-recession-sources.ts
 */
import { readFileSync } from "node:fs";
import {
  ACTIVITY_SLOT_NAME,
  NY_FED_ANCHOR_WEIGHT,
  RECESSION_SCHEMA_VERSION,
  activityIndicator,
  anchoredRecessionProbability,
  blendWithNyFedAnchor,
  briefingEssayAllowed,
  buffettFazitClause,
  buffettFromMarketCapGdp,
  buffettFromObservation,
  buffettMarketCapGdpPercent,
  buffettReading,
  liveBuffettValue,
  capeReading,
  latestShillerCape,
  correctionAction,
  creditReading,
  crowdReading,
  csiReading,
  durableReading,
  generateFazit,
  googleReading,
  m2Reading,
  marginDebtReading,
  nyFedAnchorPct,
  oilShockFromZ,
  privateCreditEssay,
  probabilityFromNet,
  recessionAsOf,
  scoredTotals,
  vixReading,
  weiReading,
  yieldCurveReading,
  yoyPercent,
} from "../server/recession";
import { emptyBridge } from "../server/recession-bridge";
import { RECESSION_FALLBACK_DATA } from "../client/src/lib/recessionFallbackData";
import {
  displayedNyFedAnchorPct,
  showRecessionStand,
} from "../client/src/components/recession/recessionDashboardShared";

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

console.log("\n=== NY Fed anchor is the series percent, weight 0.30 ===");
{
  check("0.76 stays 0.76", nyFedAnchorPct(0.76) === 0.76, String(nyFedAnchorPct(0.76)));
  check("0.48 stays 0.48", nyFedAnchorPct(0.48) === 0.48);
  check("anchor weight is 0.30", NY_FED_ANCHOR_WEIGHT === 0.3);
  const blended = blendWithNyFedAnchor(40, 0.76);
  check(
    "blend is formula×0.70 + anchor×0.30",
    Math.abs(blended - (40 * 0.7 + 0.76 * 0.3)) < 1e-9,
    String(blended),
  );
  const anchored = anchoredRecessionProbability(-5, 20, 0.48);
  check("anchor field is the series", anchored.anchorPct === 0.48);
  const blendedP = blendWithNyFedAnchor(anchored.formulaPct, 0.48);
  const clamped = Math.max(5, Math.min(95, blendedP));
  check(
    "12M probability rounds the unscaled blend",
    anchored.probability === Math.round(clamped / 5) * 5,
    `p=${anchored.probability} formula=${anchored.formulaPct} blend=${blendedP}`,
  );
  check("a group with no scored max stays at 50", probabilityFromNet(0, 0) === 50);
  check("coincident example -6/8 rounds to 15", probabilityFromNet(-6, 8) === 15);
  const server = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../client/src/components/recession/recessionDashboardPartsA1.tsx", import.meta.url), "utf8");
  check("server no longer multiplies the NY Fed series by 10", !server.includes("nyFedValue * 10") && !server.includes("nyFedValue*10"));
  check("NY Fed card no longer multiplies the series by 10", !client.includes("* 10") && !client.includes("*10"));
  check("card prefers the series over a stale scaled anchor", displayedNyFedAnchorPct(0.48, 4.8) === 0.48);
  check("missing series has no anchor", displayedNyFedAnchorPct(null) === null);
}

console.log("\n=== Aktivität scores INDPRO YoY with the durable-goods branch ===");
{
  const months = Array.from({ length: 13 }, (_, i) => ({
    date: `2025-${String(i + 1).padStart(2, "0")}-01`,
    value: i === 0 ? 100 : 100,
  }));
  months[12] = { date: "2026-01-01", value: 110 };
  check("YoY uses the same 12-month lag as the other FRED slots", yoyPercent(months) === 10);
  check("short INDPRO history is not a number", Number.isNaN(yoyPercent(months.slice(0, 12))));

  const missing = activityIndicator([], null);
  const ism = (s: string) => /\bISM\b/.test(s);
  check("missing slot keeps the activity name", missing.name === ACTIVITY_SLOT_NAME);
  check("missing reading is N/A", missing.value === "N/A" && missing.zone === "N/A");
  check("missing reading does not score -3", missing.rawScore === 0 && missing.weightedScore === 0 && missing.maxWeighted === 0);
  check("missing reading stays out of net and max", missing.available === false);
  check("missing slot does not say ISM", ![missing.name, missing.source, missing.description, missing.zone, missing.value].some(ism));

  const live = activityIndicator(months, 78.2);
  const calmDurable = durableReading(10);
  check("live reading shows INDPRO YoY", live.value.includes("INDPRO YoY +10.0%"), live.value);
  check("live reading shows TCU", live.value.includes("TCU 78.2%"), live.value);
  check("live source names the FRED series", live.source.includes("INDPRO") && live.source.includes("TCU"), live.source);
  check(
    "a calculated IP YoY uses the durable-goods score, weight, and max",
    live.rawScore === calmDurable.rawScore
      && live.weightedScore === calmDurable.weightedScore
      && live.weight === calmDurable.weight
      && live.maxWeighted === calmDurable.maxWeighted
      && live.zone === calmDurable.zone
      && live.available !== false,
    `raw=${live.rawScore} w=${live.weight} max=${live.maxWeighted} zone=${live.zone}`,
  );
  check("live slot does not say ISM", ![live.name, live.source, live.description, live.zone, live.value].some(ism));

  const weakMonths = months.map((row, index) => ({ ...row, value: index === months.length - 1 ? 94 : 100 }));
  const weak = activityIndicator(weakMonths, 78.2);
  const weakDurable = durableReading(-6);
  check(
    "IP YoY below -5 takes the same contraction score",
    weak.rawScore === weakDurable.rawScore && weak.weightedScore === 3 && weak.maxWeighted === 3 && weak.zone === weakDurable.zone,
    `raw=${weak.rawScore} zone=${weak.zone}`,
  );

  const tcuOnly = activityIndicator([], 77);
  check("TCU alone is shown and still unscored", tcuOnly.value === "TCU 77.0%" && tcuOnly.available === false && tcuOnly.maxWeighted === 0);

  const scored = scoredTotals([
    { ...missing, available: true, weightedScore: -3, maxWeighted: 3 },
    tcuOnly,
  ]);
  check("available:false adds neither net nor max", scored.net === -3 && scored.max === 3, `net=${scored.net} max=${scored.max}`);
  const withIp = scoredTotals([tcuOnly, live]);
  check("a scored IP reading enters net and max", withIp.net === live.weightedScore && withIp.max === live.maxWeighted);

  const rules = readFileSync(new URL("../client/src/components/recession/recessionDashboardPartsA2.tsx", import.meta.url), "utf8");
  check(
    "scoring-rules row shows the YoY score, weight, and max",
    rules.includes('{ name: "Aktivität (IP / Auslastung)", scorePositive: "+3", scoreNegative: "-2", weight: "×1", max: "3" }'),
  );
  check("scoring-rules row does not withhold the activity score", !rules.includes('Aktivität (IP / Auslastung)", scorePositive: "kein Score"'));
}

console.log("\n=== asOf + schemaVersion; Stand only for today ===");
{
  check("schemaVersion is present", RECESSION_SCHEMA_VERSION === 1);
  check("asOf is the UTC day", recessionAsOf(new Date("2026-10-04T23:30:00.000Z")) === "2026-10-04");
  check("Stand shows when asOf is today", showRecessionStand("2026-10-04", "2026-10-04") === true);
  check("Stand hides for another day", showRecessionStand("2026-04-20", "2026-10-04") === false);
  check("Stand hides when asOf is missing", showRecessionStand(undefined, "2026-10-04") === false);
}

console.log("\n=== P_korr12 / P_rez12 action, oil flag only from a real z ===");
{
  check("z above 1.5 is the oil shock", oilShockFromZ(1.51) === true);
  check("z of 1.5 is not the shock", oilShockFromZ(1.5) === false);
  check("missing z is not a shock", oilShockFromZ(null) === null);
  check(
    "high correction, low recession: cut beta, not a recession book",
    correctionAction(65, 39, null) === "P_korr12 65%, P_rez12 39%: Beta/Duration runter; kein volles Rezessions-Portfolio",
  );
  check(
    "both high and a measured shock adds the gold channel",
    correctionAction(65, 40, true) === "P_korr12 65%, P_rez12 40%: defensiv + Cash/Bills + Gold-Kanal",
  );
  check(
    "both high without a measured shock stays cash and bills",
    correctionAction(80, 40, false) === "P_korr12 80%, P_rez12 40%: defensiv + Cash/Bills",
  );
  check(
    "both high with no z does not invent a shock",
    correctionAction(65, 55, null).includes("Öl-Schock-Flag nicht verfügbar") && !correctionAction(65, 55, null).includes("Gold-Kanal"),
  );
  check(
    "soft economy, correction under 50: quality and value",
    correctionAction(49, 40, null) === "P_korr12 49%, P_rez12 40%: Konjunktur weich, Multiples nicht das Problem → Quality/Value",
  );
  check("correction at 50 is standard risk", correctionAction(50, 80, true).endsWith("Standard-Risiko"));
  check("the gap between 50 and 65 is standard risk", correctionAction(64, 90, null).endsWith("Standard-Risiko"));
}

console.log("\n=== Fallback snapshot follows the same rules ===");
{
  const fb = RECESSION_FALLBACK_DATA as {
    asOf?: string;
    schemaVersion?: number;
    nyFedValue: number;
    indicators: Array<{ name: string; subgroup: string; weightedScore: number; maxWeighted: number; available?: boolean; source: string; description: string; value: string; zone: string }>;
    subgroups: Array<{ name: string; indicators: string[]; netScore: number; maxScore: number; probability: number; nyFedAnchor?: number }>;
    fazit?: { summary: string; sections: Array<{ title: string; text: string }> };
  };
  check("fallback schemaVersion", fb.schemaVersion === RECESSION_SCHEMA_VERSION);
  check("fallback asOf is not today", showRecessionStand(fb.asOf, "2026-10-04") === false);
  check("fallback anchor equals the stored series", displayedNyFedAnchorPct(fb.nyFedValue, fb.subgroups.find(s => s.name === "recession_full")?.nyFedAnchor) === fb.nyFedValue);
  const activity = fb.indicators.find(i => i.name === ACTIVITY_SLOT_NAME);
  check("fallback activity slot exists", activity != null && activity.available === false && activity.value === "N/A");
  check(
    "fallback does not label the activity slot ISM",
    activity != null && ![activity.name, activity.source, activity.description, activity.value, activity.zone].some(s => /\bISM\b/.test(s)),
  );
  for (const name of ["recession_coincident", "recession_leading", "recession_full"]) {
    const sg = fb.subgroups.find(s => s.name === name)!;
    const members = fb.indicators.filter(i => sg.indicators.includes(i.name));
    const totals = scoredTotals(members);
    check(`${name} net/max exclude the unscored slot`, sg.netScore === totals.net && sg.maxScore === totals.max, `stored ${sg.netScore}/${sg.maxScore} vs ${totals.net}/${totals.max}`);
  }
  const full = fb.subgroups.find(s => s.name === "recession_full")!;
  const expected = anchoredRecessionProbability(full.netScore, full.maxScore, fb.nyFedValue);
  check("fallback 12M probability uses the unscaled anchor", full.probability === expected.probability, `stored ${full.probability} vs ${expected.probability}`);
  const action = fb.fazit?.sections.find(s => s.title === "Handlungsempfehlung")?.text ?? "";
  check("fallback action is the two-book branch", action.includes("Beta/Duration runter") && !action.includes("Goldallokation"));
  check("fallback summary still says Hohes Risiko", String(fb.fazit?.summary).includes("Hohes Risiko"));
}

console.log("\n=== Kurve: s(z) über 20J, 0 ist nur das Label ===");
{
  const flat = (n: number, value: number) => Array.from({ length: n }, (_, i) => ({
    date: `2000-${String((i % 12) + 1).padStart(2, "0")}-01`.replace(
      /^(\d{4})/,
      String(2000 + Math.floor(i / 12)),
    ),
    value,
  }));
  const normal = yieldCurveReading(flat(24, 0.4), null);
  check("a flat positive curve is not the old −3", normal.available !== false && normal.rawScore === 0, `raw=${normal.rawScore}`);
  check("zero is a label on a positive curve", normal.zone.includes("Normal"));
  const inverted = yieldCurveReading(flat(24, -0.2), -0.15);
  check("a flat inversion is not the old +4", inverted.rawScore === 0 && inverted.maxWeighted === 4, `raw=${inverted.rawScore}`);
  check("zero stays the inversion label", inverted.zone.includes("Invertiert"));
  check("T10Y3M is shown beside the 10Y-2Y", inverted.value.includes("T10Y3M -0.15%"), inverted.value);
  const short = yieldCurveReading(flat(23, -0.2), null);
  check("short curve history is not a regime", short.available === false && short.rawScore === 0 && short.maxWeighted === 0);
  const stress = flat(24, 1);
  stress[stress.length - 1] = { ...stress[stress.length - 1], value: -2 };
  const stressed = yieldCurveReading(stress, null);
  check("an unusually low curve raises the recession score", stressed.rawScore === 4, `raw=${stressed.rawScore}`);
  const steep = flat(24, 1);
  steep[steep.length - 1] = { ...steep[steep.length - 1], value: 3 };
  check("an unusually high curve lowers the recession score", yieldCurveReading(steep, null).rawScore === -4);
  const delta = flat(24, 0.5);
  delta[delta.length - 1] = { ...delta[delta.length - 1], value: 0.1 };
  const moved = yieldCurveReading(delta, null);
  check("the slot shows the level and the 12M change", moved.value.includes("T10Y2Y 0.10%") && moved.value.includes("12M Δ -0.40 pp"), moved.value);
  check("a missing 3M tenor is not invented", !moved.value.includes("T10Y3M"));
}

console.log("\n=== Missing readings add neither net nor max ===");
{
  for (const slot of [durableReading(Number.NaN), m2Reading(Number.NaN), creditReading(Number.NaN), csiReading(Number.NaN), vixReading(Number.NaN), buffettReading(Number.NaN), capeReading(Number.NaN), googleReading(null)]) {
    check(`${slot.name} N/A is withheld`, slot.available === false && slot.rawScore === 0 && slot.weightedScore === 0 && slot.maxWeighted === 0, slot.name);
  }
  check("durable below −5% still scores", durableReading(-6).rawScore === 3 && durableReading(-6).maxWeighted === 3);
  check("CSI under 60 still scores", csiReading(50).rawScore === 3);
  check("VIX above 30 still scores", vixReading(31).rawScore === 4);
  check("Buffett above 200% still scores", buffettReading(230).rawScore === 8 && buffettReading(230).weightedScore === 16);
  check("CAPE above 35 still scores", capeReading(40).rawScore === 7);
  check(
    "Shiller CAPE is the last numeric CAPE cell",
    latestShillerCape([
      ["Date", "P", "CAPE"],
      [2023.08, 1, 30.47],
      [2023.09, 1, 30.81],
      ["Sept price is a note", "", "NA"],
    ]) === 30.81,
  );
  check(
    "the P/E10 CAPE wins over the excess-yield column that is also named CAPE",
    latestShillerCape([
      ["", "Excess", "CAPE", "P/E10 or", "CAPE"],
      [2023.09, "", 0.0187, "", 30.81],
    ]) === 30.81,
  );
  check("Google without a print is not in the max", googleReading(null).maxWeighted === 0);
  check("a real Google print still scores", googleReading(80).rawScore === 7 && googleReading(80).maxWeighted === 11.9);
  const wei = weiReading(2.4);
  check("WEI is a leading reading without a score", wei.value.includes("2.4") && wei.available === false && wei.maxWeighted === 0 && wei.source.includes("WEI"));
  check("missing WEI is N/A", weiReading(null).value === "N/A" && weiReading(null).available === false);
}

console.log("\n=== Buffett: fresh Wilshire/GDP, stale World Bank print is not live ===");
{
  const today = "2026-10-05";
  const stale = buffettFromObservation({ date: "2020-01-01", value: 194.889 }, today);
  check("2020-01-01 rounds to the 195% print the UI was treating as live", parseFloat(stale.value) === 195, stale.value);
  check(
    "that print is N/A with contribution 0",
    stale.available === false && stale.zone === "N/A" && stale.rawScore === 0 && stale.weight === 0 && stale.weightedScore === 0 && stale.maxWeighted === 0,
    `w=${stale.weight} score=${stale.weightedScore} max=${stale.maxWeighted} zone=${stale.zone}`,
  );
  check("the month stays on the value", stale.value === "195% (2020-01)", stale.value);
  const staleText = [stale.value, stale.zone, stale.source, stale.description].join(" ");
  check("stale Buffett does not say aktuell", !staleText.toLowerCase().includes("aktuell"));
  check("the stale clause is empty", buffettFazitClause(stale) === "" && liveBuffettValue(stale) === null);
  check("a live ratio above 180 still names the dotcom high", buffettFazitClause(buffettReading(230)).includes("230%") && buffettFazitClause(buffettReading(230)).includes("Dotcom"));
  check("the live clause does not say aktuell", !buffettFazitClause(buffettReading(230)).toLowerCase().includes("aktuell"));

  const justInside = buffettFromObservation({ date: "2025-04-01", value: 150 }, today);
  check(
    "18 months is still the Japan window and still scores",
    justInside.available !== false && justInside.weight === 2 && justInside.rawScore === 2 && justInside.weightedScore === 4 && justInside.maxWeighted === 16,
    `${justInside.value} raw=${justInside.rawScore}`,
  );
  const justOutside = buffettFromObservation({ date: "2025-03-01", value: 194.9 }, today);
  check(
    "19 months is outside the window and is not +10",
    justOutside.available === false && justOutside.weightedScore === 0 && justOutside.maxWeighted === 0 && justOutside.value === "195% (2025-03)",
    justOutside.value,
  );

  const vix = vixReading(16);
  const staleTotals = scoredTotals([stale, vix]);
  const liveTotals = scoredTotals([buffettReading(194.9), vix]);
  check("stale Buffett stays out of the correction total", staleTotals.net === 0 && staleTotals.max === vix.maxWeighted, `${staleTotals.net}/${staleTotals.max}`);
  check("the same 194.9 counted live is +10 on a max of 20", liveTotals.net === 10 && liveTotals.max === 20, `${liveTotals.net}/${liveTotals.max}`);
  const pStale = probabilityFromNet(staleTotals.net, staleTotals.max);
  const pLive = probabilityFromNet(liveTotals.net, liveTotals.max);
  check("counting the stale 195% is what lifts P_korr12 to 75", pLive === 75 && pStale === 50, `live=${pLive} stale=${pStale}`);

  check("Wilshire points over GDP billions are the percent", Math.abs(buffettMarketCapGdpPercent(63000, 30000) - 210) < 1e-9);
  check("a zero GDP is not a ratio", Number.isNaN(buffettMarketCapGdpPercent(63000, 0)));
  const freshRatio = buffettFromMarketCapGdp(
    { date: "2026-09-30", value: 63000 },
    { date: "2026-04-01", value: 30000 },
    today,
  )!;
  check(
    "a fresh Wilshire/GDP pair scores and names both series",
    freshRatio.available !== false && freshRatio.rawScore === 8 && freshRatio.weightedScore === 16 && freshRatio.weight === 2 && freshRatio.value === "210%" && freshRatio.source === "FRED WILL5000PR / GDP",
    `${freshRatio.value} ${freshRatio.source} raw=${freshRatio.rawScore}`,
  );
  check(
    "a stale Wilshire leg is not turned into a ratio",
    buffettFromMarketCapGdp({ date: "2020-01-01", value: 35000 }, { date: "2026-04-01", value: 30000 }, today) === null,
  );
  check("a missing Wilshire leg is not a ratio", buffettFromMarketCapGdp(null, { date: "2026-04-01", value: 30000 }, today) === null);
  check("a missing observation is N/A", buffettFromObservation(null, today).available === false && buffettFromObservation(null, today).value === "N/A");

  const server = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  const scoreFn = server.slice(server.indexOf("function scoreBuffett"), server.indexOf("function scoreCAPE"));
  check(
    "scoreBuffett tries Wilshire/GDP before the World Bank series",
    scoreFn.indexOf("WILL5000PR") !== -1 && scoreFn.indexOf("WILL5000PR") < scoreFn.indexOf("DDDM01USA156NWDB"),
  );
  check("scoreBuffett goes through the observation gate", scoreFn.includes("buffettFromMarketCapGdp") && scoreFn.includes("buffettFromObservation"));
  const fazitFn = server.slice(server.indexOf("function generateFazit"), server.indexOf("function registerRecessionRoutes"));
  check("fazit cites Buffett only through the live-value gate", fazitFn.includes("liveBuffettValue") && fazitFn.includes("buffettFazitClause"));
}

console.log("\n=== Fazit ≥65% names the actual drivers, not a closed valuation book ===");
{
  const quiet = { status: "unauffällig" as const, lines: [] as string[], cards: [] };
  const driverLine = (i: { name: string; weightedScore: number; zone: string }) =>
    `${i.name}: ${i.weightedScore > 0 ? "+" : ""}${i.weightedScore} (${i.zone})`;

  const google = googleReading(90);
  const closedBuffett = buffettReading(Number.NaN);
  const closedCape = capeReading(Number.NaN);
  const closedMargin = marginDebtReading([]);
  const trendsFazit = generateFazit(
    [closedBuffett, closedCape, closedMargin, google],
    [],
    15, 20, 25, 50, 75,
    [driverLine(google)],
    emptyBridge(),
    quiet,
  );
  const trendsQuant = trendsFazit.sections.find(s => s.title === "Quantitative Bewertung")?.text ?? "";
  const trendsValuation = trendsFazit.sections.find(s => s.title === "Bewertungsrisiko");
  check("Trends-driven 75% does not say extreme Bewertungsniveaus", !trendsQuant.includes("extreme Bewertungsniveaus"), trendsQuant);
  check("Trends-driven 75% names Google Trends", trendsQuant.includes("Google") && trendsQuant.includes("75%"), trendsQuant);
  check(
    "empty Bewertungsrisiko is omitted or honest",
    trendsValuation == null
      || (trendsValuation.text.trim().length > 0
        && !/Buffett-Indikator steht bei/i.test(trendsValuation.text)
        && /nicht (verfügbar|bewertet|gewertet)|N\/A|kein Druck/i.test(trendsValuation.text)),
    trendsValuation == null ? "omitted" : trendsValuation.text,
  );

  const liveBuffett = buffettReading(230);
  const valuationFazit = generateFazit(
    [liveBuffett, closedCape, closedMargin],
    [],
    15, 20, 25, 50, 75,
    [driverLine(liveBuffett)],
    emptyBridge(),
    quiet,
  );
  const valuationQuant = valuationFazit.sections.find(s => s.title === "Quantitative Bewertung")?.text ?? "";
  const valuationSection = valuationFazit.sections.find(s => s.title === "Bewertungsrisiko");
  check(
    "a live Buffett 230% still names extreme Bewertungsniveaus",
    valuationQuant.includes("extreme Bewertungsniveaus") && valuationQuant.includes("Buffett"),
    valuationQuant,
  );
  check(
    "Bewertungsrisiko still quotes the live Dotcom clause",
    (valuationSection?.text ?? "").includes("230%") && (valuationSection?.text ?? "").includes("Dotcom"),
    valuationSection?.text,
  );
}

console.log("\n=== Sentiment is VIX plus one crowd leg ===");
{
  const cnn = crowdReading(65, 18, false);
  check("a live CNN print is the crowd leg", cnn.name === "CNN Fear & Greed" && cnn.proxy !== true && cnn.weight === 1.6, cnn.name);
  const proxy = crowdReading(20, 12, true);
  check("crypto does not keep the CNN score", proxy.name === "VIX-Proxy" && proxy.proxy === true && proxy.weight === 1 && !proxy.value.includes("20"), `${proxy.name} ${proxy.value}`);
  const vixOnly = crowdReading(null, 12, false);
  check("without CNN there is one VIX proxy", vixOnly.name === "VIX-Proxy" && vixOnly.weight === 1 && vixOnly.maxWeighted === 4);
  const none = crowdReading(null, null, false);
  check("no crowd print is withheld", none.available === false && none.maxWeighted === 0);
  const server = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  check("AAII, put/call and II are not scored again", !server.includes("scoreAAII()") && !server.includes("scorePutCallRatio()") && !server.includes("scoreInvestorsIntelligence()"));
  check("the AD default of −2 is gone", !server.includes("default: parallel/healthy") && !server.includes("scoreADLine()"));
}

console.log("\n=== FINRA margin is billions and a 5Y z, never $2026T ===");
{
  const levels = Array.from({ length: 24 }, () => 1022548);
  levels[levels.length - 1] = 1417225;
  const points = levels.map((debitMillions, i) => ({ date: `2024-${String((i % 12) + 1).padStart(2, "0")}-01`, debitMillions }));
  points.forEach((p, i) => {
    const year = 2024 + Math.floor(i / 12);
    const month = (i % 12) + 1;
    p.date = `${year}-${String(month).padStart(2, "0")}-01`;
  });
  const margin = marginDebtReading(points);
  check("Jul-26 debit is billions", margin.value.includes("1417.2 Mrd. $"), margin.value);
  check("YoY vs Jul-25 is +38.6%", margin.value.includes("YoY +38.6%"), margin.value);
  check("the year is not a trillions token", !/\$\d{4}T/i.test(margin.value) && !margin.value.toLowerCase().includes("overvalued"));
  check("the score uses the 5Y z", margin.rawScore > 0 && margin.rawScore <= 4 && margin.maxWeighted === 4, `raw=${margin.rawScore}`);
  const thin = Array.from({ length: 13 }, (_, i) => ({ date: `2025-${String(i + 1).padStart(2, "0")}-01`, debitMillions: i === 12 ? 1100000 : 1000000 }));
  const partial = marginDebtReading(thin);
  check("YoY without a 5Y z is shown and not scored", partial.available === false && partial.maxWeighted === 0 && partial.value.includes("Mrd. $") && !/\$\d{4}T/i.test(partial.value));
  const server = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  check(
    "Buffett names Wilshire/GDP and the World Bank series, and does not scrape a page",
    server.includes("WILL5000PR") && server.includes("DDDM01USA156NWDB") && server.includes("isStale") && !server.includes('content.includes("overvalued")'),
  );
  const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const lock = readFileSync(new URL("../package-lock.json", import.meta.url), "utf8");
  check(
    "xlsx is not a dependency and the scorer does not parse a workbook",
    !/"xlsx"\s*:/.test(pkg)
      && !lock.includes("node_modules/xlsx")
      && !server.includes('from "xlsx"')
      && !server.includes("XLSX.read")
      && !server.includes("margin-statistics.xlsx")
      && !server.includes("fetchShillerCape")
      && !server.includes("fetchFinraDebitPoints"),
  );
  check(
    "closed CAPE and margin add neither net nor max",
    capeReading(Number.NaN).available === false
      && capeReading(Number.NaN).maxWeighted === 0
      && marginDebtReading([]).available === false
      && marginDebtReading([]).maxWeighted === 0,
  );
  const csiFn = server.slice(server.indexOf("function scoreConsumerConfidence"), server.indexOf("function scoreBuffett"));
  check("CSI asks UMCSENT before the macro fallback", csiFn.indexOf("UMCSENT") !== -1 && csiFn.indexOf("UMCSENT") < csiFn.indexOf("getMacroValue"));
}

console.log("\n=== Geo/PC essay only while the briefing cache is inside 30 days ===");
{
  const now = Date.parse("2026-10-04T00:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  check("29 days is still the essay", briefingEssayAllowed(now - 29 * day, now) === true);
  check("30 days is still the essay", briefingEssayAllowed(now - 30 * day, now) === true);
  check("31 days turns the essay off", briefingEssayAllowed(now - 31 * day, now) === false);
  check("a missing updated_at turns the essay off", briefingEssayAllowed(null, now) === false);
  const on = privateCreditEssay(true);
  const off = privateCreditEssay(false);
  check("a fresh cache keeps the private-credit section", on?.title === "Private Credit & Systemisches Risiko" && (on?.text.length ?? 0) > 40);
  check("a stale cache drops the section", off === null);
}

console.log("\n=== Fallback no longer scores the forbidden defaults ===");
{
  const fb = RECESSION_FALLBACK_DATA as {
    indicators: Array<{ name: string; value: string; available?: boolean; weightedScore: number; maxWeighted: number }>;
    fazit?: { sections: Array<{ title: string; text: string }> };
  };
  const margin = fb.indicators.find(i => i.name === "Margin Debt");
  check("fallback margin is not a year-trillions token", margin != null && !/\$\d{4}T/i.test(margin.value));
  const forbidden = ["Advance-Decline-Line", "AAII Sentiment", "CBOE Put/Call Ratio", "Investors Intelligence"];
  check(
    "fallback does not score AD or the triple proxy",
    forbidden.every(name => {
      const row = fb.indicators.find(i => i.name === name);
      return row == null || (row.available === false && row.weightedScore === 0 && row.maxWeighted === 0);
    }),
  );
  const scoredSentiment = fb.indicators.filter(i => i.name === "VIX" || i.name === "CNN Fear & Greed" || i.name === "VIX-Proxy");
  check("fallback crowd is one leg beside VIX", scoredSentiment.length <= 2);
}

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
