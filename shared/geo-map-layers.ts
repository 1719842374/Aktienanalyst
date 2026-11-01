/**
 * Gold- und Wertschöpfungs-Layer.
 * Der Miner-Layer bleibt in researcher-geo-map-route.ts (Netz aus btc-miner.ts).
 * Kein Score. Firmen-Unzen werden nicht geschätzt. Länder-Unzen sind die Umrechnung der veröffentlichten Tonnen.
 */
import type { GeoMapCountry } from "./geo-map";
import { lookupAliasCodes, type TickerAliasGroup } from "./gold-aisc";
import { GOLD_PRODUCTION_SOURCE_MISSING, resolveGoldProduction, type GoldMapProductionInput } from "./gold-mine-production";

export const GOLD_LAYER_SYMBOLS = ["NEM", "GOLD", "AEM", "KGC", "WPM", "FNV"] as const;

export interface GoldCountryFact {
  iso2: string;
  isoNum: string;
  name: string;
  lat: number;
  lon: number;
  productionOz: number | null;
  countrySharePct: number | null;
}

export interface GoldMapCountry extends GeoMapCountry {
  productionOz: number | null;
  countrySharePct: number | null;
}

/** Bubble nur bei belegter Produktion oder belegtem Länderanteil. Null und 0 zählen nicht. */
export function goldCountryHasProduction(fact: { productionOz?: number | null; countrySharePct?: number | null }): boolean {
  const oz = fact.productionOz;
  const share = fact.countrySharePct;
  return (typeof oz === "number" && Number.isFinite(oz) && oz > 0)
    || (typeof share === "number" && Number.isFinite(share) && share > 0);
}

export function goldCountriesFromFacts(facts: readonly GoldCountryFact[]): GoldMapCountry[] {
  const out: GoldMapCountry[] = [];
  for (const fact of facts) {
    if (!goldCountryHasProduction(fact)) continue;
    const productionOz = typeof fact.productionOz === "number" && Number.isFinite(fact.productionOz) && fact.productionOz > 0 ? fact.productionOz : null;
    const countrySharePct = typeof fact.countrySharePct === "number" && Number.isFinite(fact.countrySharePct) && fact.countrySharePct > 0 ? fact.countrySharePct : null;
    out.push({
      iso2: fact.iso2,
      isoNum: fact.isoNum,
      name: fact.name,
      lat: fact.lat,
      lon: fact.lon,
      status: "ok",
      capexUsd: null,
      yoyPct: null,
      companies: [],
      sectorShares: [],
      dominantSector: null,
      productionOz,
      countrySharePct,
    });
  }
  return out;
}

const GOLD_NAMES: Record<(typeof GOLD_LAYER_SYMBOLS)[number], string> = {
  NEM: "Newmont",
  GOLD: "Barrick",
  AEM: "Agnico Eagle",
  KGC: "Kinross",
  WPM: "Wheaton Precious Metals",
  FNV: "Franco-Nevada",
};

export interface GoldMapCompanyRow {
  symbol: string;
  name: string;
  aiscUsdPerOz: number | null;
  aiscQuarter: string | null;
  /** Immer null: gold-aisc.json und gold-routes haben keine Unzen. */
  productionOz: null;
  note: string | null;
}

export interface GoldMapResponse {
  layer: "gold";
  asOf: string;
  source: string;
  attribution: string;
  coverage: { withData: number; total: number };
  countries: GoldMapCountry[];
  goldCompanies: GoldMapCompanyRow[];
  /** Fehlende Quelle, oder der nicht als Bubble gezeichnete Rest des Weltvolumens. */
  note: string | null;
  pending?: boolean;
  _cached?: boolean;
  _cacheAge?: number;
}

export interface AiscPoint {
  code: string;
  quarter: string;
  aisc: number;
}

const NO_OZ = "n/a — gold-aisc.json und gold-routes enthalten keine Produktions-Unzen";

function latestAisc(points: readonly AiscPoint[], codes: readonly string[]): { quarter: string; aisc: number } | null {
  const want = new Set(codes.map(code => code.toUpperCase()));
  const rows = points.filter(p => want.has(p.code.toUpperCase()) && Number.isFinite(p.aisc) && p.aisc > 0 && p.quarter);
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.quarter.localeCompare(b.quarter));
  return rows[rows.length - 1];
}

function estimatePhrase(estimated: boolean | null): string {
  if (estimated === true) return "in der Quelle als Schätzung gekennzeichnet";
  if (estimated === false) return "in der Quelle nicht als Schätzung gekennzeichnet";
  return "Schätzkennzeichen in der Quelle nicht gesetzt";
}

/**
 * Gold-Layer aus AISC-Punkten und einer Produktionstabelle.
 * points === null → AISC-Datei nicht lesbar. production === null → keine Weltproduktion.
 * Länderanteil = Fördermenge / Weltzeile. Firmen-Unzen bleiben null.
 */
