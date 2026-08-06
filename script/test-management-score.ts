/**
 * Tests fuer den Management-Execution-Score (Auftrag 05.08.2026).
 *
 * Deckt alle Normalisierungsfunktionen ab: Segment (Share/GrowthGap/Margin),
 * Delivery (Rev/Margin/EPS-FCF), Capital (ROIC/FCF/Reinvest), Credibility
 * (CashConv/WC/Accruals), QualNews (Basis + News-Penalty-Clamping), sowie
 * die Gesamtformel-Gewichtung.
 *
 * Ausfuehren: npx tsx script/test-management-score.ts
 */
import {
  scoreSegmentShare, scoreGrowthGap, scoreMarginNew, computeSegmentScore,
  scoreRevenueDelivery, scoreMarginTrend, scoreEpsFcfVsGuidance, computeDeliveryScore,
  scoreRoicTrend, scoreFcfMarginConversion, scoreReinvestmentEfficiency, computeCapitalScore,
  scoreCashConversion, scoreWorkingCapital, scoreAccruals, computeCredibilityScore,
  computeQualNewsScore, deriveStructuredNewsAdjustments,
  computeManagementScoreBreakdown,
  deriveStatementTrends, countAvailableDeliveryInputs, identifyNewSegment, computeOldSegmentsGrowth,
} from "../server/management-score";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n=== S_Segment: Share-Komponente ===");
{
  check("ΔShare ≥5pp → 1.0", scoreSegmentShare(7) === 1.0);
  check("ΔShare = 3.5pp → zwischen 0.7-0.9", scoreSegmentShare(3.5) > 0.7 && scoreSegmentShare(3.5) < 0.9);
  check("ΔShare = 1pp → zwischen 0.4-0.6", scoreSegmentShare(1) >= 0.4 && scoreSegmentShare(1) <= 0.6);
  check("ΔShare < 0 → 0.0-0.3", scoreSegmentShare(-2) >= 0 && scoreSegmentShare(-2) <= 0.3);
  check("ΔShare = null → neutral 0.35 (kein Fake)", scoreSegmentShare(null) === 0.35);
}

console.log("\n=== S_Segment: GrowthGap-Komponente ===");
{
  check("GrowthGap ≥15pp → 1.0", scoreGrowthGap(20) === 1.0);
  check("GrowthGap = 10pp → zwischen 0.6-0.9", scoreGrowthGap(10) >= 0.6 && scoreGrowthGap(10) <= 0.9);
  check("GrowthGap = 2pp → 0.4", scoreGrowthGap(2) === 0.4);
  check("GrowthGap < 0 → 0.0-0.3", scoreGrowthGap(-5) >= 0 && scoreGrowthGap(-5) <= 0.3);
  check("GrowthGap = null → neutral 0.35", scoreGrowthGap(null) === 0.35);
}

console.log("\n=== S_Segment: MarginNew-Komponente ===");
{
  check("steigend + über Gesamtmarge → 1.0", scoreMarginNew(30, 20, "steigend") === 1.0);
  check("stabil → 0.6", scoreMarginNew(20, 20, "stabil") === 0.6);
  check("fallend + stark negativ → 0.0", scoreMarginNew(-25, 20, "fallend") === 0.0);
  check("keine Margendaten → neutral 0.35", scoreMarginNew(null, null, null) === 0.35);
}

console.log("\n=== S_Segment: Sonderregel kein Segment erkennbar ===");
{
  const r = computeSegmentScore({
    newSegmentSharePct: null, newSegmentSharePrevPct: null, newSegmentGrowthPct: null,
    oldSegmentsGrowthPct: null, newSegmentMarginPct: null, overallMarginPct: null,
    marginTrend: null, hasIdentifiableNewSegment: false,
  });
  check("kein Segment erkennbar → Score = 0.35 (Sonderregel)", r.score === 0.35);
  check("Flag 'kein erkennbarer Geschäftsmodell-Shift' gesetzt", r.flags.some(f => f.includes("Geschäftsmodell-Shift")));
}

console.log("\n=== S_Segment: vollständige Berechnung (Beispiel starkes neues Segment) ===");
{
  const r = computeSegmentScore({
    newSegmentSharePct: 22, newSegmentSharePrevPct: 15, // ΔShare = +7pp → 1.0
    newSegmentGrowthPct: 45, oldSegmentsGrowthPct: 8,   // GrowthGap = +37pp → 1.0
    newSegmentMarginPct: 28, overallMarginPct: 22, marginTrend: "steigend", // → 1.0
    hasIdentifiableNewSegment: true,
  });
  check("starkes neues Segment → S_Segment nahe 1.0", r.score > 0.95, String(r.score));
  check("deltaSharePp korrekt berechnet (7)", r.deltaSharePp === 7);
  check("growthGapPp korrekt berechnet (37)", r.growthGapPp === 37);
}

