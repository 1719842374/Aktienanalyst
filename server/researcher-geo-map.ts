/**
 * Offen_WORK_CAPEX_SECTOR_MAP.md — Slice 1 (Capex-Layer). Baut die Länderdaten für
 * GET /api/researcher/geo-map?layer=capex. Nur Anzeige im Researcher, KEIN Score.
 *
 * Quelle: FMP company-screener (country=ISO2, nach Market Cap) → Top-N Firmen je Land,
 * dann FMP cash-flow-statement (FY) → capitalExpenditure, FX → USD (convertFmpRowsToUsd).
 * Zuordnung des Capex nach Firmensitz. Umsatz-Geosegmente (FMP revenue-geographic-segmentation)
 * hängen zusätzlich an der Firma, ohne den Capex auf andere Länder umzulegen.
 * Fehlende Daten → status "n/a", nie geschätzt.
 */
import { fmpCashFlow, convertFmpRowsToUsd, fmpGeoSegments } from "./fmp";
import { trackFmpCall } from "./analyze-helpers";
import { currencyFromTickerSuffix } from "@shared/listing-units";
import {
  GEO_MAP_COUNTRIES, aggregateCountry, mapGeoSegmentRows,
  type GeoMapCompany, type GeoMapCountryDef, type GeoMapResponse,
} from "@shared/geo-map";

export const GEO_MAP_CACHE_TAB = "geo-map-capex";
export const GEO_MAP_TOP_N = 6;
const MIN_MARKET_CAP = 2_000_000_000;

export interface ScreenerCompany { symbol: string; name: string; sector: string | null; marketCap: number }

/** Eine Zeile aus FMP company-screener. Land ist der Emittentensitz, nicht die Börse. */
export interface ListingCandidate {
  symbol: string;
  name: string;
  sector: string | null;
  marketCap: number;
  currency?: string | null;
  exchange?: string | null;
  exchangeShortName?: string | null;
}

/**
 * Börsenkürzel → Land der Notierung. Keine Ticker.
 * FMP company-screener setzt `country` auf den Firmensitz und kopiert die
 * Emittenten-Marktkapitalisierung auf jedes Listing, auch auf CDR an der NEO
 * (Cboe Canada, Suffix .NE).
 */
const EXCHANGE_COUNTRY: Record<string, string> = {
  NASDAQ: "US", NYSE: "US", AMEX: "US", NYSEARCA: "US", NYSEMKT: "US", BATS: "US", OTC: "US", PINK: "US", CBOE: "US",
  NEO: "CA", TSX: "CA", TSXV: "CA", CSE: "CA", CNQ: "CA", CBOECANADA: "CA", NEOEXCHANGE: "CA",
  XETRA: "DE", XETR: "DE", FRA: "DE", FWB: "DE", BER: "DE", DUS: "DE", HAM: "DE", MUN: "DE", STU: "DE", GER: "DE",
  LSE: "GB", LON: "GB",
  PAR: "FR", EPA: "FR",
  AMS: "NL",
  SIX: "CH", SWX: "CH",
  MIL: "IT", BIT: "IT",
  BME: "ES", MCE: "ES",
  STO: "SE",
  CPH: "DK",
  OSL: "NO",
  TYO: "JP", JPX: "JP",
  HKSE: "HK", HKG: "HK",
  ASX: "AU",
  SES: "SG", SGX: "SG",
  KSC: "KR", KOE: "KR", KRX: "KR",
  TAI: "TW", TWO: "TW", TPE: "TW",
  SHH: "CN", SHZ: "CN", SSE: "CN", SZSE: "CN",
  NSE: "IN", BSE: "IN",
  MEX: "MX", BMV: "MX",
  SAO: "BR", BVMF: "BR",
  SGO: "CL",
  JSE: "ZA",
  SAU: "SA", TADAWUL: "SA",
};

/**
 * FMP-Suffix → Land der Notierung. Spiegelt die Suffixe aus listing-units
 * (SG = Stuttgart, SI = Singapur). .SA ist São Paulo, nicht Saudi-Arabien.
 */
const SUFFIX_COUNTRY: Record<string, string> = {
  NE: "CA", TO: "CA", V: "CA",
  DE: "DE", F: "DE", BE: "DE", DU: "DE", HM: "DE", MU: "DE", SG: "DE",
  PA: "FR", AS: "NL", BR: "BE", MC: "ES", MI: "IT", SW: "CH",
  L: "GB", IL: "GB", LS: "PT", VI: "AT", HE: "FI", IR: "IE",
  ST: "SE", CO: "DK", OL: "NO",
  T: "JP", HK: "HK", AX: "AU", NZ: "NZ", SI: "SG",
  JO: "ZA", TA: "IL",
  SA: "BR", MX: "MX", SN: "CL", SR: "SA",
  KS: "KR", KQ: "KR", TW: "TW",
  SS: "CN", SZ: "CN", NS: "IN", BO: "IN",
};

