/**
 * Adaptive Stablecoin-Kanal.
 * Der Z-Score nutzt nur gespeicherte 30-Tage-Änderungen.
 * Perzentil, Multiplikator und GENIUS-Stärke bleiben leer, solange keine
 * Belegreihe im Repo liegt. Keine erfundenen Marktstände.
 */

export interface StablecoinCapSnapshot {
  available: boolean;
  fetchedAt: string;
  totalMarketCapUsd: number | null;
  totalMarketCapPrevMonthUsd: number | null;
}

export interface CapObservation {
  date: string;
  totalMarketCapUsd: number;
}

export interface GrowthZScore {
  available: boolean;
  zScore: number | null;
  scorePoints: number;
  current30dChangeUsd: number | null;
  rollingMean30dChangeUsd: number | null;
  rollingStd30dChangeUsd: number | null;
  sampleCount: number;
}

export interface AdaptiveTBillSlots {
  available: boolean;
  percentile: number | null;
  percentileScore: number;
  dynamicMultiplier: number | null;
  estimatedTBillDemandUsd: number | null;
}

export interface GeniusStrengthSlot {
  available: boolean;
  strength: number | null;
  scorePoints: number;
}

export interface Change30d {
  date: string;
  changeUsd: number;
}

const EMPTY_TBILL: AdaptiveTBillSlots = {
  available: false,
  percentile: null,
  percentileScore: 0,
  dynamicMultiplier: null,
  estimatedTBillDemandUsd: null,
};

function finiteCap(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addUtcDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Stichproben-Standardabweichung (n-1), aktueller Wert ist die letzte Änderung
 * und liegt in Mittelwert und Standardabweichung.
 * Fehlende oder Null-Streuung: zScore null, scorePoints 0.
 * Bänder: > 1.5 → 1.5, > 0.8 → 1, sonst 0.
 */
export function stablecoinGrowthZScore(changes30d: Array<number | null | undefined>): GrowthZScore {
  const finite = changes30d.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const current30dChangeUsd = finite.length > 0 ? finite[finite.length - 1] : null;
  if (finite.length < 2) {
    return {
      available: false,
      zScore: null,
      scorePoints: 0,
      current30dChangeUsd,
      rollingMean30dChangeUsd: null,
      rollingStd30dChangeUsd: null,
      sampleCount: finite.length,
    };
  }
  const current = finite[finite.length - 1];
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (finite.length - 1);
  const std = Math.sqrt(variance);
  if (!(std > 0)) {
    return {
      available: false,
      zScore: null,
      scorePoints: 0,
      current30dChangeUsd: current,
      rollingMean30dChangeUsd: mean,
      rollingStd30dChangeUsd: 0,
      sampleCount: finite.length,
    };
  }
  const zScore = (current - mean) / std;
  const scorePoints = zScore > 1.5 ? 1.5 : zScore > 0.8 ? 1 : 0;
  return {
    available: true,
    zScore,
    scorePoints,
    current30dChangeUsd,
    rollingMean30dChangeUsd: mean,
    rollingStd30dChangeUsd: std,
    sampleCount: finite.length,
  };
}

/** Nur die Stände, die der bestehende Abruf schon liefert. Keine Tage dazwischen. */
export function capPointsFromSnapshot(snapshot: StablecoinCapSnapshot): CapObservation[] {
  if (!snapshot.available || !finiteCap(snapshot.totalMarketCapUsd)) return [];
  const liveDate = snapshot.fetchedAt.slice(0, 10);
  if (!isIsoDate(liveDate)) return [];
  const points: CapObservation[] = [{ date: liveDate, totalMarketCapUsd: snapshot.totalMarketCapUsd }];
  if (finiteCap(snapshot.totalMarketCapPrevMonthUsd)) {
    const priorDate = addUtcDays(liveDate, -30);
    if (priorDate !== liveDate) points.push({ date: priorDate, totalMarketCapUsd: snapshot.totalMarketCapPrevMonthUsd });
  }
  return points;
}

/**
 * Der Abrufstag wird aktualisiert. Ein schon gespeicherter älterer Stand bleibt.
 * Neue Daten füllen nur Lücken, sie überschreiben keine vorhandene Historie.
 */
export function mergeDailyCaps(stored: CapObservation[], incoming: CapObservation[], liveDate: string): CapObservation[] {
  const map = new Map<string, number>();
  for (const point of stored) {
    if (isIsoDate(point.date) && finiteCap(point.totalMarketCapUsd)) map.set(point.date, point.totalMarketCapUsd);
  }
  for (const point of incoming) {
    if (!isIsoDate(point.date) || !finiteCap(point.totalMarketCapUsd)) continue;
    if (point.date === liveDate || !map.has(point.date)) map.set(point.date, point.totalMarketCapUsd);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, totalMarketCapUsd]) => ({ date, totalMarketCapUsd }));
}

/** 30-Tage-Änderung nur, wenn beide Kalendertage gespeichert sind. */
export function changes30dFromCaps(points: CapObservation[]): Change30d[] {
  const map = new Map<string, number>();
  for (const point of points) {
    if (isIsoDate(point.date) && finiteCap(point.totalMarketCapUsd)) map.set(point.date, point.totalMarketCapUsd);
  }
  const changes: Change30d[] = [];
  for (const [date, cap] of [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const prior = map.get(addUtcDays(date, -30));
    if (!finiteCap(prior)) continue;
    changes.push({ date, changeUsd: cap - prior });
  }
  return changes;
}

/** Keine Tether-/Circle-Transparenzreihe ist eingecheckt. */
export function repoIssuerReserveSeries(): null {
  return null;
}

/** Ohne die Repo-Reihe bleiben Perzentil, Multiplikator und Nachfrage leer. */
export function adaptiveTBillSlots(mcapChange30dUsd: number | null): AdaptiveTBillSlots {
  if (repoIssuerReserveSeries() == null || mcapChange30dUsd == null || !Number.isFinite(mcapChange30dUsd)) {
    return { ...EMPTY_TBILL };
  }
  return { ...EMPTY_TBILL };
}

/** Main speichert keine GENIUS-Stärke. Der Slot addiert dann 0. */
export function geniusStrengthSlot(stored: number | null | undefined): GeniusStrengthSlot {
  if (typeof stored !== "number" || !Number.isFinite(stored)) {
    return { available: false, strength: null, scorePoints: 0 };
  }
  return { available: true, strength: stored, scorePoints: 0 };
}

export function composeStablecoinChannel(snapshot: StablecoinCapSnapshot, stored: CapObservation[]): {
  caps: CapObservation[];
  growthZ: GrowthZScore;
  tBillAdaptive: AdaptiveTBillSlots;
  geniusStrength: GeniusStrengthSlot;
} {
  const liveDate = snapshot.fetchedAt.slice(0, 10);
  const caps = mergeDailyCaps(stored, capPointsFromSnapshot(snapshot), isIsoDate(liveDate) ? liveDate : "");
  const growthZ = stablecoinGrowthZScore(changes30dFromCaps(caps).map(row => row.changeUsd));
  return {
    caps,
    growthZ,
    tBillAdaptive: adaptiveTBillSlots(growthZ.current30dChangeUsd),
    geniusStrength: geniusStrengthSlot(null),
  };
}
