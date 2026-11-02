/**
 * Earnings Yield und ROIC je Kurskerze, mit Vorlauf vor dem Fenster.
 * Aufruf: npx tsx script/test-fundamental-overlay-span.ts
 */
import { readFileSync } from "node:fs";
import {
  EARNINGS_YIELD_FORMULA,
  ROIC_5Y_LABEL,
  earningsYieldFromTtm,
  epsNumeratorAt,
  joinFundamentalsOntoPrices,
  rollingRoicSeries,
  ttmPrintAt,
  type EpsQuarter,
  type RoicPeriod,
} from "../shared/earnings-yield-roic";
import { loadEarningsYield, loadRoicSeries, resetFundamentalCacheForTests } from "../server/earnings-yield-roic-route";
import { yahooFetch } from "../server/history-fallback";

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

/** Doublecheck: EY darf vom Kehrwert des berichteten KGV höchstens so weit abweichen. */
const EY_VERSUS_REPORTED_PE_BAND = 0.1;
const EY_PE_DATES = ["2026-06-30", "2026-08-03", "2026-10-30"] as const;
const SAP_EY_DATES = ["2022-12-31", "2023-09-30", "2026-10-30"] as const;

const partial = epsNumeratorAt(
  [
    { periodEnd: "2025-06-30", asOf: "2025-06-30", eps: 1.44, currency: "EUR", source: "Yahoo" },
    { periodEnd: "2025-12-31", asOf: "2025-12-31", eps: 1.57, currency: "EUR", source: "Yahoo" },
  ],
  [{ asOf: "2025-12-31", eps: 6.1, currency: "EUR", source: "Yahoo" }],
  [{ asOf: "2022-12-31", eps: 1.95, currency: "EUR", source: "Yahoo" }],
  "2025-12-31",
);
check("unvollständige Quartalssumme verdrängt das berichtete TTM nicht", partial.eps === 6.1 && partial.note?.includes("Fallback: trailing EPS") === true && partial.note?.includes("Quelle: Yahoo") === true, `${partial.eps} ${partial.note}`);

const fxJoined = joinFundamentalsOntoPrices(["2023-09-30"], {
  earningsYield: null,
  epsQuarters: [],
  ttmPrints: [{ asOf: "2023-09-30", eps: 4.55, currency: "EUR", source: "Yahoo" }],
  annualEps: [],
  priceCurrency: "USD",
  priceFx: {
    from: "EUR",
    to: "USD",
    rate: 1.12016,
    history: [{ date: "2023-09-29", rate: 1.05, source: "Yahoo EURUSD=X" }],
  },
  roic: null,
  peerRoic: null,
  peerBars: null,
  subjectCloses: [100 * 1.12016],
  showEarningsYield: true,
  showRoic: false,
  showPeerRoic: false,
  showPeerPrice: false,
});
check(
  "historischer EURUSD ersetzt den Spotkurs in der Kerze",
  fxJoined[0].earningsYieldPct != null && Math.abs(fxJoined[0].earningsYieldPct - 4.55) < 1e-9 && fxJoined[0].earningsYieldNote?.includes("2023-09-29") === true && fxJoined[0].earningsYieldNote?.includes("1.05") === true,
  `${fxJoined[0].earningsYieldPct} ${fxJoined[0].earningsYieldNote}`,
);

console.log("\n=== EY gegen 1/KGV, Kurs aus Yahoo, nicht aus einem Festwert ===");
resetFundamentalCacheForTests();
for (const symbol of ["MSFT", "ORCL", "SAP.DE"]) {
  const ey = await loadEarningsYield(symbol);
  const bars = await yahooFetch(symbol, "2026-06-01", "2026-11-03");
  const priceCcy = ey.quarters.find(row => row.currency)?.currency ?? ey.ttmPrints.find(row => row.currency)?.currency ?? null;
  for (const date of EY_PE_DATES) {
    const bar = [...bars].reverse().find(row => row.date <= date);
    const numerator = epsNumeratorAt(ey.quarters, ey.ttmPrints, ey.annualEps, date);
    const reported = ttmPrintAt(ey.ttmPrints, date);
    const yieldHit = numerator.eps != null && bar
      ? earningsYieldFromTtm(numerator.eps, bar.close, numerator.currency, priceCcy)
      : { value: null, note: numerator.note };
    const kgv = reported.eps != null && bar && reported.eps !== 0 ? bar.close / reported.eps : null;
    const implied = kgv != null && kgv !== 0 ? 100 / kgv : null;
    const gap = yieldHit.value != null && implied != null && implied !== 0 ? Math.abs(yieldHit.value - implied) / Math.abs(implied) : null;
    const line = `${symbol} ${date} Kurs ${bar?.close?.toFixed(2) ?? "n/a"} TTM ${numerator.eps?.toFixed(2) ?? "n/a"} EY ${yieldHit.value?.toFixed(2) ?? "n/a"} % KGV ${kgv?.toFixed(2) ?? "n/a"} 1/KGV ${implied?.toFixed(2) ?? "n/a"} % Abweichung ${gap == null ? "n/a" : `${(gap * 100).toFixed(1)} %`} ${numerator.note ?? ""}`;
    console.log(line);
    check(`${symbol} ${date} EY nahe 1/KGV`, gap != null && gap < EY_VERSUS_REPORTED_PE_BAND, line);
  }
}

