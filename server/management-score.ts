/**
 * management-score.ts
 *
 * Management-Execution-Score (1-10) — Auftrag 05.08.2026.
 *
 * Gesamtformel:
 *   Score_1-10 = 10 × (0.30·S_Delivery + 0.25·S_Segment + 0.20·S_Capital
 *                       + 0.15·S_Credibility + 0.10·S_QualNews)
 *
 * Jede Normalisierungsfunktion ist rein (keine Netzwerk-/DB-Zugriffe), damit
 * sie ohne Mocking unit-testbar ist. Die Orchestrierungsfunktion
 * (computeManagementScore) am Ende der Datei nimmt die bereits geladenen
 * Analyse-Daten (Segmente, Financials, ROIC-Historie, News, Comp-Daten) und
 * ruft die reinen Funktionen auf.
 *
 * KEIN Fake-Score-Prinzip: fehlt ein Baustein komplett (kein Segment
 * erkennbar, keine Comp-Daten gefunden, <3 Jahre ROIC-Historie), wird der
 * jeweilige Teilscore auf einen dokumentierten NEUTRALEN Default gesetzt
 * (nicht 0, nicht erfunden hoch) und ein Flag zeigt das in der UI an.
 */

// ============================================================
// Gemeinsame Hilfsfunktionen
// ============================================================

