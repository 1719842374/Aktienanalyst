/**
 * One unit for `dividendYield` in the analysis: PERCENT (3.6 = 3.6 %).
 * Consumers: classifyLynch (`> 2`), calcLynchPEG (`>= 1`, `growth% + yield%`), response field.
 *
 * How the FMP units are told apart (by field, then verified against the data, not by magnitude alone):
 *  - /stable/ratios `dividendYieldPercentage` → percent (FMP stable schema; same row = dividendYield × 100).
 *  - /stable/ratios `dividendYield`           → decimal fraction (0.0284 = 2.84 %).
 *  - /stable/ratios `dividendPerShare`, /stable/profile `lastDividend` (legacy `lastAnnualDividend`)
 *                                              → DOLLARS per share per year, never a yield.
 *  - /stable/quote has no dividend yield field; a legacy `quote.dividendYield` has no documented unit.
 * When a dollar reference exists (DPS / current price), every yield field is checked against it: of the two
 * readings v and v × 100, the one within a factor 2.5 of the reference wins (the readings are 100× apart, so this
 * never matches both). A field that matches neither reading is dropped. Without a reference, only the named
 * percent / decimal ratio fields are used, by schema. The legacy quote field is used only when verified.
 * Nothing usable → 0 (the existing "no dividend / N/A" value). No guessing from magnitude.
 */

export interface DividendYieldInputs {
  price: number;
  ratioDividendYield?: unknown;
  ratioDividendYieldPercentage?: unknown;
  ratioDividendPerShare?: unknown;
  profileLastDividend?: unknown;
  quoteDividendYield?: unknown;
}

export type DividendYieldBasis =
  | "ratios.dividendYieldPercentage"
  | "ratios.dividendYield"
  | "quote.dividendYield"
  | "dividendPerShare/price"
  | "none";

export interface DividendYieldResult {
  pct: number;
  basis: DividendYieldBasis;
}

const MATCH_FACTOR = 2.5;

function pos(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function near(a: number, ref: number): boolean {
  return a / ref <= MATCH_FACTOR && ref / a <= MATCH_FACTOR;
}

/** Of v (already %) and v × 100 (decimal), return the reading that matches the dollar reference, else null. */
function verified(v: number, refPct: number): number | null {
  if (near(v, refPct)) return v;
  if (near(v * 100, refPct)) return v * 100;
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function normalizeDividendYieldPct(input: DividendYieldInputs): DividendYieldResult {
  const price = pos(input.price);
  const dps = pos(input.ratioDividendPerShare) ?? pos(input.profileLastDividend);
  const refPct = price && dps ? (dps / price) * 100 : null;

  const pctField = pos(input.ratioDividendYieldPercentage);
  const decField = pos(input.ratioDividendYield);
  const quoteField = pos(input.quoteDividendYield);

  if (refPct != null) {
    if (pctField != null) { const v = verified(pctField, refPct); if (v != null) return { pct: round2(v), basis: "ratios.dividendYieldPercentage" }; }
    if (decField != null) { const v = verified(decField, refPct); if (v != null) return { pct: round2(v), basis: "ratios.dividendYield" }; }
    if (quoteField != null) { const v = verified(quoteField, refPct); if (v != null) return { pct: round2(v), basis: "quote.dividendYield" }; }
    return { pct: round2(refPct), basis: "dividendPerShare/price" };
  }
  if (pctField != null) return { pct: round2(pctField), basis: "ratios.dividendYieldPercentage" };
  if (decField != null) return { pct: round2(decField * 100), basis: "ratios.dividendYield" };
  return { pct: 0, basis: "none" };
}
