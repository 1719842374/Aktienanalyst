/**
 * Scoring-Integration — verdrahtet runScoringPipeline() (server/scoring-gates.ts,
 * WORK_SCORING_VORLAGE.md §0 + §17) mit der ECHTEN Aktienanalyse (/api/analyze).
 *
 * Alle GateInputs kommen aus bereits real berechneten Analyse-Groessen —
 * KEINE Platzhalter, KEINE hardcodierten Werte. Fehlt eine Kennzahl, ist der
 * jeweilige Input `null` und das betroffene Gate bleibt inaktiv (buildGates
 * behandelt fehlende Daten als "Gate inaktiv", niemals als Fake-Trigger).
 *
 * Herkunft der Inputs (jeweils dieselben Quellen wie die restliche Analyse):
 *   impliedGrowthPercent      → calcImpliedGStar() (catalyst-engine.ts) — wird in
 *                               analyze-route.ts bereits fuer die Einpreisungs-
 *                               Logik berechnet (Gordon-Inverse: g* = r − FCF/EV).
 *                               HINWEIS: Die Client-Sektion 14 (ReverseDCFSection)
 *                               nutzt dieselbe Formel mit CAPM-WACC des DCF-Modells;
 *                               hier kommt der Sektor-Default-WACC zum Einsatz —
 *                               kleine Abweichungen zwischen Sektion 14 und dem
 *                               Scoring-g* sind moeglich und dokumentiert.
 *   realizedGrowth8QPercent   → echte FMP-Quartalsumsaetze (income-statement,
 *                               period=quarter, limit=16). Spiegellogik zu
 *                               client/src/lib/calculations.ts
 *                               calculateRealizedGrowth8Q (WORK_REVERSE_DCF_BRIDGE
 *                               TEIL 1): YoY der letzten 8 Quartale vs. der 8
 *                               davor; 8-15 Quartale → annualisierte QoQ-Rate.
 *   marginDeltaYoYPp          → operative Marge FY0 vs. FY-1 aus den bereits
 *                               geladenen (USD-konvertierten) Jahres-Income-
 *                               Statements (financials.income).
 *   relativeGrowthDeltaYoYPp  → Subjekt-Umsatzwachstum minus Peer-Durchschnitts-
 *                               Umsatzwachstum (peerComparison). Beobachtbares
 *                               Ist-Delta als Share-Loss-Signal (§17.8 "SHARE").
 *   inventoryDaysDeltaYoYPct  → Lagerbestand YoY-%-Delta aus den Jahres-Balance-
 *                               Sheets (financials.balanceSheet). null fuer
 *                               Unternehmen ohne Inventory (Software/Services).
 *
 * qualityScore / trendMultiplier:
 *   WORK_SCORING_VORLAGE.md §0 definiert beide als EINGABEN der Pipeline;
 *   §13-16 (die ihre Herleitung enthalten sollten) sind in der Doku nur als
 *   Kurzverweis vorhanden. Fuer die produktive Verdrahtung braucht es dennoch
 *   eine konkrete, transparente Zuordnung — sie ist hier als benannte
 *   Mapping-Tabelle (QUALITY_SCORE_MAP / TREND_RULES) dokumentiert und nutzt
 *   ausschliesslich bereits real berechnete Analyse-Ergebnisse (financial
 *   health, Moat-Staerke, MA200/MA50-Trendlage) — keine erfundenen Formeln,
 *   sondern eine im Review sichtbare Uebersetzung vorhandener Urteile auf die
 *   0-100-Skala, auf der die Gate-Caps (55/60/65/70) definiert sind.
 */
import {
  runScoringPipeline,
  type GateInputs,
  type ScoringPipelineResult,
} from "./scoring-gates";
import type { Catalyst } from "../shared/schema";

