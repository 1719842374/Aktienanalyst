/**
 * Portfolio-Monte-Carlo — Cholesky-korrelierte Multi-Asset-GBM-Simulation.
 *
 * Sprint D2 (Ticket SPRINT_D2_BLACK_LITTERMAN_PORTFOLIO_MC.md, Spec
 * WORK_BIAS_FIXES_INVERSE_DCF.md §16.11). Erweitert die bestehende
 * Einzeltitel-GBM-Logik aus `client/src/lib/calculations.ts`
 * (`gbmMonteCarlo`/`calculateGBMParams`, UNVERÄNDERT wiederverwendet) generisch
 * auf ein Multi-Asset-Portfolio mit Cholesky-korrelierten Schocks -- KEIN
 * Ticker-Hardcode, funktioniert für jedes Portfolio mit n≥2.
 *
 * ─── Kernschritt (Spec 16.11) ───
 * Pro Ticker i: μ_i, σ_i (aus calculateGBMParams ODER CAPM/Hybrid, Policy).
 * Σ aus buildCovariance() der aktuellen Portfolio-Ticker (gleiche Handelstage).
 * L = Cholesky(Σ) -- neue kleine Utility (kein Matrix-Utility mit Cholesky
 * bereits im Repo vorhanden, siehe Grep-Check im Ticket).
 * Pro Pfad: Z ~ N(0,I), ε = L·Z → korrelierte Schocks, R_P = Σ_i w_i · R_i.
 *
 * ─── Output (Spec 16.11 Tabelle, exakt diese 6 Kennzahlen) ───
 * E[R]_P, σ_P, VaR 5%, CVaR 5%, P(R_P<0), maxDD (mean).
 *
 * Zwei Läufe vergleichbar: Ist-Gewichte vs. CAPM-Zielgewichte bei gleichem
 * μ/Σ -- siehe `comparePortfolioWeightings`.
 */

/** Standard-Normal via Box-Muller -- dieselbe Methode wie in calculations.ts
 * `gbmMonteCarlo` (dort nicht exportiert), hier lokal dupliziert, um
 * calculations.ts NICHT zu verändern (Regression-Guard: additiv, keine
 * bestehenden Exports/Signaturen anfassen). */
function boxMuller(): number {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Cholesky-Zerlegung L einer symmetrisch-positiv-semidefiniten Matrix Σ,
 * sodass Σ = L·Lᵀ und L untere Dreiecksmatrix ist. Kein Matrix-Utility mit
 * Cholesky war im Repo vorhanden (geprüft: `covariance.ts`/`weighting.ts`/
 * `frontier.ts` haben nur Gauß-Jordan-Inversion, keine Cholesky) -- neue,
 * kleine, in-repo Implementierung ohne npm-Abhängigkeit.
 *
 * Gibt `null` zurück, wenn Σ nicht positiv-definit ist (negative oder
 * Null-Diagonale nach Pivot-Subtraktion) -- kein Raten/keine Näherung, der
 * Aufrufer muss diesen Fall behandeln (z.B. Ridge-Stabilisierung VOR dem
 * Aufruf anwenden, wie `buildCovariance()` es bereits automatisch tut).
 */
export function choleskyDecomposition(Sigma: number[][]): number[][] | null {
  const n = Sigma.length;
  if (n === 0) return null;
  if (Sigma.some(row => row.length !== n)) return null;

  const L: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) {
        const diag = Sigma[i][i] - sum;
        if (diag <= 1e-12) return null; // nicht positiv-definit -- kein Raten
        L[i][j] = Math.sqrt(diag);
      } else {
        L[i][j] = (Sigma[i][j] - sum) / L[j][j];
      }
    }
  }
  return L;
}

/** Multipliziert die untere Dreiecksmatrix L mit einem Vektor z: ε = L·z. */
function multiplyLowerTriangular(L: number[][], z: number[]): number[] {
  const n = L.length;
  const out = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j <= i; j++) sum += L[i][j] * z[j];
    out[i] = sum;
  }
  return out;
}

