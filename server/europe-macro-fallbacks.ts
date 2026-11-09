/**
 * F9-14 — Abruf der Europa-Ersatzdaten.
 * Equal-Weight: Yahoo EXSA.DE und OSX6.DE über fetchYahooDailySeries.
 * CAPEX-Ersatz: Eurostat namq_10_gdp P51G EA20, Kette in Levels, YoY selbst gerechnet.
 * Surprise-Rate: kein Abruf, kostenpflichtige Quelle, braucht Philip.
 */
import { fetchYahooDailySeries } from "./recession-markets";
import {
  assembleEuropeFallbacks,
  computeEqualWeightSpread,
  computeEuroAreaCapex,
  EUROPE_CAP_WEIGHT,
  EUROPE_EQUAL_WEIGHT,
  EUROPE_MACRO_PARAMS,
  eurostatGfcfUrl,
  parseEurostatGfcfCsv,
  unavailableEqualWeight,
  unavailableEuroCapex,
  type EuropeMacroFallbacks,
  type PricePoint,
} from "../shared/europe-macro-fallbacks";

export type YahooDaily = (symbol: string, cosd: string) => Promise<PricePoint[]>;
export type EurostatCsv = (startPeriod: string) => Promise<string | null>;

function yearsAgo(years: number, now: Date): string {
  const date = new Date(now);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function startQuarter(years: number, now: Date): string {
  const date = new Date(now);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${quarter}`;
}

export async function fetchEurostatGfcfCsv(startPeriod: string): Promise<string | null> {
  try {
    const response = await fetch(eurostatGfcfUrl(startPeriod), {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "StockAnalystPro/1.0" },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export async function fetchEuropeMacroFallbacks(opts: {
  now?: Date;
  yahoo?: YahooDaily;
  eurostat?: EurostatCsv;
} = {}): Promise<EuropeMacroFallbacks> {
  const now = opts.now ?? new Date();
  const yahoo = opts.yahoo ?? fetchYahooDailySeries;
  const eurostat = opts.eurostat ?? fetchEurostatGfcfCsv;
  const priceFrom = yearsAgo(EUROPE_MACRO_PARAMS.windowYears + 2, now);
  const gfcfFrom = startQuarter(EUROPE_MACRO_PARAMS.windowYears + 2, now);

  const [capPrices, equalPrices, csv] = await Promise.all([
    yahoo(EUROPE_CAP_WEIGHT.symbol, priceFrom).catch(() => [] as PricePoint[]),
    yahoo(EUROPE_EQUAL_WEIGHT.symbol, priceFrom).catch(() => [] as PricePoint[]),
    eurostat(gfcfFrom).catch(() => null),
  ]);

  const equalWeight = (capPrices.length === 0 || equalPrices.length === 0)
    ? unavailableEqualWeight(
        capPrices.length === 0
          ? `n/a — Yahoo ${EUROPE_CAP_WEIGHT.symbol} leer`
          : `n/a — Yahoo ${EUROPE_EQUAL_WEIGHT.symbol} leer`,
      )
    : computeEqualWeightSpread(capPrices, equalPrices);

  const parsed = csv == null
    ? { levels: [], problem: "n/a — Eurostat namq_10_gdp P51G EA20 nicht erreichbar" }
    : parseEurostatGfcfCsv(csv);
  const capex = parsed.problem && parsed.levels.length === 0
    ? unavailableEuroCapex(parsed.problem)
    : computeEuroAreaCapex(parsed.levels);

  return assembleEuropeFallbacks(equalWeight, capex);
}
