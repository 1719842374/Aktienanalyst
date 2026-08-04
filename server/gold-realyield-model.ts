/**
 * TEIL B — Gold/Realzins-Modell, 1-Faktor-MVP (WORK_TEIL7_SCORING.md §7.8.8–§7.8.9)
 *
 * Ökonomische Begründung (§7.8.9 Punkt 1): Gold zahlt keinen Coupon. Die
 * Opportunitätskosten des Haltens sind der reale risikofreie Zins — invers:
 *   Realzins hoch  → Druck auf Gold
 *   Realzins tief  → Rückenwind für Gold
 *
 * Real10Y = DFII10 (primär, FRED "10-Year Treasury Inflation-Indexed Security")
 *           Fallback: DGS10 − T10YIE (nominal 10Y minus Breakeven-Inflation)
 *
 * MVP-Scope (bewusst begrenzt, siehe WORK_TEIL7_SCORING.md §6 "optional, Phase 2"):
 *   NUR 1-Faktor Real10Y wird hier umgesetzt. Multi-Faktor (β1·Real10Y + β2·DXY +
 *   β3·log(WALCL)) ist explizit Phase 2 und wird HIER NICHT implementiert — nur als
 *   TODO/Kommentar vermerkt (siehe Abschnitt "PHASE 2" unten). Voraussetzung für
 *   Phase 2 laut Spezifikation: DXY (DTWEXBGS)- und WALCL-Serien müssen business-day-
 *   aligned verfügbar sein (WALCL ist wöchentlich → LOCF-Forward-Fill nötig).
 *
 * Kalibrierungs-Defaults (§7 der WORK-Datei, exakt übernommen):
 *   OLS Window        = 252 (Handelstage, ca. 1 Jahr)
 *   Inverse Window     = 60
 *   Fair-Band          = ±10 %
 *   Stress Real         = ±15 bp
 *   Stress Gold          = ±2 %
 *   Decoupling-Gate      = corr > -0.25 (Korrelation zu schwach/positiv → Modell entkoppelt)
 *   Szenario-Schocks      = -100 bis +150 bp
 *
 * Additiv: server/gold-routes.ts wird NICHT verändert. `fetchFREDSeries` dort ist
 * nicht exportiert (liefert außerdem nur den letzten Wert, keine Zeitreihe) — für
 * das OLS-Fenster (252 Tage) wird hier eine eigene kleine Serien-Fetch-Hilfsfunktion
 * definiert (reiner HTTP/curl-Wrapper analog zum M2-YoY-Pattern in gold-routes.ts,
 * das dort bereits eine Mehrpunkt-CSV-Abfrage macht — hier nur generalisiert auf
 * eine beliebige Fensterlänge).
 */
import { execSync } from "child_process";
import type { Gate } from "./scoring-gates";

// ─── FRED-Zeitreihen-Fetch (additiv, eigenständig — dupliziert NICHT gold-routes.ts) ──

export interface FredPoint {
  date: string;
  value: number;
}

/**
 * Holt bis zu `limit` Beobachtungen einer FRED-Serie (neueste zuerst aus der API,
 * hier chronologisch aufsteigend zurückgegeben). Punkte mit fehlendem Wert (".")
 * werden herausgefiltert. Reiner HTTP-Call-Wrapper, keine Modell-Logik.
 */
export function fetchFREDSeriesHistory(seriesId: string, limit: number = 300): FredPoint[] {
  try {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&sort_order=desc&limit=${limit}`;
    const csv = execSync(`curl -s --max-time 10 "${url}" 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 12000,
    });
    const lines = csv.trim().split("\n").filter(l => l && !l.startsWith("DATE") && !l.includes("DATE,"));
    const points: FredPoint[] = [];
    for (const line of lines) {
      const parts = line.split(",");
      if (parts.length < 2) continue;
      const date = parts[0];
      const raw = parts[1];
      if (raw === "." || raw === "" || raw == null) continue;
      const value = parseFloat(raw);
      if (!isFinite(value)) continue;
      points.push({ date, value });
    }
    // FRED liefert mit sort_order=desc neueste zuerst → für Zeitreihen-Berechnungen
    // (OLS, Rolling Window) chronologisch aufsteigend zurückgeben.
    return points.reverse();
  } catch {
    return [];
  }
}

