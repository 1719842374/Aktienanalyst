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
  /** Umsatz-Geosegmente von FMP. null = keine Zeilen. Capex bleibt beim Firmensitz. */
  geoSegments?: GeoSegmentLine[] | null;
  geoSegmentsNote?: string | null;
}

export interface GeoSegmentLine {
  name: string;
  /** Anteil am berichteten Segmentumsatz in %. null = nicht belegt. */
  pct: number | null;
  revenueUsd: number | null;
  /** Karten-Land, nur bei eindeutigem Namen. null = nicht zuordenbar. */
  iso2: string | null;
  note: string | null;
}

export interface GeoMapCountry extends GeoMapCountryDef {
  status: "ok" | "n/a";
  /** Summe Capex der erfassten Firmen (USD); null bei n/a */
  capexUsd: number | null;
  /** YoY der Summe, nur über Firmen mit beiden Jahren; null = n/a */
  yoyPct: number | null;
  /** Mid-Rank des Capex unter Ländern mit Capex. null = Stichprobe zu klein oder kein Wert. */
  capexPercentile?: number | null;
  /** Mid-Rank des YoY unter Ländern mit YoY. */
  yoyPercentile?: number | null;
  companies: GeoMapCompany[];
  /** Sektor-Anteil am erfassten Capex in % (Summe = 100) */
  sectorShares: { sector: string; pct: number }[];
  /** Sektor mit dem höchsten Capex-Anteil, „n/a“ zählt nicht. null = keins erfasst. */
  dominantSector: string | null;
  /**
   * Nur die Sektor-Antwort setzt das (projectSectorLayer). Die Capex-Antwort lässt es weg.
   * dominantSector bleibt daneben der Rohname, auch bei Gleichstand.
   */
  sectorAmpel?: SectorAmpel;
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

/**
 * Nachkommastellen der Karten-Legende. Ein positiver Rest, der dabei auf 0 fällt,
 * wird nicht gezeigt. 0 ist diese Anzeige, keine zusätzliche Schwelle.
 */
export const SECTOR_LEGEND_FRACTION_DIGITS = 1;

/**
 * Legende: Anteil je Sektor am erfassten Capex. Dieselben sectorShares, aus denen
 * die Länderfarbe (dominanter Sektor) kommt. Länder ohne Capex zählen nicht.
 */
export function sectorLegendShares(
  countries: readonly { status: string; capexUsd: number | null; sectorShares: readonly { sector: string; pct: number }[] }[],
): { sector: string; pct: number }[] {
  let total = 0;
  const by = new Map<string, number>();
  for (const country of countries) {
    if (country.status !== "ok" || country.capexUsd == null || !(country.capexUsd > 0)) continue;
    for (const share of country.sectorShares) {
      if (!share.sector || share.sector === "n/a" || !(typeof share.pct === "number" && Number.isFinite(share.pct) && share.pct > 0)) continue;
      const part = country.capexUsd * (share.pct / 100);
      if (!(part > 0)) continue;
      by.set(share.sector, (by.get(share.sector) ?? 0) + part);
      total += part;
    }
  }
  if (!(total > 0)) return [];
  return Array.from(by.entries())
    .map(([sector, value]) => ({ sector, pct: +((value / total) * 100).toFixed(SECTOR_LEGEND_FRACTION_DIGITS) }))
    .filter(row => row.pct > 0)
    .sort((a, b) => b.pct - a.pct || a.sector.localeCompare(b.sector, "de"));
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

/**
 * Sektor-Ampel (Offen_WORK_CAPEX_SECTOR_MAP §2, Offen_WORK_RESEARCHER_CAPEX_MAP §2).
 * Dominanz = capexShareWeight × Capex-Anteil der Firmen mit Firmensitz im Land.
 * Ampel = Perzentil dieser Dominanz unter den Ländern mit eindeutigem Sektor
 * (oberes/unteres Terzil), nicht eine feste Prozent-Schwelle. Kein Score.
 * Umsatz-Geosegmente fließen nicht ein. Die Kartenfarbe bleibt sectorColor, die Legende sectorLegendShares.
 */
export const SECTOR_LAYER_PARAMS = {
  /** Gewicht des Capex-Anteils (Prozentpunkte) an der Dominanz. Einzige belegte Quelle. */
  capexShareWeight: 1,
  /** Grün ab dem oberen Terzil der Peer-Perzentile. */
  greenPct: 2 / 3,
  /** Rot bis einschließlich des unteren Terzils. */
  redPct: 1 / 3,
  /**
   * Unter dieser Stichprobe ist ein Terzil nicht belastbar → Ampel neutral.
   * 3 ist das kleinste n, bei dem drei Bänder unterscheidbar sind.
   */
  minCountries: 3,
  /** Tie-Gewicht im Mid-Rank der Ampel. Dieselbe Zahl wie MIDRANK_TIE_WEIGHT, eigener Parameter. */
  midRankTieWeight: 0.5,
} as const;

export type SectorBand = "green" | "yellow" | "red" | "neutral";

/** Palette der Ampel, mindestens 8 FMP-Sektoren. Nicht die Kartenfüllung (die bleibt SECTOR_COLORS). */
export const SECTOR_CANON: readonly { id: string; label: string; color: string }[] = [
  { id: "technology", label: "Technology", color: "#8b5cf6" },
  { id: "communication", label: "Communication Services", color: "#f43f5e" },
  { id: "consumer-cyclical", label: "Consumer Cyclical", color: "#f97316" },
  { id: "consumer-defensive", label: "Consumer Defensive", color: "#eab308" },
  { id: "industrials", label: "Industrials", color: "#3b82f6" },
  { id: "financials", label: "Financial Services", color: "#14b8a6" },
  { id: "healthcare", label: "Healthcare", color: "#22c55e" },
  { id: "energy", label: "Energy", color: "#84cc16" },
  { id: "materials", label: "Basic Materials", color: "#d946ef" },
  { id: "utilities", label: "Utilities", color: "#06b6d4" },
  { id: "real-estate", label: "Real Estate", color: "#fb7185" },
];

const SECTOR_OTHER_COLOR = "#94a3b8";

const SECTOR_MATCHERS: readonly { id: string; test: (name: string) => boolean }[] = [
  { id: "consumer-cyclical", test: s => /consumer cyclical|consumer discretionary|\bautos?\b/i.test(s) },
  { id: "consumer-defensive", test: s => /consumer defensive|consumer staples/i.test(s) },
  { id: "communication", test: s => /communication/i.test(s) },
  { id: "technology", test: s => /technolog|semiconductor|software/i.test(s) },
  { id: "financials", test: s => /financial/i.test(s) },
  { id: "healthcare", test: s => /health care|healthcare|biotech|pharma/i.test(s) },
  { id: "industrials", test: s => /industrial/i.test(s) },
  { id: "energy", test: s => /^energy$/i.test(s) || /energy/i.test(s) },
  { id: "materials", test: s => /basic materials|materials|mining/i.test(s) },
  { id: "utilities", test: s => /utilit/i.test(s) },
  { id: "real-estate", test: s => /real estate/i.test(s) },
];

export interface SectorAmpel {
  dominantSectorId: string | null;
  dominantSector: string | null;
  dominantColor: string | null;
  /** Capex-Anteil des dominanten Sektors in %. null = keine eindeutige Dominanz. */
  dominantSharePct: number | null;
  /** Mid-Rank-Perzentil der Dominanz unter den Ländern mit eindeutigem Sektor. */
  sharePercentile: number | null;
  /** Sample-z (n−1) der Dominanz. null = Stichprobe < 2 oder keine Streuung. */
  shareZ: number | null;
  shareBand: SectorBand;
  /** Gesetzt, wenn Dominanz oder Ampel nicht belegbar ist. Beginnt mit „n/a —“. */
  sectorNote: string | null;
}

export interface SectorLayerInfo {
  params: typeof SECTOR_LAYER_PARAMS;
  /** Länder mit eindeutigem dominantem Sektor. */
  peerN: number;
  peerMedianSharePct: number | null;
  legend: { id: string; label: string; color: string; countries: number }[];
}

export interface GeoMapSectorCountry extends GeoMapCountry {
  sectorAmpel: SectorAmpel;
}

export interface GeoMapSectorResponse extends GeoMapResponse {
  layer: "sector";
  sectorLayer: SectorLayerInfo;
  countries: GeoMapSectorCountry[];
}

function canonById(id: string): { id: string; label: string; color: string } | undefined {
  return SECTOR_CANON.find(s => s.id === id);
}

/** Roh-Sektorname → Ampel-Palette. Unbekannt bleibt beim Roh-Namen. sectorColor bleibt davon getrennt. */
export function matchSector(raw: string | null | undefined): { id: string; label: string; color: string } | null {
  const name = (raw ?? "").trim();
  if (!name || name.toLowerCase() === "n/a") return null;
  const hit = SECTOR_MATCHERS.find(m => m.test(name));
  if (hit) {
    const canon = canonById(hit.id);
    if (canon) return canon;
  }
  return { id: `other:${name.toLowerCase()}`, label: name, color: SECTOR_OTHER_COLOR };
}

function naNote(reason: string): string {
  return reason.startsWith("n/a") ? reason : `n/a — ${reason}`;
}

function dominanceOf(shares: { sector: string; pct: number }[]): { dominant: { id: string; label: string; color: string; pct: number } | null; note: string | null } {
  const real = shares.filter(s => s.pct > 0 && matchSector(s.sector));
  if (real.length === 0) return { dominant: null, note: naNote("kein Sektor-Capex erfasst") };
  const weight = SECTOR_LAYER_PARAMS.capexShareWeight;
  const scored = real.map(s => {
    const matched = matchSector(s.sector)!;
    return { ...matched, pct: s.pct, score: weight * s.pct };
  }).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const top = scored[0];
  const tied = scored.filter(s => s.score === top.score);
  if (tied.length > 1) {
    return { dominant: null, note: naNote(`Gleichstand ${tied.map(t => t.label).join(" / ")}`) };
  }
  return { dominant: { id: top.id, label: top.label, color: top.color, pct: top.pct }, note: null };
}

/** Mid-Rank der Ampel. Liest SECTOR_LAYER_PARAMS.midRankTieWeight, nicht MIDRANK_TIE_WEIGHT. */
function sectorSharePercentile(value: number, population: readonly number[]): number {
  let less = 0;
  let equal = 0;
  for (const v of population) {
    if (v < value) less += 1;
    else if (v === value) equal += 1;
  }
  return (less + SECTOR_LAYER_PARAMS.midRankTieWeight * equal) / population.length;
}

function sampleZ(values: readonly number[]): Array<number | null> {
  if (values.length < 2) return values.map(() => null);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return values.map(() => null);
  return values.map(v => (v - mean) / sd);
}

function peerMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function bandFor(percentile: number | null, peerN: number): SectorBand {
  if (percentile == null || peerN < SECTOR_LAYER_PARAMS.minCountries) return "neutral";
  if (percentile >= SECTOR_LAYER_PARAMS.greenPct) return "green";
  if (percentile <= SECTOR_LAYER_PARAMS.redPct) return "red";
  return "yellow";
}

/**
 * Sektor-Ansicht über einer Capex-Antwort. Reine Funktion: Eingabe wird nicht verändert.
 * Capex-Zahlen und dominantSector bleiben Feld für Feld. Die Ampel ist ein Zusatzobjekt.
 */
export function projectSectorLayer(base: GeoMapResponse): GeoMapSectorResponse {
  const draft = base.countries.map(c => {
    if (c.status !== "ok") {
      const reason = c.note || "Keine Capex-Daten verfügbar";
      const ampel: SectorAmpel = {
        dominantSectorId: null, dominantSector: null, dominantColor: null,
        dominantSharePct: null, sharePercentile: null, shareZ: null,
        shareBand: "neutral", sectorNote: naNote(reason),
      };
      return { country: c, dominantPct: null as number | null, ampel };
    }
    const dom = dominanceOf(c.sectorShares);
    const ampel: SectorAmpel = {
      dominantSectorId: dom.dominant?.id ?? null,
      dominantSector: dom.dominant?.label ?? null,
      dominantColor: dom.dominant?.color ?? null,
      dominantSharePct: dom.dominant?.pct ?? null,
      sharePercentile: null,
      shareZ: null,
      shareBand: "neutral",
      sectorNote: dom.note,
    };
    return { country: c, dominantPct: dom.dominant?.pct ?? null, ampel };
  });

  const peerValues = draft.map(d => d.dominantPct).filter((v): v is number => v != null);
  const peerN = peerValues.length;
  const zs = sampleZ(peerValues);
  let zCursor = 0;
  for (const d of draft) {
    if (d.dominantPct == null) continue;
    const z = zs[zCursor++] ?? null;
    d.ampel.shareZ = z;
    if (peerN < SECTOR_LAYER_PARAMS.minCountries) {
      d.ampel.sharePercentile = null;
      d.ampel.shareBand = "neutral";
      d.ampel.sectorNote = naNote(`Ampel nicht belastbar (${peerN} Länder mit Dominanz, mindestens ${SECTOR_LAYER_PARAMS.minCountries})`);
    } else {
      const pct = sectorSharePercentile(d.dominantPct, peerValues);
      d.ampel.sharePercentile = pct;
      d.ampel.shareBand = bandFor(pct, peerN);
    }
  }

  const legendMap = new Map<string, { id: string; label: string; color: string; countries: number }>();
  for (const d of draft) {
    const id = d.ampel.dominantSectorId;
    if (!id) continue;
    const row = legendMap.get(id) ?? {
      id,
      label: d.ampel.dominantSector || id,
      color: d.ampel.dominantColor || SECTOR_OTHER_COLOR,
      countries: 0,
    };
    row.countries += 1;
    legendMap.set(id, row);
  }

  return {
    ...base,
    layer: "sector",
    sectorLayer: {
      params: SECTOR_LAYER_PARAMS,
      peerN,
      peerMedianSharePct: peerMedian(peerValues),
      legend: Array.from(legendMap.values()).sort((a, b) => b.countries - a.countries || a.label.localeCompare(b.label)),
    },
    countries: draft.map(d => ({ ...d.country, sectorAmpel: d.ampel })),
  };
}

/**
 * FMP-Segmentname → ISO2 der Karte. Nur exakter Name, kein Teilstring
 * (damit „North America“ nicht zu US wird). Unbekannt → null.
 */
export const GEO_SEGMENT_ALIASES: readonly { iso2: string; names: readonly string[] }[] = [
  { iso2: "US", names: ["united states", "united states of america", "usa", "u.s.", "u.s.a."] },
  { iso2: "CA", names: ["canada", "kanada"] },
  { iso2: "MX", names: ["mexico", "mexiko"] },
  { iso2: "BR", names: ["brazil", "brasilien"] },
  { iso2: "CL", names: ["chile"] },
  { iso2: "GB", names: ["united kingdom", "uk", "u.k.", "great britain", "britain", "vereinigtes königreich"] },
  { iso2: "DE", names: ["germany", "deutschland"] },
  { iso2: "FR", names: ["france", "frankreich"] },
  { iso2: "NL", names: ["netherlands", "niederlande", "holland"] },
  { iso2: "CH", names: ["switzerland", "schweiz"] },
  { iso2: "IT", names: ["italy", "italien"] },
  { iso2: "ES", names: ["spain", "spanien"] },
  { iso2: "SE", names: ["sweden", "schweden"] },
  { iso2: "DK", names: ["denmark", "dänemark"] },
  { iso2: "NO", names: ["norway", "norwegen"] },
  { iso2: "SA", names: ["saudi arabia", "saudi-arabien"] },
  { iso2: "ZA", names: ["south africa", "südafrika"] },
  { iso2: "IN", names: ["india", "indien"] },
  { iso2: "CN", names: ["china", "mainland china", "peoples republic of china", "people's republic of china"] },
  { iso2: "HK", names: ["hong kong", "hongkong"] },
  { iso2: "TW", names: ["taiwan"] },
  { iso2: "KR", names: ["south korea", "republic of korea", "südkorea"] },
  { iso2: "JP", names: ["japan"] },
  { iso2: "SG", names: ["singapore", "singapur"] },
  { iso2: "AU", names: ["australia", "australien"] },
];

function normSegmentName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchGeoSegmentIso2(name: string): string | null {
  const n = normSegmentName(name);
  if (!n) return null;
  for (const row of GEO_SEGMENT_ALIASES) {
    if (row.names.some(alias => normSegmentName(alias) === n)) return row.iso2;
  }
  return null;
}

export function mapGeoSegmentRows(rows: readonly { name: string; percentage?: number | null; revenue?: number | null }[] | null | undefined): { lines: GeoSegmentLine[] | null; note: string | null } {
  if (!rows || rows.length === 0) return { lines: null, note: "n/a — FMP lieferte keine Geosegmente" };
  const lines: GeoSegmentLine[] = [];
  for (const row of rows) {
    const name = String(row?.name ?? "").trim();
    if (!name) continue;
    const pct = typeof row.percentage === "number" && Number.isFinite(row.percentage) ? row.percentage : null;
    const revenueUsd = typeof row.revenue === "number" && Number.isFinite(row.revenue) && row.revenue > 0 ? row.revenue : null;
    const iso2 = matchGeoSegmentIso2(name);
    lines.push({
      name,
      pct,
      revenueUsd,
      iso2,
      note: iso2 ? null : "n/a — Segment keinem Karten-Land zugeordnet",
    });
  }
  if (lines.length === 0) return { lines: null, note: "n/a — FMP lieferte keine Geosegmente" };
  return { lines, note: null };
}
