/**
 * Black-Litterman — Reverse Optimization (Π) + BL-Formel + Sensitivität.
 *
 * Sprint D2 (Ticket SPRINT_D2_BLACK_LITTERMAN_PORTFOLIO_MC.md, Spec
 * WORK_BIAS_FIXES_INVERSE_DCF.md §16.9-16.10). Additiv — baut auf der
 * bestehenden Kovarianz-Infrastruktur (`covariance.ts` `buildCovariance()`)
 * auf und ersetzt/verändert KEINE bestehenden Exports/Signaturen dort.
 *
 * ─── Reverse Optimization (Π) ───
 * Π = λ · Σ · w
 * λ (Risikoaversions-Skalar) ist ein Policy-Parameter, KEIN Ticker-Wert.
 * w sind die aktuellen Markt-/Ist-Gewichte des Portfolios (oder ein anderer
 * Referenz-Gewichtsvektor, z.B. CAPM-Zielgewichte) — vom Aufrufer übergeben,
 * diese Datei greift nicht selbst auf Positions-/Engine-State zu (bleibt
 * eine reine, netzwerk- und state-freie Funktion wie covariance.ts).
 *
 * ─── Black-Litterman-Formel (Spec 16.9, wörtlich) ───
 * E[R]_BL = [ (τΣ)⁻¹ + PᵀΩ⁻¹P ]⁻¹ · [ (τΣ)⁻¹Π + PᵀΩ⁻¹Q ]
 *
 * Ohne Views (P/Q leer) muss E[R]_BL = Π exakt gelten — das ist in der
 * Formel selbst so angelegt (der PᵀΩ⁻¹P/PᵀΩ⁻¹Q-Term entfällt bei 0 Views)
 * und wird zusätzlich per Kurzschluss-Pfad (keine Matrix-Operationen nötig)
 * umgesetzt, um Rundungsfehler durch die Matrixinversion bei k=0 Views ganz
 * zu vermeiden.
 *
 * ─── Zahlen-Prinzip ───
 * Views (Q) werden NICHT in diesem Modul erzeugt — sie kommen als bereits
 * aufbereitete `ViewInput[]` vom Aufrufer (z.B. aus DCF-Upside/Hardened-CRV/
 * Thesis-Strength einer Analyse). Fehlt für einen Ticker eine belastbare
 * Analyse, erzeugt der Aufrufer schlicht KEINEN View-Eintrag für ihn — diese
 * Datei rät nichts nach und füllt keine Platzhalter ein.
 *
 * τ, Ω, λ sind Policy-Parameter (Funktionsargumente mit Policy-Defaults),
 * niemals fest auf einen Ticker verdrahtet.
 */

export interface ViewInput {
  /** Ticker, auf den sich der View bezieht (Groß-/Kleinschreibung wird vom
   * Aufrufer konsistent zu `tickers` gehalten — hier keine Normalisierung,
   * um dieses Modul frei von Ticker-spezifischer Logik zu halten). */
  ticker: string;
  /** Q_k — erwartete (View-)Rendite für diesen Ticker, hergeleitet aus
   * vorhandenen Analyse-Daten (z.B. DCF-Upside/Hardened-CRV, Thesis-Strength).
   * Dezimal, z.B. 0.15 = 15% p.a. NIEMALS ein geratener/hardcodierter Wert —
   * Verantwortung des Aufrufers. */
  q: number;
  /** Ω_kk — View-Unsicherheit (Varianz) für genau diesen View. Größer =
   * schwächerer View. Muss > 0 sein (sonst wird der View ignoriert, siehe
   * `computeBlackLitterman`). Vom Aufrufer aus Analyse-Konfidenz/
   * Datenqualität abgeleitet (z.B. geringe Konfidenz → hohe Ω_kk). */
  omega: number;
}

export interface BlackLittermanPolicy {
  /** λ — Risikoaversions-Skalar für die Reverse Optimization Π=λΣw. Policy-
   * Parameter, typischer Bereich 1-5 (Marktrisikoaversion), NIEMALS
   * ticker-spezifisch fest verdrahtet. */
  lambda: number;
  /** τ — Skalierung der Unsicherheit von Π selbst (Spec: Policy 0,01-0,05). */
  tau: number;
}

export const DEFAULT_BL_POLICY: BlackLittermanPolicy = { lambda: 2.5, tau: 0.025 };

