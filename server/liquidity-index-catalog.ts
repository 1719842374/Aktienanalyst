/**
 * Regional liquidity books. Same two books in every region; only the office
 * and the series id change. Capex programmes are not in this catalog.
 * Spec: fertig_WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md
 */
export type Book = "M" | "F";
/** Channel C is money. It is scored, and it is not book M or book F. */
export type CatalogBook = Book | "C";
export type Region = "US" | "EU" | "ASIA";
export type Role =
  | "assets"
  | "policyPortfolio"
  | "drain"
  | "govCash"
  | "netIssuance"
  | "buybacks"
  | "rate"
  | "money";
export type Unit = "bnUSD" | "bnEUR" | "tnJPY" | "pct";

export interface SeriesSpec {
  book: CatalogBook;
  role: Role;
  /** FRED id, EDP key, or fiscal-data path. */
  id: string;
  unit: Unit;
  /** +1 = looser when x rises. */
  sign: 1 | -1;
  ttlHours: number;
  cacheKey: string;
  /** Inverse-vol share cap. China M2 stays at or below 0.10. */
  weightCap?: number;
  /** Static plan cache expires on this date (QRA next release). */
  validUntil?: string;
  /** Plan prints (QRA, EU funding) score the level, not a 30-day Δ. */
  impulse?: "level";
}

export const CATALOG: Record<Region, SeriesSpec[]> = {
  US: [
    { book: "M", role: "assets", id: "WALCL", unit: "bnUSD", sign: 1, ttlHours: 6, cacheKey: "liqidx_US__WALCL" },
    { book: "M", role: "policyPortfolio", id: "WSHOBL/WSHOTSL", unit: "bnUSD", sign: 1, ttlHours: 6, cacheKey: "liqidx_US__soma" },
    // RRP lives in the C2 bundle as a level. The index caches the series on its
    // own key so a regional read does not rebuild the US M2V path.
    { book: "M", role: "drain", id: "RRPONTSYD", unit: "bnUSD", sign: -1, ttlHours: 6, cacheKey: "liqidx_US__rrp" },
    { book: "M", role: "rate", id: "DFF", unit: "pct", sign: -1, ttlHours: 12, cacheKey: "liqidx_US__dff" },
    { book: "C", role: "money", id: "M2SL", unit: "bnUSD", sign: 1, ttlHours: 24, cacheKey: "liqidx_US__m2" },
    { book: "F", role: "govCash", id: "WTREGEN", unit: "bnUSD", sign: -1, ttlHours: 12, cacheKey: "liqidx_US__tga" },
    { book: "F", role: "netIssuance", id: "MSPD_BILLS", unit: "bnUSD", sign: -1, ttlHours: 24, cacheKey: "liqidx_US__mspd" },
    { book: "F", role: "buybacks", id: "BUYBACK_OPS", unit: "bnUSD", sign: 1, ttlHours: 12, cacheKey: "liqidx_US__buybacks" },
    {
      book: "F",
      role: "netIssuance",
      id: "QRA_IMPLIED_BILLS",
      unit: "bnUSD",
      sign: -1,
      ttlHours: 24 * 91,
      cacheKey: "fiscal__qra_2026Q3",
      validUntil: "2026-11-04",
      impulse: "level",
    },
  ],
  EU: [
    { book: "M", role: "assets", id: "ECB_WFS_ASSETS", unit: "bnEUR", sign: 1, ttlHours: 6, cacheKey: "liqidx_EU__assets" },
    { book: "M", role: "policyPortfolio", id: "APP+PEPP", unit: "bnEUR", sign: 1, ttlHours: 24, cacheKey: "liqidx_EU__app_pepp" },
    { book: "M", role: "drain", id: "ECB_DF", unit: "bnEUR", sign: -1, ttlHours: 6, cacheKey: "liqidx_EU__df" },
    { book: "M", role: "rate", id: "ECBDFR", unit: "pct", sign: -1, ttlHours: 12, cacheKey: "liqidx_EU__ecbdfr" },
    { book: "C", role: "money", id: "MABMM301", unit: "pct", sign: 1, ttlHours: 24, cacheKey: "liqidx_EU__m3" },
    { book: "F", role: "govCash", id: "ECB_GOVDEP", unit: "bnEUR", sign: -1, ttlHours: 6, cacheKey: "liqidx_EU__govdep" },
    { book: "F", role: "netIssuance", id: "EU_BONDS", unit: "bnEUR", sign: -1, ttlHours: 24 * 180, cacheKey: "liqidx_EU__eubonds", impulse: "level" },
    { book: "F", role: "netIssuance", id: "BUND", unit: "bnEUR", sign: -1, ttlHours: 24, cacheKey: "liqidx_EU__bund" },
  ],
  ASIA: [
    { book: "M", role: "assets", id: "JPNASSETS", unit: "tnJPY", sign: 1, ttlHours: 24, cacheKey: "liqidx_ASIA__jpnassets" },
    { book: "M", role: "policyPortfolio", id: "JGB_OUTRIGHT", unit: "tnJPY", sign: 1, ttlHours: 24, cacheKey: "liqidx_ASIA__jgb_px" },
    { book: "M", role: "rate", id: "IRSTCI01JPM156N", unit: "pct", sign: -1, ttlHours: 12, cacheKey: "liqidx_ASIA__rate" },
    { book: "C", role: "money", id: "BOJ_M2", unit: "pct", sign: 1, ttlHours: 24, cacheKey: "liqidx_ASIA__m2" },
    { book: "F", role: "netIssuance", id: "JGB_ISS", unit: "tnJPY", sign: -1, ttlHours: 24, cacheKey: "liqidx_ASIA__jgb_iss" },
    { book: "F", role: "govCash", id: "BOJ_GOVDEP", unit: "tnJPY", sign: -1, ttlHours: 24, cacheKey: "liqidx_ASIA__govdep" },
    { book: "C", role: "money", id: "CN_M2", unit: "pct", sign: 1, ttlHours: 24, cacheKey: "liqidx_ASIA__cn_m2", weightCap: 0.1 },
  ],
};
