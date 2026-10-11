/**
 * Adaptive Aktien-Scoring (Philips Vorschlag, Future_8 / Future_Work "adaptive Logik").
 *
 * Jeder Block liefert ein Signal { id, direction 1|-1|0, strength 0..1 }.
 * Stärke = toStrength(z) = min(1, |z| / 2.5) aus einem z-Score, oder direkt aus
 * gewichteten Bedingungen (Technical). Fehlt die Datengrundlage → available=false
 * („n/a“), es wird nichts geraten.
 *
 * Gewicht je Block: w = BASE + strength * SLOPE (0.8 + s*0.7), keine festen 1.6/1.4.
 * Valuation-Dämpfung: bei techStrength > 0.5 gilt w_val *= (1 - techStrength * damping).
 * Score = net / max = Σ w·d·s / Σ w  ∈ [-1, 1] (nur verfügbare Blöcke).
 *
 * Reine Anzeige-/Fazit-Logik. Altes Rating und alter Signal-Score bleiben unverändert;
 * adaptiveScore ist ein zusätzliches Feld (Breaking-Change-Schutz).
 */

export type SignalDirection = 1 | -1 | 0;

export interface AdaptiveSignal {
  id: "technical" | "valuation" | "momentum" | "moat" | "beta";
  label: string;
  direction: SignalDirection;
  strength: number;
  available: boolean;
  /** z-Score bzw. Rohwert, sofern vorhanden (Transparenz). */
  z: number | null;
  basis: string;
}

export interface AdaptiveWeightedSignal extends AdaptiveSignal {
  weight: number;
  /** w · d · s */
  contribution: number;
  damped: boolean;
}

export interface AdaptiveScoreResult {
  /** net / max, gerundet auf 3 Stellen, -1..1. null wenn kein Block verfügbar. */
  score: number | null;
  /** score auf 0..100 skaliert ((score+1)/2*100). */
  score100: number | null;
  rating: string;
  net: number;
  max: number;
  techStrength: number;
  damping: number;
  signals: AdaptiveWeightedSignal[];
  label: "adaptiv";
}

// ─── Config ───────────────────────────────────────────────────────────────────
export const ADAPTIVE_CONFIG = {
  /** w = WEIGHT_BASE + strength * WEIGHT_SLOPE */
  WEIGHT_BASE: 0.8,
  WEIGHT_SLOPE: 0.7,
  /** Startwert; Kalibrierung über script/calibrate-damping.ts (Grid 0.2–0.6). Nicht ohne Backtest ändern. */
  VALUATION_DAMPING: 0.4,
  DAMPING_TECH_THRESHOLD: 0.5,
  /** z-Divisor für toStrength */
  Z_SATURATION: 2.5,
  /** Low-Beta-Regel */
  LOW_BETA: 0.7,
  LOW_BETA_TECH_THRESHOLD: 0.6,
  LOW_BETA_STRENGTH: 0.3,
  /** Technical-Gewichte der Bedingungen (Summe 1.0) */
  TECH_WEIGHTS: { deathCross: 0.4, belowMA200: 0.3, macdNegative: 0.2, rslBelow100: 0.1 },
  /** Rollierendes Fenster für eigene Historie (Handelstage): min 2 J, max 5 J */
  MIN_HISTORY_DAYS: 504,
  MAX_HISTORY_DAYS: 1260,
  MIN_PEERS: 3,
  /** Rating-Schwellen auf score (-1..1). Display-Schwellen, kein Backtest-Ergebnis. */
  RATING_THRESHOLDS: { attraktiv: 0.4, leicht: 0.15, neutralLow: -0.15, unattraktiv: -0.4 },
} as const;

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function toStrength(z: number): number {
  if (!fin(z)) return 0;
  return Math.min(1, Math.abs(z) / ADAPTIVE_CONFIG.Z_SATURATION);
}

const dirOf = (x: number): SignalDirection => (x > 0 ? 1 : x < 0 ? -1 : 0);

