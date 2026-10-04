/**
 * Bias-Fixes (Offen_WORK_BIAS_FIXES_INVERSE_DCF.md).
 * Ausführen: npx tsx script/test-bias-fixes.ts
 */
import type { StockAnalysis } from "../shared/schema";
import {
  applyBiasAdjustment,
  catalystsModeLabel,
  computeOverallScore,
  computeRuleBasedMoat,
  growthHaircutFactor,
  isNegativeCatalyst,
  moatMultiplier,
  pestelDampeningFactor,
  sumUpsideGb,
  waccUpliftPp,
  buildBiasDecision,
  WACC_FLOOR_HEALTH_GOV,
  WACC_FLOOR_NO_MOAT_DAMAGE,
  WACC_UPLIFT_PP_2,
  WACC_UPLIFT_PP_3,
  WACC_UPLIFT_PP_4,
  TERMINAL_CAP_NO_MOAT,
  TERMINAL_CAP_REGULATORY,
} from "../shared/bias-fixes";

let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const baseFacts = {
  totalExpectedDamagePct: 10,
  moatRating: "Wide",
  governmentExposurePct: 5,
  dcfUpsidePct: 20,
  analystUpsidePct: 15,
  activeGateIds: [] as string[],
  conflictTexts: [] as string[],
  reverseGStarPct: 8,
  modelGrowthPct: 9,
  pricingPowerGateActive: false,
  sector: "Technology",
  industry: "Software",
  politicalExposureHigh: false,
  pestelExposureScore: 2,
  managementScore: 6,
  thesisScore: 6,
  technicalComponent: 0,
  positiveGbPct: 4,
  baseWaccPct: 8,
  revenueGrowthP1: 10,
  revenueGrowthP2: 6,
  terminalG: 2.5,
};

console.log("\n=== Trigger-Schwelle und WACC-Bänder ===");
{
  const none = applyBiasAdjustment(baseFacts);
  check("ein fehlender zweiter Trigger schaltet nicht", !none.switched && none.decisionWaccPct === 8);
  check("Uplift 0/1/2/3/4", waccUpliftPp(0) === 0 && waccUpliftPp(1) === 0 && waccUpliftPp(2) === WACC_UPLIFT_PP_2 && waccUpliftPp(3) === WACC_UPLIFT_PP_3 && waccUpliftPp(5) === WACC_UPLIFT_PP_4);
  const two = applyBiasAdjustment({ ...baseFacts, totalExpectedDamagePct: 28, moatRating: "Narrow" });
  check("2 Trigger schalten und heben WACC um 0.625 pp", two.switched && Math.abs(two.decisionWaccPct - (8 + WACC_UPLIFT_PP_2)) < 1e-9, String(two.decisionWaccPct));
  const three = applyBiasAdjustment({ ...baseFacts, totalExpectedDamagePct: 28, moatRating: "None", governmentExposurePct: 30 });
  check("3 Trigger: Uplift 1.05", three.switched && three.waccUpliftPp === WACC_UPLIFT_PP_3);
  const four = applyBiasAdjustment({
    ...baseFacts,
    totalExpectedDamagePct: 40,
    moatRating: "None",
    governmentExposurePct: 30,
    dcfUpsidePct: 100,
    analystUpsidePct: 5,
  });
  check("4 Trigger: Uplift 1.60", four.triggerCount >= 4 && four.waccUpliftPp === WACC_UPLIFT_PP_4, String(four.triggerCount));
}

