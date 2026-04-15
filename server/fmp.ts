// === FMP (Financial Modeling Prep) API Client ===
// Replaces Perplexity Finance connector for self-hosted deployments

const FMP_BASE = "https://financialmodelingprep.com/api";

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

// === Quote ===
export async function fmpQuote(symbol: string) {
  const data = await fmpFetch(`/v3/quote/${symbol}`);
  return data?.[0] || null;
}

// === Company Profile ===
export async function fmpProfile(symbol: string) {
  const data = await fmpFetch(`/v3/profile/${symbol}`);
  return data?.[0] || null;
}

// === Income Statement ===
export async function fmpIncomeStatement(symbol: string, limit = 5) {
  return fmpFetch(`/v3/income-statement/${symbol}`, { limit: String(limit) });
}

// === Balance Sheet ===
export async function fmpBalanceSheet(symbol: string, limit = 5) {
  return fmpFetch(`/v3/balance-sheet-statement/${symbol}`, { limit: String(limit) });
}

// === Cash Flow ===
export async function fmpCashFlow(symbol: string, limit = 5) {
  return fmpFetch(`/v3/cash-flow-statement/${symbol}`, { limit: String(limit) });
}

// === Historical Prices (OHLCV) ===
export async function fmpHistoricalPrices(symbol: string, from?: string, to?: string) {
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const data = await fmpFetch(`/v3/historical-price-full/${symbol}`, params);
  return data?.historical || [];
}

// === Analyst Estimates ===
export async function fmpAnalystEstimates(symbol: string, limit = 5) {
  return fmpFetch(`/v3/analyst-estimates/${symbol}`, { limit: String(limit) });
}

// === Analyst Ratings/Grades ===
export async function fmpGrades(symbol: string, limit = 20) {
  return fmpFetch(`/v3/grade/${symbol}`, { limit: String(limit) });
}

// === Price Target Consensus ===
export async function fmpPriceTarget(symbol: string) {
  const data = await fmpFetch(`/v4/price-target-consensus`, { symbol });
  return data?.[0] || null;
}

// === Revenue Segmentation ===
export async function fmpSegments(symbol: string) {
  try {
    const data = await fmpFetch(`/v4/revenue-product-segmentation`, { symbol, structure: "flat" });
    return data || [];
  } catch { return []; }
}

// === Stock Peers ===
export async function fmpPeers(symbol: string): Promise<string[]> {
  try {
    const data = await fmpFetch(`/v4/stock_peers`, { symbol });
    return data?.[0]?.peersList || [];
  } catch { return []; }
}

// === Key Ratios (annual time series) ===
export async function fmpRatios(symbol: string, limit = 10) {
  return fmpFetch(`/v3/ratios/${symbol}`, { limit: String(limit) });
}

// === Key Metrics ===
export async function fmpKeyMetrics(symbol: string, limit = 5) {
  return fmpFetch(`/v3/key-metrics/${symbol}`, { limit: String(limit) });
}

// === Enterprise Value ===
export async function fmpEnterpriseValue(symbol: string, limit = 1) {
  const data = await fmpFetch(`/v3/enterprise-values/${symbol}`, { limit: String(limit) });
  return data?.[0] || null;
}

// === Rating ===
export async function fmpRating(symbol: string) {
  const data = await fmpFetch(`/v3/rating/${symbol}`);
  return data?.[0] || null;
}

// === Batch quotes for multiple symbols ===
export async function fmpBatchQuote(symbols: string[]) {
  if (symbols.length === 0) return [];
  return fmpFetch(`/v3/quote/${symbols.join(",")}`);
}

// === Check if FMP is available ===
export function isFmpAvailable(): boolean {
  return !!process.env.FMP_API_KEY;
}
