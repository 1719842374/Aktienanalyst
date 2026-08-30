import type { Catalyst, Risk, StockAnalysis } from "../../../shared/schema";
import {
  calculateDCF,
  type DCFParams,
  type DCFResult,
  invertedDcf,
  type InvertedDcfParams,
  type InvertedDcfResult,
  buildDefaultDCFParams,
  type FCFFDCFParams,
  RSL_MOMENTUM_MALUS_PCT,
  type FCFFDCFResult,
  calculateFCFFDCF,
  calculateRSL,
  type ReverseDCFResult,
  calculateReverseDCF,
  calculateCRV,
  calculateRiskAdjustedCRV,
  worstCaseM1,
  worstCaseM1Label,
  worstCaseM2,
  LYNCH_CLASS_BASE_DRAWDOWN,
  worstCaseM3,
  type WaccFloorResult,
  computeSectorWaccFloor,
  applyWaccFloor,
  type TvGuardResult,
  applyTerminalValueGuard,
  type MarginStressResult,
  computeMarginStress,
  type StructuralFloorResult,
  computeStructuralWorstCaseFloor,
  worstCaseStructural,
  type DivergenceFlagResult,
  computeDcfVsMarketDivergence,
  type HardenedCRVInput,
  type HardenedCRVResult,
  computeHardenedCRV,
} from "@shared/valuation-signal";

// ============================================================================
// Sprint B3 Phase 1b (WORK_SIGNAL_BACKTEST.md §3.3/§9; Ticket:
// tickets/SPRINT_B3_PHASE1B_SHARED_CRV.md): CRV/invDcf/DCF-Kern-Funktionen
// wurden UNVERAENDERT nach shared/valuation-signal.ts extrahiert, damit
// Client UND Server (server/backtest/replay.ts) dieselbe Formel-Implementierung
// verwenden — EIN Modul, KEINE zweite Berechnung. Der Re-Export unten erhaelt
// alle bisherigen Importpfade (`from "../../lib/calculations"` /
// "@/lib/calculations") fuer SummarySection.tsx, Section6.tsx, Section8.tsx,
// ReverseDCFSection.tsx etc. — reiner Refactor, UI-Verhalten und Funktions-
// signaturen unveraendert. buildSensitivityMatrix() (weiter unten in dieser
// Datei) nutzt calculateDCF()/DCFParams intern weiter unveraendert.
// ============================================================================
export {
  calculateDCF,
  type DCFParams,
  type DCFResult,
  invertedDcf,
  type InvertedDcfParams,
  type InvertedDcfResult,
  buildDefaultDCFParams,
  type FCFFDCFParams,
  RSL_MOMENTUM_MALUS_PCT,
  type FCFFDCFResult,
  calculateFCFFDCF,
  calculateRSL,
  type ReverseDCFResult,
  calculateReverseDCF,
  calculateCRV,
  calculateRiskAdjustedCRV,
  worstCaseM1,
  worstCaseM1Label,
  worstCaseM2,
  LYNCH_CLASS_BASE_DRAWDOWN,
  worstCaseM3,
  type WaccFloorResult,
  computeSectorWaccFloor,
  applyWaccFloor,
  type TvGuardResult,
  applyTerminalValueGuard,
  type MarginStressResult,
  computeMarginStress,
  type StructuralFloorResult,
  computeStructuralWorstCaseFloor,
  worstCaseStructural,
  type DivergenceFlagResult,
  computeDcfVsMarketDivergence,
  type HardenedCRVInput,
  type HardenedCRVResult,
  computeHardenedCRV,
};

// === Monte Carlo Simulation (Geometrische Brownsche Bewegung / GBM) ===
export interface GBMMonteCarloParams {
  currentPrice: number;
  mu: number;
  sigma: number;
  iterations: number;
  tradingDays: number;
}

export interface GBMMonteCarloResult {
  mean: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  histogram: { bin: string; count: number }[];
  downsideProb: number;
  downsideProb10: number;
  downsideProb20: number;
  analystPTProb: number;
  maxDrawdownMean: number;
  expectedReturn: number;
  paths: number[][];
}

