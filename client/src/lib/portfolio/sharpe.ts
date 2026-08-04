/**
 * Sharpe-Ratio — Virtuelles Portfolio (WORK_PORTFOLIO.md Kapitel C).
 *
 * Wortgetreue Übernahme des Referenz-Codes aus §C.2 der Spezifikation.
 * NICHT umschreiben — nur ans Dateiende weitere Funktionen anhängen, falls
 * künftig benötigt (siehe Repo-Regel für additive Erweiterungen).
 *
 * §C.3 Annualisierung:
 *   Daily returns  → μ ×252, Σ ×252, Sharpe NICHT nochmal ×√252
 *   Monthly returns → μ ×12,  Σ ×12,  ebenso
 *   Regel: Sharpe wird aus BEREITS annualisierten μ und Σ berechnet — die
 *   Funktionen hier nehmen das als Eingabe-Kontrakt an und skalieren selbst
 *   nichts nach.
 *
 * §C.4 Numerische Stabilität (siehe auch Checkliste dort):
 *   1. Σ symmetrisieren: Σ ← (Σ+Σ')/2                      (Aufrufer-Pflicht,
 *      vor Übergabe an diese Funktionen — hier nicht implizit erzwungen)
 *   2. falls min Eigenwert < ε → Ledoit-Wolf oder Σ ← Σ + εI (Aufrufer-Pflicht)
 *   3. vol < 1e-12 → Sharpe null (nicht Inf)                 (hier: sharpeRatio)
 *   4. Gewichte vor Sharpe auf Summe 1 prüfen (|Σw−1| > 1e-6 → renorm)
 *      (Guard liegt in weighting.ts / Aufrufer — sharpeRatio selbst nimmt w
 *      wie übergeben)
 */

export function portfolioVariance(w: number[], Sigma: number[][]): number {
  let v = 0;
  const n = w.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      v += w[i] * Sigma[i][j] * w[j];
  return Math.max(v, 0);
}

export function portfolioVol(w: number[], Sigma: number[][]): number {
  return Math.sqrt(portfolioVariance(w, Sigma));
}

export function portfolioMean(w: number[], mu: number[]): number {
  return w.reduce((s, wi, i) => s + wi * mu[i], 0);
}

export function sharpeRatio(
  w: number[],
  mu: number[],
  Sigma: number[][],
  rf: number
): number | null {
  const vol = portfolioVol(w, Sigma);
  if (vol < 1e-12) return null;
  return (portfolioMean(w, mu) - rf) / vol;
}

export function sharpeReport(opts: {
  w: number[];
  mu: number[];
  Sigma: number[][];
  rf: number;
}): {
  sharpePortfolio: number | null;
  sharpeEqualWeight: number | null;
  deltaVsEqual: number | null;
  sharpeSingle: (number | null)[];
  muP: number;
  sigmaP: number;
} {
  const n = opts.w.length;
  const eq = Array(n).fill(1 / n);
  const sharpePortfolio = sharpeRatio(opts.w, opts.mu, opts.Sigma, opts.rf);
  const sharpeEqualWeight = sharpeRatio(eq, opts.mu, opts.Sigma, opts.rf);
  const sharpeSingle = opts.mu.map((m, i) => {
    const sig = Math.sqrt(Math.max(opts.Sigma[i][i], 0));
    return sig < 1e-12 ? null : (m - opts.rf) / sig;
  });
  const deltaVsEqual =
    sharpePortfolio != null && sharpeEqualWeight != null
      ? sharpePortfolio - sharpeEqualWeight
      : null;
  return {
    sharpePortfolio,
    sharpeEqualWeight,
    deltaVsEqual,
    sharpeSingle,
    muP: portfolioMean(opts.w, opts.mu),
    sigmaP: portfolioVol(opts.w, opts.Sigma),
  };
}
