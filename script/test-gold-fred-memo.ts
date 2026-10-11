/**
 * Pro-Request-FRED-Memo fuer /api/analyze-gold.
 * Spielt die Abruf-Reihenfolge der Route nach und prueft, dass jeder Aufrufer
 * byte-gleich dieselben Punkte bekommt wie mit dem direkten Abruf, aber jede
 * Serie nur einmal geladen wird.
 *
 * Ausführen: npx tsx script/test-gold-fred-memo.ts
 */
import { readFileSync } from "node:fs";
import { createFredHistoryMemo, sliceLikeCosd, type FredHistoryPoint } from "../server/gold-fred-memo";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function series(kind: "daily" | "weekly" | "monthly", from: string, to: string, seed: number): FredHistoryPoint[] {
  const out: FredHistoryPoint[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  if (kind === "monthly") d.setUTCDate(1);
  let v = seed;
  while (iso(d) <= to) {
    v = Math.round((v * 1.0007 + 0.13) * 1000) / 1000;
    if (kind !== "daily" || (d.getUTCDay() !== 0 && d.getUTCDay() !== 6)) out.push({ date: iso(d), value: v });
    if (kind === "daily") d.setUTCDate(d.getUTCDate() + 1);
    else if (kind === "weekly") d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

// Fake-FRED mit cosd-Semantik (Monatsreihe: Beobachtung des Monats von cosd inklusive).
const FULL: Record<string, FredHistoryPoint[]> = {
  DFII10: series("daily", "2010-01-01", "2026-10-09", 1),
  DTWEXBGS: series("daily", "2010-01-01", "2026-10-09", 110),
  T10YIE: series("daily", "2010-01-01", "2026-10-09", 2),
  WALCL: series("weekly", "2010-01-06", "2026-10-08", 4_000_000),
  M2SL: series("monthly", "2010-01-01", "2026-09-01", 9000),
  FEDFUNDS: series("monthly", "2010-01-01", "2026-09-01", 0.1),
  WTREGEN: series("weekly", "2010-01-06", "2026-10-08", 700_000),
  RRPONTSYD: series("daily", "2010-01-01", "2026-10-09", 300),
};
let directCalls = 0;
function fred(id: string, start: string): FredHistoryPoint[] {
  directCalls++;
  const all = FULL[id] ?? [];
  const monthly = all.every((p) => p.date.endsWith("-01"));
  return all.filter((p) => p.date >= start || (monthly && p.date.slice(0, 7) === start.slice(0, 7))).map((p) => ({ ...p }));
}

const startDate = "2016-10-11";
const m2Start = iso(new Date(Date.parse(`${startDate}T00:00:00Z`) - 400 * 864e5));
// Reihenfolge wie in server/gold-routes.ts: Real10Y, Chart-Overlays, Multi-Faktor, adaptive Schicht.
const ROUTE_CALLS: Array<[string, string]> = [
  ["DFII10", startDate],
  ["DTWEXBGS", startDate], ["T10YIE", startDate], ["WALCL", startDate], ["M2SL", m2Start],
  ["DTWEXBGS", startDate], ["WALCL", startDate],
  ["FEDFUNDS", startDate], ["M2SL", startDate], ["WALCL", startDate], ["WTREGEN", startDate],
  ["RRPONTSYD", startDate], ["T10YIE", startDate], ["DTWEXBGS", startDate],
];

console.log("\nRoute-Reihenfolge: direkt vs. Memo");
{
  directCalls = 0;
  const before = ROUTE_CALLS.map(([id, s]) => fred(id, s));
  const beforeCalls = directCalls;
  directCalls = 0;
  const memo = createFredHistoryMemo(fred);
  const after = ROUTE_CALLS.map(([id, s]) => memo.get(id, s));
  check("JSON aller Aufrufer byte-gleich", JSON.stringify(before) === JSON.stringify(after));
  ROUTE_CALLS.forEach(([id, s], i) => {
    if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) check(`${id}@${s} gleich`, false);
  });
  check(`vorher ${beforeCalls} Abrufe`, beforeCalls === 14, String(beforeCalls));
  check(`nachher 8 Abrufe (jede Serie einmal)`, directCalls === 8 && memo.fetches === 8, `${directCalls}/${memo.fetches}`);
  check("14 Anfragen gezaehlt", memo.requests === 14);
  // Ein Aufrufer, der seine Kopie veraendert, darf andere nicht treffen.
  after[1][0].value = -999;
  check("Kopien sind unabhaengig", memo.get("DTWEXBGS", startDate)[0].value !== -999);
}

console.log("\ncosd-Nachbau");
{
  const m = FULL.M2SL;
  check("Monatsreihe: Monat von cosd inklusive", sliceLikeCosd(m, "2016-10-11")[0].date === "2016-10-01");
  check("Tagesreihe: ab cosd", sliceLikeCosd(FULL.DFII10, "2016-10-11")[0].date >= "2016-10-11");
  check("Wochenreihe: ab cosd", sliceLikeCosd(FULL.WALCL, "2016-10-11")[0].date >= "2016-10-11");
  check("leere Reihe bleibt leer", sliceLikeCosd([], "2016-10-11").length === 0);
}

console.log("\nFehlerpfad wie vorher");
{
  let calls = 0;
  const memo = createFredHistoryMemo(() => { calls++; return []; });
  memo.get("WALCL", startDate); memo.get("WALCL", startDate);
  check("leerer Abruf wird nicht gemerkt (zweiter Versuch wie vorher)", calls === 2);
  let c2 = 0;
  const memo2 = createFredHistoryMemo((id, s) => { c2++; return fred(id, s); });
  memo2.get("M2SL", startDate); memo2.get("M2SL", m2Start);
  check("frueherer Start loest neuen Abruf aus", c2 === 2);
}

console.log("\nRoute nutzt das Memo");
{
  const src = readFileSync(new URL("../server/gold-routes.ts", import.meta.url), "utf-8");
  check("createFredHistoryMemo eingebunden", src.includes("createFredHistoryMemo(fetchFREDSeriesHistory)"));
  const direct = (src.match(/fetchFREDSeriesHistory\("/g) ?? []).length;
  check("keine direkten Historien-Abrufe mehr im Handler", direct === 0, String(direct));
}

if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll gold FRED memo checks passed.");
