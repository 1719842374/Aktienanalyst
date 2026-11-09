/**
 * Credit-Overlay Stufe 1 (JOB A1): Markt-Spread Baa (FRED BAA10Y) in der Technischen Analyse.
 *
 * BAA10Y = Moody's Seasoned Baa Corporate Bond Yield minus 10Y Treasury — bereits ein Spread,
 * es wird KEINE Treasury abgezogen. Aggregat über alle US-Unternehmen, keine Anleihe des
 * analysierten Titels. Geht NICHT in den Score und NICHT in die Fazit-Zählung.
 * Keine Datenwerte im Code: alles kommt aus der FRED-CSV, fehlt sie → n/a.
 * Typen: shared/schema.ts.
 */
import type { CreditBasis, CreditMetricReading, CreditOverlayPoint, CreditPoint, CreditStance, CreditStressSignal } from "./schema";

export type { CreditBasis, CreditMetricReading, CreditOverlayPoint, CreditPoint, CreditSpreadResponse, CreditStance, CreditStressSignal, CreditFundamentalsResponse } from "./schema";

export const CREDIT_SOURCE_LABEL = "FRED BAA10Y (Moody's Baa − 10Y Treasury)";
export const CREDIT_SOURCE_URL = "https://fred.stlouisfed.org/series/BAA10Y";
export const ISSUER_BOND_NA_NOTE = "Unternehmensspezifische Anleiherendite: n/a – keine freie Kursquelle (TRACE/Bloomberg kostenpflichtig)";
export const CREDIT_STRESS_HINT = "Kreditmarkt-Stress steigt";

/** Exaktes Label der Overlay-Linie (Bauauftrag A1). */
export function marketSpreadLabel(ticker: string | null | undefined): string {
  return `Markt-Spread Baa (alle US-Unternehmen) – keine Anleihe von ${ticker || "diesem Titel"}`;
}

/** Regel-Parameter des Hinweises (Methodik, keine Datenwerte). */
export const STRESS_CHANGE_OBS = 63;       // ≈ 3 Monate Handelstage
export const STRESS_LOOKBACK_YEARS = 20;   // Referenzverteilung der 3M-Änderungen
export const STRESS_PERCENTILE = 80;       // „steigt“, wenn aktuelle 3M-Änderung > 0 und > P80
export const STRESS_MIN_SAMPLE = 252;      // < 1 Jahr Referenz → kein Signal (n/a)
/** Overlay: ein Spread-Wert gilt für einen Kurstag nur, wenn er höchstens so viele Kalendertage älter ist. */
export const OVERLAY_MAX_GAP_DAYS = 7;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Beobachtungen (aus server/fred-csv.ts) → nach Datum sortiert, nur ISO-Daten, ohne doppelte Tage. */
export function normalizeCreditPoints(obs: ReadonlyArray<{ date: string; value: number }> | null | undefined): CreditPoint[] {
  if (!Array.isArray(obs)) return [];
  const out = obs
    .filter(o => o && ISO.test(o.date) && Number.isFinite(o.value))
    .map(o => ({ date: o.date, value: o.value }));
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out.filter((p, i) => i === 0 || p.date !== out[i - 1].date);
}

function percentileOf(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Aktuelle 3M-Änderung (63 Beobachtungen) gegen die rollierenden 3M-Änderungen der letzten 20 Jahre.
 * rising = Änderung > 0 UND > P80. Zu wenig Historie → null (n/a, kein Hinweis).
 */
export function creditStressSignal(points: CreditPoint[]): CreditStressSignal | null {
  if (!Array.isArray(points) || points.length <= STRESS_CHANGE_OBS) return null;
  const last = points[points.length - 1];
  const cutoff = new Date(last.date + "T00:00:00Z");
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - STRESS_LOOKBACK_YEARS);
  const cut = cutoff.toISOString().slice(0, 10);
  const changes: number[] = [];
  for (let i = STRESS_CHANGE_OBS; i < points.length; i++) {
    if (points[i].date < cut) continue;
    changes.push(points[i].value - points[i - STRESS_CHANGE_OBS].value);
  }
  if (changes.length < STRESS_MIN_SAMPLE) return null;
  const current = changes[changes.length - 1];
  const sorted = [...changes].sort((a, b) => a - b);
  const threshold = percentileOf(sorted, STRESS_PERCENTILE);
  const below = sorted.filter(c => c < current).length;
  return {
    rising: current > 0 && current > threshold,
    asOf: last.date,
    last: last.value,
    change3MPp: current,
    percentileThresholdPp: threshold,
    percentileRank: (below / sorted.length) * 100,
    sampleSize: sorted.length,
  };
}

