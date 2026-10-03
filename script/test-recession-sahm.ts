/**
 * Offen_WORK_RECESSION_FRED_SAHM.md
 * Sahm slot score is s(z) over up to 20 years, not `>= 0.5 ? 4 : -3`.
 * n < 24 months fails closed: available false, slot score 50, raw 0.
 * Run: npx tsx script/test-recession-sahm.ts
 */
import {
  SAHM_HISTORY_MONTHS,
  SAHM_MIN_MONTHS,
  SAHM_Z_EPSILON,
  cleanFredMonthly,
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

console.log("\n=== written UNRATE window vs SAHMREALTIME ===");
{
  // Public FRED vintages pulled 2026-10-03. October 2025 unemployment is blank.
  const unrate: Array<{ date: string; value: number | null }> = [
    ["2024-06-01", 4.1], ["2024-07-01", 4.2], ["2024-08-01", 4.2], ["2024-09-01", 4.1],
    ["2024-10-01", 4.1], ["2024-11-01", 4.2], ["2024-12-01", 4.1], ["2025-01-01", 4.0],
    ["2025-02-01", 4.2], ["2025-03-01", 4.2], ["2025-04-01", 4.2], ["2025-05-01", 4.3],
    ["2025-06-01", 4.1], ["2025-07-01", 4.3], ["2025-08-01", 4.3], ["2025-09-01", 4.4],
    ["2025-10-01", null], ["2025-11-01", 4.5], ["2025-12-01", 4.4], ["2026-01-01", 4.3],
    ["2026-02-01", 4.4], ["2026-03-01", 4.3], ["2026-04-01", 4.3], ["2026-05-01", 4.3],
    ["2026-06-01", 4.2], ["2026-07-01", 4.1], ["2026-08-01", 4.1], ["2026-09-01", 4.2],
  ].map(([date, value]) => ({ date: date as string, value: value as number | null }));
  const sahmRealtime: Record<string, number> = {
    "2025-09-01": 0.23, "2025-11-01": 0.43, "2025-12-01": 0.35, "2026-01-01": 0.30,
    "2026-02-01": 0.27, "2026-03-01": 0.20, "2026-04-01": 0.13, "2026-05-01": 0.10,
    "2026-06-01": 0.07, "2026-07-01": -0.03, "2026-08-01": -0.07, "2026-09-01": 0.00,
  };
  const byDate = new Map(unrate.filter(p => p.value != null).map(p => [p.date, p.value as number]));
  function addMonths(date: string, k: number): string {
    let y = Number(date.slice(0, 4));
    let m = Number(date.slice(5, 7)) + k;
    while (m <= 0) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    return `${y}-${String(m).padStart(2, "0")}-01`;
  }
  function u3(date: string): number | null {
    const pts = [0, -1, -2].map(k => byDate.get(addMonths(date, k)));
    if (pts.some(v => v == null)) return null;
    return ((pts[0] as number) + (pts[1] as number) + (pts[2] as number)) / 3;
  }
  // Spec text: min over k=0..11, which includes the current 3-month average.
  function sahmSpec(date: string): number | null {
    const cur = u3(date);
    if (cur == null) return null;
    const window: number[] = [];
    for (let k = 0; k <= 11; k++) {
      const v = u3(addMonths(date, -k));
      if (v == null) return null;
      window.push(v);
    }
    return cur - Math.min(...window);
  }
  const sep = sahmSpec("2025-09-01");
  check("a complete k=0..11 window cannot be negative", sep != null && sep >= 0, `S=${sep}`);
  const aug = sahmSpec("2026-08-01");
  check("August 2026 has no complete k=0..11 window, so it cannot equal -0.07", aug == null && sahmRealtime["2026-08-01"] === -0.07, `S=${aug}`);
  check("November 2025 has no 3-month average because UNRATE 2025-10 is blank", u3("2025-11-01") == null && u3("2025-12-01") == null);
  const comparable = Object.keys(sahmRealtime).map(date => ({ date, calc: sahmSpec(date), fred: sahmRealtime[date] }));
  const formed = comparable.filter(row => row.calc != null) as Array<{ date: string; calc: number; fred: number }>;
  const maxDiff = formed.reduce((m, row) => Math.max(m, Math.abs(row.calc - row.fred)), 0);
  check("written window does not satisfy the 12-month 0.02 control", formed.length < 12 || maxDiff > 0.02, `formed=${formed.length} max=${maxDiff}`);
}

console.log(`\n${total - failed}/${total} checks passed.`);
if (failed) process.exit(1);
