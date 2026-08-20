/**
 * Portfolio-Engine — EIN Rechenblock ab 2 offenen Positionen.
 *
 * Auftrag 10.08.2026 ("Portfolio-Engine – eine Optimierung ab 2 Positionen
 * (Kovarianz + CAPM/Kelly)"). Koppelt `PortfolioPosition[]` (Investments,
 * einzige Quelle) direkt an buildCovariance() + allocate() + Kelly, OHNE eine
 * zweite, manuell gepflegte Kandidaten-Tabelle. Ersetzt NICHT
 * runPortfolioPipeline()/allocate()/Kelly (bleiben unveraendert, reine
 * Funktionen) -- diese Datei ist der fehlende Bindeglied-Layer, der bisher
 * nur manuell (Section-4-Kandidaten) statt aus echten Positionen befuellt
 * wurde.
 *
 * μ/σ/Score-Overrides (User "Aus Analyse übernehmen" oder manuelle Eingabe)
 * haben Vorrang vor den aus der Historie berechneten Werten -- WELCHER Wert
 * verwendet wurde, wird pro Ticker transparent im Ergebnis ausgewiesen
 * (Ticket-Vorgabe: "Overrides markiert").
 */
import type { PortfolioPosition, PortfolioPolicy } from "./positions";
import { buildCovariance, type PricePoint, type CovarianceResult } from "./covariance";
import { allocate, resolveEffectiveMaxWeight, suggestedMaxWeightDefault, DEFAULT_MAX_WEIGHT, type WeightMode } from "./weighting";
import { sharpeReport } from "./sharpe";
import { applyKellyPolicy, kellyContinuous } from "./kelly";
import { assessConcentration, type ConcentrationResult } from "./concentration";
import { winsorizeMuArray, DEFAULT_MU_WINSORIZE_MIN, DEFAULT_MU_WINSORIZE_MAX } from "./winsorize";

export const MIN_POSITIONS_FOR_OPTIMIZATION = 2;

export interface EnginePositionInput {
  ticker: string;
  qty: number;
  entryPrice: number;
  lastPrice: number | null | undefined;
  side: "long" | "short";
  // Overrides -- wenn gesetzt, haben sie Vorrang vor Historie-Schaetzung.
  muOverride?: number | null;
  sigmaOverride?: number | null;
  scoreOverride?: number | null;
}

export interface EngineRow {
  ticker: string;
  mu: number;
  muSource: "override" | "historical";
  muWasWinsorized: boolean; // true wenn das historische μ auf das Band geclippt wurde
  sigma: number;
  sigmaSource: "override" | "historical";
  score: number | null;
  weightCapm: number; // Ziel-Gewicht nach CAPM-Modus (Summe über alle Rows = 1)
  weightMarket: number | null; // Ist-Gewicht aus aktuellem Marktwert (Summe = 1, null wenn Kurs fehlt)
  basketAmount: number; // weightCapm * capital
  sharpeSingle: number | null;
  kelly: { fStar: number; fHalf: number; fCapped: number; amountEuro: number } | null;
}

export interface EngineResult {
  status: "ok" | "insufficient_positions" | "insufficient_history";
  mode: WeightMode | null;
  rows: EngineRow[];
  sharpePortfolio: number | null;
  sharpeEqualWeight: number | null;
  deltaVsEqual: number | null;
  covariance: CovarianceResult | null;
  concentration: ConcentrationResult | null; // HHI/Effective-N/Korrelations-Warnungen (Diagnostik, ändert keine Gewichte)
  excludedTickers: string[]; // Positionen ohne ausreichende Historie ODER ohne Override -- nicht in der Optimierung
  /** Strukturierter Fallback-Grund fuer sichtbare UI-Warnung (10.08.2026
   * Equal-Weight-Bugfix). null = normale Optimierung ohne Einschraenkung.
   * "cap_infeasible": selbst der 1/n-Floor konnte den Cap nicht retten (sollte
   * nach Einfuehrung des dynamischen maxWeight praktisch nie mehr auftreten,
   * bleibt als Sicherheitsnetz fuer Kanten/Rundungsfaelle erhalten).
   * "solve_failed": Σ-Invertierung ist trotz Ridge/Shrinkage gescheitert,
   * Equal-Weight-Basis wurde verwendet. */
  fallbackReason: "cap_infeasible" | "solve_failed" | null;
  /** Dynamisches maxWeight (Auftrag 10.08.2026, Folge-Ticket "Dynamisches
   * maxWeight fuer kleine Portfolios"): userMaxWeight ist der von der Policy
   * uebergebene Wert (unveraendert), effectiveMaxWeight der tatsaechlich in
   * der Optimierung verwendete Cap NACH Anwendung des 1/n-Floors
   * (effective = max(userMaxWeight, 1/n)). wasFloorApplied=true, wenn der
   * User-Wert unter 1/n lag und deshalb transparent angehoben wurde -- das
   * ist eine bewusste Entscheidung: ein Cap unter 1/n ist bei n Titeln nie
   * erfuellbar und wird NIE als echter Cap uebernommen (siehe weighting.ts
   * resolveEffectiveMaxWeight-Docstring). */
  userMaxWeight: number;
  effectiveMaxWeight: number;
  wasFloorApplied: boolean;
  /** true wenn effectiveMaxWeight so nah an 1/n liegt, dass Equal-Weight
   * faktisch der einzige zulässige Punkt ist -- Modus A (Max-Sharpe) kann
   * dann keine sichtbar differenzierte Struktur mehr liefern, selbst wenn
   * kein Floor-Eingriff nötig war. Siehe weighting.ts resolveEffectiveMaxWeight. */
  capForcesEqualWeight: boolean;
  flags: string[];
}