// ─── qualityScore-Mapping (dokumentierte Uebersetzungstabelle) ─────────────────
// Basis: financialStatements.health (5 Stufen, bereits produktiv berechnet aus
// Verschuldung/FCF/Margen in analyze-route.ts) + Moat-Zuschlag (moatAssessment).
// Skala so gewaehlt, dass ein "Good/Narrow"-Standardwert (~65) OBERHALB des
// strengsten Gate-Caps (55) liegt — Gates muessen deckeln koennen (§0), sonst
// waere die Pipeline wirkungslos.
export const QUALITY_SCORE_MAP: Record<string, number> = {
  Excellent: 80,
  Good: 68,
  Moderate: 55,
  Weak: 42,
  Critical: 28,
};
export const MOAT_BONUS: Record<string, number> = {
  Wide: 8,
  Narrow: 4,
  None: 0,
};

// trendMultiplier: Trendlage aus den bereits berechneten technischen Indikatoren.
// Bewusst enge Spanne (0.9-1.1) — der Multiplikator moduliert, er dominiert nicht.
export const TREND_RULES = {
  UPTREND: 1.1,    // Kurs > MA200 UND MA50 > MA200 (bestaetigter Aufwaertstrend)
  NEUTRAL: 1.0,    // gemischte Signale
  DOWNTREND: 0.9,  // Kurs < MA200 (Abwaertstrend)
} as const;

export function mapQualityScore(
  health: string | undefined,
  moatRating: string | undefined
): number {
  const base = QUALITY_SCORE_MAP[health ?? ""] ?? QUALITY_SCORE_MAP.Moderate;
  const bonus = MOAT_BONUS[moatRating ?? ""] ?? 0;
  return Math.min(100, base + bonus);
}

export function mapTrendMultiplier(ti: {
  priceAboveMA200?: boolean;
  ma50AboveMA200?: boolean;
} | null | undefined): number {
  if (!ti) return TREND_RULES.NEUTRAL;
  if (ti.priceAboveMA200 && ti.ma50AboveMA200) return TREND_RULES.UPTREND;
  if (ti.priceAboveMA200 === false) return TREND_RULES.DOWNTREND;
  return TREND_RULES.NEUTRAL;
}

// ─── Realized-8Q — Spiegellogik zu client/src/lib/calculations.ts ─────────────
// (calculateRealizedGrowth8Q, WORK_REVERSE_DCF_BRIDGE.md TEIL 1). Server kann
// nicht aus client/ importieren (kein Alias, kein Praezedenzfall) — daher hier
// dieselbe Logik mit identischen Regeln. script/test-scoring-integration.ts
// prueft beide Implementierungen gegeneinander (Drift-Schutz).
export interface RealizedGrowth8QServer {
  realizedGrowth8Q: number | null;
  method: "yoy_8q" | "qoq_annualized" | "insufficient_data";
  quartersUsed: number;
}

export function calcRealizedGrowth8QServer(
  quarterlyRevenueChronological?: number[] | null
): RealizedGrowth8QServer {
  const input = quarterlyRevenueChronological;
  if (!input || input.length < 8) {
    return { realizedGrowth8Q: null, method: "insufficient_data", quartersUsed: input?.length ?? 0 };
  }
  const q = input.filter(v => typeof v === "number" && isFinite(v) && v > 0);
  if (q.length < 8) {
    return { realizedGrowth8Q: null, method: "insufficient_data", quartersUsed: q.length };
  }
  if (q.length >= 16) {
    const last8 = q.slice(-8);
    const prev8 = q.slice(-16, -8);
    const sumLast = last8.reduce((s, v) => s + v, 0);
    const sumPrev = prev8.reduce((s, v) => s + v, 0);
    if (sumPrev <= 0) return { realizedGrowth8Q: null, method: "insufficient_data", quartersUsed: q.length };
    return { realizedGrowth8Q: ((sumLast - sumPrev) / sumPrev) * 100, method: "yoy_8q", quartersUsed: 16 };
  }
  const last8 = q.slice(-8);
  const qoqRates: number[] = [];
  for (let i = 1; i < last8.length; i++) {
    if (last8[i - 1] > 0) qoqRates.push((last8[i] - last8[i - 1]) / last8[i - 1]);
  }
  if (qoqRates.length === 0) return { realizedGrowth8Q: null, method: "insufficient_data", quartersUsed: last8.length };
  const avgQoq = qoqRates.reduce((s, r) => s + r, 0) / qoqRates.length;
  return { realizedGrowth8Q: (Math.pow(1 + avgQoq, 4) - 1) * 100, method: "qoq_annualized", quartersUsed: last8.length };
}

