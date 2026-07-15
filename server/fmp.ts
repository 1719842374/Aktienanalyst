// === FMP (Financial Modeling Prep) API Client ===

const FMP_BASE = "https://financialmodelingprep.com/api/v3";

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
  const data = await fmpFetch(`/profile/${symbol}`);
  return data?.[0] || null;
}

export async function fmpQuote(symbol: string) {
  try {
    const data = await fmpFetch(`/quote/${symbol}`);
    return data?.[0] || null;
  } catch {
    return null;
  }
}

export async function fmpIncomeStatement(symbol: string, limit = 5) {
  return fmpFetch(`/income-statement/${symbol}`, { limit: String(limit) });
}

export async function fmpBalanceSheet(symbol: string, limit = 5) {
  return fmpFetch(`/balance-sheet-statement/${symbol}`, { limit: String(limit) });
}

export async function fmpCashFlow(symbol: string, limit = 5) {
  return fmpFetch(`/cash-flow-statement/${symbol}`, { limit: String(limit) });
}

export async function fmpHistoricalPrices(symbol: string, from?: string, to?: string) {
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  return fmpFetch(`/historical-price-full/${symbol}`, params);
}

export async function fmpAnalystEstimates(symbol: string, limit = 5) {
  return fmpFetch(`/analyst-estimates/${symbol}`, { limit: String(limit), period: "annual" });
}

export async function fmpGrades(symbol: string, limit = 20) {
  return fmpFetch(`/grade/${symbol}`, { limit: String(limit) });
}

export async function fmpPriceTarget(symbol: string) {
  const data = await fmpFetch(`/price-target-consensus`, { symbol });
  return data?.[0] || null;
}

export async function fmpSegments(symbol: string) {
  try {
    return await fmpFetch(`/revenue-product-segmentation`, { symbol });
  } catch { return []; }
}

export async function fmpPeers(symbol: string): Promise<any[]> {
  try {
    const data = await fmpFetch(`/stock_peers`, { symbol });
    return data?.[0]?.peersList || [];
  } catch { return []; }
}

export async function fmpRatios(symbol: string, limit = 10) {
  return fmpFetch(`/ratios/${symbol}`, { limit: String(limit) });
}

export async function fmpKeyMetrics(symbol: string, limit = 5) {
  return fmpFetch(`/key-metrics/${symbol}`, { limit: String(limit) });
}

export async function fmpBatchQuote(symbols: string[]) {
  if (symbols.length === 0) return [];
  // /quote/{symbol} supports comma-separated batch
  return fmpFetch(`/quote/${symbols.join(",")}`);
}

export function isFmpAvailable(): boolean {
  return !!process.env.FMP_API_KEY;
}

// === Ticker / Company Name Search ===
// FMP /search akzeptiert Firmennamen UND Ticker und liefert
// die passenden Listings (alle Welt-Börsen inkl. .NS, .HK, .DE, .SS etc.)
export async function fmpSearchTicker(query: string, limit = 10): Promise<Array<{
  symbol: string;
  name: string;
  currency?: string;
  exchangeFullName?: string;
  exchange?: string;
}>> {
  if (!query || query.length < 1) return [];
  try {
    const results = await fmpFetch(`/search`, { query, limit: String(limit) });
    if (!Array.isArray(results)) return [];
    const seen = new Set<string>();
    return results
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