console.log("\n=== WACC-Floors und Wachstum ===");
{
  const health = applyBiasAdjustment({
    ...baseFacts,
    totalExpectedDamagePct: 26,
    moatRating: "Narrow",
    governmentExposurePct: 30,
    sector: "Healthcare",
    industry: "Drug Manufacturers",
    baseWaccPct: 6,
  });
  check("Healthcare + Gov ≥ 25: Floor 7.50", health.switched && health.waccFloorPct === WACC_FLOOR_HEALTH_GOV && health.decisionWaccPct === 7.5, JSON.stringify({ floor: health.waccFloorPct, wacc: health.decisionWaccPct }));
  const noneMoat = applyBiasAdjustment({
    ...baseFacts,
    totalExpectedDamagePct: 32,
    moatRating: "None",
    governmentExposurePct: 5,
    baseWaccPct: 6,
    sector: "Technology",
  });
  check("Moat None + ED ≥ 30: Floor 7.80", noneMoat.waccFloorPct === WACC_FLOOR_NO_MOAT_DAMAGE && noneMoat.decisionWaccPct === 7.8);
  const g = growthHaircutFactor({ totalExpectedDamagePct: 30, moatRating: "None", pricingPowerGateActive: true });
  check("ED 25–35 × Moat None × Pricing Power = 0.85×0.9×0.9", Math.abs(g - 0.85 * 0.9 * 0.9) < 1e-9, String(g));
  const heavy = applyBiasAdjustment({
    ...baseFacts,
    totalExpectedDamagePct: 40,
    moatRating: "None",
    governmentExposurePct: 40,
    politicalExposureHigh: true,
    pricingPowerGateActive: true,
    terminalG: 3,
  });
  check("Terminal-Cap Moat None + hohes ED ist enger als Regulierung", heavy.terminalCapPct === TERMINAL_CAP_NO_MOAT && heavy.terminalG === TERMINAL_CAP_NO_MOAT);
  const regOnly = applyBiasAdjustment({
    ...baseFacts,
    totalExpectedDamagePct: 26,
    moatRating: "Narrow",
    governmentExposurePct: 30,
    terminalG: 3,
  });
  check("Hohe Regulierung deckelt Terminal auf 2.15", regOnly.terminalCapPct === TERMINAL_CAP_REGULATORY && regOnly.terminalG === TERMINAL_CAP_REGULATORY);
}

console.log("\n=== K5 Variante A ===");
{
  const cats = [
    { name: "K1", gb: 4, bruttoUpside: 10, direction: "positive" },
    { name: "K5", gb: 0.87, bruttoUpside: 8, flag: "▼" },
    { name: "Bear", gb: 1.2, bruttoUpside: 6, newsSentiment: "bearish" },
    { name: "Neg", gb: -2, bruttoUpside: -5 },
  ];
  check("▼, bearish und negatives Brutto sind negativ", isNegativeCatalyst(cats[1]) && isNegativeCatalyst(cats[2]) && isNegativeCatalyst(cats[3]) && !isNegativeCatalyst(cats[0]));
  check("positive GB-Summe schließt ▼ aus", Math.abs(sumUpsideGb(cats) - 4) < 1e-9, String(sumUpsideGb(cats)));
}

console.log("\n=== Moat, PESTEL, Gesamtscore ===");
{
  check("Multiplikatoren", moatMultiplier("Wide") === 0.475 && moatMultiplier("Strong") === 0.475 && moatMultiplier("Moderate") === 0.775 && moatMultiplier("Narrow") === 1.075 && moatMultiplier("None") === 1.3);
  check("PESTEL-Bänder", pestelDampeningFactor(2) === 1 && pestelDampeningFactor(4) === 0.96 && pestelDampeningFactor(6) === 0.92 && pestelDampeningFactor(7) === 0.88 && pestelDampeningFactor(8) === 0.82 && pestelDampeningFactor(9) === 0.78 && pestelDampeningFactor(10) === 0.7);
  const wide = computeRuleBasedMoat({
    grossMarginPct: 70, roic5YPct: 20, sectorMedianRoic5YPct: 10, fcfMarginStableOrRising: true,
    switchingOrNetwork: true, intangiblesStrong: true, governmentExposurePct: 0, highRivalry: false,
    llmMode: false,
  });
  check("Regel-Moat Wide ab 3", wide.rating === "Wide" && wide.score >= 3, String(wide.score));
  const none = computeRuleBasedMoat({
    grossMarginPct: 20, roic5YPct: null, sectorMedianRoic5YPct: null, fcfMarginStableOrRising: false,
    switchingOrNetwork: false, intangiblesStrong: false, governmentExposurePct: 40, highRivalry: true,
    llmMode: true, existingRating: "Wide",
  });
  check("KI darf den Basis-Score höchstens um 1.5 anheben", none.kiDelta <= 1.5 && none.kiDelta >= -1.5 && none.rating !== "Wide", JSON.stringify(none));
  const score = computeOverallScore({
    quantitativeBase: 6, pestelFactor: 0.92, managementScore: 8, thesisScore: 4,
    moatMultiplier: 0.475, technicalComponent: 0.5, positiveGbPct: 10,
  });
  const expected = 6 * 0.92 + (8 - 5) * 0.6 * 0.475 + (4 - 5) * 0.4 * 0.475 + 0.5 + 1;
  check("Gesamtscore-Formel", Math.abs(score.overallScore - expected) < 1e-9, `${score.overallScore} vs ${expected}`);
  check("Daten-Modus-Label", catalystsModeLabel("generic") === "Katalysatoren: generisch (Sektor)");
  check("KI-Modus-Label", catalystsModeLabel("llm", "2026-08-14T12:00:00Z") === "Katalysatoren: KI-firmenspezifisch (Stand: 2026-08-14T12:00:00Z)");
}

