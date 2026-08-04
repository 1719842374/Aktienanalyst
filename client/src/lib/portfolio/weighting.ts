/**
 * Gewichtungsalgorithmen für den Basket — Virtuelles Portfolio
 * (WORK_PORTFOLIO.md Kapitel B).
 *
 * Drei Modi (§B.1):
 *   A) Max-Sharpe long-only:  w ∝ Σ⁻¹μ̃  (μ̃ = μ - rf), clip negativ → 0,
 *      renormieren auf Σw=1, dann maxWeight-Cap anwenden.
 *   B) Risk-Parity:           w_i ∝ 1/σ_i
 *   C) Score-Tilt:            Basis (Equal oder Risk-Parity) × (1 + κ·z(score)),
 *      κ = 0.35 Default — Brücke Scoring → Portfolio.
 *
 * Guards (§B.2):
 *   - long-only (keine negativen Endgewichte)
 *   - Σw = 1 (Renormierung nach jedem Schritt)
 *   - maxWeight ≈ 0.30 (Cap + Redistribution des Überschusses)
 *   - optional minWeight
 *   - Shrinkage bei kleiner n (hier: Diagonal-Shrinkage auf Σ vor Inversion)
 *   - n=1 → kein Basket, nur Kelly (siehe pickWeightMode/allocate)
 *
 * §B.3 Auto-Mode (pickWeightMode):
 *   n < 2                              → Kelly only
 *   n < 3 oder μ schwach oder Σ instabil → Risk-Parity
 *   μ hoch + Σ stabil                   → Max-Sharpe
 *   sonst                               → Score-Tilt
 */

export const DEFAULT_MAX_WEIGHT = 0.30;
export const DEFAULT_MIN_WEIGHT = 0; // kein Floor per Default
export const DEFAULT_KAPPA_SCORE_TILT = 0.35;

export type WeightMode = "A" | "B" | "C" | "kelly-only";

export interface WeightingInput {
  tickers: string[];
  mu: number[]; // annualisierte erwartete Rendite je Titel
  Sigma: number[][]; // annualisierte Kovarianzmatrix
  rf: number;
  scores?: number[]; // Scoring 0-100, für Modus C
  maxWeight?: number;
  minWeight?: number;
  kappa?: number; // Score-Tilt-Stärke
}

export interface WeightingResult {
  mode: WeightMode;
  weights: number[]; // Reihenfolge wie tickers
  notes: string[];
}

// ─── Hilfsfunktionen ───────────────────────────────────────────────────────

/** Klein-n-Shrinkage: zieht Σ diagonal-lastiger, um Inversions-Instabilität
 * bei wenigen Beobachtungen/Titeln zu dämpfen. Additive, konservative Wahl:
 * Σ_shrunk = (1-δ)·Σ + δ·diag(Σ). */
export function shrinkCovariance(Sigma: number[][], n: number): number[][] {
  const delta = n <= 2 ? 0.4 : n <= 4 ? 0.25 : n <= 8 ? 0.1 : 0;
  if (delta === 0) return Sigma;
  const m = Sigma.length;
  const out: number[][] = [];
  for (let i = 0; i < m; i++) {
    out.push([]);
    for (let j = 0; j < m; j++) {
      const diagVal = i === j ? Sigma[i][j] : 0;
      out[i][j] = (1 - delta) * Sigma[i][j] + delta * diagVal;
    }
  }
  return out;
}

/** Prüft, ob Σ als "stabil" gilt: symmetrisch-positiv im Diagonalsinn und
 * keine (nahezu) singuläre/degenerierte Struktur. Heuristik: alle
 * Diagonalvarianzen > floor, und Konditions-Proxy (max/min Diagonal) begrenzt. */
export function isSigmaStable(Sigma: number[][], floor = 1e-8): boolean {
  const n = Sigma.length;
  if (n === 0) return false;
  const diag = Sigma.map((row, i) => row[i]);
  if (diag.some((d) => !Number.isFinite(d) || d <= floor)) return false;
  const maxD = Math.max(...diag);
  const minD = Math.min(...diag);
  if (minD <= floor) return false;
  // Konditions-Proxy: Verhältnis Diagonalwerte nicht extrem (grobe Heuristik)
  if (maxD / minD > 1e4) return false;
  return true;
}

/** Prüft, ob μ insgesamt "schwach" ist relativ zu rf (kaum Excess-Return,
 * bzw. wechselnde Vorzeichen deuten auf schwache/unsichere Schätzung hin). */
export function isMuWeak(mu: number[], rf: number): boolean {
  if (mu.length === 0) return true;
  const excess = mu.map((m) => m - rf);
  const positiveCount = excess.filter((e) => e > 0).length;
  const meanExcess = excess.reduce((s, e) => s + e, 0) / excess.length;
  // Schwach, wenn im Schnitt kaum Excess-Return oder Mehrheit ohne positiven Excess
  return meanExcess < 0.02 || positiveCount < Math.ceil(mu.length / 2);
}