/** Lineare Interpolation zwischen zwei Score-Ankern, geklemmt auf [0,1]. */
function lerp(value: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  const t = (value - x0) / (x1 - x0);
  const clampedT = Math.max(0, Math.min(1, t));
  return y0 + clampedT * (y1 - y0);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ============================================================
// 1. Segment-Daten-Integration (S_Segment) — 25%
// ============================================================

export interface SegmentScoreInput {
  /** Segment mit dem höchsten YoY-Wachstum unter den Top-Segmenten — das
   *  "neue Geschäftsmodell", das die Story treiben soll. null, wenn kein
   *  Segmentreporting vorliegt oder kein Segment als "neu/wachsend"
   *  identifizierbar ist. */
  newSegmentSharePct: number | null;     // Share_new,t in % des Gesamtumsatzes
  newSegmentSharePrevPct: number | null; // Share_new,t-1 in % (für ΔShare)
  newSegmentGrowthPct: number | null;    // g_new in %
  oldSegmentsGrowthPct: number | null;   // g_old (gewichteter Durchschnitt der übrigen Segmente) in %
  newSegmentMarginPct: number | null;    // M_new in % (operative oder Bruttomarge, falls von FMP/SEC verfügbar)
  overallMarginPct: number | null;       // Gesamtmarge zum Vergleich
  marginTrend: "steigend" | "stabil" | "fallend" | null; // Trend der Segment-Marge über Perioden
  hasIdentifiableNewSegment: boolean;    // false → Sonderregel (neutral 0.35)
}

export interface SegmentScoreResult {
  score: number; // S_Segment ∈ [0,1]
  shareScore: number;
  growthGapScore: number;
  marginScore: number;
  deltaSharePp: number | null;
  growthGapPp: number | null;
  flags: string[];
}

/** S_Share: ΔShare_new (YoY, in Prozentpunkten) → [0,1]. */
export function scoreSegmentShare(deltaSharePp: number | null): number {
  if (deltaSharePp == null || !isFinite(deltaSharePp)) return 0.35; // neutral, kein Fake
  if (deltaSharePp >= 5) return 1.0;
  if (deltaSharePp >= 2) return lerp(deltaSharePp, 2, 5, 0.7, 0.9);
  if (deltaSharePp >= 0) return lerp(deltaSharePp, 0, 2, 0.4, 0.6);
  // < 0: 0.0–0.3, je negativer desto niedriger (Boden bei -10pp)
  return lerp(deltaSharePp, -10, 0, 0.0, 0.3);
}

/** S_GrowthGap: g_new - g_old (in Prozentpunkten) → [0,1]. */
export function scoreGrowthGap(growthGapPp: number | null): number {
  if (growthGapPp == null || !isFinite(growthGapPp)) return 0.35;
  if (growthGapPp >= 15) return 1.0;
  if (growthGapPp >= 5) return lerp(growthGapPp, 5, 15, 0.6, 0.9);
  if (growthGapPp >= 0) return 0.4;
  return lerp(growthGapPp, -15, 0, 0.0, 0.3);
}

/** S_MarginNew: Marge des neuen Segments vs. Gesamtmarge / Trend → [0,1]. */
export function scoreMarginNew(
  newMarginPct: number | null,
  overallMarginPct: number | null,
  trend: "steigend" | "stabil" | "fallend" | null
): number {
  if (newMarginPct == null && trend == null) return 0.35; // keine Margendaten -> neutral
  if (trend === "steigend" && newMarginPct != null && overallMarginPct != null && newMarginPct >= overallMarginPct) {
    return 1.0;
  }
  if (trend === "steigend") return 0.8; // steigend, aber kein direkter Übergesamtmarge-Beweis
  if (trend === "stabil") return 0.6;
  if (trend === "fallend") {
    // stark negativ (neues Segment defizitär und verschlechtert sich) -> Boden
    if (newMarginPct != null && newMarginPct < 0) return 0.0;
    return lerp(newMarginPct ?? 0, -20, 0, 0.0, 0.3);
  }
  // Kein Trend bekannt, aber ein absoluter Wert vorhanden: relativ zur Gesamtmarge einordnen
  if (newMarginPct != null && overallMarginPct != null) {
    return newMarginPct >= overallMarginPct ? 0.7 : 0.4;
  }
  return 0.35;
}

export function computeSegmentScore(input: SegmentScoreInput): SegmentScoreResult {
  const flags: string[] = [];
  if (!input.hasIdentifiableNewSegment) {
    flags.push("Kein erkennbarer Geschäftsmodell-Shift — Segment-Score neutral (0.35)");
    return { score: 0.35, shareScore: 0.35, growthGapScore: 0.35, marginScore: 0.35, deltaSharePp: null, growthGapPp: null, flags };
  }

  const deltaSharePp = input.newSegmentSharePct != null && input.newSegmentSharePrevPct != null
    ? +(input.newSegmentSharePct - input.newSegmentSharePrevPct).toFixed(2)
    : null;
  const growthGapPp = input.newSegmentGrowthPct != null && input.oldSegmentsGrowthPct != null
    ? +(input.newSegmentGrowthPct - input.oldSegmentsGrowthPct).toFixed(2)
    : null;

  const shareScore = scoreSegmentShare(deltaSharePp);
  const growthGapScore = scoreGrowthGap(growthGapPp);
  const marginScore = scoreMarginNew(input.newSegmentMarginPct, input.overallMarginPct, input.marginTrend);

  if (deltaSharePp == null) flags.push("ΔShare nicht berechenbar — Vorjahres-Segmentanteil fehlt");
  if (growthGapPp == null) flags.push("Growth-Gap nicht berechenbar — Wachstum alter Segmente fehlt");
  if (input.newSegmentMarginPct == null && input.marginTrend == null) flags.push("Keine Margendaten für das neue Segment verfügbar");

  const score = clamp01(0.40 * shareScore + 0.35 * growthGapScore + 0.25 * marginScore);
  return { score, shareScore, growthGapScore, marginScore, deltaSharePp, growthGapPp, flags };
}

// ============================================================
// 2A. Operative Delivery (S_Delivery) — 30%
// ============================================================

export interface DeliveryScoreInput {
  /** Tatsächliches Revenue-Growth (%) vs. Guidance/Estimate (%). Wenn keine
   *  Guidance/Estimate vorliegt: revenueGrowthTrend als Fallback nutzen. */
  actualRevenueGrowthPct: number | null;
  guidanceRevenueGrowthPct: number | null; // FMP Analyst-Estimate als Proxy
  /** Fallback, wenn kein Guidance-Vergleich möglich: Trend über ≥2 Perioden. */
  revenueGrowthTrend: "beschleunigend" | "stabil" | "verlangsamend" | null;
  marginTrend: "steigend" | "stabil" | "fallend" | null; // Operative/Bruttomarge über ≥2 Perioden
  /** EPS/FCF tatsächlich vs. Konsens-Schätzung (%, positiv = übertroffen). */
  epsOrFcfVsGuidancePct: number | null;
}

export interface DeliveryScoreResult {
  score: number;
  revScore: number;
  marginScore: number;
  epsFcfScore: number;
  usedGuidanceComparison: boolean;
  flags: string[];
}

/** S_Rev: Revenue-Growth vs. Guidance (Delta in pp) ODER Trend-Fallback. */
export function scoreRevenueDelivery(
  actualPct: number | null,
  guidancePct: number | null,
  trendFallback: "beschleunigend" | "stabil" | "verlangsamend" | null
): { score: number; usedGuidance: boolean } {
  if (actualPct != null && guidancePct != null) {
    const deltaPp = actualPct - guidancePct;
    if (deltaPp >= 0) return { score: 1.0, usedGuidance: true };
    if (deltaPp >= -3) return { score: lerp(deltaPp, -3, 0, 0.5, 1.0), usedGuidance: true };
    return { score: lerp(deltaPp, -15, -3, 0.0, 0.5), usedGuidance: true };
  }
  // Fallback: reiner Trend ohne Guidance-Zielabgleich
  if (trendFallback === "beschleunigend") return { score: 0.8, usedGuidance: false };
  if (trendFallback === "stabil") return { score: 0.55, usedGuidance: false };
  if (trendFallback === "verlangsamend") return { score: 0.25, usedGuidance: false };
  return { score: 0.35, usedGuidance: false }; // keine Daten -> neutral
}

/** S_Margin: Margentrend über ≥2 Perioden. */
export function scoreMarginTrend(trend: "steigend" | "stabil" | "fallend" | null): number {
  if (trend === "steigend") return 1.0;
  if (trend === "stabil") return 0.6;
  if (trend === "fallend") return 0.15;
  return 0.35; // keine Daten -> neutral
}

/** S_EPS/FCF: tatsächlich vs. Guidance (%, positiv = übertroffen). */
export function scoreEpsFcfVsGuidance(deltaPct: number | null): number {
  if (deltaPct == null || !isFinite(deltaPct)) return 0.35;
  if (deltaPct >= 0) return 1.0;
  if (deltaPct >= -5) return lerp(deltaPct, -5, 0, 0.5, 1.0);
  return lerp(deltaPct, -25, -5, 0.0, 0.5);
}

export function computeDeliveryScore(input: DeliveryScoreInput): DeliveryScoreResult {
  const flags: string[] = [];
  const rev = scoreRevenueDelivery(input.actualRevenueGrowthPct, input.guidanceRevenueGrowthPct, input.revenueGrowthTrend);
  if (!rev.usedGuidance) flags.push("Kein Guidance/Analyst-Estimate-Vergleich möglich — reiner Wachstumstrend als Fallback verwendet");
  const marginScore = scoreMarginTrend(input.marginTrend);
  if (input.marginTrend == null) flags.push("Margentrend nicht bestimmbar (zu wenig Historie)");
  const epsFcfScore = scoreEpsFcfVsGuidance(input.epsOrFcfVsGuidancePct);
  if (input.epsOrFcfVsGuidancePct == null) flags.push("EPS/FCF-vs-Guidance-Vergleich nicht verfügbar");

  const score = clamp01(0.45 * rev.score + 0.30 * marginScore + 0.25 * epsFcfScore);
  return { score, revScore: rev.score, marginScore, epsFcfScore, usedGuidanceComparison: rev.usedGuidance, flags };
}

// ============================================================
// 2C. Kapitalallokation (S_Capital) — 20%
// ============================================================

export interface CapitalScoreInput {
  roicPct: number | null;       // aktuelles FY ROIC (%)
  roic5YPct: number | null;     // 5Y-Durchschnitt ROIC (%) — für Trend
  waccPct: number | null;       // WACC (%) — bereits im Code vorhanden
  fcfMarginPct: number | null;
  fcfMarginTrend: "steigend" | "stabil" | "fallend" | null;
  cashConversionRatio: number | null; // FCF/Net Income oder OCF/Net Income
  /** Wachstum (Revenue-Delta) / ΔInvested Capital — hoch+stabil = effizient. */
  reinvestmentEfficiency: number | null;
}

export interface CapitalScoreResult {
  score: number;
  roicScore: number;
  fcfScore: number;
  reinvestScore: number;
  flags: string[];
}

/** S_ROIC: Trend (1Y vs. 5Y) + Vergleich zu WACC. */
export function scoreRoicTrend(roicPct: number | null, roic5YPct: number | null, waccPct: number | null): number {
  if (roicPct == null) return 0.35;
  const aboveWacc = waccPct != null ? roicPct > waccPct : null;
  const rising = roic5YPct != null ? roicPct > roic5YPct : null;

  if (rising === true && (aboveWacc === true || aboveWacc === null)) return 1.0;
  if (rising === false || (aboveWacc === false)) {
    if (aboveWacc === false && roicPct < 0) return 0.0; // ROIC negativ und unter WACC -> Boden
    return 0.2;
  }
  if (rising === true) return 0.8; // steigend, aber WACC-Vergleich nicht verfügbar
  return 0.6; // stabil / keine klare Trendaussage
}

/** S_FCF: FCF-Marge-Trend + Cash-Conversion. */
export function scoreFcfMarginConversion(
  fcfMarginTrend: "steigend" | "stabil" | "fallend" | null,
  cashConversionRatio: number | null
): number {
  const convGood = cashConversionRatio != null && cashConversionRatio > 0.8;
  const convBad = cashConversionRatio != null && cashConversionRatio < 0.5;
  if (fcfMarginTrend === "steigend" && convGood) return 1.0;
  if (fcfMarginTrend === "steigend") return 0.75;
  if (fcfMarginTrend === "stabil" && convGood) return 0.8;
  if (fcfMarginTrend === "stabil") return 0.55;
  if (fcfMarginTrend === "fallend" || convBad) return 0.2;
  return 0.35; // keine Daten
}

/** S_Reinvest: Wachstum / ΔInvested-Capital-Effizienz. Erwartet eine bereits
 *  normalisierte Kennzahl (z.B. Umsatzwachstum% / ΔIC%) — hoch+stabil = 1.0. */
export function scoreReinvestmentEfficiency(efficiency: number | null): number {
  if (efficiency == null || !isFinite(efficiency)) return 0.35;
  if (efficiency >= 1.5) return 1.0;
  if (efficiency >= 0.8) return lerp(efficiency, 0.8, 1.5, 0.6, 1.0);
  if (efficiency >= 0) return lerp(efficiency, 0, 0.8, 0.3, 0.6);
  return 0.1; // negatives Wachstum bei positivem Reinvest, oder umgekehrt -> ineffizient
}

export function computeCapitalScore(input: CapitalScoreInput): CapitalScoreResult {
  const flags: string[] = [];
  const roicScore = scoreRoicTrend(input.roicPct, input.roic5YPct, input.waccPct);
  if (input.roicPct == null) flags.push("ROIC nicht verfügbar");
  else if (input.waccPct == null) flags.push("WACC nicht verfügbar — ROIC-Score ohne Kapitalkosten-Vergleich");
  const fcfScore = scoreFcfMarginConversion(input.fcfMarginTrend, input.cashConversionRatio);
  if (input.fcfMarginTrend == null) flags.push("FCF-Margentrend nicht bestimmbar");
  const reinvestScore = scoreReinvestmentEfficiency(input.reinvestmentEfficiency);
  if (input.reinvestmentEfficiency == null) flags.push("Reinvestment-Effizienz nicht berechenbar");

  const score = clamp01(0.40 * roicScore + 0.35 * fcfScore + 0.25 * reinvestScore);
  return { score, roicScore, fcfScore, reinvestScore, flags };
}

// ============================================================
// 2D. Bilanzielle Glaubwürdigkeit (S_Credibility) — 15%
// ============================================================

export interface CredibilityScoreInput {
  cashConversionRatio: number | null; // OCF / Net Income
  workingCapitalTrend: "stabil_oder_sinkend" | "steigend_bei_wachstum" | null;
  accrualsLevel: "niedrig" | "hoch_wiederkehrend" | null;
}

export interface CredibilityScoreResult {
  score: number;
  cashConvScore: number;
  wcScore: number;
  accrualsScore: number;
  flags: string[];
}

export function scoreCashConversion(ratio: number | null): number {
  if (ratio == null || !isFinite(ratio)) return 0.35;
  if (ratio > 0.9) return 1.0;
  if (ratio >= 0.6) return lerp(ratio, 0.6, 0.9, 0.5, 0.9);
  return lerp(ratio, 0, 0.6, 0.0, 0.5);
}

export function scoreWorkingCapital(trend: "stabil_oder_sinkend" | "steigend_bei_wachstum" | null): number {
  if (trend === "stabil_oder_sinkend") return 1.0;
  if (trend === "steigend_bei_wachstum") return 0.2;
  return 0.35;
}

export function scoreAccruals(level: "niedrig" | "hoch_wiederkehrend" | null): number {
  if (level === "niedrig") return 1.0;
  if (level === "hoch_wiederkehrend") return 0.15;
  return 0.35;
}

export function computeCredibilityScore(input: CredibilityScoreInput): CredibilityScoreResult {
  const flags: string[] = [];
  const cashConvScore = scoreCashConversion(input.cashConversionRatio);
  if (input.cashConversionRatio == null) flags.push("Cash-Conversion-Ratio (OCF/Net Income) nicht verfügbar");
  const wcScore = scoreWorkingCapital(input.workingCapitalTrend);
  if (input.workingCapitalTrend == null) flags.push("Working-Capital-Trend nicht bestimmbar");
  const accrualsScore = scoreAccruals(input.accrualsLevel);
  if (input.accrualsLevel == null) flags.push("Accruals/One-Offs nicht bewertbar");

  const score = clamp01(0.40 * cashConvScore + 0.30 * wcScore + 0.30 * accrualsScore);
  return { score, cashConvScore, wcScore, accrualsScore, flags };
}

// ============================================================
// 3. Qualitative Bewertung + News-Verknüpfung (S_QualNews) — 10%
// ============================================================

export type NewsPenaltyType =
  | "excessive_comp_weak_delivery"
  | "comp_up_performance_down"
  | "golden_parachute_underperformance"
  | "repeated_guidance_miss"
  | "insider_selling_positive_story"
  | "positive_governance";

export interface NewsAdjustment {
  type: NewsPenaltyType;
  delta: number; // bereits im Bereich der Ticket-Tabelle (z.B. -0.25 bis -0.40)
  rationale: string;
  sourceUrl?: string | null;
}

export interface QualNewsScoreInput {
  /** Qualitative Basis (0–0.6) aus den 4 Signalen (Guidance-Treue,
   *  Kapitalallokations-Disziplin, Kommunikation, Insider-Verhalten). Wird
   *  vom LLM-Baustein (management-llm.ts-Äquivalent, hier: aufrufende Route)
   *  ODER regelbasiert aus den bereits berechneten Delivery/Capital-
   *  Teilscores abgeleitet, wenn kein LLM-Call möglich ist. */
  qualBase: number; // bereits in [0, 0.6] geklemmt vom Aufrufer
  adjustments: NewsAdjustment[];
}

export interface QualNewsScoreResult {
  score: number;
  qualBase: number;
  totalAdjustment: number;
  adjustments: NewsAdjustment[];
  flags: string[];
}

/** Clamped Ticket-Formel: S_QualNews = clamp(qualBase + Σadjustments, 0, 1). */
export function computeQualNewsScore(input: QualNewsScoreInput): QualNewsScoreResult {
  const flags: string[] = [];
  const qualBase = clamp(input.qualBase, 0, 0.6);
  const totalAdjustment = input.adjustments.reduce((sum, a) => sum + a.delta, 0);
  const score = clamp01(qualBase + totalAdjustment);
  if (input.adjustments.length === 0) flags.push("Keine management-relevanten News-Events in der geprüften Historie gefunden");
  return { score, qualBase, totalAdjustment, adjustments: input.adjustments, flags };
}

/**
 * Regelbasierte News-Penalty-Ableitung aus FMP-Executive-Compensation +
 * Insider-Trading (strukturierte Daten, KEINE LLM-Erfindung). Deckt die
 * Trigger ab, die sich rein aus Zahlen ableiten lassen:
 *  - excessive_comp_weak_delivery (Comp ≥3× Referenz UND schwache Delivery)
 *  - comp_up_performance_down (Comp YoY↑ UND Revenue/FCF/ROIC↓)
 *  - insider_selling_positive_story (Netto-Insider-Verkäufe bei guter Story)
 * Golden-Parachute und "wiederholte Guidance-Misses" brauchen Freitext-
 * Kontext (Abfindungsgründe, Pressemitteilungen) und werden — falls
 * vorhanden — vom LLM-Baustein zusätzlich beigetragen (separater Aufrufer).
 */
export function deriveStructuredNewsAdjustments(input: {
  ceoCompTotalLatest: number | null;
  ceoCompTotalPrevYear: number | null;
  referenceCompMedian: number | null; // echter Peer-Median bevorzugt, sonst Industry-Benchmark
  referenceCompSource: "peer_median" | "industry_benchmark" | null;
  deliveryPlusCapitalScore: number | null; // (A+B+C)/3 grob, siehe Ticket "Score A+B+C < 0.45"
  revenueGrowthPct: number | null;
  revenueGrowthPrevYearPct: number | null;
  fcfMarginPct: number | null;
  fcfMarginPrevYearPct: number | null;
  roicPct: number | null;
  roicPrevYearPct: number | null;
  netInsiderTransactionValue: number | null; // positiv = Netto-Käufe, negativ = Netto-Verkäufe
  storyIsPositive: boolean; // z.B. starke Kursperformance / bullische Guidance im Betrachtungszeitraum
}): NewsAdjustment[] {
  const adjustments: NewsAdjustment[] = [];

  // Große Vergütungspakete: ≥3× Referenz-Median UND schwache Delivery (<0.45)
  if (
    input.ceoCompTotalLatest != null &&
    input.referenceCompMedian != null &&
    input.referenceCompMedian > 0 &&
    input.ceoCompTotalLatest >= 3 * input.referenceCompMedian &&
    input.deliveryPlusCapitalScore != null &&
    input.deliveryPlusCapitalScore < 0.45
  ) {
    const ratio = input.ceoCompTotalLatest / input.referenceCompMedian;
    // Skaliert innerhalb des Ticket-Bandes -0.25..-0.40 je nach Ratio (3x -> -0.25, 6x+ -> -0.40)
    const delta = -clamp(lerp(ratio, 3, 6, 0.25, 0.40), 0.25, 0.40);
    adjustments.push({
      type: "excessive_comp_weak_delivery",
      delta,
      rationale: `CEO-Vergütung ${ratio.toFixed(1)}× über dem ${input.referenceCompSource === "peer_median" ? "Peer-Median" : "Branchendurchschnitt"} bei schwacher operativer Delivery (Score ${input.deliveryPlusCapitalScore.toFixed(2)} < 0.45)`,
    });
  }

  // Vergütung steigt, Performance fällt
  if (input.ceoCompTotalLatest != null && input.ceoCompTotalPrevYear != null && input.ceoCompTotalLatest > input.ceoCompTotalPrevYear) {
    const revDown = input.revenueGrowthPct != null && input.revenueGrowthPrevYearPct != null && input.revenueGrowthPct < input.revenueGrowthPrevYearPct;
    const fcfDown = input.fcfMarginPct != null && input.fcfMarginPrevYearPct != null && input.fcfMarginPct < input.fcfMarginPrevYearPct;
    const roicDown = input.roicPct != null && input.roicPrevYearPct != null && input.roicPct < input.roicPrevYearPct;
    if (revDown || fcfDown || roicDown) {
      adjustments.push({
        type: "comp_up_performance_down",
        delta: -0.20,
        rationale: `CEO-Vergütung YoY gestiegen, während ${[revDown && "Revenue-Wachstum", fcfDown && "FCF-Marge", roicDown && "ROIC"].filter(Boolean).join("/")} gefallen ist`,
      });
    }
  }

  // Insider-Verkäufe bei positiver Story
  if (input.netInsiderTransactionValue != null && input.netInsiderTransactionValue < 0 && input.storyIsPositive) {
    adjustments.push({
      type: "insider_selling_positive_story",
      delta: -0.10,
      rationale: `Signifikante Netto-Insider-Verkäufe (Form 4) trotz positiver Kurs-/Guidance-Story`,
    });
  }

  // Positive Governance: Netto-Insider-Käufe
  if (input.netInsiderTransactionValue != null && input.netInsiderTransactionValue > 0) {
    adjustments.push({
      type: "positive_governance",
      delta: 0.10,
      rationale: `Signifikante Netto-Insider-Käufe (Form 4) — Vertrauenssignal des Managements`,
    });
  }

  return adjustments;
}

// ============================================================
// Gesamtscore
// ============================================================

export interface ManagementScoreBreakdown {
  score1to10: number;
  delivery: DeliveryScoreResult;
  segment: SegmentScoreResult;
  capital: CapitalScoreResult;
  credibility: CredibilityScoreResult;
  qualNews: QualNewsScoreResult;
  allFlags: string[];
}

/** Gesamtformel: Score_1-10 = 10 × (0.30·S_Delivery + 0.25·S_Segment +
 *  0.20·S_Capital + 0.15·S_Credibility + 0.10·S_QualNews). */
export function computeManagementScoreBreakdown(
  delivery: DeliveryScoreResult,
  segment: SegmentScoreResult,
  capital: CapitalScoreResult,
  credibility: CredibilityScoreResult,
  qualNews: QualNewsScoreResult
): ManagementScoreBreakdown {
  const weighted = 0.30 * delivery.score + 0.25 * segment.score + 0.20 * capital.score + 0.15 * credibility.score + 0.10 * qualNews.score;
  const score1to10 = +(10 * clamp01(weighted)).toFixed(1);
  const allFlags = [...delivery.flags, ...segment.flags, ...capital.flags, ...credibility.flags, ...qualNews.flags];
  return { score1to10, delivery, segment, capital, credibility, qualNews, allFlags };
}

// ============================================================
// Orchestrierung: Rohdaten -> Teilscores -> Gesamtscore
// ============================================================
// Nimmt die bereits im Client vorliegenden Analyse-Daten (kein zweiter
// kompletter /api/analyze-Roundtrip) entgegen und holt zusätzlich die drei
// neuen FMP-Endpunkte (Executive-Comp, Comp-Benchmark, Insider-Trading) +
// optional einen LLM-Call für die qualitative Basis. Analog zum bestehenden
// /api/regulatory-Muster: lazy, eigener Cache, kein Pflichtbestandteil von
// /api/analyze.

import { fmpExecutiveCompensation, fmpExecutiveCompensationBenchmark, fmpInsiderTrading, fmpKeyMetrics } from "./fmp";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { getSectorDefaults } from "./sector-data";
import { extractRoicPercentFromRow } from "./news-peers";

export interface ManagementScoreRequestInput {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  description?: string;
  // Segment-Daten (aus bereits geladenen revenueSegments der Analyse)
  segments: Array<{ name: string; revenue: number; percentage: number; growth?: number | null; prevRevenue?: number }>;
  totalRevenue: number;
  totalRevenuePrevYear?: number;
  overallMarginPct?: number | null;
  overallMarginTrend?: "steigend" | "stabil" | "fallend" | null;
  // Delivery-Inputs
  actualRevenueGrowthPct?: number | null;
  guidanceRevenueGrowthPct?: number | null; // FMP Analyst-Estimate-Proxy, vom Aufrufer vorberechnet
  revenueGrowthTrend?: "beschleunigend" | "stabil" | "verlangsamend" | null;
  marginTrend?: "steigend" | "stabil" | "fallend" | null;
  epsOrFcfVsGuidancePct?: number | null;
  // Capital-Inputs
  roicPct?: number | null;
  roic5YPct?: number | null;
  fcfMarginPct?: number | null;
  fcfMarginTrend?: "steigend" | "stabil" | "fallend" | null;
  cashConversionRatio?: number | null;
  reinvestmentEfficiency?: number | null;
  // Credibility-Inputs
  workingCapitalTrend?: "stabil_oder_sinkend" | "steigend_bei_wachstum" | null;
  accrualsLevel?: "niedrig" | "hoch_wiederkehrend" | null;
  // Kontext für News-Penalty
  revenueGrowthPrevYearPct?: number | null;
  fcfMarginPrevYearPct?: number | null;
  roicPrevYearPct?: number | null;
  storyIsPositive?: boolean;
  // Peer-Vergütung (bereits gefilterte Peers aus dem Peer-Fix, optional)
  peerTickers?: string[];
  // News-Headlines für den qualitativen LLM-Baustein
  newsHeadlines?: string[];
  force?: boolean;
}

/** Bestimmt das "neue Segment" als das Top-3-Umsatzsegment mit dem höchsten
 *  YoY-Wachstum — Heuristik, da FMP/SEC kein explizites "ist das neu"-Flag
 *  liefern. Kein Segment mit growth=null wird berücksichtigt (kein Fake). */
function identifyNewSegment(
  segments: ManagementScoreRequestInput["segments"]
): { name: string; sharePct: number; sharePrevPct: number | null; growthPct: number | null } | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const topByShare = [...segments].sort((a, b) => b.percentage - a.percentage).slice(0, 3);
  const withGrowth = topByShare.filter(s => typeof s.growth === "number" && isFinite(s.growth!));
  if (withGrowth.length === 0) return null;
  const candidate = withGrowth.reduce((best, s) => (s.growth! > best.growth! ? s : best));
  const sharePrevPct = candidate.prevRevenue != null && candidate.prevRevenue > 0
    ? null // prevRevenue ist absolut, nicht als Vorjahres-Share verfügbar ohne Vorjahres-Gesamtumsatz — konservativ null statt geschätzt
    : null;
  return { name: candidate.name, sharePct: candidate.percentage, sharePrevPct, growthPct: candidate.growth ?? null };
}

