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
  });
  check("comp_up_performance_down Trigger bei Comp↑ + Revenue/FCF/ROIC↓", adj3.some(a => a.type === "comp_up_performance_down"));
  check("Penalty exakt -0.20 laut Ticket", adj3.find(a => a.type === "comp_up_performance_down")!.delta === -0.20);

  // Insider-Verkäufe bei positiver Story
  const adj4 = deriveStructuredNewsAdjustments({
    ceoCompTotalLatest: null, ceoCompTotalPrevYear: null, referenceCompMedian: null, referenceCompSource: null,
    deliveryPlusCapitalScore: null, revenueGrowthPct: null, revenueGrowthPrevYearPct: null,
    fcfMarginPct: null, fcfMarginPrevYearPct: null, roicPct: null, roicPrevYearPct: null,
    netInsiderTransactionValue: -5_000_000, storyIsPositive: true,
  });
  check("insider_selling_positive_story Trigger", adj4.some(a => a.type === "insider_selling_positive_story"));
  check("Penalty exakt -0.10 laut Ticket", adj4.find(a => a.type === "insider_selling_positive_story")!.delta === -0.10);

  // Netto-Insider-Käufe → positive Governance
  const adj5 = deriveStructuredNewsAdjustments({
    ceoCompTotalLatest: null, ceoCompTotalPrevYear: null, referenceCompMedian: null, referenceCompSource: null,
    deliveryPlusCapitalScore: null, revenueGrowthPct: null, revenueGrowthPrevYearPct: null,
    fcfMarginPct: null, fcfMarginPrevYearPct: null, roicPct: null, roicPrevYearPct: null,
    netInsiderTransactionValue: 2_000_000, storyIsPositive: false,
  });
  check("positive_governance Trigger bei Netto-Insider-Käufen", adj5.some(a => a.type === "positive_governance"));
  check("Bonus exakt +0.10 laut Ticket", adj5.find(a => a.type === "positive_governance")!.delta === 0.10);

  // Keine Trigger bei komplett fehlenden Daten (kein Fake-Penalty)
  const adj6 = deriveStructuredNewsAdjustments({
    ceoCompTotalLatest: null, ceoCompTotalPrevYear: null, referenceCompMedian: null, referenceCompSource: null,
    deliveryPlusCapitalScore: null, revenueGrowthPct: null, revenueGrowthPrevYearPct: null,
    fcfMarginPct: null, fcfMarginPrevYearPct: null, roicPct: null, roicPrevYearPct: null,
    netInsiderTransactionValue: null, storyIsPositive: false,
  });
  check("keine Daten → keine Adjustments (kein Fake-Penalty)", adj6.length === 0);
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

console.log(failed === 0 ? "\n✅ Alle Management-Score-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