/**
 * Marktdaten für einen automatischen Ticker-Basket ohne echte Positionen.
 *
 * P2/P3 liefern bewusst nur Ticker und optionale Research-Scores. Historische
 * Preise bleiben Eingabe des Aufrufers, damit diese Engine-Schicht weiterhin
 * rein, testbar und frei von Netzwerkzugriffen ist.
 */
export interface TickerPortfolioMarketData {
  historicalPricesByTicker: Record<string, PricePoint[] | undefined>;
  scoreByTicker?: Record<string, number | null | undefined>;
}

/**
 * Berechnet einen automatischen CAPM/Kelly-Basket direkt aus einer Tickerliste.
 *
 * Diese additive Variante ist für Watchlist- und Researcher-Portfolios (P2/P3)
 * gedacht. Sie erzeugt ausschließlich interne, synthetische Long-Inputs ohne
 * Stückzahl, Einstand oder Stop und delegiert dann unverändert an
 * computePortfolioFromPositions(). P1 nutzt weiterhin ausschließlich die
 * bestehende Positions-Funktion und wird hierdurch nicht beeinflusst.
 */
export function computePortfolioFromTickers(
  tickers: string[],
  policy: PortfolioPolicy,
  marketData: TickerPortfolioMarketData,
): EngineResult {
  const uniqueTickers = Array.from(new Set(
    tickers.map(ticker => ticker.trim().toUpperCase()).filter(Boolean),
  ));
  const scoreByTicker = marketData.scoreByTicker ?? {};

  return computePortfolioFromPositions({
    positions: uniqueTickers.map(ticker => ({
      ticker,
      // Watchlist-Baskets haben absichtlich keine reale Position bzw. keinen
      // Marktwert. Dadurch bleibt weightMarket=null, während CAPM/Kelly wie
      // in der bewährten Engine aus μ/σ/Σ berechnet werden.
      qty: 0,
      entryPrice: 0,
      lastPrice: null,
      side: "long" as const,
      scoreOverride: scoreByTicker[ticker] ?? null,
    })),
    historicalPricesByTicker: marketData.historicalPricesByTicker,
    rf: policy.rfPct / 100,
    capital: policy.capital,
    maxWeight: policy.maxWeightPct / 100,
    kellyFraction: policy.kellyFraction,
    kellyMaxF: policy.kellyMaxFPct / 100,
  });
}

/**
 * EIN Aufruf: positions (offene Longs+Shorts, aber die Optimierung selbst
 * arbeitet long-only auf den Betragsgroessen -- Kurz-Positionen fliessen wie
 * im bestehenden Positions-Tracker über ihre Marktwert-Gewichte ein, die
 * CAPM/Kelly-Zielallokation bezieht sich aber auf die Long-only-Logik von
 * weighting.ts, wie im gesamten Modul dokumentiert) + historische Preise +
 * Policy → vollstaendiges Optimierungsergebnis. Kein Netzwerkzugriff (reine
 * Funktion, testbar) -- historicalPricesByTicker wird vom Aufrufer (UI)
 * bereits aus dem Analyse-Cache befuellt uebergeben.
 */
