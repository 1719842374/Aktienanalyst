/**
 * C2 live fetch — FRED WALCL / RRPONTSYD / WTREGEN (+ optional M2 overlay).
 * Additive; does not touch researcher.ts or /api/health.
 */
import {
  type FredObs,
  type LiquidityMetrics,
  computeLiquidityMetrics,
} from "./liquidity-regime-math";
import { cachedTreasuryBuybackCapBn } from "./policy-scan";
import { fiscalRegimeAttachment, type FiscalRegimeFields } from "./fiscal-frontend";

export const LIQUIDITY_CACHE_TAB = "macro";
export const LIQUIDITY_CACHE_PARAMS = "v2__US";

const SERIES = {
  walcl: "WALCL",
  rrp: "RRPONTSYD",
  tga: "WTREGEN",
  m2: "M2SL",
  m2v: "M2V",
  gdp: "GDPC1",
  cpi: "CPIAUCSL",
} as const;

function monthsAgoISO(n: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

function parseFredCsv(csv: string): FredObs[] {
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return [];
  const lines = csv.trim().split(/\r?\n/);
  const out: FredObs[] = [];
  for (const line of lines.slice(1)) {
    const [date, raw] = line.split(",");
    if (!date || raw == null || raw.trim() === ".") continue;
    const value = Number(raw.trim());
    if (/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) && Number.isFinite(value)) {
      out.push({ date: date.trim(), value });
    }
  }
  return out;
}

const MONTHLY_LOOKBACK = 30;
const QUARTERLY_LOOKBACK = 66;

async function fetchFredSeries(series: string, months: number): Promise<FredObs[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}&cosd=${monthsAgoISO(months)}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return [];
    return parseFredCsv(await resp.text());
  } catch {
    return [];
  }
}

export async function fetchLiquidityLive(): Promise<LiquidityMetrics & Partial<FiscalRegimeFields>> {
  const [walcl, rrp, tga, m2, m2v, gdp, cpi] = await Promise.all([
    fetchFredSeries(SERIES.walcl, MONTHLY_LOOKBACK),
    fetchFredSeries(SERIES.rrp, MONTHLY_LOOKBACK),
    fetchFredSeries(SERIES.tga, MONTHLY_LOOKBACK),
    fetchFredSeries(SERIES.m2, MONTHLY_LOOKBACK),
    fetchFredSeries(SERIES.m2v, QUARTERLY_LOOKBACK),
    fetchFredSeries(SERIES.gdp, QUARTERLY_LOOKBACK),
    fetchFredSeries(SERIES.cpi, MONTHLY_LOOKBACK),
  ]);
  const metrics = computeLiquidityMetrics({
    walcl, rrp, tga, m2, m2v, gdp, cpi,
    treasuryBuybackCapBn: cachedTreasuryBuybackCapBn(),
  });
  if (!metrics.dataQuality.walcl || !metrics.dataQuality.rrp || !metrics.dataQuality.tga) {
    throw new Error("FRED WALCL/RRP/TGA unvollständig");
  }
  // DFF 5y und SOMA 2y plus Ops-Flag. Fehlschlag lässt den C2-Score unverändert.
  try {
    const extra = await fiscalRegimeAttachment(metrics.asOf);
    return { ...metrics, ...extra };
  } catch (err: any) {
    console.error("[liquidity] fiscal attachment", err?.message?.substring(0, 200));
    return metrics;
  }
}