/** Währung des Firmensitzes. Nur Länder, keine Ticker. */
const SEAT_CURRENCY: Record<string, string> = {
  US: "USD", CA: "CAD", MX: "MXN", BR: "BRL", CL: "CLP",
  GB: "GBP", DE: "EUR", FR: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", FI: "EUR", IE: "EUR", PT: "EUR", ES: "EUR", IT: "EUR",
  CH: "CHF", SE: "SEK", DK: "DKK", NO: "NOK",
  SA: "SAR", ZA: "ZAR", IN: "INR", CN: "CNY", HK: "HKD", TW: "TWD", KR: "KRW", JP: "JPY", SG: "SGD", AU: "AUD", IL: "ILS", NZ: "NZD",
};

function canonicalCurrency(code: string): string {
  const u = code.trim().toUpperCase();
  if (u === "GBX" || u === "GBP") return "GBP";
  if (u === "ILA") return "ILS";
  if (u === "ZAC") return "ZAR";
  return u;
}

function currenciesAlign(listing: string | null, seat: string | null): boolean {
  if (!listing || !seat) return false;
  return canonicalCurrency(listing) === canonicalCurrency(seat);
}

function normExchange(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function symbolSuffix(symbol: string): string | null {
  const m = /\.([A-Za-z]+)$/.exec(symbol.trim());
  return m ? m[1].toUpperCase() : null;
}

/** Land der Notierung: Börsenkürzel, sonst bekanntes Suffix, sonst US bei Tickern ohne Suffix. */
function venueCountry(row: ListingCandidate): string | null {
  const short = normExchange(row.exchangeShortName);
  if (short && EXCHANGE_COUNTRY[short]) return EXCHANGE_COUNTRY[short];
  const full = normExchange(row.exchange);
  if (full && EXCHANGE_COUNTRY[full]) return EXCHANGE_COUNTRY[full];
  const blob = `${row.exchangeShortName ?? ""} ${row.exchange ?? ""}`;
  if (/\bNEO\b/i.test(blob) || /cboe canada/i.test(blob)) return "CA";
  const suffix = symbolSuffix(row.symbol);
  if (suffix && SUFFIX_COUNTRY[suffix]) return SUFFIX_COUNTRY[suffix];
  if (!suffix && row.symbol.trim()) return "US";
  return null;
}

function listingCurrency(row: ListingCandidate): string | null {
  if (typeof row.currency === "string" && row.currency.trim()) return row.currency.trim();
  return currencyFromTickerSuffix(row.symbol);
}

/** true, wenn die Notierung im Land des Sitzes liegt oder — ohne erkennbares Börsenland — in dessen Währung. */
function isSeatVenue(row: ListingCandidate, seat: string): boolean {
  const venue = venueCountry(row);
  if (venue) return venue === seat;
  return currenciesAlign(listingCurrency(row), SEAT_CURRENCY[seat] ?? null);
}

/**
 * Fremdlisting eines US-Emittenten mit bekanntem Börsen-Suffix (NEO `.NE`, Toronto `.TO`, …).
 * Der Stamm ohne Suffix ist dort das Primärlisting. Andere Sitze bekommen kein erfundenes Suffix.
 * null: die Zeile liegt schon an der passenden Börse, oder ein Stamm ist nicht ableitbar.
 */
function foreignStem(row: ListingCandidate, seat: string): string | null {
  if (isSeatVenue(row, seat)) return null;
  const m = /^([A-Za-z0-9][A-Za-z0-9-]*)\.([A-Za-z]+)$/.exec(row.symbol.trim());
  if (!m) return null;
  const venue = SUFFIX_COUNTRY[m[2].toUpperCase()];
  if (!venue || venue === seat) return null;
  if (seat !== "US") return null;
  return m[1].toUpperCase();
}

/**
 * Eine Zeile je Firma. Primärlisting (Land oder Währung des Sitzes) vor
 * CDR/NEO/Fremdlisting. Bei gleichem Cap entscheidet nicht die API-Reihenfolge.
 * Kein zusätzlicher FMP-Call.
 */
export function selectPrimaryListings(rows: readonly ListingCandidate[], seatIso2: string, limit = rows.length): ScreenerCompany[] {
  const seat = seatIso2.trim().toUpperCase();
  const ranked = rows.map((row, index) => {
    const stem = foreignStem(row, seat);
    const native = isSeatVenue(row, seat);
    const symbol = (stem ?? row.symbol).trim().toUpperCase();
    const tier: 0 | 1 = native || stem ? 0 : 1;
    return { row, index, symbol, tier, native };
  }).sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const cap = (b.row.marketCap || 0) - (a.row.marketCap || 0);
    if (cap !== 0) return cap;
    if (a.native !== b.native) return a.native ? -1 : 1;
    return a.index - b.index;
  });
  const seenName = new Set<string>();
  const seenSymbol = new Set<string>();
  const out: ScreenerCompany[] = [];
  for (const item of ranked) {
    const nameKey = item.row.name.toLowerCase();
    if (!item.symbol || seenName.has(nameKey) || seenSymbol.has(item.symbol)) continue;
    seenName.add(nameKey);
    seenSymbol.add(item.symbol);
    out.push({ symbol: item.symbol, name: item.row.name, sector: item.row.sector, marketCap: item.row.marketCap });
    if (out.length >= limit) break;
  }
  return out;
}