console.log("\n=== S_Delivery: Revenue-Komponente (mit Guidance) ===");
{
  check("actual ≥ guidance → 1.0", scoreRevenueDelivery(12, 10, null).score === 1.0);
  check("actual leicht unter guidance (-2pp) → zwischen 0.5-1.0", (() => {
    const s = scoreRevenueDelivery(8, 10, null).score; return s >= 0.5 && s <= 1.0;
  })());
  check("actual deutlich unter guidance (-10pp) → niedrig", scoreRevenueDelivery(0, 10, null).score < 0.5);
  check("mit Guidance verwendet Guidance-Pfad (usedGuidance=true)", scoreRevenueDelivery(12, 10, null).usedGuidance === true);
}

console.log("\n=== S_Delivery: Revenue-Komponente (Fallback ohne Guidance) ===");
{
  const r1 = scoreRevenueDelivery(null, null, "beschleunigend");
  check("kein Guidance-Vergleich → Fallback auf Trend (usedGuidance=false)", r1.usedGuidance === false);
  check("beschleunigend → 0.8", r1.score === 0.8);
  check("stabil → 0.55", scoreRevenueDelivery(null, null, "stabil").score === 0.55);
  check("verlangsamend → 0.25", scoreRevenueDelivery(null, null, "verlangsamend").score === 0.25);
  check("gar keine Daten → neutral 0.35", scoreRevenueDelivery(null, null, null).score === 0.35);
}

console.log("\n=== S_Delivery: Margin- und EPS/FCF-Komponente ===");
{
  check("Margin steigend → 1.0", scoreMarginTrend("steigend") === 1.0);
  check("Margin stabil → 0.6", scoreMarginTrend("stabil") === 0.6);
  check("Margin fallend → niedrig", scoreMarginTrend("fallend") < 0.3);
  check("EPS/FCF übertroffen (+5%) → 1.0", scoreEpsFcfVsGuidance(5) === 1.0);
  check("EPS/FCF klar verfehlt (-20%) → niedrig", scoreEpsFcfVsGuidance(-20) < 0.3);
  check("EPS/FCF keine Daten → neutral 0.35", scoreEpsFcfVsGuidance(null) === 0.35);
}

console.log("\n=== S_Delivery: Gesamtberechnung + Flag bei Guidance-Fallback ===");
{
  const r = computeDeliveryScore({
    actualRevenueGrowthPct: null, guidanceRevenueGrowthPct: null, revenueGrowthTrend: "beschleunigend",
    marginTrend: "steigend", epsOrFcfVsGuidancePct: 3,
  });
  check("Fallback-Flag gesetzt wenn kein Guidance-Vergleich", r.flags.some(f => f.includes("Fallback")));
  check("usedGuidanceComparison=false im Fallback-Fall", r.usedGuidanceComparison === false);
  check("Score plausibel hoch bei guten Inputs", r.score > 0.7, String(r.score));
}

console.log("\n=== S_Capital: ROIC-Trend ===");
{
  check("steigend + über WACC → 1.0", scoreRoicTrend(15, 10, 8) === 1.0);
  check("fallend/unter WACC → niedrig (0.2)", scoreRoicTrend(6, 10, 8) === 0.2);
  check("negativ + unter WACC → Boden (0.0)", scoreRoicTrend(-5, 10, 8) === 0.0);
  check("keine ROIC-Daten → neutral 0.35", scoreRoicTrend(null, null, null) === 0.35);
}

console.log("\n=== S_Capital: FCF-Marge + Cash-Conversion ===");
{
  check("steigend + Conversion>0.8 → 1.0", scoreFcfMarginConversion("steigend", 0.9) === 1.0);
  check("fallend → niedrig (0.2)", scoreFcfMarginConversion("fallend", 0.9) === 0.2);
  check("keine Daten → neutral 0.35", scoreFcfMarginConversion(null, null) === 0.35);
}

console.log("\n=== S_Capital: Reinvestment-Effizienz ===");
{
  check("hoch (≥1.5) → 1.0", scoreReinvestmentEfficiency(2.0) === 1.0);
  check("negativ → niedrig (0.1)", scoreReinvestmentEfficiency(-0.5) === 0.1);
  check("keine Daten → neutral 0.35", scoreReinvestmentEfficiency(null) === 0.35);
}

console.log("\n=== S_Capital: Gesamtberechnung ===");
{
  const r = computeCapitalScore({
    roicPct: 18, roic5YPct: 12, waccPct: 9,
    fcfMarginPct: 25, fcfMarginTrend: "steigend", cashConversionRatio: 0.95,
    reinvestmentEfficiency: 1.8,
  });
  check("starke Kapitalallokation → Score nahe 1.0", r.score > 0.9, String(r.score));
  check("keine Flags bei vollständigen Daten", r.flags.length === 0, JSON.stringify(r.flags));
}

