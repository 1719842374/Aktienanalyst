/**
 * Portfolio-Positionen — Datenmodell + reine Berechnungs-Helfer.
 *
 * Auftrag 10.08.2026 ("Portfolio UX (CAPM/Kelly) + Peer-Add/Remove Fix",
 * Teil A). Ergaenzt die bestehende Kandidaten-/Kelly-/CAPM-Logik
 * (client/src/lib/portfolio/{kelly,pipeline,sharpe,weighting}.ts, UNVERAENDERT)
 * um einen echten Positions-Tracker: Stueckzahl, Einstiegspreis, Long/Short,
 * offen/geschlossen -- fuer KPI-Zeile, Pie-Chart, Performance-Chart und die
 * Investments-Tabelle mit Analyse-Deep-Link.
 *
 * PRINZIP (verbindlich laut Ticket): Zahlen nur aus FMP/Analyse-Cache/User-
 * Eingaben -- KEIN LLM fuer Kurse, Performance oder Gewichte. Alle Funktionen
 * hier sind pure Functions ohne Netzwerkzugriff, damit sie unit-testbar sind.
 */

export type PositionSide = "long" | "short";
export type PositionStatus = "open" | "closed";

export interface PortfolioPosition {
  id: string;
  ticker: string;
  name?: string;
  side: PositionSide;
  qty: number;
  entryPrice: number;
  stopPrice?: number | null;
  openedAt: string; // ISO-Datum
  status: PositionStatus;
  closedAt?: string | null;
  exitPrice?: number | null;
  // Optionale manuelle Overrides -- falls gesetzt, haben sie Vorrang vor den
  // aus dem Analyse-Cache vorgeschlagenen Werten (Ticket A2: "User kann
  // ueberschreiben").
  scoreOverride?: number | null;
  muOverride?: number | null; // Dezimal, z.B. 0.12 = 12% p.a.
  sigmaOverride?: number | null; // Dezimal, z.B. 0.22 = 22% p.a.
  convictionOverride?: "high" | "medium" | "low" | null;
  notes?: string;
}

export interface PortfolioPolicy {
  capital: number;
  benchmark: string;
  rfPct: number; // Prozentpunkte, z.B. 3.0 = 3%
  maxWeightPct: number;
  kellyFraction: number; // z.B. 0.5 = Half-Kelly
  kellyMaxFPct: number;
  mode: "auto" | "manual";
}

export const DEFAULT_POLICY: PortfolioPolicy = {
  capital: 100000,
  benchmark: "SPY",
  rfPct: 3.0,
  maxWeightPct: 30,
  kellyFraction: 0.5,
  kellyMaxFPct: 25,
  mode: "auto",
};

export function makePosition(over: Partial<PortfolioPosition> = {}): PortfolioPosition {
  return {
    id: Math.random().toString(36).slice(2),
    ticker: "",
    side: "long",
    qty: 1,
    entryPrice: 0,
    stopPrice: null,
    openedAt: new Date().toISOString(),
    status: "open",
    closedAt: null,
    exitPrice: null,
    scoreOverride: null,
    muOverride: null,
    sigmaOverride: null,
    convictionOverride: null,
    ...over,
  };
}

/**
 * Performance einer einzelnen Position in Prozent (Dezimal, 0.1457 = +14.57%).
 * LONG: (last/entry - 1). SHORT: (entry/last - 1) -- invertiert, da eine
 * fallende Aktie fuer eine Short-Position ein Gewinn ist.
 * Gibt null zurueck, wenn last/entry fehlt oder <= 0 -- NIEMALS 0 als
 * Platzhalter fuer "kein Kurs verfuegbar" (Ticket-Vorgabe #7: "Kurs n/a").
 */
export function computePositionPerformance(entryPrice: number, lastPrice: number | null | undefined, side: PositionSide): number | null {
  if (lastPrice == null || !isFinite(lastPrice) || lastPrice <= 0) return null;
  if (!isFinite(entryPrice) || entryPrice <= 0) return null;
  return side === "long" ? (lastPrice / entryPrice - 1) : (entryPrice / lastPrice - 1);
}

/** Performance einer bereits geschlossenen Position (Exit- statt Live-Preis). */
export function computeClosedPositionPerformance(pos: PortfolioPosition): number | null {
  if (pos.exitPrice == null) return null;
  return computePositionPerformance(pos.entryPrice, pos.exitPrice, pos.side);
}

