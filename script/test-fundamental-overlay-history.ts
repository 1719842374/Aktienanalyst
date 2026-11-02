/**
 * Earnings Yield = TTM-EPS / Kurs je Kerze, ROIC point-in-time, Peer-Kurs über Von/Bis.
 * Aufruf: npx tsx script/test-fundamental-overlay-history.ts
 *
 * Repro Peer-ROIC (ORCL, vorher): Im Kurs-Modus war useRoicSeries aus
 * (`peerMode === "roic"`). Der Tooltip druckte fmtPct(null) = "n/a" und verwarf
 * die Note. Der Request GET /api/chart/roic/ORCL lief nicht, obwohl FMP
 * returnOnInvestedCapital bzw. ratios.roic führt.
 * Nachher: Peer-ROIC wird mit dem Peer geladen, Feld returnOnInvestedCapital
 * (Dezimalquote) oder roic (nur als Dezimalquote), Stichtag = Filing-Datum.
 * Ohne Wert nennt der Tooltip den Grund.
 */
import { readFileSync } from "node:fs";
import {
  EARNINGS_YIELD_FORMULA,
  FUNDAMENTAL_ANNUAL_LIMIT,
  FUNDAMENTAL_QUARTER_LIMIT,
  QUARTER_MAX_GAP_DAYS,
  ROIC_FORMULA,
  TTM_QUARTER_COUNT,
  earningsYieldFromTtm,
  joinFundamentalsOntoPrices,
  ttmEpsAt,
  type EpsQuarter,
} from "../shared/earnings-yield-roic";
import { buildPitRoicPoints, epsQuartersFromIncomeRows } from "../server/earnings-yield-roic-route";
import { peerPriceFromBars } from "../server/chart-peer-price-route";
import type { DailyBar } from "../server/history-fallback";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (!cond) {
    failures++;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ""}`);
  } else {
    console.log(`✅ ${label}`);
  }
}

const quarters: EpsQuarter[] = [
  { periodEnd: "2023-03-31", asOf: "2023-04-25", eps: 1, currency: "USD" },
  { periodEnd: "2023-06-30", asOf: "2023-07-25", eps: 1, currency: "USD" },
  { periodEnd: "2023-09-30", asOf: "2023-10-24", eps: 1, currency: "USD" },
  { periodEnd: "2023-12-31", asOf: "2024-01-30", eps: 1, currency: "USD" },
  { periodEnd: "2024-03-31", asOf: "2024-04-25", eps: 2, currency: "USD" },
];

check("Fenster und Perioden sind benannt", TTM_QUARTER_COUNT === 4 && QUARTER_MAX_GAP_DAYS === 140 && FUNDAMENTAL_ANNUAL_LIMIT === 12 && FUNDAMENTAL_QUARTER_LIMIT === 48);
const warmup = ttmEpsAt(quarters, "2023-12-15");
check("Warmup vor dem vierten Filing bleibt leer", warmup.eps === null && warmup.note?.includes("Warmup") === true, warmup.note ?? "");
const hidden = ttmEpsAt(quarters, "2024-01-15");
check("Kein Look-ahead: Filing am 30.01. zählt am 15.01. noch nicht", hidden.eps === null, String(hidden.eps));
const ready = ttmEpsAt(quarters, "2024-01-30");
check("TTM am Filing-Tag ist die Summe der vier Quartale", ready.eps === 4, String(ready.eps));
const rolled = ttmEpsAt(quarters, "2024-04-25");
check("Neues Quartal rollt das Fenster, ohne die Lücke aufzufüllen", rolled.eps === 5, String(rolled.eps));

const gapped: EpsQuarter[] = [
  { periodEnd: "2023-03-31", asOf: "2023-04-25", eps: 1, currency: "USD" },
  { periodEnd: "2023-06-30", asOf: "2023-07-25", eps: 1, currency: "USD" },
  { periodEnd: "2023-12-31", asOf: "2024-01-30", eps: 1, currency: "USD" },
  { periodEnd: "2024-03-31", asOf: "2024-04-25", eps: 1, currency: "USD" },
];
const gap = ttmEpsAt(gapped, "2024-04-25");
check("Fehlendes Quartal bleibt eine Lücke", gap.eps === null && gap.note?.includes("Lücke") === true, gap.note ?? "");

const yieldHit = earningsYieldFromTtm(4, 80, "USD", "USD");
check("Earnings Yield = TTM-EPS / Kurs", yieldHit.value === 5, String(yieldHit.value));
check("Formel ist benannt", EARNINGS_YIELD_FORMULA === "TTM-EPS / Kurs" && ROIC_FORMULA.includes("Filing"));
const fx = earningsYieldFromTtm(4, 80, "USD", "EUR");
check("Abweichende Währung wird nicht umgerechnet", fx.value === null && fx.note?.includes("USD") === true && fx.note?.includes("EUR") === true, fx.note ?? "");

const joined = joinFundamentalsOntoPrices(["2024-01-15", "2024-01-30"], {
  earningsYield: null,
  epsQuarters: quarters,
  priceCurrency: "USD",
  roic: [{ date: "2024-01-30", value: 21.6, note: null }],
  peerRoic: [],
  peerRoicSeriesNote: "n/a — ROIC ohne Filing-Datum",
  peerBars: [{ date: "2024-01-30", close: 241.3 }],
  subjectCloses: [80, 80],
  showEarningsYield: true,
  showRoic: true,
  showPeerRoic: true,
  showPeerPrice: true,
});
check("Yield vor dem TTM-Filing ist leer und nennt den Grund", joined[0].earningsYieldPct === null && joined[0].earningsYieldNote?.startsWith("n/a") === true, joined[0].earningsYieldNote ?? "");
check("Yield am Filing-Tag ist 4 / 80", joined[1].earningsYieldPct === 5, String(joined[1].earningsYieldPct));
const printed = joinFundamentalsOntoPrices(["2022-12-01"], {
  earningsYield: null,
  epsQuarters: quarters.slice(0, 2),
  ttmPrints: [{ asOf: "2022-11-30", eps: 3.2, currency: "USD" }],
  priceCurrency: "USD",
  roic: null,
  peerRoic: null,
  peerBars: null,
  subjectCloses: [64],
  showEarningsYield: true,
  showRoic: false,
  showPeerRoic: false,
  showPeerPrice: false,
});
check("Warmup nutzt einen berichteten TTM-Druck, statt zu schätzen", printed[0].earningsYieldPct != null && Math.abs(printed[0].earningsYieldPct - 5) < 1e-9, String(printed[0].earningsYieldPct));
check("Peer-ROIC ohne Punkte nennt den Serien-Grund, nicht nur n/a", joined[1].peerRoicKnown === null && joined[1].peerRoicNote === "n/a — ROIC ohne Filing-Datum", joined[1].peerRoicNote ?? "");
check("Peer-Kurs vor der ersten Kerze bleibt leer und nennt den Beginn", joined[0].peerPriceRaw === null && joined[0].peerPriceNote?.includes("2024-01-30") === true, joined[0].peerPriceNote ?? "");
check("Peer-Kurs am Handelstag ist der Schluss, nicht interpoliert", joined[1].peerPriceRaw === 241.3);

const income = epsQuartersFromIncomeRows([
  { date: "2024-03-31", period: "Q3", epsDiluted: 1.1, filingDate: "2024-04-20", reportedCurrency: "USD" },
  { date: "2024-03-31", period: "FY", eps: 9, filingDate: "2024-07-01" },
  { date: "2024-06-30", period: "Q4", eps: 1.2 },
]);
check("Quartals-EPS nutzt das Filing-Datum", income.quarters.length === 1 && income.quarters[0]?.asOf === "2024-04-20" && income.quarters[0]?.eps === 1.1);
check("Jahreszeile und EPS ohne Filing werden nicht erfunden", income.quarters.every(q => q.periodEnd !== "2024-06-30"));

const filings = new Map([["2025-05-31", "2025-06-12"]]);
const roic = buildPitRoicPoints([
  { date: "2025-05-31", returnOnInvestedCapital: 0.216 },
  { date: "2024-05-31", returnOnInvestedCapital: 0.18 },
], filings);
check("ROIC 0,216 mit passendem Filing wird 21,6 % am Filing-Tag", roic.points.length === 1 && roic.points[0]?.value === 21.6 && roic.points[0]?.date === "2025-06-12", JSON.stringify(roic.points));
check("ROIC ohne Filing-Datum bleibt draußen", roic.points.every(p => p.date !== "2024-05-31") && roic.points.every(p => p.date !== "2025-05-31"));

const fromRatios = buildPitRoicPoints([
  { date: "2025-05-31", filingDate: "2025-06-12", roic: 0.33 },
], new Map());
check("ratios.roic als Dezimalquote wird gelesen, wenn returnOnInvestedCapital fehlt", fromRatios.points[0]?.value === 33 && fromRatios.field === "roic", JSON.stringify(fromRatios));
const percentField = buildPitRoicPoints([
  { date: "2025-05-31", filingDate: "2025-06-12", roic: 33 },
], new Map());
check("roic schon in Prozent wird nicht mit 100 multipliziert", percentField.points.length === 0 && percentField.note?.includes("Dezimalquote") === true, percentField.note ?? "");
const preferred = buildPitRoicPoints([
  { date: "2025-05-31", filingDate: "2025-06-12", returnOnInvestedCapital: 0.2, roic: 0.9 },
], new Map());
check("returnOnInvestedCapital hat Vorrang vor roic", preferred.points[0]?.value === 20 && preferred.field === "returnOnInvestedCapital");

const bars: DailyBar[] = [
  { date: "2016-10-24", open: 40, high: 41, low: 39, close: 40, volume: 1, source: "yahoo" },
  { date: "2021-11-02", open: 90, high: 91, low: 89, close: 90, volume: 1, source: "fmp" },
  { date: "2026-11-02", open: 241, high: 242, low: 240, close: 241.3, volume: 1, source: "fmp" },
];
const peer = peerPriceFromBars("ORCL", "2016-10-24", "2026-11-02", bars);
check("Peer-Kurs behält die Kerze von 2016, nicht erst ab dem 5-Jahres-Clamp", peer.bars[0]?.date === "2016-10-24" && peer.bars.length === 3 && peer.source === "FMP + Yahoo/Stooq", peer.bars.map(b => b.date).join(","));
check("Peer-Kurs außerhalb von/bis fällt weg", peerPriceFromBars("ORCL", "2024-01-01", "2026-11-02", bars).bars[0]?.date === "2026-11-02");
const late = peerPriceFromBars("ORCL", "2016-10-01", "2026-11-02", bars.slice(1));
check("Beginnt die Historie später, nennt die Note den ersten Tag", late.note === "Peer-Kurs beginnt am 2021-11-02" && late.bars[0]?.date === "2021-11-02", late.note ?? "");

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead as {
  VWAGY: { overallScore: number };
  SAP: { overallScore: number };
  MSFT: { overallScore: number };
};
check("VOW3 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718");
check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758");
check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138");

const chart = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
const hook = readFileSync("client/src/lib/useFundamentalSeries.ts", "utf8");
check("Chart lädt Peer-ROIC mit dem Peer, nicht nur im ROIC-Modus", chart.includes("useRoicSeries(peerQuery, peerOn)"));
check("Tooltip nennt Formel und Grund", chart.includes("fmtPctOrNote") && chart.includes("EARNINGS_YIELD_FORMULA") && chart.includes("_peerRoicKnown"));
check("Peer-Kurs geht über /api/chart/peer-price, nicht über den 5-Jahres-OHLCV-Clamp", hook.includes("/api/chart/peer-price/") && !hook.includes("/api/ohlcv?tickers="));
const routeSrc = readFileSync("server/earnings-yield-roic-route.ts", "utf8") + readFileSync("server/chart-peer-price-route.ts", "utf8");
check("analyze-route wird von der Overlay-Route nicht importiert", !/from ["'][^"']*analyze-route["']/.test(routeSrc));

if (failures > 0) {
  console.error(`\n${failures} Fehler`);
  process.exit(1);
}
console.log("\nFundamental-Overlay Historie ok");
