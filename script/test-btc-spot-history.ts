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
  assessBtcSpotCoverage,
  minerSpotPriceSeries,
  normalizeBlockchainMarketPrice,
  shiftUtcDays,
  type BtcSpotPoint,
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

const analysis = readFileSync(join(root, "client/src/lib/btcAnalysis.ts"), "utf8");
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

if (failed > 0) {
  console.log(`\n${failed} fehlgeschlagen`);
  process.exit(1);
}
console.log("\nalle Prüfungen bestanden");