export type MuSource = "historical" | "capm" | "hybrid";

export interface PortfolioMonteCarloInput {
  /** Ticker-Reihenfolge, muss zu weights/mu/Sigma passen. */
  tickers: string[];
  /** Gewichte je Ticker (Σ sollte ≈1 sein für ein vollständig investiertes
   * Portfolio -- wird NICHT automatisch renormiert, siehe Docstring unten). */
  weights: number[];
  /** μ_i je Ticker, annualisiert (Dezimal). Quelle laut Policy wählbar
   * (historisch aus calculateGBMParams, ODER CAPM/Hybrid E[R]) -- diese
   * Datei ist quellen-agnostisch, der Aufrufer übergibt das gewählte μ_i
   * direkt (kein interner Policy-Schalter hier, um keine Abhängigkeit zu
   * server-/CAPM-spezifischem Code einzuführen). */
  mu: number[];
  /** Annotiert NUR zur Diagnose/Anzeige, woher mu[i] stammt -- ändert die
   * Rechnung nicht. */
  muSource?: MuSource[];
  /** σ_i je Ticker, annualisiert (Dezimal) -- Diagonale von Sigma, separat
   * gehalten für Klarheit/Validierung. */
  sigma: number[];
  /** Annualisierte Kovarianzmatrix (z.B. aus `buildCovariance().Sigma`,
   * bereits Ridge-stabilisiert -- WICHTIG für die Cholesky-Zerlegung, siehe
   * `choleskyDecomposition`). */
  Sigma: number[][];
  /** Anzahl simulierter Pfade (Policy, z.B. 5000-10000). */
  iterations: number;
  /** Anzahl Handelstage im Horizont (Policy, z.B. 252 = 1 Jahr). */
  tradingDays: number;
  /** VaR/CVaR-Quantil (Policy, Spec-Default 5% = 0.05). */
  varQuantile?: number;
}

export interface PortfolioMonteCarloResult {
  status: "ok" | "invalid_input" | "cholesky_failed";
  tickers: string[];
  weights: number[];
  iterations: number;
  tradingDays: number;
  varQuantile: number;
  /** E[R]_P — Mittel der Pfad-Endrenditen (Portfolio-Gesamtrendite über den Horizont). */
  expectedReturn: number | null;
  /** σ_P — Std.-Abw. der Pfad-Endrenditen. */
  stdDev: number | null;
  /** VaR 5% — Quantil der Pfad-Endrenditen (negativ = Verlust). */
  var5: number | null;
  /** CVaR 5% — Mittel aller Pfad-Renditen unterhalb VaR 5%. */
  cvar5: number | null;
  /** P(R_P < 0) — Anteil negativer Pfade. */
  probNegative: number | null;
  /** maxDD (mean) — mittlerer Max-Drawdown über alle Pfade (Portfolio-Wertindex, Start=1). */
  maxDrawdownMean: number | null;
  /** Rohverteilung der Pfad-Endrenditen, sortiert (für UI-Histogramme etc.). */
  pathReturns: number[];
  flags: string[];
}