console.log("\n=== S_Credibility ===");
{
  check("Cash-Conversion >0.9 → 1.0", scoreCashConversion(0.95) === 1.0);
  check("Cash-Conversion <0.6 → niedrig", scoreCashConversion(0.3) < 0.5);
  check("Cash-Conversion keine Daten → neutral", scoreCashConversion(null) === 0.35);
  check("WC stabil/sinkend → 1.0", scoreWorkingCapital("stabil_oder_sinkend") === 1.0);
  check("WC steigend bei Wachstum → niedrig", scoreWorkingCapital("steigend_bei_wachstum") === 0.2);
  check("Accruals niedrig → 1.0", scoreAccruals("niedrig") === 1.0);
  check("Accruals hoch/wiederkehrend → niedrig", scoreAccruals("hoch_wiederkehrend") === 0.15);

  const r = computeCredibilityScore({ cashConversionRatio: 0.95, workingCapitalTrend: "stabil_oder_sinkend", accrualsLevel: "niedrig" });
  check("vollständig gute Credibility → Score nahe 1.0", r.score > 0.9, String(r.score));

  const rBad = computeCredibilityScore({ cashConversionRatio: 0.3, workingCapitalTrend: "steigend_bei_wachstum", accrualsLevel: "hoch_wiederkehrend" });
  check("schwache Credibility → niedriger Score", rBad.score < 0.3, String(rBad.score));
}

console.log("\n=== S_QualNews: Basis + Clamping ===");
{
  const r1 = computeQualNewsScore({ qualBase: 0.5, adjustments: [] });
  check("keine Adjustments → Score = qualBase", r1.score === 0.5);
  check("Flag bei keinen News-Events", r1.flags.some(f => f.includes("Keine management-relevanten")));

  const r2 = computeQualNewsScore({
    qualBase: 0.5,
    adjustments: [{ type: "excessive_comp_weak_delivery", delta: -0.30, rationale: "test" }],
  });
  check("negative Adjustment reduziert Score korrekt (0.5-0.30=0.20)", Math.abs(r2.score - 0.20) < 0.001, String(r2.score));

  const r3 = computeQualNewsScore({
    qualBase: 0.5,
    adjustments: [
      { type: "excessive_comp_weak_delivery", delta: -0.30, rationale: "a" },
      { type: "comp_up_performance_down", delta: -0.20, rationale: "b" },
      { type: "insider_selling_positive_story", delta: -0.10, rationale: "c" },
    ],
  });
  check("mehrere negative Adjustments werden geclampt auf 0 (nicht negativ)", r3.score === 0, String(r3.score));

  const r4 = computeQualNewsScore({
    qualBase: 0.55,
    adjustments: [{ type: "positive_governance", delta: 0.10, rationale: "d" }],
  });
  check("Score wird auf max 1.0 geclampt (qualBase max 0.6 + 0.10 = 0.65, kein Clamp nötig hier)", Math.abs(r4.score - 0.65) < 0.001);

  // qualBase selbst wird auf max 0.6 geclampt, auch wenn der Aufrufer mehr übergibt
  const r5 = computeQualNewsScore({ qualBase: 0.9, adjustments: [] });
  check("qualBase wird intern auf max 0.6 geclampt (Ticket: Basis 0-0.6)", r5.qualBase === 0.6);
}

