/**
 * Efficient-Frontier-Berechnung — Phase 5 (WORK_RESEARCHER_PORTFOLIO_TEIL2
 * Kapitel N, PORTFOLIO_PHASE5_FRONTIER.md).
 *
 * Reine, Netzwerk-freie Berechnungsfunktion (wie covariance.ts/weighting.ts):
 * nimmt Ticker + erwartete Renditen + Kovarianzmatrix entgegen und liefert
 * eine long-only Effizienzlinie (Σw=1, w_i≥0) als Menge von (Risiko,
 * Rendite)-Punkten samt zugehöriger Gewichte.
 *
 * ─── Gewählter Lösungsansatz: ANALYTISCH (Lagrange) + long-only Projektion ───
 *
 * Für JEDE Ziel-Rendite `targetReturn` (numPoints Stützstellen zwischen
 * min(erwartete Rendite) und max(erwartete Rendite)) wird zunächst das
 * KLASSISCHE Minimum-Varianz-Problem OHNE Ungleichheitsnebenbedingungen
 * (nur Σw=1 und w'μ=targetReturn) analytisch über die Kovarianzmatrix-
 * Inversion gelöst (Lagrange-Multiplikator-Methode, geschlossene Form mit
 * den Hilfsgrößen A=1'Σ⁻¹1, B=1'Σ⁻¹μ, C=μ'Σ⁻¹μ). Das ist derselbe
 * Invertierungs-Baustein, den weighting.ts für Modus A (Max-Sharpe) bereits
 * nutzt (Σ⁻¹ existiert dort intern, ist aber nicht exportiert — hier lokal
 * neu implementiert, da es sich um eine kleine, in sich geschlossene n×n-
 * Operation handelt und keine Abhängigkeit zu weighting.ts eingeführt werden
 * soll, siehe Regression-Guard "nur additive Änderungen").
 *
 * Diese geschlossene Lösung kann NEGATIVE Gewichte enthalten (Shorts), was
 * das Ticket explizit ausschließt ("keine Shorts", w_i≥0). Deshalb wird die
 * analytische Lösung anschließend long-only projiziert: negative Gewichte
 * werden auf 0 geklippt und der Rest auf Σw=1 renormiert (dieselbe, bereits
 * im Repo etablierte Strategie wie `clipLongOnly`/`renormalize` in
 * weighting.ts — hier lokal dupliziert, um frontier.ts als eigenständiges,
 * von weighting.ts unabhängiges Modul zu halten). Das ist eine bewusste
 * Vereinfachung (keine vollständige Quadratic-Programming-Lösung mit
 * exakten KKT-Bedingungen für die Ungleichheits-Constraints) — für die
 * Visualisierung einer *Näherungs*-Effizienzlinie im UI ist das robust und
 * schnell genug (kein iterativer QP-Solver, keine neue Dependency).
 *
 * Fallback: schlägt die Matrix-Inversion fehl (singuläre/instabile Σ, z.B.
 * bei extremer Kollinearität), wird NICHT geraten — für diese Zielrendite
 * wird kein Punkt erzeugt. Bleiben am Ende zu wenige valide Punkte übrig
 * (< 2), wird ein leeres Array zurückgegeben (Zahlen-Prinzip: kein Crash,
 * keine Platzhalterdaten).
 */

export interface FrontierPoint {
  risk: number; // annualisierte Portfolio-Volatilität (Std.-Abw.)
  return: number; // annualisierte erwartete Portfolio-Rendite
  weights: Record<string, number>; // Ticker -> Gewicht (Σ=1, w_i≥0)
  sharpe: number; // (return - riskFreeRate) / risk, NaN-sicher (0 wenn risk=0)
}

/** Kleine n×n-Matrixinversion (Gauß-Jordan mit Partial Pivoting). Lokal in
 * frontier.ts gehalten (siehe Modul-Kommentar oben) statt aus weighting.ts
 * importiert, da dort nicht exportiert und um frontier.ts unabhängig zu
 * halten. Gibt `null` bei (nahezu) Singularität zurück -- kein Raten. */