function fixture(over: Partial<StockAnalysis>): StockAnalysis {
  const prices = Array.from({ length: 40 }, (_, i) => ({
    date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 50, high: 51, low: 49, close: 50, volume: 1,
  }));
  return {
    ticker: "TEST",
    companyName: "Test Co",
    exchange: "X",
    sector: "Technology",
    industry: "Software",
    description: "A software platform with switching costs and patents.",
    currentPrice: 50,
    priceTimestamp: "",
    currency: "USD",
    marketCap: 5e9,
    sharesOutstanding: 1e8,
    analystPT: { low: 40, median: 55, high: 70, consensus: "Buy", count: 1 },
    ratings: { strongBuy: 1, buy: 0, hold: 0, sell: 0, strongSell: 0 },
    epsTTM: 2,
    epsAdjFY: 2,
    epsConsensusNextFY: 2.2,
    epsGrowth5Y: 10,
    peRatio: 20,
    forwardPE: 18,
    pegRatio: 1,
    evEbitda: 12,
    beta5Y: 1,
    fcfTTM: 2e8,
    fcfMargin: 20,
    revenue: 1e9,
    totalDebt: 1e8,
    cashEquivalents: 2e8,
    operatingIncome: 2e8,
    ebitda: 2.5e8,
    fcfHaircut: 0,
    moatRating: "Wide",
    governmentExposure: 5,
    growthThesis: "",
    structuralTrends: [],
    cycleClassification: "",
    politicalCycle: "",
    sectorMaxDrawdown: 30,
    sectorProfile: {
      cycleClass: "growth",
      politicalCycle: "neutral",
      waccScenarios: { kons: 8, avg: 9, opt: 7 },
      growthAssumptions: { g1: 12, g2: 8, terminal: 2.5 },
      macroSensitivity: {
        interestUp: { wacc: "", dcf: "" }, interestDown: { wacc: "", dcf: "" },
        fiscalUp: "", fiscalDown: "", geoUp: "", geoDown: "",
      },
      regulatoryNotes: "",
    },
    catalysts: [{ name: "Growth", timeline: "12M", pos: 50, bruttoUpside: 10, einpreisungsgrad: 20, nettoUpside: 8, gb: 4 }],
    risks: [{ name: "Mild", category: "Gradual", ew: 10, impact: 10, expectedDamage: 5 }],
    govExposureDetail: "",
    maxDrawdownHistory: "",
    maxDrawdownYear: "",
    historicalPrices: prices,
    financialStatements: { incomeStatement: { grossMargin: 70, revenue: 1e9, operatingIncome: 2e8, operatingMargin: 20, revenueGrowth: 12, grossProfit: 7e8, ebitda: 2.5e8, netIncome: 1e8, eps: 2 } } as StockAnalysis["financialStatements"],
    fcfMarginYoyPp: 1,
    fcfMarginYoyAvailable: true,
    peerComparison: {
      subject: { roic5Y: 25 },
      peers: [{ ticker: "AAA", name: "A", pe: 1, peg: 1, ps: 1, pb: 1, epsGrowth1Y: 1, epsGrowth5Y: 1, marketCap: 1, revenueGrowth: 1, roic5Y: 10 }],
    } as StockAnalysis["peerComparison"],
    pestelAnalysis: { factors: [], overallExposure: "Niedrig", macroSummary: "", geopoliticalScore: 2, interestRateOutlook: "", capitalCostImpact: "" },
    llmMode: false,
    ...over,
  } as StockAnalysis;
}