export function buildGoldMapLayer(
  asOf: string,
  points: readonly AiscPoint[] | null,
  aliasGroups: readonly TickerAliasGroup[] = [],
  production: GoldMapProductionInput | null = null,
): GoldMapResponse {
  const fileMissing = points == null;
  const goldCompanies: GoldMapCompanyRow[] = GOLD_LAYER_SYMBOLS.map(symbol => {
    const resolved = lookupAliasCodes(symbol, aliasGroups);
    const hit = !fileMissing && !resolved.ambiguous ? latestAisc(points, resolved.codes) : null;
    let note: string;
    if (fileMissing) note = "n/a — gold-aisc.json nicht lesbar";
    else if (resolved.ambiguous) note = "n/a — Ticker-Alias mehrdeutig. " + NO_OZ;
    else if (!hit) note = `n/a — kein AISC-Eintrag für ${symbol}. ` + NO_OZ;
    else note = NO_OZ;
    return {
      symbol,
      name: GOLD_NAMES[symbol],
      aiscUsdPerOz: hit?.aisc ?? null,
      aiscQuarter: hit?.quarter ?? null,
      productionOz: null,
      note,
    };
  });
  const resolved = production == null ? null : resolveGoldProduction(production.table, production.placements);
  const countries = goldCountriesFromFacts(resolved && !resolved.unavailable ? resolved.facts : []);
  const withData = countries.filter(c => c.status === "ok").length;
  const sourceMissing = production == null || resolved == null || resolved.unavailable;
  const note = sourceMissing
    ? (resolved?.note ?? GOLD_PRODUCTION_SOURCE_MISSING)
    : resolved.note;
  const source = production == null
    ? "server/data/gold-aisc.json über loadGoldAiscSeries. USGS-Weltproduktion nicht geladen."
    : `${production.table.source} (${production.table.sourceUrl}). AISC: server/data/gold-aisc.json über loadGoldAiscSeries.`;
  const attribution = sourceMissing || resolved == null || resolved.year == null || resolved.worldVolume == null
    ? "AISC ist ein Firmenwert. Die USGS-Weltproduktion fehlt oder hat kein Weltvolumen, deshalb keine Länder-Bubbles und keine interpolierten Anteile."
    : `Länderanteil = Fördermenge / Weltvolumen (${resolved.worldVolume} ${resolved.unit}, Jahr ${resolved.year}, ${estimatePhrase(resolved.estimated)}). ${resolved.facts.some(fact => fact.productionOz != null) ? "Unzen = metrische Tonnen × 1.000.000 / 31,1034768." : "Unzen nicht umgerechnet."} AISC bleibt ein Firmenwert ohne Produktions-Unzen.`;
  return {
    layer: "gold",
    asOf,
    source,
    attribution,
    coverage: { withData, total: sourceMissing ? countries.length : withData + resolved.unplacedCount },
    countries,
    goldCompanies,
    note,
  };
}

export interface ValueChainMapLink {
  key: string;
  label: string;
  href: string;
  placementNote: string;
}

export interface ValueChainMapResponse {
  layer: "valuechain";
  asOf: string;
  source: string;
  attribution: string;
  coverage: { withData: number; total: number };
  countries: GeoMapCountry[];
  chains: ValueChainMapLink[];
  note: string;
  pending?: boolean;
  _cached?: boolean;
  _cacheAge?: number;
}

const VALUECHAIN_KEYS = ["semiconductors", "auto-manufacturers"] as const;
const PLACEMENT = "n/a — /api/valuechain hat Stufen (upstream/midstream/downstream), keine Länderkette";

/** Nur Katalog-Schlüssel, die es wirklich gibt. Keine erfundene US→TW-Kette. */
export function buildValueChainMapLayer(asOf: string, catalog: readonly { key: string; label: string }[]): ValueChainMapResponse {
  const chains: ValueChainMapLink[] = VALUECHAIN_KEYS.map(key => {
    const hit = catalog.find(c => c.key === key);
    if (!hit) {
      return { key, label: key, href: "#/valuechain", placementNote: "n/a — Kette fehlt im Katalog" };
    }
    return { key: hit.key, label: hit.label, href: `#/valuechain?industry=${encodeURIComponent(hit.key)}`, placementNote: PLACEMENT };
  });
  return {
    layer: "valuechain",
    asOf,
    source: "server/valuechain-catalog.ts (dieselbe Quelle wie GET /api/valuechain)",
    attribution: "Beispiele Semis US→NL/JP→TW→MY/CN und E-Autos CL/AU→CN/KR→DE/US/JP stehen nicht als Länder in der Kette.",
    coverage: { withData: 0, total: 0 },
    countries: [],
    chains,
    note: PLACEMENT,
  };
}
