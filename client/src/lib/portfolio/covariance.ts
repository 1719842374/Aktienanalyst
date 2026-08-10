/**
 * Kovarianzmatrix aus historischen Preisen — Virtuelles Portfolio.
 *
 * Auftrag 10.08.2026 ("Portfolio-Engine – eine Optimierung ab 2 Positionen
 * (Kovarianz + CAPM/Kelly)", Teil 1, PFLICHT).
 *
 * Root-Problem, das dieses Modul löst: `weightMaxSharpe()` in weighting.ts
 * implementiert bereits echtes w ∝ Σ⁻¹μ̃ (KEIN Diagonal-Bug) — aber es gab
 * bisher keine Funktion, die Σ tatsächlich AUS DEN ECHTEN PORTFOLIO-
 * POSITIONEN berechnet. Die manuellen "Kandidaten" (PortfolioPage.tsx Section
 * 4) übergaben stattdessen eine künstliche Diagonalmatrix (unkorreliert
 * angenommen) mit ähnlichen μ/σ -- das erklärt die beobachteten
 * 33,3%/33,3%/33,3%-Equal-Weight-Ergebnisse: bei echter Unkorreliertheit UND
 * ähnlichem μ/σ ist Equal-Weight tatsächlich nahe am Max-Sharpe-Optimum,
 * nicht weil die Formel falsch ist, sondern weil die Eingabedaten synthetisch
 * und entkoppelt von den echten Investments-Positionen waren.
 *
 * Dieses Modul schließt genau diese Lücke: Historie der Portfolio-Ticker →
 * aligned Returns → Sample-Kovarianz → Ridge-Stabilisierung.
 *
 * EXPLIZIT NICHT in diesem Ticket: Ledoit-Wolf-Shrinkage (datenbasiertes α)
 * und Black-Litterman (μ aus Marktgleichgewicht + Views) -- beide sind
 * bewusst zurückgestellte Folge-Optimierungen, siehe Ticket-Abschnitt
 * "Explizit NICHT in diesem Ticket".
 */

export interface PricePoint {
  date: string;
  close: number;
}

export interface CovarianceResult {
  tickersAligned: string[]; // Ticker, die tatsächlich in Σ/μ enthalten sind (nach Ausschluss)
  mu: number[]; // annualisierte historische Mittel-Rendite je Ticker (Reihenfolge = tickersAligned)
  sigma: number[]; // annualisierte Volatilität je Ticker (sqrt der Diagonale)
  Sigma: number[][]; // annualisierte Kovarianzmatrix (Reihenfolge = tickersAligned)
  nObs: number; // Anzahl gemeinsamer Return-Beobachtungen nach Alignment
  ridgeApplied: boolean;
  excludedTickers: string[]; // Ticker mit zu wenig Historie, ausgeschlossen statt geraten
  flags: string[];
}

const TRADING_DAYS_PER_YEAR = 252;
const MIN_OBSERVATIONS = 60; // Ticket-Vorgabe: "z.B. ≥60" Mindest-Beobachtungen
const RIDGE_KAPPA = 1e-3; // ε = κ · mean(diag(Σ̂)), konservativ (Ticket: 1e-4..1e-2 Bereich)

/** Einfache (nicht log-) Returns — dokumentierte Wahl, konsistent mit den
 * übrigen Portfolio-Formeln (Sharpe/Kelly nutzen ebenfalls arithmetische
 * Renditen an anderer Stelle im Repo). */
function computeSimpleReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) returns.push(prices[i] / prices[i - 1] - 1);
  }
  return returns;
}

/**
 * Richtet die Preisreihen mehrerer Ticker auf eine gemeinsame Datums-
 * Schnittmenge aus (innere Schnittmenge, kein Forward-Fill über fehlende
 * Handelstage hinweg -- Ticket-Vorgabe: "innere Schnittmenge der Daten").
 */
function alignPriceSeries(seriesByTicker: Record<string, PricePoint[]>): { dates: string[]; pricesByTicker: Record<string, number[]> } {
  const tickers = Object.keys(seriesByTicker);
  if (tickers.length === 0) return { dates: [], pricesByTicker: {} };

  // Datum -> Ticker -> Preis, dann nur Daten behalten, die bei ALLEN Tickern vorhanden sind.
  const dateSets = tickers.map(t => new Set(seriesByTicker[t].map(p => p.date)));
  const commonDates = Array.from(dateSets[0]).filter(d => dateSets.every(s => s.has(d))).sort();

  const priceMapByTicker: Record<string, Map<string, number>> = {};
  for (const t of tickers) {
    priceMapByTicker[t] = new Map(seriesByTicker[t].map(p => [p.date, p.close]));
  }

  const pricesByTicker: Record<string, number[]> = {};
  for (const t of tickers) {
    pricesByTicker[t] = commonDates.map(d => priceMapByTicker[t].get(d)!);
  }
  return { dates: commonDates, pricesByTicker };
}

/**
 * Ridge-Stabilisierung der Kovarianzmatrix: Σ ← Σ + ε·I, wobei
 * ε = max(1e-8, κ · mean(diag(Σ))) (Ticket-Formel wörtlich). Verhindert,
 * dass eine (nahezu) singuläre Σ bei der Invertierung in weightMaxSharpe()
 * explodiert. Wird IMMER mit einem kleinen ε angewendet (nicht nur bei
 * erkannter Singularität) -- konservativ und deterministisch, statt von
 * einer heuristischen Kondition-Schwelle abhängig zu sein.
 */