// ─── GateInputs aus echten Analyse-Daten ableiten ──────────────────────────────

export interface AnalysisScoringContext {
  /** g* aus calcImpliedGStar (bereits in analyze-route.ts berechnet), in %. */
  impliedGStar: number | null;
  /** Quartalsumsaetze CHRONOLOGISCH (aeltestes zuerst) — aus fmpIncomeStatementQuarterly
   *  (FMP liefert newest-first, Aufrufer kehrt um). */
  quarterlyRevenueChronological: number[] | null;
  /** Jahres-Income-Statements newest-first (financials.income, USD-konvertiert). */
  annualIncome: Array<{ revenue?: number; operatingIncome?: number }> | null;
  /** Jahres-Balance-Sheets newest-first (financials.balanceSheet). */
  annualBalance: Array<{ inventory?: number }> | null;
  /** Subjekt-Umsatzwachstum in % (bereits berechnet). */
  subjectRevenueGrowth: number | null;
  /** Peer-Umsatzwachstumsraten in % (peerComparison.peers[].revenueGrowth). */
  peerRevenueGrowths: Array<number | null> | null;
}

export function deriveGateInputs(ctx: AnalysisScoringContext): GateInputs & {
  realizedGrowthMethod: RealizedGrowth8QServer["method"];
  realizedGrowthQuartersUsed: number;
} {
  // Realized 8Q aus echten Quartalsumsaetzen
  const r8 = calcRealizedGrowth8QServer(ctx.quarterlyRevenueChronological);

  // Operative Marge FY0 vs. FY-1 (Prozentpunkte). Nur wenn beide Jahre echte
  // Umsaetze haben — sonst null.
  let marginDeltaYoYPp: number | null = null;
  const inc0 = ctx.annualIncome?.[0];
  const inc1 = ctx.annualIncome?.[1];
  if (
    inc0 && inc1 &&
    typeof inc0.revenue === "number" && inc0.revenue > 0 &&
    typeof inc1.revenue === "number" && inc1.revenue > 0 &&
    typeof inc0.operatingIncome === "number" &&
    typeof inc1.operatingIncome === "number"
  ) {
    const m0 = (inc0.operatingIncome / inc0.revenue) * 100;
    const m1 = (inc1.operatingIncome / inc1.revenue) * 100;
    if (isFinite(m0) && isFinite(m1)) marginDeltaYoYPp = +(m0 - m1).toFixed(2);
  }

  // Relatives Wachstum: Subjekt minus Peer-Durchschnitt (nur echte Werte).
  let relativeGrowthDeltaYoYPp: number | null = null;
  const peerVals = (ctx.peerRevenueGrowths ?? []).filter(
    (v): v is number => typeof v === "number" && isFinite(v)
  );
  if (
    peerVals.length >= 2 &&
    typeof ctx.subjectRevenueGrowth === "number" &&
    isFinite(ctx.subjectRevenueGrowth)
  ) {
    const peerAvg = peerVals.reduce((s, v) => s + v, 0) / peerVals.length;
    relativeGrowthDeltaYoYPp = +(ctx.subjectRevenueGrowth - peerAvg).toFixed(2);
  }

  // Inventory YoY-%-Delta — null wenn kein Inventory berichtet (Services/Software).
  let inventoryDaysDeltaYoYPct: number | null = null;
  const bal0 = ctx.annualBalance?.[0];
  const bal1 = ctx.annualBalance?.[1];
  if (
    bal0 && bal1 &&
    typeof bal0.inventory === "number" && bal0.inventory > 0 &&
    typeof bal1.inventory === "number" && bal1.inventory > 0
  ) {
    inventoryDaysDeltaYoYPct = +(((bal0.inventory - bal1.inventory) / bal1.inventory) * 100).toFixed(1);
  }

  return {
    impliedGrowthPercent:
      typeof ctx.impliedGStar === "number" && isFinite(ctx.impliedGStar) ? ctx.impliedGStar : null,
    realizedGrowth8QPercent: r8.realizedGrowth8Q,
    marginDeltaYoYPp,
    relativeGrowthDeltaYoYPp,
    inventoryDaysDeltaYoYPct,
    realizedGrowthMethod: r8.method,
    realizedGrowthQuartersUsed: r8.quartersUsed,
  };
}