const sap = await loadEarningsYield("SAP.DE");
const sapRoic = await loadRoicSeries("SAP.DE");
console.log(`SAP.DE quarters ${sap.quarters.length} ab ${sap.quarters[0]?.periodEnd ?? "—"}`);
console.log(`SAP.DE ttmPrints ${sap.ttmPrints.length} ab ${sap.ttmPrints[0]?.asOf ?? "—"}`);
console.log(`SAP.DE annualEps ${sap.annualEps.length} ab ${sap.annualEps[0]?.asOf ?? "—"}`);
console.log(`SAP.DE ROIC ${sapRoic.points.length} ab ${sapRoic.points[0]?.date ?? "—"} ${sapRoic.label}`);
check("SAP.DE hat trailing und Jahres-EPS neben den fünf Quartalen", sap.quarters.length >= 1 && sap.ttmPrints.length > sap.quarters.length && (sap.annualEps[0]?.asOf ?? "9999") <= "2022-12-31", `${sap.quarters.length}/${sap.ttmPrints.length}/${sap.annualEps[0]?.asOf}`);
check("SAP.DE ROIC beginnt vor den letzten Quartalen", sapRoic.points.length >= 3 && (sapRoic.points[0]?.date ?? "9999") < "2025-01-01", sapRoic.points.map(p => p.date).join(","));
const sapBars = await yahooFetch("SAP.DE", "2022-01-01", "2026-11-03");
for (const date of SAP_EY_DATES) {
  const bar = [...sapBars].reverse().find(row => row.date <= date);
  const numerator = epsNumeratorAt(sap.quarters, sap.ttmPrints, sap.annualEps, date);
  const reported = ttmPrintAt(sap.ttmPrints, date);
  const benchmark = reported.eps ?? (date >= (sap.annualEps[0]?.asOf ?? "9999") ? [...sap.annualEps].reverse().find(row => row.asOf <= date)?.eps ?? null : null);
  const yieldHit = numerator.eps != null && bar ? earningsYieldFromTtm(numerator.eps, bar.close, numerator.currency, numerator.currency) : { value: null, note: numerator.note };
  const kgv = benchmark != null && bar && benchmark !== 0 ? bar.close / benchmark : null;
  const implied = kgv != null && kgv !== 0 ? 100 / kgv : null;
  const gap = yieldHit.value != null && implied != null && implied !== 0 ? Math.abs(yieldHit.value - implied) / Math.abs(implied) : null;
  const line = `SAP.DE ${date} Kurs ${bar?.close?.toFixed(2) ?? "n/a"} TTM ${numerator.eps?.toFixed(2) ?? "n/a"} EY ${yieldHit.value?.toFixed(2) ?? "n/a"} % KGV ${kgv?.toFixed(2) ?? "n/a"} 1/KGV ${implied?.toFixed(2) ?? "n/a"} % Abweichung ${gap == null ? "n/a" : `${(gap * 100).toFixed(1)} %`} ${numerator.note ?? ""}`;
  console.log(line);
  check(`SAP.DE ${date} EY nahe 1/KGV`, gap != null && gap < EY_VERSUS_REPORTED_PE_BAND, line);
}

if (failures > 0) {
  console.error(`\n${failures} Fehler`);
  process.exit(1);
}
console.log("\nFundamental-Overlay Spanne ok");
