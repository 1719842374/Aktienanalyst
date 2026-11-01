/**
 * Score-Ergänzungen hinter einem Feature-Flag (Default AUS).
 *
 * Drei Specs, die Philip noch nicht freigegeben hat. Sie ändern Score oder Rating,
 * deshalb laufen sie nur, wenn `scoringAdditionsEnabled()` true liefert:
 *
 *   WORK_SECTORAL_MOAT_DAMPING.md — schwacher Moat + hohe Rivalität dämpft den
 *     Gesamtscore, auch bei Golden Cross. Der Death-Cross-Override bleibt davor.
 *   WORK_HYBRID_CLASSIFICATION.md + WORK_HYBRID_XPENG.md — Lynch-Anteile aus den
 *     Segmenten, sekundäre Klasse nur über dem Median-Perzentil der eigenen Anteile.
 *   WORK_SCORING_ADDITIONS_MSFT.md — Earnings Yield (EBIT/EV) und Accruals-Quote
 *     als Qualitätslage. Einbinden: ja. Ein kombinierter Quality-Value-Score: nein.
 *
 * WORK_NVO_TECHNICAL_OVERRIDE.md und WORK_SECTION_WEIGHTING_ADAPTIVE.md sind mit
 * 8bb4967f (TECH_MOAT_OVERRIDE) bereits auf main. Diese Datei fasst sie nicht an.
 *
 * Flag AUS: kein Aufrufer darf den Score anfassen. Fehlende Daten sind „n/a“, nie 0.
 * Schwellen kommen aus der Verteilung der vorliegenden Daten (Median, Perzentil,
 * z-Score, Peer-Position). Die benannten Konstanten unten sind Parameter, keine
 * stillen Schwellen.
 */
import { moatBucket } from "./bias-fixes";

/** Lokale Formen, damit shared/schema.ts diese Datei importieren kann, ohne einen Typ-Kreis zu schließen. */
interface SegmentShare { name?: string; percentage?: number | null; growth?: number | null }
interface PorterLike { name?: string; force?: string; score?: number }
interface AdditionsSource {
  description?: string | null;
  lynchClass?: string | null;
  marketCap?: number | null;
  totalDebt?: number | null;
  cashEquivalents?: number | null;
  operatingIncome?: number | null;
  netIncome?: number | null;
  moatRating?: string | null;
  revenueSegments?: SegmentShare[] | null;
  moatAssessment?: { overallRating?: string | null; moatSources?: string[] | null; porterForces?: PorterLike[] | null } | null;
  financialStatements?: { cashFlow?: { operatingCashFlow?: number | null } | null } | null;
}

/** Request-Feld und Env-Name. Default AUS: fehlt beides, bleibt die Logik stumm. */
export const SCORING_ADDITIONS_FLAG = "scoringAdditions";
export const SCORING_ADDITIONS_ENV = "SCORING_ADDITIONS";

/**
 * Maximale Dämpfung bei Moat None und Rivalität am oberen Rand der beobachteten
 * Porter-Spanne (WORK_SECTORAL_MOAT_DAMPING §2.2: „max ~50 %“). Benannter Parameter.
 */
export const MOAT_RIVALRY_DAMPING_SPAN = 0.5;
/** Moat-Lagen, die als schwach gelten (Spec §2.1). Wide und Moderate dämpfen nicht. */
export const MOAT_RIVALRY_WEAK_BUCKETS = ["none", "narrow"] as const;
/** Heritage-/Brand-Wörter, analog zu den bestehenden Brand-Keywords in scoreMoat. */
export const HERITAGE_MOAT_TERMS = ["heritage", "brand heritage", "premium brand"] as const;
/** Accruals-Quote: |Net Income − Operating Cash Flow| / |Net Income|. */
export const ACCRUALS_BASE = "netIncome" as const;

export interface DistributionStats {
  points: number;
  median: number | null;
  /** 0–1: Anteil der Werte ≤ reference. */
  percentile: number | null;
  /** (reference − Median) / Streuung. Streuung 0 → null. */
  zScore: number | null;
}