/**
 * Multi-Asset-GBM mit Cholesky-korrelierten Schocks (Spec 16.11).
 *
 * Ablauf pro Pfad:
 *  1. Portfolio-Wertindex startet bei 1 (Basis, keine currentPrice-Abhängigkeit
 *     nötig, da nur relative Renditen/Drawdowns gefragt sind -- Spec-Output
 *     ist Renditen/Prozent, keine absoluten Preise).
 *  2. Pro Handelstag: Z ~ N(0,I) (n unabhängige Standardnormalen), ε = L·Z
 *     → korrelierte tägliche Schocks je Ticker.
 *  3. Einzeltitel-Tagesrendite via GBM-Inkrement (identische Formel wie
 *     `gbmMonteCarlo` in calculations.ts): r_i,t = (μ_i - ½σ_i²)·dt + σ_i·√dt·ε_i.
 *  4. Portfolio-Tagesrendite R_P,t = Σ_i w_i · r_i,t (einfache Gewichtung der
 *     log-nahen Inkremente, konsistent mit der additiven Portfolio-Return-
 *     Definition aus Spec 16.11: "R_P = Σ w_i · R_i").
 *  5. Portfolio-Wertindex kumulativ fortschreiben (Produkt der (1+R_P,t)),
 *     Max-Drawdown auf diesem Index tracken.
 *  6. Pfad-Endrendite = Wertindex_final / 1 - 1.
 *
 * Generisch für n≥2 beliebige Ticker -- keine Ticker-spezifische Verzweigung.
 */
export function runPortfolioMonteCarlo(input: PortfolioMonteCarloInput): PortfolioMonteCarloResult {
  const { tickers, weights, mu, sigma, Sigma, iterations, tradingDays } = input;
  const varQuantile = input.varQuantile ?? 0.05;
  const n = tickers.length;
  const flags: string[] = [];

  const baseInvalid: PortfolioMonteCarloResult = {
    status: "invalid_input", tickers, weights, iterations, tradingDays, varQuantile,
    expectedReturn: null, stdDev: null, var5: null, cvar5: null, probNegative: null,
    maxDrawdownMean: null, pathReturns: [], flags,
  };

  if (n < 2) {
    flags.push("Mindestens 2 Ticker für eine Portfolio-Monte-Carlo-Simulation erforderlich (Spec 16.11: n≥2).");
    return baseInvalid;
  }
  if (weights.length !== n || mu.length !== n || sigma.length !== n || Sigma.length !== n || Sigma.some(row => row.length !== n)) {
    flags.push("Dimensionen von weights/mu/sigma/Sigma passen nicht zur Ticker-Anzahl -- keine Simulation (kein Raten bei inkonsistenten Eingaben).");
    return baseInvalid;
  }
  if (mu.some(m => !Number.isFinite(m)) || sigma.some(s => !Number.isFinite(s) || s < 0)) {
    flags.push("Ungültige μ/σ-Werte (nicht-endlich oder σ<0) -- keine Simulation.");
    return baseInvalid;
  }
  if (!(iterations > 0) || !(tradingDays > 0)) {
    flags.push("iterations/tradingDays müssen positiv sein (Policy-Parameter, z.B. 5000/252).");
    return baseInvalid;
  }
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (Math.abs(weightSum - 1) > 1e-3) {
    flags.push(`Summe der Gewichte (${(weightSum * 100).toFixed(1)}%) weicht von 100% ab -- Simulation läuft trotzdem mit den übergebenen Rohgewichten (keine automatische Renormierung, Transparenz vor Bequemlichkeit).`);
  }

  const L = choleskyDecomposition(Sigma);
  if (!L) {
    return {
      ...baseInvalid,
      status: "cholesky_failed",
      flags: [...flags, "Cholesky-Zerlegung von Σ fehlgeschlagen (nicht positiv-definit) -- keine Simulation. Ridge-Stabilisierung von buildCovariance() prüfen."],
    };
  }

  // dt fix auf 1/252, konsistent mit der Konvention in calculations.ts
  // `gbmMonteCarlo` (Handelstage-Skalierung unabhängig vom gewählten Horizont).
  const dt = 1 / 252;
  const sqrtDt = Math.sqrt(dt);
  const drift = mu.map((m, i) => m - 0.5 * sigma[i] * sigma[i]);

  const pathReturns: number[] = [];
  const maxDrawdowns: number[] = [];

  for (let p = 0; p < iterations; p++) {
    let portfolioIndex = 1;
    let peak = 1;
    let maxDD = 0;

    for (let t = 0; t < tradingDays; t++) {
      const z = Array.from({ length: n }, () => boxMuller());
      const eps = multiplyLowerTriangular(L, z); // korrelierte Schocks ε = L·Z
      let dailyPortfolioReturn = 0;
      for (let i = 0; i < n; i++) {
        const assetDailyReturn = drift[i] * dt + sigma[i] * sqrtDt * eps[i];
        dailyPortfolioReturn += weights[i] * assetDailyReturn;
      }
      portfolioIndex *= 1 + dailyPortfolioReturn;
      if (portfolioIndex > peak) peak = portfolioIndex;
      const dd = peak > 0 ? (peak - portfolioIndex) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }

    pathReturns.push(portfolioIndex - 1);
    maxDrawdowns.push(maxDD);
  }

  pathReturns.sort((a, b) => a - b);

  const expectedReturn = pathReturns.reduce((s, r) => s + r, 0) / pathReturns.length;
  const variance = pathReturns.reduce((s, r) => s + (r - expectedReturn) ** 2, 0) / pathReturns.length;
  const stdDev = Math.sqrt(variance);

  const varIndex = Math.max(0, Math.floor(pathReturns.length * varQuantile) - 1);
  const var5 = pathReturns[varIndex];
  const tailSlice = pathReturns.slice(0, varIndex + 1);
  const cvar5 = tailSlice.length > 0 ? tailSlice.reduce((s, r) => s + r, 0) / tailSlice.length : var5;

  const probNegative = pathReturns.filter(r => r < 0).length / pathReturns.length;
  const maxDrawdownMean = maxDrawdowns.reduce((s, v) => s + v, 0) / maxDrawdowns.length;

  flags.push(`${iterations} Pfade × ${tradingDays} Handelstage, ${n} Ticker, VaR/CVaR-Quantil=${(varQuantile * 100).toFixed(0)}%.`);

  return {
    status: "ok", tickers, weights, iterations, tradingDays, varQuantile,
    expectedReturn, stdDev, var5, cvar5, probNegative, maxDrawdownMean,
    pathReturns, flags,
  };
}