/**
 * §7.8.8 resolveReal10Y — DFII10 primär, DGS10 − T10YIE als Fallback.
 * Liefert eine chronologisch aufsteigende Real10Y-Zeitreihe (in %, nicht bp).
 *
 * Fallback-Logik pro Datum: wenn DFII10 an einem Tag fehlt, aber DGS10 und
 * T10YIE beide vorhanden sind, wird der Fallback-Wert für genau diesen Tag
 * verwendet. Tage ohne jede verwertbare Quelle werden ausgelassen (kein
 * Interpolieren/Fake-Default).
 */
export function resolveReal10Y(limit: number = 300): FredPoint[] {
  const dfii10 = fetchFREDSeriesHistory("DFII10", limit);
  if (dfii10.length > 0) {
    // Prüfen ob DFII10 allein ausreichend Coverage hat — sonst zusätzlich Fallback mergen.
    const dgs10 = fetchFREDSeriesHistory("DGS10", limit);
    const t10yie = fetchFREDSeriesHistory("T10YIE", limit);
    const dgs10ByDate = new Map(dgs10.map(p => [p.date, p.value]));
    const t10yieByDate = new Map(t10yie.map(p => [p.date, p.value]));
    const dfii10ByDate = new Map(dfii10.map(p => [p.date, p.value]));

    // Vereinigungsmenge der Daten aus allen drei Serien, damit Fallback-Tage
    // (an denen nur DGS10/T10YIE, nicht aber DFII10 vorliegt) nicht verloren gehen.
    const allDates = Array.from(new Set([
      ...dfii10.map(p => p.date),
      ...dgs10.map(p => p.date),
    ])).sort();

    const merged: FredPoint[] = [];
    for (const date of allDates) {
      const primary = dfii10ByDate.get(date);
      if (primary != null) {
        merged.push({ date, value: primary });
        continue;
      }
      const nominal = dgs10ByDate.get(date);
      const breakeven = t10yieByDate.get(date);
      if (nominal != null && breakeven != null) {
        merged.push({ date, value: nominal - breakeven });
      }
      // sonst: Tag auslassen (keine belastbare Quelle)
    }
    return merged;
  }

  // DFII10 komplett nicht verfügbar → vollständiger Fallback DGS10 − T10YIE
  const dgs10 = fetchFREDSeriesHistory("DGS10", limit);
  const t10yie = fetchFREDSeriesHistory("T10YIE", limit);
  const t10yieByDate = new Map(t10yie.map(p => [p.date, p.value]));
  const merged: FredPoint[] = [];
  for (const p of dgs10) {
    const breakeven = t10yieByDate.get(p.date);
    if (breakeven != null) merged.push({ date: p.date, value: p.value - breakeven });
  }
  return merged;
}

// ─── §7.8.8 buildGoldMacroSeries ───────────────────────────────────────────────

export interface GoldMacroPoint {
  date: string;
  goldClose: number;
  real10Y: number;
  /** All-in Sustaining Cost, quartalsweise Stufenfunktion — optional, null wenn nicht verfügbar */
  aisc: number | null;
}

/**
 * §7.8.8 buildGoldMacroSeries — kombiniert Gold-Preis-Zeitreihe mit Real10Y
 * (und optional AISC) auf gemeinsamen Handelstagen (Inner-Join auf Datum).
 * Erwartet chronologisch aufsteigend sortierte Eingabe-Serien.
 */
