/**
 * Portfolio-Backtest vs. Benchmark — ex-post Performance-Attribution (P1).
 *
 * Sprint B2 (SPRINT_B2_PORTFOLIO_BACKTEST.md / WORK_PORTFOLIO_BACKTEST.md).
 * Reine, netzwerkfreie Berechnungsfunktionen fuer:
 *   - taegliche Portfolio-Rendite (Buy-and-Hold, Gewichte fix ab Entry-Datum, §2.1/§4 Variante A)
 *   - kumulative Equity-Curve Portfolio vs. Benchmark (§2.2)
 *   - Alpha/Beta per einfacher OLS-Regression (CAPM, annualisiert) + Information Ratio (§2.3)
 *   - Max Drawdown + Underwater-Serie inkl. schlimmster Phase (§2.4)
 *   - Up-/Down-Capture (§2.5)
 *   - Hit Rate + Profit Factor (§2.6)
 *   - Contribution-Attribution pro Titel und Sektor (§2.7)
 *
 * NICHT Bestandteil: WORK_SIGNAL_BACKTEST.md (B3, PIT-Signal-Backtest der Scoring-Pipeline)
 * -- das ist ein separates, groesseres Vorhaben und wird hier nicht vorweggenommen.
 *
 * Zahlen-Prinzip (verbindlich, wie positions.ts/engine.ts): bei unzureichender
 * Historie NIEMALS geschaetzte/interpolierte Werte liefern -- statt eines
 * PortfolioBacktestResult wird `{ status: "insufficient_data" }` zurueckgegeben.
 *
 * Additiv: komplett neue Datei, aendert keine bestehende Datei. `engine.ts`
 * (computePortfolioFromPositions/computeMarketWeights) wird NICHT veraendert,
 * nur importiert bzw. gar nicht benoetigt -- dieses Modul ist unabhaengig.
 */

import type { PortfolioPosition } from "./positions";

// ---------------------------------------------------------------------------
// 3. Datenmodell (WORK_PORTFOLIO_BACKTEST.md §3, 1:1 uebernommen)
// ---------------------------------------------------------------------------

export interface PortfolioBacktestPoint {
  date: string; // YYYY-MM-DD
  portfolioCum: number; // 1.0 = Start
  benchmarkCum: number;
  drawdown: number; // 0 … negativ
}

export interface HoldingAttribution {
  ticker: string;
  weightPct: number;
  contributionPct: number; // zum Gesamt-Alpha
  alphaPct: number; // Einzel-Alpha vs. Benchmark
  volPct: number; // annualisierte Volatilitaet
  beta: number;
  retVol: number; // Return / Vol
  maxDdPct: number;
  days: number; // Haltedauer in Handelstagen
  sector?: string;
}

export interface SectorAggregate {
  sector: string;
  weightPct: number;
  contributionPct: number;
}

export type PortfolioBacktestStatus = "ok" | "insufficient_data";

export interface PortfolioBacktestResult {
  status: "ok";

  // Meta
  startDate: string;
  endDate: string;
  tradingDays: number;
  benchmark: string;

  // Kurven
  series: PortfolioBacktestPoint[];

  // Summary
  totalReturnPct: number;
  benchmarkReturnPct: number;
  alphaAnnualPct: number;
  beta: number;
  informationRatio: number;
  maxDrawdownPct: number;
  maxDrawdownDays: number;
  maxDrawdownStart: string;
  maxDrawdownEnd: string;

  // Capture & Quality
  upCapturePct: number;
  downCapturePct: number;
  hitRatePct: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;

  // Attribution
  holdings: HoldingAttribution[];
  sectorAggregates: SectorAggregate[];
}

export interface PortfolioBacktestInsufficientData {
  status: "insufficient_data";
  reason: string;
  commonTradingDays: number;
}

export type PortfolioBacktestOutput = PortfolioBacktestResult | PortfolioBacktestInsufficientData;

