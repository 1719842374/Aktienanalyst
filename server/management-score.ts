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
  /** Auftrag 05.08.2026, Punkt 2 (Penalty-Logik absichern): true, wenn die
   *  Delivery-Berechnung auf ausreichend echten Daten beruht (siehe
   *  countAvailableDeliveryInputs) — NICHT ueberwiegend auf neutralen
   *  Defaults, weil Inputs fehlten. Bei false wird die schwere Verguetungs-
   *  Penalty auf ein reines Warn-Flag ohne vollen Punktabzug reduziert
   *  (Ticket: "Wenn zu viele Delivery-Inputs fehlen -> Penalty abschwaechen
   *  oder nur als Warn-Flag ohne vollen Punktabzug anzeigen"). */
  isDeliveryBelastbar: boolean;
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
    if (input.isDeliveryBelastbar) {
      // Volle Penalty, skaliert innerhalb des Ticket-Bandes -0.25..-0.40 je
      // nach Ratio (3x -> -0.25, 6x+ -> -0.40) — nur wenn die "schwache
      // Delivery", auf der der Trigger beruht, tatsaechlich belastbar
      // berechnet wurde.
      const delta = -clamp(lerp(ratio, 3, 6, 0.25, 0.40), 0.25, 0.40);
      adjustments.push({
        type: "excessive_comp_weak_delivery",
        delta,
        rationale: `CEO-Vergütung ${ratio.toFixed(1)}× über dem ${input.referenceCompSource === "peer_median" ? "Peer-Median" : "Branchendurchschnitt"} bei schwacher operativer Delivery (Score ${input.deliveryPlusCapitalScore.toFixed(2)} < 0.45)`,
      });
    } else {
      // Abgeschwaecht: die "schwache Delivery" ist hier vor allem ein
      // Datenlücken-Artefakt (viele neutrale 0.35-Defaults statt echter
      // Werte) — der hohe Verguetungswert ist real und bleibt als Warn-Flag
      // sichtbar, zieht den Score aber nicht mit voller Wucht nach unten.
      const delta = -clamp(lerp(ratio, 3, 6, 0.25, 0.40), 0.25, 0.40) * 0.25; // 75% Abschwaechung
      adjustments.push({
        type: "excessive_comp_weak_delivery",
        delta,
        rationale: `CEO-Vergütung ${ratio.toFixed(1)}× über dem ${input.referenceCompSource === "peer_median" ? "Peer-Median" : "Branchendurchschnitt"} — Delivery-Score liegt unter 0.45, beruht aber überwiegend auf fehlenden Daten statt belegter Schwaeche. Penalty abgeschwaecht (nur Warn-Flag), volle Penalty erfordert belastbare Delivery-Berechnung.`,
      });
    }
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
// Fundamentaldaten-Trends aus FMP-Mehrjahres-Statements ableiten
// ============================================================
// Auftrag 05.08.2026 (Datenpipeline schließen): financialStatements im
// StockAnalysis-Response liefert nur den AKTUELLEN Snapshot (eine Zahl pro
// Feld), keine Mehrjahres-Serie — deshalb konnten Margin-Trend, Cash-
// Conversion, WC-Trend und FCF-Margin-Trend bisher nicht berechnet werden.
// Diese Funktionen nehmen die rohen FMP-/income-statement-, /cash-flow-
// statement- und /balance-sheet-statement-Zeilen (limit>=3, newest-first,
// exakt wie server/fmp.ts sie zurueckgibt) entgegen und leiten die Trends
// direkt her — kein neuer FMP-Endpoint-Typ, nur groesseres `limit` auf den
// bereits vorhandenen fmpIncomeStatement/fmpCashFlow/fmpBalanceSheet-Calls.

export type TrendDirection = "steigend" | "stabil" | "fallend";

/** Klassifiziert eine Zahlenreihe (newest-first) als steigend/stabil/fallend.
 *  Braucht mindestens 2 Werte. Schwelle 1.5pp/Prozentpunkt-äquivalent, um
 *  Rauschen nicht als Trend zu werten. */