/** Gewichtetes Durchschnittswachstum der übrigen ("alten") Segmente. */
function computeOldSegmentsGrowth(
  segments: ManagementScoreRequestInput["segments"],
  newSegmentName: string
): number | null {
  const olds = segments.filter(s => s.name !== newSegmentName && typeof s.growth === "number" && isFinite(s.growth!));
  if (olds.length === 0) return null;
  const totalWeight = olds.reduce((s, seg) => s + seg.percentage, 0);
  if (totalWeight <= 0) return null;
  const weighted = olds.reduce((s, seg) => s + seg.growth! * seg.percentage, 0) / totalWeight;
  return +weighted.toFixed(2);
}

/** CEO-Zeilen aus der Executive-Compensation-Rohliste extrahieren (Titel-Match,
 *  da FMP kein CEO-Flag liefert), nach Jahr absteigend sortiert. */
function extractCeoCompByYear(rows: any[]): Array<{ year: number; total: number }> {
  const ceoRows = rows.filter(r => /chief executive officer/i.test(String(r?.nameAndPosition ?? "")));
  const byYear = new Map<number, number>();
  for (const r of ceoRows) {
    const year = Number(r?.year);
    const total = Number(r?.total);
    if (isFinite(year) && isFinite(total)) {
      // Falls mehrere Zeilen fuer dasselbe Jahr (z.B. Co-CEOs): Summe nehmen.
      byYear.set(year, (byYear.get(year) ?? 0) + total);
    }
  }
  return Array.from(byYear.entries()).map(([year, total]) => ({ year, total })).sort((a, b) => b.year - a.year);
}