/** Mindestanzahl gemeinsamer Handelstage (Spec §4 Robustheit). */
export const MIN_COMMON_TRADING_DAYS = 20;
/** Maximale Forward-Fill-Laenge in Handelstagen (Spec §4 Robustheit). */
const MAX_FORWARD_FILL_DAYS = 3;
const TRADING_DAYS_PER_YEAR = 252;

// ---------------------------------------------------------------------------
// Hilfsfunktionen: Kalender + Forward-Fill (Spec §4 Schritt 1 + Robustheit)
// ---------------------------------------------------------------------------

export interface PriceBar {
  date: string;
  close: number;
}

/**
 * Baut fuer eine Preisserie eine Lookup-Funktion mit Forward-Fill (max.
 * MAX_FORWARD_FILL_DAYS Handelstage seit dem letzten bekannten Kurs). Liefert
 * null, wenn kein Kurs <= date existiert oder die Fill-Distanz ueberschritten
 * ist -- niemals einen erfundenen Wert (Zahlen-Prinzip).
 */
function buildForwardFillLookup(series: PriceBar[], calendar: string[]): Map<string, number | null> {
  const sorted = [...series].filter(p => isFinite(p.close) && p.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map<string, number>();
  for (const p of sorted) byDate.set(p.date, p.close);

  const result = new Map<string, number | null>();
  let lastClose: number | null = null;
  let daysSinceLast = 0;
  for (const date of calendar) {
    if (byDate.has(date)) {
      lastClose = byDate.get(date)!;
      daysSinceLast = 0;
      result.set(date, lastClose);
    } else if (lastClose != null && daysSinceLast < MAX_FORWARD_FILL_DAYS) {
      daysSinceLast++;
      result.set(date, lastClose);
    } else {
      daysSinceLast++;
      result.set(date, null);
    }
  }
  return result;
}

/** Tagesrenditen aus einer Preis-Lookup-Map ueber einen gemeinsamen Kalender (r_t = P_t/P_t-1 - 1). */
function dailyReturnsFromLookup(calendar: string[], priceByDate: Map<string, number | null>): (number | null)[] {
  const out: (number | null)[] = [calendar.length > 0 ? null : null];
  for (let i = 1; i < calendar.length; i++) {
    const prev = priceByDate.get(calendar[i - 1]);
    const cur = priceByDate.get(calendar[i]);
    if (prev == null || cur == null || prev <= 0) { out.push(null); continue; }
    out.push(cur / prev - 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// §2.3 OLS-Regression (Alpha/Beta) + Information Ratio
// ---------------------------------------------------------------------------

export interface OlsRegressionResult {
  alphaDaily: number; // taegliches Alpha (Residuen-Mittelwert der Regression, Dezimal)
  beta: number;
  residualStdDev: number; // sigma(epsilon), taeglich
}

/**
 * Einfache lineare Regression y = alpha + beta*x + epsilon (OLS, kleinste
 * Quadrate) ueber Excess-Returns. Erwartet gleich lange, bereits gefilterte
 * (paarweise vollstaendige) Arrays. Gibt null zurueck bei < 2 Punkten oder
 * Varianz(x) = 0 (kein Least-Squares-Fit moeglich).
 */
export function olsRegression(y: number[], x: number[]): OlsRegressionResult | null {
  const n = Math.min(y.length, x.length);
  if (n < 2) return null;
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += x[i]; sumY += y[i]; }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - meanX) * (y[i] - meanY);
    sxx += (x[i] - meanX) * (x[i] - meanX);
  }
  if (sxx === 0) return null;
  const beta = sxy / sxx;
  const alpha = meanY - beta * meanX;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const predicted = alpha + beta * x[i];
    const resid = y[i] - predicted;
    sse += resid * resid;
  }
  // Stichproben-Varianz der Residuen (n-2 Freiheitsgrade bei 2 Parametern);
  // bei n=2 (0 Freiheitsgrade) Fallback auf n, um Division durch 0 zu vermeiden.
  const dof = n > 2 ? n - 2 : n;
  const residualVariance = sse / dof;
  const residualStdDev = Math.sqrt(Math.max(0, residualVariance));
  return { alphaDaily: alpha, beta, residualStdDev };
}