function classifyTrend(valuesNewestFirst: (number | null)[], thresholdPp = 1.0): TrendDirection | null {
  const valid = valuesNewestFirst.filter((v): v is number => v != null && isFinite(v));
  if (valid.length < 2) return null;
  // Chronologisch (ältest -> neuest) fuer eine stabile Trendrichtung
  const chrono = [...valid].reverse();
  const first = chrono[0];
  const last = chrono[chrono.length - 1];
  const delta = last - first;
  if (delta > thresholdPp) return "steigend";
  if (delta < -thresholdPp) return "fallend";
  return "stabil";
}

export interface StatementTrendInputs {
  /** newest-first, wie von fmpIncomeStatement(ticker, limit>=3) geliefert. */
  incomeRows: any[];
  /** newest-first, wie von fmpCashFlow(ticker, limit>=3) geliefert. */
  cashflowRows: any[];
  /** newest-first, wie von fmpBalanceSheet(ticker, limit>=3) geliefert. */
  balanceRows: any[];
}

export interface StatementTrendResult {
  operatingMarginTrend: TrendDirection | null;
  grossMarginTrend: TrendDirection | null;
  /** Kombiniert Operating+Gross — fuer S_Delivery.marginTrend (Ticket: "Op. / Gross"). */
  marginTrend: TrendDirection | null;
  fcfMarginTrend: TrendDirection | null;
  fcfMarginPct: number | null; // aktuellste Periode
  cashConversionRatio: number | null; // OCF / Net Income, aktuellste Periode
  workingCapitalTrend: "stabil_oder_sinkend" | "steigend_bei_wachstum" | null;
  reinvestmentEfficiency: number | null; // Revenue-Wachstum% / ΔInvested-Capital%
  revenueGrowthPrevYearPct: number | null; // fuer comp_up_performance_down-Vergleich
  fcfMarginPrevYearPct: number | null;
  flags: string[];
}

