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
  correctionAction,
  nyFedAnchorPct,
  oilShockFromZ,
  probabilityFromNet,
  recessionAsOf,
  scoredTotals,
  yoyPercent,
} from "../server/recession";
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

console.log("\n=== Aktivität is INDPRO / TCU, missing source is not a score ===");
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
  check("live reading shows INDPRO YoY", live.value.includes("INDPRO YoY +10.0%"), live.value);
  check("live reading shows TCU", live.value.includes("TCU 78.2%"), live.value);
  check("live source names the FRED series", live.source.includes("INDPRO") && live.source.includes("TCU"), live.source);
  check("a real reading still has no invented score", live.rawScore === 0 && live.weightedScore === 0 && live.maxWeighted === 0 && live.available === false);
  check("live slot does not say ISM", ![live.name, live.source, live.description, live.zone, live.value].some(ism));

  const tcuOnly = activityIndicator([], 77);
  check("TCU alone is shown and still unscored", tcuOnly.value === "TCU 77.0%" && tcuOnly.available === false && tcuOnly.maxWeighted === 0);

  const scored = scoredTotals([
    { ...missing, available: true, weightedScore: -3, maxWeighted: 3 },
    live,
  ]);
  check("available:false adds neither net nor max", scored.net === -3 && scored.max === 3, `net=${scored.net} max=${scored.max}`);
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

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
