/**
 * #265 v2: FMP über US-/ADR-Symbole für SAP.DE und VOW3.DE (FMP-Plan liefert für .DE HTTP 402).
 * Neu auf main 35037f92 gebaut. Kleiner als #265 v1: keine Such-Reserve und keine Einheitenkorrektur für direkt
 * eingegebene ADRs; analyze-route.ts bleibt unverändert.
 *
 * Reihenfolge je Listing:
 *   SAP.DE  → SAP   (1 ADR = 1 Aktie)
 *   VOW3.DE → VWAPY (Vorzug, 1 ADR = 0,1 Aktie); liefert FMP für VWAPY nichts (leer/402) oder ist der Datensatz
 *             unplausibel → VWAGY (Stammaktie, 0,1) als Proxy, mit sichtbarem Hinweis „Proxy: Stammaktie“.
 * Scheitern alle Kandidaten → Yahoo-Fallback wie bisher (analyze-helpers).
 *
 * Reine Bausteine (testbar ohne Netz): Map, Plausibilität, Einheitenprüfung, Umbau ADR → lokales Listing.
 */

export interface AdrCandidate {
  /** US-/ADR-Symbol bei FMP. */
  symbol: string;
  /** Aktien je ADR (VWAPY 0,1 = 1 ADR ≙ 1/10 Aktie). */
  sharesPerAdr: number;
  /** true = andere Aktiengattung als das Listing (VWAGY = Stammaktie für VOW3.DE = Vorzug). */
  proxy?: boolean;
}

/** Ratios aus #265 v1 (live geprüft 18.10.2026): SAP 1,005; VWAPY/VWAGY 0,099. */
export const FMP_ADR_MAP: Readonly<Record<string, ReadonlyArray<AdrCandidate>>> = {
  "SAP.DE": [{ symbol: "SAP", sharesPerAdr: 1 }],
  "VOW3.DE": [{ symbol: "VWAPY", sharesPerAdr: 0.1 }, { symbol: "VWAGY", sharesPerAdr: 0.1, proxy: true }],
};

export const ADR_PROXY_NOTE = "Proxy: Stammaktie";

export function adrCandidatesFor(ticker: string): AdrCandidate[] {
  const t = String(ticker || "").trim().toUpperCase();
  return (FMP_ADR_MAP[t] ?? []).map(c => ({ ...c }));
}

export const ADR_RATIO_TOLERANCE = 0.05;
/**
 * Proxy (Stammaktie für ein Vorzugs-Listing): Der Kurs der anderen Gattung weicht strukturell ab (Prämie Stamm vs.
 * Vorzug). Deshalb ±10 % beim Kursverhältnis; die MCap-Gegenprobe auf Firmenebene bleibt bei ±3 %.
 */
export const ADR_RATIO_TOLERANCE_PROXY = 0.10;
export const ADR_MCAP_TOLERANCE = 0.03;
/** Einheitenprüfung NI/Aktien vs. EPS (TTM vs. FY, verwässert; Prod v1: 0,985–1,096). */
export const ADR_UNIT_TOLERANCE = 0.15;

export interface AdrPlausibilityInput {
  localPrice: number | null | undefined;     // Listing-Währung (EUR)
  fxToUsd: number | null | undefined;        // EUR → USD
  adrPrice: number | null | undefined;       // USD je ADR (FMP)
  sharesPerAdr: number;
  proxy?: boolean;
  adrMarketCapUsd: number | null | undefined; // FMP, Firmenebene
  yahooMarketCapLocal: number | null | undefined; // Yahoo (quoteSummary oder #264 timeseries), Listing-Währung
}

export interface AdrPlausibility {
  ok: boolean;
  impliedSharesPerAdr: number | null;
  ratioDeviationPct: number | null;
  mcapDeviationPct: number | null;
  reason: string;
}

const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

export function checkAdrPlausibility(i: AdrPlausibilityInput): AdrPlausibility {
  const out: AdrPlausibility = { ok: false, impliedSharesPerAdr: null, ratioDeviationPct: null, mcapDeviationPct: null, reason: "" };
  if (!pos(i.localPrice) || !pos(i.fxToUsd) || !pos(i.adrPrice)) return { ...out, reason: "Kurs lokal/ADR oder FX fehlt" };
  const implied = i.adrPrice / (i.localPrice * i.fxToUsd);
  out.impliedSharesPerAdr = implied;
  out.ratioDeviationPct = (implied / i.sharesPerAdr - 1) * 100;
  const tol = i.proxy ? ADR_RATIO_TOLERANCE_PROXY : ADR_RATIO_TOLERANCE;
  if (Math.abs(implied / i.sharesPerAdr - 1) > tol) return { ...out, reason: `Ratio ${implied.toFixed(4)} weicht ${out.ratioDeviationPct.toFixed(1)} % von ${i.sharesPerAdr} ab (> ±${tol * 100} %)` };
  if (!pos(i.adrMarketCapUsd)) return { ...out, reason: "FMP-MCap (ADR) fehlt" };
  if (!pos(i.yahooMarketCapLocal)) return { ...out, reason: "Yahoo-MCap fehlt – keine Gegenprobe" };
  const yahooUsd = i.yahooMarketCapLocal * i.fxToUsd;
  out.mcapDeviationPct = (i.adrMarketCapUsd / yahooUsd - 1) * 100;
  if (Math.abs(i.adrMarketCapUsd / yahooUsd - 1) > ADR_MCAP_TOLERANCE) return { ...out, reason: `MCap FMP ${(i.adrMarketCapUsd / 1e9).toFixed(2)} Mrd vs. Yahoo ${(yahooUsd / 1e9).toFixed(2)} Mrd USD (${out.mcapDeviationPct.toFixed(1)} %, > ±3 %)` };
  return { ...out, ok: true, reason: "ok" };
}

