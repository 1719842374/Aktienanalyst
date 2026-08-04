/**
 * End-to-End-Pipeline — Virtuelles Portfolio (WORK_PORTFOLIO.md Kapitel E + F).
 *
 * §E.3 End-to-End-Pipeline:
 *   1 Intake Buy-Liste
 *   2 μ, Σ, β, rf schätzen (Historie: WORK_DATA_PROVIDERS)
 *   3 pickWeightMode → allocate A|B|C → maxWeight
 *   4 sharpeReport(w, μ, Σ, rf)
 *   5 optional pro Zeile sizeKellySingle
 *   6 × K → Tabelle
 *
 * §F.1 Defaults werden hier als exportierte Konstanten gesammelt (zusätzlich
 * zu den Modul-eigenen Defaults in weighting.ts/kelly.ts), damit die Pipeline
 * eine einzige normative Quelle für UI-Defaults bietet.
 */

import type { PortfolioCandidate, BasketResult } from "../../../../shared/schema";
import { allocate, DEFAULT_MAX_WEIGHT, DEFAULT_KAPPA_SCORE_TILT, type WeightMode } from "./weighting";
import { sharpeReport } from "./sharpe";
import { applyKellyPolicy, kellyContinuous, sizeKellySingle } from "./kelly";

// ─── §F.1 Defaults (normative Konstanten) ──────────────────────────────────
export const DEFAULTS = {
  maxWeight: 0.30,
  kellyFraction: 0.5,
  kellyMaxF: 0.25,
  sigmaWindowDays: 252, // Σ-Fenster
  scoreMin: 65,
  kappaScoreTilt: 0.35, // κ Score-Tilt
  sharpeFloorVol: 1e-12, // Sharpe-Floor vol
} as const;

export interface PortfolioPipelineInput {
  candidates: PortfolioCandidate[]; // erwartet: mu, price gesetzt; beta optional
  Sigma: number[][]; // annualisierte Kovarianzmatrix, Reihenfolge = candidates
  rf: number;
  capitalBase: number;
  maxWeight?: number;
  kappa?: number;
  includeKelly?: boolean; // pro Zeile sizeKellySingle rechnen (Default: true)
  kellyFraction?: number;
  kellyMaxF?: number;
}

export interface PortfolioPipelineRow {
  ticker: string;
  score: number;
  weight: number;
  amount: number;
  sharpeSingle: number | null;
  kelly?: {
    fStar: number;
    fHalf: number;
    fCapped: number;
    amount: number;
    sharesHint: number;
  };
}

export interface PortfolioPipelineResult {
  mode: WeightMode;
  rows: PortfolioPipelineRow[];
  sharpePortfolio: number | null;
  sharpeEqualWeight: number | null;
  deltaVsEqual: number | null;
  muP: number;
  sigmaP: number;
  notes: string[];
  basketResult: BasketResult;
}

/**
 * Schritt 1 (Intake) nach §A.3: filtert Kandidaten nach Auto-Regel
 * (score ≥ scoreMin) ODER manuell inkludiert (source enthält 'manual').
 * Wird von runPortfolioPipeline NICHT automatisch angewendet (die Pipeline
 * nimmt bereits kuratierte candidates entgegen) — als eigenständiger Helfer
 * verfügbar, falls die UI/Aufrufer die Auto-Intake-Regel anwenden möchte.
 */
export function intakeFilter(
  candidates: PortfolioCandidate[],
  scoreMin: number = DEFAULTS.scoreMin
): PortfolioCandidate[] {
  return candidates.filter((c) => {
    if (c.status !== "active") return false;
    if (c.source === "manual" || c.source === "both") return true;
    return c.score >= scoreMin;
  });
}

/**
 * Verbindet Kapitel B (Gewichtung), C (Sharpe) und D (Kelly) zu einer
 * End-to-End-Berechnung (§E.3). Erwartet, dass μ/Σ/β/rf bereits geschätzt
 * wurden (Schritt 2 der Pipeline liegt außerhalb dieser reinen Rechenfunktion
 * — Datenbeschaffung ist Aufgabe der aufrufenden Schicht/UI).
 */