/** z-Score-Normalisierung eines Score-Vektors (Population-Std, Fallback 0 bei
 * Varianz 0 damit Score-Tilt nicht explodiert). */
export function zScore(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd < 1e-12) return values.map(() => 0);
  return values.map((v) => (v - mean) / sd);
}

/** long-only Clip: negative Gewichte auf 0. */
function clipLongOnly(w: number[]): number[] {
  return w.map((x) => Math.max(0, x));
}

/** Renormierung auf Summe 1. Bei Summe 0 (z.B. alles geclippt) → Equal-Weight-Fallback. */
export function renormalize(w: number[]): number[] {
  const sum = w.reduce((s, x) => s + x, 0);
  if (!Number.isFinite(sum) || Math.abs(sum) < 1e-12) {
    const n = w.length;
    return n > 0 ? Array(n).fill(1 / n) : [];
  }
  return w.map((x) => x / sum);
}

/** maxWeight-Cap mit iterativer Redistribution des Überschusses auf die
 * ungedeckelten Positionen, bis alle Gewichte ≤ maxWeight oder keine
 * Redistribution mehr möglich ist (dann gleichmäßig gecappt). */
export function applyMaxWeightCap(w: number[], maxWeight: number): number[] {
  let weights = [...w];
  const n = weights.length;
  if (n === 0) return weights;
  if (maxWeight * n < 1 - 1e-9) {
    // maxWeight zu klein für Σw=1 mit n Titeln → gleichmäßig verteilen (bestmöglich)
    return Array(n).fill(1 / n);
  }
  for (let iter = 0; iter < 50; iter++) {
    const overIdx: number[] = [];
    let overflow = 0;
    weights.forEach((x, i) => {
      if (x > maxWeight + 1e-12) {
        overflow += x - maxWeight;
        overIdx.push(i);
      }
    });
    if (overIdx.length === 0) break;
    overIdx.forEach((i) => (weights[i] = maxWeight));
    const underIdx = weights
      .map((x, i) => i)
      .filter((i) => !overIdx.includes(i) && weights[i] < maxWeight - 1e-12);
    if (underIdx.length === 0) {
      // Kann Überschuss nicht mehr verteilen → renormieren reicht
      weights = renormalize(weights);
      break;
    }
    const underSum = underIdx.reduce((s, i) => s + weights[i], 0);
    underIdx.forEach((i) => {
      const share = underSum > 1e-12 ? weights[i] / underSum : 1 / underIdx.length;
      weights[i] += overflow * share;
    });
  }
  return renormalize(weights);
}

/** minWeight-Floor (optional): Positionen unter minWeight werden auf 0
 * gesetzt (ausgeschlossen) und der Rest neu normiert. Konservativ, wird nur
 * angewendet wenn minWeight > 0 übergeben wird. */
export function applyMinWeightFloor(w: number[], minWeight: number): number[] {
  if (!minWeight || minWeight <= 0) return w;
  const filtered = w.map((x) => (x < minWeight ? 0 : x));
  return renormalize(filtered);
}

function guardWeights(w: number[], maxWeight: number, minWeight: number): number[] {
  let out = clipLongOnly(w);
  out = renormalize(out);
  out = applyMaxWeightCap(out, maxWeight);
  out = applyMinWeightFloor(out, minWeight);
  return out;
}

// ─── Matrix-Helfer (klein, nur für n×n mit kleinem n gedacht) ──────────────

function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length;
  // Augmented [A | I]
  const M = A.map((row, i) => [
    ...row,
    ...Array(n)
      .fill(0)
      .map((_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col++) {
    // Pivot suchen
    let pivotRow = col;
    let maxAbs = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > maxAbs) {
        maxAbs = Math.abs(M[r][col]);
        pivotRow = r;
      }
    }
    if (maxAbs < 1e-12) return null; // singulär
    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }
    const pivotVal = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= pivotVal;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  return M.map((row) => row.slice(n));
}

function matVec(A: number[][], v: number[]): number[] {
  return A.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
}

// ─── Modus A: Max-Sharpe long-only ─────────────────────────────────────────