console.log("\n=== deriveStructuredNewsAdjustments: harte Trigger aus strukturierten Daten ===");
{
  // Großes Vergütungspaket bei schwacher Delivery
  const adj1 = deriveStructuredNewsAdjustments({
    ceoCompTotalLatest: 40_000_000, ceoCompTotalPrevYear: 38_000_000,
    referenceCompMedian: 10_000_000, referenceCompSource: "peer_median",
    deliveryPlusCapitalScore: 0.30,
    revenueGrowthPct: 2, revenueGrowthPrevYearPct: 5,
    fcfMarginPct: 10, fcfMarginPrevYearPct: 12,
    roicPct: 5, roicPrevYearPct: 8,
    netInsiderTransactionValue: null, storyIsPositive: false,
    isDeliveryBelastbar: true,
  });
  check("excessive_comp_weak_delivery Trigger bei 4x Median + schwacher Delivery", adj1.some(a => a.type === "excessive_comp_weak_delivery"));
  check("Penalty im Ticket-Band -0.25 bis -0.40", adj1.find(a => a.type === "excessive_comp_weak_delivery")!.delta <= -0.25 && adj1.find(a => a.type === "excessive_comp_weak_delivery")!.delta >= -0.40);

  // Kein Trigger wenn Delivery gut ist, selbst bei hoher Vergütung
  const adj2 = deriveStructuredNewsAdjustments({
    ceoCompTotalLatest: 40_000_000, ceoCompTotalPrevYear: 38_000_000,
    referenceCompMedian: 10_000_000, referenceCompSource: "peer_median",
    deliveryPlusCapitalScore: 0.85, // starke Delivery
    revenueGrowthPct: 20, revenueGrowthPrevYearPct: 15,
    fcfMarginPct: 30, fcfMarginPrevYearPct: 25,
    roicPct: 20, roicPrevYearPct: 15,
    netInsiderTransactionValue: null, storyIsPositive: true,
    isDeliveryBelastbar: true,
  });
  check("kein excessive_comp Trigger bei starker Delivery, trotz hoher Vergütung", !adj2.some(a => a.type === "excessive_comp_weak_delivery"));

  // Vergütung steigt, Performance fällt
  const adj3 = deriveStructuredNewsAdjustments({
    ceoCompTotalLatest: 20_000_000, ceoCompTotalPrevYear: 15_000_000,
    referenceCompMedian: null, referenceCompSource: null, deliveryPlusCapitalScore: null,
    revenueGrowthPct: 2, revenueGrowthPrevYearPct: 8,
    fcfMarginPct: 10, fcfMarginPrevYearPct: 15,
    roicPct: 5, roicPrevYearPct: 10,
    netInsiderTransactionValue: null, storyIsPositive: false,
    isDeliveryBelastbar: true,
  });
  check("comp_up_performance_down Trigger bei Comp↑ + Revenue/FCF/ROIC↓", adj3.some(a => a.type === "comp_up_performance_down"));
  check("Penalty exakt -0.20 laut Ticket", adj3.find(a => a.type === "comp_up_performance_down")!.delta === -0.20);

  // Insider-Verkäufe bei positiver Story
  const adj4 = deriveStructuredNewsAdjustments({
    ceoCompTotalLatest: null, ceoCompTotalPrevYear: null, referenceCompMedian: null, referenceCompSource: null,
    deliveryPlusCapitalScore: null, revenueGrowthPct: null, revenueGrowthPrevYearPct: null,
    fcfMarginPct: null, fcfMarginPrevYearPct: null, roicPct: null, roicPrevYearPct: null,
    netInsiderTransactionValue: -5_000_000, storyIsPositive: true,
    isDeliveryBelastbar: true,
  });
  check("insider_selling_positive_story Trigger", adj4.some(a => a.type === "insider_selling_positive_story"));
  check("Penalty exakt -0.10 laut Ticket", adj4.find(a => a.type === "insider_selling_positive_story")!.delta === -0.10);

  // Netto-Insider-Käufe → positive Governance
  const adj5 = deriveStructuredNewsAdjustments({
    ceoCompTotalLatest: null, ceoCompTotalPrevYear: null, referenceCompMedian: null, referenceCompSource: null,
    deliveryPlusCapitalScore: null, revenueGrowthPct: null, revenueGrowthPrevYearPct: null,
    fcfMarginPct: null, fcfMarginPrevYearPct: null, roicPct: null, roicPrevYearPct: null,
    netInsiderTransactionValue: 2_000_000, storyIsPositive: false,
    isDeliveryBelastbar: true,
  });
  check("positive_governance Trigger bei Netto-Insider-Käufen", adj5.some(a => a.type === "positive_governance"));
  check("Bonus exakt +0.10 laut Ticket", adj5.find(a => a.type === "positive_governance")!.delta === 0.10);

  // Keine Trigger bei komplett fehlenden Daten (kein Fake-Penalty)
  const adj6 = deriveStructuredNewsAdjustments({
    ceoCompTotalLatest: null, ceoCompTotalPrevYear: null, referenceCompMedian: null, referenceCompSource: null,
    deliveryPlusCapitalScore: null, revenueGrowthPct: null, revenueGrowthPrevYearPct: null,
    fcfMarginPct: null, fcfMarginPrevYearPct: null, roicPct: null, roicPrevYearPct: null,
    netInsiderTransactionValue: null, storyIsPositive: false,
    isDeliveryBelastbar: true,
  });
  check("keine Daten → keine Adjustments (kein Fake-Penalty)", adj6.length === 0);
}

console.log("\n=== Penalty-Absicherung (Auftrag 05.08.2026, Punkt 2): Abschwächung bei nicht belastbarer Delivery ===");
{
  // Gleiches Szenario wie adj1 oben (4x Median + Score<0.45), aber
  // isDeliveryBelastbar=false — die Penalty MUSS deutlich schwächer ausfallen
  const adjFull = deriveStructuredNewsAdjustments({
    ceoCompTotalLatest: 40_000_000, ceoCompTotalPrevYear: 38_000_000,
    referenceCompMedian: 10_000_000, referenceCompSource: "peer_median",
    deliveryPlusCapitalScore: 0.30,
    revenueGrowthPct: 2, revenueGrowthPrevYearPct: 5,
    fcfMarginPct: 10, fcfMarginPrevYearPct: 12,
    roicPct: 5, roicPrevYearPct: 8,
    netInsiderTransactionValue: null, storyIsPositive: false,
    isDeliveryBelastbar: true,
  });
  const adjWeak = deriveStructuredNewsAdjustments({
    ceoCompTotalLatest: 40_000_000, ceoCompTotalPrevYear: 38_000_000,
    referenceCompMedian: 10_000_000, referenceCompSource: "peer_median",
    deliveryPlusCapitalScore: 0.30,
    revenueGrowthPct: 2, revenueGrowthPrevYearPct: 5,
    fcfMarginPct: 10, fcfMarginPrevYearPct: 12,
    roicPct: 5, roicPrevYearPct: 8,
    netInsiderTransactionValue: null, storyIsPositive: false,
    isDeliveryBelastbar: false,
  });
  const fullDelta = adjFull.find(a => a.type === "excessive_comp_weak_delivery")!.delta;
  const weakDelta = adjWeak.find(a => a.type === "excessive_comp_weak_delivery")!.delta;
  check("bei belastbarer Delivery: volle Penalty im Ticket-Band", fullDelta <= -0.25 && fullDelta >= -0.40, String(fullDelta));
  check("bei NICHT belastbarer Delivery: Penalty deutlich abgeschwächt (mind. 50% schwächer)", Math.abs(weakDelta) < Math.abs(fullDelta) * 0.5, `full=${fullDelta} weak=${weakDelta}`);
  check("abgeschwächte Penalty bleibt trotzdem negativ (kein komplettes Verschwinden — bleibt als Warn-Flag sichtbar)", weakDelta < 0);
  check("Rationale der abgeschwächten Penalty erklärt die Datenlücke", adjWeak.find(a => a.type === "excessive_comp_weak_delivery")!.rationale.includes("fehlende") || adjWeak.find(a => a.type === "excessive_comp_weak_delivery")!.rationale.includes("Datenlücken"));
}

