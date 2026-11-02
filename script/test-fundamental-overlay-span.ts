/**
 * Earnings Yield und ROIC je Kurskerze, mit Vorlauf vor dem Fenster.
 * Aufruf: npx tsx script/test-fundamental-overlay-span.ts
 */
import { readFileSync } from "node:fs";
import {
  EARNINGS_YIELD_FORMULA,
  ROIC_5Y_LABEL,
  joinFundamentalsOntoPrices,
  rollingRoicSeries,
  type EpsQuarter,
  type RoicPeriod,
} from "../shared/earnings-yield-roic";
import { loadEarningsYield, loadRoicSeries, resetFundamentalCacheForTests } from "../server/earnings-yield-roic-route";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (!cond) {
    failures++;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ""}`);
  } else {
    console.log(`✅ ${label}`);
  }
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function quarterEnds(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const month = cursor.getUTCMonth();
    const quarterMonth = month - (month % 3) + 2;
    const stamp = new Date(Date.UTC(cursor.getUTCFullYear(), quarterMonth + 1, 0));
    const iso = stamp.toISOString().slice(0, 10);
    if (iso >= from && iso <= to && !out.includes(iso)) out.push(iso);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 3, 1));
  }
  return out;
}

function seriesFor(ends: string[]): { quarters: EpsQuarter[]; roic: RoicPeriod[] } {
  const quarters: EpsQuarter[] = ends.map(periodEnd => ({
    periodEnd,
    asOf: shiftDays(periodEnd, 20),
    eps: 1,
    currency: "USD",
    source: "FMP income-statement",
  }));
  const roic: RoicPeriod[] = ends.map(periodEnd => ({
    periodEnd,
    asOf: shiftDays(periodEnd, 20),
    value: 5,
  }));
  return { quarters, roic };
}

function firstValued(points: Array<{ date: string; earningsYieldPct: number | null; roicPct: number | null }>, key: "earningsYieldPct" | "roicPct"): string | null {
  return points.find(point => point[key] != null)?.date ?? null;
}

function joinWindow(
  priceDates: string[],
  quarters: EpsQuarter[],
  roic: ReturnType<typeof rollingRoicSeries>,
  prints: { asOf: string; eps: number; currency: string | null }[] = [],
  annual: { asOf: string; eps: number; currency: string | null }[] = [],
  priceCurrency: string | null = "USD",
) {
  return joinFundamentalsOntoPrices(priceDates, {
    earningsYield: null,
    epsQuarters: quarters,
    ttmPrints: prints,
    annualEps: annual,
    priceCurrency,
    roic: roic.points,
    roicSeriesNote: roic.note,
    peerRoic: null,
    peerBars: null,
    subjectCloses: priceDates.map(() => 80),
    showEarningsYield: true,
    showRoic: true,
    showPeerRoic: false,
    showPeerPrice: false,
  });
}

const longEnds = quarterEnds("2010-01-01", "2026-09-30");
const long = seriesFor(longEnds);
const longRoic = rollingRoicSeries(long.roic);
const tenYear = ["2016-10-24", "2020-06-15", "2026-11-02"];
const threeMonth = ["2026-08-03", "2026-11-02"];
const tenJoined = joinWindow(tenYear, long.quarters, longRoic);
const threeJoined = joinWindow(threeMonth, long.quarters, longRoic);

check("10Y: Earnings Yield beginnt am linken Rand", firstValued(tenJoined, "earningsYieldPct") === "2016-10-24", firstValued(tenJoined, "earningsYieldPct") ?? "");
check("10Y: ROIC beginnt am linken Rand", firstValued(tenJoined, "roicPct") === "2016-10-24", firstValued(tenJoined, "roicPct") ?? "");
check("10Y: Yield ist TTM-EPS / Kurs", tenJoined[0].earningsYieldPct === 5 && tenJoined[0].earningsYieldNote?.includes(EARNINGS_YIELD_FORMULA) === true && tenJoined[0].earningsYieldNote?.includes("Quelle:") === true, `${tenJoined[0].earningsYieldPct} ${tenJoined[0].earningsYieldNote}`);
check("10Y: ROIC ist der 5J-Mittelwert aus Quartalen", longRoic.label === ROIC_5Y_LABEL && tenJoined[0].roicPct === 20 && tenJoined[0].roicNote?.includes("5 Jahre") === true && tenJoined[0].roicNote?.includes("Formel:") === true, `${tenJoined[0].roicPct} ${tenJoined[0].roicNote}`);
check("3M: Earnings Yield beginnt am linken Rand", firstValued(threeJoined, "earningsYieldPct") === "2026-08-03");
check("3M: ROIC beginnt am linken Rand", firstValued(threeJoined, "roicPct") === "2026-08-03");

const short = seriesFor(quarterEnds("2024-12-31", "2026-09-30"));
const shortJoined = joinWindow(tenYear, short.quarters, rollingRoicSeries(short.roic));
check("ohne Vorlauf bleibt der 10Y-Rand n/a mit Grund", shortJoined[0].earningsYieldPct === null && shortJoined[0].roicPct === null && (shortJoined[0].earningsYieldNote ?? "").includes("n/a") && (shortJoined[0].roicNote ?? "").includes("n/a"), `${shortJoined[0].earningsYieldNote} | ${shortJoined[0].roicNote}`);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead as {
  MSFT: { overallScore: number };
};
check("MSFT-Pin 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138");

console.log("\n=== Live: MSFT und SAP.DE, 10Y und 3M ===");
resetFundamentalCacheForTests();
for (const symbol of ["MSFT", "SAP.DE"]) {
  const ey = await loadEarningsYield(symbol);
  const roic = await loadRoicSeries(symbol);
  const priceCcy = ey.quarters.find(row => row.currency)?.currency ?? ey.ttmPrints.find(row => row.currency)?.currency ?? null;
  const rolled = { points: roic.points, formula: roic.formula, label: roic.label, note: roic.note };
  const ten = joinWindow(["2016-10-24", "2026-11-02"], ey.quarters, rolled, ey.ttmPrints, ey.annualEps, priceCcy);
  const three = joinWindow(["2026-08-03", "2026-11-02"], ey.quarters, rolled, ey.ttmPrints, ey.annualEps, priceCcy);
  console.log(`${symbol} 10Y Start 2016-10-24 | EY ${ten[0].earningsYieldPct == null ? "n/a" : ten[0].date} | ROIC ${ten[0].roicPct == null ? "n/a" : ten[0].date}`);
  console.log(`${symbol} 3M Start 2026-08-03 | EY ${three[0].earningsYieldPct == null ? "n/a" : three[0].date} | ROIC ${three[0].roicPct == null ? "n/a" : three[0].date}`);
  console.log(`  EY-Quelle: ${ey.source}${ey.note ? ` | ${ey.note}` : ""}`);
  console.log(`  ROIC-Quelle: ${roic.source}${roic.note ? ` | ${roic.note}` : ""}`);
  console.log(`  gezeichnet 10Y EY ${ten[0].earningsYieldPct ?? "n/a"} (${ten[0].earningsYieldNote ?? ""}) ROIC ${ten[0].roicPct ?? "n/a"} (${ten[0].roicNote ?? ""})`);
  console.log(`  gezeichnet 3M EY ${three[0].earningsYieldPct ?? "n/a"} (${three[0].earningsYieldNote ?? ""}) ROIC ${three[0].roicPct ?? "n/a"} (${three[0].roicNote ?? ""})`);
}

if (failures > 0) {
  console.error(`\n${failures} Fehler`);
  process.exit(1);
}
console.log("\nFundamental-Overlay Spanne ok");