export function weightMaxSharpe(opts: {
  mu: number[];
  Sigma: number[][];
  rf: number;
  maxWeight?: number;
  minWeight?: number;
}): number[] {
  const n = opts.mu.length;
  const maxWeight = opts.maxWeight ?? DEFAULT_MAX_WEIGHT;
  const minWeight = opts.minWeight ?? DEFAULT_MIN_WEIGHT;
  const SigmaShrunk = shrinkCovariance(opts.Sigma, n);
  const muExcess = opts.mu.map((m) => m - opts.rf);
  const inv = invertMatrix(SigmaShrunk);
  let raw: number[];
  if (!inv) {
    // Fallback bei Singularität: Equal-Weight als Basis
    raw = Array(n).fill(1 / n);
  } else {
    raw = matVec(inv, muExcess);
  }
  return guardWeights(raw, maxWeight, minWeight);
}

// ─── Modus B: Risk-Parity (w_i ∝ 1/σ_i) ────────────────────────────────────

export function weightRiskParity(opts: {
  Sigma: number[][];
  maxWeight?: number;
  minWeight?: number;
}): number[] {
  const n = opts.Sigma.length;
  const maxWeight = opts.maxWeight ?? DEFAULT_MAX_WEIGHT;
  const minWeight = opts.minWeight ?? DEFAULT_MIN_WEIGHT;
  const raw = opts.Sigma.map((row, i) => {
    const sigma = Math.sqrt(Math.max(row[i], 0));
    return sigma < 1e-12 ? 0 : 1 / sigma;
  });
  return guardWeights(raw, maxWeight, minWeight);
}

// ─── Modus C: Score-Tilt ────────────────────────────────────────────────────

export function weightScoreTilt(opts: {
  scores: number[];
  base?: number[]; // Basisgewichte (Equal oder Risk-Parity); default Equal
  kappa?: number;
  maxWeight?: number;
  minWeight?: number;
}): number[] {
  const n = opts.scores.length;
  const kappa = opts.kappa ?? DEFAULT_KAPPA_SCORE_TILT;
  const maxWeight = opts.maxWeight ?? DEFAULT_MAX_WEIGHT;
  const minWeight = opts.minWeight ?? DEFAULT_MIN_WEIGHT;
  const base = opts.base ?? Array(n).fill(1 / n);
  const z = zScore(opts.scores);
  const raw = base.map((b, i) => b * (1 + kappa * z[i]));
  return guardWeights(raw, maxWeight, minWeight);
}

// ─── §B.3 Auto-Mode: pickWeightMode ────────────────────────────────────────

export function pickWeightMode(opts: {
  n: number;
  mu: number[];
  Sigma: number[][];
  rf: number;
}): WeightMode {
  const { n, mu, Sigma, rf } = opts;
  if (n < 2) return "kelly-only";
  const sigmaStable = isSigmaStable(Sigma);
  const muWeak = isMuWeak(mu, rf);
  if (n < 3 || muWeak || !sigmaStable) return "B";
  const muHigh = !muWeak; // μ hoch + Σ stabil (Umkehrung der "schwach"-Bedingung)
  if (muHigh && sigmaStable) return "A";
  return "C";
}

// ─── Zusammenführende allocate()-Funktion ──────────────────────────────────

export function allocate(input: WeightingInput): WeightingResult {
  const n = input.tickers.length;
  const maxWeight = input.maxWeight ?? DEFAULT_MAX_WEIGHT;
  const minWeight = input.minWeight ?? DEFAULT_MIN_WEIGHT;
  const notes: string[] = [];

  if (n === 1) {
    notes.push("n=1 → kein Basket-Optimierer, nur Kelly (§B.2/§D.4).");
    return { mode: "kelly-only", weights: [1], notes };
  }
  if (n === 0) {
    return { mode: "kelly-only", weights: [], notes: ["Keine Kandidaten."] };
  }

  const mode = pickWeightMode({ n, mu: input.mu, Sigma: input.Sigma, rf: input.rf });

  let weights: number[];
  switch (mode) {
    case "A":
      weights = weightMaxSharpe({ mu: input.mu, Sigma: input.Sigma, rf: input.rf, maxWeight, minWeight });
      notes.push("Modus A: Max-Sharpe long-only (w ∝ Σ⁻¹μ̃).");
      break;
    case "B":
      weights = weightRiskParity({ Sigma: input.Sigma, maxWeight, minWeight });
      notes.push("Modus B: Risk-Parity (w_i ∝ 1/σ_i).");
      break;
    case "C": {
      const base = weightRiskParity({ Sigma: input.Sigma, maxWeight: 1, minWeight: 0 });
      weights = weightScoreTilt({
        scores: input.scores ?? Array(n).fill(50),
        base,
        kappa: input.kappa,
        maxWeight,
        minWeight,
      });
      notes.push("Modus C: Score-Tilt auf Risk-Parity-Basis.");
      break;
    }
    case "kelly-only":
    default:
      weights = Array(n).fill(1 / n);
      notes.push("Kelly-only Fallback (n<2) — sollte hier wegen n≥2-Check nicht auftreten.");
      break;
  }

  return { mode, weights, notes };
}