/** Cache-Treffer nur, wenn kein reparierbares Fremdlisting (z. B. *.NE bei Sitz US) gespeichert ist. Rein, kein FMP. */
export function capexPayloadPrimaryListings(payload: unknown): boolean {
  const countries = (payload as { countries?: unknown } | null)?.countries;
  if (!Array.isArray(countries)) return true;
  for (const country of countries) {
    if (!country || typeof country !== "object") continue;
    const iso2 = "iso2" in country && typeof country.iso2 === "string" ? country.iso2 : "";
    const companies = "companies" in country && Array.isArray(country.companies) ? country.companies : [];
    for (const company of companies) {
      if (!company || typeof company !== "object" || !("symbol" in company) || typeof company.symbol !== "string") continue;
      if (foreignStem({ symbol: company.symbol, name: "", sector: null, marketCap: 0 }, iso2.trim().toUpperCase())) return false;
    }
  }
  return true;
}

export interface CapexYears { latest: { capexUsd: number; fiscalYear: string | null; reportedCurrency: string | null } | null; prevCapexUsd: number | null }

export interface GeoSegmentInput { name: string; percentage: number | null; revenue: number | null }

export interface GeoMapDeps {
  screenCountry: (iso2: string, limit: number) => Promise<ScreenerCompany[]>;
  capexYears: (symbol: string) => Promise<CapexYears>;
  /** Fehlt die Funktion, bleibt das Feld „nicht abgefragt“. Leeres Array = FMP ohne Zeilen. */
  geoSegments?: (symbol: string) => Promise<GeoSegmentInput[]>;
  hasKey: () => boolean;
}