export interface LynchShare {
  lynchClass: string;
  label: string;
  /** 0–1. */
  share: number;
}

export interface HybridClassification {
  available: boolean;
  reason: string | null;
  dominant: LynchShare | null;
  /** Zweitgrößte Klasse, nur wenn ihr Anteil über dem Median-Perzentil der eigenen Anteile liegt. */
  secondary: LynchShare | null;
  shares: LynchShare[];
  /** Median der eigenen Klassen-Anteile; darunter bleibt eine Klasse unsichtbar. */
  shareMedian: number | null;
  label: string | null;
}

export interface MoatRivalryDamping {
  available: boolean;
  reason: string | null;
  moatWeak: boolean;
  rivalryHigh: boolean;
  /** 0–1, höher = schwächer. null, wenn der Moat-Score fehlt. */
  moatStrength: number | null;
  /** 0–1 gegen den Median der übrigen Porter-Kräfte. null, wenn keine Vergleichsgruppe da ist. */
  rivalryStrength: number | null;
  heritageNoted: boolean;
  /** 1 = keine Dämpfung. < 1 nur, wenn beide Bedingungen gelten und die Stärke belegbar ist. */
  factor: number;
  detail: string;
}

export interface EarningsYieldReading {
  available: boolean;
  reason: string | null;
  /** EBIT / Enterprise Value, in Prozent. */
  yieldPct: number | null;
  peerMedianPct: number | null;
  percentile: number | null;
  zScore: number | null;
  /** +1 über dem Peer-Median, −1 darunter, 0 auf dem Median. */
  direction: -1 | 0 | 1 | null;
}

export interface AccrualsReading {
  available: boolean;
  reason: string | null;
  /** |Net Income − Operating Cash Flow| / |Net Income|. */
  ratio: number | null;
  /** +1 = Rückstellung niedrig (Quote unter dem eigenen Median), −1 = hoch. */
  direction: -1 | 0 | 1 | null;
  historyPoints: number;
  median: number | null;
}

export interface ScoringAdditions {
  enabled: boolean;
  hybrid: HybridClassification | null;
  moatRivalry: MoatRivalryDamping | null;
  earningsYield: EarningsYieldReading | null;
  accruals: AccrualsReading | null;
}

const LYNCH_LABELS: Record<string, string> = {
  cyclical: "Zykliker",
  fast_grower: "Fast Grower",
  stalwart: "Stalwart",
  slow_grower: "Slow Grower",
  turnaround: "Turnaround",
  asset_play: "Asset Play",
};

export function scoringAdditionsEnabled(source?: { body?: unknown; env?: string | undefined }): boolean {
  const body = source?.body;
  if (body && typeof body === "object" && SCORING_ADDITIONS_FLAG in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>)[SCORING_ADDITIONS_FLAG] === true;
  }
  const env = source && "env" in source ? source.env : process.env[SCORING_ADDITIONS_ENV];
  return env === "1";
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Perzentil und z-Score einer Referenz gegen die eigene Verteilung. */
export function distributionStats(values: number[], reference: number | null): DistributionStats {
  const clean = values.filter(finite);
  if (!finite(reference) || clean.length === 0) {
    return { points: clean.length, median: median(clean), percentile: null, zScore: null };
  }
  const med = median(clean);
  const below = clean.filter(v => v <= reference).length;
  const mean = clean.reduce((s, v) => s + v, 0) / clean.length;
  const sd = Math.sqrt(clean.reduce((s, v) => s + (v - mean) ** 2, 0) / clean.length);
  return {
    points: clean.length,
    median: med,
    percentile: below / clean.length,
    zScore: sd > 0 ? (reference - mean) / sd : null,
  };
}

function lynchLabel(lynchClass: string): string {
  return LYNCH_LABELS[lynchClass] ?? lynchClass;
}

