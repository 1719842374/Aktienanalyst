/**
 * Minor-unit listings (LSE ".L" quotes in pence "GBp"/"GBX", JSE "ZAc", TASE "ILA").
 *
 * FMP quote/profile price, 52W range, moving averages and OHLCV come in the MINOR unit
 * (SHEL.L 3793.5 = £37.935), while profile.mktCap is already in the MAJOR unit (£209.9 bn)
 * and the financial statements / estimates arrive in the filer's reporting currency, which
 * getFmpFallbackData converts to USD. Mixed, that gave sharesOutstanding = mktCap / pence
 * (100× too few shares), forward P/E = pence / EPS (SHEL 627, AZN 1170, ULVR 1331),
 * dividend yield = DPS / pence (0.04 %) and EV = GBP market cap + USD net debt.
 *
 * Normalisation (one place, before analyze-route reads anything): market side ÷ factor into
 * the major unit, profile.currency → major, statements/estimates USD → major via the same
 * live FX rate the USD conversion uses. Afterwards every amount is in GBP (ZAR, ILS).
 */
export const MINOR_UNITS: Record<string, { major: string; factor: number }> = {
  GBp: { major: "GBP", factor: 100 },
  GBX: { major: "GBP", factor: 100 },
  ZAc: { major: "ZAR", factor: 100 },
  ZAC: { major: "ZAR", factor: 100 },
  ILA: { major: "ILS", factor: 100 },
};

export function minorUnitInfo(currency: unknown): { minor: string; major: string; factor: number } | null {
  if (typeof currency !== "string") return null;
  const hit = MINOR_UNITS[currency.trim()];
  return hit ? { minor: currency.trim(), ...hit } : null;
}

const QUOTE_PRICE_FIELDS = ["price", "open", "dayHigh", "dayLow", "yearHigh", "yearLow", "previousClose", "change", "priceAvg50", "priceAvg200"];
const PROFILE_PRICE_FIELDS = ["price", "changes", "change"];
const BAR_FIELDS = ["open", "high", "low", "close", "adjClose", "vwap", "change"];

function scaleFields<T extends Record<string, any>>(row: T, fields: string[], mul: number): T {
  if (!row || typeof row !== "object") return row;
  const out: any = { ...row };
  for (const f of fields) if (typeof out[f] === "number" && Number.isFinite(out[f])) out[f] = out[f] * mul;
  return out;
}

/** Profile "range" string "2553.77-3806.5" → "25.5377-38.065". */
function scaleRange(r: unknown, mul: number): unknown {
  if (typeof r !== "string") return r;
  const m = r.match(/^\s*([\d.]+)\s*-\s*([\d.]+)\s*$/);
  return m ? `${+(+m[1] * mul).toFixed(6)}-${+(+m[2] * mul).toFixed(6)}` : r;
}

/** Yahoo chart bars: meta.currency "GBp" → divide OHLC by 100 (volume untouched). */
export function yahooBarsToMajor<B extends { open: number; high: number; low: number; close: number }>(bars: B[], metaCurrency: unknown): B[] {
  const mu = minorUnitInfo(metaCurrency);
  return mu ? bars.map(b => scaleFields(b, ["open", "high", "low", "close"], 1 / mu.factor)) : bars;
}

export interface MinorUnitInput {
  quote: any; profile: any;
  financials: { income: any[]; cashflow: any[]; balanceSheet: any[] };
  analyst: { priceTarget: any; grades: any; estimates: any[] };
  ohlcv: any;
  [k: string]: any;
}

/**
 * @param majorToUsd live FX rate major→USD (e.g. GBPUSD 1.27); statements stay USD when it's missing/1
 *                   (no guessed FX), but the pence fix on the market side still applies.
 * @param statementFields numeric statement/estimate fields to convert (fmp.ts FX_CONVERTIBLE_FIELDS).
 */
export const FX_MISSING_WARNING = (major: string) => `FX ${major}USD fehlt`;

export function normalizeMinorUnitListing<T extends MinorUnitInput>(data: T, majorToUsd: number | null | undefined, statementFields: Iterable<string>): T {
  const mu = minorUnitInfo(data?.profile?.currency ?? data?.quote?.currency);
  if (!mu) return data;
  const fx = Number(majorToUsd);
  // No FX rate → no conversion at all (never a GBP price next to USD statements). Data stays exactly as before,
  // only flagged as partial so the caller/logs can surface "FX GBPUSD fehlt".
  if (!(Number.isFinite(fx) && fx > 0 && fx !== 1)) {
    return { ...data, profile: data.profile ? { ...data.profile, _minorUnit: { from: mu.minor, factor: mu.factor, partial: true, warning: FX_MISSING_WARNING(mu.major) } } : data.profile };
  }
  const k = 1 / mu.factor;
  const quote = scaleFields(data.quote, QUOTE_PRICE_FIELDS, k);
  let profile = scaleFields(data.profile, PROFILE_PRICE_FIELDS, k);
  if (profile) profile = { ...profile, range: scaleRange(profile.range, k), currency: mu.major, _minorUnit: { from: mu.minor, factor: mu.factor, partial: false } };
  const rows = Array.isArray(data.ohlcv) ? data.ohlcv : data.ohlcv?.historical;
  const scaledBars = Array.isArray(rows) ? rows.map((r: any) => scaleFields(r, BAR_FIELDS, k)) : rows;
  const ohlcv = Array.isArray(data.ohlcv) ? scaledBars : data.ohlcv?.historical ? { ...data.ohlcv, historical: scaledBars } : data.ohlcv;
  const fields = Array.from(statementFields);
  const toMajor = (arr: any[]) => (Array.isArray(arr) ? arr : []).map(r => {
    // Rows are USD here: either reported in USD, or converted by convertFmpRowsToUsd.
    const cur = r?._fxConverted ? "USD" : r?.reportedCurrency;
    if (cur && cur !== "USD") return r;
    return { ...scaleFields(r, fields, 1 / fx), reportedCurrency: mu.major, _fxToListing: { from: "USD", to: mu.major, rate: 1 / fx } };
  });
  const financials = { income: toMajor(data.financials?.income), cashflow: toMajor(data.financials?.cashflow), balanceSheet: toMajor(data.financials?.balanceSheet) };
  const analyst = { ...data.analyst, estimates: toMajor(data.analyst?.estimates), priceTarget: priceTargetToListingUnit(data.analyst?.priceTarget, quote?.price ?? profile?.price, mu.factor) };
  return { ...data, quote, profile, ohlcv, financials, analyst };
}

