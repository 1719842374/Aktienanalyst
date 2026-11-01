/**
 * Gold- und Wertschöpfungs-Layer.
 * Der Miner-Layer bleibt in researcher-geo-map-route.ts (Netz aus btc-miner.ts).
 * Kein Score, keine geschätzten Unzen.
 */
import type { GeoMapCountry } from "./geo-map";

export const GOLD_LAYER_SYMBOLS = ["NEM", "GOLD", "AEM", "KGC", "WPM", "FNV"] as const;

/** AISC-Datei führt diese Kürzel. GOLD ist nicht dabei (Barrick steht dort als B). */
export const GOLD_AISC_CODES = ["NEM", "AEM"] as const;

export const GOLD_LAYER_REGIONS: readonly { iso2: string; isoNum: string; name: string; lat: number; lon: number }[] = [
  { iso2: "AU", isoNum: "036", name: "Australien", lat: -25, lon: 134 },
  { iso2: "ZA", isoNum: "710", name: "Südafrika", lat: -29, lon: 24 },
  { iso2: "CN", isoNum: "156", name: "China", lat: 35, lon: 104 },
  { iso2: "RU", isoNum: "643", name: "Russland", lat: 61, lon: 105 },
  { iso2: "CA", isoNum: "124", name: "Kanada", lat: 56, lon: -106 },
  { iso2: "US", isoNum: "840", name: "USA", lat: 39, lon: -98 },
  { iso2: "GH", isoNum: "288", name: "Ghana", lat: 8, lon: -1 },
  { iso2: "PE", isoNum: "604", name: "Peru", lat: -9, lon: -75 },
  { iso2: "MX", isoNum: "484", name: "Mexiko", lat: 23, lon: -102 },
];

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
  countries: GeoMapCountry[];
  goldCompanies: GoldMapCompanyRow[];
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
const NO_COUNTRY_OZ = "n/a — keine Produktions-Unzen je Land, Bubble nicht nach Anteil skaliert";

function latestAisc(points: readonly AiscPoint[], code: string): { quarter: string; aisc: number } | null {
  const rows = points.filter(p => p.code === code && Number.isFinite(p.aisc) && p.aisc > 0 && p.quarter);
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.quarter.localeCompare(b.quarter));
  return rows[rows.length - 1];
}

/** Gold-Layer aus bereits gelesenen AISC-Punkten. points === null → Datei nicht lesbar. */
export function buildGoldMapLayer(asOf: string, points: readonly AiscPoint[] | null): GoldMapResponse {
  const fileMissing = points == null;
  const goldCompanies: GoldMapCompanyRow[] = GOLD_LAYER_SYMBOLS.map(symbol => {
    const known = (GOLD_AISC_CODES as readonly string[]).includes(symbol);
    const hit = !fileMissing && known ? latestAisc(points, symbol) : null;
    let note: string | null = null;
    if (fileMissing) note = "n/a — gold-aisc.json nicht lesbar";
    else if (symbol === "GOLD") note = "n/a — AISC-Datei führt Barrick als B, nicht als GOLD. " + NO_OZ;
    else if (!known) note = "n/a — kein AISC-Eintrag in gold-aisc.json. " + NO_OZ;
    else if (!hit) note = "n/a — kein AISC-Quartal für " + symbol + ". " + NO_OZ;
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
  const countries: GeoMapCountry[] = GOLD_LAYER_REGIONS.map(def => ({
    ...def,
    status: "n/a",
    capexUsd: null,
    yoyPct: null,
    companies: [],
    sectorShares: [],
    dominantSector: null,
    note: NO_COUNTRY_OZ,
  }));
  return {
    layer: "gold",
    asOf,
    source: "server/data/gold-aisc.json über loadGoldAiscSeries (NEM, AEM). Kein FMP-Produktionsfeld.",
    attribution: "AISC ist Firmenwert, nicht einem Land zugeordnet. Produktions-Unzen fehlen in den Gold-Quellen.",
    coverage: { withData: 0, total: countries.length },
    countries,
    goldCompanies,
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