function numOrNull(v: any): number | null {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/**
 * Leitet alle Statement-basierten Trend-Inputs aus den rohen FMP-Zeilen her.
 * Reine Funktion (keine Netzwerkzugriffe) — unit-testbar mit synthetischen
 * Fixtures. Jeder Trend, der mangels Datenpunkten nicht bestimmbar ist,
 * bleibt null + wird in `flags` benannt (kein Fake-Trend).
 */
export function deriveStatementTrends(input: StatementTrendInputs): StatementTrendResult {
  const flags: string[] = [];
  const income = Array.isArray(input.incomeRows) ? input.incomeRows : [];
  const cashflow = Array.isArray(input.cashflowRows) ? input.cashflowRows : [];
  const balance = Array.isArray(input.balanceRows) ? input.balanceRows : [];

  // ── Margentrends (Income Statement) ──
  const operatingMargins = income.map(r => {
    const rev = numOrNull(r?.revenue);
    const opInc = numOrNull(r?.operatingIncome);
    return rev && rev > 0 && opInc != null ? (opInc / rev) * 100 : null;
  });
  const grossMargins = income.map(r => {
    const rev = numOrNull(r?.revenue);
    const gp = numOrNull(r?.grossProfit);
    return rev && rev > 0 && gp != null ? (gp / rev) * 100 : null;
  });
  const operatingMarginTrend = classifyTrend(operatingMargins);
  const grossMarginTrend = classifyTrend(grossMargins);
  if (operatingMarginTrend == null && grossMarginTrend == null) flags.push("Margentrend nicht bestimmbar (zu wenig Income-Statement-Historie)");
  // Kombiniert: wenn beide vorhanden und einig -> diese Richtung; wenn nur
  // eine vorhanden -> diese; wenn beide vorhanden aber uneinig -> stabil
  // (konservativ, kein erfundener Konsens).
  let marginTrend: TrendDirection | null = null;
  if (operatingMarginTrend && grossMarginTrend) {
    marginTrend = operatingMarginTrend === grossMarginTrend ? operatingMarginTrend : "stabil";
  } else {
    marginTrend = operatingMarginTrend ?? grossMarginTrend;
  }

  // ── FCF-Marge + Trend (Cash Flow + Revenue aus Income Statement) ──
  const fcfMargins: (number | null)[] = cashflow.map((r, i) => {
    const ocf = numOrNull(r?.operatingCashFlow ?? r?.netCashProvidedByOperatingActivities);
    const capex = numOrNull(r?.capitalExpenditure ?? r?.capitalExpenditures);
    const rev = numOrNull(income[i]?.revenue); // gleiche Periode, newest-first parallel
    if (ocf == null || capex == null || !rev || rev <= 0) return null;
    const fcf = ocf - Math.abs(capex);
    return (fcf / rev) * 100;
  });
  const fcfMarginTrend = classifyTrend(fcfMargins);
  const fcfMarginPct = fcfMargins[0] ?? null;
  const fcfMarginPrevYearPct = fcfMargins[1] ?? null;
  if (fcfMarginPct == null) flags.push("FCF-Marge nicht berechenbar (Cashflow- oder Revenue-Daten fehlen)");
  else if (fcfMarginTrend == null) flags.push("FCF-Margentrend nicht bestimmbar (zu wenig Historie)");

  // ── Cash Conversion (OCF / Net Income), aktuellste Periode ──
  const ocfLatest = numOrNull(cashflow[0]?.operatingCashFlow ?? cashflow[0]?.netCashProvidedByOperatingActivities);
  const netIncomeLatest = numOrNull(income[0]?.netIncome ?? cashflow[0]?.netIncome);
  const cashConversionRatio = ocfLatest != null && netIncomeLatest != null && netIncomeLatest !== 0
    ? ocfLatest / netIncomeLatest
    : null;
  if (cashConversionRatio == null) flags.push("Cash-Conversion (OCF/Net Income) nicht berechenbar");

  // ── Working-Capital-Trend (Inventory + Receivables Days vs. Revenue-Wachstum) ──
  // Ticket-Regel: "stabil oder sinkend" ist gut, "stark steigend bei
  // wachsendem Umsatz" ist schlecht. Wir vergleichen die WACHSTUMSRATE von
  // (Inventory+Receivables) gegen die Umsatzwachstumsrate ueber denselben
  // Zeitraum — waechst WC deutlich schneller als der Umsatz, ist das ein
  // Warnsignal (Lagerbestandsaufbau/Zahlungsverzug), nicht nur der Roh-Trend.
  let workingCapitalTrend: "stabil_oder_sinkend" | "steigend_bei_wachstum" | null = null;
  if (balance.length >= 2 && income.length >= 2) {
    const wcLatest = (numOrNull(balance[0]?.inventory) ?? 0) + (numOrNull(balance[0]?.netReceivables ?? balance[0]?.accountsReceivable) ?? 0);
    const wcPrev = (numOrNull(balance[1]?.inventory) ?? 0) + (numOrNull(balance[1]?.netReceivables ?? balance[1]?.accountsReceivable) ?? 0);
    const revLatest = numOrNull(income[0]?.revenue);
    const revPrev = numOrNull(income[1]?.revenue);
    if (wcPrev > 0 && revPrev && revPrev > 0 && revLatest != null) {
      const wcGrowthPct = ((wcLatest - wcPrev) / wcPrev) * 100;
      const revGrowthPct = ((revLatest - revPrev) / revPrev) * 100;
      // WC waechst > 10pp schneller als der Umsatz -> Warnsignal
      workingCapitalTrend = wcGrowthPct - revGrowthPct > 10 ? "steigend_bei_wachstum" : "stabil_oder_sinkend";
    }
  }
  if (workingCapitalTrend == null) flags.push("Working-Capital-Trend nicht bestimmbar (Inventory/Receivables-Historie fehlt)");

  // ── Reinvestment-Effizienz: Revenue-Wachstum% / ΔInvested-Capital% ──
  // Invested Capital ≈ Total Debt + Total Equity - Cash (gaengige Naeherung,
  // konsistent mit ROIC-Definitionen). Nur berechnet, wenn beide Perioden
  // vollstaendige Bilanzdaten haben.
  let reinvestmentEfficiency: number | null = null;
  if (balance.length >= 2 && income.length >= 2) {
    const icLatest = numOrNull(balance[0]?.totalDebt) != null && numOrNull(balance[0]?.totalStockholdersEquity ?? balance[0]?.totalEquity) != null
      ? (numOrNull(balance[0]?.totalDebt)! + numOrNull(balance[0]?.totalStockholdersEquity ?? balance[0]?.totalEquity)! - (numOrNull(balance[0]?.cashAndCashEquivalents) ?? 0))
      : null;
    const icPrev = numOrNull(balance[1]?.totalDebt) != null && numOrNull(balance[1]?.totalStockholdersEquity ?? balance[1]?.totalEquity) != null
      ? (numOrNull(balance[1]?.totalDebt)! + numOrNull(balance[1]?.totalStockholdersEquity ?? balance[1]?.totalEquity)! - (numOrNull(balance[1]?.cashAndCashEquivalents) ?? 0))
      : null;
    const revLatest = numOrNull(income[0]?.revenue);
    const revPrev = numOrNull(income[1]?.revenue);
    if (icLatest != null && icPrev != null && icPrev > 0 && revLatest != null && revPrev && revPrev > 0) {
      const revGrowthPct = ((revLatest - revPrev) / revPrev) * 100;
      const icGrowthPct = ((icLatest - icPrev) / icPrev) * 100;
      // Effizienz = Umsatzwachstum je Prozentpunkt Kapitalwachstum. Bei ICGrowth
      // nahe 0 (kaum reinvestiert, aber trotzdem gewachsen) -> hohe Efficiency
      // (Boden bei 0.1pp Nenner, um Division durch ~0 zu vermeiden).
      reinvestmentEfficiency = revGrowthPct / (Math.max(Math.abs(icGrowthPct), 0.1) * Math.sign(icGrowthPct || 1));
    }
  }
  if (reinvestmentEfficiency == null) flags.push("Reinvestment-Effizienz nicht berechenbar (Bilanz-Historie unvollständig)");

  const revenueGrowthPrevYearPct = income.length >= 3 && numOrNull(income[1]?.revenue) && numOrNull(income[2]?.revenue)
    ? (((numOrNull(income[1]?.revenue)! - numOrNull(income[2]?.revenue)!) / numOrNull(income[2]?.revenue)!) * 100)
    : null;

  return {
    operatingMarginTrend, grossMarginTrend, marginTrend,
    fcfMarginTrend, fcfMarginPct: fcfMarginPct != null ? +fcfMarginPct.toFixed(1) : null,
    cashConversionRatio: cashConversionRatio != null ? +cashConversionRatio.toFixed(2) : null,
    workingCapitalTrend,
    reinvestmentEfficiency: reinvestmentEfficiency != null ? +reinvestmentEfficiency.toFixed(2) : null,
    revenueGrowthPrevYearPct: revenueGrowthPrevYearPct != null ? +revenueGrowthPrevYearPct.toFixed(1) : null,
    fcfMarginPrevYearPct: fcfMarginPrevYearPct != null ? +fcfMarginPrevYearPct.toFixed(1) : null,
    flags,
  };
}

/**
 * Zaehlt, wie viele der zentralen Delivery/Capital/Credibility-Inputs
 * tatsaechlich berechnet werden konnten (nicht null). Wird verwendet, um zu
 * entscheiden, ob die Delivery-Berechnung "belastbar" ist (Ticket-Regel 2:
 * schwere Verguetungs-Penalty nur bei belastbarer Delivery).
 */
export function countAvailableDeliveryInputs(inputs: {
  actualRevenueGrowthPct: number | null;
  marginTrend: TrendDirection | null;
  epsOrFcfVsGuidancePct: number | null;
  roicPct: number | null;
  fcfMarginPct: number | null;
  cashConversionRatio: number | null;
}): { available: number; total: number; isBelastbar: boolean } {
  const checks = [
    inputs.actualRevenueGrowthPct,
    inputs.marginTrend,
    inputs.epsOrFcfVsGuidancePct,
    inputs.roicPct,
    inputs.fcfMarginPct,
    inputs.cashConversionRatio,
  ];
  const available = checks.filter(v => v != null).length;
  const total = checks.length;
  // "Belastbar" = mindestens die Haelfte der zentralen Inputs vorhanden UND
  // mindestens der Revenue-Wert (Kernkennzahl) verfuegbar — ohne echtes
  // Revenue-Wachstum ist keine sinnvolle Delivery-Aussage moeglich.
  const isBelastbar = available >= Math.ceil(total / 2) && inputs.actualRevenueGrowthPct != null;
  return { available, total, isBelastbar };
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

import { fmpExecutiveCompensation, fmpExecutiveCompensationBenchmark, fmpInsiderTrading, fmpKeyMetrics, fmpIncomeStatement, fmpCashFlow, fmpBalanceSheet } from "./fmp";
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
  segments: Array<{ name: string; revenue: number; percentage: number; growth?: number | null; prevRevenue?: number; prevPercentage?: number }>;
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

/**
 * Segment-Heuristik v2 (Nutzer-Entscheidung 06.08.2026, nach MSFT-Live-Fund):
 * Live-Fund: XBOX (kein Vorjahreswert in den FMP-Rohdaten, wahrscheinlich
 * Segment-Umbenennung/Reporting-Aenderung — KEIN echtes neues Segment) wurde
 * von der alten "Prio 1: neu aufgetaucht"-Regel faelschlich vor Server/Azure
 * (+31.5% Wachstum, Anteil 34.9%→39%) gewählt. "Neu aufgetaucht" ist bei FMP
 * zu fragil, um als Hauptkriterium zu dienen — degradiert zum reinen
 * Fallback mit Mindestumsatzfilter.
 *
 * Neue Prioritaet (Nutzervorgabe, ersetzt die alte Reihenfolge):
 *  1. PRIMAER: hohes YoY-Wachstum UND steigender Umsatzanteil (die eigentliche
 *     Story) UND Anteil noch nicht dominant (<50%, verhindert dass das
 *     ohnehin groesste Segment als "neuer Shift" gilt).
 *  2. SEKUNDAER: sehr hohes Wachstum (>=15%) bei noch moderatem Anteil
 *     (<35%), auch ohne perfekten Vorjahres-Anteils-Wert.
 *  3. LETZTER AUSWEG: "neu aufgetaucht" (kein prevRevenue, kein growth) NUR
 *     mit Mindestumsatzfilter (>=3% vom Gesamtumsatz), damit Mini-Segmente
 *     oder reine Reporting-Artefakte nicht gewinnen. `noPriorYearFlag` wird
 *     in diesem Fall gesetzt, damit die UI "kein Vorjahreswert — moegliche
 *     Segment-Umbenennung" anzeigen kann statt ein hartes ΔShare zu suggerieren.
 * Kommt keine Kandidatengruppe zustande, liefert die Funktion null und
 * S_Segment faellt auf die dokumentierte neutrale Sonderregel (0.35).
 */
export function identifyNewSegment(
  segments: ManagementScoreRequestInput["segments"]
): { name: string; sharePct: number; sharePrevPct: number | null; growthPct: number | null; noPriorYearFlag?: boolean } | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;

  const toResult = (s: ManagementScoreRequestInput["segments"][number], noPriorYearFlag = false) => ({
    name: s.name,
    sharePct: s.percentage,
    sharePrevPct: typeof (s as any).prevPercentage === "number" ? (s as any).prevPercentage : null,
    growthPct: typeof s.growth === "number" && isFinite(s.growth) ? s.growth : null,
    ...(noPriorYearFlag ? { noPriorYearFlag: true } : {}),
  });

  // Prio 1 (PRIMAER): Growth + steigender Anteil + noch nicht dominant (<50%).
  const growthAndRisingShare = segments
    .filter(s =>
      typeof s.growth === "number" && isFinite(s.growth) && s.growth > 0 &&
      typeof (s as any).prevPercentage === "number" &&
      s.percentage > (s as any).prevPercentage &&
      s.percentage < 50
    )
    .sort((a, b) => b.growth! - a.growth!)[0];
  if (growthAndRisingShare) return toResult(growthAndRisingShare);

  // Prio 2 (SEKUNDAER): hohes Wachstum (>=15%) UND moderater Anteil (<35%),
  // auch ohne belastbaren Vorjahres-Anteils-Wert.
  const highGrowthModerateShare = segments
    .filter(s => typeof s.growth === "number" && isFinite(s.growth) && s.growth >= 15 && s.percentage < 35)
    .sort((a, b) => b.growth! - a.growth!)[0];
  if (highGrowthModerateShare) return toResult(highGrowthModerateShare);

  // Prio 3 (LETZTER AUSWEG): neu aufgetaucht, NUR mit Mindestumsatzfilter
  // (>=3% vom Gesamtumsatz) — verhindert, dass Mini-Segmente oder reine
  // Reporting-Artefakte (z.B. XBOX ohne Vorjahreswert bei MSFT) gewinnen,
  // waehrend echte kleine, aber materielle neue Sparten weiterhin erkannt
  // werden. noPriorYearFlag=true signalisiert der UI die Unsicherheit.
  const brandNew = segments.find(s => s.revenue > 0 && s.prevRevenue == null && s.growth == null && s.percentage >= 3);
  if (brandNew) return toResult(brandNew, true);

  return null;
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
  /** Auftrag 05.08.2026, Punkt 4: Transparenz ueber die Datenlage der
   *  Delivery-Bausteine — UI zeigt einen Hinweis, wenn der Score wegen
   *  fehlender Inputs weniger aussagekräftig ist, statt das stillschweigend
   *  in einer niedrigen Zahl verschwinden zu lassen. */
  deliveryDataQuality: {
    availableInputs: number;
    totalInputs: number;
    isBelastbar: boolean;
    warning: string | null;
  };
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

  // ── 0. Datenpipeline schließen (Auftrag 05.08.2026): Mehrjahres-Statements
  // direkt von FMP holen (limit=4 reicht für alle Trend-Klassifikationen
  // oben) statt auf einzelne, vom Client mitgeschickte Snapshot-Werte
  // angewiesen zu sein. Client-Werte (falls vorhanden) dienen nur noch als
  // Fallback, wenn dieser Fetch fehlschlägt — die serverseitige Herleitung
  // hat Vorrang, weil sie die vollständige Historie nutzt.
  let trends: StatementTrendResult | null = null;
  try {
    const [incomeRows, cashflowRows, balanceRows] = await Promise.all([
      fmpIncomeStatement(upperTicker, 4).catch(() => []),
      fmpCashFlow(upperTicker, 4).catch(() => []),
      fmpBalanceSheet(upperTicker, 4).catch(() => []),
    ]);
    trends = deriveStatementTrends({ incomeRows, cashflowRows, balanceRows });
  } catch {
    trends = null; // Fetch komplett fehlgeschlagen -> alle Felder unten fallen auf Client-Input/null zurück
  }

  const marginTrend = trends?.marginTrend ?? input.marginTrend ?? null;
  const fcfMarginTrend = trends?.fcfMarginTrend ?? input.fcfMarginTrend ?? null;
  const fcfMarginPct = trends?.fcfMarginPct ?? input.fcfMarginPct ?? null;
  const cashConversionRatio = trends?.cashConversionRatio ?? input.cashConversionRatio ?? null;
  const workingCapitalTrend = trends?.workingCapitalTrend ?? input.workingCapitalTrend ?? null;
  const reinvestmentEfficiency = trends?.reinvestmentEfficiency ?? input.reinvestmentEfficiency ?? null;
  const revenueGrowthPrevYearPct = trends?.revenueGrowthPrevYearPct ?? input.revenueGrowthPrevYearPct ?? null;
  const fcfMarginPrevYearPct = trends?.fcfMarginPrevYearPct ?? input.fcfMarginPrevYearPct ?? null;
  const statementFlags = trends?.flags ?? ["Mehrjahres-Statements nicht abrufbar — Trends basieren auf ggf. unvollständigen Client-Daten"];

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
      marginTrend: marginTrend, // jetzt aus der echten Mehrjahres-Historie statt fast immer null
      hasIdentifiableNewSegment: true,
    };
  }
  const segment = computeSegmentScore(segmentInput);
  if (newSeg && (newSeg as any).noPriorYearFlag) {
    segment.flags.push(`„${newSeg.name}“ hat keinen Vorjahreswert in den FMP-Segmentdaten — mögliche Segment-Umbenennung/Reporting-Änderung statt eines echten neuen Geschäftszweigs. ΔShare entsprechend unsicher.`);
  }

  // ── 2. Delivery-Score ──
  const delivery = computeDeliveryScore({
    actualRevenueGrowthPct: input.actualRevenueGrowthPct ?? null,
    guidanceRevenueGrowthPct: input.guidanceRevenueGrowthPct ?? null,
    revenueGrowthTrend: input.revenueGrowthTrend ?? null,
    marginTrend: marginTrend,
    epsOrFcfVsGuidancePct: input.epsOrFcfVsGuidancePct ?? null,
  });

  // Belastbarkeits-Check (Auftrag 05.08.2026, Punkt 2): zaehlt, wie viele der
  // zentralen Delivery/Capital-Inputs tatsaechlich vorliegen. Wird unten fuer
  // die Penalty-Abschwaechung verwendet.
  const deliveryInputAvailability = countAvailableDeliveryInputs({
    actualRevenueGrowthPct: input.actualRevenueGrowthPct ?? null,
    marginTrend,
    epsOrFcfVsGuidancePct: input.epsOrFcfVsGuidancePct ?? null,
    roicPct: input.roicPct ?? null,
    fcfMarginPct,
    cashConversionRatio,
  });

  // ── 3. Capital-Score ── (WACC: Sektor-Default, da FMP keinen Firmen-WACC liefert)
  const sectorDefaults = getSectorDefaults(input.sector, input.industry);
  const waccPct = sectorDefaults.waccScenarios.avg;
  const capital = computeCapitalScore({
    roicPct: input.roicPct ?? null,
    roic5YPct: input.roic5YPct ?? null,
    waccPct,
    fcfMarginPct,
    fcfMarginTrend,
    cashConversionRatio,
    reinvestmentEfficiency,
  });

  // ── 4. Credibility-Score ──
  const credibility = computeCredibilityScore({
    cashConversionRatio,
    workingCapitalTrend,
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
    revenueGrowthPrevYearPct: revenueGrowthPrevYearPct,
    fcfMarginPct,
    fcfMarginPrevYearPct: fcfMarginPrevYearPct,
    roicPct: input.roicPct ?? null,
    roicPrevYearPct: input.roicPrevYearPct ?? roicPrevYearFromHistory,
    netInsiderTransactionValue: netInsiderValue,
    storyIsPositive: input.storyIsPositive ?? false,
    isDeliveryBelastbar: deliveryInputAvailability.isBelastbar,
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

  // Statement-Trend-Flags (Datenpipeline-Transparenz) in die Delivery-Flags
  // einspeisen, damit sie in der UI zusammen mit den uebrigen Delivery-
  // Hinweisen erscheinen (additiv, dedupliziert).
  for (const f of statementFlags) {
    if (!breakdown.delivery.flags.includes(f)) breakdown.delivery.flags.push(f);
    if (!breakdown.allFlags.includes(f)) breakdown.allFlags.push(f);
  }

  // Auftrag 05.08.2026, Punkt 4 (UI-Transparenz): Datenlage-Hinweis, wenn
  // viele zentrale Delivery-Inputs fehlen — Score bleibt sichtbar, aber wird
  // explizit als weniger aussagekraeftig gekennzeichnet statt stillschweigend
  // niedrig zu wirken.
  let dataQualityWarning: string | null = null;
  if (!deliveryInputAvailability.isBelastbar) {
    dataQualityWarning = `Eingeschränkte Datenlage — nur ${deliveryInputAvailability.available}/${deliveryInputAvailability.total} zentrale Delivery-Kennzahlen berechenbar. Score weniger aussagekräftig, Vergütungs-Penalties (falls vorhanden) wurden abgeschwächt.`;
  }

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
    deliveryDataQuality: {
      availableInputs: deliveryInputAvailability.available,
      totalInputs: deliveryInputAvailability.total,
      isBelastbar: deliveryInputAvailability.isBelastbar,
      warning: dataQualityWarning,
    },
  };
}
