/**
 * Offen_WORK_CAPEX_SECTOR_MAP.md — Slice 1 (Capex-Layer). Gemeinsame Typen + Länderliste für
 * GET /api/researcher/geo-map und GeoMapPanel. Nur Anzeige, kein Score.
 */
export type GeoMapLayer = "capex" | "sector";

/**
 * Frischefenster des Capex-Karten-Caches. Danach gilt die Antwort als veraltet
 * und wird weiter ausgeliefert, während im Hintergrund neu gebaut wird.
 */
export const GEO_MAP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Zusätzliche Zeit nach GEO_MAP_CACHE_TTL_MS, in der eine veraltete Antwort
 * noch gilt (Stale-While-Revalidate). Danach wird sie verworfen.
 */
export const GEO_MAP_STALE_WHILE_REVALIDATE_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Wie lange ein HTTP-Request auf den Kaltstart wartet. Der serielle FMP-Lauf
 * liegt darüber (Prod-Kaltstart 58 s). Länger warten liefert am Gateway HTML
 * statt JSON; das Budget bleibt darunter und antwortet mit n/a.
 */
export const GEO_MAP_RESPONSE_BUDGET_MS = 12_000;

/** Client bricht vorher ab und zeigt n/a, statt die Gateway-HTML-Seite zu parsen. */
export const GEO_MAP_CLIENT_TIMEOUT_MS = 20_000;

/** Abstand, in dem die Oberfläche eine pending-Antwort erneut abfragt. */
export const GEO_MAP_PENDING_RETRY_MS = 15_000;

export const GEO_MAP_PENDING_RETRY_LIMIT = 4;

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
  /** Sektor mit dem höchsten Capex-Anteil, „n/a“ zählt nicht. null = keins erfasst. */
  dominantSector: string | null;
  note?: string;
}

export interface GeoMapResponse {
  layer: GeoMapLayer;
  asOf: string;
  source: string;
  attribution: string;
  coverage: { withData: number; total: number };
  countries: GeoMapCountry[];
  /** true, solange der Kaltstart das Antwortbudget überschreitet. */
  pending?: boolean;
  _cached?: boolean;
  _cacheAge?: number;
  _stale?: boolean;
  _refreshThrottled?: boolean;
}

export interface GeoMapMinerNetwork {
  hashrateEH: number | null;
  hashpriceBtcPerThDay: number | null;
  breakevenUsd: number | null;
  source: string | null;
  note: string | null;
}

export interface GeoMapMinerRegion {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Anteil an der globalen Hashrate in %. null = n/a */
  hashrateSharePct: number | null;
  note?: string;
}

export interface GeoMapMinerResponse {
  layer: "miner";
  asOf: string;
  source: string;
  attribution: string;
  /** Leer, solange keine Standortquelle ohne Captcha/IR-Feed existiert. */
  regions: GeoMapMinerRegion[];
  locationNote: string;
  /** Namen aus der Spec. Keine gemessenen EH/s- oder MW-Werte. */
  namedOperators: { symbol: string; hashrateEH: null; powerMw: null }[];
  network: GeoMapMinerNetwork;
  pending?: boolean;
  _cached?: boolean;
  _stale?: boolean;
}

/**
 * Cambridge CBECI mining_map, geprüft 01.11.2026: api.cbeci.org löst nicht auf,
 * https://ccaf.io/cbeci/api/charts/mining_map_countries antwortet HTTP 400
 * „Invalid recaptcha response“. btc-miner.ts hat keine Farm-Koordinaten.
 */
export const MINER_LOCATION_NOTE =
  "n/a — keine Farm-Standorte. Cambridge CBECI (mining_map) liefert ohne Captcha HTTP 400 „Invalid recaptcha response“. Die Miner-Pipeline hat Hashrate, Hashprice und Breakeven nur für das Gesamtnetz, ohne Land, Farm oder MW je Betreiber.";

/** Beispielnamen aus Offen_WORK_BITCOIN_MINER_MAP.md. Keine IR-Zahlen dahinter. */
export const MINER_NAMES_UNSOURCED = ["MARA", "RIOT", "CLSK", "BITF", "IREN", "HUT", "CIFR"] as const;