function boxMuller(): number {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function gbmMonteCarlo(
  params: GBMMonteCarloParams,
  analystPTMedian: number
): GBMMonteCarloResult {
  const { currentPrice, mu, sigma, iterations, tradingDays } = params;
  const dt = 1 / 252;
  const sqrtDt = Math.sqrt(dt);
  const drift = (mu - 0.5 * sigma * sigma) * dt;

  const finalPrices: number[] = [];
  const maxDrawdowns: number[] = [];
  const samplePaths: number[][] = [];
  const sampleInterval = Math.max(1, Math.floor(iterations / 5));

  for (let i = 0; i < iterations; i++) {
    let S = currentPrice;
    let peak = S;
    let maxDD = 0;
    const isSample = samplePaths.length < 5 && i % sampleInterval === 0;
    const path: number[] = isSample ? [S] : [];

    for (let t = 0; t < tradingDays; t++) {
      const Z = boxMuller();
      S = S * Math.exp(drift + sigma * sqrtDt * Z);
      if (S > peak) peak = S;
      const dd = (peak - S) / peak;
      if (dd > maxDD) maxDD = dd;
      if (isSample && t % Math.max(1, Math.floor(tradingDays / 50)) === 0) {
        path.push(S);
      }
    }

    finalPrices.push(S);
    maxDrawdowns.push(maxDD);
    if (isSample) {
      path.push(S);
      samplePaths.push(path);
    }
  }

  finalPrices.sort((a, b) => a - b);

  const mean = finalPrices.reduce((s, v) => s + v, 0) / finalPrices.length;
  const p5 = finalPrices[Math.floor(finalPrices.length * 0.05)];
  const p10 = finalPrices[Math.floor(finalPrices.length * 0.10)];
  const p25 = finalPrices[Math.floor(finalPrices.length * 0.25)];
  const p50 = finalPrices[Math.floor(finalPrices.length * 0.50)];
  const p75 = finalPrices[Math.floor(finalPrices.length * 0.75)];
  const p90 = finalPrices[Math.floor(finalPrices.length * 0.90)];
  const p95 = finalPrices[Math.floor(finalPrices.length * 0.95)];

  const downsideProb = finalPrices.filter((r) => r < currentPrice).length / finalPrices.length;
  const downsideProb10 = finalPrices.filter((r) => r < currentPrice * 0.9).length / finalPrices.length;
  const downsideProb20 = finalPrices.filter((r) => r < currentPrice * 0.8).length / finalPrices.length;
  const analystPTProb = finalPrices.filter((r) => r >= analystPTMedian).length / finalPrices.length;
  const maxDrawdownMean = maxDrawdowns.reduce((s, v) => s + v, 0) / maxDrawdowns.length;
  const expectedReturn = mean / currentPrice - 1;

  const min = finalPrices[0];
  const max = finalPrices[finalPrices.length - 1];
  const binCount = 40;
  const binSize = (max - min) / binCount;
  const histogram: { bin: string; count: number }[] = [];

  if (binSize === 0) {
    // Alle Endpreise identisch (z.B. σ = 0) — ein einzelner Bin mit allen Pfaden
    histogram.push({ bin: `$${min.toFixed(0)}`, count: finalPrices.length });
  } else {
    for (let i = 0; i < binCount; i++) {
      const binStart = min + i * binSize;
      const binEnd = binStart + binSize;
      // Letzter Bin inklusiv — sonst fällt der Maximalwert aus dem Histogramm
      const count = finalPrices.filter((r) =>
        r >= binStart && (i === binCount - 1 ? r <= binEnd : r < binEnd)
      ).length;
      histogram.push({ bin: `$${binStart.toFixed(0)}`, count });
    }
  }

  return {
    mean, p5, p10, p25, p50, p75, p90, p95,
    histogram, downsideProb, downsideProb10, downsideProb20,
    analystPTProb, maxDrawdownMean, expectedReturn, paths: samplePaths,
  };
}

export function calculateGBMParams(prices: number[]): { mu: number; sigma: number } {
  if (prices.length < 30) return { mu: 0.08, sigma: 0.25 };

  const logReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > 0 && prices[i - 1] > 0) {
      logReturns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }

  if (logReturns.length === 0) return { mu: 0.08, sigma: 0.25 };

  const meanDaily = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const varDaily = logReturns.reduce((s, r) => s + (r - meanDaily) ** 2, 0) / logReturns.length;

  const sigma = Math.sqrt(varDaily * 252);
  // Der Mittelwert der Log-Returns schätzt bereits den Log-Drift (μ - σ²/2).
  // Wir geben den arithmetischen Drift μ zurück, da gbmMonteCarlo σ²/2 wieder abzieht
  // (drift = μ - 0.5σ²) — sonst würde σ²/2 doppelt reduziert.
  const mu = meanDaily * 252 + 0.5 * sigma * sigma;

  return { mu: +mu.toFixed(4), sigma: +sigma.toFixed(4) };
}