export function buildGoldMacroSeries(
  goldPrices: { date: string; close: number }[],
  real10Y: FredPoint[],
  aiscByDate?: Map<string, number>
): GoldMacroPoint[] {
  const real10YByDate = new Map(real10Y.map(p => [p.date, p.value]));
  const points: GoldMacroPoint[] = [];
  for (const g of goldPrices) {
    const r = real10YByDate.get(g.date);
    if (r == null || !isFinite(g.close) || g.close <= 0) continue;
    points.push({
      date: g.date,
      goldClose: g.close,
      real10Y: r,
      aisc: aiscByDate?.get(g.date) ?? null,
    });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Kalibrierungs-Defaults (§7, exakt aus WORK_TEIL7_SCORING.md) ─────────────

export const GOLD_MODEL_DEFAULTS = {
  OLS_WINDOW: 252,
  INVERSE_WINDOW: 60,
  FAIR_BAND_PCT: 0.10,      // ±10 %
  STRESS_REAL_BP: 15,        // ±15 bp
  STRESS_GOLD_PCT: 0.02,     // ±2 %
  DECOUPLING_GATE_CORR: -0.25, // Gate greift wenn corr > -0.25
  SCENARIO_SHOCKS_BP: [-100, -75, -50, -25, 0, 25, 50, 75, 100, 125, 150],
} as const;

// ─── Statistik-Hilfsfunktionen ────────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return null;
  const r = num / denom;
  return isFinite(r) ? r : null;
}

/** Simple OLS (y = a + b*x), gibt {alpha, beta, r} zurück oder null bei Degenerierung. */
function simpleOLS(xs: number[], ys: number[]): { alpha: number; beta: number; r: number } | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) return null;
  const beta = sxy / sxx;
  if (!isFinite(beta)) return null;
  const alpha = my - beta * mx;
  const r = pearsonCorrelation(xs, ys) ?? 0;
  return { alpha, beta, r };
}

// ─── §7.8.8 goldFairValueModel — OLS Gold ~ Real10Y, Rolling Window 252 ───────

export interface GoldFairValueResult {
  /** Anzahl der für die Regression verwendeten Datenpunkte (letztes Rolling-Window) */
  windowUsed: number;
  alpha: number;
  beta: number; // erwartet negativ (Realzins hoch → Gold tief)
  correlation: number;
  /** Fair Value zum letzten verfügbaren Real10Y-Wert */
  fairValue: number;
  /** aktueller Gold-Preis (letzter Punkt der Serie) */
  actualPrice: number;
  /** (actual - fairValue) / fairValue, in Prozentpunkten */
  premiumPct: number;
  /** Fair-Band ±10% (Default) — liegt actualPrice innerhalb des Bands? */
  withinFairBand: boolean;
  /** §7 Decoupling-Gate: corr > -0.25 → Modell gilt als entkoppelt (unzuverlässig) */
  decoupled: boolean;
}

/**
 * §7.8.8 goldFairValueModel — Rolling-Window-OLS-Regression Gold ~ Real10Y.
 * Nutzt standardmäßig die letzten `window` (Default 252) Punkte der Serie.
 * Gibt null zurück, wenn zu wenige Datenpunkte vorliegen (< 30, Mindestmaß für
 * eine überhaupt sinnvolle Regression — bewusst konservativ, kein Fake-Fit).
 */
export function goldFairValueModel(
  series: GoldMacroPoint[],
  window: number = GOLD_MODEL_DEFAULTS.OLS_WINDOW,
  fairBandPct: number = GOLD_MODEL_DEFAULTS.FAIR_BAND_PCT,
  decouplingGateCorr: number = GOLD_MODEL_DEFAULTS.DECOUPLING_GATE_CORR
): GoldFairValueResult | null {
  if (series.length < 30) return null;
  const slice = series.slice(-window);
  const xs = slice.map(p => p.real10Y);
  const ys = slice.map(p => p.goldClose);
  const ols = simpleOLS(xs, ys);
  if (!ols) return null;

  const last = slice[slice.length - 1];
  const fairValue = ols.alpha + ols.beta * last.real10Y;
  if (!isFinite(fairValue) || fairValue <= 0) return null;

  const premiumPct = (last.goldClose - fairValue) / fairValue;
  const withinFairBand = Math.abs(premiumPct) <= fairBandPct;
  // Decoupling-Gate: Korrelation SOLLTE stark negativ sein (Realzins hoch → Gold tief).
  // Wenn corr > decouplingGateCorr (z.B. > -0.25), gilt die Beziehung als zu schwach/
  // entkoppelt, um dem Modell zu vertrauen.
  const decoupled = ols.r > decouplingGateCorr;

  return {
    windowUsed: slice.length,
    alpha: ols.alpha,
    beta: ols.beta,
    correlation: ols.r,
    fairValue,
    actualPrice: last.goldClose,
    premiumPct,
    withinFairBand,
    decoupled,
  };
}

// ─── §7.8.8 goldRealYieldInverseScore — 1-Faktor-Score (inverse Korrelation) ──