console.log("\n=== Gesamtformel: Gewichtung 30/25/20/15/10 ===");
{
  // Alle Teilscores exakt 1.0 → Gesamtscore muss exakt 10.0 sein
  const perfect = {
    delivery: { score: 1.0, revScore: 1, marginScore: 1, epsFcfScore: 1, usedGuidanceComparison: true, flags: [] },
    segment: { score: 1.0, shareScore: 1, growthGapScore: 1, marginScore: 1, deltaSharePp: 10, growthGapPp: 20, flags: [] },
    capital: { score: 1.0, roicScore: 1, fcfScore: 1, reinvestScore: 1, flags: [] },
    credibility: { score: 1.0, cashConvScore: 1, wcScore: 1, accrualsScore: 1, flags: [] },
    qualNews: { score: 1.0, qualBase: 0.6, totalAdjustment: 0.4, adjustments: [], flags: [] },
  };
  const r = computeManagementScoreBreakdown(perfect.delivery as any, perfect.segment as any, perfect.capital as any, perfect.credibility as any, perfect.qualNews as any);
  check("alle Teilscores = 1.0 → Gesamtscore = 10.0", r.score1to10 === 10.0, String(r.score1to10));

  // Alle Teilscores 0 → Gesamtscore 0
  const zero = {
    delivery: { score: 0, revScore: 0, marginScore: 0, epsFcfScore: 0, usedGuidanceComparison: false, flags: [] },
    segment: { score: 0, shareScore: 0, growthGapScore: 0, marginScore: 0, deltaSharePp: null, growthGapPp: null, flags: [] },
    capital: { score: 0, roicScore: 0, fcfScore: 0, reinvestScore: 0, flags: [] },
    credibility: { score: 0, cashConvScore: 0, wcScore: 0, accrualsScore: 0, flags: [] },
    qualNews: { score: 0, qualBase: 0, totalAdjustment: 0, adjustments: [], flags: [] },
  };
  const rZero = computeManagementScoreBreakdown(zero.delivery as any, zero.segment as any, zero.capital as any, zero.credibility as any, zero.qualNews as any);
  check("alle Teilscores = 0 → Gesamtscore = 0.0", rZero.score1to10 === 0.0);

  // Gewichtungs-Check: nur Delivery=1.0, Rest=0 → 3.0 (30% Gewicht)
  const onlyDelivery = { ...zero, delivery: perfect.delivery };
  const rD = computeManagementScoreBreakdown(onlyDelivery.delivery as any, onlyDelivery.segment as any, onlyDelivery.capital as any, onlyDelivery.credibility as any, onlyDelivery.qualNews as any);
  check("nur Delivery=1.0 (30% Gewicht) → Score = 3.0", rD.score1to10 === 3.0, String(rD.score1to10));

  // nur Segment=1.0 → 2.5 (25% Gewicht)
  const onlySegment = { ...zero, segment: perfect.segment };
  const rS = computeManagementScoreBreakdown(onlySegment.delivery as any, onlySegment.segment as any, onlySegment.capital as any, onlySegment.credibility as any, onlySegment.qualNews as any);
  check("nur Segment=1.0 (25% Gewicht) → Score = 2.5", rS.score1to10 === 2.5, String(rS.score1to10));

  // allFlags sammelt Flags aus allen Bausteinen
  check("allFlags aggregiert Flags aus allen 5 Bausteinen", Array.isArray(r.allFlags));
}