export function runPortfolioPipeline(input: PortfolioPipelineInput): PortfolioPipelineResult {
  const candidates = input.candidates;
  const n = candidates.length;
  const maxWeight = input.maxWeight ?? DEFAULTS.maxWeight;
  const kappa = input.kappa ?? DEFAULTS.kappaScoreTilt;
  const includeKelly = input.includeKelly ?? true;
  const kellyFraction = input.kellyFraction ?? DEFAULTS.kellyFraction;
  const kellyMaxF = input.kellyMaxF ?? DEFAULTS.kellyMaxF;

  const mu = candidates.map((c) => c.mu ?? 0);
  const scores = candidates.map((c) => c.score);
  const tickers = candidates.map((c) => c.ticker);

  // 3: pickWeightMode → allocate A|B|C → maxWeight
  const allocResult = allocate({
    tickers,
    mu,
    Sigma: input.Sigma,
    rf: input.rf,
    scores,
    maxWeight,
    kappa,
  });

  const notes = [...allocResult.notes];

  // 4: sharpeReport(w, μ, Σ, rf) — nur sinnvoll wenn n≥2 und Σ vorhanden
  let sharpePortfolio: number | null = null;
  let sharpeEqualWeight: number | null = null;
  let deltaVsEqual: number | null = null;
  let sharpeSingleArr: (number | null)[] = candidates.map(() => null);
  let muP = 0;
  let sigmaP = 0;

  if (n >= 1 && input.Sigma.length === n) {
    const report = sharpeReport({ w: allocResult.weights, mu, Sigma: input.Sigma, rf: input.rf });
    sharpePortfolio = n >= 2 ? report.sharpePortfolio : null;
    sharpeEqualWeight = n >= 2 ? report.sharpeEqualWeight : null;
    deltaVsEqual = n >= 2 ? report.deltaVsEqual : null;
    sharpeSingleArr = report.sharpeSingle;
    muP = report.muP;
    sigmaP = report.sigmaP;
  }
  if (n === 1) {
    notes.push("n=1: Sharpe_p/Sharpe_equal nicht aussagekräftig — nur Single-Sharpe (§D.4).");
  }

  // 5+6: optional pro Zeile Kelly, × K → Tabelle
  const rows: PortfolioPipelineRow[] = candidates.map((c, i) => {
    const weight = allocResult.weights[i] ?? 0;
    const amount = weight * input.capitalBase;
    let kelly: PortfolioPipelineRow["kelly"] = undefined;
    if (includeKelly && c.mu != null) {
      const sigma_i = input.Sigma[i]?.[i] != null ? Math.sqrt(Math.max(input.Sigma[i][i], 0)) : undefined;
      if (sigma_i != null) {
        const sized = sizeKellySingle({
          mu: c.mu,
          sigma: sigma_i,
          rf: input.rf,
          capitalBase: input.capitalBase,
          price: c.price,
          method: "continuous",
        });
        // sizeKellySingle nutzt applyKellyPolicy-Defaults (0.5/0.25); falls
        // abweichende Policy gewünscht ist, hier explizit neu anwenden:
        const policy = applyKellyPolicy(kellyContinuous(c.mu, sigma_i, input.rf), {
          fraction: kellyFraction,
          maxF: kellyMaxF,
        });
        const amountKelly = policy.fCapped * input.capitalBase;
        kelly = {
          fStar: policy.fStar,
          fHalf: policy.fHalf,
          fCapped: policy.fCapped,
          amount: amountKelly,
          sharesHint: c.price > 0 ? amountKelly / c.price : 0,
        };
        void sized; // Referenz-Implementierung laut §D.6 belegt; policy oben ist die konfigurierbare Variante
      }
    }
    return {
      ticker: c.ticker,
      score: c.score,
      weight,
      amount,
      sharpeSingle: sharpeSingleArr[i] ?? null,
      kelly,
    };
  });

  const basketResult: BasketResult = {
    mode: allocResult.mode,
    rows: rows.map((r) => ({
      ticker: r.ticker,
      weight: r.weight,
      amount: r.amount,
      sharpeSingle: r.sharpeSingle,
    })),
    sharpePortfolio,
    sharpeEqualWeight,
  };

  return {
    mode: allocResult.mode,
    rows,
    sharpePortfolio,
    sharpeEqualWeight,
    deltaVsEqual,
    muP,
    sigmaP,
    notes,
    basketResult,
  };
}
