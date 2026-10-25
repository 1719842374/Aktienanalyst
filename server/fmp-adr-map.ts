/**
 * FMP über US-/ADR-Symbole für Nicht-US-Listings (Philip 18.10.2026 22:04: „Daten von FMP bekommen primär
 * auch für deutsche Titel, Fallback Yahoo“). Quelle der Ratios und Befunde: mcap-source-research-2026-10-18.md §7d.
 *
 * Der FMP-Plan liefert für lokale Symbole (.DE/.SW/.T/.PA/.AS) HTTP 402, für die US-Symbole derselben Firma nicht.
 * Dieses Modul enthält nur reine, testbare Bausteine:
 *   - feste Zuordnung lokal → ADR mit vertraglichem Verhältnis (sharesPerAdr = Stammaktien je ADR),
 *   - Such-Reserve (FMP-Suche, nur US-Börsen, 24 h Cache, Fehlschläge 2 h), nie BAMXF,
 *   - Plausibilität je Abruf: implizites Ratio ±5 % zum erwarteten, FMP-MCap ±3 % zur Yahoo-MCap,
 *   - Einheitenprüfung der FMP-Per-Share-Felder (je ADR oder je Stammaktie),
 *   - Umbau eines FMP-ADR-Datensatzes auf das lokale Listing: Kurs/Chart lokal (in USD), Per-Share-Werte ÷ Ratio.
 * Die Orchestrierung (FMP-/Yahoo-Calls) steht in analyze-helpers.ts (fmpViaAdrData).
 */

export interface AdrCandidate {
  /** US-/ADR-Symbol bei FMP. */
  symbol: string;
  /** Stammaktien je ADR (VWAPY 0,1 = 1 ADR ≙ 1/10 Vorzugsaktie; TM 10 = 1 ADR ≙ 10 Aktien). null = aus Suche, wird aus dem Kurs abgeleitet. */
  sharesPerAdr: number | null;
  origin: "map" | "search";
}

/**
 * Feste Zuordnung. Ratios live geprüft 18.10.2026 (Yahoo-Kurse ÷ FX, adr-matrix.txt): VWAPY/VWAGY 0,099, SAP 1,005,
 * BMWKY 0,331, NSRGY 0,998, TM 9,938, LVMUY 0,199, ASML 0,992.
 * BMW.DE: BMWKY ist der aktive ADR (Yahoo). FMP liefert für BMWKY keinen Kurs (Prod 18.10.2026: FMP_NO_DATA) und
 * BMWYY ist bei FMP veraltet (letzter Kurs 25.10.2024, MCap −51 % ggü. Yahoo) → BMWYY bewusst nicht gelistet.
 * BMW.DE fällt damit heute auf Yahoo zurück; sobald FMP BMWKY führt, greift die Zuordnung ohne Codeänderung.
 */
export const FMP_ADR_MAP: Readonly<Record<string, ReadonlyArray<{ symbol: string; sharesPerAdr: number }>>> = {
  "VOW3.DE": [{ symbol: "VWAPY", sharesPerAdr: 0.1 }],
  "VOW.DE": [{ symbol: "VWAGY", sharesPerAdr: 0.1 }],
  "SAP.DE": [{ symbol: "SAP", sharesPerAdr: 1 }],
  "BMW.DE": [{ symbol: "BMWKY", sharesPerAdr: 1 / 3 }],
  "NESN.SW": [{ symbol: "NSRGY", sharesPerAdr: 1 }],
  "7203.T": [{ symbol: "TM", sharesPerAdr: 10 }],
  "MC.PA": [{ symbol: "LVMUY", sharesPerAdr: 0.2 }],
  "ASML.AS": [{ symbol: "ASML", sharesPerAdr: 1 }],
};

/** Nie verwenden: BAMXF ist eine veraltete OTC-Stammaktie (−8 % MCap, Research §7d). */
export const ADR_BLOCKLIST: ReadonlySet<string> = new Set(["BAMXF"]);