/**
 * Analyst price targets (FMP /price-target-consensus) of a minor-unit listing. FMP does not state their unit:
 * a .L consensus can come in pence (3200) or pounds (32). The price next to it is already in the major unit
 * after normalisation, so the target is accepted only in the ONE scale (as-is, ÷factor, ×factor) whose
 * reference target lands within 0.2×–5× of the price. No price, no target, or no / more than one plausible
 * scale → every target field null (UI/route show n/a), never a guessed unit. Returns the input unchanged when
 * it carries no target at all.
 */
export const PRICE_TARGET_FIELDS = ["targetHigh", "targetLow", "targetConsensus", "targetMedian", "priceTarget"];
const PT_MIN_RATIO = 0.2;
const PT_MAX_RATIO = 5;

export function priceTargetToListingUnit(pt: any, price: unknown, factor: number): any {
  if (!pt || typeof pt !== "object") return pt;
  const ref = [pt.targetMedian, pt.targetConsensus, pt.priceTarget, pt.targetHigh, pt.targetLow].map(Number).find(v => Number.isFinite(v) && v > 0);
  if (ref == null) return pt;
  const px = Number(price);
  const nulled = () => {
    const out: any = { ...pt };
    for (const f of PRICE_TARGET_FIELDS) if (f in out) out[f] = null;
    return { ...out, _unit: { ensured: false, reason: Number.isFinite(px) && px > 0 ? "Kursziel-Einheit nicht eindeutig" : "Kurs fehlt" } };
  };
  if (!(Number.isFinite(px) && px > 0)) return nulled();
  const scales = [1, 1 / factor, factor].filter(m => { const r = (ref * m) / px; return r >= PT_MIN_RATIO && r <= PT_MAX_RATIO; });
  if (scales.length !== 1) return nulled();
  return { ...scaleFields(pt, PRICE_TARGET_FIELDS, scales[0]), _unit: { ensured: true, scale: scales[0] } };
}

/**
 * Stooq symbol + quote unit. Stooq lists LSE shares as "<ticker>.uk" (not ".l") and quotes them in pence
 * (GBX), like Yahoo's "GBp" — so .L history is normalised by the same factor as #244 (minorUnitInfo).
 * Other symbols keep the previous mapping (dotted → lower case, plain US ticker → ".us").
 */
const STOOQ_SUFFIX: Record<string, { stooq: string; quoteCurrency: string }> = {
  L: { stooq: "uk", quoteCurrency: "GBp" },
};

export function stooqListing(symbol: string): { stooqSymbol: string; quoteCurrency: string | null } {
  const m = symbol.match(/^(.+)\.([A-Za-z]+)$/);
  const hit = m ? STOOQ_SUFFIX[m[2].toUpperCase()] : undefined;
  if (m && hit) return { stooqSymbol: `${m[1].toLowerCase()}.${hit.stooq}`, quoteCurrency: hit.quoteCurrency };
  return { stooqSymbol: symbol.includes(".") ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`, quoteCurrency: null };
}

/** Dividend amounts of a minor-unit listing (FMP/Yahoo .L dividends are in pence) → major unit, currency stated. */
export function dividendsToMajor<E extends { amount: number }>(events: E[], listingCurrency: unknown): { events: E[]; currency: string | null } | null {
  const mu = minorUnitInfo(listingCurrency);
  if (!mu) return null;
  return { events: events.map(e => ({ ...e, amount: e.amount / mu.factor })), currency: mu.major };
}

/**
 * UI note for an analysis whose currency is still a minor unit. After #244 a converted .L analysis says "GBP";
 * "GBp" in the response means the FX rate was missing and nothing was converted (partial). The flag reaches the
 * client through the existing `currency` field (analyze-route passes profile.currency through) — no route change.
 */
export function listingFxWarning(currency: unknown): string | null {
  const mu = minorUnitInfo(currency);
  return mu ? `FX ${mu.major}USD fehlt – Werte unkonvertiert (Kurs in ${mu.minor}, Bilanz in USD)` : null;
}