function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

const na = (id: AdaptiveSignal["id"], label: string, basis: string): AdaptiveSignal =>
  ({ id, label, direction: 0, strength: 0, available: false, z: null, basis });

// ─── Loose input (alte Cache-Einträge können Felder nicht haben) ─────────────
export interface AdaptiveSource {
  currentPrice?: number | null;
  beta5Y?: number | null;
  peRatio?: number | null;
  historicalPrices?: Array<{ date: string; close: number }> | null;
  technicalIndicators?: { currentStatus?: {
    priceAboveMA200?: boolean; ma50AboveMA200?: boolean; macdAboveZero?: boolean;
    ma200Value?: number; ma50Value?: number; macdValue?: number;
  } | null } | null;
  peerComparison?: { subject?: { pe?: number | null } | null; peers?: Array<{ pe?: number | null }> | null } | null;
  moatAssessment?: { overallRating?: string; porterForces?: Array<{ score?: number }> | null } | null;
}

function sortedCloses(data: AdaptiveSource): number[] {
  const hp = Array.isArray(data.historicalPrices) ? data.historicalPrices : [];
  return [...hp]
    .filter(p => p && fin(p.close) && p.close > 0 && typeof p.date === "string")
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(p => p.close);
}

/** RSL = Kurs / Ø 26 Wochen (130 Handelstage) × 100 — wie calculateRSL. null ohne 130 Punkte. */
export function rslFromHistory(data: AdaptiveSource): number | null {
  const closes = sortedCloses(data);
  if (closes.length < 130) return null;
  const last = fin(data.currentPrice) && data.currentPrice! > 0 ? data.currentPrice! : closes[closes.length - 1];
  const avg = mean(closes.slice(-130));
  return avg > 0 ? (last / avg) * 100 : null;
}

// ─── Blöcke ────────────────────────────────────────────────────────────────
/** Technical: Death Cross 0.4, Kurs<MA200 0.3, MACD<0 0.2, RSL<100 0.1. net = bull − bear. */
export function technicalSignal(data: AdaptiveSource): AdaptiveSignal {
  const cs = data.technicalIndicators?.currentStatus;
  const label = "Technical";
  if (!cs) return na("technical", label, "keine technischen Indikatoren");
  const W = ADAPTIVE_CONFIG.TECH_WEIGHTS;
  const rsl = rslFromHistory(data);
  const conds: Array<{ w: number; bear: boolean | null }> = [
    { w: W.deathCross, bear: typeof cs.ma50AboveMA200 === "boolean" ? !cs.ma50AboveMA200 : null },
    { w: W.belowMA200, bear: typeof cs.priceAboveMA200 === "boolean" ? !cs.priceAboveMA200 : null },
    { w: W.macdNegative, bear: typeof cs.macdAboveZero === "boolean" ? !cs.macdAboveZero : null },
    { w: W.rslBelow100, bear: rsl == null ? null : rsl < 100 },
  ];
  const avail = conds.filter(c => c.bear !== null);
  if (avail.length === 0) return na("technical", label, "keine technischen Indikatoren");
  const wSum = avail.reduce((s, c) => s + c.w, 0);
  // fehlende Bedingung → Gewichte auf vorhandene renormiert (kein Raten)
  const net = avail.reduce((s, c) => s + (c.bear ? -c.w : c.w), 0) / wSum;
  return {
    id: "technical", label, direction: dirOf(net), strength: Math.min(1, Math.abs(net)), available: true, z: null,
    basis: `Death Cross 0.4 · Kurs<MA200 0.3 · MACD<0 0.2 · RSL<100 0.1${rsl == null ? " (RSL n/a, renormiert)" : ` (RSL ${rsl.toFixed(1)})`}`,
  };
}