/** Direkt eingegebene ADRs → Ratio (für die Einheitenprüfung im normalen FMP-Pfad). */
export function directAdrSharesPerAdr(symbol: string): number | null {
  const s = String(symbol || "").trim().toUpperCase();
  for (const list of Object.values(FMP_ADR_MAP)) for (const c of list) if (c.symbol === s) return c.sharesPerAdr;
  return null;
}

/** Nur Listings mit Börsen-Suffix sind Kandidaten (US-Ticker ohne Punkt bleiben unberührt). */
export function isNonUsListing(ticker: string): boolean {
  return /\.[A-Z]{1,3}$/i.test(String(ticker || "").trim());
}

export const ADR_RATIO_TOLERANCE = 0.05;
export const ADR_MCAP_TOLERANCE = 0.03;
/** Toleranz der Einheitenprüfung NI/Aktien vs. EPS (TTM vs. FY, verwässert, Rückkäufe; Prod: 0,985–1,096). */
export const ADR_UNIT_TOLERANCE = 0.15;

// ─── Such-Reserve ──────────────────────────────────────────────────────────────

const US_EXCHANGES = /^(NYSE|NASDAQ|AMEX|OTC|PNK|OTCMKTS|NYSEARCA|NYSE ?AMERICAN)/i;

/** Firmenname für die FMP-Suche: Akzente/Umlaute weg, Rechtsform-/Gattungs-Suffixe weg (Yahoo „VOLKSWAGEN AG      V“). */
export function normalizeSearchName(name: string): string {
  return String(name || "")
    .replace(/\s{2,}.*$/, "")
    .replace(/ß/g, "ss").replace(/[Ää]/g, "a").replace(/[Öö]/g, "o").replace(/[Üü]/g, "u")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(S\.\s?p\.\s?A|S\.\s?A|N\.\s?V|A\.\s?G|S\.\s?E)\.?(?=\s|$)/gi, " ")
    .replace(/\b(AG|SE|SA|S\.A\.|N\.?V\.?|PLC|CORP(ORATION)?|INC|CO|LTD|HOLDINGS?|GROUP|N|I|V|O\.N\.)\b\.?/gi, " ")
    .replace(/[^A-Za-z0-9& -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Suchtreffer → Kandidaten: nur US-Börsen, kein Punkt-Suffix, nie BAMXF. Reihenfolge bleibt (FMP-Relevanz). */
export function filterSearchCandidates(rows: Array<{ symbol?: string; exchange?: string; exchangeFullName?: string }>): AdrCandidate[] {
  const out: AdrCandidate[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const sym = String(r?.symbol ?? "").toUpperCase();
    if (!sym || sym.includes(".") || ADR_BLOCKLIST.has(sym) || seen.has(sym)) continue;
    const ex = `${r?.exchange ?? ""} ${r?.exchangeFullName ?? ""}`.trim();
    if (!US_EXCHANGES.test(String(r?.exchange ?? "")) && !US_EXCHANGES.test(String(r?.exchangeFullName ?? ""))) continue;
    if (!ex) continue;
    seen.add(sym);
    out.push({ symbol: sym, sharesPerAdr: null, origin: "search" });
  }
  return out.slice(0, 3);
}

export const ADR_SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
export const ADR_SEARCH_FAIL_TTL_MS = 2 * 60 * 60 * 1000;
const searchCache = new Map<string, { value: AdrCandidate[]; at: number }>();
export function clearAdrSearchCache(): void { searchCache.clear(); }

/**
 * Kandidaten für ein lokales Listing: feste Zuordnung zuerst; sonst FMP-Suche über den Firmennamen (Reserve,
 * 24 h gecacht, leere Ergebnisse 2 h). US-Ticker und Listings ohne Namen → [].
 */
export async function resolveAdrCandidates(
  ticker: string,
  companyName: string | null | undefined,
  search: (query: string) => Promise<Array<{ symbol?: string; exchange?: string; exchangeFullName?: string }>>,
  now: number = Date.now(),
): Promise<AdrCandidate[]> {
  const t = String(ticker || "").trim().toUpperCase();
  if (!isNonUsListing(t)) return [];
  const fixed = FMP_ADR_MAP[t];
  if (fixed) return fixed.filter(c => !ADR_BLOCKLIST.has(c.symbol)).map(c => ({ ...c, origin: "map" as const }));
  const q = normalizeSearchName(companyName ?? "");
  if (q.length < 3) return [];
  const hit = searchCache.get(t);
  if (hit && now - hit.at < (hit.value.length ? ADR_SEARCH_TTL_MS : ADR_SEARCH_FAIL_TTL_MS)) return hit.value;
  let value: AdrCandidate[] = [];
  try { value = filterSearchCandidates(await search(q)); } catch { value = []; }
  searchCache.set(t, { value, at: now });
  return value;
}

/** Übliche ADR-Verhältnisse; ein Suchtreffer muss eines davon auf ±5 % treffen. */
const NICE_RATIOS = [1 / 20, 1 / 10, 1 / 8, 1 / 5, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 5, 6, 8, 10, 20, 25, 50, 100];
export function snapNiceRatio(implied: number): number | null {
  if (!(implied > 0) || !Number.isFinite(implied)) return null;
  let best: number | null = null;
  for (const r of NICE_RATIOS) if (Math.abs(implied / r - 1) <= ADR_RATIO_TOLERANCE && (best == null || Math.abs(implied / r - 1) < Math.abs(implied / best - 1))) best = r;
  return best;
}

// ─── Plausibilität ────────────────────────────────────────────────────────────

export interface AdrPlausibilityInput {
  /** Lokaler Kurs (Listing-Währung, Major-Einheit). */
  localPrice: number | null | undefined;
  /** Listing-Währung → USD. */
  fxToUsd: number | null | undefined;
  /** ADR-Kurs (USD) von FMP. */
  adrPrice: number | null | undefined;
  /** Erwartetes Stammaktien-je-ADR (Map) oder null (Suche → snapNiceRatio). */
  expectedSharesPerAdr: number | null;
  /** FMP-MCap (USD, Firmenebene) über das ADR. */
  adrMarketCapUsd: number | null | undefined;
  /** Yahoo-MCap des lokalen Listings (Listing-Währung); quoteSummary oder #264 timeseries. */
  yahooMarketCapLocal: number | null | undefined;
}

export interface AdrPlausibility {
  ok: boolean;
  /** Verwendetes Ratio (Map oder gerundeter Suchtreffer). */
  sharesPerAdr: number | null;
  impliedSharesPerAdr: number | null;
  ratioDeviationPct: number | null;
  mcapDeviationPct: number | null;
  reason: string;
}

const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

export function checkAdrPlausibility(i: AdrPlausibilityInput): AdrPlausibility {
  const base: AdrPlausibility = { ok: false, sharesPerAdr: i.expectedSharesPerAdr, impliedSharesPerAdr: null, ratioDeviationPct: null, mcapDeviationPct: null, reason: "" };
  if (!pos(i.localPrice) || !pos(i.fxToUsd) || !pos(i.adrPrice)) return { ...base, reason: "Kurs lokal/ADR oder FX fehlt" };
  const implied = i.adrPrice / (i.localPrice * i.fxToUsd);
  const expected = i.expectedSharesPerAdr ?? snapNiceRatio(implied);
  const out: AdrPlausibility = { ...base, sharesPerAdr: expected, impliedSharesPerAdr: implied };
  if (!pos(expected)) return { ...out, reason: `implizites Ratio ${implied.toFixed(4)} trifft kein übliches ADR-Verhältnis` };
  out.ratioDeviationPct = (implied / expected - 1) * 100;
  if (Math.abs(implied / expected - 1) > ADR_RATIO_TOLERANCE) return { ...out, reason: `Ratio ${implied.toFixed(4)} weicht ${out.ratioDeviationPct.toFixed(1)} % von ${expected} ab (> ±5 %)` };
  if (!pos(i.adrMarketCapUsd)) return { ...out, reason: "FMP-MCap (ADR) fehlt" };
  if (!pos(i.yahooMarketCapLocal)) return { ...out, reason: "Yahoo-MCap fehlt (quoteSummary und timeseries leer) – keine Gegenprobe" };
  const yahooUsd = i.yahooMarketCapLocal * i.fxToUsd;
  out.mcapDeviationPct = (i.adrMarketCapUsd / yahooUsd - 1) * 100;
  if (Math.abs(i.adrMarketCapUsd / yahooUsd - 1) > ADR_MCAP_TOLERANCE) return { ...out, reason: `MCap FMP ${(i.adrMarketCapUsd / 1e9).toFixed(2)} Mrd vs. Yahoo ${(yahooUsd / 1e9).toFixed(2)} Mrd USD (${out.mcapDeviationPct.toFixed(1)} %, > ±3 %)` };
  return { ...out, ok: true, reason: "ok" };
}

// ─── Einheiten der FMP-Per-Share-Felder ───────────────────────────────────────

/**
 * Sind FMPs Statement-EPS je ADR (Kurs-Einheit) oder je Stammaktie? f = (Jahresüberschuss ÷ (MCap/ADR-Kurs)) ÷ EPS.
 * f ≈ 1 → "adr"; f ≈ sharesPerAdr (≠ 1) → "ordinary"; sonst null (unklar). Prod 18.10.2026: TM 1,069, LVMUY 1,043,
 * VWAPY 1,096, SAP 0,985, NSRGY 1,001, ASML 1,008 → überall "adr"; BMWYY 3,000 (veraltet) → nicht "adr".
 */
export function detectPerShareUnit(p: { netIncome: unknown; eps: unknown; marketCap: unknown; price: unknown; sharesPerAdr: number }): "adr" | "ordinary" | null {
  const ni = Number(p.netIncome), eps = Number(p.eps), mc = Number(p.marketCap), px = Number(p.price);
  if (!(Number.isFinite(ni) && ni !== 0 && Number.isFinite(eps) && eps !== 0 && mc > 0 && px > 0)) return null;
  const f = (ni / (mc / px)) / eps;
  if (!(f > 0)) return null;
  if (Math.abs(f - 1) <= ADR_UNIT_TOLERANCE) return "adr";
  if (p.sharesPerAdr !== 1 && Math.abs(f / p.sharesPerAdr - 1) <= ADR_UNIT_TOLERANCE) return "ordinary";
  return null;
}

/** Per-Share-Felder in FMP-Statements/Estimates/Ratios. Firmenwerte (Umsatz, FCF, Schulden) bleiben unberührt. */
export const INCOME_PER_SHARE_FIELDS = ["eps", "epsDiluted"] as const;
export const INCOME_SHARE_COUNT_FIELDS = ["weightedAverageShsOut", "weightedAverageShsOutDil"] as const;
export const ESTIMATE_PER_SHARE_FIELDS = ["epsAvg", "epsHigh", "epsLow", "estimatedEpsAvg", "estimatedEpsHigh", "estimatedEpsLow", "estimatedEps", "estimatedEpsDiluted"] as const;
export const PRICE_TARGET_FIELDS = ["targetHigh", "targetLow", "targetConsensus", "targetMedian", "priceTarget", "lastMonthAvgPriceTarget", "lastQuarterAvgPriceTarget", "lastYearAvgPriceTarget", "allTimeAvgPriceTarget"] as const;

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

/** FMP-Datensatz im Shape von getFmpFallbackData (nur die hier benutzten Teile). */
export interface FmpBundle {
  quote: any; profile: any;
  financials: { income: any[]; cashflow: any[]; balanceSheet: any[] };
  analyst: { priceTarget: any; grades: any[]; estimates: any[] };
  ohlcv: any[]; segments: any[]; geoSegments: any[]; peers: any[]; ratios: any[];
  source: "fmp" | "yahoo";
}

/**
 * Direkt eingegebener ADR (TM, LVMUY, VWAPY …): Kurs ist je ADR. Liefert FMP die Statement-EPS je Stammaktie
 * ("ordinary"), werden EPS/Estimates × Ratio und Aktienzahlen ÷ Ratio auf ADR-Einheit gebracht. "adr" oder unklar
 * → unverändert (bit-gleich). DCF je Aktie folgt automatisch (sharesOutstanding = MCap/Kurs in analyze-route).
 */
export function normalizeDirectAdrPerShare<T extends FmpBundle>(data: T, sharesPerAdr: number): { data: T; unit: "adr" | "ordinary" | null } {
  const inc0 = data.financials?.income?.[0] ?? {};
  const unit = detectPerShareUnit({
    netIncome: inc0.netIncome, eps: inc0.epsDiluted ?? inc0.eps,
    marketCap: data.profile?.marketCap ?? data.profile?.mktCap ?? data.quote?.marketCap, price: data.quote?.price ?? data.profile?.price, sharesPerAdr,
  });
  if (unit !== "ordinary") return { data, unit };
  const k = sharesPerAdr;
  return {
    unit,
    data: {
      ...data,
      financials: { ...data.financials, income: data.financials.income.map(r => scale(scale(r, INCOME_PER_SHARE_FIELDS, k), INCOME_SHARE_COUNT_FIELDS, 1 / k)) },
      analyst: { ...data.analyst, estimates: data.analyst.estimates.map(r => scale(r, ESTIMATE_PER_SHARE_FIELDS, k)) },
      ratios: data.ratios.map(r => scalePerShareKeys(r, k)),
      profile: data.profile ? { ...data.profile, _adrPerShareUnit: { from: "ordinary", sharesPerAdr } } : data.profile,
    },
  };
}

export interface AdrSourceInfo {
  /** FMP-Symbol, aus dem Statements/Analystendaten stammen. */
  fmpSymbol: string;
  sharesPerAdr: number;
  impliedSharesPerAdr: number;
  ratioDeviationPct: number;
  mcapDeviationPct: number;
  origin: "map" | "search";
  /** Lokale Listing-Währung, in USD umgerechnet zu fxToUsd. */
  localCurrency: string;
  fxToUsd: number;
  /** Einheit der FMP-Per-Share-Felder vor der Umrechnung. */
  perShareUnit: "adr" | "ordinary";
  note: string;
}

/** OHLCV-Felder (Yahoo-Bars, Major-Einheit). */
const BAR_FIELDS = ["open", "high", "low", "close", "adjClose"] as const;

/**
 * Baut aus einem FMP-ADR-Datensatz den Datensatz des lokalen Listings:
 * - Kurs und Chart vom lokalen Listing (Yahoo), mit fxToUsd in USD (wie #261 normalizeListingToUsd; nie ADR-Kurs).
 * - MCap = FMP-Firmen-MCap (USD). sharesOutstanding ergibt sich in analyze-route als MCap ÷ lokalem USD-Kurs.
 * - Per-Share-Felder (EPS, Estimates, Kursziel, Ratios *PerShare, Dividende) von ADR- auf Stammaktien-Einheit.
 * - Firmenwerte (Umsatz, FCF, Bilanz) unverändert (FMP rechnet sie schon in USD um).
 */
export function adrBundleToLocal<T extends FmpBundle>(adr: T, p: {
  localSymbol: string; localPrice: number; localCurrency: string; fxToUsd: number;
  localBarsNewestFirst: any[]; localExchange: string | null; localName: string | null;
  plaus: AdrPlausibility; perShareUnit: "adr" | "ordinary"; origin: "map" | "search"; fmpSymbol: string;
}): T & { fmpSymbol: string; adr: AdrSourceInfo } {
  const r = p.plaus.sharesPerAdr as number;
  const kStmt = p.perShareUnit === "adr" ? 1 / r : 1; // Statement-EPS → je Stammaktie
  const kShares = p.perShareUnit === "adr" ? r : 1;
  const kAdrPrice = 1 / r; // Kursziel/Dividende sind in ADR-Kurs-Einheit
  const fx = p.fxToUsd;
  const priceUsd = p.localPrice * fx;
  const bars = (Array.isArray(p.localBarsNewestFirst) ? p.localBarsNewestFirst : []).map(b => scale(b, BAR_FIELDS, fx));
  const lastYear = bars.slice(0, 252);
  const highs = lastYear.map(b => Number(b.high)).filter(v => v > 0);
  const lows = lastYear.map(b => Number(b.low)).filter(v => v > 0);
  const yearHigh = highs.length ? Math.max(...highs) : null;
  const yearLow = lows.length ? Math.min(...lows) : null;
  const mcap = Number(adr.profile?.marketCap ?? adr.profile?.mktCap ?? adr.quote?.marketCap) || null;
  const listingFx = { from: p.localCurrency, major: p.localCurrency, factor: 1, rate: fx, converted: true };
  const info: AdrSourceInfo = {
    fmpSymbol: p.fmpSymbol, sharesPerAdr: r, impliedSharesPerAdr: p.plaus.impliedSharesPerAdr as number,
    ratioDeviationPct: p.plaus.ratioDeviationPct as number, mcapDeviationPct: p.plaus.mcapDeviationPct as number,
    origin: p.origin, localCurrency: p.localCurrency, fxToUsd: fx, perShareUnit: p.perShareUnit,
    note: `Fundamentaldaten von FMP über ${p.fmpSymbol} (1 ADR = ${+r.toFixed(4)} Aktien); Kurs und Chart von ${p.localSymbol} (${p.localCurrency} → USD @ ${fx.toFixed(4)}). Per-Share-Werte je ${p.localSymbol}-Aktie.`,
  };
  const quote = {
    symbol: p.localSymbol, name: adr.quote?.name ?? adr.profile?.companyName ?? p.localName,
    price: priceUsd, marketCap: mcap, yearHigh, yearLow, currency: "USD", exchange: p.localExchange ?? "",
    ...(typeof adr.quote?.beta === "number" ? { beta: adr.quote.beta } : {}),
    _adrSource: p.fmpSymbol,
  };
  const prof = adr.profile ?? {};
  const profile = {
    ...scale(prof, ["lastDividend", "lastAnnualDividend"], kAdrPrice),
    ...(typeof prof.eps === "number" ? { eps: prof.eps * kStmt } : {}),
    ...(typeof prof.sharesOutstanding === "number" ? { sharesOutstanding: prof.sharesOutstanding * kShares } : {}),
    symbol: p.localSymbol, price: priceUsd, marketCap: mcap, mktCap: mcap, currency: "USD",
    exchange: p.localExchange ?? prof.exchange ?? "", range: yearLow != null && yearHigh != null ? `${yearLow.toFixed(2)}-${yearHigh.toFixed(2)}` : prof.range,
    _adrSource: info, _listingFx: listingFx,
  };
  return {
    ...adr,
    quote, profile,
    financials: { ...adr.financials, income: adr.financials.income.map(row => scale(scale(row, INCOME_PER_SHARE_FIELDS, kStmt), INCOME_SHARE_COUNT_FIELDS, kShares)) },
    analyst: {
      ...adr.analyst,
      priceTarget: adr.analyst.priceTarget && typeof adr.analyst.priceTarget === "object" ? scale(adr.analyst.priceTarget, PRICE_TARGET_FIELDS, kAdrPrice) : adr.analyst.priceTarget,
      estimates: adr.analyst.estimates.map(row => scale(row, ESTIMATE_PER_SHARE_FIELDS, kStmt)),
    },
    ratios: adr.ratios.map(row => scalePerShareKeys(row, kStmt)),
    ohlcv: bars,
    source: "fmp" as const,
    fmpSymbol: p.fmpSymbol,
    adr: info,
  };
}