async function screenCountryFmp(iso2: string, limit: number): Promise<ScreenerCompany[]> {
  const key = process.env.FMP_API_KEY;
  if (!key) return [];
  const url = new URL("https://financialmodelingprep.com/stable/company-screener");
  url.searchParams.set("country", iso2);
  url.searchParams.set("marketCapMoreThan", String(MIN_MARKET_CAP));
  url.searchParams.set("isActivelyTrading", "true");
  url.searchParams.set("isEtf", "false");
  url.searchParams.set("isFund", "false");
  url.searchParams.set("limit", String(limit * 3));
  url.searchParams.set("apikey", key);
  trackFmpCall();
  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`FMP company-screener ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data)) return [];
  const rows: ListingCandidate[] = data
    .filter((r: { symbol?: unknown; country?: unknown }) => r?.symbol && (!r.country || r.country === iso2))
    .map((r: { symbol?: unknown; companyName?: unknown; sector?: unknown; marketCap?: unknown; currency?: unknown; exchange?: unknown; exchangeShortName?: unknown }) => ({
      symbol: String(r.symbol),
      name: String(r.companyName || r.symbol),
      sector: r.sector ? String(r.sector) : null,
      marketCap: Number(r.marketCap) || 0,
      currency: typeof r.currency === "string" ? r.currency : null,
      exchange: typeof r.exchange === "string" ? r.exchange : null,
      exchangeShortName: typeof r.exchangeShortName === "string" ? r.exchangeShortName : null,
    }));
  return selectPrimaryListings(rows, iso2, limit);
}

async function capexYearsFmp(symbol: string): Promise<CapexYears> {
  trackFmpCall();
  const rowsRaw = await fmpCashFlow(symbol, 2);
  const rows = await convertFmpRowsToUsd(Array.isArray(rowsRaw) ? rowsRaw : []);
  const val = (r: any): number | null => {
    const v = Number(r?.capitalExpenditure);
    return Number.isFinite(v) && v !== 0 ? Math.abs(v) : null;
  };
  const l = rows[0];
  const lv = val(l);
  return {
    latest: lv != null ? { capexUsd: lv, fiscalYear: l?.fiscalYear ? String(l.fiscalYear) : (l?.date ? String(l.date).slice(0, 4) : null), reportedCurrency: (l as any)?._fxConverted?.from ?? l?.reportedCurrency ?? null } : null,
    prevCapexUsd: val(rows[1]),
  };
}

async function geoSegmentsFmp(symbol: string): Promise<GeoSegmentInput[]> {
  const rows = await fmpGeoSegments(symbol);
  return rows.map(r => ({
    name: r.name,
    percentage: typeof r.percentage === "number" && Number.isFinite(r.percentage) ? r.percentage : null,
    revenue: typeof r.revenue === "number" && Number.isFinite(r.revenue) ? r.revenue : null,
  }));
}

export const defaultGeoMapDeps: GeoMapDeps = {
  screenCountry: screenCountryFmp,
  capexYears: capexYearsFmp,
  geoSegments: geoSegmentsFmp,
  hasKey: () => !!process.env.FMP_API_KEY,
};

async function buildCountry(def: GeoMapCountryDef, deps: GeoMapDeps) {
  let screened: ScreenerCompany[] = [];
  try { screened = await deps.screenCountry(def.iso2, GEO_MAP_TOP_N); } catch (e: any) {
    return { ...aggregateCountry(def, [], new Map()), note: `FMP-Screener nicht verfügbar (${e?.message || "Fehler"})` };
  }
  const prev = new Map<string, number>();
  const companies: GeoMapCompany[] = [];
  for (const s of screened) {
    let cy: CapexYears = { latest: null, prevCapexUsd: null };
    try { cy = await deps.capexYears(s.symbol); } catch { /* n/a */ }
    const yoy = cy.latest && cy.prevCapexUsd ? +(((cy.latest.capexUsd / cy.prevCapexUsd) - 1) * 100).toFixed(1) : null;
    if (cy.latest && cy.prevCapexUsd) prev.set(s.symbol, cy.prevCapexUsd);
    let geoSegments: GeoMapCompany["geoSegments"] = null;
    let geoSegmentsNote: string | null = "n/a — Geosegmente nicht abgefragt";
    if (deps.geoSegments) {
      try {
        const mapped = mapGeoSegmentRows(await deps.geoSegments(s.symbol));
        geoSegments = mapped.lines;
        geoSegmentsNote = mapped.note;
      } catch (e: any) {
        geoSegments = null;
        geoSegmentsNote = `n/a — Geosegmente nicht lesbar (${e?.message || "Fehler"})`;
      }
    }
    companies.push({
      symbol: s.symbol, name: s.name, sector: s.sector,
      capexUsd: cy.latest?.capexUsd ?? null, fiscalYear: cy.latest?.fiscalYear ?? null,
      yoyPct: yoy, reportedCurrency: cy.latest?.reportedCurrency ?? null,
      geoSegments, geoSegmentsNote,
    });
  }
  return aggregateCountry(def, companies, prev);
}

export async function buildGeoMapCapex(deps: GeoMapDeps = defaultGeoMapDeps, now = new Date()): Promise<GeoMapResponse> {
  const keyOk = deps.hasKey();
  const countries = [];
  for (const def of GEO_MAP_COUNTRIES) {
    if (!keyOk) { countries.push({ ...aggregateCountry(def, [], new Map()), note: "FMP nicht konfiguriert" }); continue; }
    countries.push(await buildCountry(def, deps));
  }
  return {
    layer: "capex",
    asOf: now.toISOString(),
    source: "FMP company-screener + cash-flow-statement (FY, capitalExpenditure), FX → USD",
    attribution: `Zuordnung nach Firmensitz: Summe der Top-${GEO_MAP_TOP_N} börsennotierten Firmen je Land (nach Market Cap, ≥ 2 Mrd USD). Kein volkswirtschaftlicher Gesamt-Capex. Umsatz-Geosegmente hängen an der Firma und verteilen den Capex nicht um.`,
    coverage: { withData: countries.filter(c => c.status === "ok").length, total: countries.length },
    countries,
  };
}
