/**
 * Offen_WORK_RECESSION_FRED_SAHM.md
 * The card shows the realtime prints. A blank month stays blank.
 * The self-computed unemployment S is only the backup when realtime is empty,
 * and that backup is not given a 20-year z.
 * A delivered series is s(z) over up to 20 years, not `>= 0.5 ? 4 : -3`.
 * n < 24 months fails closed: available false, slot score 50, raw 0.
 * The 0.50pp mark is the trigger on the displayed level.
 * Run: npx tsx script/test-recession-sahm.ts
 */
import { readFileSync } from "node:fs";
import {
  SAHM_CONTROL_TOLERANCE,
  SAHM_HISTORY_MONTHS,
  SAHM_MIN_MONTHS,
  SAHM_Z_EPSILON,
  cleanFredMonthly,
  sahmIndicatorFromScore,
  sahmLevelsFromUnemployment,
  scoreSahmFromUnemployment,
  scoreSahmLevels,
  sahmIndicatorFromLevels,
  type FredPoint,
} from "../server/recession-sahm";

let failed = 0;
let total = 0;
function check(name: string, cond: boolean, detail = "") {
  total++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function months(n: number, value: number, start = "2000-01-01"): FredPoint[] {
  const out: FredPoint[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  for (let i = 0; i < n; i++) {
    out.push({ date: `${y}-${String(m).padStart(2, "0")}-01`, value });
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

console.log("\n=== clean FRED monthly ===");
{
  const cleaned = cleanFredMonthly([
    { date: "2020-02-01", value: 3 },
    { date: "2020-01-02", value: 1 },
    { date: "2020-01-02", value: 9 },
    { date: "2020-01-31", value: 2 },
    { date: "2020-03-01", value: null },
    { date: "2020-04-01", value: Number.NaN },
  ]);
  check("drops null and NaN", cleaned.every(p => p.date !== "2020-03-01" && p.date !== "2020-04-01"));
  check("sorts ascending", cleaned.map(p => p.date).join(",") === "2020-01-31,2020-02-01");
  check("duplicate date keeps the later row, then month-end keeps the last day", cleaned[0]?.value === 2 && cleaned[0]?.date === "2020-01-31");
  check("February level kept", cleaned[1]?.value === 3);
}

console.log("\n=== s(z) over history, not the 0.5 threshold ===");
{
  const flatLow = scoreSahmLevels(months(SAHM_MIN_MONTHS, 0.1));
  check("24 months is enough history", flatLow.available === true && flatLow.n === 24);
  check("level below 0.5 is not triggered", flatLow.triggered === false && flatLow.level === 0.1);
  check("flat series at the mean is s=50, raw 0 (old rule would be -3)", flatLow.s === 50 && flatLow.raw === 0, `s=${flatLow.s} raw=${flatLow.raw}`);

  const flatHigh = scoreSahmLevels(months(SAHM_MIN_MONTHS, 0.8));
  check("level at or above 0.5 stays the UI boolean", flatHigh.triggered === true);
  check("same flat history does not jump to +4", flatHigh.raw === 0 && flatHigh.s === 50, `raw=${flatHigh.raw}`);

  const hist = [...Array(10).fill(0), ...Array(10).fill(2), ...Array(3).fill(1)];
  const mu = 1;
  const sigma = Math.sqrt(20 / 22);
  const at = (zTarget: number) => {
    const x = mu + zTarget * (sigma + SAHM_Z_EPSILON);
    return scoreSahmLevels([...hist.map((value, i) => ({ date: months(23)[i].date, value })), { date: "2001-12-01", value: x }]);
  };
  const plus = at(2);
  const mid = at(1);
  const minus = at(-2);
  check("z=+2 clips to s=100, raw +4", plus.available && plus.raw === 4 && plus.s === 100, `s=${plus.s} raw=${plus.raw}`);
  check("z=+1 is s=75, raw +2", mid.raw === 2 && Math.abs(mid.s - 75) < 1e-6, `s=${mid.s} raw=${mid.raw}`);
  check("z=-2 clips to s=0, raw -4", minus.raw === -4 && minus.s === 0, `s=${minus.s} raw=${minus.raw}`);
  check("raw stays inside [-4, +4]", [plus.raw, mid.raw, minus.raw].every(r => r >= -4 && r <= 4));

  const longFlat = months(300, 0);
  longFlat[0] = { ...longFlat[0], value: 100 };
  const capped = scoreSahmLevels(longFlat);
  check(
    "z uses at most 240 months, so a spike older than 20 years does not move a flat print",
    SAHM_HISTORY_MONTHS === 240 && capped.raw === 0 && capped.s === 50,
    `s=${capped.s} raw=${capped.raw}`,
  );
}

console.log("\n=== n<24 months fails closed ===");
{
  const short = scoreSahmLevels(months(SAHM_MIN_MONTHS - 1, 0.8));
  check("23 months is unavailable", short.available === false && short.n === 23);
  check("slot score stays 50 and raw stays 0, not +4", short.s === 50 && short.raw === 0, `s=${short.s} raw=${short.raw}`);
  check("the level is still known for the card", short.level === 0.8 && short.triggered === true);

  const empty = scoreSahmLevels([]);
  check("no observations is unavailable", empty.available === false && empty.level === null && empty.raw === 0 && empty.s === 50);

  const card = sahmIndicatorFromLevels(months(SAHM_MIN_MONTHS - 1, 0.2));
  check("short history does not emit the old -3 regime", card.rawScore === 0 && card.weightedScore === 0 && card.available === false, `raw=${card.rawScore}`);
  check("existing zone strings stay on the card when a level exists", card.zone === "Normal (<0.5pp)" && card.value === "0.20 pp");
  check("weight stays ×1", card.weight === 1 && card.maxWeighted === 4);

  const missing = sahmIndicatorFromLevels([]);
  check("missing level renders N/A", missing.value === "N/A" && missing.zone === "N/A" && missing.rawScore === 0);
}

console.log("\n=== realtime print is the card; unemployment S is the backup ===");
{
  const unemployment = months(40, 5, "2018-01-01");
  const series = sahmLevelsFromUnemployment(unemployment);
  const defined = series.filter((point): point is FredPoint => point.value != null);
  check("constant unemployment builds S = 0 once the 12-month window exists", defined.length >= SAHM_MIN_MONTHS && defined.every(point => point.value === 0), `n=${defined.length}`);
  const matchingRealtime = defined.slice(-SAHM_MIN_MONTHS).map(point => ({ date: point.date, value: 0 }));
  const matched = scoreSahmFromUnemployment(unemployment, matchingRealtime);
  check(
    "a long matching realtime print is the card level, and s(z) stays 50",
    matched.controlOk === true && matched.score.backup !== true && matched.score.available === true && matched.score.level === 0 && matched.score.raw === 0 && matched.score.s === 50,
    `raw=${matched.score.raw} level=${matched.score.level}`,
  );
  check("control tolerance is 0.02", SAHM_CONTROL_TOLERANCE === 0.02 && matched.control.every(row => row.absDiff === 0));

  const missed = scoreSahmFromUnemployment(unemployment, matchingRealtime.map(point => ({ ...point, value: 0.1 })));
  const missedCard = sahmIndicatorFromScore(missed.score);
  check(
    "a 0.10 control miss does not replace the realtime print",
    missed.controlOk === false
      && missed.control.every(row => row.computed === 0 && row.absDiff != null && Math.abs(row.absDiff - 0.1) < 1e-12)
      && missed.score.backup !== true
      && missed.score.level === 0.1
      && missed.score.available === true
      && missed.score.raw === 0
      && missed.score.s === 50
      && missed.score.triggered === false
      && missedCard.value === "0.10 pp"
      && missedCard.zone === "Normal (<0.5pp)",
    `value=${missedCard.value} zone=${missedCard.zone} diff=${missed.control[0]?.absDiff}`,
  );

  const last12 = defined.slice(-12).map(point => ({ date: point.date, value: 0 }));
  const gapped = unemployment.map(point => point.date === "2020-12-01" ? { ...point, value: null } : point);
  const blanked = scoreSahmFromUnemployment(gapped, last12);
  const blankedCard = sahmIndicatorFromScore(blanked.score);
  check(
    "a blank unemployment month leaves those S values undefined",
    blanked.controlOk === false && blanked.control.some(row => row.computed == null),
    `blanks=${blanked.control.filter(row => row.computed == null).map(row => row.date).join(",")}`,
  );
  check(
    "a delivered realtime print stays on the card across that gap",
    blanked.score.backup !== true && blanked.score.level === 0 && blanked.score.raw === 0 && blankedCard.value === "0.00 pp" && blankedCard.zone === "Normal (<0.5pp)" && !(blanked.score.reason ?? "").includes("2020-12"),
    blankedCard.zone,
  );

  const emptyFeed = scoreSahmFromUnemployment([], []);
  const emptyCard = sahmIndicatorFromScore(emptyFeed.score);
  check(
    "no realtime and no unemployment S stays N/A without a placeholder score",
    emptyFeed.score.available === false && emptyFeed.score.backup !== true && emptyFeed.score.level == null && emptyFeed.score.raw === 0 && emptyFeed.score.s === 50 && emptyCard.value === "N/A" && emptyCard.zone === "Realtime-Serie nicht geliefert" && emptyCard.rawScore === 0,
    emptyCard.zone,
  );

  const hist = [...Array(10).fill(0), ...Array(10).fill(2), ...Array(3).fill(1)];
  const mu = 1;
  const sigma = Math.sqrt(20 / 22);
  const x = mu + 2 * (sigma + SAHM_Z_EPSILON);
  const delivered = scoreSahmFromUnemployment(
    [],
    [...hist.map((value, i) => ({ date: months(23)[i].date, value })), { date: "2001-12-01", value: x }],
  );
  check(
    "a delivered realtime series is z-scored when unemployment is empty",
    delivered.controlOk === false && delivered.score.backup !== true && delivered.score.available === true && delivered.score.raw === 4 && delivered.score.s === 100,
    `raw=${delivered.score.raw}`,
  );

  const spiked = months(60, 4, "2015-01-01").map((point, i, all) => i >= all.length - 6 ? { ...point, value: 10 } : point);
  const spikedLevels = sahmLevelsFromUnemployment(spiked).filter((point): point is FredPoint => point.value != null);
  const counterfactual = scoreSahmLevels(spikedLevels);
  const backupOnly = scoreSahmFromUnemployment(spiked, []);
  const backupCard = sahmIndicatorFromScore(backupOnly.score);
  check(
    "the same spike would be raw +4 if it were the scored series",
    counterfactual.available === true && counterfactual.raw === 4 && counterfactual.level === 6,
    `raw=${counterfactual.raw} level=${counterfactual.level}`,
  );
  check(
    "the unemployment backup keeps that level and does not invent the z",
    backupOnly.score.backup === true
      && backupOnly.score.available === false
      && backupOnly.score.raw === 0
      && backupOnly.score.s === 50
      && backupOnly.score.level === 6
      && backupOnly.score.triggered === true
      && backupCard.value === "6.00 pp"
      && backupCard.rawScore === 0
      && backupCard.zone.includes("eigener Backup")
      && backupCard.zone.includes("Claudia")
      && backupCard.zone.includes("2019-12"),
    backupCard.zone,
  );
}

console.log("\n=== unemployment formula, no series id ===");
{
  const unemployment = months(40, 7.5, "2010-01-01");
  const levels = sahmLevelsFromUnemployment(unemployment).filter(point => point.value != null);
  check("the formula builds S = 0 from the unemployment path alone", levels.length >= SAHM_MIN_MONTHS && levels.every(point => point.value === 0), `n=${levels.length}`);
  const math = readFileSync(new URL("../server/recession-sahm.ts", import.meta.url), "utf8");
  check("the Sahm formula module has no series id", !/["'](UNRATE|SAHMREALTIME|SAHM|une_rt_m|LRUNTTTTJPM156S)["']/.test(math));
}

console.log("\n=== fixture: last 12 SAHMREALTIME months, k=0..11 ===");
{
  // Public FRED prints pulled 2026-10-03. October 2025 unemployment is blank.
  const unrate: Array<{ date: string; value: number | null }> = [
    ["2024-06-01", 4.1], ["2024-07-01", 4.2], ["2024-08-01", 4.2], ["2024-09-01", 4.1],
    ["2024-10-01", 4.1], ["2024-11-01", 4.2], ["2024-12-01", 4.1], ["2025-01-01", 4.0],
    ["2025-02-01", 4.2], ["2025-03-01", 4.2], ["2025-04-01", 4.2], ["2025-05-01", 4.3],
    ["2025-06-01", 4.1], ["2025-07-01", 4.3], ["2025-08-01", 4.3], ["2025-09-01", 4.4],
    ["2025-10-01", null], ["2025-11-01", 4.5], ["2025-12-01", 4.4], ["2026-01-01", 4.3],
    ["2026-02-01", 4.4], ["2026-03-01", 4.3], ["2026-04-01", 4.3], ["2026-05-01", 4.3],
    ["2026-06-01", 4.2], ["2026-07-01", 4.1], ["2026-08-01", 4.1], ["2026-09-01", 4.2],
  ].map(([date, value]) => ({ date: date as string, value: value as number | null }));
  const realtime = [
    ["2025-09-01", 0.23], ["2025-11-01", 0.43], ["2025-12-01", 0.35], ["2026-01-01", 0.30],
    ["2026-02-01", 0.27], ["2026-03-01", 0.20], ["2026-04-01", 0.13], ["2026-05-01", 0.10],
    ["2026-06-01", 0.07], ["2026-07-01", -0.03], ["2026-08-01", -0.07], ["2026-09-01", 0.00],
  ].map(([date, value]) => ({ date: date as string, value: value as number }));
  const withBlankOctober = [
    realtime[0],
    { date: "2025-10-01", value: null },
    ...realtime.slice(1),
  ];
  const evaluated = scoreSahmFromUnemployment(unrate, withBlankOctober);
  const sep = evaluated.control.find(row => row.date === "2025-09-01");
  const aug = evaluated.control.find(row => row.date === "2026-08-01");
  check("2025-09 S is built and within 0.02 of SAHMREALTIME", sep?.computed != null && Math.abs(sep.computed - (7 / 30)) < 1e-9 && sep.absDiff != null && sep.absDiff <= 0.02, `S=${sep?.computed} diff=${sep?.absDiff}`);
  check("2026-08 cannot be built because UNRATE 2025-10 is blank", aug?.computed == null && aug?.fred === -0.07);
  const blanks = evaluated.control.filter(row => row.computed == null);
  check("11 of the last 12 control months are blank under k=0..11", blanks.length === 11, blanks.map(row => row.date).join(","));
  check("October 2025 is dropped and is not the 0.25 imputation", !cleanFredMonthly(withBlankOctober).some(point => point.date.startsWith("2025-10")) && !withBlankOctober.some(point => point.value === 0.25));
  const card = sahmIndicatorFromScore(evaluated.score);
  check(
    "the card shows the latest realtime print, not the September S and not 0.25",
    evaluated.controlOk === false
      && evaluated.score.backup !== true
      && evaluated.score.level === 0
      && evaluated.score.triggered === false
      && evaluated.score.raw === 0
      && card.value === "0.00 pp"
      && card.zone === "Normal (<0.5pp)"
      && card.value !== "0.23 pp"
      && card.value !== "0.25 pp"
      && Math.abs((evaluated.score.level ?? 0) - (0.23 + 0.43) / 2) > 0.02,
    `value=${card.value} zone=${card.zone} level=${evaluated.score.level}`,
  );
  const backup = scoreSahmFromUnemployment(unrate, []);
  const backupCard = sahmIndicatorFromScore(backup.score);
  check(
    "without realtime the card is the September 2025 UNRATE S and says it is the backup",
    backup.score.backup === true
      && backup.score.available === false
      && backup.score.s === 50
      && backup.score.raw === 0
      && backup.score.triggered === false
      && backup.score.level != null
      && Math.abs(backup.score.level - (7 / 30)) < 1e-9
      && backupCard.value === "0.23 pp"
      && backupCard.value !== "0.25 pp"
      && backupCard.rawScore === 0
      && backupCard.zone.includes("eigener Backup")
      && backupCard.zone.includes("2025-09")
      && backupCard.zone.includes("Claudia"),
    backupCard.zone,
  );
  const route = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  const sahmFn = route.slice(route.indexOf("function scoreSahm"), route.indexOf("function scoreYieldCurve"));
  check("the live slot fetches UNRATE and SAHMREALTIME", route.includes('fetchFredRows("UNRATE"') && route.includes('fetchFredRows("SAHMREALTIME"') && route.includes("scoreSahmFromUnemployment"));
  check(
    "the card source is SAHMREALTIME unless the score is the unemployment backup",
    sahmFn.includes('evaluated.score.backup ? "FRED UNRATE" : "FRED SAHMREALTIME"'),
  );
  check(
    "the Sahm slot does not fill from SAHMCURRENT, FMP, or Google Trends",
    !sahmFn.includes("SAHMCURRENT") && !/fmp|Trends|google/i.test(sahmFn),
  );
}

console.log(`\n${total - failed}/${total} checks passed.`);
if (failed) process.exit(1);