// === WACC Calculation ===
export function calculateWACC(
  beta: number,
  riskFreeRate: number,
  marketPremium: number,
  debtRatio: number,
  costOfDebt: number,
  taxRate: number
): number {
  const equityRatio = 1 - debtRatio;
  const costOfEquity = riskFreeRate + beta * marketPremium;
  const wacc = equityRatio * costOfEquity + debtRatio * costOfDebt * (1 - taxRate);
  return wacc;
}

// === Catalyst Calculations ===
export function calculateCatalystUpside(
  catalysts: Catalyst[],
  conservativeDCFPerShare: number
): { totalUpside: number; adjustedTarget: number } {
  const totalUpside = catalysts.reduce((sum, c) => sum + c.gb, 0);
  const adjustedTarget = conservativeDCFPerShare * (1 + totalUpside / 100);
  return { totalUpside, adjustedTarget };
}

export function selectCatalystBase(
  conservativeDCFPerShare: number,
  totalCatalystUpsidePct: number,
  currentPrice: number,
  analystPTMedian: number
): { base: number; source: "dcf" | "analyst-pt" | "current-price"; reason: string } {
  const dcfWithCatalysts = conservativeDCFPerShare * (1 + totalCatalystUpsidePct / 100);
  const realisticThreshold = currentPrice * 0.70;

  if (conservativeDCFPerShare > 0 && dcfWithCatalysts >= realisticThreshold) {
    return {
      base: conservativeDCFPerShare,
      source: "dcf",
      reason: `DCF + Catalysts ($${dcfWithCatalysts.toFixed(2)}) liegt im plausiblen Bereich (≥70% des Kurses).`,
    };
  }

  if (analystPTMedian > 0) {
    return {
      base: analystPTMedian,
      source: "analyst-pt",
      reason: `DCF $${conservativeDCFPerShare.toFixed(2)} + Catalysts hätte $${dcfWithCatalysts.toFixed(2)} (<70% Kurs) ergeben — Verzerrung wahrscheinlich. Fallback auf Analyst-PT-Median.`,
    };
  }

  return {
    base: currentPrice,
    source: "current-price",
    reason: `DCF & Analyst-PT nicht verwertbar — Kurs als Basis (Catalysts modifizieren ab Marktpreis).`,
  };
}

// === DCF Sensitivity Matrix ===
export function buildSensitivityMatrix(
  baseDCF: DCFParams,
  sharesOutstanding: number
): { waccLabel: string; growthLabel: string; value: number }[] {
  const waccDeltas = [-1, 0, 1];
  const growthDeltas = [-2, 0, 2];
  const results: { waccLabel: string; growthLabel: string; value: number }[] = [];

  for (const wd of waccDeltas) {
    for (const gd of growthDeltas) {
      const r = calculateDCF({
        ...baseDCF,
        wacc: baseDCF.wacc + wd,
        g1: baseDCF.g1 + gd,
        g2: baseDCF.g2 + gd / 2,
      });
      results.push({
        waccLabel: `WACC ${wd >= 0 ? "+" : ""}${wd}%`,
        growthLabel: `g ${gd >= 0 ? "+" : ""}${gd}%`,
        value: r.perShare,
      });
    }
  }
  return results;
}