/** Marktwert einer Position (immer positiv, Richtung wird separat über `side` transportiert). */
export function computeMarketValue(qty: number, lastPrice: number | null | undefined): number | null {
  if (lastPrice == null || !isFinite(lastPrice) || lastPrice <= 0) return null;
  if (!isFinite(qty) || qty <= 0) return null;
  return qty * lastPrice;
}

export interface WeightedPosition {
  position: PortfolioPosition;
  marketValue: number | null;
  weight: number | null; // Anteil am Gesamt-Marktwert aller offenen Positionen, Dezimal
  performance: number | null;
}

/**
 * Portfolio-Gewichte fuer alle OFFENEN Positionen aus tatsaechlichem
 * Marktwert (qty * lastPrice), nicht aus Stueckzahl allein (Ticket A1,
 * Pie-Chart-Spezifikation: w_i = Marktwert_i / Summe(Marktwert)).
 * lastPriceByTicker: Map ticker(uppercase) -> letzter bekannter Kurs, null/
 * fehlend wenn kein Quote verfuegbar (dann weight=null fuer diese Position).
 */
export function computePortfolioWeights(positions: PortfolioPosition[], lastPriceByTicker: Record<string, number | null | undefined>): WeightedPosition[] {
  const openPositions = positions.filter(p => p.status === "open");
  const withValues = openPositions.map(p => {
    const lastPrice = lastPriceByTicker[p.ticker.toUpperCase()];
    const marketValue = computeMarketValue(p.qty, lastPrice);
    const performance = computePositionPerformance(p.entryPrice, lastPrice, p.side);
    return { position: p, marketValue, performance };
  });
  const totalValue = withValues.reduce((sum, w) => sum + (w.marketValue ?? 0), 0);
  return withValues.map(w => ({
    ...w,
    weight: (w.marketValue != null && totalValue > 0) ? w.marketValue / totalValue : null,
  }));
}

export interface PortfolioKPIs {
  avgActivePerformance: number | null; // KPI 1: "Profit" -- Ø Performance offener Positionen
  bestPerformer: { position: PortfolioPosition; performance: number } | null; // KPI 2
  avgRealizedPerformance: number | null; // KPI 3: Ø Performance geschlossener Positionen
}

/**
 * KPI-Zeile (Ticket A1, Screen 1). Gleichgewichtetes Mittel ueber die
 * jeweiligen Positionen (nicht wertgewichtet) -- einfachste, nachvollziehbare
 * Definition von "durchschnittliche Performance", entspricht der Referenz-UX
 * ("Durchschnittliche Performance der aktiven Investments").
 */
export function computePortfolioKPIs(positions: PortfolioPosition[], lastPriceByTicker: Record<string, number | null | undefined>): PortfolioKPIs {
  const openPositions = positions.filter(p => p.status === "open");
  const openPerfs = openPositions
    .map(p => ({ position: p, performance: computePositionPerformance(p.entryPrice, lastPriceByTicker[p.ticker.toUpperCase()], p.side) }))
    .filter((x): x is { position: PortfolioPosition; performance: number } => x.performance != null);

  const avgActivePerformance = openPerfs.length > 0
    ? openPerfs.reduce((sum, x) => sum + x.performance, 0) / openPerfs.length
    : null;

  const bestPerformer = openPerfs.length > 0
    ? openPerfs.reduce((best, x) => (x.performance > best.performance ? x : best))
    : null;

  const closedPositions = positions.filter(p => p.status === "closed");
  const closedPerfs = closedPositions
    .map(p => computeClosedPositionPerformance(p))
    .filter((x): x is number => x != null);
  const avgRealizedPerformance = closedPerfs.length > 0
    ? closedPerfs.reduce((sum, x) => sum + x, 0) / closedPerfs.length
    : null;

  return { avgActivePerformance, bestPerformer, avgRealizedPerformance };
}

export interface PortfolioPerformancePoint {
  date: string;
  performancePct: number; // Dezimal, kumulativ seit dem ersten Datenpunkt der Serie
}

/**
 * Portfolio-Performance-Zeitreihe aus historischen Preisen aller offenen
 * Positionen (Ticket A1, Screen 1: "Area/Line-Chart Performance (%)").
 * V_t = Summe_i(n_i * P_i,t) fuer LONG; SHORT-Positionen tragen mit
 * NEGATIVEM Vorzeichen zum Wert bei (ein fallender Kurs erhoeht den Wert
 * einer Short-Position) -- dokumentiert wie vom Ticket verlangt.
 * historicalPricesByTicker: ticker(uppercase) -> [{date, close}] chronologisch.
 * Nur Positionen mit vorhandener Preishistorie fliessen ein; fehlende Serien
 * werden übersprungen (kein Crash, kein Fake-Preis).
 */