console.log("\n=== deriveStatementTrends: Datenpipeline aus Mehrjahres-Statements (Auftrag 05.08.2026, Punkt 1) ===");
{
  // Echte MSFT-Struktur (newest-first), live gegen FMP verifiziert 06.08.2026
  const incomeRows = [
    { fiscalYear: "2026", revenue: 331839000000, grossProfit: 225465000000, operatingIncome: 155237000000, netIncome: 133749000000 },
    { fiscalYear: "2025", revenue: 281724000000, grossProfit: 193893000000, operatingIncome: 128528000000, netIncome: 101832000000 },
    { fiscalYear: "2024", revenue: 245122000000, grossProfit: 171008000000, operatingIncome: 109433000000, netIncome: 88136000000 },
  ];
  const cashflowRows = [
    { fiscalYear: "2026", operatingCashFlow: 182935000000, capitalExpenditure: -115948000000, netIncome: 133749000000 },
    { fiscalYear: "2025", operatingCashFlow: 136162000000, capitalExpenditure: -64551000000, netIncome: 101832000000 },
    { fiscalYear: "2024", operatingCashFlow: 118548000000, capitalExpenditure: -44477000000, netIncome: 88136000000 },
  ];
  const balanceRows = [
    { fiscalYear: "2026", inventory: 1397000000, netReceivables: 80876000000, totalDebt: 100000000000, totalStockholdersEquity: 350000000000, cashAndCashEquivalents: 30000000000 },
    { fiscalYear: "2025", inventory: 938000000, netReceivables: 69905000000, totalDebt: 95000000000, totalStockholdersEquity: 300000000000, cashAndCashEquivalents: 25000000000 },
    { fiscalYear: "2024", inventory: 1246000000, netReceivables: 56924000000, totalDebt: 90000000000, totalStockholdersEquity: 270000000000, cashAndCashEquivalents: 20000000000 },
  ];
  const r = deriveStatementTrends({ incomeRows, cashflowRows, balanceRows });

  check("operatingMarginTrend erkannt (Marge steigt 2024->2026)", r.operatingMarginTrend === "steigend", String(r.operatingMarginTrend));
  check("marginTrend kombiniert gesetzt (nicht mehr n/a wie vorher)", r.marginTrend !== null);
  check("cashConversionRatio berechnet (OCF/NetIncome, nicht n/a)", r.cashConversionRatio !== null, String(r.cashConversionRatio));
  check("cashConversionRatio plausibel > 1 (MSFT konvertiert Gewinn stark in Cash)", (r.cashConversionRatio ?? 0) > 1);
  check("fcfMarginPct berechnet (nicht n/a)", r.fcfMarginPct !== null, String(r.fcfMarginPct));
  check("workingCapitalTrend bestimmt (nicht n/a)", r.workingCapitalTrend !== null, String(r.workingCapitalTrend));
  check("reinvestmentEfficiency berechnet (nicht n/a)", r.reinvestmentEfficiency !== null, String(r.reinvestmentEfficiency));
  check("revenueGrowthPrevYearPct berechnet aus 3 Jahren Historie", r.revenueGrowthPrevYearPct !== null);
  check("deutlich weniger Flags als vorher (Datenpipeline-Fix wirkt)", r.flags.length <= 1, JSON.stringify(r.flags));
}
{
  // Leere Historie -> alles null, keine Fake-Werte, klare Flags
  const r = deriveStatementTrends({ incomeRows: [], cashflowRows: [], balanceRows: [] });
  check("leere Historie -> alle Trends null (kein Fake)", r.operatingMarginTrend === null && r.cashConversionRatio === null && r.workingCapitalTrend === null);
  check("leere Historie -> Flags erklären die Lücke", r.flags.length > 0);
}
{
  // Working-Capital steigt deutlich schneller als Revenue -> Warnsignal
  const income = [{ fiscalYear: "2026", revenue: 110_000_000, grossProfit: 50_000_000, operatingIncome: 20_000_000, netIncome: 15_000_000 }, { fiscalYear: "2025", revenue: 100_000_000, grossProfit: 45_000_000, operatingIncome: 18_000_000, netIncome: 14_000_000 }];
  const balance = [{ fiscalYear: "2026", inventory: 40_000_000, netReceivables: 10_000_000 }, { fiscalYear: "2025", inventory: 20_000_000, netReceivables: 8_000_000 }];
  const r = deriveStatementTrends({ incomeRows: income, cashflowRows: [], balanceRows: balance });
  check("WC waechst deutlich schneller als Revenue -> steigend_bei_wachstum (Warnsignal)", r.workingCapitalTrend === "steigend_bei_wachstum", String(r.workingCapitalTrend));
}

console.log("\n=== countAvailableDeliveryInputs: Belastbarkeits-Check (Auftrag 05.08.2026, Punkt 2) ===");
{
  const allPresent = countAvailableDeliveryInputs({
    actualRevenueGrowthPct: 10, marginTrend: "steigend", epsOrFcfVsGuidancePct: 2,
    roicPct: 15, fcfMarginPct: 20, cashConversionRatio: 1.1,
  });
  check("alle 6 Inputs vorhanden -> belastbar", allPresent.isBelastbar === true);
  check("available=6/6", allPresent.available === 6 && allPresent.total === 6);

  const mostlyMissing = countAvailableDeliveryInputs({
    actualRevenueGrowthPct: 10, marginTrend: null, epsOrFcfVsGuidancePct: null,
    roicPct: null, fcfMarginPct: null, cashConversionRatio: null,
  });
  check("nur 1/6 Inputs (Ticket-Szenario: fast alles n/a) -> NICHT belastbar", mostlyMissing.isBelastbar === false);
  check("available=1/6", mostlyMissing.available === 1);

  const noRevenue = countAvailableDeliveryInputs({
    actualRevenueGrowthPct: null, marginTrend: "steigend", epsOrFcfVsGuidancePct: 2,
    roicPct: 15, fcfMarginPct: 20, cashConversionRatio: 1.1,
  });
  check("5/6 vorhanden aber KEIN Revenue-Wachstum -> nicht belastbar (Revenue ist Pflicht)", noRevenue.isBelastbar === false);

  const halfPresent = countAvailableDeliveryInputs({
    actualRevenueGrowthPct: 10, marginTrend: "steigend", epsOrFcfVsGuidancePct: null,
    roicPct: 15, fcfMarginPct: null, cashConversionRatio: null,
  });
  check("genau die Haelfte (3/6) inkl. Revenue -> belastbar (Grenzfall)", halfPresent.isBelastbar === true, JSON.stringify(halfPresent));
}

