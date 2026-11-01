/**
 * .DE (SAP.DE, VOW3.DE): Yahoo ist die Quelle für EY und ROIC, ohne FMP-Call.
 * Andere Ticker: FMP, bei 402 oder leerer Antwort Yahoo.
 * sector-pe: Fallback, wenn FMP /etf/holdings 402 oder leer ist.
 * Aufruf: npx tsx script/test-fmp-402-yahoo-fallback.ts
 *
 * DoD: SAP.DE und VOW3.DE haben je mindestens 3 EY- und ROIC-Punkte.
 * sector-pe hat für mindestens 7 von 9 ETFs ein aktuelles KGV.
 * Keine erfundenen Werte: Platzhalter-Nullen und fehlende Felder bleiben n/a.
 */
import { readFileSync } from "node:fs";
import {
  annualsFromQuoteSummary,
  annualsFromTimeseries,
  earningsYieldPointsFromAnnuals,
  preferReportedSeries,
  roicPointsFromAnnuals,
  trailingPeFromQuoteSummary,
  trailingPeFromTimeseries,
  trailingPeFromV7Quote,
  trailingPeFromYahooHtml,
  YAHOO_HTML_TRAILING_PE_SOURCE,
  YAHOO_QS_TRAILING_PE_SOURCE,
  YAHOO_TS_EY_SOURCE,
  YAHOO_TS_ROIC_SOURCE,
} from "../shared/yahoo-fundamental-series";
import { sanitizeRoic } from "../server/news-peers";
import {
  loadEarningsYield,
  loadRoicSeries,
  resetFundamentalCacheForTests,
} from "../server/earnings-yield-roic-route";
import { loadSectorPeDisplay, resetSectorPeCacheForTests } from "../server/sector-pe-route";
import { loadYahooEtfTrailingPe, yahooTrailingPeMissNote } from "../server/yahoo-fundamental-fallback";
import { clearYahooCache } from "../server/yahoo-fetcher";
import { composeSectorPeDisplay } from "../shared/sector-pe-display";
import { ETF_PROXY_MAP } from "../server/sector-rotation-math";
import { PEER_RATING_EXTENSIONS } from "../shared/peer-rating-extensions";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (!cond) {
    failures++;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ""}`);
  } else {
    console.log(`✅ ${label}`);
  }
}

function usable(points: { value: number | null }[]): number {
  return points.filter(p => p.value != null && Number.isFinite(p.value)).length;
}

const y2024 = Date.UTC(2024, 5, 30) / 1000;
const y2023 = Date.UTC(2023, 5, 30) / 1000;
const y2022 = Date.UTC(2022, 5, 30) / 1000;
const y2021 = Date.UTC(2021, 5, 30) / 1000;

const placeholderQs = {
  incomeStatementHistory: {
    incomeStatementHistory: [
      { endDate: { raw: y2024 }, ebit: { raw: 0 }, incomeTaxExpense: { raw: 0 } },
      { endDate: { raw: y2023 }, ebit: { raw: 0 }, incomeTaxExpense: { raw: 0 } },
    ],
  },
  balanceSheetHistory: {
    balanceSheetStatements: [
      { endDate: { raw: y2024 } },
      { endDate: { raw: y2023 } },
    ],
  },
  defaultKeyStatistics: { enterpriseValue: { raw: 243_000_000_000 } },
};
const placeholderEy = earningsYieldPointsFromAnnuals(annualsFromQuoteSummary(placeholderQs));
check("quoteSummary-Platzhalter (EBIT 0, Rest leer) erzeugt keinen Yield und keine 0", usable(placeholderEy.points) === 0 && placeholderEy.points.every(p => p.value !== 0));

function money(date: string, value: number, currency = "EUR") {
  return { date, value, currency };
}
const timeseries = {
  timeseries: {
    result: [
      { annualEBIT: [money("2021-12-31", 40), money("2022-12-31", 50), money("2023-12-31", 80), money("2024-12-31", 100)] },
      { annualEnterpriseValue: [money("2021-12-31", 800), money("2022-12-31", 900), money("2023-12-31", 1000), money("2024-12-31", 1000)] },
      { annualPretaxIncome: [money("2021-12-31", 32), money("2022-12-31", 40), money("2023-12-31", 64), money("2024-12-31", 80)] },
      { annualTaxProvision: [money("2021-12-31", 8), money("2022-12-31", 10), money("2023-12-31", 16), money("2024-12-31", 20)] },
      { annualInvestedCapital: [money("2021-12-31", 400), money("2022-12-31", 450), money("2023-12-31", 480), money("2024-12-31", 500)] },
    ],
  },
};
const annuals = annualsFromTimeseries(timeseries);
const ey = earningsYieldPointsFromAnnuals(annuals);
const roic = roicPointsFromAnnuals(annuals);
check("Timeseries EY: 4 Punkte, 2024 = 10 %", usable(ey.points) === 4 && ey.points.find(p => p.date === "2024-12-31")?.value === 10, JSON.stringify(ey.points));
check("Timeseries ROIC: 4 Punkte, 2024 = 15 %", usable(roic.points) === 4 && roic.points.find(p => p.date === "2024-12-31")?.value === 15, JSON.stringify(roic.points));
check("abweichende Währung bleibt n/a", earningsYieldPointsFromAnnuals([{
  date: "2024-12-31",
  ebit: { value: 10, currency: "EUR" },
  operatingIncome: null,
  pretax: null,
  tax: null,
  investedCapital: null,
  enterpriseValue: { value: 100, currency: "USD" },
  equity: null,
  debt: null,
  cash: null,
}]).points[0]?.value === null);
check("fehlender Steuersatz bleibt n/a, kein Ersatzsatz", roicPointsFromAnnuals([{
  date: "2024-12-31",
  ebit: { value: 10, currency: "EUR" },
  operatingIncome: null,
  pretax: null,
  tax: null,
  investedCapital: { value: 100, currency: "EUR" },
  enterpriseValue: null,
  equity: null,
  debt: null,
  cash: null,
}]).points[0]?.value === null);
check("|ROIC| über der bestehenden Grenze ist n/a", sanitizeRoic(150) === null && sanitizeRoic(15) === 15);

const picked = preferReportedSeries(
  { points: placeholderEy.points, source: "Yahoo quoteSummary", note: placeholderEy.note },
  { points: ey.points, source: YAHOO_TS_EY_SOURCE, note: null },
);
check("leeres quoteSummary weicht der Timeseries", picked.source === YAHOO_TS_EY_SOURCE && usable(picked.points) === 4);

const kept = preferReportedSeries(
  { points: ey.points, source: "Yahoo quoteSummary", note: null },
  { points: ey.points.slice(0, 1), source: YAHOO_TS_EY_SOURCE, note: null },
);
check("berichtetes quoteSummary bleibt, wenn es mindestens so viele Punkte hat", kept.source === "Yahoo quoteSummary" && usable(kept.points) === 4);

check("summaryDetail.trailingPE", trailingPeFromQuoteSummary({ summaryDetail: { trailingPE: { raw: 29.394281 } } }) === 29.394281);
check("trailingPE 0 ist kein KGV", trailingPeFromQuoteSummary({ summaryDetail: { trailingPE: { raw: 0 } }, defaultKeyStatistics: {} }) === null);
const html = String.raw`{\"trailingPE\":{\"raw\":29.394281,\"fmt\":\"29.39\"}}`;
check("Quote-HTML nennt summaryDetail.trailingPE", trailingPeFromYahooHtml(html) === 29.394281);
check("HTML ohne Feld bleibt n/a", trailingPeFromYahooHtml("<html></html>") === null);
check("v7 quote trailingPE", trailingPeFromV7Quote({ quoteResponse: { result: [{ trailingPE: 29.394281 }] } }) === 29.394281);
check("v7 ohne Feld bleibt n/a", trailingPeFromV7Quote({ finance: { error: { code: "Unauthorized" } } }) === null);
const nowMs = Date.parse("2026-11-01T00:00:00Z");
check("timeseries trailingPeRatio nimmt den jüngsten Punkt", trailingPeFromTimeseries({
  timeseries: { result: [{ trailingPeRatio: [
    { asOfDate: "2026-09-09", reportedValue: { raw: 31.2 } },
    { asOfDate: "2026-10-30", reportedValue: { raw: 29.4 } },
  ] }] },
}, nowMs) === 29.4);
check("timeseries nur mit meta bleibt n/a", trailingPeFromTimeseries({ timeseries: { result: [{ meta: { type: ["trailingPeRatio"] } }] } }, nowMs) === null);
check("timeseries älter als 550 Tage bleibt n/a", trailingPeFromTimeseries({
  timeseries: { result: [{ trailingPeRatio: [{ asOfDate: "2020-01-01", reportedValue: { raw: 20 } }] }] },
}, nowMs) === null);
const miss = yahooTrailingPeMissNote([
  { stage: "crumb", status: 429, detail: "getcrumb nicht ok [429 Rate-Limit] (Länge 17): Too Many Requests" },
  { stage: "quoteSummary", status: null, detail: "nicht gesendet: kein Cookie/Crumb" },
  { stage: "v7quote", status: 401, detail: "{\"finance\":{\"error\":{\"code\":\"Unauthorized\",\"description\":\"Invalid Crumb\"}}}" },
]);
check("n/a-Grund nennt HTTP-Status und Body", miss.includes("HTTP 429") && miss.includes("Too Many Requests") && miss.includes("kein HTTP") && miss.includes("HTTP 401") && miss.includes("Invalid Crumb"), miss);
const shown = composeSectorPeDisplay({
  id: "technology",
  etf: "XLK",
  label: "Technologie",
  holdings: null,
  etfHistory: [],
  holdingsNote: `n/a — Holdings nicht geladen (FMP 402: /etf/holdings) · ${miss}`,
});
check("Sektor-Zelle zeigt den HTTP-Grund und bleibt n/a", shown.current === null && shown.source === "n/a" && shown.text.includes("HTTP 429") && shown.text.includes("Invalid Crumb"), shown.text);

resetFundamentalCacheForTests();
let yahooCalls = 0;
let fmpCalls = 0;
const yahooBundle = async () => {
  yahooCalls += 1;
  return {
    earningsYield: { points: ey.points, source: YAHOO_TS_EY_SOURCE, note: null },
    roic: { points: roic.points, source: YAHOO_TS_ROIC_SOURCE, note: null },
  };
};
const countFmp = async () => {
  fmpCalls += 1;
  return [];
};
const sapRoic = await loadRoicSeries("SAP.DE", { income: countFmp, enterpriseValues: countFmp, keyMetrics: countFmp, yahooBundle });
const vowEy = await loadEarningsYield("VOW3.DE", { income: countFmp, enterpriseValues: countFmp, keyMetrics: countFmp, yahooBundle });
check("SAP.DE ROIC kommt von Yahoo und hat mindestens 3 Punkte", usable(sapRoic.points) >= 3 && sapRoic.source === YAHOO_TS_ROIC_SOURCE, sapRoic.source);
check("VOW3.DE EY kommt von Yahoo und hat mindestens 3 Punkte", usable(vowEy.points) >= 3 && vowEy.source === YAHOO_TS_EY_SOURCE, vowEy.source);
check(".DE löst keinen FMP-Call aus", fmpCalls === 0, String(fmpCalls));
check("Yahoo-Punkte sind keine erfundenen Nullen", sapRoic.points.every(p => p.value !== 0) && vowEy.points.every(p => p.value !== 0));

const fmp402 = async () => {
  fmpCalls += 1;
  throw Object.assign(new Error("FMP 402: /key-metrics"), { fmpStatus: 402 });
};
const empty = async () => {
  fmpCalls += 1;
  return [];
};
fmpCalls = 0;
yahooCalls = 0;
const roic402 = await loadRoicSeries("ORCL", { income: empty, enterpriseValues: empty, keyMetrics: fmp402, yahooBundle });
check("Nicht-.DE fällt bei FMP 402 auf Yahoo zurück", usable(roic402.points) >= 3 && roic402.source === YAHOO_TS_ROIC_SOURCE && fmpCalls > 0, roic402.source);

yahooCalls = 0;
const fmpEy = await loadEarningsYield("MSFT", {
  income: async () => [{ date: "2024-06-30", ebit: 100 }],
  enterpriseValues: async () => [{ date: "2024-06-30", enterpriseValue: 1000 }],
  keyMetrics: async () => [],
  yahooBundle,
});
check("MSFT mit FMP-Daten bleibt bei FMP und ruft Yahoo nicht", fmpEy.source.startsWith("FMP") && fmpEy.points[0]?.value === 10 && yahooCalls === 0, fmpEy.source);

let deFmp = 0;
const yahooDown = await loadRoicSeries("BMW.DE", {
  income: async () => { deFmp += 1; return []; },
  enterpriseValues: async () => { deFmp += 1; return []; },
  keyMetrics: async () => { deFmp += 1; throw new Error("FMP 402: /key-metrics"); },
  yahooBundle: async () => ({
    earningsYield: { points: [], source: YAHOO_TS_EY_SOURCE, note: "n/a — Yahoo fundamentals-timeseries ohne EBIT" },
    roic: { points: [], source: YAHOO_TS_ROIC_SOURCE, note: "n/a — Yahoo fundamentals-timeseries ohne Invested Capital" },
  }),
});
check(".DE ohne Yahoo-Daten bleibt n/a mit Grund und ohne FMP", deFmp === 0 && usable(yahooDown.points) === 0 && yahooDown.note?.includes("n/a") === true && yahooDown.source.includes("Yahoo") && yahooDown.points.every(p => p.value !== 0), yahooDown.note ?? "");

resetSectorPeCacheForTests();
const sector = await loadSectorPeDisplay({
  ratios: async () => [],
  holdings: async () => {
    throw new Error("FMP 402: /etf/holdings");
  },
  now: () => Date.UTC(2026, 10, 1),
  etfTrailingPe: async (symbol) => {
    if (symbol === "XLE") return { pe: null, source: YAHOO_QS_TRAILING_PE_SOURCE, note: "n/a — Yahoo trailingPE fehlt" };
    return { pe: 20 + symbol.length, source: YAHOO_QS_TRAILING_PE_SOURCE, note: null };
  },
});
const withPe = sector.sectors.filter(s => s.current != null);
check("Sektor-KGV: mindestens 7 von 9 trotz Holdings-402", withPe.length >= 7 && withPe.length === ETF_PROXY_MAP.length - 1, String(withPe.length));
check("Sektor-Quelle heißt Yahoo und der Score bleibt aus", withPe.every(s => s.source === "yahoo-trailing-pe" && s.sourceLabel === YAHOO_QS_TRAILING_PE_SOURCE) && sector.scoreImpact === false);
check("ETF ohne trailingPE bleibt n/a, nicht 0", sector.sectors.find(s => s.etf === "XLE")?.current === null && sector.sectors.find(s => s.etf === "XLE")?.text.startsWith("n/a") === true);

const chart = readFileSync(new URL("../client/src/components/sections/TechnicalChart.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../client/src/components/researcher/SectorRotationPanel.tsx", import.meta.url), "utf8");
const hooks = readFileSync(new URL("../client/src/lib/useFundamentalSeries.ts", import.meta.url), "utf8")
  + readFileSync(new URL("../client/src/lib/useSectorPeDisplay.ts", import.meta.url), "utf8");
check("Chart-Status nennt die Response-Quelle", chart.includes("data-testid=\"status-earnings-yield\"") && chart.includes("eySource") && chart.includes("Quelle:"));
check("Sektor-Zeile nennt sourceLabel", panel.includes("sector-pe-source-") && panel.includes("sourceLabel"));
check("Hooks bleiben auf den API-Pfaden", hooks.includes("/api/chart/earnings-yield") && hooks.includes("/api/chart/roic") && hooks.includes("/api/researcher/sector-pe"));
check("Peer-Flags bleiben aus", PEER_RATING_EXTENSIONS.industryFallback === false && PEER_RATING_EXTENSIONS.thesisPeerSet === false);

console.log("\n=== Crumb 429 → Quote-HTML (Prod-Pfad) ===");
clearYahooCache();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("https://fc.yahoo.com")) {
    return new Response("", { status: 404, headers: { "set-cookie": "A3=d=AQABBSECRETCOOKIEVALUE1234567; Path=/" } });
  }
  if (url.includes("/v1/test/getcrumb")) return new Response("Too Many Requests", { status: 429 });
  if (url.includes("/v10/finance/quoteSummary/")) {
    return new Response(JSON.stringify({ finance: { result: null, error: { code: "Unauthorized", description: "Invalid Crumb" } } }), { status: 401, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/v7/finance/quote")) {
    return new Response(JSON.stringify({ finance: { result: null, error: { code: "Unauthorized", description: "User is unable to access this feature" } } }), { status: 401, headers: { "content-type": "application/json" } });
  }
  if (url.includes("fundamentals-timeseries")) {
    return new Response(JSON.stringify({ timeseries: { result: [{ meta: { type: ["trailingPeRatio"] } }], error: null } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
}) as typeof fetch;
try {
  const xlk = await loadYahooEtfTrailingPe("XLK");
  check("XLK bei getcrumb 429 kommt von der Quote-Seite", xlk.pe != null && xlk.pe > 5 && xlk.source === YAHOO_HTML_TRAILING_PE_SOURCE, `${xlk.pe ?? "n/a"} ${xlk.source} ${xlk.note ?? ""}`);
  resetSectorPeCacheForTests();
  clearYahooCache();
  const blocked = await loadSectorPeDisplay({
    ratios: async () => { throw new Error("FMP 402: /ratios"); },
    holdings: async () => { throw new Error("FMP 402: /etf/holdings"); },
    now: () => Date.now(),
  });
  const got = blocked.sectors.filter(s => s.current != null && s.current > 0);
  check("9/9 Sektor-ETFs trotz FMP 402 und getcrumb 429", got.length === 9, blocked.sectors.map(s => `${s.etf}:${s.current ?? "n/a"}:${s.source}`).join(" "));
  check("Quelle ist die Quote-Seite und der Score bleibt aus", got.length === 9 && got.every(s => s.source === "yahoo-trailing-pe" && s.sourceLabel === YAHOO_HTML_TRAILING_PE_SOURCE) && blocked.scoreImpact === false, got.map(s => s.sourceLabel).join(" | "));
  const sample = blocked.sectors.find(s => s.etf === "XLK");
  check("Zelle nennt Holdings-402 und ein KGV", (sample?.text ?? "").includes("FMP 402") && (sample?.current ?? 0) > 0, sample?.text ?? "");
} finally {
  globalThis.fetch = realFetch;
  clearYahooCache();
}

console.log("\n=== Live: SAP.DE / VOW3.DE / Sektor-ETFs ===");
resetFundamentalCacheForTests();
resetSectorPeCacheForTests();
const liveEySap = await loadEarningsYield("SAP.DE");
const liveRoicSap = await loadRoicSeries("SAP.DE");
const liveEyVow = await loadEarningsYield("VOW3.DE");
const liveRoicVow = await loadRoicSeries("VOW3.DE");
const liveSector = await loadSectorPeDisplay();
for (const [label, body] of [
  ["SAP.DE EY", liveEySap],
  ["SAP.DE ROIC", liveRoicSap],
  ["VOW3.DE EY", liveEyVow],
  ["VOW3.DE ROIC", liveRoicVow],
] as const) {
  const n = usable(body.points);
  check(`${label} ≥ 3 Punkte`, n >= 3, `n=${n} source=${body.source} note=${body.note ?? ""}`);
  check(`${label} Quelle Yahoo`, body.source.includes("Yahoo"), body.source);
  check(`${label} ohne erfundene 0-Punkte`, body.points.every(p => p.value !== 0));
}
const liveWithPe = liveSector.sectors.filter(s => s.current != null);
check("Live sector-pe ≥ 7/9", liveWithPe.length >= 7, `${liveWithPe.length}/9 ` + liveSector.sectors.map(s => `${s.etf}:${s.current ?? "n/a"}`).join(" "));
check("Live sector-pe nennt die Quelle und scoreImpact false", liveSector.scoreImpact === false && liveWithPe.every(s => (s.sourceLabel ?? "").length > 0), liveWithPe.map(s => s.sourceLabel).join(" | "));

if (failures > 0) {
  console.error(`\n${failures} Fehler`);
  process.exit(1);
}
console.log("\nFMP-402-Yahoo-Fallback ok");