/** Summe/YoY/Sektor-Anteile aus Firmenwerten. Rein, ohne Netz. */
export function aggregateCountry(def: GeoMapCountryDef, companies: GeoMapCompany[], prevByCompany: Map<string, number>): GeoMapCountry {
  const withCapex = companies.filter(c => c.capexUsd != null && c.capexUsd > 0);
  if (withCapex.length === 0) {
    return { ...def, status: "n/a", capexUsd: null, yoyPct: null, companies, sectorShares: [], dominantSector: null, note: "Keine Capex-Daten verfügbar" };
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
  return { ...def, status: "ok", capexUsd: total, yoyPct, companies: sorted, sectorShares, dominantSector: dominantSectorOf(sectorShares) };
}

export function dominantSectorOf(sectorShares: { sector: string; pct: number }[]): string | null {
  const top = sectorShares.find(s => s.sector && s.sector !== "n/a");
  return top?.sector ?? null;
}

/** Mid-Rank (#{v < x} + 0.5 · #{v = x}) / n. Gleiche Konvention wie die Sektor-Ampel. */
const MIDRANK_TIE_WEIGHT = 0.5;

export function midrankPercentile(value: number, population: readonly number[]): number | null {
  if (!Number.isFinite(value)) return null;
  const finite = population.filter(v => Number.isFinite(v));
  if (finite.length === 0) return null;
  let less = 0;
  let equal = 0;
  for (const v of finite) {
    if (v < value) less += 1;
    else if (v === value) equal += 1;
  }
  return (less + MIDRANK_TIE_WEIGHT * equal) / finite.length;
}

export function metricPercentiles(values: ReadonlyArray<number | null | undefined>): Array<number | null> {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return values.map(v => (typeof v === "number" && Number.isFinite(v) ? midrankPercentile(v, finite) : null));
}

/**
 * Marker-Geometrie der 800×400-Karte. Die Spanne ist die Zeichenfläche,
 * die Lage darin ist allein das Perzentil der Verteilung.
 */
export const GEO_BUBBLE_GEOMETRY = {
  minPx: 4,
  maxPx: 26,
} as const;

export function radiusForPercentile(percentile: number | null): number {
  if (percentile == null || !Number.isFinite(percentile)) return GEO_BUBBLE_GEOMETRY.minPx;
  const t = Math.min(1, Math.max(0, percentile));
  return GEO_BUBBLE_GEOMETRY.minPx + (GEO_BUBBLE_GEOMETRY.maxPx - GEO_BUBBLE_GEOMETRY.minPx) * t;
}

/** Endpunkte der Farbskala. Die Mischung folgt dem Perzentil, nicht einer festen YoY-Schwelle. */
export const GEO_SCALE_COLORS = {
  na: "#64748b",
  low: "#e11d48",
  mid: "#94a3b8",
  high: "#059669",
  capexLow: "#4c1d95",
  capexHigh: "#c4b5fd",
} as const;

const PERCENTILE_MID = 0.5;

export function mixHex(a: string, b: string, t: number): string {
  const u = Math.min(1, Math.max(0, t));
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const c = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${c(ar + (br - ar) * u)}${c(ag + (bg - ag) * u)}${c(ab + (bb - ab) * u)}`;
}

export function colorForPercentile(percentile: number | null, mode: "capex" | "yoy"): string {
  if (percentile == null || !Number.isFinite(percentile)) return GEO_SCALE_COLORS.na;
  const t = Math.min(1, Math.max(0, percentile));
  if (mode === "capex") return mixHex(GEO_SCALE_COLORS.capexLow, GEO_SCALE_COLORS.capexHigh, t);
  if (t <= PERCENTILE_MID) return mixHex(GEO_SCALE_COLORS.low, GEO_SCALE_COLORS.mid, t / PERCENTILE_MID);
  return mixHex(GEO_SCALE_COLORS.mid, GEO_SCALE_COLORS.high, (t - PERCENTILE_MID) / PERCENTILE_MID);
}

/** FMP-Sektoren, je eine Farbe. Unbekannt bleibt n/a-grau — keine Schwelle, eine Legende. */
export const SECTOR_COLORS: Record<string, string> = {
  Technology: "#38bdf8",
  Healthcare: "#34d399",
  "Financial Services": "#fbbf24",
  "Consumer Cyclical": "#fb7185",
  "Consumer Defensive": "#a3e635",
  Industrials: "#94a3b8",
  Energy: "#f97316",
  "Basic Materials": "#c084fc",
  Utilities: "#22d3ee",
  "Real Estate": "#e879f9",
  "Communication Services": "#818cf8",
};

export function sectorColor(sector: string | null | undefined): string {
  if (!sector || sector === "n/a") return GEO_SCALE_COLORS.na;
  return SECTOR_COLORS[sector] ?? GEO_SCALE_COLORS.na;
}