export interface GoldRealYieldInverseScoreResult {
  windowUsed: number;
  correlation: number | null;
  /** Score -1 (Stress, Realzins steigt/Gold fällt konsistent) .. 0 (neutral/entkoppelt) .. +1 (Tailwind) */
  score: -1 | 0 | 1;
  details: string;
}

/**
 * §7.8.8 goldRealYieldInverseScore — 1-Faktor-Score basierend auf der inversen
 * Korrelation Gold vs. Real10Y über das Inverse-Window (Default 60 Tage).
 *
 * Score-Logik (deterministisch):
 *   corr <= -0.5              → +1 (starke inverse Beziehung intakt, Trend-Richtung entscheidet unten)
 *   -0.5 < corr <= decouplingGate → 0 (moderate Beziehung)
 *   corr > decouplingGate      → 0 (Decoupling — Modell nicht verlässlich, neutral statt falscher Extrempositionierung)
 *
 * Die eigentliche Richtung (Tailwind/Stress) wird zusätzlich über den Trend von
 * Real10Y im Fenster bestimmt: fällt Real10Y im Fenster → Tailwind (+1), steigt es → Stress (-1),
 * sofern die Korrelation stark genug (<= -0.5) ist, sonst neutral (0).
 */
export function goldRealYieldInverseScore(
  series: GoldMacroPoint[],
  window: number = GOLD_MODEL_DEFAULTS.INVERSE_WINDOW,
  decouplingGateCorr: number = GOLD_MODEL_DEFAULTS.DECOUPLING_GATE_CORR
): GoldRealYieldInverseScoreResult {
  if (series.length < 5) {
    return { windowUsed: 0, correlation: null, score: 0, details: "Zu wenige Datenpunkte" };
  }
  const slice = series.slice(-window);
  const xs = slice.map(p => p.real10Y);
  const ys = slice.map(p => p.goldClose);
  const corr = pearsonCorrelation(xs, ys);

  if (corr == null || corr > decouplingGateCorr) {
    return {
      windowUsed: slice.length,
      correlation: corr,
      score: 0,
      details: corr == null
        ? "Korrelation nicht berechenbar (Varianz 0)"
        : `Decoupling-Gate: corr=${corr.toFixed(2)} > ${decouplingGateCorr} → Modell entkoppelt, neutral`,
    };
  }

  const realTrend = slice[slice.length - 1].real10Y - slice[0].real10Y;
  if (realTrend < 0) {
    return {
      windowUsed: slice.length,
      correlation: corr,
      score: 1,
      details: `corr=${corr.toFixed(2)} (stark invers) + Real10Y fällt (${realTrend.toFixed(2)}pp) → Tailwind`,
    };
  }
  if (realTrend > 0) {
    return {
      windowUsed: slice.length,
      correlation: corr,
      score: -1,
      details: `corr=${corr.toFixed(2)} (stark invers) + Real10Y steigt (${realTrend.toFixed(2)}pp) → Stress`,
    };
  }
  return {
    windowUsed: slice.length,
    correlation: corr,
    score: 0,
    details: `corr=${corr.toFixed(2)} aber Real10Y flat (${realTrend.toFixed(2)}pp) → neutral`,
  };
}

// ─── §7.8.8 goldRateScenarios — Szenario-Schocks -100 bis +150 bp ─────────────

export interface GoldRateScenario {
  shockBp: number;
  shockedReal10Y: number;
  impliedGoldPrice: number;
  impliedChangePct: number;
}

/**
 * §7.8.8 goldRateScenarios — wendet die in §7 spezifizierten Szenario-Schocks
 * (-100 bis +150 bp, Default-Raster) auf das aktuelle Real10Y an und zeigt den
 * über das OLS-Fair-Value-Modell implizierten Gold-Preis je Szenario.
 * Gibt [] zurück, wenn kein Fair-Value-Modell verfügbar ist (zu wenig Daten).
 */
