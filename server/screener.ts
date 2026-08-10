// === 13F Star-Investor Screener ===
// Real holdings come exclusively from SEC EDGAR and numeric market data from FMP.
// No LLM is used in this module.

import type { Express } from "express";
import { diskResearcherGet, diskResearcherSet } from "./disk-cache";
import {
  fmpAnalystEstimates,
  fmpCashFlow,
  fmpIncomeStatement,
  fmpPriceTarget,
  fmpProfile,
  fmpRatios,
  fmpStockList,
  wouldExceedBudget,
} from "./fmp";
import { STAR_INVESTORS, type StarInvestor } from "./star-investors";

const SCREENER_CACHE_KEY = "screener_star_investors";
// 100 deduplicated positions need 601 FMP calls including the one stock-list
// reference call, staying inside the shared 750-call daily FMP plan budget.
const MAX_SCREENED_TICKERS = 100;
const SEC_USER_AGENT = "Aktienanalyst Pro contact@example.com";
const SEC_MIN_INTERVAL_MS = 120; // stays below the SEC's 10 requests/second guidance

export interface ScreenedStock {
  ticker: string;
  name: string;
  price: number;
  marketCap: number;
  pe: number;
  forwardPE: number;
  sector: string;
  beta: number;
  investorCount: number;
  investors: string[];
  totalValue: number;
  targetPrice: number;
  upside: number;
  downside: number;
  crv: number;
  crvPass: boolean;
  yearHigh: number;
  yearLow: number;
  fcfMargin: number;
}

export interface ScreenerData {
  lastUpdated: string;
  totalInvestors: number;
  totalHoldings: number;
  screenedStocks: ScreenedStock[];
}

export interface SecHolding {
  issuer: string;
  cusip: string;
  value: number;
}

export interface InvestorHoldings {
  investor: StarInvestor;
  holdings: SecHolding[];
}

interface FmpScreenerData {
  name: string;
  price: number;
  marketCap: number;
  pe: number;
  forwardPE: number;
  sector: string;
  beta: number;
  targetPrice: number;
  yearHigh: number;
  yearLow: number;
  fcfMargin: number;
}

interface AggregatedHolding {
  ticker: string;
  name: string;
  totalValue: number;
  investors: string[];
}

interface StockListRow {
  symbol: string;
  companyName: string;
}