/**
 * Lynch-Klasse eines Segments aus seinem eigenen Wachstum gegen den Median des
 * Segmentwachstums. Ohne Wachstum bleibt das Segment bei der Firmenklasse.
 * Kein festes 20-%-Gate: die Grenze ist der Median der gemeldeten Wachstumsraten.
 */
export function segmentLynchClass(growth: number | null, growthMedian: number | null, fallback: string): string {
  if (!finite(growth) || !finite(growthMedian)) return fallback;
  if (growth < 0 && growth < growthMedian) return "turnaround";
  if (growth > growthMedian) return "fast_grower";
  return fallback;
}

export function classifyHybrid(input: {
  segments: SegmentShare[] | null | undefined;
  fallbackClass: string | null | undefined;
}): HybridClassification {
  const fallback = input.fallbackClass && String(input.fallbackClass).trim() ? String(input.fallbackClass) : null;
  const rows = (input.segments ?? []).filter(s => s && finite(s.percentage) && s.percentage > 0);
  if (!fallback) {
    return { available: false, reason: "n/a — Lynch-Klasse fehlt", dominant: null, secondary: null, shares: [], shareMedian: null, label: null };
  }
  if (rows.length < 2) {
    return { available: false, reason: "n/a — weniger als zwei Umsatzsegmente", dominant: null, secondary: null, shares: [], shareMedian: null, label: null };
  }
  const growths = rows.map(s => s.growth).filter((g): g is number => finite(g));
  const growthMedian = growths.length >= 2 ? median(growths) : null;
  const totals = new Map<string, number>();
  let weight = 0;
  for (const row of rows) {
    const pct = row.percentage as number;
    const cls = segmentLynchClass(finite(row.growth) ? row.growth : null, growthMedian, fallback);
    totals.set(cls, (totals.get(cls) ?? 0) + pct);
    weight += pct;
  }
  const shares: LynchShare[] = Array.from(totals.entries())
    .map(([lynchClass, sum]) => ({ lynchClass, label: lynchLabel(lynchClass), share: weight > 0 ? sum / weight : 0 }))
    .sort((a, b) => b.share - a.share);
  const dominant = shares[0] ?? null;
  const shareMedian = median(shares.map(s => s.share));
  const second = shares[1] ?? null;
  // WORK_HYBRID_XPENG: keine feste Schwelle. Ab drei Klassen entscheidet der
  // Median der kleineren Klassen. Bei genau einer kleineren Klasse gibt es
  // keinen Klassen-Vergleich, dann entscheidet ihr Anteil an den übrigen
  // Anteilen (über der Hälfte der übrigen Masse).
  const lesser = shares.slice(1);
  const lesserMedian = median(lesser.map(s => s.share));
  const restShare = lesser.reduce((s, x) => s + x.share, 0);
  const visible = second != null && (lesser.length >= 2
    ? lesserMedian != null && second.share > lesserMedian
    : restShare > 0 && second.share / restShare > 0.5);
  const secondary = visible ? second : null;
  const label = dominant ? (secondary ? `${dominant.label} / ${secondary.label}` : dominant.label) : null;
  return { available: true, reason: null, dominant, secondary, shares, shareMedian, label };
}

function porterName(force: PorterLike): string {
  return String(force.name ?? force.force ?? "");
}

/** Rivalitäts-Kraft, egal ob das Payload `name` (Schema) oder `force` (Heuristik) trägt. */
export function rivalryForce(forces: PorterLike[] | null | undefined): { score: number } | null {
  const hit = (forces ?? []).find(f => /rival|wettbewerb/i.test(porterName(f)));
  if (!hit || !finite((hit as { score?: number }).score)) return null;
  return { score: (hit as { score: number }).score };
}