export interface WeightingComparisonInput {
  tickers: string[];
  mu: number[];
  sigma: number[];
  Sigma: number[][];
  /** Ist-Gewichte (Marktwert), gleiche Reihenfolge wie tickers. */
  weightsCurrent: number[];
  /** CAPM-Zielgewichte (z.B. EngineRow.weightCapm je Ticker), gleiche Reihenfolge. */
  weightsCapmTarget: number[];
  iterations: number;
  tradingDays: number;
  varQuantile?: number;
}

export interface WeightingComparisonResult {
  current: PortfolioMonteCarloResult;
  capmTarget: PortfolioMonteCarloResult;
}

/**
 * Zwei vergleichbare MC-Läufe bei GLEICHEM μ/Σ (Spec 16.11 letzter Satz:
 * "Zwei Läufe vergleichen: Ist-Gewichte vs. CAPM-Zielgewichte"): einmal mit
 * den aktuellen Ist-Gewichten, einmal mit den CAPM-Zielgewichten. Reine
 * Delegation an `runPortfolioMonteCarlo` mit denselben μ/σ/Σ/Policy-Parametern
 * -- der einzige Unterschied zwischen den beiden Läufen ist der Gewichtsvektor.
 */
export function comparePortfolioWeightings(input: WeightingComparisonInput): WeightingComparisonResult {
  const shared = {
    tickers: input.tickers,
    mu: input.mu,
    sigma: input.sigma,
    Sigma: input.Sigma,
    iterations: input.iterations,
    tradingDays: input.tradingDays,
    varQuantile: input.varQuantile,
  };
  return {
    current: runPortfolioMonteCarlo({ ...shared, weights: input.weightsCurrent }),
    capmTarget: runPortfolioMonteCarlo({ ...shared, weights: input.weightsCapmTarget }),
  };
}