export function goldRateScenarios(
  series: GoldMacroPoint[],
  window: number = GOLD_MODEL_DEFAULTS.OLS_WINDOW,
  shocksBp: readonly number[] = GOLD_MODEL_DEFAULTS.SCENARIO_SHOCKS_BP
): GoldRateScenario[] {
  const fv = goldFairValueModel(series, window);
  if (!fv || series.length === 0) return [];
  const lastReal10Y = series[series.length - 1].real10Y;
  const currentPrice = series[series.length - 1].goldClose;

  return shocksBp.map(shockBp => {
    const shockedReal10Y = lastReal10Y + shockBp / 100; // bp → Prozentpunkte
    const impliedGoldPrice = fv.alpha + fv.beta * shockedReal10Y;
    const impliedChangePct = currentPrice > 0 ? (impliedGoldPrice - currentPrice) / currentPrice : 0;
    return {
      shockBp,
      shockedReal10Y,
      impliedGoldPrice: Math.max(0, impliedGoldPrice),
      impliedChangePct,
    };
  });
}

// ─── §7.8.8 deriveGoldRegimeZones — Regime-Klassifikation nach Real10Y-Trend ──

export type GoldRegime = 'stress' | 'tailwind' | 'neutral';

export interface GoldRegimeZone {
  regime: GoldRegime;
  /** Trend von Real10Y über das übergebene Fenster (Prozentpunkte, letzter - erster Wert) */
  real10YTrendPp: number;
  rationale: string;
}

/**
 * §7.8.8 deriveGoldRegimeZones — Regime-Klassifikation basierend auf dem
 * Real10Y-Trend: steigender Realzins = Stress für Gold, fallender = Tailwind,
 * ~flacher Verlauf = neutral. Schwellenwert ±5bp (0.05pp) über das Fenster,
 * um Rauschen von echtem Trend zu unterscheiden.
 */
export function deriveGoldRegimeZones(
  series: GoldMacroPoint[],
  window: number = GOLD_MODEL_DEFAULTS.INVERSE_WINDOW,
  thresholdPp: number = 0.05
): GoldRegimeZone | null {
  if (series.length < 2) return null;
  const slice = series.slice(-window);
  const trend = slice[slice.length - 1].real10Y - slice[0].real10Y;

  if (trend > thresholdPp) {
    return { regime: 'stress', real10YTrendPp: trend, rationale: `Real10Y steigt um ${trend.toFixed(2)}pp im Fenster → Gegenwind für Gold` };
  }
  if (trend < -thresholdPp) {
    return { regime: 'tailwind', real10YTrendPp: trend, rationale: `Real10Y fällt um ${trend.toFixed(2)}pp im Fenster → Rückenwind für Gold` };
  }
  return { regime: 'neutral', real10YTrendPp: trend, rationale: `Real10Y nahezu flat (${trend.toFixed(2)}pp) → kein klares Regime` };
}

// ─── Gates: GOLD_REAL_YIELD_REGIME, GOLD_AISC_STRESS ──────────────────────────
// Nutzen dasselbe generische Gate-Interface aus server/scoring-gates.ts (Teil A) —
// keine Parallelstruktur.

/**
 * GOLD_REAL_YIELD_REGIME — aktiv (warn), wenn Regime='stress' UND das Fair-Value-
 * Modell NICHT decoupled ist (sonst wäre die Warnung nicht belastbar). Cap ist
 * hier bewusst kein Score-Cap im Sinne von §0 (Gold hat keinen finalScore-Kontext
 * wie Aktien-Scoring), sondern ein informativer Gate-Eintrag mit Cap=100 (kein
 * echter Deckel) — Konsumenten können `active`+`rationale` für UI-Warnhinweise
 * nutzen, ohne dass applyGates() versehentlich einen Aktien-Score deckelt, falls
 * dieses Gate fälschlich in die Aktien-Pipeline gemischt würde.
 */
export function buildGoldRealYieldRegimeGate(
  regime: GoldRegimeZone | null,
  fairValue: GoldFairValueResult | null
): Gate {
  const active = !!regime && regime.regime === 'stress' && !(fairValue?.decoupled ?? true);
  return {
    id: 'GOLD_REAL_YIELD_REGIME',
    active,
    cap: 100,
    severity: 'warn',
    rationale: active
      ? `Realzins-Regime Stress: ${regime!.rationale}`
      : (regime ? `Kein Stress-Regime aktiv (${regime.regime})` : 'Regime nicht bestimmbar (zu wenig Daten)'),
  };
}

