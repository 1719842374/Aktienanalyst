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
import type { PortfolioPosition } from "./positions";
import { buildCovariance, type PricePoint, type CovarianceResult } from "./covariance";
import { allocate, type WeightMode } from "./weighting";
import { sharpeReport } from "./sharpe";
import { applyKellyPolicy, kellyContinuous } from "./kelly";

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
  excludedTickers: string[]; // Positionen ohne ausreichende Historie ODER ohne Override -- nicht in der Optimierung
  flags: string[];
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
}): EngineResult {
  const { positions, historicalPricesByTicker, rf, capital } = opts;
  const flags: string[] = [];

  if (positions.length < MIN_POSITIONS_FOR_OPTIMIZATION) {
    return {
      status: "insufficient_positions", mode: null, rows: [], sharpePortfolio: null,
      sharpeEqualWeight: null, deltaVsEqual: null, covariance: null, excludedTickers: [],
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
      sharpeEqualWeight: null, deltaVsEqual: null, covariance, excludedTickers,
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

  const allocResult = allocate({ tickers: usableTickers, mu, Sigma, rf, scores, maxWeight: opts.maxWeight, kappa: undefined });
  flags.push(...allocResult.notes);

  const report = sharpeReport({ w: allocResult.weights, mu, Sigma, rf });

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
    const fStar = kellyContinuous(mu[i], sigma[i], rf);
    const policy = applyKellyPolicy(fStar, { fraction: kellyFraction, maxF: kellyMaxF });
    return {
      ticker,
      mu: mu[i],
      muSource: muSource[i],
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
    excludedTickers,
    flags,
  };
}