/** Valuation: z des KGV gegen die Peer-Verteilung (günstiger als Peers → +). ≥3 Peers, sonst n/a. */
export function valuationSignal(data: AdaptiveSource): AdaptiveSignal {
  const label = "Valuation (KGV vs. Peers)";
  const subj = data.peerComparison?.subject?.pe ?? data.peRatio;
  const peers = (data.peerComparison?.peers ?? []).map(p => p?.pe).filter((v): v is number => fin(v) && v > 0);
  if (!fin(subj) || subj <= 0) return na("valuation", label, "KGV n/a oder negativ");
  if (peers.length < ADAPTIVE_CONFIG.MIN_PEERS) return na("valuation", label, `nur ${peers.length} Peers mit KGV (<${ADAPTIVE_CONFIG.MIN_PEERS})`);
  const s = sd(peers);
  if (!(s > 0)) return na("valuation", label, "Peer-Streuung 0");
  const z = (mean(peers) - subj) / s;
  return { id: "valuation", label, direction: dirOf(z), strength: toStrength(z), available: true, z,
    basis: `KGV ${subj.toFixed(1)} vs. Peers Ø ${mean(peers).toFixed(1)} (σ ${s.toFixed(1)}, n=${peers.length})` };
}

/**
 * Momentum: z der aktuellen 12M-Rendite gegen die eigene Historie rollierender 12M-Renditen
 * (Fenster 2–5 Jahre). Unter 2 Jahren Historie → n/a.
 */
export function momentumSignal(data: AdaptiveSource): AdaptiveSignal {
  const label = "Momentum (12M vs. eigene Historie)";
  const closes = sortedCloses(data);
  const C = ADAPTIVE_CONFIG;
  const LAG = 252;
  if (closes.length < C.MIN_HISTORY_DAYS + LAG) return na("momentum", label, `Historie < 2 J + 12M (${closes.length} Punkte)`);
  const window = closes.slice(-(Math.min(C.MAX_HISTORY_DAYS, closes.length - LAG) + LAG));
  const rets: number[] = [];
  for (let i = LAG; i < window.length; i++) rets.push(window[i] / window[i - LAG] - 1);
  const cur = rets[rets.length - 1];
  const s = sd(rets);
  if (!(s > 0)) return na("momentum", label, "Streuung 0");
  const z = (cur - mean(rets)) / s;
  const years = (window.length - LAG) / 252;
  return { id: "momentum", label, direction: dirOf(z), strength: toStrength(z), available: true, z,
    basis: `12M ${(cur * 100).toFixed(1)}% vs. Ø ${(mean(rets) * 100).toFixed(1)}% (σ ${(s * 100).toFixed(1)}%, ${years.toFixed(1)} J rollierend)` };
}

/**
 * Moat: normalisierter z-Score der Porter-Bedrohung (1 = gering, 5 = hoch) gegen den Skalen-
 * Mittelpunkt 3, normiert mit σ der Gleichverteilung auf 1..5 (√2). Geringe Bedrohung → +.
 */
export function moatSignal(data: AdaptiveSource): AdaptiveSignal {
  const label = "Moat (Porter-Bedrohung)";
  const scores = (data.moatAssessment?.porterForces ?? []).map(p => p?.score).filter((v): v is number => fin(v) && v >= 1 && v <= 5);
  if (scores.length < 3) return na("moat", label, `nur ${scores.length} Porter-Kräfte bewertet`);
  const m = mean(scores);
  const z = (3 - m) / Math.SQRT2;
  return { id: "moat", label, direction: dirOf(z), strength: toStrength(z), available: true, z,
    basis: `Ø Bedrohung ${m.toFixed(2)}/5 (n=${scores.length}), Rating ${data.moatAssessment?.overallRating ?? "n/a"}` };
}

/**
 * Low-Beta zählt nicht mehr automatisch als Plus. Beta < 0.7: neutral, außer techStrength > 0.6
 * bei bärischem Technical → direction -1, strength 0.3 (Falling-Knife-Schutz).
 * Beta ≥ 0.7: kein Beitrag (neutral). Kein Beta → n/a.
 */