/** Netto-Insider-Transaktionswert (Kauf-Value minus Verkauf-Value) über die
 *  letzten `withinDays` Tage. null, wenn keine Preisdaten vorliegen (viele
 *  RSU-Vesting-Events haben price=0 — die werden dann mit securitiesTransacted
 *  ohne Preis nicht in den Wert einbezogen, nur in Stückzahl-Info geloggt). */
function computeNetInsiderValue(rows: any[], withinDays = 180): number | null {
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  let net = 0;
  let anyPriced = false;
  for (const r of rows) {
    const dateStr = r?.transactionDate;
    const d = dateStr ? new Date(dateStr).getTime() : NaN;
    if (!isFinite(d) || d < cutoff) continue;
    const price = Number(r?.price);
    const qty = Number(r?.securitiesTransacted);
    if (!isFinite(price) || price <= 0 || !isFinite(qty) || qty <= 0) continue; // RSU-Vesting ohne echten Kauf/Verkaufspreis ausgeschlossen
    anyPriced = true;
    const value = price * qty;
    if (r?.acquisitionOrDisposition === "A") net += value;
    else if (r?.acquisitionOrDisposition === "D") net -= value;
  }
  return anyPriced ? net : null;
}

export interface ManagementScoreResult {
  breakdown: ManagementScoreBreakdown;
  dataAsOf: {
    segmentFiscalYear: string | null;
    roicFiscalYear: string | null;
    compensationYear: number | null;
    insiderTradingWindowDays: number;
    generatedAt: string;
  };
  llmModelUsed: string | null;
}