// ---------------------------------------------------------------------------
// §2.4 Max Drawdown & Underwater
// ---------------------------------------------------------------------------

export interface DrawdownPhase {
  startDate: string;
  endDate: string;
  days: number;
  drawdownPct: number; // negativ
}

export interface DrawdownAnalysis {
  drawdowns: number[]; // pro Punkt, 0..negativ, gleiche Laenge wie dates
  maxDrawdownPct: number;
  worstPhase: DrawdownPhase | null;
  /** Die 2-3 naechstschlimmeren, nicht ueberlappenden Phasen (fuer Marker, Spec §4 Schritt 5). */
  otherPhases: DrawdownPhase[];
}

/**
 * Laufender Peak -> Drawdown-Serie (§2.4) + Extraktion der schlimmsten
 * (und einiger weiterer) Underwater-Phasen anhand von Peak->Trough->Recovery-
 * Segmenten. `cumSeries` ist die kumulative Equity-Curve (C_t, 0 = Start).
 */
export function computeDrawdownAnalysis(dates: string[], cumSeries: number[]): DrawdownAnalysis {
  const n = Math.min(dates.length, cumSeries.length);
  const drawdowns: number[] = new Array(n).fill(0);
  let peak = -Infinity;
  let peakIdx = 0;
  const phases: DrawdownPhase[] = [];
  let inDrawdown = false;
  let phaseStartIdx = 0;
  let phaseTroughDd = 0;

  for (let i = 0; i < n; i++) {
    const level = 1 + cumSeries[i]; // Index-Level, C_t=0 -> Level 1.0
    if (level > peak) {
      // Neuer Peak erreicht -- vorherige Drawdown-Phase (falls vorhanden) abschliessen.
      if (inDrawdown) {
        phases.push({
          startDate: dates[peakIdx],
          endDate: dates[i - 1] ?? dates[peakIdx],
          days: Math.max(0, (i - 1) - peakIdx),
          drawdownPct: phaseTroughDd,
        });
        inDrawdown = false;
      }
      peak = level;
      peakIdx = i;
      drawdowns[i] = 0;
    } else {
      const dd = peak > 0 ? (level - peak) / peak : 0;
      drawdowns[i] = dd;
      if (dd < 0) {
        if (!inDrawdown) { inDrawdown = true; phaseStartIdx = peakIdx; phaseTroughDd = dd; }
        else if (dd < phaseTroughDd) phaseTroughDd = dd;
      }
    }
  }
  // Laufende (noch nicht per neuem Peak abgeschlossene) Phase am Serienende erfassen.
  if (inDrawdown) {
    phases.push({
      startDate: dates[peakIdx],
      endDate: dates[n - 1],
      days: Math.max(0, (n - 1) - peakIdx),
      drawdownPct: phaseTroughDd,
    });
  }
  void phaseStartIdx; // nur zur Lesbarkeit oben verwendet, kein weiterer Gebrauch

  const maxDrawdownPct = drawdowns.length > 0 ? Math.min(...drawdowns) : 0;
  const sortedPhases = [...phases].sort((a, b) => a.drawdownPct - b.drawdownPct);
  const worstPhase = sortedPhases[0] ?? null;
  const otherPhases = sortedPhases.slice(1, 3);

  return { drawdowns, maxDrawdownPct, worstPhase, otherPhases };
}

// ---------------------------------------------------------------------------
// §2.5 Up-/Down-Capture, §2.6 Hit Rate & Profit Factor
// ---------------------------------------------------------------------------

export function computeCaptureRatios(portfolioReturns: number[], benchmarkReturns: number[]): { upCapture: number | null; downCapture: number | null } {
  const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
  let upP = 0, upB = 0, upN = 0;
  let downP = 0, downB = 0, downN = 0;
  for (let i = 0; i < n; i++) {
    const rb = benchmarkReturns[i];
    const rp = portfolioReturns[i];
    if (rb > 0) { upP += rp; upB += rb; upN++; }
    else if (rb < 0) { downP += rp; downB += rb; downN++; }
  }
  const upCapture = upN > 0 && upB !== 0 ? (upP / upN) / (upB / upN) : null;
  const downCapture = downN > 0 && downB !== 0 ? (downP / downN) / (downB / downN) : null;
  return { upCapture, downCapture };
}

