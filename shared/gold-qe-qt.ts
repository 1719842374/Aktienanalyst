/**
 * FW-21 / FW-22 — QE/QT-Bänder und Gold/WALCL nur als Anzeige.
 * Die Bänder sind das Perzentil der eigenen WALCL-Veränderung, nicht die
 * Score-Schwellen +1,5 % / −1 % und nicht das Gate GOLD_QE_QT_REGIME.
 */

export const GOLD_QE_QT_PARAMS = {
  /** Kalendertage zurück für die Bilanzveränderung. 91 Tage = 13 Wochen. */
  changeWindowDays: 91,
  /** Oberes Terzil der eigenen Veränderungen = Ausweitung (grün). */
  expansionPercentile: 2 / 3,
  /** Unteres Terzil = Abbau (rot). Dazwischen neutral (grau). */
  contractionPercentile: 1 / 3,
  /** Unter dieser Zahl sind Perzentil-Bänder nicht belastbar. */
  minChanges: 60,
} as const;

export type QeQtRegime = "expansion" | "contraction" | "neutral";

export interface WalclPoint {
  date: string;
  price: number | null;
  walcl: number | null;
}

export interface QeQtBand {
  x1: string;
  x2: string;
  regime: QeQtRegime;
}

export interface GoldWalclRatioPoint {
  date: string;
  ratio: number;
}

export interface GoldQeQtView {
  bands: QeQtBand[];
  ratios: GoldWalclRatioPoint[];
  regime: QeQtRegime | null;
  /** Letzte 91-Tage-Veränderung der Fed-Bilanz, Anteil (0,01 = 1 %). */
  change: number | null;
  changePercentile: number | null;
  ratio: number | null;
  ratioPercentile: number | null;
  ratioZ: number | null;
  asOf: string | null;
  unavailableReason: string | null;
  ratioReason: string | null;
}

function positive(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function shiftDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

function midrank(value: number, population: readonly number[]): number {
  let less = 0;
  let equal = 0;
  for (const v of population) {
    if (v < value) less += 1;
    else if (v === value) equal += 1;
  }
  return (less + 0.5 * equal) / population.length;
}

function sampleZ(value: number, population: readonly number[]): number | null {
  if (population.length < 2) return null;
  const mean = population.reduce((s, v) => s + v, 0) / population.length;
  const variance = population.reduce((s, v) => s + (v - mean) ** 2, 0) / (population.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return null;
  return (value - mean) / sd;
}

export function regimeFromPercentile(percentile: number): QeQtRegime {
  if (percentile >= GOLD_QE_QT_PARAMS.expansionPercentile) return "expansion";
  if (percentile <= GOLD_QE_QT_PARAMS.contractionPercentile) return "contraction";
  return "neutral";
}

interface ChangeRow {
  date: string;
  change: number;
  percentile: number;
  regime: QeQtRegime;
}

function changesOf(points: readonly WalclPoint[]): ChangeRow[] {
  const withWalcl = points
    .filter(p => positive(p.walcl) && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const rows: Array<{ date: string; change: number }> = [];
  for (const point of withWalcl) {
    const target = shiftDays(point.date, -GOLD_QE_QT_PARAMS.changeWindowDays);
    let prior: number | null = null;
    for (const older of withWalcl) {
      if (older.date > target) break;
      if (older.date >= point.date) break;
      if (positive(older.walcl)) prior = older.walcl;
    }
    if (!positive(prior) || !positive(point.walcl)) continue;
    rows.push({ date: point.date, change: point.walcl / prior - 1 });
  }
  if (rows.length < GOLD_QE_QT_PARAMS.minChanges) return [];
  const values = rows.map(r => r.change);
  return rows.map(r => {
    const percentile = midrank(r.change, values);
    return { ...r, percentile, regime: regimeFromPercentile(percentile) };
  });
}

export function goldQeQtView(points: readonly WalclPoint[], visibleDates?: readonly string[]): GoldQeQtView {
  const empty: GoldQeQtView = {
    bands: [], ratios: [], regime: null, change: null, changePercentile: null,
    ratio: null, ratioPercentile: null, ratioZ: null, asOf: null,
    unavailableReason: null, ratioReason: null,
  };
  const hasWalcl = points.some(p => positive(p.walcl));
  if (!hasWalcl) {
    return { ...empty, unavailableReason: "n/a — WALCL fehlt in der Gold-Historie", ratioReason: "n/a — WALCL fehlt in der Gold-Historie" };
  }
  const classified = changesOf(points);
  if (classified.length === 0) {
    return {
      ...empty,
      ...ratioPart(points),
      unavailableReason: `n/a — zu wenige WALCL-Veränderungen (unter ${GOLD_QE_QT_PARAMS.minChanges})`,
    };
  }
  const byDate = new Map(classified.map(r => [r.date, r]));
  const dates = (visibleDates ?? classified.map(r => r.date)).filter(d => byDate.has(d));
  const bands: QeQtBand[] = [];
  for (const date of dates) {
    const regime = byDate.get(date)!.regime;
    const last = bands[bands.length - 1];
    if (!last || last.regime !== regime) bands.push({ x1: date, x2: date, regime });
    else last.x2 = date;
  }
  const last = classified[classified.length - 1];
  return {
    bands,
    ...ratioPart(points),
    regime: last.regime,
    change: last.change,
    changePercentile: last.percentile * 100,
    asOf: last.date,
    unavailableReason: null,
  };
}

function ratioPart(points: readonly WalclPoint[]): Pick<GoldQeQtView, "ratios" | "ratio" | "ratioPercentile" | "ratioZ" | "ratioReason"> {
  const ratios: GoldWalclRatioPoint[] = [];
  for (const p of points) {
    if (!positive(p.price) || !positive(p.walcl)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) continue;
    ratios.push({ date: p.date, ratio: p.price / p.walcl });
  }
  ratios.sort((a, b) => a.date.localeCompare(b.date));
  if (ratios.length === 0) {
    return { ratios, ratio: null, ratioPercentile: null, ratioZ: null, ratioReason: "n/a — kein gemeinsamer Gold- und WALCL-Tag" };
  }
  const last = ratios[ratios.length - 1];
  const values = ratios.map(r => r.ratio);
  const enough = ratios.length >= GOLD_QE_QT_PARAMS.minChanges;
  return {
    ratios,
    ratio: last.ratio,
    ratioPercentile: enough ? midrank(last.ratio, values) * 100 : null,
    ratioZ: enough ? sampleZ(last.ratio, values) : null,
    ratioReason: enough ? null : `n/a — zu wenige Gold/WALCL-Tage (${ratios.length} < ${GOLD_QE_QT_PARAMS.minChanges})`,
  };
}
