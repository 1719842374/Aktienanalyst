/**
 * Länderanteile der Goldförderung am Weltvolumen einer Produktionstabelle.
 * Der Anteil ist Menge des Landes / Weltzeile. Fehlende Zellen bleiben leer.
 * Keine Schwelle, keine Auffüllung aus einem anderen Jahr, keine Verteilung der Rundungsdifferenz.
 */

export const TROY_OUNCE_GRAMS = 31.1034768;
export const GRAMS_PER_METRIC_TON = 1_000_000;

export const GOLD_PRODUCTION_SOURCE_MISSING =
  "n/a — USGS-Weltproduktion fehlt oder ist nicht lesbar. Länderanteile werden nicht interpoliert";

export type GoldProductionRole = "country" | "aggregate" | "world";

export interface GoldProductionYearColumn {
  year: string;
  field?: string;
  estimated: boolean;
}

export interface GoldProductionRow {
  country: string;
  iso2?: string | null;
  isoNum?: string | null;
  role?: GoldProductionRole;
  tonnes: Record<string, number | null>;
}

export interface GoldProductionTable {
  source: string;
  sourceUrl: string;
  unit: string;
  rows: readonly GoldProductionRow[];
  yearColumns?: readonly GoldProductionYearColumn[];
}

export interface GoldProductionPlacement {
  iso2: string;
  isoNum: string;
  name: string;
  lat: number;
  lon: number;
}

export interface GoldMapProductionInput {
  table: GoldProductionTable;
  placements: readonly GoldProductionPlacement[];
}

export interface GoldProductionFact {
  iso2: string;
  isoNum: string;
  name: string;
  lat: number;
  lon: number;
  productionOz: number | null;
  countrySharePct: number | null;
}

export interface GoldProductionRemainder {
  label: "Rest/Sonstige";
  tonnes: number;
  listedTonnes: number;
  worldTonnes: number;
  unit: string;
}

export interface GoldProductionResolution {
  facts: GoldProductionFact[];
  unplacedCount: number;
  note: string | null;
  unavailable: boolean;
  year: string | null;
  worldVolume: number | null;
  unit: string | null;
  estimated: boolean | null;
  /** Differenz Weltzeile minus ausgewiesene Zeilen. Keine Bubble, nicht verteilt. */
  remainder: GoldProductionRemainder | null;
}

function assertNever(value: never): never {
  throw new Error(`unbehandelte Gold-Produktionsrolle: ${String(value)}`);
}

export function metricTonsToTroyOunces(metricTons: number): number {
  return metricTons * GRAMS_PER_METRIC_TON / TROY_OUNCE_GRAMS;
}

export function isMetricTonUnit(unit: string): boolean {
  const normalized = unit.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "metric tons"
    || normalized === "metric tonnes"
    || normalized === "metric ton"
    || normalized === "tonnes"
    || normalized === "t";
}

function productionRole(row: GoldProductionRow): GoldProductionRole | "invalid" {
  if (row.role === "country" || row.role === "aggregate" || row.role === "world") return row.role;
  if (row.role != null) return "invalid";
  const name = row.country.trim().toLowerCase();
  if (name.startsWith("world")) return "world";
  if (name.startsWith("other")) return "aggregate";
  return "country";
}

function volumeInYear(row: GoldProductionRow, year: string): number | null {
  const raw = row.tonnes?.[year];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

function productionYears(rows: readonly GoldProductionRow[]): string[] {
  const years = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.tonnes ?? {})) {
      if (/^\d{4}$/.test(key)) years.add(key);
    }
  }
  return Array.from(years).sort((a, b) => Number(a) - Number(b));
}

function unavailable(note: string): GoldProductionResolution {
  return {
    facts: [],
    unplacedCount: 0,
    note,
    unavailable: true,
    year: null,
    worldVolume: null,
    unit: null,
    estimated: null,
    remainder: null,
  };
}

function yearEstimate(table: GoldProductionTable, year: string): boolean | null {
  const column = table.yearColumns?.find(entry => entry.year === year);
  if (!column) return null;
  return column.estimated;
}

function estimateLabel(estimated: boolean | null): string {
  if (estimated === true) return "in der Quelle als Schätzung gekennzeichnet";
  if (estimated === false) return "in der Quelle nicht als Schätzung gekennzeichnet";
  return "Schätzkennzeichen in der Quelle nicht gesetzt";
}

/**
 * Baut Länder-Fakten aus der Tabelle. table === null heißt: Quelle fehlt.
 * placements liefert nur vorhandene Atlas-Mittelpunkte. Fehlende Punkte bleiben unplaced.
 */