/** f = (NI ÷ (MCap/ADR-Kurs)) ÷ EPS: ≈1 → EPS je ADR; ≈ sharesPerAdr → je Aktie; sonst null. */
export function detectPerShareUnit(p: { netIncome: unknown; eps: unknown; marketCap: unknown; price: unknown; sharesPerAdr: number }): "adr" | "ordinary" | null {
  const ni = Number(p.netIncome), eps = Number(p.eps), mc = Number(p.marketCap), px = Number(p.price);
  if (!(Number.isFinite(ni) && ni !== 0 && Number.isFinite(eps) && eps !== 0 && mc > 0 && px > 0)) return null;
  const f = (ni / (mc / px)) / eps;
  if (!(f > 0)) return null;
  if (Math.abs(f - 1) <= ADR_UNIT_TOLERANCE) return "adr";
  if (p.sharesPerAdr !== 1 && Math.abs(f / p.sharesPerAdr - 1) <= ADR_UNIT_TOLERANCE) return "ordinary";
  return null;
}

/** Hat FMP für das ADR verwertbare Fundamentaldaten? (Kurs + mindestens eine Income-Zeile) */
export function adrBundleHasData(b: { source?: string; quote?: any; financials?: { income?: any[] } } | null | undefined): boolean {
  return !!b && b.source === "fmp" && pos(Number(b.quote?.price)) && Array.isArray(b.financials?.income) && b.financials!.income!.length > 0;
}

const INCOME_PER_SHARE_FIELDS = ["eps", "epsDiluted"];
const INCOME_SHARE_COUNT_FIELDS = ["weightedAverageShsOut", "weightedAverageShsOutDil"];
const ESTIMATE_PER_SHARE_FIELDS = ["epsAvg", "epsHigh", "epsLow", "estimatedEpsAvg", "estimatedEpsHigh", "estimatedEpsLow", "estimatedEps", "estimatedEpsDiluted"];
const PRICE_TARGET_FIELDS = ["targetHigh", "targetLow", "targetConsensus", "targetMedian", "priceTarget"];

function scale<T extends Record<string, any>>(row: T, fields: Iterable<string>, k: number): T {
  if (!row || typeof row !== "object" || k === 1) return row;
  const o: any = { ...row };
  for (const f of Array.from(fields)) if (typeof o[f] === "number" && Number.isFinite(o[f])) o[f] = o[f] * k;
  return o;
}
function scalePerShareKeys<T extends Record<string, any>>(row: T, k: number): T {
  if (!row || typeof row !== "object" || k === 1) return row;
  const o: any = { ...row };
  for (const key of Object.keys(o)) if (/PerShare$/.test(key) && typeof o[key] === "number" && Number.isFinite(o[key])) o[key] = o[key] * k;
  return o;
}

export interface FmpBundle {
  quote: any; profile: any;
  financials: { income: any[]; cashflow: any[]; balanceSheet: any[] };
  analyst: { priceTarget: any; grades: any[]; estimates: any[] };
  ohlcv: any[]; segments: any[]; geoSegments: any[]; peers: any[]; ratios: any[];
  source: "fmp" | "yahoo";
}

export interface AdrSourceInfo {
  fmpSymbol: string;
  sharesPerAdr: number;
  proxy: boolean;
  impliedSharesPerAdr: number;
  ratioDeviationPct: number;
  mcapDeviationPct: number;
  perShareUnit: "adr" | "ordinary";
  /** Sichtbarer Hinweis (Section 1 über currencyInfo.note). */
  note: string;
}

export function adrSourceNote(localSymbol: string, c: AdrCandidate): string {
  const base = `Fundamentaldaten von FMP über ${c.symbol} (1 ADR = ${+c.sharesPerAdr.toFixed(4)} Aktien), Kurs und Chart von ${localSymbol}.`;
  return c.proxy ? `${ADR_PROXY_NOTE} — ${base} ${c.symbol} ist die Stammaktie; Per-Share-Werte gelten je Stammaktie.` : base;
}