/** Hinweistext NUR bei steigendem Spread, sonst null. Reine Anzeige, kein Score-/Fazit-Faktor. */
export function creditStressHint(s: CreditStressSignal | null | undefined): string | null {
  if (!s || !s.rising) return null;
  const bp = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)} bp`;
  return `${CREDIT_STRESS_HINT}: Markt-Spread Baa ${bp(s.change3MPp)} in 3M `
    + `(über P${STRESS_PERCENTILE} der 3M-Änderungen seit ${STRESS_LOOKBACK_YEARS}J, Schwelle ${bp(s.percentileThresholdPp)}), `
    + `aktuell ${s.last.toFixed(2)}% (Stand ${s.asOf}). Nur Hinweis, kein Score-Einfluss.`;
}

/** Ordnet jedem Kurstag den letzten FRED-Wert ≤ Datum zu (max. OVERLAY_MAX_GAP_DAYS alt), sonst null. */
export function creditOverlaySeries(bars: Array<{ date: string }>, points: CreditPoint[]): CreditOverlayPoint[] {
  const out: CreditOverlayPoint[] = [];
  let j = -1;
  for (const b of bars) {
    while (j + 1 < points.length && points[j + 1].date <= b.date) j++;
    const p = j >= 0 ? points[j] : null;
    const gap = p ? (Date.parse(b.date + "T00:00:00Z") - Date.parse(p.date + "T00:00:00Z")) / 86400000 : Infinity;
    out.push(p && gap <= OVERLAY_MAX_GAP_DAYS ? { date: b.date, spreadPct: p.value, spreadDate: p.date } : { date: b.date, spreadPct: null, spreadDate: null });
  }
  return out;
}

/**
 * F1-20/F1-21/F1-24: Einstufung von Markt-Spread, Debt/Equity und Zinsdeckung.
 * Schwellen sind Terzile der jeweiligen Verteilung (Perzentil oder Peer-Position),
 * keine festen Kennzahl-Grenzen. Gewichte gibt es nicht: jede Kennzahl bleibt
 * für sich, nichts fließt in den Score oder das CRV.
 */
export const CREDIT_STANCE_PARAMS = {
  /** Angespannt ab dem oberen Terzil (Richtung „mehr Risiko“). */
  stressedPct: 2 / 3,
  /** Entspannt bis einschließlich des unteren Terzils. */
  calmPct: 1 / 3,
  /** Unter dieser Stichprobe ist ein Terzil nicht belastbar → Einstufung n/a. */
  minSample: 3,
  /** Jahreszeilen der FMP-Ratios für die eigene Historie. */
  historyLimit: 20,
  /** Neueste Zeile je Peer für die Querschnitts-Position. */
  peerRowLimit: 1,
  /** Obergrenze der Peer-Symbole, die der Client mitgeben darf. */
  maxPeers: 8,
  /** Level-Perzentil des Markt-Spreads über dasselbe Fenster wie das Stress-Signal. */
  levelLookbackYears: STRESS_LOOKBACK_YEARS,
} as const;

export const CREDIT_TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/;

/** FMP /stable/ratios: ältere und stabile Feldnamen, erste endliche Zahl gewinnt. */
export const FMP_DEBT_EQUITY_FIELDS = ["debtToEquityRatio", "debtEquityRatio", "debtToEquityRatioTTM", "debtEquityRatioTTM"] as const;
export const FMP_INTEREST_COVERAGE_FIELDS = ["interestCoverageRatio", "interestCoverage", "interestCoverageRatioTTM", "interestCoverageTTM"] as const;

export interface CreditLevelReading {
  value: number | null;
  asOf: string | null;
  unavailable: string | null;
  percentile: number | null;
  zScore: number | null;
  sampleSize: number;
  stance: CreditStance | null;
}

export interface ParsedCreditMetric {
  value: number | null;
  asOf: string | null;
  unavailable: string | null;
  history: number[];
}

export interface ParsedCreditRatios {
  debtToEquity: ParsedCreditMetric;
  interestCoverage: ParsedCreditMetric;
}

const MIDRANK_TIE_WEIGHT = 0.5;

function isRow(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function readFiniteField(row: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const raw = row[key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function midrank(value: number, population: readonly number[]): number {
  let less = 0;
  let equal = 0;
  for (const v of population) {
    if (v < value) less += 1;
    else if (v === value) equal += 1;
  }
  return (less + MIDRANK_TIE_WEIGHT * equal) / population.length;
}

function sampleZ(value: number, population: readonly number[]): number | null {
  if (population.length < 2) return null;
  const mean = population.reduce((s, v) => s + v, 0) / population.length;
  const variance = population.reduce((s, v) => s + (v - mean) ** 2, 0) / (population.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return 0;
  return (value - mean) / sd;
}

function stanceFromPercentile(percentile: number, direction: "riskUp" | "riskDown"): CreditStance {
  const high = percentile >= CREDIT_STANCE_PARAMS.stressedPct;
  const low = percentile <= CREDIT_STANCE_PARAMS.calmPct;
  if (direction === "riskUp") return high ? "angespannt" : low ? "entspannt" : "im Mittelfeld";
  return low ? "angespannt" : high ? "entspannt" : "im Mittelfeld";
}

function emptyMetric(unavailable: string): ParsedCreditMetric {
  return { value: null, asOf: null, unavailable, history: [] };
}

function metricFromRows(rows: Record<string, unknown>[], keys: readonly string[], missingLabel: string): ParsedCreditMetric {
  const history: number[] = [];
  let value: number | null = null;
  let asOf: string | null = null;
  for (const row of rows) {
    const n = readFiniteField(row, keys);
    if (n == null) continue;
    history.push(n);
    value = n;
    const date = typeof row.date === "string" ? row.date : null;
    asOf = date;
  }
  if (value == null) return emptyMetric(missingLabel);
  return { value, asOf, unavailable: null, history };
}

/** Rohe FMP-Ratio-Zeilen → letzte endliche Kennzahl plus Historie. Fehlendes bleibt null. */
export function parseCreditRatioRows(rows: unknown): ParsedCreditRatios {
  if (!Array.isArray(rows)) {
    const reason = "FMP-Ratios keine Liste";
    return { debtToEquity: emptyMetric(reason), interestCoverage: emptyMetric(reason) };
  }
  const list = rows.filter(isRow);
  if (list.length === 0) {
    const reason = "FMP-Ratios leer";
    return { debtToEquity: emptyMetric(reason), interestCoverage: emptyMetric(reason) };
  }
  list.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
  return {
    debtToEquity: metricFromRows(list, FMP_DEBT_EQUITY_FIELDS, "FMP-Ratios ohne debtToEquityRatio/debtEquityRatio"),
    interestCoverage: metricFromRows(list, FMP_INTEREST_COVERAGE_FIELDS, "FMP-Ratios ohne interestCoverageRatio/interestCoverage"),
  };
}

function blankReading(unavailable: string | null): CreditMetricReading {
  return { value: null, asOf: null, unavailable, percentile: null, zScore: null, sampleSize: 0, basis: null, stance: null };
}

/**
 * Einstufung gegen Peers, sobald die Peer-Stichprobe belastbar ist, sonst gegen die eigene Historie.
 * direction riskUp: hoher Rang = angespannt (Spread, Debt/Equity). riskDown: hoher Rang = entspannt (Zinsdeckung).
 */
export function creditMetricReading(args: {
  value: number | null;
  asOf: string | null;
  unavailable: string | null;
  ownHistory: readonly number[];
  peers: readonly number[];
  direction: "riskUp" | "riskDown";
}): CreditMetricReading {
  if (args.value == null || !Number.isFinite(args.value)) return blankReading(args.unavailable ?? "nicht geliefert");
  const peers = args.peers.filter(v => Number.isFinite(v));
  const own = args.ownHistory.filter(v => Number.isFinite(v));
  const usePeers = peers.length >= CREDIT_STANCE_PARAMS.minSample;
  const population = usePeers ? peers : own;
  const basis: CreditBasis | null = usePeers ? "Peers" : own.length >= CREDIT_STANCE_PARAMS.minSample ? "eigene Historie" : null;
  if (!basis) {
    return { value: args.value, asOf: args.asOf, unavailable: null, percentile: null, zScore: sampleZ(args.value, population), sampleSize: population.length, basis: null, stance: null };
  }
  const percentile = midrank(args.value, population);
  return {
    value: args.value,
    asOf: args.asOf,
    unavailable: null,
    percentile,
    zScore: sampleZ(args.value, population),
    sampleSize: population.length,
    basis,
    stance: stanceFromPercentile(percentile, args.direction),
  };
}

function finitePoints(points: readonly CreditPoint[] | null | undefined): CreditPoint[] {
  if (!Array.isArray(points)) return [];
  return points
    .filter(p => p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value))
    .map(p => ({ date: p.date, value: p.value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Historisches Level-Perzentil des letzten BAA10Y-Werts. Zu wenig Punkte → Wert bleibt, Einstufung n/a. */
export function creditLevelReading(points: readonly CreditPoint[] | null | undefined): CreditLevelReading {
  const sorted = finitePoints(points);
  if (sorted.length === 0) {
    return { value: null, asOf: null, unavailable: "FRED BAA10Y leer", percentile: null, zScore: null, sampleSize: 0, stance: null };
  }
  const last = sorted[sorted.length - 1];
  const cut = new Date(`${last.date}T00:00:00Z`);
  cut.setUTCFullYear(cut.getUTCFullYear() - CREDIT_STANCE_PARAMS.levelLookbackYears);
  const cutIso = cut.toISOString().slice(0, 10);
  const sample = sorted.filter(p => p.date >= cutIso);
  const population = sample.map(p => p.value);
  if (population.length < CREDIT_STANCE_PARAMS.minSample) {
    return { value: last.value, asOf: last.date, unavailable: "zu wenig Historie für ein Perzentil", percentile: null, zScore: null, sampleSize: population.length, stance: null };
  }
  const percentile = midrank(last.value, population);
  return {
    value: last.value,
    asOf: last.date,
    unavailable: null,
    percentile,
    zScore: sampleZ(last.value, population),
    sampleSize: population.length,
    stance: stanceFromPercentile(percentile, "riskUp"),
  };
}

export function formatCreditMetric(reading: { value: number | null; unavailable: string | null }, digits: number): string {
  if (reading.value == null || !Number.isFinite(reading.value)) {
    const reason = (reading.unavailable ?? "nicht geliefert").replace(/^n\/a\s*—\s*/i, "").trim();
    return `n/a — ${reason}`;
  }
  return reading.value.toFixed(digits);
}

/** Eine Textzeile für PESTEL Economic. Kommt aus dem BAA10Y-Stand, nicht aus einer festen Spread-Schwelle. */
export function pestelCreditLine(reading: CreditLevelReading): string {
  const tail = "kein CDS, kein Score, kein CRV.";
  if (reading.value == null || !Number.isFinite(reading.value)) {
    const reason = (reading.unavailable ?? "FRED BAA10Y nicht erreichbar").replace(/^n\/a\s*—\s*/i, "").trim();
    return `Kreditrisiko (Markt-Spread Baa, FRED BAA10Y): n/a — ${reason}. ${tail}`;
  }
  const pct = reading.percentile == null
    ? "Perzentil n/a — zu wenig Historie"
    : `historisches Perzentil ${Math.round(reading.percentile * 100)}`;
  const stance = reading.stance ?? "n/a — zu wenig Historie";
  return `Kreditrisiko (Markt-Spread Baa, FRED BAA10Y): ${reading.value.toFixed(2)}% (Stand ${reading.asOf}), ${pct} — ${stance}. Markt-Aggregat, ${tail}`;
}