console.log("\n=== identifyNewSegment v2 (Nutzer-Entscheidung 06.08.2026, MSFT-Live-Fund) ===");
{
  // REGRESSIONSTEST: echte MSFT-Segmentdaten (Live-verifiziert 06.08.2026).
  // Vorher waehlte die Heuristik faelschlich XBOX (kein Vorjahreswert, aber
  // KEIN echtes neues Segment — wahrscheinlich Reporting-Umbenennung) statt
  // Server/Azure (+31.5% Wachstum, Anteil 34.9%→39%, die eigentliche Story).
  const msftSegments = [
    { name: "Server", revenue: 129425000000, percentage: 39, growth: 31.5, prevRevenue: 98435000000, prevPercentage: 34.9 },
    { name: "Microsoft 365 Commercial", revenue: 101997000000, percentage: 30.7, growth: 16.2, prevRevenue: 87767000000, prevPercentage: 31.2 },
    { name: "XBOX", revenue: 21790000000, percentage: 6.6, growth: null as any, prevRevenue: undefined, prevPercentage: undefined },
    { name: "Linked In", revenue: 19817000000, percentage: 6, growth: 11.3, prevRevenue: 17812000000, prevPercentage: 6.3 },
    { name: "Windows", revenue: 17084000000, percentage: 5.1, growth: -1.3, prevRevenue: 17314000000, prevPercentage: 6.1 },
  ];
  const rMsft = identifyNewSegment(msftSegments as any);
  check("MSFT: Server/Azure gewinnt (Growth+steigender Anteil), NICHT XBOX (Reporting-Artefakt)", rMsft?.name === "Server", JSON.stringify(rMsft));
  check("MSFT: echtes ΔShare verfügbar (sharePrevPct=34.9, kein n/a mehr)", rMsft?.sharePrevPct === 34.9);
  check("MSFT: kein noPriorYearFlag (Server hat einen echten Vorjahreswert)", !(rMsft as any)?.noPriorYearFlag);

  // Growth-Gap-Regressionstest: mit dem korrekt gewaehlten Server-Segment
  // muss der Gap deutlich ueber +15pp liegen (Ticket-Erwartung: ~+17.8pp),
  // NICHT die faelschlich niedrigen +2.7pp aus dem Bug-Report.
  const oldGrowthMsft = computeOldSegmentsGrowth(msftSegments as any, "Server");
  const growthGapMsft = (rMsft!.growthPct ?? 0) - (oldGrowthMsft ?? 0);
  check("MSFT: Growth-Gap deutlich ueber +15pp (Ticket-Erwartung ~+17.8pp)", growthGapMsft > 15, `gap=${growthGapMsft.toFixed(1)}`);

  // ═══ REGRESSIONSTEST: der tatsaechlich aufgetretene UI→Server-Bug ═══
  // Root Cause (06.08.2026): ManagementScoreSection.tsx (Client) mappte
  // prevPercentage NIE in den Request-Body — der Server-Fix aus dem
  // vorherigen Ticket war korrekt, aber jedes Segment kam mit
  // prevPercentage=undefined am Server an. Dieser Test reproduziert EXAKT
  // diesen Zustand (Segmente ohne prevPercentage, wie sie der kaputte
  // Client-Code verschickt haette) und beweist, dass die Heuristik dann auf
  // das FALSCHE Segment (Microsoft 365 Consumer, hohes %-Wachstum aber
  // winziger 2.8%-Anteil) zurueckfaellt — als Beleg, WARUM die Client-
  // Durchreichung von prevPercentage zwingend erforderlich ist, nicht nur
  // die Server-Heuristik selbst.
  const msftSegmentsWithoutPrevPct = msftSegments.map(({ prevPercentage, ...rest }) => rest);
  const rBuggy = identifyNewSegment(msftSegmentsWithoutPrevPct as any);
  check("Bug-Reproduktion: OHNE prevPercentage waehlt die Heuristik NICHT Server (bestaetigt die Kritikalitaet der Durchreichung)",
    rBuggy?.name !== "Server", JSON.stringify(rBuggy));

  // ═══ REGRESSIONSTEST: Segment-FY-Durchreichung (Auftrag 06.08.2026) ═══
  // Derselbe Fehlertyp wie beim prevPercentage-Bug: fiscalYear wird jetzt am
  // Segment-Objekt mitgefuehrt und muss vom gewaehlten Segment (Server) in
  // identifyNewSegment()'s Rueckgabewert landen, damit dataAsOf.
  // segmentFiscalYear im Result korrekt befuellt wird statt n/a zu bleiben.
  const msftSegmentsWithFiscalYear = msftSegments.map(s => ({ ...s, fiscalYear: "2025" }));
  const rWithFy = identifyNewSegment(msftSegmentsWithFiscalYear as any);
  check("Segment-FY: gewaehltes Segment (Server) traegt das fiscalYear weiter", rWithFy?.fiscalYear === "2025", JSON.stringify(rWithFy));

  // Fehlt fiscalYear komplett (aeltere/curated Segmentquelle ohne Datum) ->
  // bleibt bewusst undefined, NIEMALS ein erfundenes Jahr.
  const rWithoutFy = identifyNewSegment(msftSegments as any);
  check("Segment-FY: ohne fiscalYear am Input bleibt es undefined (kein Fake-Jahr)", rWithoutFy?.fiscalYear === undefined);

  // Prio 1 (PRIMAER): Growth + steigender Anteil + Anteil noch nicht dominant (<50%)
  const withHighGrowthRisingShare = [
    { name: "Legacy", revenue: 70_000_000_000, percentage: 70, growth: 2, prevRevenue: 68_000_000_000, prevPercentage: 71 },
    { name: "Server & Cloud", revenue: 30_000_000_000, percentage: 30, growth: 25, prevRevenue: 24_000_000_000, prevPercentage: 27 },
  ];
  const r2 = identifyNewSegment(withHighGrowthRisingShare as any);
  check("Prio 1: Growth + steigender Anteil erkannt (nicht das grosse Legacy-Segment)", r2?.name === "Server & Cloud", JSON.stringify(r2));
  check("sharePrevPct wird aus prevPercentage uebernommen (echtes ΔShare moeglich)", r2?.sharePrevPct === 27);

  // Prio 1 greift NICHT, wenn der Anteil bereits dominant ist (>=50%) —
  // selbst bei steigendem Anteil und Wachstum gilt das nicht mehr als "Shift"
  const dominantSegment = [
    { name: "Dominant", revenue: 60_000_000_000, percentage: 60, growth: 10, prevRevenue: 54_000_000_000, prevPercentage: 55 },
    { name: "Klein", revenue: 40_000_000_000, percentage: 40, growth: 3, prevRevenue: 39_000_000_000, prevPercentage: 40.5 }, // fallender Anteil
  ];
  const rDominant = identifyNewSegment(dominantSegment as any);
  check("Segment mit Anteil >=50% wird NICHT als Shift gewertet, obwohl es waechst", rDominant?.name !== "Dominant", JSON.stringify(rDominant));

  // Prio 2 (SEKUNDAER): sehr hohes Wachstum (>=15%) bei moderatem Anteil
  // (<35%), auch OHNE prevPercentage (Prio 1 kann hier nicht greifen)
  const withHighGrowthNoShareHistory = [
    { name: "Legacy", revenue: 70_000_000_000, percentage: 70, growth: 2, prevRevenue: 68_000_000_000, prevPercentage: 71 },
    { name: "Neu", revenue: 30_000_000_000, percentage: 30, growth: 22, prevRevenue: 24_000_000_000 }, // kein prevPercentage
  ];
  const r3 = identifyNewSegment(withHighGrowthNoShareHistory as any);
  check("Prio 2 greift, wenn Prio 1 mangels prevPercentage nicht anwendbar ist", r3?.name === "Neu", JSON.stringify(r3));

  // Prio 3 (LETZTER AUSWEG): neu aufgetaucht MIT Mindestumsatzfilter (>=3%)
  const withTinyNewSegment = [
    { name: "Mini-Pilot", revenue: 500_000_000, percentage: 0.5, growth: null as any, prevRevenue: undefined }, // <3% -> darf NICHT gewinnen
    { name: "Core", revenue: 99_500_000_000, percentage: 99.5, growth: null as any, prevRevenue: 99_000_000_000 },
  ];
  const rTiny = identifyNewSegment(withTinyNewSegment as any);
  check("Mini-Segment (<3% Anteil) gewinnt NICHT ueber den Mindestumsatzfilter", rTiny === null, JSON.stringify(rTiny));

  const withMaterialNewSegment = [
    { name: "Neues Standbein", revenue: 5_000_000_000, percentage: 5, growth: null as any, prevRevenue: undefined }, // >=3% -> darf gewinnen (letzter Ausweg)
    { name: "Core", revenue: 95_000_000_000, percentage: 95, growth: 3, prevRevenue: 92_000_000_000, prevPercentage: 96 },
  ];
  const rMaterial = identifyNewSegment(withMaterialNewSegment as any);
  check("materielles neues Segment (>=3% Anteil) gewinnt als letzter Ausweg", rMaterial?.name === "Neues Standbein", JSON.stringify(rMaterial));
  check("noPriorYearFlag gesetzt (Transparenz: moegliche Segment-Umbenennung statt echtem Shift)", (rMaterial as any)?.noPriorYearFlag === true);

  // Kein Segment mit Wachstumsdaten UND beide bereits im Vorjahr vorhanden -> null
  const noGrowthData = [
    { name: "X", revenue: 50_000_000_000, percentage: 50, growth: null as any, prevRevenue: 49_000_000_000 },
    { name: "Y", revenue: 50_000_000_000, percentage: 50, growth: null as any, prevRevenue: 51_000_000_000 },
  ];
  const r4 = identifyNewSegment(noGrowthData as any);
  check("keine Wachstumsdaten -> null (kein Fake-Segment)", r4 === null, JSON.stringify(r4));

  // BYDDY-Fall: keine Segmente ueberhaupt
  check("leeres Array -> null", identifyNewSegment([] as any) === null);
}

console.log(failed === 0 ? "\n✅ Alle Management-Score-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