/**
 * ADR-Datensatz → Datensatz des lokalen Listings, Marktseite in der LISTING-Währung (EUR), damit danach die
 * normale USD-Normalisierung von main (analyze-helpers listingToUsd, #261) Kurs, MCap, Chart und Kursziel umrechnet:
 *   - Kurs/Chart: lokales Listing (Yahoo, Major-Einheit). Nie der ADR-Kurs.
 *   - MCap: FMP-Firmen-MCap (USD) ÷ fx → EUR.
 *   - Kursziel: USD je ADR ÷ Ratio ÷ fx → EUR je Aktie.
 *   - Statements (schon USD über convertFmpRowsToUsd): EPS/Estimates je Aktie, Aktienzahlen je Aktie.
 *   - quote nur lokal (Kurs, MCap, 52W aus lokalen Bars, beta); keine ADR-Volumina/EPS. EPS kommt aus den Statements.
 */
export function adrBundleToLocalListing<T extends FmpBundle>(adr: T, p: {
  localSymbol: string; localPrice: number; localCurrency: string; fxToUsd: number;
  localBarsNewestFirst: any[]; localExchange: string | null; localName: string | null;
  candidate: AdrCandidate; plaus: AdrPlausibility; perShareUnit: "adr" | "ordinary";
}): T & { fmpSymbol: string; adr: AdrSourceInfo } {
  const r = p.candidate.sharesPerAdr;
  const kStmt = p.perShareUnit === "adr" ? 1 / r : 1;
  const kShares = p.perShareUnit === "adr" ? r : 1;
  const kAdrPriceToLocal = 1 / r / p.fxToUsd;
  const mcapUsd = Number(adr.profile?.marketCap ?? adr.profile?.mktCap ?? adr.quote?.marketCap) || null;
  const mcapLocal = mcapUsd != null ? mcapUsd / p.fxToUsd : null;
  const bars = Array.isArray(p.localBarsNewestFirst) ? p.localBarsNewestFirst : [];
  const lastYear = bars.slice(0, 252);
  const highs = lastYear.map(b => Number(b.high)).filter(v => v > 0);
  const lows = lastYear.map(b => Number(b.low)).filter(v => v > 0);
  const info: AdrSourceInfo = {
    fmpSymbol: p.candidate.symbol, sharesPerAdr: r, proxy: !!p.candidate.proxy,
    impliedSharesPerAdr: p.plaus.impliedSharesPerAdr as number, ratioDeviationPct: p.plaus.ratioDeviationPct as number,
    mcapDeviationPct: p.plaus.mcapDeviationPct as number, perShareUnit: p.perShareUnit,
    note: adrSourceNote(p.localSymbol, p.candidate),
  };
  const quote = {
    ...(typeof adr.quote?.beta === "number" ? { beta: adr.quote.beta } : {}),
    symbol: p.localSymbol, name: adr.quote?.name ?? adr.profile?.companyName ?? p.localName,
    price: p.localPrice, marketCap: mcapLocal, yearHigh: highs.length ? Math.max(...highs) : null, yearLow: lows.length ? Math.min(...lows) : null,
    currency: p.localCurrency, exchange: p.localExchange ?? "", _adrSource: p.candidate.symbol,
  };
  const { eps: _pe, ...prof } = adr.profile ?? {};
  const profile = {
    ...scale(prof, ["lastDividend", "lastAnnualDividend"], kAdrPriceToLocal),
    ...(typeof prof.sharesOutstanding === "number" ? { sharesOutstanding: prof.sharesOutstanding * kShares } : {}),
    symbol: p.localSymbol, price: p.localPrice, marketCap: mcapLocal, mktCap: mcapLocal, currency: p.localCurrency,
    changes: undefined, change: undefined, range: undefined,
    exchange: p.localExchange ?? prof.exchange ?? "", _adrSource: info,
  };
  return {
    ...adr, quote, profile,
    financials: { ...adr.financials, income: adr.financials.income.map(row => scale(scale(row, INCOME_PER_SHARE_FIELDS, kStmt), INCOME_SHARE_COUNT_FIELDS, kShares)) },
    analyst: {
      ...adr.analyst,
      priceTarget: adr.analyst.priceTarget && typeof adr.analyst.priceTarget === "object" ? scale(adr.analyst.priceTarget, PRICE_TARGET_FIELDS, kAdrPriceToLocal) : adr.analyst.priceTarget,
      estimates: adr.analyst.estimates.map(row => scale(row, ESTIMATE_PER_SHARE_FIELDS, kStmt)),
    },
    ratios: adr.ratios.map(row => scalePerShareKeys(row, kStmt)),
    ohlcv: bars,
    source: "fmp" as const,
    fmpSymbol: p.candidate.symbol,
    adr: info,
  };
}