export function applyRidge(Sigma: number[][]): { Sigma: number[][]; ridgeApplied: boolean; epsilon: number } {
  const n = Sigma.length;
  if (n === 0) return { Sigma, ridgeApplied: false, epsilon: 0 };
  const diagMean = Sigma.reduce((sum, row, i) => sum + row[i], 0) / n;
  const epsilon = Math.max(1e-8, RIDGE_KAPPA * diagMean);
  const out = Sigma.map((row, i) => row.map((v, j) => (i === j ? v + epsilon : v)));
  return { Sigma: out, ridgeApplied: true, epsilon };
}

/**
 * Baut μ, σ, Σ aus historischen Tagespreisen der Portfolio-Ticker.
 *
 * Ablauf (Ticket-Spezifikation Schritt 1-7):
 * 1. Historische Preise pro Ticker (vom Aufrufer übergeben, z.B. aus
 *    /api/analyze historicalPrices -- KEIN eigener FMP-Call hier, dieses
 *    Modul ist eine reine Funktion ohne Netzwerkzugriff, testbar).
 * 2. Returns (einfache Rendite).
 * 3. Datums-Alignment (innere Schnittmenge).
 * 4. Ticker mit < MIN_OBSERVATIONS Beobachtungen ausschließen (kein Raten).
 * 5. Sample-Kovarianz, annualisiert (×252).
 * 6. Ridge-Stabilisierung (immer angewendet, siehe applyRidge).
 * 7. Rückgabe inkl. tickersAligned/excludedTickers/flags für Transparenz.
 */
export function buildCovariance(historicalPricesByTicker: Record<string, PricePoint[] | undefined>): CovarianceResult {
  const flags: string[] = [];
  const allTickers = Object.keys(historicalPricesByTicker);
  const excludedTickers: string[] = [];

  // Vorab: Ticker mit zu kurzer Rohhistorie ausschließen, bevor alignt wird
  // (ein einzelner Ticker mit sehr kurzer Serie würde sonst die gemeinsame
  // Schnittmenge für ALLE anderen Ticker unnötig verkürzen).
  const usableSeriesByTicker: Record<string, PricePoint[]> = {};
  for (const t of allTickers) {
    const series = (historicalPricesByTicker[t] ?? []).filter(p => typeof p.close === "number" && isFinite(p.close) && p.close > 0);
    if (series.length < MIN_OBSERVATIONS + 1) {
      excludedTickers.push(t);
      continue;
    }
    usableSeriesByTicker[t] = [...series].sort((a, b) => a.date.localeCompare(b.date));
  }

  const tickersCandidate = Object.keys(usableSeriesByTicker);
  if (tickersCandidate.length === 0) {
    flags.push("Keine Ticker mit ausreichender Historie (≥60 Beobachtungen) -- keine Kovarianz berechnet.");
    return { tickersAligned: [], mu: [], sigma: [], Sigma: [], nObs: 0, ridgeApplied: false, excludedTickers: allTickers, flags };
  }

  const { dates, pricesByTicker } = alignPriceSeries(usableSeriesByTicker);
  const nObs = dates.length > 0 ? dates.length - 1 : 0; // Returns = Preise - 1

  if (nObs < MIN_OBSERVATIONS) {
    flags.push(`Gemeinsame Datums-Schnittmenge zu kurz (${nObs} < ${MIN_OBSERVATIONS} Beobachtungen) -- keine belastbare Kovarianz.`);
    return { tickersAligned: [], mu: [], sigma: [], Sigma: [], nObs, ridgeApplied: false, excludedTickers: allTickers, flags };
  }

  const tickersAligned = tickersCandidate;
  const returnsByTicker: Record<string, number[]> = {};
  for (const t of tickersAligned) {
    returnsByTicker[t] = computeSimpleReturns(pricesByTicker[t]);
  }

  const n = tickersAligned.length;
  const means = tickersAligned.map(t => {
    const r = returnsByTicker[t];
    return r.reduce((s, x) => s + x, 0) / r.length;
  });

  // Sample-Kovarianz (Bessel-korrigiert, n-1), annualisiert ×252.
  const SigmaRaw: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const ri = returnsByTicker[tickersAligned[i]];
      const rj = returnsByTicker[tickersAligned[j]];
      const T = Math.min(ri.length, rj.length);
      let cov = 0;
      for (let t = 0; t < T; t++) {
        cov += (ri[t] - means[i]) * (rj[t] - means[j]);
      }
      cov = T > 1 ? cov / (T - 1) : 0;
      SigmaRaw[i][j] = cov * TRADING_DAYS_PER_YEAR;
    }
  }

  const muAnnualized = means.map(m => m * TRADING_DAYS_PER_YEAR);
  const { Sigma: SigmaRidged, ridgeApplied, epsilon } = applyRidge(SigmaRaw);
  if (ridgeApplied) {
    flags.push(`Ridge-Stabilisierung angewendet (ε=${epsilon.toExponential(2)}) -- verhindert Instabilität bei der Σ⁻¹-Invertierung.`);
  }
  if (excludedTickers.length > 0) {
    flags.push(`Ticker ohne ausreichende Historie ausgeschlossen: ${excludedTickers.join(", ")}.`);
  }

  const sigma = tickersAligned.map((_, i) => Math.sqrt(Math.max(SigmaRidged[i][i], 0)));

  return { tickersAligned, mu: muAnnualized, sigma, Sigma: SigmaRidged, nObs, ridgeApplied, excludedTickers, flags };
}