let lastSecRequestAt = 0;
let secRequestQueue: Promise<void> = Promise.resolve();
let stockListPromise: Promise<StockListRow[]> | null = null;

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function xmlText(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<\\/?(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/?(?:[\\w-]+:)?${tag}>`, "i"));
  return match ? decodeXml(match[1]).trim() : "";
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeCompanyName(value: string): string {
  return String(value || "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|LP|LLC|HOLDINGS?|GROUP|THE|CLASS [A-Z])\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyUsTicker(symbol: string): boolean {
  return /^[A-Z]{1,5}$/.test(symbol);
}

function resolveTickerFromStockList(issuer: string, rows: StockListRow[]): string | null {
  const normalizedIssuer = normalizeCompanyName(issuer);
  if (!normalizedIssuer) return null;
  const exact = rows.find((row) => normalizeCompanyName(row.companyName) === normalizedIssuer && isLikelyUsTicker(row.symbol));
  if (exact) return exact.symbol.toUpperCase();

  const looselyMatching = rows.find((row) => {
    if (!isLikelyUsTicker(row.symbol)) return false;
    const normalizedName = normalizeCompanyName(row.companyName);
    return normalizedName.length >= 5 && (normalizedName.includes(normalizedIssuer) || normalizedIssuer.includes(normalizedName));
  });
  return looselyMatching?.symbol?.toUpperCase() || null;
}

function parseYearRange(value: unknown): { yearLow: number; yearHigh: number } {
  const values = String(value || "").match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter((number) => number > 0) || [];
  if (values.length < 2) return { yearLow: 0, yearHigh: 0 };
  return { yearLow: Math.min(...values), yearHigh: Math.max(...values) };
}

/**
 * Exact CRV contract used by the Screener dashboard. Invalid/missing inputs are
 * represented by neutral zeroes because the current frontend interface requires
 * numeric values; values are never estimated.
 */
export function calculateCrv(price: number, targetPrice: number, yearLow: number): Pick<ScreenedStock, "upside" | "downside" | "crv" | "crvPass"> {
  if (!(price > 0) || !Number.isFinite(price)) {
    return { upside: 0, downside: 0, crv: 0, crvPass: false };
  }
  const upside = Number.isFinite(targetPrice) ? ((targetPrice - price) / price) * 100 : 0;
  const downside = Number.isFinite(yearLow) ? ((price - yearLow) / price) * 100 : 0;
  const crv = downside > 0 && Number.isFinite(upside) ? upside / downside : 0;
  const safeCrv = Number.isFinite(crv) ? crv : 0;
  return { upside, downside, crv: safeCrv, crvPass: safeCrv >= 3 };
}

async function secFetch(url: string): Promise<Response> {
  // Promise.allSettled starts all 14 filer jobs together. Reserve request slots
  // through one queue so that this concurrency never bursts past SEC guidance.
  const reservation = secRequestQueue.then(async () => {
    const delay = lastSecRequestAt + SEC_MIN_INTERVAL_MS - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    lastSecRequestAt = Date.now();
  });
  secRequestQueue = reservation.catch(() => undefined);
  await reservation;
  const response = await fetch(url, {
    headers: { "User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`SEC ${response.status}: ${url}`);
  return response;
}

async function latest13fFiling(cik: string): Promise<{ accession: string; primaryDocument: string }> {
  const paddedCik = cik.padStart(10, "0");
  const submissions = await secFetch(`https://data.sec.gov/submissions/CIK${paddedCik}.json`).then((response) => response.json()) as any;
  const recent = submissions?.filings?.recent;
  if (!recent?.form || !Array.isArray(recent.form)) throw new Error(`SEC submissions missing for ${cik}`);
  const index = recent.form.findIndex((form: string) => form === "13F-HR");
  if (index < 0) throw new Error(`No current 13F-HR found for ${cik}`);
  const accession = String(recent.accessionNumber?.[index] || "");
  if (!accession) throw new Error(`13F-HR accession missing for ${cik}`);
  return { accession, primaryDocument: String(recent.primaryDocument?.[index] || "") };
}

async function fetchInformationTable(cik: string, accession: string, primaryDocument: string): Promise<string> {
  const cikNumber = String(Number(cik));
  const accessionPath = accession.replace(/-/g, "");
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${accessionPath}`;
  const candidates = new Set<string>([primaryDocument, "infotable.xml", "form13fInfoTable.xml"]);
  try {
    const directory = await secFetch(`${baseUrl}/index.json`).then((response) => response.json()) as any;
    for (const item of directory?.directory?.item || []) {
      const fileName = String(item?.name || "");
      // Many filers use arbitrary numeric filenames (e.g. "53405.xml") for
      // the table, so inspect all XML documents after preferred filenames.
      if (/\.xml$/i.test(fileName)) candidates.add(fileName);
    }
  } catch (error: any) {
    console.warn(`[SCREENER] SEC directory unavailable for ${cik}: ${error?.message}`);
  }

  for (const candidate of Array.from(candidates)) {
    if (!candidate) continue;
    try {
      const xml = await secFetch(`${baseUrl}/${candidate}`).then((response) => response.text());
      if (/(?:\w+:)?infoTable\b/i.test(xml)) return xml;
    } catch {
      // Some filings use a different filename; try the remaining candidates.
    }
  }
  throw new Error(`13F information table missing for ${cik} ${accession}`);
}

export function parseInformationTable(xml: string): SecHolding[] {
  const tables = xml.match(/<(?:[\w-]+:)?infoTable\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?infoTable>/gi) || [];
  return tables.map((table) => {
    const reportedValue = finiteNumber(xmlText(table, "value"));
    const shares = finiteNumber(xmlText(table, "sshPrnamt"));
    // Legacy 13F XML reports value in thousands, while current SEC XML filings
    // can report an exact dollar value. Compare the reported value with shares
    // to distinguish the units without inventing a market price.
    const value = shares > 0 && reportedValue / shares < 1 ? reportedValue * 1000 : reportedValue;
    return {
      issuer: xmlText(table, "nameOfIssuer"),
      cusip: xmlText(table, "cusip").toUpperCase(),
      value,
    };
  }).filter((holding) => holding.issuer && holding.cusip && holding.value > 0);
}

async function fetchInvestorHoldings(investor: StarInvestor): Promise<InvestorHoldings> {
  const filing = await latest13fFiling(investor.cik);
  const xml = await fetchInformationTable(investor.cik, filing.accession, filing.primaryDocument);
  const holdings = parseInformationTable(xml);
  if (!holdings.length) throw new Error(`No parseable holdings for ${investor.name}`);
  return { investor, holdings };
}

async function getFmpStockList(): Promise<StockListRow[]> {
  if (!stockListPromise) {
    stockListPromise = fmpStockList()
      .then((rows) => rows.map((row) => ({ symbol: row.symbol, companyName: row.companyName })))
      .catch((error) => {
        stockListPromise = null;
        console.warn(`[SCREENER] FMP stock-list unavailable: ${error?.message}`);
        return [];
      });
  }
  return stockListPromise;
}

async function fetchFmpScreenerData(ticker: string): Promise<FmpScreenerData | null> {
  if (wouldExceedBudget(6)) {
    console.warn(`[SCREENER] FMP budget too low; leaving ${ticker} numerics neutral`);
    return null;
  }
  try {
    // One logical enrichment per de-duplicated ticker. The underlying source
    // endpoints are intentionally sequential to respect the shared FMP limiter.
    const profile = await fmpProfile(ticker);
    const ratios = await fmpRatios(ticker, 1);
    const priceTarget = await fmpPriceTarget(ticker);
    const cashFlow = await fmpCashFlow(ticker, 1);
    const income = await fmpIncomeStatement(ticker, 1);
    const estimates = await fmpAnalystEstimates(ticker, 1);
    if (!profile || !(finiteNumber(profile.price) > 0)) return null;
    const range = parseYearRange(profile.range);
    const latestRatio = Array.isArray(ratios) ? ratios[0] : null;
    const latestCashFlow = Array.isArray(cashFlow) ? cashFlow[0] : null;
    const latestIncome = Array.isArray(income) ? income[0] : null;
    const latestEstimate = Array.isArray(estimates) ? estimates[0] : null;
    const revenue = finiteNumber(latestIncome?.revenue);
    const fcf = finiteNumber(latestCashFlow?.freeCashFlow);
    return {
      name: String(profile.companyName || ticker),
      price: finiteNumber(profile.price),
      marketCap: finiteNumber(profile.marketCap),
      pe: finiteNumber(latestRatio?.priceToEarningsRatio ?? latestRatio?.priceEarningsRatio),
      forwardPE: finiteNumber(latestEstimate?.epsAvg) > 0 ? finiteNumber(profile.price) / finiteNumber(latestEstimate?.epsAvg) : 0,
      sector: String(profile.sector || ""),
      beta: finiteNumber(profile.beta),
      targetPrice: finiteNumber(priceTarget?.targetConsensus),
      yearHigh: range.yearHigh,
      yearLow: range.yearLow,
      fcfMargin: revenue > 0 ? (fcf / revenue) * 100 : 0,
    };
  } catch (error: any) {
    console.warn(`[SCREENER] FMP enrichment failed for ${ticker}: ${error?.message}`);
    return null;
  }
}

function aggregateResolvedHoldings(results: InvestorHoldings[], resolveTicker: (holding: SecHolding) => string | null): AggregatedHolding[] {
  const byTicker = new Map<string, AggregatedHolding>();
  for (const result of results) {
    for (const holding of result.holdings) {
      const ticker = resolveTicker(holding);
      if (!ticker) continue;
      const existing = byTicker.get(ticker);
      if (existing) {
        existing.totalValue += holding.value;
        if (!existing.investors.includes(result.investor.name)) existing.investors.push(result.investor.name);
      } else {
        byTicker.set(ticker, {
          ticker,
          name: holding.issuer,
          totalValue: holding.value,
          investors: [result.investor.name],
        });
      }
    }
  }
  return Array.from(byTicker.values()).sort((a, b) => b.investors.length - a.investors.length || b.totalValue - a.totalValue);
}

function neutralStock(holding: AggregatedHolding): ScreenedStock {
  return {
    ticker: holding.ticker,
    name: holding.name,
    price: 0, marketCap: 0, pe: 0, forwardPE: 0, sector: "", beta: 0,
    investorCount: holding.investors.length, investors: holding.investors,
    totalValue: holding.totalValue, targetPrice: 0, upside: 0, downside: 0,
    crv: 0, crvPass: false, yearHigh: 0, yearLow: 0, fcfMargin: 0,
  };
}

export async function buildScreenerDataFromResults(
  settledResults: PromiseSettledResult<InvestorHoldings>[],
  resolveTicker: (holding: SecHolding) => string | null,
  enrichTicker: (ticker: string) => Promise<FmpScreenerData | null>,
): Promise<ScreenerData> {
  const successful = settledResults
    .filter((result): result is PromiseFulfilledResult<InvestorHoldings> => result.status === "fulfilled")
    .map((result) => result.value);
  const aggregated = aggregateResolvedHoldings(successful, resolveTicker).slice(0, MAX_SCREENED_TICKERS);
  const screenedStocks: ScreenedStock[] = [];
  for (const holding of aggregated) {
    const enrichment = await enrichTicker(holding.ticker);
    if (!enrichment) {
      screenedStocks.push(neutralStock(holding));
      continue;
    }
    const crv = calculateCrv(enrichment.price, enrichment.targetPrice, enrichment.yearLow);
    screenedStocks.push({
      ticker: holding.ticker,
      name: enrichment.name || holding.name,
      price: enrichment.price,
      marketCap: enrichment.marketCap,
      pe: enrichment.pe,
      forwardPE: enrichment.forwardPE,
      sector: enrichment.sector,
      beta: enrichment.beta,
      investorCount: holding.investors.length,
      investors: holding.investors,
      totalValue: holding.totalValue,
      targetPrice: enrichment.targetPrice,
      yearHigh: enrichment.yearHigh,
      yearLow: enrichment.yearLow,
      fcfMargin: enrichment.fcfMargin,
      ...crv,
    });
  }
  screenedStocks.sort((a, b) => b.investorCount - a.investorCount || b.totalValue - a.totalValue);
  return {
    lastUpdated: new Date().toISOString(),
    totalInvestors: successful.length,
    totalHoldings: successful.reduce((sum, result) => sum + result.holdings.length, 0),
    screenedStocks,
  };
}

async function buildScreenerData(): Promise<ScreenerData> {
  const settledResults = await Promise.allSettled(STAR_INVESTORS.map(async (investor) => {
    try {
      return await fetchInvestorHoldings(investor);
    } catch (error: any) {
      console.warn(`[SCREENER] SEC holdings failed for ${investor.name} (${investor.cik}): ${error?.message}`);
      throw error;
    }
  }));
  const stockList = await getFmpStockList();
  return buildScreenerDataFromResults(
    settledResults,
    (holding) => resolveTickerFromStockList(holding.issuer, stockList),
    fetchFmpScreenerData,
  );
}

function validCachedData(value: any): value is ScreenerData {
  return Boolean(value)
    && typeof value.lastUpdated === "string"
    && Number.isInteger(value.totalInvestors)
    && Number.isInteger(value.totalHoldings)
    && Array.isArray(value.screenedStocks);
}

export function registerScreenerRoute(app: Express): void {
  app.get("/api/screener", async (req, res) => {
    const force = String(req.query.force || "").toLowerCase() === "true";
    if (!force) {
      const cached = diskResearcherGet(SCREENER_CACHE_KEY);
      if (validCachedData(cached)) {
        console.log(`[SCREENER] cache HIT age=${(cached as any)._cacheAge ?? "?"}min`);
        return res.json({
          lastUpdated: cached.lastUpdated,
          totalInvestors: cached.totalInvestors,
          totalHoldings: cached.totalHoldings,
          screenedStocks: cached.screenedStocks,
        });
      }
    }
    try {
      console.log(`[SCREENER] building 13F star-investor screen force=${force}`);
      const data = await buildScreenerData();
      diskResearcherSet(SCREENER_CACHE_KEY, data);
      return res.json(data);
    } catch (error: any) {
      console.error(`[SCREENER] build failed: ${error?.message}`);
      return res.status(500).json({ error: error?.message || "Screener build failed" });
    }
  });
}