export function betaSignal(data: AdaptiveSource, tech: AdaptiveSignal): AdaptiveSignal {
  const label = "Low-Beta";
  const C = ADAPTIVE_CONFIG;
  if (!fin(data.beta5Y)) return na("beta", label, "Beta n/a");
  const b = data.beta5Y;
  if (b < C.LOW_BETA && tech.available && tech.direction === -1 && tech.strength > C.LOW_BETA_TECH_THRESHOLD) {
    return { id: "beta", label, direction: -1, strength: C.LOW_BETA_STRENGTH, available: true, z: b,
      basis: `Beta ${b.toFixed(2)} < ${C.LOW_BETA}, Technical bärisch ${tech.strength.toFixed(2)} > ${C.LOW_BETA_TECH_THRESHOLD} → kein Schutz` };
  }
  return { id: "beta", label, direction: 0, strength: 0, available: true, z: b,
    basis: b < C.LOW_BETA ? `Beta ${b.toFixed(2)} < ${C.LOW_BETA} — kein automatisches Plus` : `Beta ${b.toFixed(2)} — neutral` };
}

export function buildAdaptiveSignals(data: AdaptiveSource): AdaptiveSignal[] {
  const tech = technicalSignal(data);
  return [tech, valuationSignal(data), momentumSignal(data), moatSignal(data), betaSignal(data, tech)];
}

export function ratingFromAdaptive(score: number | null): string {
  if (score == null) return "n/a";
  const T = ADAPTIVE_CONFIG.RATING_THRESHOLDS;
  if (score >= T.attraktiv) return "ATTRAKTIV";
  if (score >= T.leicht) return "LEICHT ATTRAKTIV";
  if (score > T.neutralLow) return "NEUTRAL";
  if (score > T.unattraktiv) return "UNATTRAKTIV";
  return "STARK UNATTRAKTIV";
}

/** net/max mit dynamischen Gewichten und Valuation-Dämpfung. */
export function computeAdaptiveScore(
  signals: AdaptiveSignal[],
  damping: number = ADAPTIVE_CONFIG.VALUATION_DAMPING,
): AdaptiveScoreResult {
  const C = ADAPTIVE_CONFIG;
  const tech = signals.find(s => s.id === "technical");
  const techStrength = tech?.available ? tech.strength : 0;
  const weighted: AdaptiveWeightedSignal[] = signals.map(s => {
    let weight = s.available ? C.WEIGHT_BASE + s.strength * C.WEIGHT_SLOPE : 0;
    let damped = false;
    if (s.available && s.id === "valuation" && techStrength > C.DAMPING_TECH_THRESHOLD) {
      weight *= 1 - techStrength * damping;
      damped = true;
    }
    return { ...s, weight, damped, contribution: weight * s.direction * s.strength };
  });
  // Beta ist eine Regel, keine Messung: neutral (0) = keine Aussage → verwässert max nicht.
  const avail = weighted.filter(s => s.available && !(s.id === "beta" && s.direction === 0));
  for (const s of weighted) if (s.id === "beta" && s.direction === 0) { s.weight = 0; s.contribution = 0; }
  const net = avail.reduce((a, s) => a + s.contribution, 0);
  const max = avail.reduce((a, s) => a + s.weight, 0);
  const score = max > 0 ? Math.round((net / max) * 1000) / 1000 : null;
  return {
    score,
    score100: score == null ? null : Math.round(((score + 1) / 2) * 1000) / 10,
    rating: ratingFromAdaptive(score),
    net, max, techStrength, damping, signals: weighted, label: "adaptiv",
  };
}

export function adaptiveScoreFromAnalysis(data: AdaptiveSource | null | undefined, damping?: number): AdaptiveScoreResult {
  return computeAdaptiveScore(buildAdaptiveSignals(data ?? {}), damping);
}
