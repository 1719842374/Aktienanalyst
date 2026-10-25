/**
 * Offen_WORK_CAPEX_SECTOR_MAP.md — Slice 1 (Capex-Layer). Gemeinsame Typen + Länderliste für
 * GET /api/researcher/geo-map und GeoMapPanel. Nur Anzeige, kein Score.
 */
export type GeoMapLayer = "capex";

export interface GeoMapCountryDef {
  iso2: string;
  /** ISO-3166 numerisch (world-atlas countries-110m geometry id) */
  isoNum: string;
  name: string;
  lat: number;
  lon: number;
}

/** 25 Länder (Spec: ≥ 20 Länder/Regionen). Koordinaten = grobe Landesmitte für die Bubble. */
export const GEO_MAP_COUNTRIES: GeoMapCountryDef[] = [
  { iso2: "US", isoNum: "840", name: "USA", lat: 39, lon: -98 },
  { iso2: "CA", isoNum: "124", name: "Kanada", lat: 56, lon: -106 },
  { iso2: "MX", isoNum: "484", name: "Mexiko", lat: 23, lon: -102 },
  { iso2: "BR", isoNum: "076", name: "Brasilien", lat: -10, lon: -52 },
  { iso2: "CL", isoNum: "152", name: "Chile", lat: -33, lon: -71 },
  { iso2: "GB", isoNum: "826", name: "Vereinigtes Königreich", lat: 54, lon: -2 },
  { iso2: "DE", isoNum: "276", name: "Deutschland", lat: 51, lon: 10 },
  { iso2: "FR", isoNum: "250", name: "Frankreich", lat: 46, lon: 2 },
  { iso2: "NL", isoNum: "528", name: "Niederlande", lat: 52, lon: 5 },
  { iso2: "CH", isoNum: "756", name: "Schweiz", lat: 47, lon: 8 },
  { iso2: "IT", isoNum: "380", name: "Italien", lat: 42, lon: 12 },
  { iso2: "ES", isoNum: "724", name: "Spanien", lat: 40, lon: -4 },
  { iso2: "SE", isoNum: "752", name: "Schweden", lat: 62, lon: 15 },
  { iso2: "DK", isoNum: "208", name: "Dänemark", lat: 56, lon: 9 },
  { iso2: "NO", isoNum: "578", name: "Norwegen", lat: 61, lon: 9 },
  { iso2: "SA", isoNum: "682", name: "Saudi-Arabien", lat: 24, lon: 45 },
  { iso2: "ZA", isoNum: "710", name: "Südafrika", lat: -29, lon: 24 },
  { iso2: "IN", isoNum: "356", name: "Indien", lat: 22, lon: 79 },
  { iso2: "CN", isoNum: "156", name: "China", lat: 35, lon: 104 },
  { iso2: "HK", isoNum: "344", name: "Hongkong", lat: 22.3, lon: 114.2 },
  { iso2: "TW", isoNum: "158", name: "Taiwan", lat: 23.7, lon: 121 },
  { iso2: "KR", isoNum: "410", name: "Südkorea", lat: 36, lon: 128 },
  { iso2: "JP", isoNum: "392", name: "Japan", lat: 36, lon: 138 },
  { iso2: "SG", isoNum: "702", name: "Singapur", lat: 1.35, lon: 103.8 },
  { iso2: "AU", isoNum: "036", name: "Australien", lat: -25, lon: 134 },
];

export interface GeoMapCompany {
  symbol: string;
  name: string;
  sector: string | null;
  /** Capex letztes Geschäftsjahr in USD (positiv). null = n/a */
  capexUsd: number | null;
  fiscalYear: string | null;
  /** YoY ggü. Vorjahr in %, null = n/a */
  yoyPct: number | null;
  /** Originalwährung des Abschlusses (vor FX) */
  reportedCurrency: string | null;
}

export interface GeoMapCountry extends GeoMapCountryDef {
  status: "ok" | "n/a";
  /** Summe Capex der erfassten Firmen (USD); null bei n/a */
  capexUsd: number | null;
  /** YoY der Summe, nur über Firmen mit beiden Jahren; null = n/a */
  yoyPct: number | null;
  companies: GeoMapCompany[];
  /** Sektor-Anteil am erfassten Capex in % (Summe = 100) */
  sectorShares: { sector: string; pct: number }[];
  note?: string;
}

export interface GeoMapResponse {
  layer: GeoMapLayer;
  asOf: string;
  source: string;
  attribution: string;
  coverage: { withData: number; total: number };
  countries: GeoMapCountry[];
  _cached?: boolean;
  _cacheAge?: number;
}

/** Summe/YoY/Sektor-Anteile aus Firmenwerten. Rein, ohne Netz. */
export function aggregateCountry(def: GeoMapCountryDef, companies: GeoMapCompany[], prevByCompany: Map<string, number>): GeoMapCountry {
  const withCapex = companies.filter(c => c.capexUsd != null && c.capexUsd > 0);
  if (withCapex.length === 0) {
    return { ...def, status: "n/a", capexUsd: null, yoyPct: null, companies, sectorShares: [], note: "Keine Capex-Daten verfügbar" };
  }
  const total = withCapex.reduce((s, c) => s + (c.capexUsd as number), 0);
  let cur = 0, prev = 0;
  for (const c of withCapex) {
    const p = prevByCompany.get(c.symbol);
    if (p != null && p > 0) { cur += c.capexUsd as number; prev += p; }
  }
  const yoyPct = prev > 0 ? +(((cur / prev) - 1) * 100).toFixed(1) : null;
  const bySector = new Map<string, number>();
  for (const c of withCapex) bySector.set(c.sector || "n/a", (bySector.get(c.sector || "n/a") ?? 0) + (c.capexUsd as number));
  const sectorShares = Array.from(bySector.entries())
    .map(([sector, v]) => ({ sector, pct: +((v / total) * 100).toFixed(1) }))
    .sort((a, b) => b.pct - a.pct);
  const sorted = [...companies].sort((a, b) => (b.capexUsd ?? -1) - (a.capexUsd ?? -1));
  return { ...def, status: "ok", capexUsd: total, yoyPct, companies: sorted, sectorShares };
}