export function resolveGoldProduction(
  table: GoldProductionTable | null,
  placements: readonly GoldProductionPlacement[] = [],
): GoldProductionResolution {
  if (table == null || !Array.isArray(table.rows)) return unavailable(GOLD_PRODUCTION_SOURCE_MISSING);
  const rows = table.rows;
  if (rows.length === 0) return unavailable("n/a — USGS-Weltproduktion enthält keine Zeilen. Länderanteile werden nicht interpoliert");

  const classified: { row: GoldProductionRow; role: GoldProductionRole }[] = [];
  for (const row of rows) {
    const role = productionRole(row);
    switch (role) {
      case "country":
      case "aggregate":
      case "world":
        classified.push({ row, role });
        break;
      case "invalid":
        return unavailable(`n/a — Produktionszeile „${row.country}“ hat eine unbekannte Rolle. Nichts wird als Land interpretiert`);
      default:
        return assertNever(role);
    }
  }

  const worlds = classified.filter(entry => entry.role === "world");
  if (worlds.length !== 1) {
    return unavailable("n/a — die Quelle hat keine eindeutige Weltzeile. Länderanteile werden nicht aus der Summe der Länder gebildet");
  }

  const years = productionYears(rows).reverse();
  let year: string | null = null;
  let worldVolume: number | null = null;
  for (const candidate of years) {
    const volume = volumeInYear(worlds[0].row, candidate);
    if (volume != null && volume > 0) {
      year = candidate;
      worldVolume = volume;
      break;
    }
  }
  if (year == null || worldVolume == null) {
    return unavailable("n/a — kein Weltvolumen in der USGS-Goldtabelle. Länderanteile werden nicht aus einem anderen Jahr oder aus Nachbarländern interpoliert");
  }

  const byIso = new Map<string, { row: GoldProductionRow; role: GoldProductionRole }[]>();
  for (const entry of classified) {
    if (entry.role !== "country") continue;
    const iso = entry.row.iso2?.trim().toUpperCase();
    if (!iso) continue;
    const list = byIso.get(iso) ?? [];
    list.push(entry);
    byIso.set(iso, list);
  }
  const ambiguous = Array.from(byIso.entries()).filter(([, list]) => list.length > 1).map(([iso]) => iso);

  const placementByIso = new Map<string, GoldProductionPlacement>();
  for (const placement of placements) {
    const iso = placement.iso2.trim().toUpperCase();
    if (!placementByIso.has(iso)) placementByIso.set(iso, placement);
  }

  const facts: GoldProductionFact[] = [];
  const notes: string[] = [];
  const blanks: string[] = [];
  const zeros: string[] = [];
  const negatives: string[] = [];
  const unplaced: string[] = [];
  const noIso: string[] = [];
  let unplacedCount = 0;
  let accounted = 0;
  const ounces = isMetricTonUnit(table.unit);

  for (const entry of classified) {
    if (entry.role === "world") continue;
    const volume = volumeInYear(entry.row, year);
    if (volume == null) {
      if (entry.role === "country") blanks.push(entry.row.country);
      continue;
    }
    if (volume < 0) {
      negatives.push(entry.row.country);
      continue;
    }
    if (volume === 0) {
      if (entry.role === "country") zeros.push(entry.row.country);
      continue;
    }
    accounted += volume;
    if (entry.role === "aggregate") continue;
    const iso = entry.row.iso2?.trim().toUpperCase() ?? "";
    if (!iso) {
      noIso.push(`${entry.row.country} ${volume}/${worldVolume} ${table.unit}`);
      unplacedCount += 1;
      continue;
    }
    if (ambiguous.includes(iso)) continue;
    const share = (volume / worldVolume) * 100;
    const placement = placementByIso.get(iso);
    if (!placement || !Number.isFinite(placement.lat) || !Number.isFinite(placement.lon)) {
      unplaced.push(`${entry.row.country} ${volume}/${worldVolume} ${table.unit}`);
      unplacedCount += 1;
      continue;
    }
    facts.push({
      iso2: iso,
      isoNum: placement.isoNum || entry.row.isoNum || "",
      name: placement.name || entry.row.country,
      lat: placement.lat,
      lon: placement.lon,
      productionOz: ounces ? metricTonsToTroyOunces(volume) : null,
      countrySharePct: share,
    });
  }

  facts.sort((a, b) => (b.countrySharePct ?? 0) - (a.countrySharePct ?? 0) || a.iso2.localeCompare(b.iso2));

  const estimated = yearEstimate(table, year);
  const aggregates = classified.filter(entry => entry.role === "aggregate");
  for (const entry of aggregates) {
    const volume = volumeInYear(entry.row, year);
    if (volume == null || volume <= 0) {
      notes.push(`${entry.row.country}: keine positive Menge im Jahr ${year}, keine Bubble`);
      continue;
    }
    notes.push(`${entry.row.country}: ${volume}/${worldVolume} ${table.unit} im Jahr ${year} (${estimateLabel(estimated)}), kein einzelnes Land, keine Bubble`);
  }
  const remainderTonnes = worldVolume - accounted;
  const remainder: GoldProductionRemainder | null = remainderTonnes === 0 ? null : {
    label: "Rest/Sonstige",
    tonnes: remainderTonnes,
    listedTonnes: accounted,
    worldTonnes: worldVolume,
    unit: table.unit,
  };
  if (remainder) {
    notes.push(`Rest/Sonstige: ${remainder.tonnes} ${table.unit}. Formel: Weltzeile ${worldVolume} − ausgewiesene Zeilen ${accounted}. Die Differenz wird nicht auf Länder verteilt, keine Bubble`);
  }
  if (ambiguous.length > 0) notes.push(`n/a — mehrdeutige Länderzeilen, nicht addiert: ${ambiguous.join(", ")}`);
  if (negatives.length > 0) notes.push(`n/a — negative Menge, nicht verwendet: ${negatives.join(", ")}`);
  if (blanks.length > 0) notes.push(`ohne Menge im Jahr ${year}, nicht aus einem anderen Jahr aufgefüllt: ${blanks.join(", ")}`);
  if (zeros.length > 0) notes.push(`Menge 0, keine Bubble: ${zeros.join(", ")}`);
  if (noIso.length > 0) notes.push(`ohne ISO-Code, keine Bubble: ${noIso.join("; ")}`);
  if (unplaced.length > 0) notes.push(`Koordinate fehlt im Atlas, nicht auf einen anderen Punkt gelegt: ${unplaced.join("; ")}`);
  if (!ounces) notes.push(`Einheit „${table.unit}“ nicht in Unzen umgerechnet`);

  return {
    facts,
    unplacedCount,
    note: notes.length > 0 ? notes.join(". ") : null,
    unavailable: false,
    year,
    worldVolume,
    unit: table.unit,
    estimated,
    remainder,
  };
}