export function computePortfolioPerformanceSeries(
  positions: PortfolioPosition[],
  historicalPricesByTicker: Record<string, Array<{ date: string; close: number }> | undefined>,
): PortfolioPerformancePoint[] {
  const openPositions = positions.filter(p => p.status === "open" && historicalPricesByTicker[p.ticker.toUpperCase()]?.length);
  if (openPositions.length === 0) return [];

  // Gemeinsame Datums-Achse: Schnittmenge der verfuegbaren Daten reicht nicht
  // (unterschiedliche Historienlaengen) -- nutze die Vereinigung aller Daten,
  // wobei fuer Ticker ohne Kurs an einem Datum der letzte bekannte Kurs
  // fortgeschrieben wird (Standard-Vorgehen bei ungleichen Zeitreihen).
  const allDatesSet = new Set<string>();
  for (const p of openPositions) {
    for (const pt of historicalPricesByTicker[p.ticker.toUpperCase()]!) allDatesSet.add(pt.date);
  }
  const allDates = Array.from(allDatesSet).sort();
  if (allDates.length === 0) return [];

  // Preis-Lookup je Ticker mit "letzter bekannter Kurs"-Fortschreibung.
  const priceAt: Record<string, (date: string) => number | null> = {};
  for (const p of openPositions) {
    const series = historicalPricesByTicker[p.ticker.toUpperCase()]!;
    const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
    priceAt[p.ticker.toUpperCase()] = (date: string) => {
      let last: number | null = null;
      for (const pt of sorted) {
        if (pt.date > date) break;
        last = pt.close;
      }
      return last;
    };
  }

  const values: number[] = [];
  for (const date of allDates) {
    let v = 0;
    let hasAny = false;
    for (const p of openPositions) {
      const price = priceAt[p.ticker.toUpperCase()](date);
      if (price == null) continue;
      hasAny = true;
      // SHORT traegt NEGATIV zum Portfolio-Wert bei (Dokumentation Ticket A1):
      // ein fallender Kurs bei Short erhoeht den wirtschaftlichen Wert der
      // Position, das wird hier ueber ein Minuszeichen auf den Beitrag
      // abgebildet, nicht ueber eine reale negative Preisgroesse.
      v += p.side === "long" ? p.qty * price : -p.qty * price;
    }
    if (hasAny) values.push(v);
  }
  if (values.length === 0) return [];

  const v0 = values[0];
  const result: PortfolioPerformancePoint[] = [];
  let dateIdx = 0;
  for (const date of allDates) {
    let v = 0;
    let hasAny = false;
    for (const p of openPositions) {
      const price = priceAt[p.ticker.toUpperCase()](date);
      if (price == null) continue;
      hasAny = true;
      v += p.side === "long" ? p.qty * price : -p.qty * price;
    }
    if (!hasAny) continue;
    const perf = v0 !== 0 ? (v / v0 - 1) : 0;
    result.push({ date, performancePct: perf });
    dateIdx++;
  }
  return result;
}

/** localStorage-Persistenz — EINE klare Quelle (Ticket-Vorgabe A4). */
const STORAGE_KEY_POSITIONS = "aktienanalyst_portfolio_positions_v1";
const STORAGE_KEY_POLICY = "aktienanalyst_portfolio_policy_v1";

export function loadPositionsFromStorage(): PortfolioPosition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POSITIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePositionsToStorage(positions: PortfolioPosition[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_POSITIONS, JSON.stringify(positions));
  } catch {
    // localStorage kann fehlschlagen (privater Modus, Quota) -- nie fatal,
    // die Session-State bleibt im React-State weiterhin nutzbar.
  }
}

export function loadPolicyFromStorage(): PortfolioPolicy {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POLICY);
    if (!raw) return DEFAULT_POLICY;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_POLICY, ...parsed };
  } catch {
    return DEFAULT_POLICY;
  }
}

export function savePolicyToStorage(policy: PortfolioPolicy): void {
  try {
    localStorage.setItem(STORAGE_KEY_POLICY, JSON.stringify(policy));
  } catch {
    // siehe savePositionsToStorage
  }
}

/** Conviction-Vorschlag aus Score (Ticket A2: regelbasiert, kein LLM). */
export function suggestConvictionFromScore(score: number | null | undefined): "high" | "medium" | "low" | null {
  if (score == null || !isFinite(score)) return null;
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}