// ─── Gesamtergebnis fuer die Analyse-Response ──────────────────────────────────

export interface AnalysisScoringResult {
  finalScore: number;
  rawScore: number;
  qualityScore: number;
  trendMultiplier: number;
  cappedBy: string | null;
  gates: Array<{ id: string; active: boolean; cap: number; severity: string; rationale: string }>;
  gateInputs: {
    impliedGrowthPercent: number | null;
    realizedGrowth8QPercent: number | null;
    realizedGrowthMethod: string;
    realizedGrowthQuartersUsed: number;
    marginDeltaYoYPp: number | null;
    relativeGrowthDeltaYoYPp: number | null;
    inventoryDaysDeltaYoYPct: number | null;
  };
  fiscal: { qualifies: boolean; evPercent: number; reasons: string[] };
  conflictTexts: string[];
}

export function buildScoringForAnalysis(params: {
  ctx: AnalysisScoringContext;
  health: string | undefined;
  moatRating: string | undefined;
  technicalIndicators: { priceAboveMA200?: boolean; ma50AboveMA200?: boolean } | null | undefined;
  catalysts: Catalyst[];
  price: number;
  asOfDate: string;
}): AnalysisScoringResult {
  const gateInputsFull = deriveGateInputs(params.ctx);
  const { realizedGrowthMethod, realizedGrowthQuartersUsed, ...gateInputs } = gateInputsFull;

  const qualityScore = mapQualityScore(params.health, params.moatRating);
  const trendMultiplier = mapTrendMultiplier(params.technicalIndicators);

  const result: ScoringPipelineResult = runScoringPipeline({
    qualityScore,
    trendMultiplier,
    catalysts: params.catalysts,
    asOfDate: params.asOfDate,
    price: params.price,
    gateInputs,
  });

  // Vollstaendige Gate-Liste (auch inaktive) fuer UI-Transparenz — activeGates
  // allein zeigt nicht, WARUM ein Gate nicht gegriffen hat.
  const allGates = result.gatesBeforeFiscal.map(g => {
    const adjusted = result.activeGates.find(a => a.id === g.id);
    return adjusted ?? g;
  });

  return {
    finalScore: Math.round(result.score * 10) / 10,
    rawScore: Math.round(result.rawScore * 10) / 10,
    qualityScore,
    trendMultiplier,
    cappedBy: result.cappedBy?.id ?? null,
    gates: allGates.map(g => ({
      id: g.id, active: g.active, cap: g.cap, severity: g.severity, rationale: g.rationale,
    })),
    gateInputs: {
      ...gateInputs,
      realizedGrowthMethod,
      realizedGrowthQuartersUsed,
    },
    fiscal: {
      qualifies: result.fiscalQualifiedAndMaterial,
      evPercent: Math.round(result.fiscalEVPercent * 10) / 10,
      reasons: result.fiscal.reasons,
    },
    conflictTexts: result.conflictTexts,
  };
}