export function evaluateMoatRivalryDamping(input: {
  moatRating: string | null | undefined;
  moatScore: number | null | undefined;
  porterForces: PorterLike[] | null | undefined;
  description: string | null | undefined;
}): MoatRivalryDamping {
  const absent: MoatRivalryDamping = {
    available: false, reason: null, moatWeak: false, rivalryHigh: false,
    moatStrength: null, rivalryStrength: null, heritageNoted: false, factor: 1, detail: "",
  };
  const bucket = moatBucket(input.moatRating);
  if (bucket === "unknown") {
    return { ...absent, reason: "n/a — Moat-Rating fehlt", detail: "n/a — Moat-Rating fehlt" };
  }
  const rivalry = rivalryForce(input.porterForces);
  if (!rivalry) {
    return { ...absent, reason: "n/a — Porter-Kraft Rivalität fehlt", detail: "n/a — Porter-Kraft Rivalität fehlt" };
  }
  const others = (input.porterForces ?? [])
    .filter(f => !/rival|wettbewerb/i.test(porterName(f)) && finite(f.score))
    .map(f => f.score as number);
  const stats = distributionStats(others, rivalry.score);
  if (others.length === 0 || stats.median == null) {
    return { ...absent, reason: "n/a — keine Vergleichs-Porter-Kräfte", detail: "n/a — keine Vergleichs-Porter-Kräfte" };
  }
  const moatWeak = (MOAT_RIVALRY_WEAK_BUCKETS as readonly string[]).includes(bucket);
  const rivalryHigh = rivalry.score > stats.median;
  const text = String(input.description ?? "").toLowerCase();
  const heritageNoted = HERITAGE_MOAT_TERMS.some(term => text.includes(term));
  const moatStrength = finite(input.moatScore) ? Math.max(0, Math.min(1, 1 - input.moatScore / 10)) : null;
  const span = Math.max(...others) - Math.min(...others);
  const rivalryStrength = span > 0 ? Math.max(0, Math.min(1, (rivalry.score - stats.median) / span)) : null;
  const active = moatWeak && rivalryHigh && moatStrength != null && rivalryStrength != null && rivalryStrength > 0;
  const factor = active ? 1 - moatStrength * rivalryStrength * MOAT_RIVALRY_DAMPING_SPAN : 1;
  const detail = !moatWeak
    ? `keine Dämpfung: Moat ${input.moatRating} ist nicht schwach`
    : !rivalryHigh
      ? `keine Dämpfung: Rivalität ${rivalry.score} liegt nicht über dem Median ${stats.median} der übrigen Porter-Kräfte`
      : moatStrength == null
        ? "n/a — Moat-Score fehlt"
        : `Score gedämpft durch schwachen Moat (${input.moatRating}, Stärke ${(moatStrength * 100).toFixed(0)} %) und Rivalität ${rivalry.score} über dem Porter-Median ${stats.median} (Faktor ${factor.toFixed(3)})`;
  return {
    available: true,
    reason: null,
    moatWeak,
    rivalryHigh,
    moatStrength,
    rivalryStrength,
    heritageNoted,
    factor,
    detail,
  };
}

export function earningsYield(input: {
  ebit: number | null | undefined;
  marketCap: number | null | undefined;
  totalDebt: number | null | undefined;
  cash: number | null | undefined;
  peerYieldsPct: Array<number | null | undefined> | null | undefined;
}): EarningsYieldReading {
  const blank: EarningsYieldReading = { available: false, reason: null, yieldPct: null, peerMedianPct: null, percentile: null, zScore: null, direction: null };
  if (!finite(input.ebit)) return { ...blank, reason: "n/a — EBIT fehlt" };
  if (!finite(input.marketCap) || input.marketCap <= 0) return { ...blank, reason: "n/a — Marktkapitalisierung fehlt" };
  const debt = finite(input.totalDebt) ? input.totalDebt : null;
  const cash = finite(input.cash) ? input.cash : null;
  if (debt == null || cash == null) return { ...blank, reason: "n/a — Net Debt fehlt" };
  const ev = input.marketCap + debt - cash;
  if (!(ev > 0)) return { ...blank, reason: "n/a — Enterprise Value nicht positiv" };
  const yieldPct = (input.ebit / ev) * 100;
  const peers = (input.peerYieldsPct ?? []).filter((v): v is number => finite(v));
  if (peers.length === 0) return { ...blank, reason: "n/a — keine Peer-Earnings-Yields", yieldPct };
  const stats = distributionStats(peers, yieldPct);
  const direction: -1 | 0 | 1 | null = stats.median == null ? null : yieldPct > stats.median ? 1 : yieldPct < stats.median ? -1 : 0;
  return { available: true, reason: null, yieldPct, peerMedianPct: stats.median, percentile: stats.percentile, zScore: stats.zScore, direction };
}