// === Helpers ===
function fmt(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(2)}`;
}

function fmtShares(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toFixed(0);
}

// === WORK_REVERSE_DCF_BRIDGE.md TEIL 1 — realizedGrowth8Q + gapRatio ===
// Wichtig: referenceGrowth in calculateReverseDCF() (siehe oben, Zeile ~620-672) ist
// KEINE historische Realized-Growth-Referenz — es ist max(sectorG1, epsGrowthNext5Y, 3),
// also eine VORWÄRTS-gerichtete Analysten-/Sektor-Erwartung. realizedGrowth8Q ist ein
// eigenständiges, rückwärtsgerichtetes Konzept (Umsatzwachstum der letzten 8 Quartale)
// und wird hier additiv NEU eingeführt statt referenceGrowth umzubenennen — beide bleiben
// nebeneinander bestehen, da sie unterschiedliche Fragen beantworten (Analysten-Erwartung
// vs. tatsächlich realisiertes historisches Wachstum).
//
// Datenlage (geprüft): shared/schema.ts `financialStatements.incomeStatement` enthält nur
// EINEN Snapshot (aktuelles Jahr, `revenue`/`revenueGrowth`), keine 8-Quartals-Zeitreihe.
// Es gibt im Repo aktuell keine Quelle für echte historische Quartalsumsätze. Deshalb:
// KEIN Fake-Default — die Funktion nimmt optionale Quartalsumsätze entgegen und liefert
// `null`, wenn nicht mindestens 8 Quartale (9 Datenpunkte für 8 QoQ- oder YoY-Perioden)
// vorliegen. Sobald StockAnalysis um eine echte Quartalsreihe erweitert wird (nicht Teil
// dieser Aufgabe), kann dieselbe Funktion ohne Änderung verwendet werden.

/**
 * Berechnet die annualisierte Umsatzwachstumsrate über die letzten 8 Quartale (YoY-Basis),
 * falls historische Quartalsumsätze vorhanden sind. Gibt `null` zurück, wenn die Datenlage
 * nicht ausreicht (kein Fake-Default, siehe WORK_REVERSE_DCF_BRIDGE.md Teil 1).
 *
 * Erwartete Reihenfolge: `quarterlyRevenue` chronologisch aufsteigend (ältestes Quartal
 * zuerst). Für 8 Quartale YoY-Wachstum werden mindestens 8 zusätzliche Vorjahresquartale
 * benötigt (also 16 Datenpunkte) ODER, falls nur 8 Quartale vorliegen, wird der einfache
 * durchschnittliche QoQ-Wachstumspfad auf eine Jahresrate hochgerechnet (Fallback, explizit
 * als solcher markiert über `method`).
 */
export interface RealizedGrowth8QResult {
  realizedGrowth8Q: number | null; // % p.a., annualisiert
  method: 'yoy_8q' | 'qoq_annualized' | 'insufficient_data';
  quartersUsed: number;
}

export function calculateRealizedGrowth8Q(quarterlyRevenue?: number[] | null): RealizedGrowth8QResult {
  if (!quarterlyRevenue || quarterlyRevenue.length < 8) {
    return { realizedGrowth8Q: null, method: 'insufficient_data', quartersUsed: quarterlyRevenue?.length ?? 0 };
  }
  const q = quarterlyRevenue.filter(v => typeof v === 'number' && isFinite(v) && v > 0);
  if (q.length < 8) {
    return { realizedGrowth8Q: null, method: 'insufficient_data', quartersUsed: q.length };
  }

  // Bevorzugt: echtes YoY-Wachstum über 8 Quartale, falls 16 Datenpunkte vorhanden
  // (letzte 8 Quartale vs. die 8 Quartale davor).
  if (q.length >= 16) {
    const last8 = q.slice(-8);
    const prev8 = q.slice(-16, -8);
    const sumLast = last8.reduce((s, v) => s + v, 0);
    const sumPrev = prev8.reduce((s, v) => s + v, 0);
    if (sumPrev <= 0) return { realizedGrowth8Q: null, method: 'insufficient_data', quartersUsed: q.length };
    const growth = ((sumLast - sumPrev) / sumPrev) * 100;
    return { realizedGrowth8Q: growth, method: 'yoy_8q', quartersUsed: 16 };
  }

  // Fallback: nur 8-15 Quartale vorhanden → durchschnittliches QoQ-Wachstum,
  // auf eine annualisierte Rate hochgerechnet ((1+qoq)^4 - 1).
  const last8 = q.slice(-8);
  const qoqRates: number[] = [];
  for (let i = 1; i < last8.length; i++) {
    if (last8[i - 1] > 0) qoqRates.push((last8[i] - last8[i - 1]) / last8[i - 1]);
  }
  if (qoqRates.length === 0) return { realizedGrowth8Q: null, method: 'insufficient_data', quartersUsed: last8.length };
  const avgQoq = qoqRates.reduce((s, r) => s + r, 0) / qoqRates.length;
  const annualized = (Math.pow(1 + avgQoq, 4) - 1) * 100;
  return { realizedGrowth8Q: annualized, method: 'qoq_annualized', quartersUsed: last8.length };
}

/**
 * gapRatio = g* / realizedGrowth8Q — implizites Wachstum relativ zur historisch
 * realisierten Wachstumsrate (WORK_REVERSE_DCF_BRIDGE.md Teil 1 / §3.4).
 * Gibt `null` zurück, wenn realizedGrowth8Q fehlt oder 0 ist (Division durch 0 vermeiden).
 * Wird für DCF_REALITY_CHECK-Gate-Zwecke verwendet (siehe §3.4/§3.6, Cap-Milderung),
 * NICHT zur Veränderung von g* selbst.
 */
export function calculateGapRatio(impliedGrowth: number, realizedGrowth8Q: number | null): number | null {
  if (realizedGrowth8Q == null || realizedGrowth8Q === 0 || !isFinite(realizedGrowth8Q)) return null;
  const ratio = impliedGrowth / realizedGrowth8Q;
  return isFinite(ratio) ? ratio : null;
}

// === WORK_REVERSE_DCF_BRIDGE.md TEIL 3 — DCF-Modellierung mit Fiskaldaten ===
//
// KRITISCHE REGEL (mehrfach in der Spezifikation betont — siehe §3.1, §3.4, §3.6):
// Reverse-DCF (g*, calculateReverseDCF oben) bleibt IMMER "clean". Fiscal-Programme
// dürfen g* NIEMALS direkt beeinflussen. Die Funktionen unten wirken AUSSCHLIESSLICH
// auf den Forward-DCF-FCF-Pfad (separates Modell) — sie werden nirgends aus
// calculateReverseDCF() heraus aufgerufen und verändern keinen ihrer Parameter.
// Verifiziert durch script/test-fiscal-bridge.ts ("g* vor/nach Fiscal-Overlay identisch").

/**
 * Client-seitiges Gegenstück zu server/fiscal-bridge.ts FiscalProgram — bewusst als
 * eigenständiger, minimaler Typ gehalten (kein Import aus server/* im Client-Bundle).
 * Felder sind ein Subset, das für die FCF-Allokation (§3.2) benötigt wird.
 */
export interface FiscalProgramForFcf {
  id: string;
  volumeUsdBn: number | null;
  startYear: number | null;
  endYear: number | null;
  source?: { url: string; publishedAt: string; snippet: string };
}

export interface FiscalFcfOverlay {
  programId: string;
  year: number;                 // Kalenderjahr t
  deltaFcfUsd: number;          // absolute FCF-Wirkung in USD
  probability: number;          // 0–1
  source?: { url: string; publishedAt: string; snippet: string };
}

/**
 * Verteilt das Programmvolumen linear über die Programmjahre auf den Unternehmens-FCF
 * (WORK_REVERSE_DCF_BRIDGE.md §3.2, exakte Formel).
 * Guardrails (§3.2): volumeUsdBn/startYear/endYear müssen gesetzt sein, sonst []
 * (kein numerisches Overlay — nur qualitativer Catalyst-Text, ΔFCF=0, siehe §3.6).
 */
export function allocateProgramToFcf(opts: {
  program: FiscalProgramForFcf;
  /** Anteil des Unternehmens am adressierbaren Markt/Orders, 0–1, aus Research/Segment */
  companyShare: number;
  /** Wie viel vom Revenue-Uplift als FCF ankommt, z.B. 0.15 */
  fcfMargin: number;
  probability: number;
}): FiscalFcfOverlay[] {
  const { program: p, companyShare, fcfMargin, probability } = opts;
  if (p.volumeUsdBn == null || p.startYear == null || p.endYear == null) return [];
  if (p.endYear < p.startYear) return [];

  const years = p.endYear - p.startYear + 1;
  const totalCompanyFcf = p.volumeUsdBn * 1e9 * companyShare * fcfMargin;
  const perYear = totalCompanyFcf / years;

  const out: FiscalFcfOverlay[] = [];
  for (let y = p.startYear; y <= p.endYear; y++) {
    out.push({
      programId: p.id,
      year: y,
      deltaFcfUsd: perYear,
      probability,
      source: p.source,
    });
  }
  return out;
}

/**
 * Cap gegen Explosiv-Szenarien (§3.2): Summe π·ΔFCF über alle Programme in einem
 * Jahr darf maxFraction (Default 30%) von baseFcf0 nicht überschreiten. Skaliert
 * bei Überschreitung alle Overlays des betroffenen Jahres proportional herunter.
 */
export function capOverlays(
  baseFcf0: number,
  overlays: FiscalFcfOverlay[],
  maxFraction = 0.30
): FiscalFcfOverlay[] {
  const byYear = new Map<number, FiscalFcfOverlay[]>();
  for (const o of overlays) {
    const arr = byYear.get(o.year) ?? [];
    arr.push(o);
    byYear.set(o.year, arr);
  }
  const result: FiscalFcfOverlay[] = [];
  // Array.from() statt for...of ueber Map, um TS2802 (downlevelIteration) zu vermeiden
  // -- gleiche Einschraenkung wie server/sector-data.ts bei Set-Iteration im Repo.
  Array.from(byYear.values()).forEach((arr: FiscalFcfOverlay[]) => {
    const raw = arr.reduce((s: number, o: FiscalFcfOverlay) => s + o.probability * o.deltaFcfUsd, 0);
    const cap = Math.abs(baseFcf0) * maxFraction;
    const scale = raw > cap && raw > 0 ? cap / raw : 1;
    arr.forEach((o: FiscalFcfOverlay) => result.push({ ...o, deltaFcfUsd: o.deltaFcfUsd * scale }));
  });
  return result;
}

export interface ForwardDcfWithFiscalResult {
  equityValue: number;
  fairValuePerShare: number;
  fcfPath: number[];
}

/**
 * Forward-DCF mit optionalem Fiscal-Overlay pro Jahr (§3.3, exakte Formel).
 * baseGrowth ist die organische Wachstumsrate OHNE Fiscal — der Fiscal-Beitrag kommt
 * additiv aus `overlays` (bereits probability-gewichtet oder roh; hier wird
 * `o.probability * o.deltaFcfUsd` verwendet, konsistent mit §3.3-Referenzcode).
 * Diese Funktion hat KEINE Wechselwirkung mit calculateReverseDCF()/g* — komplett
 * getrennter Rechenweg (separates FV, siehe §3.5-Tabelle).
 */
export function forwardDcfWithFiscal(opts: {
  fcf0: number;
  baseGrowth: number;           // organische g ohne Fiscal (Dezimal, z.B. 0.05 = 5%)
  wacc: number;                 // Dezimal, z.B. 0.09 = 9%
  n?: number;
  terminalGrowth?: number;
  overlays: FiscalFcfOverlay[]; // bereits probability-gewichtet oder roh
  netDebt: number;
  shares: number;
}): ForwardDcfWithFiscalResult {
  const n = opts.n ?? 5;
  const gTerm = opts.terminalGrowth ?? 0.025;
  const startYear = new Date().getUTCFullYear();

  const fcfPath: number[] = [];
  let pv = 0;
  for (let t = 1; t <= n; t++) {
    const year = startYear + t - 1;
    const base = opts.fcf0 * Math.pow(1 + opts.baseGrowth, t);
    const fiscal = opts.overlays
      .filter(o => o.year === year)
      .reduce((s, o) => s + o.probability * o.deltaFcfUsd, 0);
    const fcfT = base + fiscal;
    fcfPath.push(fcfT);
    pv += fcfT / Math.pow(1 + opts.wacc, t);
  }
  const last = fcfPath[n - 1];
  const term = last * (1 + gTerm) / ((opts.wacc - gTerm) * Math.pow(1 + opts.wacc, n));
  const ev = pv + term;
  const equity = ev - opts.netDebt;
  return {
    equityValue: equity,
    fairValuePerShare: opts.shares > 0 ? equity / opts.shares : 0,
    fcfPath,
  };
}

