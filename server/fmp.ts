// === FMP (Financial Modeling Prep) API Client ===
// STABLE API: https://financialmodelingprep.com/stable/
// NOTE: /api/v3 ("legacy") is BLOCKED for subscriptions after 2025-08-31 and
// returns "Legacy Endpoint : no longer supported". The Starter plan works only
// against /stable. All endpoints below use /stable with ?symbol= query params.

const FMP_BASE = "https://financialmodelingprep.com/stable";

function getApiKey(): string {
  return process.env.FMP_API_KEY || "";
}

async function fmpFetch(path: string, params: Record<string, string> = {}): Promise<any> {
  const key = getApiKey();
  if (!key) throw new Error("FMP_API_KEY not set");
  const url = new URL(`${FMP_BASE}${path}`);
  url.searchParams.set("apikey", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const resp = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "StockAnalystPro/1.0" },
  });
  if (!resp.ok) throw new Error(`FMP ${resp.status}: ${path}`);
  return resp.json();
}

export async function fmpProfile(symbol: string) {
  // GET /stable/profile?symbol=AAPL
  const data = await fmpFetch(`/profile`, { symbol });
  return Array.isArray(data) ? data?.[0] : data || null;
}

export async function fmpQuote(symbol: string) {
  try {
    // GET /stable/quote?symbol=AAPL
    const data = await fmpFetch(`/quote`, { symbol });
    return Array.isArray(data) ? data?.[0] : data || null;
  } catch {
    return null;
  }
}

export async function fmpIncomeStatement(symbol: string, limit = 5) {
  // GET /stable/income-statement?symbol=AAPL&limit=5
  return fmpFetch(`/income-statement`, { symbol, limit: String(limit) });
}

export async function fmpBalanceSheet(symbol: string, limit = 5) {
  // GET /stable/balance-sheet-statement?symbol=AAPL&limit=5
  return fmpFetch(`/balance-sheet-statement`, { symbol, limit: String(limit) });
}

export async function fmpCashFlow(symbol: string, limit = 5) {
  // GET /stable/cash-flow-statement?symbol=AAPL&limit=5
  return fmpFetch(`/cash-flow-statement`, { symbol, limit: String(limit) });
}

export async function fmpHistoricalPrices(symbol: string, from?: string, to?: string) {
  const params: Record<string, string> = { symbol };
  if (from) params.from = from;
  if (to) params.to = to;
  // GET /stable/historical-price-eod/full?symbol=AAPL&from=...&to=...
  // Returns a flat array (no .historical wrapper in /stable).
  const data = await fmpFetch(`/historical-price-eod/full`, params);
  if (Array.isArray(data)) return data;
  return data?.historical || [];
}

export async function fmpAnalystEstimates(symbol: string, limit = 5) {
  // GET /stable/analyst-estimates?symbol=AAPL&period=annual&limit=5
  return fmpFetch(`/analyst-estimates`, { symbol, limit: String(limit), period: "annual" });
}

export async function fmpGrades(symbol: string, limit = 20) {
  // GET /stable/grades?symbol=AAPL&limit=20
  return fmpFetch(`/grades`, { symbol, limit: String(limit) });
}

export async function fmpPriceTarget(symbol: string) {
  // GET /stable/price-target-consensus?symbol=AAPL
  const data = await fmpFetch(`/price-target-consensus`, { symbol });
  return Array.isArray(data) ? data?.[0] : data || null;
}

export async function fmpSegments(symbol: string) {
  try {
    // GET /stable/revenue-product-segmentation?symbol=AAPL
    return await fmpFetch(`/revenue-product-segmentation`, { symbol });
  } catch { return []; }
}

export async function fmpPeers(symbol: string): Promise<any[]> {
  try {
    // GET /stable/stock-peers?symbol=AAPL
    // /stable returns an array of peer objects (each with a `symbol` field),
    // NOT a single object with a peersList array like /api/v3 did.
    const data = await fmpFetch(`/stock-peers`, { symbol });
    if (Array.isArray(data)) {
      return data
        .map((row: any) => row?.symbol)
        .filter((s: any): s is string => typeof s === "string" && s.length > 0);
    }
    // Backward-compat: if a peersList wrapper is ever returned, honour it.
    const item = data as any;
    return item?.peersList || [];
  } catch { return []; }
}

export async function fmpRatios(symbol: string, limit = 10) {
  // GET /stable/ratios?symbol=AAPL&limit=10
  return fmpFetch(`/ratios`, { symbol, limit: String(limit) });
}

export async function fmpKeyMetrics(symbol: string, limit = 5) {
  // GET /stable/key-metrics?symbol=AAPL&limit=5
  return fmpFetch(`/key-metrics`, { symbol, limit: String(limit) });
}

export async function fmpBatchQuote(symbols: string[]) {
  if (symbols.length === 0) return [];
  // /stable has no comma-separated batch quote — fetch each symbol in parallel.
  const results = await Promise.all(
    symbols.map(async (s) => {
      try {
        const data = await fmpFetch(`/quote`, { symbol: s });
        return Array.isArray(data) ? data?.[0] : data;
      } catch { return null; }
    })
  );
  return results.filter(Boolean);
}

export function isFmpAvailable(): boolean {
  return !!process.env.FMP_API_KEY;
}

// === Ticker / Company Name Search ===
export async function fmpSearchTicker(query: string, limit = 10): Promise<Array<{
  symbol: string;
  name: string;
  currency?: string;
  exchangeFullName?: string;
  exchange?: string;
}>> {
  if (!query || query.length < 1) return [];
  try {
    // /stable splits search into search-symbol (ticker) and search-name (company name).
    // Query both and merge, de-duplicating by symbol so either input style works.
    const [bySymbol, byName] = await Promise.all([
      fmpFetch(`/search-symbol`, { query, limit: String(limit) }).catch(() => []),
      fmpFetch(`/search-name`, { query, limit: String(limit) }).catch(() => []),
    ]);
    const rows = [
      ...(Array.isArray(bySymbol) ? bySymbol : []),
      ...(Array.isArray(byName) ? byName : []),
    ];
    const seen = new Set<string>();
    return rows
      .filter((row: any) => row?.symbol && !seen.has(row.symbol) && seen.add(row.symbol))
      .map((row: any) => ({
        symbol: row.symbol,
        name: row.name || row.companyName || row.symbol,
        currency: row.currency,
        exchangeFullName: row.exchangeFullName || row.stockExchange || "",
        exchange: row.exchangeShortName || row.exchange,
      }))
      .slice(0, limit);
  } catch { return []; }
}