/**
 * GOLD_AISC_STRESS — aktiv (warn), wenn der aktuelle Gold-Preis in die Nähe der
 * All-in-Sustaining-Cost-Linie der Minenindustrie fällt (Zuschlag < 15% über AISC),
 * was strukturell ungewöhnlich ist (Angebotsseite würde unter Druck geraten).
 * Nur aktiv, wenn AISC-Daten überhaupt vorhanden sind (kein Fake-Default).
 */
export function buildGoldAiscStressGate(
  currentPrice: number,
  aisc: number | null,
  stressMarginPct: number = 0.15
): Gate {
  if (aisc == null || aisc <= 0) {
    return {
      id: 'GOLD_AISC_STRESS',
      active: false,
      cap: 100,
      severity: 'warn',
      rationale: 'AISC-Daten nicht verfügbar — Gate inaktiv (kein Fake-Default)',
    };
  }
  const marginPct = (currentPrice - aisc) / aisc;
  const active = marginPct < stressMarginPct;
  return {
    id: 'GOLD_AISC_STRESS',
    active,
    cap: 100,
    severity: active && marginPct < 0 ? 'hard' : 'warn',
    rationale: active
      ? `Gold-Preis nur ${(marginPct * 100).toFixed(1)}% über AISC (${aisc}) — Angebotsseite unter Druck`
      : `Ausreichend Abstand zu AISC (${(marginPct * 100).toFixed(1)}%)`,
  };
}

// ─── §7.8.8 runRealYieldGoldModel — Orchestrierung ────────────────────────────

export interface RealYieldGoldModelResult {
  series: GoldMacroPoint[];
  fairValue: GoldFairValueResult | null;
  inverseScore: GoldRealYieldInverseScoreResult;
  scenarios: GoldRateScenario[];
  regime: GoldRegimeZone | null;
  gates: Gate[];
  generatedAt: string;
}

/**
 * §7.8.8 runRealYieldGoldModel — orchestriert Fair-Value-OLS, Inverse-Score,
 * Szenario-Schocks, Regime-Klassifikation und die beiden Gates zu einem
 * Gesamtergebnis. 1-Faktor-MVP (Real10Y) — siehe Moduldoku für Phase-2-Hinweis.
 */
export function runRealYieldGoldModel(
  goldPrices: { date: string; close: number }[],
  real10Y: FredPoint[],
  aiscByDate?: Map<string, number>,
  currentAisc?: number | null
): RealYieldGoldModelResult {
  const series = buildGoldMacroSeries(goldPrices, real10Y, aiscByDate);
  const fairValue = goldFairValueModel(series);
  const inverseScore = goldRealYieldInverseScore(series);
  const scenarios = goldRateScenarios(series);
  const regime = deriveGoldRegimeZones(series);

  const currentPrice = series.length > 0 ? series[series.length - 1].goldClose : 0;
  const resolvedAisc = currentAisc ?? (series.length > 0 ? series[series.length - 1].aisc : null);

  const gates: Gate[] = [
    buildGoldRealYieldRegimeGate(regime, fairValue),
    buildGoldAiscStressGate(currentPrice, resolvedAisc ?? null),
  ];

  return {
    series,
    fairValue,
    inverseScore,
    scenarios,
    regime,
    gates,
    generatedAt: new Date().toISOString(),
  };
}

// ─── PHASE 2 (explizit NICHT umgesetzt, nur TODO) ─────────────────────────────
// WORK_TEIL7_SCORING.md §6: Multi-Faktor-Erweiterung G_t = α + β1·R_t + β2·DXY_t
// + β3·log(WALCL_t) + ε_t. Voraussetzung laut Spezifikation: DXY (DTWEXBGS) und
// WALCL business-day-aligned verfügbar (WALCL wöchentlich → LOCF-Forward-Fill).
// NICHT hier implementieren — nur vermerkt, damit ein Folge-Task anknüpfen kann:
//   [ ] FRED WALCL wöchentlich → LOCF auf Gold-Kalender
//   [ ] FRED DTWEXBGS daily aligned
//   [ ] Rolling multivariate OLS (Window 252) nur wenn alle drei Serien non-null
//   [ ] Vorzeichen-Check: β1 negativ, β2 negativ, β3 positiv — sonst REGIME_UNSTABLE
//   [ ] Default-Anzeige bleibt 1-Faktor Realzins (Multi-Faktor nur als Vergleichslinie)