export interface HitRateAndProfitFactor {
  hitRate: number | null; // Anteil Perioden mit r > 0
  profitFactor: number | null; // Sum(positive) / |Sum(negative)|
  avgWin: number | null;
  avgLoss: number | null;
}

export function computeHitRateAndProfitFactor(returns: number[]): HitRateAndProfitFactor {
  const valid = returns.filter(r => isFinite(r));
  if (valid.length === 0) return { hitRate: null, profitFactor: null, avgWin: null, avgLoss: null };
  const wins = valid.filter(r => r > 0);
  const losses = valid.filter(r => r < 0);
  const hitRate = wins.length / valid.length;
  const sumWins = wins.reduce((a, b) => a + b, 0);
  const sumLosses = losses.reduce((a, b) => a + b, 0); // negativ
  const profitFactor = sumLosses !== 0 ? sumWins / Math.abs(sumLosses) : (sumWins > 0 ? Infinity : null);
  const avgWin = wins.length > 0 ? sumWins / wins.length : null;
  const avgLoss = losses.length > 0 ? sumLosses / losses.length : null;
  return { hitRate, profitFactor, avgWin, avgLoss };
}

// ---------------------------------------------------------------------------
// Haupteinstieg: Backtest fuer das gesamte Portfolio (P1, offene Long-Positionen)
// ---------------------------------------------------------------------------

export interface BacktestPositionInput {
  ticker: string;
  entryPrice: number;
  qty: number;
  openedAt: string; // ISO-Datum
  sector?: string;
}

export interface ComputePortfolioBacktestArgs {
  positions: BacktestPositionInput[]; // NUR offene Long-Positionen (Aufrufer filtert, Spec §10: "keine Short-Positionen")
  historicalPricesByTicker: Record<string, PriceBar[] | undefined>;
  benchmarkTicker: string;
  benchmarkPrices: PriceBar[] | undefined;
  /** Risikofreier Zins p.a., Dezimal (z.B. 0.03 = 3%) -- aus policy.rfPct. */
  riskFreeRateAnnual: number;
  /** "Heute" fuer die Look-ahead-Grenze (Default: new Date()). Nur Preise <= today fliessen ein. */
  today?: Date;
}

/**
 * Ermittelt Buy-and-Hold-Gewichte fix zum Entry-Datum je Ticker (Spec §4
 * Schritt 2, Variante A): w_i = Qty_i * EntryPrice_i / Summe_j(Qty_j * EntryPrice_j).
 * Bei mehreren Positionen im selben Ticker werden Qty addiert (gewichteter
 * Durchschnitts-Entry ueber den Marktwert bei Entry).
 */
function computeEntryFixedWeights(positions: BacktestPositionInput[]): Map<string, number> {
  const notionalByTicker = new Map<string, number>();
  for (const p of positions) {
    const upper = p.ticker.toUpperCase();
    const notional = p.qty * p.entryPrice;
    if (!isFinite(notional) || notional <= 0) continue;
    notionalByTicker.set(upper, (notionalByTicker.get(upper) ?? 0) + notional);
  }
  const total = Array.from(notionalByTicker.values()).reduce((a, b) => a + b, 0);
  const weights = new Map<string, number>();
  if (total <= 0) return weights;
  for (const [ticker, notional] of Array.from(notionalByTicker.entries())) weights.set(ticker, notional / total);
  return weights;
}

