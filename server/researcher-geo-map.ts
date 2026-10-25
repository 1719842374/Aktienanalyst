/**
 * Offen_WORK_CAPEX_SECTOR_MAP.md — Slice 1 (Capex-Layer). Baut die Länderdaten für
 * GET /api/researcher/geo-map?layer=capex. Nur Anzeige im Researcher, KEIN Score.
 *
 * Quelle: FMP company-screener (country=ISO2, nach Market Cap) → Top-N Firmen je Land,
 * dann FMP cash-flow-statement (FY) → capitalExpenditure, FX → USD (convertFmpRowsToUsd).
 * Zuordnung nach Firmensitz (FMP liefert geografische Segmente nur für Umsatz, nicht Capex).
 * Fehlende Daten → status "n/a", nie geschätzt.
 */
import { fmpCashFlow, convertFmpRowsToUsd } from "./fmp";
import { trackFmpCall } from "./analyze-helpers";
import {
  GEO_MAP_COUNTRIES, aggregateCountry,
  type GeoMapCompany, type GeoMapCountryDef, type GeoMapResponse,
} from "@shared/geo-map";

export const GEO_MAP_CACHE_TAB = "geo-map-capex";
export const GEO_MAP_TOP_N = 6;
const MIN_MARKET_CAP = 2_000_000_000;

export interface ScreenerCompany { symbol: string; name: string; sector: string | null; marketCap: number }
export interface CapexYears { latest: { capexUsd: number; fiscalYear: string | null; reportedCurrency: string | null } | null; prevCapexUsd: number | null }

export interface GeoMapDeps {
  screenCountry: (iso2: string, limit: number) => Promise<ScreenerCompany[]>;
  capexYears: (symbol: string) => Promise<CapexYears>;
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
  const seen = new Set<string>();
  return data
    .filter((r: any) => r?.symbol && (!r.country || r.country === iso2))
    .map((r: any) => ({ symbol: String(r.symbol), name: String(r.companyName || r.symbol), sector: r.sector ? String(r.sector) : null, marketCap: Number(r.marketCap) || 0 }))
    .sort((a, b) => b.marketCap - a.marketCap)
    // gleiche Firma mehrfach gelistet (Dual-Listing) → nur einmal
    .filter((r) => { const k = r.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit);
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

export const defaultGeoMapDeps: GeoMapDeps = {
  screenCountry: screenCountryFmp,
  capexYears: capexYearsFmp,
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
    companies.push({
      symbol: s.symbol, name: s.name, sector: s.sector,
      capexUsd: cy.latest?.capexUsd ?? null, fiscalYear: cy.latest?.fiscalYear ?? null,
      yoyPct: yoy, reportedCurrency: cy.latest?.reportedCurrency ?? null,
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
    attribution: `Zuordnung nach Firmensitz: Summe der Top-${GEO_MAP_TOP_N} börsennotierten Firmen je Land (nach Market Cap, ≥ 2 Mrd USD). Kein volkswirtschaftlicher Gesamt-Capex.`,
    coverage: { withData: countries.filter(c => c.status === "ok").length, total: countries.length },
    countries,
  };
}