export interface ReverseOptimizationResult {
  tickers: string[];
  /** Π — Gleichgewichts-/Implied-Renditen, Reihenfolge = tickers. */
  pi: number[];
  lambda: number;
  /** Summe der übergebenen Gewichte (Diagnose — sollte nahe 1 liegen, wird
   * aber nicht selbst renormiert, siehe Docstring computeReverseOptimization). */
  weightSum: number;
  flags: string[];
}

function matVec(A: number[][], v: number[]): number[] {
  return A.map(row => row.reduce((s, a, j) => s + a * v[j], 0));
}

function addVec(a: number[], b: number[]): number[] {
  return a.map((x, i) => x + b[i]);
}

function scaleVec(v: number[], s: number): number[] {
  return v.map(x => x * s);
}

function scaleMat(A: number[][], s: number): number[][] {
  return A.map(row => row.map(v => v * s));
}

function addMat(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

/**
 * Kleine n×n-Matrixinversion (Gauß-Jordan mit Partial Pivoting). Lokal
 * implementiert statt aus `weighting.ts`/`frontier.ts` importiert, da beide
 * Funktionen dort NICHT exportiert sind (siehe Ticket Punkt 4: "Falls im
 * Repo bereits eine Matrix-Utility existiert, diese wiederverwenden" —
 * geprüft, es gibt keine exportierte). Bleibt damit konsistent mit dem
 * bereits etablierten Repo-Muster einer lokalen, in sich geschlossenen
 * Inversions-Funktion pro Modul (siehe frontier.ts `invertMatrixLocal`).
 * Gibt `null` bei (nahezu) Singularität zurück — kein Raten.
 */
export function invertMatrixBL(A: number[][]): number[][] | null {
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

/**
 * Reverse Optimization: Π = λ · Σ · w.
 *
 * @param tickers Reihenfolge, muss zu Sigma/weights passen.
 * @param Sigma annualisierte Kovarianzmatrix (z.B. aus `buildCovariance().Sigma`,
 *   bereits Ridge-stabilisiert).
 * @param weights aktuelle Markt-/Ist-Gewichte ODER CAPM-Zielgewichte, gleiche
 *   Reihenfolge wie tickers. Wird NICHT selbst renormiert (der Aufrufer ist
 *   dafür verantwortlich, ein sinnvolles Gewichtsschema zu übergeben — z.B.
 *   `computeMarketWeights`/`EngineRow.weightCapm` aus engine.ts) — `weightSum`
 *   im Ergebnis dient nur als Diagnose-Hinweis.
 * @param lambda Risikoaversions-Skalar (Policy-Parameter, siehe `BlackLittermanPolicy`).
 */
export function computeReverseOptimization(
  tickers: string[],
  Sigma: number[][],
  weights: number[],
  lambda: number,
): ReverseOptimizationResult {
  const flags: string[] = [];
  const n = tickers.length;
  if (n === 0 || Sigma.length !== n || weights.length !== n) {
    return { tickers, pi: [], lambda, weightSum: 0, flags: ["Ungültige Eingabedimensionen -- keine Reverse Optimization berechnet."] };
  }
  if (!(lambda > 0)) {
    flags.push(`λ=${lambda} ist kein positiver Risikoaversions-Skalar -- Ergebnis mit Vorsicht interpretieren.`);
  }
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (Math.abs(weightSum - 1) > 1e-3) {
    flags.push(`Summe der übergebenen Gewichte (${(weightSum * 100).toFixed(1)}%) weicht von 100% ab -- Π wird trotzdem mit den übergebenen Rohgewichten berechnet (keine automatische Renormierung).`);
  }
  const pi = scaleVec(matVec(Sigma, weights), lambda);
  return { tickers, pi, lambda, weightSum, flags };
}

export interface BlackLittermanResult {
  tickers: string[];
  /** E[R]_BL, Reihenfolge = tickers. */
  expectedReturns: number[];
  /** Π (Equilibrium/Reverse-Opt-Renditen), zum Vergleich mit expectedReturns. */
  pi: number[];
  tau: number;
  /** Anzahl tatsächlich verwendeter Views (View-Zeilen mit gültigem Ticker
   * UND Ω>0 -- ungültige Views werden übersprungen, nicht geraten). */
  viewsUsed: number;
  /** Views, die wegen unbekanntem Ticker oder ungültigem Ω übersprungen wurden. */
  skippedViews: { ticker: string; reason: string }[];
  /** |E[R]_BL - Π| je Ticker -- Grundlage der Sensitivitätsanzeige. */
  deltaVsPi: number[];
  /** Aggregierte Sensitivitätsstufe über alle Ticker (Spec 16.10 UI:
   * "View-Einfluss: schwach/mittel/stark"). */
  viewInfluence: ViewInfluenceLevel;
  flags: string[];
}

export type ViewInfluenceLevel = "keine" | "schwach" | "mittel" | "stark";

/** Schwellenwerte für die |E[R]_BL - Π|-Klassifikation (Policy-Parameter,
 * NICHT ticker-spezifisch -- gelten für den maximalen Renditeunterschied
 * über alle Ticker hinweg, in Dezimal-Punkten p.a.). Konfigurierbar über
 * `classifyViewInfluence`, damit UI-Konsumenten eigene Schwellen setzen
 * können, ohne diese Datei zu ändern. */
export const DEFAULT_VIEW_INFLUENCE_THRESHOLDS = { weak: 0.005, medium: 0.02 };

export function classifyViewInfluence(
  maxAbsDelta: number,
  thresholds: { weak: number; medium: number } = DEFAULT_VIEW_INFLUENCE_THRESHOLDS,
): ViewInfluenceLevel {
  if (!Number.isFinite(maxAbsDelta) || maxAbsDelta <= 1e-9) return "keine";
  if (maxAbsDelta < thresholds.weak) return "schwach";
  if (maxAbsDelta < thresholds.medium) return "mittel";
  return "stark";
}

/**
 * Black-Litterman-Formel exakt nach Spec 16.9:
 * E[R]_BL = [ (τΣ)⁻¹ + PᵀΩ⁻¹P ]⁻¹ · [ (τΣ)⁻¹Π + PᵀΩ⁻¹Q ]
 *
 * Ohne Views (`views` leer ODER alle Views ungültig) wird bewusst der
 * Kurzschluss-Pfad `E[R]_BL = Π` genommen (siehe Akzeptanzkriterium
 * "Black-Litterman-Formel liefert bei leerem Q exakt Π zurück") -- eine
 * (τΣ)⁻¹-Inversion mit anschließender Multiplikation mit sich selbst würde
 * bei numerisch perfekter Inversion zwar ebenfalls Π ergeben, aber jede
 * Rundung in `invertMatrixBL` risikiert Abweichungen im letzten Bit. Der
 * Kurzschluss ist daher sowohl schneller als auch exakt.
 *
 * @param tickers Reihenfolge, muss zu Sigma/pi passen.
 * @param Sigma Kovarianzmatrix (z.B. aus buildCovariance().Sigma).
 * @param pi Π je Ticker (z.B. aus computeReverseOptimization oder CAPM-E[R]).
 * @param views View-Liste (P/Q/Ω werden intern aus dieser Liste + tickers gebaut).
 * @param tau Policy-Skalar (Spec: 0,01-0,05), Funktionsargument -- niemals hardcodiert.
 */
export function computeBlackLitterman(
  tickers: string[],
  Sigma: number[][],
  pi: number[],
  views: ViewInput[],
  tau: number,
): BlackLittermanResult {
  const flags: string[] = [];
  const n = tickers.length;

  if (n === 0 || Sigma.length !== n || pi.length !== n) {
    return {
      tickers, expectedReturns: [], pi, tau, viewsUsed: 0, skippedViews: [],
      deltaVsPi: [], viewInfluence: "keine",
      flags: ["Ungültige Eingabedimensionen -- keine Black-Litterman-Berechnung."],
    };
  }
  if (!(tau > 0)) {
    flags.push(`τ=${tau} ist kein positiver Skalar -- Policy-Wert prüfen (üblich 0,01-0,05).`);
  }

  const tickerIndex = new Map(tickers.map((t, i) => [t, i]));
  const skippedViews: { ticker: string; reason: string }[] = [];
  const validViews = views.filter(v => {
    const idx = tickerIndex.get(v.ticker);
    if (idx == null) {
      skippedViews.push({ ticker: v.ticker, reason: "Ticker nicht im Portfolio/Σ enthalten -- View übersprungen (kein Raten)." });
      return false;
    }
    if (!(v.omega > 0)) {
      skippedViews.push({ ticker: v.ticker, reason: `Ω=${v.omega} ist keine gültige (positive) View-Unsicherheit -- View übersprungen.` });
      return false;
    }
    if (!Number.isFinite(v.q)) {
      skippedViews.push({ ticker: v.ticker, reason: "Q ist keine gültige Zahl -- View übersprungen." });
      return false;
    }
    return true;
  });

  // Ohne (gültige) Views: E[R]_BL = Π exakt (Spec 16.9 "Ohne Views").
  if (validViews.length === 0) {
    if (views.length > 0) {
      flags.push(`Alle ${views.length} übergebenen View(s) waren ungültig/nicht zuordenbar -- E[R]_BL entspricht Π (reines Equilibrium).`);
    }
    return {
      tickers, expectedReturns: [...pi], pi, tau, viewsUsed: 0, skippedViews,
      deltaVsPi: tickers.map(() => 0), viewInfluence: "keine", flags,
    };
  }

  const k = validViews.length;
  // P: k×n Pick-Matrix, eine 1 pro View-Zeile in der Spalte des betroffenen Tickers.
  const P: number[][] = validViews.map(v => {
    const row = Array(n).fill(0);
    row[tickerIndex.get(v.ticker)!] = 1;
    return row;
  });
  const Q = validViews.map(v => v.q);
  // Ω: k×k Diagonalmatrix der View-Unsicherheiten.
  const OmegaInv: number[][] = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => (i === j ? 1 / validViews[i].omega : 0)),
  );

  const tauSigma = scaleMat(Sigma, tau);
  const tauSigmaInv = invertMatrixBL(tauSigma);
  if (!tauSigmaInv) {
    flags.push("(τΣ)⁻¹ konnte nicht berechnet werden (singuläre Kovarianzmatrix) -- E[R]_BL entspricht Π als sicherer Fallback (kein Raten).");
    return {
      tickers, expectedReturns: [...pi], pi, tau, viewsUsed: 0, skippedViews,
      deltaVsPi: tickers.map(() => 0), viewInfluence: "keine", flags,
    };
  }

  // PᵀΩ⁻¹P (n×n) und PᵀΩ⁻¹Q (n×1) -- Pᵀ ist die Transponierte der k×n Pick-Matrix.
  const Pt: number[][] = Array.from({ length: n }, (_, i) => P.map(row => row[i]));
  const PtOmegaInvMat = matMul(Pt, OmegaInv); // n×k
  const PtOmegaInvP = matMul(PtOmegaInvMat, P); // n×n
  const PtOmegaInvQ = matVec(PtOmegaInvMat, Q); // n×1

  const A = addMat(tauSigmaInv, PtOmegaInvP); // [(τΣ)⁻¹ + PᵀΩ⁻¹P]
  const AInv = invertMatrixBL(A);
  if (!AInv) {
    flags.push("[(τΣ)⁻¹ + PᵀΩ⁻¹P] konnte nicht invertiert werden -- E[R]_BL entspricht Π als sicherer Fallback (kein Raten).");
    return {
      tickers, expectedReturns: [...pi], pi, tau, viewsUsed: 0, skippedViews,
      deltaVsPi: tickers.map(() => 0), viewInfluence: "keine", flags,
    };
  }

  const rhs = addVec(matVec(tauSigmaInv, pi), PtOmegaInvQ); // [(τΣ)⁻¹Π + PᵀΩ⁻¹Q]
  const expectedReturns = matVec(AInv, rhs);

  const deltaVsPi = expectedReturns.map((er, i) => Math.abs(er - pi[i]));
  const maxAbsDelta = deltaVsPi.length > 0 ? Math.max(...deltaVsPi) : 0;
  const viewInfluence = classifyViewInfluence(maxAbsDelta);

  if (skippedViews.length > 0) {
    flags.push(`${skippedViews.length} View(s) übersprungen: ${skippedViews.map(s => `${s.ticker} (${s.reason})`).join("; ")}`);
  }
  flags.push(`${k} View(s) verarbeitet, τ=${tau}, View-Einfluss: ${viewInfluence} (max |ΔE[R]|=${(maxAbsDelta * 100).toFixed(2)}pp).`);

  return { tickers, expectedReturns, pi, tau, viewsUsed: k, skippedViews, deltaVsPi, viewInfluence, flags };
}

function matMul(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const inner = B.length;
  const cols = inner > 0 ? B[0].length : 0;
  const out: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let sum = 0;
      for (let m = 0; m < inner; m++) sum += A[i][m] * B[m][j];
      out[i][j] = sum;
    }
  }
  return out;
}