export function computePortfolioBacktest(args: ComputePortfolioBacktestArgs): PortfolioBacktestOutput {
  const { positions, historicalPricesByTicker, benchmarkTicker, benchmarkPrices, riskFreeRateAnnual } = args;
  const today = args.today ?? new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const usablePositions = positions.filter(p => {
    const series = historicalPricesByTicker[p.ticker.toUpperCase()];
    return series && series.length > 0 && isFinite(p.entryPrice) && p.entryPrice > 0 && isFinite(p.qty) && p.qty > 0;
  });

  if (usablePositions.length === 0 || !benchmarkPrices || benchmarkPrices.length === 0) {
    return { status: "insufficient_data", reason: "Keine nutzbaren Positionen oder keine Benchmark-Historie.", commonTradingDays: 0 };
  }

  // Schritt 1: gemeinsamer Kalender -- Intersection der Handelstage aller
  // Positionen + Benchmark, begrenzt auf den spaetesten gemeinsamen Entry
  // (keine Preise vor Entry der jeweiligen Position beruecksichtigen) und
  // nie ueber "heute" hinaus (keine Look-ahead-Daten, Spec §4 Punkt 4).
  const earliestUsablePerPosition = usablePositions.map(p => p.openedAt.slice(0, 10));
  const latestEntryDate = earliestUsablePerPosition.reduce((a, b) => (b > a ? b : a));

  const dateSets = usablePositions.map(p => new Set(
    (historicalPricesByTicker[p.ticker.toUpperCase()] ?? [])
      .filter(bar => bar.date <= todayStr)
      .map(bar => bar.date)
  ));
  const benchmarkDateSet = new Set(benchmarkPrices.filter(bar => bar.date <= todayStr).map(bar => bar.date));

  let commonDates = Array.from(benchmarkDateSet);
  for (const s of dateSets) commonDates = commonDates.filter(d => s.has(d));
  commonDates = commonDates.filter(d => d >= latestEntryDate && d <= todayStr).sort();

  if (commonDates.length < MIN_COMMON_TRADING_DAYS) {
    return {
      status: "insufficient_data",
      reason: `Nur ${commonDates.length} gemeinsame Handelstage (mind. ${MIN_COMMON_TRADING_DAYS} erforderlich).`,
      commonTradingDays: commonDates.length,
    };
  }

  // Schritt: Forward-Fill-Lookups je Ticker + Benchmark ueber den gemeinsamen Kalender.
  const priceLookupByTicker = new Map<string, Map<string, number | null>>();
  for (const p of usablePositions) {
    const upper = p.ticker.toUpperCase();
    if (priceLookupByTicker.has(upper)) continue;
    priceLookupByTicker.set(upper, buildForwardFillLookup(historicalPricesByTicker[upper]!, commonDates));
  }
  const benchmarkLookup = buildForwardFillLookup(benchmarkPrices, commonDates);

  // Schritt 2 (Variante A, Buy-and-Hold): Gewichte fix ab Entry-Datum.
  const fixedWeights = computeEntryFixedWeights(usablePositions);
  const tickers = Array.from(fixedWeights.keys());
  if (tickers.length === 0) {
    return { status: "insufficient_data", reason: "Keine positiven Notional-Gewichte berechenbar.", commonTradingDays: commonDates.length };
  }

  // Taegliche Renditen je Ticker + Benchmark.
  const returnsByTicker = new Map<string, (number | null)[]>();
  for (const ticker of tickers) returnsByTicker.set(ticker, dailyReturnsFromLookup(commonDates, priceLookupByTicker.get(ticker)!));
  const benchmarkReturnsRaw = dailyReturnsFromLookup(commonDates, benchmarkLookup);

  // §2.1 Portfolio-Tagesrendite: gewichtete Summe der Einzel-Renditen (Tage mit
  // fehlender Rendite fuer EINEN Ticker -- durch Forward-Fill i.d.R. selten --
  // werden fuer diesen Ticker mit 0-Beitrag behandelt, sonst wuerde eine einzelne
  // Datenluecke die ganze Serie zerstoeren; das ist konservativer als NaN-Propagation).
  const portfolioReturns: number[] = [];
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < commonDates.length; i++) {
    let rp = 0;
    for (const ticker of tickers) {
      const w = fixedWeights.get(ticker)!;
      const r = returnsByTicker.get(ticker)![i];
      if (r != null) rp += w * r;
    }
    const rb = benchmarkReturnsRaw[i];
    if (rb == null) continue; // Benchmark-Luecke -> Tag ueberspringen (Spec §4 Robustheit)
    portfolioReturns.push(rp);
    benchmarkReturns.push(rb);
  }

  const effectiveDates = commonDates.slice(commonDates.length - portfolioReturns.length);
  if (portfolioReturns.length < MIN_COMMON_TRADING_DAYS) {
    return { status: "insufficient_data", reason: "Zu wenige gueltige Renditepaare nach Bereinigung.", commonTradingDays: portfolioReturns.length };
  }

  // §2.2 Kumulative Kurven.
  const portfolioCum: number[] = [];
  const benchmarkCum: number[] = [];
  let cp = 1, cb = 1;
  for (let i = 0; i < portfolioReturns.length; i++) {
    cp *= 1 + portfolioReturns[i];
    cb *= 1 + benchmarkReturns[i];
    portfolioCum.push(cp - 1);
    benchmarkCum.push(cb - 1);
  }

  // §2.3 OLS Alpha/Beta auf Excess-Returns + Information Ratio.
  const rfDaily = riskFreeRateAnnual / TRADING_DAYS_PER_YEAR;
  const excessPortfolio = portfolioReturns.map(r => r - rfDaily);
  const excessBenchmark = benchmarkReturns.map(r => r - rfDaily);
  const ols = olsRegression(excessPortfolio, excessBenchmark);
  const alphaAnnualPct = ols ? ols.alphaDaily * TRADING_DAYS_PER_YEAR * 100 : 0;
  const beta = ols ? ols.beta : 0;
  const trackingErrorAnnual = ols ? ols.residualStdDev * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;
  const informationRatio = ols && trackingErrorAnnual > 0 ? (ols.alphaDaily * TRADING_DAYS_PER_YEAR) / trackingErrorAnnual : 0;

  // §2.4 Drawdown/Underwater.
  const ddAnalysis = computeDrawdownAnalysis(effectiveDates, portfolioCum);

  // §2.5/§2.6.
  const { upCapture, downCapture } = computeCaptureRatios(portfolioReturns, benchmarkReturns);
  const { hitRate, profitFactor, avgWin, avgLoss } = computeHitRateAndProfitFactor(portfolioReturns);

  const series: PortfolioBacktestPoint[] = effectiveDates.map((date, i) => ({
    date,
    portfolioCum: portfolioCum[i],
    benchmarkCum: benchmarkCum[i],
    drawdown: ddAnalysis.drawdowns[i] ?? 0,
  }));

  // §2.7 Holdings-Attribution: pro Titel eigene Renditeserie vs. Benchmark.
  const holdings: HoldingAttribution[] = [];
  for (const p of usablePositions) {
    const upper = p.ticker.toUpperCase();
    if (holdings.some(h => h.ticker === upper)) continue; // Duplikate (mehrere Teil-Positionen) nur einmal listen
    const rSeriesRaw = returnsByTicker.get(upper)!;
    const rSeries: number[] = [];
    const rbSeries: number[] = [];
    for (let i = 1; i < commonDates.length; i++) {
      const r = rSeriesRaw[i];
      const rb = benchmarkReturnsRaw[i];
      if (r == null || rb == null) continue;
      rSeries.push(r);
      rbSeries.push(rb);
    }
    const tickerOls = olsRegression(rSeries.map(r => r - rfDaily), rbSeries.map(r => r - rfDaily));
    const tickerBeta = tickerOls ? tickerOls.beta : 0;
    const tickerAlphaAnnualPct = tickerOls ? tickerOls.alphaDaily * TRADING_DAYS_PER_YEAR * 100 : 0;
    const meanDaily = rSeries.length > 0 ? rSeries.reduce((a, b) => a + b, 0) / rSeries.length : 0;
    const varianceDaily = rSeries.length > 1
      ? rSeries.reduce((a, b) => a + (b - meanDaily) ** 2, 0) / (rSeries.length - 1)
      : 0;
    const volPct = Math.sqrt(Math.max(0, varianceDaily) * TRADING_DAYS_PER_YEAR) * 100;
    const totalReturnPct = rSeries.reduce((acc, r) => acc * (1 + r), 1) - 1;
    const retVol = volPct > 0 ? (totalReturnPct * 100) / volPct : 0;

    // Eigene Cum-Serie fuer Max-DD des Einzeltitels.
    let ownCum = 1;
    const ownCumSeries: number[] = [];
    for (const r of rSeries) { ownCum *= 1 + r; ownCumSeries.push(ownCum - 1); }
    const ownDd = computeDrawdownAnalysis(effectiveDates.slice(0, ownCumSeries.length), ownCumSeries);

    const weight = fixedWeights.get(upper) ?? 0;
    // Contribution_i = w_i * (r_i - r_b), Summe der taeglichen Beitraege ueber
    // die Haltedauer (Spec §2.7) -- ausgedrueckt als kumulative Prozentgroesse.
    let contribution = 0;
    for (let i = 0; i < rSeries.length; i++) contribution += weight * (rSeries[i] - rbSeries[i]);

    holdings.push({
      ticker: upper,
      weightPct: weight * 100,
      contributionPct: contribution * 100,
      alphaPct: tickerAlphaAnnualPct,
      volPct,
      beta: tickerBeta,
      retVol,
      maxDdPct: ownDd.maxDrawdownPct * 100,
      days: rSeries.length,
      sector: p.sector,
    });
  }

  // Sektor-Aggregation (Spec §4 Schritt 8): Summe Weight + Contribution pro Sektor.
  const sectorMap = new Map<string, { weightPct: number; contributionPct: number }>();
  for (const h of holdings) {
    const sector = h.sector ?? "Unknown";
    const cur = sectorMap.get(sector) ?? { weightPct: 0, contributionPct: 0 };
    cur.weightPct += h.weightPct;
    cur.contributionPct += h.contributionPct;
    sectorMap.set(sector, cur);
  }
  const sectorAggregates: SectorAggregate[] = Array.from(sectorMap.entries())
    .map(([sector, v]) => ({ sector, weightPct: v.weightPct, contributionPct: v.contributionPct }))
    .sort((a, b) => b.weightPct - a.weightPct);

  return {
    status: "ok",
    startDate: effectiveDates[0],
    endDate: effectiveDates[effectiveDates.length - 1],
    tradingDays: effectiveDates.length,
    benchmark: benchmarkTicker.toUpperCase(),
    series,
    totalReturnPct: portfolioCum[portfolioCum.length - 1] * 100,
    benchmarkReturnPct: benchmarkCum[benchmarkCum.length - 1] * 100,
    alphaAnnualPct,
    beta,
    informationRatio,
    maxDrawdownPct: ddAnalysis.maxDrawdownPct * 100,
    maxDrawdownDays: ddAnalysis.worstPhase?.days ?? 0,
    maxDrawdownStart: ddAnalysis.worstPhase?.startDate ?? effectiveDates[0],
    maxDrawdownEnd: ddAnalysis.worstPhase?.endDate ?? effectiveDates[0],
    upCapturePct: (upCapture ?? 0) * 100,
    downCapturePct: (downCapture ?? 0) * 100,
    hitRatePct: (hitRate ?? 0) * 100,
    profitFactor: profitFactor ?? 0,
    avgWinPct: (avgWin ?? 0) * 100,
    avgLossPct: (avgLoss ?? 0) * 100,
    holdings,
    sectorAggregates,
  };
}

/** Hilfsfunktion fuer Aufrufer: BacktestPositionInput aus PortfolioPosition + Sektor-Lookup bauen. */
export function toBacktestPositionInputs(
  positions: PortfolioPosition[],
  sectorByTicker: Record<string, string | undefined>,
): BacktestPositionInput[] {
  return positions
    .filter(p => p.status === "open" && p.side === "long")
    .map(p => ({
      ticker: p.ticker.toUpperCase(),
      entryPrice: p.entryPrice,
      qty: p.qty,
      openedAt: p.openedAt,
      sector: sectorByTicker[p.ticker.toUpperCase()],
    }));
}