function invertMatrixLocal(A: number[][]): number[][] | null {
  const n = A.length;
  if (n === 0) return null;
  const M = A.map((row, i) => [
    ...row,
    ...Array(n).fill(0).map((_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > maxAbs) {
        maxAbs = Math.abs(M[r][col]);
        pivotRow = r;
      }
    }
    if (maxAbs < 1e-12) return null; // singulär -- kein Raten
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
  return M.map(row => row.slice(n));
}

function matVec(A: number[][], v: number[]): number[] {
  return A.map(row => row.reduce((s, a, j) => s + a * v[j], 0));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

/** long-only Projektion: negative Gewichte -> 0, dann auf Σw=1 renormieren.
 * Bei Summe 0 (z.B. alle Gewichte negativ geclippt) wird `null` zurückgegeben
 * (kein Equal-Weight-Rateergebnis für einen einzelnen Frontier-Punkt --
 * dieser Punkt wird dann übersprungen, siehe computeEfficientFrontier). */
function projectLongOnly(w: number[]): number[] | null {
  const clipped = w.map(x => Math.max(0, x));
  const sum = clipped.reduce((s, x) => s + x, 0);
  if (!Number.isFinite(sum) || sum < 1e-12) return null;
  return clipped.map(x => x / sum);
}

function portfolioRisk(w: number[], covMatrix: number[][]): number {
  const variance = dot(w, matVec(covMatrix, w));
  return Math.sqrt(Math.max(variance, 0));
}

function portfolioReturn(w: number[], mu: number[]): number {
  return dot(w, mu);
}

/**
 * Berechnet eine long-only Efficient Frontier über Minimum-Varianz-Punkte
 * für `numPoints` Ziel-Renditen zwischen min(mu) und max(mu).
 *
 * @param tickers Ticker-Liste, Reihenfolge muss zu expectedReturns/covMatrix passen
 * @param expectedReturns annualisierte erwartete Rendite je Ticker (z.B. historisches
 *   μ aus covariance.ts -- dieselbe Quelle, die engine.ts/weighting.ts bereits für
 *   die CAPM-Optimierung verwendet, siehe EngineRow.mu)
 * @param covMatrix annualisierte Kovarianzmatrix (aus covariance.ts buildCovariance().Sigma)
 * @param riskFreeRate für die Sharpe-Ratio je Frontier-Punkt
 * @param numPoints Anzahl Stützstellen (default 30)
 */
export function computeEfficientFrontier(
  tickers: string[],
  expectedReturns: Record<string, number>,
  covMatrix: number[][],
  riskFreeRate: number,
  numPoints: number = 30,
): FrontierPoint[] {
  const n = tickers.length;
  if (n < 3) return []; // Ticket: "Mindestens 3 Ticker für eine sinnvolle Effizienzlinie"
  if (covMatrix.length !== n || covMatrix.some(row => row.length !== n)) return [];

  const mu = tickers.map(t => expectedReturns[t]);
  if (mu.some(m => m == null || !Number.isFinite(m))) return []; // kein Raten bei fehlendem μ
  if (covMatrix.some(row => row.some(v => !Number.isFinite(v)))) return [];

  const SigmaInv = invertMatrixLocal(covMatrix);
  if (!SigmaInv) return []; // Solver-Fehler -- leer statt Platzhalter (Zahlen-Prinzip)

  const ones = Array(n).fill(1);
  const SigmaInvOnes = matVec(SigmaInv, ones);
  const SigmaInvMu = matVec(SigmaInv, mu);

  const A = dot(ones, SigmaInvOnes); // 1'Σ⁻¹1
  const B = dot(ones, SigmaInvMu); // 1'Σ⁻¹μ = μ'Σ⁻¹1
  const C = dot(mu, SigmaInvMu); // μ'Σ⁻¹μ
  const D = A * C - B * B;
  if (!Number.isFinite(D) || Math.abs(D) < 1e-12 || !Number.isFinite(A) || Math.abs(A) < 1e-12) {
    return []; // degenerierte Lagrange-Lösung -- nicht raten
  }

  const minMu = Math.min(...mu);
  const maxMu = Math.max(...mu);
  const points: FrontierPoint[] = [];
  const seenKeys = new Set<string>();
  const safeNumPoints = Math.max(2, Math.floor(numPoints));

  for (let i = 0; i < safeNumPoints; i++) {
    const targetReturn = minMu + ((maxMu - minMu) * i) / (safeNumPoints - 1);

    // Lagrange-Lösung des Minimum-Varianz-Problems bei gegebenem targetReturn:
    // w* = λ·Σ⁻¹1 + γ·Σ⁻¹μ, mit λ,γ aus den beiden linearen Constraints
    // (1'w=1, μ'w=targetReturn) über die 2x2-Hilfsmatrix [[A,B],[B,C]].
    const lambda = (C - B * targetReturn) / D;
    const gamma = (A * targetReturn - B) / D;
    const wRaw = SigmaInvOnes.map((v, idx) => lambda * v + gamma * SigmaInvMu[idx]);

    const wLongOnly = projectLongOnly(wRaw);
    if (!wLongOnly) continue; // dieser Punkt nicht darstellbar long-only -- überspringen, nicht raten

    const risk = portfolioRisk(wLongOnly, covMatrix);
    const ret = portfolioReturn(wLongOnly, mu);
    if (!Number.isFinite(risk) || !Number.isFinite(ret)) continue;

    // Duplikate (z.B. wenn Projektion mehrere Zielrenditen auf denselben
    // Randpunkt der long-only-Region abbildet) anhand gerundeter (risk,return)
    // ausfiltern, damit die Kurve im Chart nicht "zurückspringt".
    const key = `${risk.toFixed(6)}_${ret.toFixed(6)}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const weights: Record<string, number> = {};
    tickers.forEach((t, idx) => { weights[t] = wLongOnly[idx]; });

    const sharpe = risk > 1e-12 ? (ret - riskFreeRate) / risk : 0;
    points.push({ risk, return: ret, weights, sharpe });
  }

  // Nach Risiko sortieren, damit die Recharts-Linie eine monotone, saubere
  // Kurve statt eines Zickzacks zeichnet.
  points.sort((a, b) => a.risk - b.risk);

  if (points.length < 2) return []; // zu wenige valide Punkte -- leerer Zustand statt Fragment

  return points;
}

/** Hilfsfunktion für Referenzpunkte (Ist/CAPM-Ziel/Equal-Weight): berechnet
 * Risiko+Rendite für einen gegebenen Gewichtsvektor (muss dieselbe
 * Ticker-Reihenfolge wie covMatrix/expectedReturns haben). Reine Funktion,
 * additiv nutzbar von EfficientFrontierPanel.tsx für die drei Marker. */
export function computePortfolioPoint(
  tickers: string[],
  weights: Record<string, number>,
  expectedReturns: Record<string, number>,
  covMatrix: number[][],
  riskFreeRate: number,
): { risk: number; return: number; sharpe: number } | null {
  const n = tickers.length;
  if (n === 0 || covMatrix.length !== n) return null;
  const w = tickers.map(t => weights[t] ?? 0);
  const mu = tickers.map(t => expectedReturns[t]);
  if (mu.some(m => m == null || !Number.isFinite(m))) return null;
  const sumW = w.reduce((s, x) => s + x, 0);
  if (!Number.isFinite(sumW) || Math.abs(sumW - 1) > 1e-6) return null; // kein Raten bei unvollständigen Gewichten
  const risk = portfolioRisk(w, covMatrix);
  const ret = portfolioReturn(w, mu);
  if (!Number.isFinite(risk) || !Number.isFinite(ret)) return null;
  const sharpe = risk > 1e-12 ? (ret - riskFreeRate) / risk : 0;
  return { risk, return: ret, sharpe };
}