/**
 * Vollstaendige Orchestrierung: nimmt die bereits geladenen Analyse-Daten,
 * holt zusaetzlich Executive-Comp + Comp-Benchmark + Insider-Trading von
 * FMP, ruft optional einen LLM-Call fuer die qualitative Basis, und
 * berechnet den finalen Management-Execution-Score.
 */
export async function computeManagementScoreForTicker(
  input: ManagementScoreRequestInput
): Promise<ManagementScoreResult> {
  const upperTicker = input.ticker.toUpperCase();

  // ── 1. Segment-Score ──
  const newSeg = identifyNewSegment(input.segments);
  let segmentInput: SegmentScoreInput;
  if (!newSeg) {
    segmentInput = {
      newSegmentSharePct: null, newSegmentSharePrevPct: null, newSegmentGrowthPct: null,
      oldSegmentsGrowthPct: null, newSegmentMarginPct: null, overallMarginPct: input.overallMarginPct ?? null,
      marginTrend: null, hasIdentifiableNewSegment: false,
    };
  } else {
    const oldGrowth = computeOldSegmentsGrowth(input.segments, newSeg.name);
    segmentInput = {
      newSegmentSharePct: newSeg.sharePct,
      newSegmentSharePrevPct: newSeg.sharePrevPct,
      newSegmentGrowthPct: newSeg.growthPct,
      oldSegmentsGrowthPct: oldGrowth,
      newSegmentMarginPct: null, // kein separates Segment-Margen-Reporting im aktuellen Datenmodell -> Trend-Fallback unten
      overallMarginPct: input.overallMarginPct ?? null,
      marginTrend: input.overallMarginTrend ?? null,
      hasIdentifiableNewSegment: true,
    };
  }
  const segment = computeSegmentScore(segmentInput);

  // ── 2. Delivery-Score ──
  const delivery = computeDeliveryScore({
    actualRevenueGrowthPct: input.actualRevenueGrowthPct ?? null,
    guidanceRevenueGrowthPct: input.guidanceRevenueGrowthPct ?? null,
    revenueGrowthTrend: input.revenueGrowthTrend ?? null,
    marginTrend: input.marginTrend ?? null,
    epsOrFcfVsGuidancePct: input.epsOrFcfVsGuidancePct ?? null,
  });

  // ── 3. Capital-Score ── (WACC: Sektor-Default, da FMP keinen Firmen-WACC liefert)
  const sectorDefaults = getSectorDefaults(input.sector, input.industry);
  const waccPct = sectorDefaults.waccScenarios.avg;
  const capital = computeCapitalScore({
    roicPct: input.roicPct ?? null,
    roic5YPct: input.roic5YPct ?? null,
    waccPct,
    fcfMarginPct: input.fcfMarginPct ?? null,
    fcfMarginTrend: input.fcfMarginTrend ?? null,
    cashConversionRatio: input.cashConversionRatio ?? null,
    reinvestmentEfficiency: input.reinvestmentEfficiency ?? null,
  });

  // ── 4. Credibility-Score ──
  const credibility = computeCredibilityScore({
    cashConversionRatio: input.cashConversionRatio ?? null,
    workingCapitalTrend: input.workingCapitalTrend ?? null,
    accrualsLevel: input.accrualsLevel ?? null,
  });

  // ── 5. Qual+News-Score ── (FMP strukturiert + optional LLM-Basis)
  const [compRows, insiderRows, roicHistoryRows, peerCompByTicker] = await Promise.all([
    fmpExecutiveCompensation(upperTicker).catch(() => []),
    fmpInsiderTrading(upperTicker, 50).catch(() => []),
    fmpKeyMetrics(upperTicker, 2).catch(() => []),
    input.peerTickers && input.peerTickers.length > 0
      ? Promise.all(input.peerTickers.slice(0, 5).map(t => fmpExecutiveCompensation(t).catch(() => []))).then(arrs => {
          const map = new Map<string, any[]>();
          input.peerTickers!.slice(0, 5).forEach((t, i) => map.set(t, arrs[i] ?? []));
          return map;
        })
      : Promise.resolve(new Map<string, any[]>()),
  ]);

  const ceoCompByYear = extractCeoCompByYear(compRows);
  const ceoCompTotalLatest = ceoCompByYear[0]?.total ?? null;
  const ceoCompTotalPrevYear = ceoCompByYear[1]?.total ?? null;
  const compensationYear = ceoCompByYear[0]?.year ?? null;

  // Peer-Median (echte Peers bevorzugt) — Fallback: Industry-Benchmark
  let referenceCompMedian: number | null = null;
  let referenceCompSource: "peer_median" | "industry_benchmark" | null = null;
  const peerCeoTotals: number[] = [];
  for (const rows of Array.from(peerCompByTicker.values())) {
    const peerCeo = extractCeoCompByYear(rows)[0]?.total;
    if (typeof peerCeo === "number" && isFinite(peerCeo)) peerCeoTotals.push(peerCeo);
  }
  if (peerCeoTotals.length >= 2) {
    const sorted = [...peerCeoTotals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    referenceCompMedian = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    referenceCompSource = "peer_median";
  } else {
    // Fallback: Industry-Benchmark fuer das Vorjahr der Comp-Daten (falls bekannt)
    const benchmarkYear = compensationYear ?? new Date().getFullYear() - 1;
    try {
      const benchRows = await fmpExecutiveCompensationBenchmark(benchmarkYear);
      // Kein direkter String-Match zur FMP-Industry moeglich (unterschiedliche
      // Taxonomien, siehe fmp.ts-Kommentar) -> grober Median ueber alle Zeilen
      // als letzter Kontext-Wert, klar als "industry_benchmark" gekennzeichnet.
      const vals = benchRows.map(r => Number(r?.averageCompensation)).filter(v => isFinite(v) && v > 0);
      if (vals.length > 0) {
        const sorted = [...vals].sort((a, b) => a - b);
        referenceCompMedian = sorted[Math.floor(sorted.length / 2)];
        referenceCompSource = "industry_benchmark";
      }
    } catch { /* kein Fallback verfuegbar -> referenceCompMedian bleibt null */ }
  }

  const roicRows = Array.isArray(roicHistoryRows) ? roicHistoryRows : [];
  const roicPrevYearFromHistory = roicRows.length > 1 ? extractRoicPercentFromRow(roicRows[1]) : null;

  const netInsiderValue = computeNetInsiderValue(insiderRows, 180);

  const deliveryPlusCapitalScore = +(((delivery.score + capital.score + credibility.score) / 3)).toFixed(2);

  const structuredAdjustments = deriveStructuredNewsAdjustments({
    ceoCompTotalLatest, ceoCompTotalPrevYear, referenceCompMedian, referenceCompSource,
    deliveryPlusCapitalScore,
    revenueGrowthPct: input.actualRevenueGrowthPct ?? null,
    revenueGrowthPrevYearPct: input.revenueGrowthPrevYearPct ?? null,
    fcfMarginPct: input.fcfMarginPct ?? null,
    fcfMarginPrevYearPct: input.fcfMarginPrevYearPct ?? null,
    roicPct: input.roicPct ?? null,
    roicPrevYearPct: input.roicPrevYearPct ?? roicPrevYearFromHistory,
    netInsiderTransactionValue: netInsiderValue,
    storyIsPositive: input.storyIsPositive ?? false,
  });

  // Qualitative Basis (0-0.6): LLM, falls verfuegbar UND News-Headlines vorhanden;
  // sonst regelbasierter Proxy aus den bereits berechneten Fundamentaldaten
  // (KEIN Netzwerk-Fake — nur eine transparente Ableitung aus vorhandenen Scores).
  let qualBase = 0.3; // neutraler Default (Mitte von [0, 0.6])
  let llmModelUsed: string | null = null;
  let qualFlagExtra: string | null = null;
  if (isLLMAvailable() && input.newsHeadlines && input.newsHeadlines.length > 0) {
    try {
      const prompt = `Bewerte NUR anhand der folgenden echten News-Headlines zu ${input.companyName} (${upperTicker}) die vier Signale Guidance-Treue, Kapitalallokations-Disziplin, Kommunikationsklarheit und Insider-Verhalten. Antworte NUR mit JSON: {"qualBase": <Zahl zwischen 0 und 0.6>, "rationale": "<1-2 Saetze auf Deutsch>"}. Wenn die Headlines keine belastbaren Signale zu diesen Themen enthalten, antworte mit qualBase=0.3 (neutral) und rationale="keine belastbaren Signale in den Headlines". Erfinde NIEMALS Fakten, die nicht in den Headlines stehen.\n\nHeadlines:\n${input.newsHeadlines.slice(0, 15).map(h => `- ${h}`).join("\n")}`;
      const result = await callLLMJson({ prompt, maxTokens: 300, temperature: 0.2 });
      if (result?.data && typeof result.data.qualBase === "number" && isFinite(result.data.qualBase)) {
        qualBase = clamp(result.data.qualBase, 0, 0.6);
        llmModelUsed = result.modelUsed;
        qualFlagExtra = typeof result.data.rationale === "string" ? result.data.rationale : null;
      }
    } catch { /* LLM-Fehler -> Default-qualBase bleibt bestehen, kein Crash */ }
  }

  const qualNews = computeQualNewsScore({ qualBase, adjustments: structuredAdjustments });
  if (qualFlagExtra) qualNews.flags.push(`LLM-Einschätzung: ${qualFlagExtra}`);
  if (!llmModelUsed) qualNews.flags.push("Qualitative Basis ohne LLM-Bewertung (keine News-Headlines oder LLM nicht verfügbar) — regelbasierter neutraler Default (0.3) verwendet");
  if (referenceCompSource == null) qualNews.flags.push("Kein Vergütungsvergleich möglich (weder Peer-Daten noch Industry-Benchmark verfügbar)");
  else if (referenceCompSource === "industry_benchmark") qualNews.flags.push("Vergütungsvergleich nutzt groben Industry-Benchmark statt echtem Peer-Median (unterschiedliche FMP-Taxonomien)");

  const breakdown = computeManagementScoreBreakdown(delivery, segment, capital, credibility, qualNews);

  return {
    breakdown,
    dataAsOf: {
      segmentFiscalYear: input.segments.length > 0 ? (input as any).segmentFiscalYear ?? null : null,
      roicFiscalYear: null, // vom Aufrufer bereits als roicPct-Kontext bekannt, hier nicht redundant dupliziert
      compensationYear,
      insiderTradingWindowDays: 180,
      generatedAt: new Date().toISOString(),
    },
    llmModelUsed,
  };
}