export function accrualsRatio(input: {
  netIncome: number | null | undefined;
  operatingCashFlow: number | null | undefined;
  history: Array<{ netIncome: number | null | undefined; operatingCashFlow: number | null | undefined }> | null | undefined;
}): AccrualsReading {
  const blank: AccrualsReading = { available: false, reason: null, ratio: null, direction: null, historyPoints: 0, median: null };
  if (!finite(input.netIncome) || input.netIncome === 0) return { ...blank, reason: "n/a — Net Income fehlt" };
  if (!finite(input.operatingCashFlow)) return { ...blank, reason: "n/a — Operating Cash Flow fehlt" };
  const ratio = Math.abs(input.netIncome - input.operatingCashFlow) / Math.abs(input.netIncome);
  const history = (input.history ?? [])
    .map(row => finite(row.netIncome) && row.netIncome !== 0 && finite(row.operatingCashFlow)
      ? Math.abs(row.netIncome - row.operatingCashFlow) / Math.abs(row.netIncome) : null)
    .filter((v): v is number => v != null);
  if (history.length === 0) return { ...blank, reason: "n/a — keine Accruals-Historie", ratio };
  const stats = distributionStats(history, ratio);
  const direction: -1 | 0 | 1 | null = stats.median == null ? null : ratio < stats.median ? 1 : ratio > stats.median ? -1 : 0;
  return { available: true, reason: null, ratio, direction, historyPoints: history.length, median: stats.median };
}

/** Gesamtscore nur mit Flag AN dämpfen. Flag AUS liefert den Score zurück. */
export function applyMoatRivalryToScore(score: number, damping: MoatRivalryDamping | null, enabled: boolean): number {
  if (!enabled || !damping || !damping.available) return score;
  return score * damping.factor;
}

export function emptyScoringAdditions(enabled: boolean): ScoringAdditions {
  return { enabled, hybrid: null, moatRivalry: null, earningsYield: null, accruals: null };
}

/** Liest nur, was im Analyse-Payload schon liegt. Fehlende Felder bleiben n/a. */
export function scoringAdditionsFromAnalysis(data: AdditionsSource, enabled: boolean, moat?: { rating: string; score: number }): ScoringAdditions {
  if (!enabled) return emptyScoringAdditions(false);
  const moatRivalry = evaluateMoatRivalryDamping({
    moatRating: moat?.rating ?? data.moatAssessment?.overallRating ?? data.moatRating ?? null,
    moatScore: moat?.score ?? null,
    porterForces: data.moatAssessment?.porterForces ?? null,
    description: `${data.description ?? ""} ${(data.moatAssessment?.moatSources ?? []).join(" ")}`,
  });
  return {
    enabled: true,
    hybrid: classifyHybrid({ segments: data.revenueSegments ?? null, fallbackClass: data.lynchClass ?? null }),
    moatRivalry,
    earningsYield: earningsYield({
      ebit: data.operatingIncome,
      marketCap: data.marketCap,
      totalDebt: data.totalDebt,
      cash: data.cashEquivalents,
      peerYieldsPct: null,
    }),
    accruals: accrualsRatio({
      netIncome: data.netIncome,
      operatingCashFlow: data.financialStatements?.cashFlow?.operatingCashFlow ?? null,
      history: null,
    }),
  };
}