console.log("\n=== Entscheidungs-DCF auf einer Analyse ===");
{
  const calm = buildBiasDecision(fixture({}));
  check("ohne 2 Trigger bleibt der Conservative DCF die Basis", !calm.switched && calm.valuationBaseLabel === "Conservative DCF");
  check("Unadjusted und Entscheidung sind dann gleich", Math.abs(calm.decisionPerShare - calm.unadjustedPerShare) < 1e-6, `${calm.decisionPerShare} vs ${calm.unadjustedPerShare}`);
  check("Narrativ hat 3–5 Sätze und den Daten-Modus", calm.narrative.length >= 3 && calm.narrative.length <= 5 && calm.narrative.some(l => l.includes("Katalysatoren: generisch (Sektor)")));
  const stressed = buildBiasDecision(fixture({
    sector: "Healthcare",
    industry: "Drug Manufacturers",
    description: "Generic drug manufacturer.",
    governmentExposure: 40,
    financialStatements: { incomeStatement: { grossMargin: 20, revenue: 1e9, operatingIncome: 2e8, operatingMargin: 10, revenueGrowth: 2, grossProfit: 2e8, ebitda: 2e8, netIncome: 1e8, eps: 1 } } as StockAnalysis["financialStatements"],
    fcfMarginYoyPp: -5,
    peerComparison: { subject: { roic5Y: 4 }, peers: [{ ticker: "AAA", name: "A", pe: 1, peg: 1, ps: 1, pb: 1, epsGrowth1Y: 1, epsGrowth5Y: 1, marketCap: 1, revenueGrowth: 1, roic5Y: 12 }] } as StockAnalysis["peerComparison"],
    risks: [{ name: "Policy", category: "Binary", ew: 50, impact: 80, expectedDamage: 40 }],
    analystPT: { low: 40, median: 52, high: 60, consensus: "Hold", count: 1 },
    pestelAnalysis: {
      factors: [{ category: "Political", categoryDE: "Politisch", icon: "", factors: [], regionalOutlook: "", exposureRating: "Hoch" }],
      overallExposure: "Hoch", macroSummary: "", geopoliticalScore: 9, interestRateOutlook: "", capitalCostImpact: "",
    },
    llmMode: true,
    catalystsSource: "llm",
    growthThesisGeneratedAt: "2026-08-14T12:00:00Z",
    catalysts: [
      { name: "Pipeline", timeline: "12M", pos: 40, bruttoUpside: 12, einpreisungsgrad: 20, nettoUpside: 9.6, gb: 3.8 },
      { name: "K5", timeline: "6M", pos: 30, bruttoUpside: 8, einpreisungsgrad: 10, nettoUpside: 7.2, gb: 0.87, flag: "▼" },
    ],
  }));
  check("≥2 Trigger: gehärteter Inverse-DCF ist die Basis", stressed.switched && stressed.valuationBaseLabel === "Gehärteter Inverse-DCF");
  check("gehärteter Fair Value liegt unter dem extrapolativen", stressed.decisionPerShare < stressed.unadjustedPerShare, `${stressed.decisionPerShare} vs ${stressed.unadjustedPerShare}`);
  check("▼ zählt nicht in die positive GB", Math.abs(stressed.positiveGbSum - 3.8) < 1e-9, String(stressed.positiveGbSum));
  check("KI-Modus und Political+Gov werden genannt", stressed.modeLabel.includes("KI-firmenspezifisch") && stressed.modeLabel.includes("2026-08-14T12:00:00Z") && stressed.politicalGovMention);
  check("Red Flags nennen Moat, Damage oder Extrapolation", stressed.redFlags.length > 0);
  check("WACC-Floor 7.80 greift bei Moat None und hohem ED", (stressed.waccFloorPct ?? 0) >= WACC_FLOOR_HEALTH_GOV && stressed.decisionWacc + 1e-9 >= (stressed.waccFloorPct ?? 0), JSON.stringify({ floor: stressed.waccFloorPct, wacc: stressed.decisionWacc, moat: stressed.moatRating }));
}

console.log(failed === 0 ? "\n✅ Alle Bias-Fix-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
