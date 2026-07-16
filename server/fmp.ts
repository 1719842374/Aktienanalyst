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

// === Non-financial metadata keys to exclude from segment extraction ===
const SEGMENT_SKIP_KEYS = new Set([
  "symbol", "date", "reportedCurrency", "cik", "fillingDate",
  "acceptedDate", "calendarYear", "period", "link", "finalLink",
]);

/**
 * Fetches revenue-product-segmentation from FMP /stable and normalises the
 * response into a consistent { name, revenue, percentage }[] array.
 *
 * /stable returns a flat object per year (segment names as keys):
 *   [{ symbol, date, iPhone: 201183000000, Services: 96169000000, ... }, ...]
 *
 * We take the most-recent row, strip metadata keys, compute percentages from
 * the total of all numeric segment values, and return a sorted array — largest
 * segment first. Segments with zero / negative / non-numeric values are dropped.
 */
export async function fmpSegments(symbol: string): Promise<Array<{ name: string; revenue: number; percentage: number; date?: string }>> {
  try {
    const raw = await fmpFetch(`/revenue-product-segmentation`, { symbol });

    // Normalise: /stable returns an array of yearly flat objects.
    // Some older responses may wrap results under a `data` key — handle both.
    const rows: any[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
    if (rows.length === 0) return [];

    // Sort descending by date and take the most recent period.
    const sorted = [...rows].sort((a, b) => {
      const da = a?.date ?? a?.reportedDate ?? "";
      const db = b?.date ?? b?.reportedDate ?? "";
      return db.localeCompare(da);
    });
    const latest = sorted[0];
    const reportDate: string | undefined = latest?.date ?? latest?.reportedDate;

    // Extract numeric segment entries, ignoring metadata keys.
    const entries: Array<{ name: string; revenue: number }> = [];
    for (const [key, val] of Object.entries(latest)) {
      if (SEGMENT_SKIP_KEYS.has(key)) continue;
      const num = Number(val);
      if (!isNaN(num) && num > 0) {
        entries.push({ name: key, revenue: num });
      }
    }
    if (entries.length === 0) return [];

    const total = entries.reduce((sum, e) => sum + e.revenue, 0);

    return entries
      .sort((a, b) => b.revenue - a.revenue)
      .map(e => ({
        name: e.name,
        revenue: e.revenue,
        percentage: total > 0 ? Math.round((e.revenue / total) * 1000) / 10 : 0,
        date: reportDate,
      }));
  } catch {
    return [];
  }
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

// === FX Conversion for foreign-currency financial statements ===
// FMP's /stable financial-statement endpoints (income-statement, cash-flow-statement,
// balance-sheet-statement) return raw figures in the filer's `reportedCurrency`
// (e.g. Novo Nordisk reports in DKK even though it trades on NYSE in USD). FMP's
// own /stable/ratios endpoint DOES compute ratios correctly in USD internally, but
// routes.ts reads raw revenue/eps/ebitda/etc. directly from the income statement,
// so a DKK-denominated EPS ends up divided into a USD price — producing a P/E off
// by the FX factor (observed: NVO showed P/E 2.2 instead of ~12, a ~5.5x error
// matching the DKK/USD rate). Fetching a live rate via /stable/quote?symbol=XXXUSD
// is more accurate and lower-maintenance than a hardcoded FX table.
const fxRateCache = new Map<string, { rate: number; fetchedAt: number }>();
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — FX doesn't need to be real-time for this use case

export async function getFxRateToUsd(currency: string): Promise<number> {
  const cur = (currency || "USD").toUpperCase();
  if (cur === "USD") return 1;
  const cached = fxRateCache.get(cur);
  if (cached && Date.now() - cached.fetchedAt < FX_CACHE_TTL_MS) return cached.rate;
  try {
    const q = await fmpQuote(`${cur}USD`);
    const rate = Number(q?.price);
    if (rate > 0 && rate < 1000) {
      fxRateCache.set(cur, { rate, fetchedAt: Date.now() });
      return rate;
    }
  } catch { /* fall through to stale cache / 1 */ }
  // Stale cache is still better than silently treating foreign currency as USD
  if (cached) return cached.rate;
  console.warn(`[FX] Could not fetch ${cur}USD rate — financial figures may be misdenominated`);
  return 1;
}

// Converts the numeric financial-statement fields of a FMP income/cashflow/balance-sheet
// row from its reportedCurrency into USD. EPS-like per-share fields and aggregate
// currency fields are converted; ratios, percentages, share counts and dates are left as-is.
const FX_CONVERTIBLE_FIELDS = new Set([
  "revenue", "costOfRevenue", "grossProfit", "operatingIncome", "netIncome", "ebit", "ebitda",
  "eps", "epsDiluted", "operatingExpenses", "researchAndDevelopmentExpenses",
  "generalAndAdministrativeExpenses", "sellingAndMarketingExpenses", "sellingGeneralAndAdministrativeExpenses",
  "otherExpenses", "costAndExpenses", "interestExpense", "incomeTaxExpense",
  "freeCashFlow", "operatingCashFlow", "capitalExpenditure", "cashAndCashEquivalents",
  "dividendsPaid", "depreciationAndAmortization", "stockBasedCompensation", "netCashProvidedByOperatingActivities",
  "shortTermDebt", "longTermDebt", "totalDebt", "totalStockholdersEquity", "totalEquity", "totalAssets",
  "enterpriseValue", "freeCashFlowPerShare", "revenuePerShare", "netIncomePerShare", "workingCapital",
  "investedCapital", "freeCashFlowToFirm", "freeCashFlowToEquity", "grahamNumber", "grahamNetNet",
]);

export async function convertFmpRowToUsd<T extends Record<string, any>>(row: T): Promise<T> {
  const currency = row?.reportedCurrency;
  if (!currency || currency === "USD") return row;
  const rate = await getFxRateToUsd(currency);
  if (rate === 1) return row; // fetch failed — leave as-is rather than guess
  const converted: any = { ...row };
  for (const field of Array.from(FX_CONVERTIBLE_FIELDS)) {
    if (typeof converted[field] === "number") converted[field] = converted[field] * rate;
  }
  converted._fxConverted = { from: currency, rate };
  return converted;
}

// Convenience: convert every row in an array (income-statement/cash-flow/balance-sheet
// results are arrays of yearly/quarterly rows) using a single fetched FX rate.
export async function convertFmpRowsToUsd<T extends Record<string, any>>(rows: T[]): Promise<T[]> {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const currency = rows[0]?.reportedCurrency;
  if (!currency || currency === "USD") return rows;
  const rate = await getFxRateToUsd(currency);
  if (rate === 1) return rows;
  return rows.map((row) => {
    const converted: any = { ...row };
    for (const field of Array.from(FX_CONVERTIBLE_FIELDS)) {
      if (typeof converted[field] === "number") converted[field] = converted[field] * rate;
    }
    converted._fxConverted = { from: currency, rate };
    return converted;
  });
}

// === EPS Growth Calculations (formula-based, no external source needed) ===
// Derives YoY EPS growth and 1Y/3Y/5Y CAGR directly from the income-statement
// history after FX conversion. This replaces any hardcoded or FMP-supplied
// "epsgrowth" field, which is often stale, null, or pre-FX-conversion.
//
// Formulas:
//   YoY%  = (EPS_t / EPS_{t-1} - 1) × 100
//   CAGR  = (EPS_end / EPS_start)^(1/n) - 1       [compound annual growth rate]
//
// Edge cases:
//   - Negative EPS base year → CAGR returns null (mathematically undefined / misleading)
//   - Zero EPS base year     → CAGR returns null (division by zero)
//   - Insufficient history   → returns null for the period that can't be computed

export interface EpsGrowthResult {
  /** Chronologically sorted EPS history (oldest first), post-FX-conversion */
  epsHistory: Array<{ year: string; eps: number }>;
  /** YoY growth rate per year: (EPS_t / EPS_{t-1} - 1) × 100 */
  yoyGrowthRates: Array<{ year: string; growthPct: number }>;
  /** 1-year CAGR (%), null if base EPS ≤ 0 or insufficient data */
  cagr1Y: number | null;
  /** 3-year CAGR (%), null if base EPS ≤ 0 or fewer than 4 data points */
  cagr3Y: number | null;
  /** 5-year CAGR (%), null if base EPS ≤ 0 or fewer than 6 data points */
  cagr5Y: number | null;
}

export async function calcEpsGrowth(symbol: string): Promise<EpsGrowthResult> {
  // Fetch 6 annual rows so we can compute a true 5Y CAGR (needs start + 5 periods)
  const rawRows = await fmpIncomeStatement(symbol, 6);
  // Apply DKK / FX normalisation — critical for ADRs like NVO, AZN, RHHBY etc.
  const rows = await convertFmpRowsToUsd(rawRows);

  // Sort oldest → newest so index 0 is the earliest year
  const sorted = (Array.isArray(rows) ? rows : [])
    .filter((r: any) => r?.epsDiluted != null || r?.eps != null)
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const epsHistory: Array<{ year: string; eps: number }> = sorted
    .map((r: any) => ({
      year: String(r.calendarYear ?? r.date?.substring(0, 4) ?? "?"),
      eps: Number(r.epsDiluted ?? r.eps),
    }))
    .filter((h) => !isNaN(h.eps));

  // YoY: (EPS_t / |EPS_{t-1}|) - 1  — abs() on base prevents sign-flip artefacts
  const yoyGrowthRates: Array<{ year: string; growthPct: number }> = epsHistory
    .slice(1)
    .map((curr, i) => ({
      year: curr.year,
      growthPct: ((curr.eps - epsHistory[i].eps) / Math.abs(epsHistory[i].eps)) * 100,
    }));

  // CAGR helper: returns null when base is non-positive or history is too short
  const cagr = (n: number): number | null => {
    if (epsHistory.length < n + 1) return null;
    const end = epsHistory[epsHistory.length - 1].eps;
    const start = epsHistory[epsHistory.length - 1 - n].eps;
    if (start <= 0 || end <= 0) return null;
    return (Math.pow(end / start, 1 / n) - 1) * 100;
  };

  return {
    epsHistory,
    yoyGrowthRates,
    cagr1Y: cagr(1),
    cagr3Y: cagr(3),
    cagr5Y: cagr(5),
  };
}
