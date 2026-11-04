/**
 * BTC-Spot: mindestens 3650 Kalendertage (Krypto handelt täglich; 2520 ist die Aktien-Konvention).
 * Beweist den Root Cause am mitgelieferten blockchain.info-Payload (timespan=all, sampled default)
 * und prüft die produktive Reihe.
 *
 * Ausführen: npx tsx script/test-btc-spot-history.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BTC_SPOT_MIN_DAYS,
  BTC_SPOT_SOURCE_URL,
  BTC_VOLUME_SOURCE_URL,
  assessBtcSpotCoverage,
  assessBtcTradeVolumeCoverage,
  attachBtcTradeVolume,
  minerSpotPriceSeries,
  normalizeBlockchainMarketPrice,
  normalizeBlockchainTradeVolume,
  shiftUtcDays,
  type BtcSpotPoint,
  type BtcTradeVolumePoint,
} from "../shared/btc-spot";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${ok || info === undefined ? "" : ` → ${JSON.stringify(info)}`}`);
  if (!ok) failed++;
};

function dailySeries(start: string, days: number): BtcSpotPoint[] {
  const points: BtcSpotPoint[] = [];
  for (let i = 0; i < days; i++) {
    points.push({ date: shiftUtcDays(start, i), price: 100 + i });
  }
  return points;
}

const fixturePath = join(root, "script/fixtures/btc-liquidity/blockchain-market-price-all.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
const sampled = normalizeBlockchainMarketPrice(fixture);
const sampledCoverage = assessBtcSpotCoverage(sampled);
check(
  "Root Cause: timespan=all ohne sampled=false ist kein 10-Jahres-Tagesraster",
  sampledCoverage.ok === false
    && sampledCoverage.pointsInTenYears < BTC_SPOT_MIN_DAYS
    && sampledCoverage.medianGapDays === 4
    && sampledCoverage.spanDays >= 3600,
  sampledCoverage,
);

const daily = dailySeries("2014-01-01", 4000);
const dailyCoverage = assessBtcSpotCoverage(daily);
check(
  "tägliche Reihe mit mindestens 3650 Punkten im 10-Jahres-Fenster",
  dailyCoverage.ok === true && dailyCoverage.pointsInTenYears >= BTC_SPOT_MIN_DAYS && dailyCoverage.medianGapDays === 1,
  dailyCoverage,
);

const weekdays = daily.filter((point) => {
  const day = new Date(`${point.date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
});
const weekdayCoverage = assessBtcSpotCoverage(weekdays);
check(
  "2520-Börsentage-Raster erfüllt die BTC-Kalenderkonvention nicht",
  BTC_SPOT_MIN_DAYS === 3650 && weekdayCoverage.ok === false && weekdayCoverage.pointsInTenYears < BTC_SPOT_MIN_DAYS,
  { pointsInTenYears: weekdayCoverage.pointsInTenYears, min: BTC_SPOT_MIN_DAYS },
);

const tenYearDaily = minerSpotPriceSeries({
  allPrices: daily,
  prices5Y: daily.filter((point) => point.date >= "2021-08-01"),
});
check(
  "Miner-Spot nimmt die volle Reihe, nicht den 5Y-Schnitt ab 2021-08",
  tenYearDaily.length === daily.length
    && tenYearDaily[0]?.date === "2014-01-01"
    && tenYearDaily.filter((point) => point.date >= shiftUtcDays(daily[daily.length - 1].date, -BTC_SPOT_MIN_DAYS)).length >= BTC_SPOT_MIN_DAYS,
);

check(
  "fehlende Vollhistorie wird nicht still auf prices5Y gekürzt",
  minerSpotPriceSeries({ prices5Y: daily.slice(-400), prices3Y: daily.slice(-200) }).length === 0,
);

check(
  "Quelle ist blockchain.info täglich, ohne CoinGecko",
  BTC_SPOT_SOURCE_URL.includes("api.blockchain.info/charts/market-price")
    && BTC_SPOT_SOURCE_URL.includes("timespan=all")
    && BTC_SPOT_SOURCE_URL.includes("sampled=false")
    && !BTC_SPOT_SOURCE_URL.includes("coingecko"),
);

check(
  "Volumenquelle ist blockchain.info trade-volume, täglich",
  BTC_VOLUME_SOURCE_URL.includes("api.blockchain.info/charts/trade-volume")
    && BTC_VOLUME_SOURCE_URL.includes("timespan=all")
    && BTC_VOLUME_SOURCE_URL.includes("sampled=false"),
);

const volumeRaw = {
  values: [
    { x: Date.parse("2016-01-01T00:00:00Z") / 1000, y: 12_500_000 },
    { x: Date.parse("2016-01-02T00:00:00Z") / 1000, y: 0 },
    { x: Date.parse("2024-06-01T00:00:00Z") / 1000, y: 800_000_000 },
  ],
};
const normalizedVolume = normalizeBlockchainTradeVolume(volumeRaw);
check(
  "Volumen-Normalisierung behält 2016 und einen echten Nulltag",
  normalizedVolume[0]?.date === "2016-01-01"
    && normalizedVolume[0]?.volume === 12_500_000
    && normalizedVolume.some((point) => point.date === "2016-01-02" && point.volume === 0),
);

const priceForVolume = [
  { date: "2016-01-01", price: 430 },
  { date: "2016-01-02", price: 435 },
  { date: "2016-01-03", price: 440 },
];
const attached = attachBtcTradeVolume(priceForVolume, normalizedVolume);
check(
  "Volumen hängt am Kurstag, ein fehlender Tag bleibt 0",
  attached[0]?.volume === 12_500_000 && attached[1]?.volume === 0 && attached[2]?.volume === 0,
);

const historyPrices = dailySeries("2016-01-01", 365 * 8);
const fullVolumes: BtcTradeVolumePoint[] = historyPrices.map((point) => ({ date: point.date, volume: 1_000_000 }));
const fullVolumeCoverage = assessBtcTradeVolumeCoverage(historyPrices, fullVolumes);
check(
  "Volumen über die ganze Reihe vor und nach 2021 ist gültig",
  fullVolumeCoverage.ok === true && fullVolumeCoverage.matchedBefore2021 === fullVolumeCoverage.before2021 && fullVolumeCoverage.before2021 > 1000,
  fullVolumeCoverage,
);
const lateVolumes = fullVolumes.filter((point) => point.date >= "2021-01-01");
const lateCoverage = assessBtcTradeVolumeCoverage(historyPrices, lateVolumes);
check(
  "Volumen erst ab 2021 fällt durch",
  lateCoverage.ok === false && lateCoverage.matchedBefore2021 === 0,
  lateCoverage.reason,
);

const analysis = readFileSync(join(root, "client/src/lib/btcAnalysis.ts"), "utf8");
check(
  "Client schneidet Signale nicht auf die letzten 100 und holt kein 2000-Tage-Binance-Fenster",
  analysis.includes("technicalSignals: signals")
    && !analysis.includes("signals.slice(-100)")
    && !analysis.includes("2000 * dayMs")
    && !analysis.includes("api.binance.com/api/v3/klines")
    && analysis.includes("detectBtcChartSignals"),
);
const miner = readFileSync(join(root, "client/src/components/sections/Section13Miner.tsx"), "utf8");
const routes = readFileSync(join(root, "server/btc-routes.ts"), "utf8");
check(
  "Client holt die Kursreihe über die API, ohne CoinGecko-5Y-Fallback",
  analysis.includes('"/api/analyze-btc/spot-history"')
    && !analysis.includes("market_chart/range")
    && !analysis.includes("fiveYearsAgo"),
);
check(
  "Miner-Zone bindet den Spot an minerSpotPriceSeries",
  miner.includes("minerSpotPriceSeries(")
    && !/priceSrc = data\.chartData\?\.prices5Y/.test(miner),
);
check(
  "Route /api/analyze-btc/spot-history liefert Fehler statt Ersatzquelle",
  routes.includes('"/api/analyze-btc/spot-history"') && routes.includes("fetchBtcSpotHistory"),
);

const { fetchBtcSpotHistory } = await import("../server/btc-spot");
const live = await fetchBtcSpotHistory();
const liveCoverage = assessBtcSpotCoverage(live.points);
check(
  "Live-Quelle: mindestens 3650 Tagespunkte in zehn Jahren",
  live.sourceUrl === BTC_SPOT_SOURCE_URL
    && liveCoverage.ok
    && liveCoverage.pointsInTenYears >= BTC_SPOT_MIN_DAYS
    && liveCoverage.medianGapDays === 1
    && live.points.length >= BTC_SPOT_MIN_DAYS,
  {
    count: live.points.length,
    first: liveCoverage.first,
    last: liveCoverage.last,
    pointsInTenYears: liveCoverage.pointsInTenYears,
    medianGapDays: liveCoverage.medianGapDays,
    reason: liveCoverage.reason,
  },
);
const liveBefore2021 = live.points.filter((point) => point.date < "2021-01-01" && (point.volume ?? 0) > 0);
const live2016 = live.points.find((point) => point.date === "2016-11-04");
check(
  "Live-Volumen liegt auf den Kurstagen vor 2021, nicht erst ab dem Binance-Fenster",
  liveBefore2021.length > 2000
    && (live.points[0]?.volume ?? 0) >= 0
    && live.points[0]?.date < "2011-01-01"
    && (live2016?.volume ?? 0) > 0,
  {
    first: live.points[0]?.date,
    firstVolume: live.points[0]?.volume,
    before2021: liveBefore2021.length,
    volume2016: live2016?.volume ?? null,
  },
);

if (failed > 0) {
  console.log(`\n${failed} fehlgeschlagen`);
  process.exit(1);
}
console.log("\nalle Prüfungen bestanden");
