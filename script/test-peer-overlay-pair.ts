/**
 * Peer-Paar MSFT/ORCL: Tooltip des Haupttitels und Peer-Dividendenrendite.
 * Aufruf: npx tsx script/test-peer-overlay-pair.ts
 *
 * FIXTURE, wenn FMP_API_KEY fehlt. Die Zahlen sind dann gesetzt und als FIXTURE
 * markiert, nicht live abgerufen. Ohne Key prüft der Lauf den Yahoo-Jahres-Fallback.
 * Mit Key prüft er die FMP-TTM zum Filing-Datum, nicht den Yahoo-Jahreswert.
 */
import { readFileSync } from "node:fs";
import {
  DIVIDEND_YIELD_FORMULA,
  DIVIDEND_YIELD_SOURCE_POLICY,
  dividendSourceCaption,
  peerDividendYieldOnDates,
  type DividendEvent,
} from "../shared/dividends";
import {
  EARNINGS_YIELD_FORMULA,
  EARNINGS_YIELD_SOURCE,
  estimateBadge,
  joinFundamentalsOntoPrices,
  type EpsQuarter,
  type FundamentalPoint,
} from "../shared/earnings-yield-roic";
import { epsQuartersFromIncomeRows } from "../server/earnings-yield-roic-route";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (!cond) {
    failures++;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ""}`);
  } else {
    console.log(`✅ ${label}`);
  }
}

const FIXTURE = !process.env.FMP_API_KEY;
console.log(FIXTURE
  ? "FIXTURE: kein FMP_API_KEY — Join-Paar mit gesetzten Werten. Yahoo-Filings werden danach ohne Key gelesen."
  : "FMP_API_KEY vorhanden — Fixture plus Live-Prüfung der FMP-TTM zum Filing.");

/** Tooltip vom 04.05.2023: MSFT-Kurs und ORCL-Peer-Kurs aus der gemeldeten Ansicht. */
const HOVER = "2023-05-04";
const MSFT_CLOSE = 305.41;
const ORCL_CLOSE = 94.97;
const MSFT_EPS = 2;
const ORCL_EPS = 0.25;
const MSFT_ROIC = 32.5;
const ORCL_ROIC = 10.3;

function quarters(eps: number, source: string): EpsQuarter[] {
  return [
    { periodEnd: "2022-06-30", asOf: "2022-07-26", eps, currency: "USD", source },
    { periodEnd: "2022-09-30", asOf: "2022-10-25", eps, currency: "USD", source },
    { periodEnd: "2022-12-31", asOf: "2023-01-24", eps, currency: "USD", source },
    { periodEnd: "2023-03-31", asOf: "2023-04-25", eps, currency: "USD", source },
  ];
}

function roicPoint(date: string, value: number): FundamentalPoint {
  return { date, value, note: "Formel: Mittelwert der Quartals-ROIC-TTM über die letzten 5 Jahre · Quelle: FIXTURE" };
}

function pair(subject: "MSFT" | "ORCL") {
  const msftIsSubject = subject === "MSFT";
  const close = msftIsSubject ? MSFT_CLOSE : ORCL_CLOSE;
  const eps = msftIsSubject ? MSFT_EPS : ORCL_EPS;
  const ownRoic = msftIsSubject ? MSFT_ROIC : ORCL_ROIC;
  const peerRoic = msftIsSubject ? ORCL_ROIC : MSFT_ROIC;
  return joinFundamentalsOntoPrices([HOVER], {
    earningsYield: null,
    epsQuarters: quarters(eps, "FIXTURE"),
    ttmPrints: [],
    annualEps: [],
    priceCurrency: "USD",
    roic: [roicPoint("2023-04-25", ownRoic)],
    peerRoic: [roicPoint("2023-03-10", peerRoic)],
    peerBars: [{ date: HOVER, close: msftIsSubject ? ORCL_CLOSE : MSFT_CLOSE }],
    subjectCloses: [close],
    showEarningsYield: false,
    showRoic: false,
    showPeerRoic: true,
    showPeerPrice: true,
    resolveEarningsYield: true,
    resolveRoic: true,
  })[0];
}

const msft = pair("MSFT");
const msftYield = (MSFT_EPS * 4 / MSFT_CLOSE) * 100;
check(
  "FIXTURE MSFT Haupttitel: EY am 04.05.2023 ist TTM-EPS / Kurs, nicht leer",
  msft.earningsYieldKnown != null && Math.abs((msft.earningsYieldKnown ?? 0) - msftYield) < 1e-9
    && msft.earningsYieldNote?.includes(EARNINGS_YIELD_FORMULA) === true
    && msft.earningsYieldNote?.includes("FIXTURE") === true
    && msft.earningsYieldNote?.includes("kein Wert") !== true,
  `${msft.earningsYieldKnown} ${msft.earningsYieldNote}`,
);
check(
  "FIXTURE MSFT: EY-Linie bleibt aus, der Tooltip-Wert steht",
  msft.earningsYieldPct === null && msft.earningsYieldKnown != null,
);
check(
  "FIXTURE MSFT Haupttitel: ROIC ist der letzte berichtete Wert vor dem Tag",
  msft.roicKnown === MSFT_ROIC && msft.roicPct === null && msft.roicNote?.includes("Formel:") === true && msft.roicNote?.includes("kein Wert") !== true,
  msft.roicNote ?? "",
);
check(
  "FIXTURE ORCL als Peer von MSFT: Peer-ROIC 10,3",
  msft.peerRoicKnown === ORCL_ROIC && msft.peerPriceRaw === ORCL_CLOSE,
  `${msft.peerRoicKnown} ${msft.peerPriceRaw}`,
);

const orcl = pair("ORCL");
const orclYield = (ORCL_EPS * 4 / ORCL_CLOSE) * 100;
check(
  "FIXTURE ORCL Haupttitel: EY und ROIC kommen an, MSFT ist der Peer",
  orcl.earningsYieldKnown != null && Math.abs((orcl.earningsYieldKnown ?? 0) - orclYield) < 1e-9
    && orcl.roicKnown === ORCL_ROIC
    && orcl.peerRoicKnown === MSFT_ROIC
    && orcl.peerPriceRaw === MSFT_CLOSE,
  `${orcl.earningsYieldKnown} roic ${orcl.roicKnown} peer ${orcl.peerRoicKnown}`,
);

const negative = joinFundamentalsOntoPrices([HOVER], {
  earningsYield: null,
  epsQuarters: quarters(-1, "FIXTURE"),
  priceCurrency: "USD",
  roic: [roicPoint("2023-04-25", -2.5)],
  peerRoic: null,
  peerBars: null,
  subjectCloses: [50],
  showEarningsYield: true,
  showRoic: true,
  showPeerRoic: false,
  showPeerPrice: false,
});
check(
  "negatives EPS bleibt sichtbar (#434)",
  negative[0].earningsYieldKnown === -8 && negative[0].earningsYieldPct === -8 && negative[0].roicKnown === -2.5,
  String(negative[0].earningsYieldKnown),
);
const negQuarter = epsQuartersFromIncomeRows([
  { date: "2026-09-30", period: "Q3", epsDiluted: -9.29, filingDate: "2026-09-30", reportedCurrency: "EUR" },
]);
check("negatives Quartals-EPS wird nicht verworfen", negQuarter.quarters[0]?.eps === -9.29);

const estimateNote = "Schätzung: Quartal annualisiert · Quelle: Yahoo · Formel: jüngstes Quartals-EPS × 4 / Kurs";
check("Schätzung trägt Badge, Quelle und Formel", estimateBadge(estimateNote) === "Schätzung" && estimateNote.includes("Quelle:") && estimateNote.includes("Formel:"));
check("berichteter Fallback ist keine Schätzung", estimateBadge("Fallback: trailing EPS · Quelle: Yahoo") === null);

const orclDiv: DividendEvent[] = [
  { date: "2022-05-02", amount: 0.32 },
  { date: "2022-08-01", amount: 0.32 },
  { date: "2022-11-01", amount: 0.32 },
  { date: "2023-02-01", amount: 0.32 },
  { date: "2023-05-01", amount: 0.4 },
];
const peerYield = peerDividendYieldOnDates(
  [HOVER, "2023-05-08"],
  [{ date: HOVER, close: ORCL_CLOSE }],
  orclDiv,
);
const windowSum = 0.32 + 0.32 + 0.32 + 0.4;
const expectedPeer = Math.round((windowSum / ORCL_CLOSE) * 10000) / 100;
check(
  "FIXTURE Peer-Div ORCL auf MSFT-Tag: Dividende TTM / Peer-Kurs",
  peerYield[0]?.yieldPct === expectedPeer && peerYield[0]?.note == null && DIVIDEND_YIELD_FORMULA === "Dividende TTM / Kurs",
  `${peerYield[0]?.yieldPct} erwartet ${expectedPeer} ${peerYield[0]?.note ?? ""}`,
);
check(
  "Peer-Rendite wird bis zum nächsten Peer-Kurs gehalten, nicht interpoliert",
  peerYield[1]?.yieldPct === expectedPeer && peerYield[1]?.date === "2023-05-08",
);
const beforePrice = peerDividendYieldOnDates(["2023-05-03"], [{ date: HOVER, close: ORCL_CLOSE }], orclDiv);
check("vor dem ersten Peer-Kurs bleibt die Rendite leer und nennt den Grund", beforePrice[0]?.yieldPct == null && beforePrice[0]?.note?.includes("Peer-Kurs") === true, beforePrice[0]?.note ?? "");

const msftDiv: DividendEvent[] = [
  { date: "2022-02-16", amount: 0.62 },
  { date: "2022-05-18", amount: 0.62 },
  { date: "2022-08-17", amount: 0.62 },
  { date: "2022-11-16", amount: 0.68 },
  { date: "2023-02-15", amount: 0.68 },
  { date: "2023-05-17", amount: 0.68 },
];
const reverseDiv = peerDividendYieldOnDates(
  [HOVER],
  [{ date: HOVER, close: MSFT_CLOSE }],
  msftDiv,
);
const msftSum = 0.62 + 0.62 + 0.68 + 0.68;
const expectedMsft = Math.round((msftSum / MSFT_CLOSE) * 10000) / 100;
check(
  "FIXTURE umgekehrt: MSFT-Dividende auf dem ORCL-Tag, Kurs ist der Peer-Kurs",
  reverseDiv[0]?.yieldPct === expectedMsft && reverseDiv[0]?.ttmDividend === Math.round(msftSum * 10000) / 10000,
  `${reverseDiv[0]?.yieldPct} ${reverseDiv[0]?.ttmDividend} note ${reverseDiv[0]?.note ?? ""}`,
);
check("Quelle nennt FMP zuerst und Yahoo als Fallback", dividendSourceCaption("fmp").includes(DIVIDEND_YIELD_SOURCE_POLICY) && dividendSourceCaption("yahoo").startsWith("Yahoo"));
check("leere Peer-Dividende nennt den Grund", peerDividendYieldOnDates([HOVER], [{ date: HOVER, close: 100 }], [], "n/a — FMP ohne Dividenden, Yahoo ohne Dividenden")[0]?.note === "n/a — FMP ohne Dividenden, Yahoo ohne Dividenden");

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead as {
  VWAGY: { overallScore: number };
  SAP: { overallScore: number };
  MSFT: { overallScore: number };
};
check("VOW3 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718");
check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758");
check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138");

const chart = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
const route = readFileSync("server/earnings-yield-roic-route.ts", "utf8");
check("Chart lädt EY und ROIC des Haupttitels, sobald der Peer an ist", chart.includes("useEarningsYield(data.ticker, fundActive)") && chart.includes("useRoicSeries(data.ticker, fundActive)"));
check("Tooltip liest die bekannten Werte, nicht nur die gezeichnete Linie", chart.includes("_eyKnown") && chart.includes("_roicKnown") && chart.includes("data-testid=\"tooltip-earnings-yield\"") && chart.includes("data-testid=\"tooltip-roic\""));
check("Peer-Div-Yield ist die zweite Linie und nennt Formel und Quelle", chart.includes("dataKey=\"_peerDivYield\"") && chart.includes("DIVIDEND_YIELD_FORMULA") && chart.includes("data-testid=\"tooltip-peer-div-source\"") && chart.includes("useDividendHistory(peerQuery, showDividend && peerOn)"));
check("Schätzung hat ein Badge", chart.includes("data-testid=\"badge-schaetzung\"") && chart.includes("estimateBadge"));
check(".DE bleibt Yahoo zuerst, dann FMP", route.includes("if (isGermanXetraTicker(symbol)) return loadGermanEarningsYield") && route.includes("if (isGermanXetraTicker(symbol)) return loadGermanRoic"));
check("analyze-route wird von der Overlay-Route nicht importiert", !/from ["'][^"']*analyze-route["']/.test(route));

/** Quartale, deren Filing am Stichtag bekannt ist. Ein Periodenende behält das spätere Filing. */
function pitQuarters(quarters: EpsQuarter[], asOf: string): EpsQuarter[] {
  const known = new Map<string, EpsQuarter>();
  for (const quarter of quarters) {
    if (!quarter || quarter.asOf > asOf || !Number.isFinite(quarter.eps)) continue;
    const prev = known.get(quarter.periodEnd);
    if (!prev || quarter.asOf >= prev.asOf) known.set(quarter.periodEnd, quarter);
  }
  return Array.from(known.values()).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

function lastFundPoint(points: FundamentalPoint[], asOf: string): FundamentalPoint | null {
  let hit: FundamentalPoint | null = null;
  for (const point of points) {
    if (!point?.date || point.date > asOf || point.value == null || !Number.isFinite(point.value)) continue;
    if (!hit || point.date >= hit.date) hit = point;
  }
  return hit;
}

{
  const { loadEarningsYield, loadRoicSeries, resetFundamentalCacheForTests } = await import("../server/earnings-yield-roic-route");
  const { yahooFetch } = await import("../server/history-fallback");
  resetFundamentalCacheForTests();
  const msftEy = await loadEarningsYield("MSFT");
  const msftRoic = await loadRoicSeries("MSFT");
  const orclEy = await loadEarningsYield("ORCL");
  const orclRoic = await loadRoicSeries("ORCL");
  const msftBars = await yahooFetch("MSFT", "2023-05-01", "2023-07-07");
  const orclBars = await yahooFetch("ORCL", "2023-05-01", "2023-06-02");
  const msftHover = [...msftBars].reverse().find(row => row.date <= HOVER);
  const orclHover = [...orclBars].reverse().find(row => row.date <= HOVER);
  const live = joinFundamentalsOntoPrices([HOVER], {
    earningsYield: null,
    epsQuarters: msftEy.quarters,
    ttmPrints: msftEy.ttmPrints,
    annualEps: msftEy.annualEps,
    priceCurrency: "USD",
    roic: msftRoic.points,
    roicSeriesNote: msftRoic.note,
    peerRoic: orclRoic.points,
    peerRoicSeriesNote: orclRoic.note,
    peerBars: orclHover ? [{ date: orclHover.date, close: orclHover.close }] : [],
    subjectCloses: [msftHover?.close ?? Number.NaN],
    showEarningsYield: false,
    showRoic: false,
    showPeerRoic: true,
    showPeerPrice: true,
    resolveEarningsYield: true,
    resolveRoic: true,
  })[0];
  const fmpFirst = !!process.env.FMP_API_KEY
    && msftEy.source.startsWith(EARNINGS_YIELD_SOURCE)
    && orclEy.source.startsWith(EARNINGS_YIELD_SOURCE)
    && msftRoic.source.startsWith("FMP")
    && orclRoic.source.startsWith("FMP");
  console.log(`LIVE ${fmpFirst ? "FMP-TTM" : "Yahoo-Fallback"} ${HOVER}: Quelle EY ${msftEy.source} | ROIC ${msftRoic.source}`);
  console.log(`LIVE ${HOVER}: MSFT Kurs ${msftHover?.close ?? "n/a"} EY ${live.earningsYieldKnown ?? "n/a"} (${live.earningsYieldNote}) ROIC ${live.roicKnown ?? "n/a"} (${live.roicNote}) Peer-ROIC ${live.peerRoicKnown ?? "n/a"} (${live.peerRoicNote})`);
  check("LIVE Kurs am 04.05.2023 ist der Tooltip-Kurs, Yahoo", msftHover != null && Math.abs(msftHover.close - MSFT_CLOSE) < 0.02 && orclHover != null && Math.abs(orclHover.close - ORCL_CLOSE) < 0.02, `${msftHover?.close} ${orclHover?.close}`);
  if (process.env.FMP_API_KEY) {
    check("mit Key kommt FMP vor Yahoo", fmpFirst, `${msftEy.source} | ${orclEy.source} | ${msftRoic.source} | ${orclRoic.source}`);
  }
  const afterFiling = "2023-07-03";
  const afterBar = [...msftBars].reverse().find(row => row.date <= afterFiling);
  const msftAnnual = msftEy.annualEps.find(row => row.asOf === "2023-06-30");
  const after = joinFundamentalsOntoPrices([afterFiling], {
    earningsYield: null,
    epsQuarters: msftEy.quarters,
    ttmPrints: msftEy.ttmPrints,
    annualEps: msftEy.annualEps,
    priceCurrency: "USD",
    roic: msftRoic.points,
    roicSeriesNote: msftRoic.note,
    peerRoic: orclRoic.points,
    peerRoicSeriesNote: orclRoic.note,
    peerBars: [],
    subjectCloses: [afterBar?.close ?? Number.NaN],
    showEarningsYield: true,
    showRoic: true,
    showPeerRoic: true,
    showPeerPrice: false,
    resolveEarningsYield: true,
    resolveRoic: true,
  })[0];
  const expectedAfter = afterBar && msftAnnual ? (msftAnnual.eps / afterBar.close) * 100 : Number.NaN;
  console.log(`LIVE MSFT ${afterFiling} Kurs ${afterBar?.close ?? "n/a"} Jahres-EPS ${msftAnnual?.eps ?? "n/a"} EY ${after.earningsYieldKnown ?? "n/a"} (${after.earningsYieldNote})`);
  const orclAfterDate = "2023-06-01";
  const orclAfterBar = [...orclBars].reverse().find(row => row.date <= orclAfterDate);
  const orclAnnual = orclEy.annualEps.find(row => row.asOf === "2023-05-31");
  const orclAfter = joinFundamentalsOntoPrices([orclAfterDate], {
    earningsYield: null,
    epsQuarters: orclEy.quarters,
    ttmPrints: orclEy.ttmPrints,
    annualEps: orclEy.annualEps,
    priceCurrency: "USD",
    roic: orclRoic.points,
    roicSeriesNote: orclRoic.note,
    peerRoic: msftRoic.points,
    peerRoicSeriesNote: msftRoic.note,
    peerBars: [],
    subjectCloses: [orclAfterBar?.close ?? Number.NaN],
    showEarningsYield: true,
    showRoic: true,
    showPeerRoic: true,
    showPeerPrice: false,
  })[0];
  const expectedOrcl = orclAfterBar && orclAnnual ? (orclAnnual.eps / orclAfterBar.close) * 100 : Number.NaN;
  console.log(`LIVE ORCL ${orclAfterDate} Kurs ${orclAfterBar?.close ?? "n/a"} Jahres-EPS ${orclAnnual?.eps ?? "n/a"} EY ${orclAfter.earningsYieldKnown ?? "n/a"} (${orclAfter.earningsYieldNote}) Peer-ROIC ${orclAfter.peerRoicKnown ?? "n/a"}`);
  if (fmpFirst) {
    const msftQ4 = msftEy.quarters.find(row => row.periodEnd === "2023-06-30");
    const orclQ4 = orclEy.quarters.find(row => row.periodEnd === "2023-05-31");
    check("MSFT Q4 FY23 ist am 03.07.2023 noch nicht gefiled", msftQ4 != null && msftQ4.asOf > afterFiling, `${msftQ4?.asOf ?? "fehlt"} ${msftQ4?.eps ?? ""}`);
    check("ORCL Q4 FY23 ist am 01.06.2023 noch nicht gefiled", orclQ4 != null && orclQ4.asOf > orclAfterDate, `${orclQ4?.asOf ?? "fehlt"} ${orclQ4?.eps ?? ""}`);
    const msftWindow = pitQuarters(msftEy.quarters, HOVER).slice(-4);
    const msftLater = pitQuarters(msftEy.quarters, afterFiling).slice(-4);
    const orclWindow = pitQuarters(orclEy.quarters, orclAfterDate).slice(-4);
    const msftSum = msftWindow.reduce((total, row) => total + row.eps, 0);
    const msftLaterSum = msftLater.reduce((total, row) => total + row.eps, 0);
    const orclSum = orclWindow.reduce((total, row) => total + row.eps, 0);
    const msftEyAtHover = msftHover ? (msftSum / msftHover.close) * 100 : Number.NaN;
    const msftEyAfter = afterBar ? (msftLaterSum / afterBar.close) * 100 : Number.NaN;
    const orclEyAt = orclAfterBar ? (orclSum / orclAfterBar.close) * 100 : Number.NaN;
    check(
      "LIVE FMP MSFT 04.05.2023: TTM der vier Filings vor dem Tag, Tooltip 3,0 %",
      msftWindow.length === 4
        && msftWindow.every(row => row.asOf <= HOVER)
        && msftWindow[0]?.periodEnd === "2022-06-30"
        && msftWindow[3]?.periodEnd === "2023-03-31"
        && Math.abs(msftSum - 9.23) < 0.08
        && live.earningsYieldKnown != null
        && Math.abs(live.earningsYieldKnown - msftEyAtHover) < 1e-6
        && live.earningsYieldKnown.toFixed(1) === "3.0"
        && live.earningsYieldNote?.includes(EARNINGS_YIELD_FORMULA) === true
        && live.earningsYieldNote?.includes("FMP") === true
        && live.earningsYieldNote?.includes("Jahres-EPS") !== true
        && live.earningsYieldNote?.includes("kein Wert") !== true,
      `sum ${msftSum} ey ${live.earningsYieldKnown} ${live.earningsYieldNote}`,
    );
    const msftRoicHit = lastFundPoint(msftRoic.points, HOVER);
    const orclRoicHit = lastFundPoint(orclRoic.points, HOVER);
    check(
      "LIVE FMP MSFT 04.05.2023: ROIC ist der letzte Punkt zum Filing, nicht leer",
      msftRoicHit != null
        && msftRoicHit.date <= HOVER
        && msftRoicHit.date >= "2023-01-01"
        && live.roicKnown === msftRoicHit.value
        && Math.abs(msftRoicHit.value - 20) < 1
        && orclRoicHit != null
        && live.peerRoicKnown === orclRoicHit.value
        && Math.abs(orclRoicHit.value - 10.3) < 1
        && (live.roicNote ?? "").includes("Formel:")
        && (live.roicNote ?? "").includes("kein Wert") !== true,
      `roic ${live.roicKnown} am ${msftRoicHit?.date} peer ${live.peerRoicKnown} am ${orclRoicHit?.date} ${live.roicNote}`,
    );
    check(
      "LIVE FMP MSFT 03.07.2023: EY bleibt die TTM vor dem Q4-Filing, nicht das Yahoo-Jahres-EPS",
      msftLater.length === 4
        && msftLater[3]?.periodEnd === "2023-03-31"
        && Math.abs(msftLaterSum - msftSum) < 1e-9
        && after.earningsYieldKnown != null
        && Math.abs(after.earningsYieldKnown - msftEyAfter) < 1e-6
        && Math.abs(after.earningsYieldKnown - 2.73) < 0.08
        && after.earningsYieldNote?.includes("Jahres-EPS") !== true
        && after.earningsYieldNote?.includes("FMP") === true,
      `sum ${msftLaterSum} ey ${after.earningsYieldKnown} ${after.earningsYieldNote}`,
    );
    check(
      "LIVE FMP ORCL 01.06.2023: EY ist die TTM vor dem Q4-Filing, nicht das Yahoo-Jahres-EPS",
      orclWindow.length === 4
        && orclWindow.every(row => row.asOf <= orclAfterDate)
        && orclWindow[0]?.periodEnd === "2022-05-31"
        && orclWindow[3]?.periodEnd === "2023-02-28"
        && Math.abs(orclSum - 3.03) < 0.03
        && orclAfter.earningsYieldKnown != null
        && Math.abs(orclAfter.earningsYieldKnown - orclEyAt) < 1e-6
        && Math.abs(orclAfter.earningsYieldKnown - 2.86) < 0.05
        && orclAfter.earningsYieldNote?.includes("Jahres-EPS") !== true
        && orclAfter.earningsYieldNote?.includes(EARNINGS_YIELD_FORMULA) === true,
      `sum ${orclSum} ey ${orclAfter.earningsYieldKnown} ${orclAfter.earningsYieldNote}`,
    );
  } else {
    check("LIVE am 04.05.2023 nennt EY einen Grund, nicht „kein Wert“ — Yahoo-Jahres-EPS beginnt am 30.06.2023", live.earningsYieldKnown == null && (live.earningsYieldNote ?? "").includes("n/a") && !(live.earningsYieldNote ?? "").includes("kein Wert"), live.earningsYieldNote ?? "");
    check("LIVE am 04.05.2023 nennt ROIC einen Grund — der erste Yahoo-Jahres-ROIC ist der 30.06.2023", live.roicKnown == null && (live.roicNote ?? "").includes("n/a") && !(live.roicNote ?? "").includes("kein Wert"), live.roicNote ?? "");
    check(
      "LIVE nach dem Filing 30.06.2023 ist EY das Jahres-EPS dieses Filings / Kurs",
      msftAnnual != null && msftAnnual.eps > 8 && msftAnnual.eps < 12 && after.earningsYieldKnown != null && Math.abs((after.earningsYieldKnown ?? 0) - expectedAfter) < 1e-9 && after.earningsYieldNote?.includes("Jahres-EPS") === true && after.earningsYieldNote?.includes("Quelle:") === true,
      `${msftAnnual?.eps} ${after.earningsYieldKnown} ${after.earningsYieldNote}`,
    );
    check(
      "LIVE umgekehrt: ORCL nach dem Filing 31.05.2023 nutzt das Jahres-EPS dieses Filings",
      orclAnnual != null && orclAnnual.eps > 2 && orclAnnual.eps < 5 && orclAfter.earningsYieldKnown != null && Math.abs((orclAfter.earningsYieldKnown ?? 0) - expectedOrcl) < 1e-9 && orclAfter.earningsYieldNote?.includes("Jahres-EPS") === true,
      `${orclAnnual?.eps} ${orclAfter.earningsYieldKnown} ${orclAfter.earningsYieldNote}`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} Fehler`);
  process.exit(1);
}
console.log("\nPeer-Paar MSFT/ORCL ok");
