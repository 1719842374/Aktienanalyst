/**
 * SPY-Holdings-KGV für das Factpack. Ein abgeschlossener Lauf bleibt im Cache,
 * damit der nächste Request nicht erneut je Position Quote und TTM-Net-Income holt.
 * Nur Anzeige. Score und Rating lesen das nicht.
 */
import {
  fmpEtfHoldings,
  fmpIncomeStatementTtm,
  fmpQuote,
  fmpStableBatchQuote,
  getFxRateToUsd,
  isFmpAvailable,
} from "./fmp";
import {
  SPY_HOLDINGS_ETF,
  aggregateSpyHoldingsPe,
  marketCapFromQuote,
  naHoldings,
  parseSpyHoldingWeights,
  quoteSymbolBatches,
  ttmNetIncomeFromStatement,
  type SpyAggregatePe,
  type SpyHoldingFundamentals,
} from "../shared/spy-holdings-pe";

/** Dieselbe Haltedauer wie der Märkte-Cache in recession-market-charts.ts. */
export const SPY_HOLDINGS_PE_CACHE_MS = 6 * 60 * 60 * 1000;

export interface SpyHoldingsPeDeps {
  holdings: (symbol: string) => Promise<unknown>;
  quotes: (symbols: string[]) => Promise<unknown>;
  earningsTtm: (symbol: string) => Promise<unknown>;
  fxToUsd: (currency: string) => Promise<number | null>;
  now: () => number;
}

const defaultDeps: SpyHoldingsPeDeps = {
  holdings: symbol => fmpEtfHoldings(symbol),
  quotes: async symbols => {
    const rows: unknown[] = [];
    for (const batch of quoteSymbolBatches(symbols)) {
      try {
        const data = await fmpStableBatchQuote(batch);
        if (Array.isArray(data)) rows.push(...data);
        else if (data && typeof data === "object") rows.push(data);
      } catch {
        for (const symbol of batch) {
          const one = await fmpQuote(symbol);
          if (one) rows.push(one);
        }
      }
    }
    return rows;
  },
  earningsTtm: symbol => fmpIncomeStatementTtm(symbol),
  fxToUsd: async currency => {
    const rate = await getFxRateToUsd(currency);
    if (currency.toUpperCase() !== "USD" && rate === 1) return null;
    return rate;
  },
  now: () => Date.now(),
};

let cache: { at: number; value: SpyAggregatePe } | null = null;
let flight: Promise<SpyAggregatePe> | null = null;

export function resetSpyHoldingsPeCacheForTests(): void {
  cache = null;
  flight = null;
}

async function usdAmount(amount: number, currency: string | null, deps: SpyHoldingsPeDeps): Promise<number | null> {
  if (currency == null || currency === "USD") return amount;
  const rate = await deps.fxToUsd(currency);
  if (rate == null || !(rate > 0)) return null;
  return amount * rate;
}

function quoteRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return [raw];
  return [];
}

export async function loadSpyHoldingsAggregatePe(deps: SpyHoldingsPeDeps = defaultDeps): Promise<SpyAggregatePe> {
  const now = deps.now();
  if (cache && now - cache.at < SPY_HOLDINGS_PE_CACHE_MS) return cache.value;
  if (flight) return flight;
  const run = computeSpyHoldingsAggregatePe(deps).then(value => {
    cache = { at: now, value };
    return value;
  });
  flight = run.finally(() => {
    flight = null;
  });
  return flight;
}

async function computeSpyHoldingsAggregatePe(deps: SpyHoldingsPeDeps): Promise<SpyAggregatePe> {
  if (deps === defaultDeps && !isFmpAvailable()) {
    return {
      pe: null,
      coverage: null,
      estimate: false,
      source: null,
      formula: aggregateSpyHoldingsPe([]).formula,
      note: naHoldings("PE: FMP nicht konfiguriert"),
    };
  }
  let raw: unknown;
  try {
    raw = await deps.holdings(SPY_HOLDINGS_ETF);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 80) : "Fehler";
    return {
      pe: null,
      coverage: null,
      estimate: false,
      source: null,
      formula: aggregateSpyHoldingsPe([]).formula,
      note: naHoldings(`PE: ETF-Holdings nicht geladen (${message})`),
    };
  }
  const holdings = parseSpyHoldingWeights(raw).filter(row => row.symbol !== SPY_HOLDINGS_ETF);
  if (holdings.length === 0) {
    return {
      pe: null,
      coverage: null,
      estimate: false,
      source: null,
      formula: aggregateSpyHoldingsPe([]).formula,
      note: naHoldings("PE: ETF-Holdings leer"),
    };
  }
  const symbols = holdings.map(row => row.symbol);
  const caps = new Map<string, number | null>();
  try {
    for (const row of quoteRows(await deps.quotes(symbols))) {
      const parsed = marketCapFromQuote(row);
      if (!parsed || caps.has(parsed.symbol)) continue;
      caps.set(parsed.symbol, await usdAmount(parsed.marketCap, parsed.currency, deps));
    }
  } catch {
    // Quotes fehlen ganz: jede Position bleibt ohne Market Cap, das Aggregat wird n/a.
  }
  const earnings = new Map<string, number | null>();
  for (const symbol of symbols) {
    try {
      const money = ttmNetIncomeFromStatement(await deps.earningsTtm(symbol));
      earnings.set(symbol, money ? await usdAmount(money.netIncome, money.currency, deps) : null);
    } catch {
      earnings.set(symbol, null);
    }
  }
  const rows: SpyHoldingFundamentals[] = holdings.map(row => ({
    symbol: row.symbol,
    weight: row.weight,
    marketCap: caps.get(row.symbol) ?? null,
    earningsTtm: earnings.get(row.symbol) ?? null,
  }));
  return aggregateSpyHoldingsPe(rows);
}