export function computePortfolioFromPositions(opts: {
  positions: EnginePositionInput[];
  historicalPricesByTicker: Record<string, PricePoint[] | undefined>;
  rf: number;
  capital: number;
  maxWeight?: number;
  kellyFraction?: number;
  kellyMaxF?: number;
  scoreDefault?: number; // wenn kein Score verfuegbar (Ticket: "neutral 50")
  /** μ-Winsorizing-Band (nur auf historisch geschaetzte μ angewendet, NIE auf
   * Overrides). Default [-20%, +40%] p.a. (Folge-Ticket Punkt 3). Auf `null`
   * setzen, um Winsorizing komplett zu deaktivieren (z.B. fuer Tests, die das
   * unveraenderte Roh-μ pruefen wollen). */
  muWinsorizeMin?: number | null;
  muWinsorizeMax?: number | null;
}): EngineResult {
  const { positions, historicalPricesByTicker, rf, capital } = opts;
  const flags: string[] = [];

  if (positions.length < MIN_POSITIONS_FOR_OPTIMIZATION) {
    return {
      status: "insufficient_positions", mode: null, rows: [], sharpePortfolio: null,
      sharpeEqualWeight: null, deltaVsEqual: null, covariance: null, concentration: null, excludedTickers: [],
      fallbackReason: null,
      userMaxWeight: opts.maxWeight ?? DEFAULT_MAX_WEIGHT, effectiveMaxWeight: opts.maxWeight ?? DEFAULT_MAX_WEIGHT, wasFloorApplied: false, capForcesEqualWeight: false,
      flags: [`Mindestens ${MIN_POSITIONS_FOR_OPTIMIZATION} offene Positionen für Portfolio-Optimierung erforderlich (aktuell: ${positions.length}).`],
    };
  }

  // Kovarianz aus Historie fuer ALLE Positions-Ticker (auch die mit Override --
  // Σ wird trotzdem aus der Historie gebraucht, nur μ/σ selbst koennen
  // ueberschrieben werden; Korrelationsstruktur kommt immer aus den echten Daten).
  const covariance = buildCovariance(historicalPricesByTicker);
  flags.push(...covariance.flags);

  // Tickers, die entweder (a) genug Historie fuer Σ haben, ODER (b) einen
  // vollstaendigen μ+σ-Override besitzen, fliessen in die Optimierung ein.
  // Reine Historie-Ticker OHNE Override und OHNE ausreichende Historie werden
  // ausgeschlossen (Ticket: "kein Fake-Σ" -- niemals raten).
  const positionByTicker = new Map(positions.map(p => [p.ticker.toUpperCase(), p]));
  const withOverridePair = positions.filter(p => p.muOverride != null && p.sigmaOverride != null).map(p => p.ticker.toUpperCase());
  const usableTickers = Array.from(new Set([...covariance.tickersAligned, ...withOverridePair]))
    .filter(t => positionByTicker.has(t));

  const excludedTickers = positions
    .map(p => p.ticker.toUpperCase())
    .filter(t => !usableTickers.includes(t));
  if (excludedTickers.length > 0) {
    flags.push(`Positionen ohne ausreichende Historie und ohne μ/σ-Override von der Optimierung ausgeschlossen: ${excludedTickers.join(", ")}.`);
  }

  if (usableTickers.length < MIN_POSITIONS_FOR_OPTIMIZATION) {
    return {
      status: "insufficient_history", mode: null, rows: [], sharpePortfolio: null,
      sharpeEqualWeight: null, deltaVsEqual: null, covariance, concentration: null, excludedTickers,
      fallbackReason: null,
      userMaxWeight: opts.maxWeight ?? DEFAULT_MAX_WEIGHT, effectiveMaxWeight: opts.maxWeight ?? DEFAULT_MAX_WEIGHT, wasFloorApplied: false, capForcesEqualWeight: false,
      flags: [...flags, `Nur ${usableTickers.length} Position(en) mit ausreichender Historie/Override -- mindestens ${MIN_POSITIONS_FOR_OPTIMIZATION} nötig.`],
    };
  }

  // Für jeden usable Ticker: μ/σ aus Override ODER Historie, in konsistenter
  // Reihenfolge fuer die Σ-Teilmatrix.
  const n = usableTickers.length;
  const mu: number[] = [];
  const sigma: number[] = [];
  const muSource: EngineRow["muSource"][] = [];
  const sigmaSource: EngineRow["sigmaSource"][] = [];
  const scores: number[] = [];

  for (const ticker of usableTickers) {
    const pos = positionByTicker.get(ticker)!;
    const histIdx = covariance.tickersAligned.indexOf(ticker);
    if (pos.muOverride != null) { mu.push(pos.muOverride); muSource.push("override"); }
    else if (histIdx >= 0) { mu.push(covariance.mu[histIdx]); muSource.push("historical"); }
    else { mu.push(0); muSource.push("historical"); flags.push(`${ticker}: kein μ verfügbar (weder Override noch Historie) -- 0 angenommen, Ergebnis mit Vorsicht interpretieren.`); }

    if (pos.sigmaOverride != null) { sigma.push(pos.sigmaOverride); sigmaSource.push("override"); }
    else if (histIdx >= 0) { sigma.push(covariance.sigma[histIdx]); sigmaSource.push("historical"); }
    else { sigma.push(0); sigmaSource.push("historical"); }

    scores.push(pos.scoreOverride ?? opts.scoreDefault ?? 50);
  }

  // μ-Winsorizing: daempft extreme historische Renditeschaetzungen (z.B. ein
  // Titel mit starker Kursrally im Historie-Fenster), BEVOR sie in die
  // Max-Sharpe-Gewichtung einfliessen. Overrides bleiben unangetastet.
  const muMin = opts.muWinsorizeMin === null ? null : (opts.muWinsorizeMin ?? DEFAULT_MU_WINSORIZE_MIN);
  const muMax = opts.muWinsorizeMax === null ? null : (opts.muWinsorizeMax ?? DEFAULT_MU_WINSORIZE_MAX);
  let muForAllocation = mu;
  const muWasWinsorized: boolean[] = usableTickers.map(() => false);
  if (muMin != null && muMax != null) {
    const winsorized = winsorizeMuArray(mu, muSource, muMin, muMax);
    muForAllocation = winsorized.mu;
    winsorized.clippedTickerIndices.forEach(i => { muWasWinsorized[i] = true; });
    if (winsorized.clippedTickerIndices.length > 0) {
      const clippedNames = winsorized.clippedTickerIndices.map(i => usableTickers[i]).join(", ");
      flags.push(`μ-Winsorizing angewendet auf [${(muMin * 100).toFixed(0)}%, ${(muMax * 100).toFixed(0)}%] p.a. für: ${clippedNames} — historische Rendite wurde gedämpft, um Overfitting auf vergangene Kursrallys zu vermeiden.`);
    }
  }

  // Σ-Teilmatrix nur für usable Ticker MIT Historie aufbauen. Ticker mit
  // reinem Override (keine Historie) bekommen eine Diagonal-Naeherung
  // (Kovarianz zu anderen Titeln unbekannt -> 0 angenommen, transparent
  // geflaggt) -- besser als sie komplett auszuschliessen, wenn der User
  // bewusst einen Override gesetzt hat.
  const Sigma: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  let anyDiagonalApproximation = false;
  for (let i = 0; i < n; i++) {
    const histI = covariance.tickersAligned.indexOf(usableTickers[i]);
    for (let j = 0; j < n; j++) {
      const histJ = covariance.tickersAligned.indexOf(usableTickers[j]);
      if (histI >= 0 && histJ >= 0) {
        Sigma[i][j] = covariance.Sigma[histI][histJ];
      } else if (i === j) {
        Sigma[i][j] = sigma[i] * sigma[i]; // eigene Varianz aus Override
        if (histI < 0) anyDiagonalApproximation = true;
      } else {
        Sigma[i][j] = 0; // keine Korrelationsinformation verfuegbar
      }
    }
  }
  if (anyDiagonalApproximation) {
    flags.push("Für mindestens einen Override-Ticker ohne Historie wurde die Korrelation zu anderen Titeln als 0 angenommen (Diagonal-Näherung) -- keine Kovarianzdaten verfügbar.");
  }

  // Dynamisches maxWeight (Folge-Ticket 10.08.2026): der User-/Policy-Wert
  // wird IMMER auf mindestens 1/n angehoben, bevor er in die Optimierung
  // geht. Ein Cap unter 1/n ist bei n Titeln nie erfüllbar und wuerde sonst
  // exakt denselben "Maske zeigt X, Wirkung ist Y"-Effekt erzeugen wie der
  // urspruengliche Equal-Weight-Bug -- daher harter Floor, transparent geflaggt.
  const userMaxWeight = opts.maxWeight ?? DEFAULT_MAX_WEIGHT;
  const maxWeightResolution = resolveEffectiveMaxWeight(userMaxWeight, n);
  const effectiveMaxWeight = maxWeightResolution.effectiveMaxWeight;
  if (maxWeightResolution.wasFloorApplied) {
    flags.push(`maxWeight=${(userMaxWeight * 100).toFixed(0)}% liegt unter der bei ${n} Titeln erreichbaren Untergrenze (1/${n}=${(maxWeightResolution.minFeasible * 100).toFixed(0)}%) -- effektiv auf ${(effectiveMaxWeight * 100).toFixed(0)}% angehoben, damit Σw=1 erfüllbar bleibt.`);
  }
  if (maxWeightResolution.capForcesEqualWeight) {
    const suggested = suggestedMaxWeightDefault(n);
    flags.push(`maxWeight=${(effectiveMaxWeight * 100).toFixed(0)}% liegt so nah an 1/${n}=${(maxWeightResolution.minFeasible * 100).toFixed(0)}%, dass der Cap Equal-Weight praktisch erzwingt -- Modus A (Max-Sharpe) kann dadurch keine differenzierte Struktur zeigen. Empfehlung: maxWeight auf ${(suggested * 100).toFixed(0)}% erhöhen.`);
  }

  const allocResult = allocate({ tickers: usableTickers, mu: muForAllocation, Sigma, rf, scores, maxWeight: effectiveMaxWeight, kappa: undefined });
  flags.push(...allocResult.notes);
  const fallbackReason: EngineResult["fallbackReason"] = allocResult.solveFailed
    ? "solve_failed"
    : allocResult.capWasInfeasible
      ? "cap_infeasible"
      : null;

  const report = sharpeReport({ w: allocResult.weights, mu: muForAllocation, Sigma, rf });
  const concentration = assessConcentration(allocResult.weights, Sigma);
  flags.push(...concentration.flags);

  // Ist-Gewichte aus aktuellem Marktwert (nur für Positionen mit gültigem Kurs).
  const marketValues = usableTickers.map(t => {
    const pos = positionByTicker.get(t)!;
    if (pos.lastPrice == null || !isFinite(pos.lastPrice) || pos.lastPrice <= 0 || pos.qty <= 0) return null;
    return pos.qty * pos.lastPrice;
  });
  const totalMarketValue = marketValues.reduce((s: number, v) => s + (v ?? 0), 0);

  const kellyFraction = opts.kellyFraction ?? 0.5;
  const kellyMaxF = opts.kellyMaxF ?? 0.25;

  const rows: EngineRow[] = usableTickers.map((ticker, i) => {
    // Kelly rechnet bewusst auf dem UNGECLIPPTEN μ weiter -- Winsorizing ist
    // eine CAPM/Max-Sharpe-Massnahme gegen Overfitting im Basket, Kelly bleibt
    // die separate Einzeltitel-Kennzahl (Zwecktrennung laut kelly.ts §D.1).
    const fStar = kellyContinuous(mu[i], sigma[i], rf);
    const policy = applyKellyPolicy(fStar, { fraction: kellyFraction, maxF: kellyMaxF });
    return {
      ticker,
      mu: muForAllocation[i],
      muSource: muSource[i],
      muWasWinsorized: muWasWinsorized[i],
      sigma: sigma[i],
      sigmaSource: sigmaSource[i],
      score: scores[i],
      weightCapm: allocResult.weights[i],
      weightMarket: (marketValues[i] != null && totalMarketValue > 0) ? marketValues[i]! / totalMarketValue : null,
      basketAmount: allocResult.weights[i] * capital,
      sharpeSingle: report.sharpeSingle[i] ?? null,
      kelly: { fStar: policy.fStar, fHalf: policy.fHalf, fCapped: policy.fCapped, amountEuro: policy.fCapped * capital },
    };
  });

  return {
    status: "ok",
    mode: allocResult.mode,
    rows,
    sharpePortfolio: report.sharpePortfolio,
    sharpeEqualWeight: report.sharpeEqualWeight,
    deltaVsEqual: report.deltaVsEqual,
    covariance,
    concentration,
    excludedTickers,
    fallbackReason,
    userMaxWeight,
    effectiveMaxWeight,
    wasFloorApplied: maxWeightResolution.wasFloorApplied,
    capForcesEqualWeight: maxWeightResolution.capForcesEqualWeight,
    flags,
  };
}
