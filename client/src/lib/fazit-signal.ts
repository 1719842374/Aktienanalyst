/**
 * Shared S17 Fazit / Ampel Signal-Score — single source for SummarySection + ExecSummaryCard.
 * Extracted 1:1 from SummarySection Fazit IIFE (positive/negative/neutral → rating).
 * Do NOT rename to buildSummaryFazit (spec-only name).
 */
import type { StockAnalysis } from "../../../shared/schema";
import {
  calculateFCFFDCF,
  buildDefaultDCFParams,
  type FCFFDCFResult,
  calculateCRV,
  calculateRiskAdjustedCRV,
  calculateRSL,
  calculateReverseDCF,
  type ReverseDCFResult,
  worstCaseM1,
  worstCaseM2,
  worstCaseM3,
  calculateCatalystUpside,
  selectCatalystBase,
  gbmMonteCarlo,
  calculateGBMParams,
  type GBMMonteCarloResult,
  computeDcfVsMarketDivergence,
} from "./calculations";
import { formatCurrency, formatNumber, formatPercentNoSign } from "./formatters";

export type FazitSignalMetrics = {
  conservativeDCF: FCFFDCFResult;
  totalUpside: number;
  crvConservative: number;
  dcfBeiCRV3: number;
  raCrvCons: number;
  rsl: number | null;
  reverseDCF: ReverseDCFResult;
  stressDownside: number;
  conservativeUpside: number;
  mcResult: GBMMonteCarloResult;
  totalExpDmg: number;
  worstCase: number;
};

export type FazitSignalInput = FazitSignalMetrics & {
  data: StockAnalysis;
};

export type FazitSignal = {
  positive: string[];
  negative: string[];
  neutral: string[];
  score: number;
  rating: string;
  ratingColor: string;
  ratingBg: string;
  fazitSatz: string;
  dcfDivergenceDowngraded: boolean;
  totalExpDmg: number;
  raCrvCons: number;
};

/** Prepare the same metrics SummarySection feeds into the Fazit Ampel. */
export function prepareFazitMetrics(
  data: StockAnalysis,
  sharedMonteCarlo?: GBMMonteCarloResult | null,
): FazitSignalMetrics {
  const netDebt = data.totalDebt - data.cashEquivalents;
  const sp = data.sectorProfile;
  const baseParams = buildDefaultDCFParams(data);
  const conservativeDCF = calculateFCFFDCF(baseParams);

  const stressDCF = calculateFCFFDCF({
    ...baseParams,
    revenueGrowthP1: Math.max(0, baseParams.revenueGrowthP1 * 0.3),
    revenueGrowthP2: Math.max(0, baseParams.revenueGrowthP2 * 0.3),
    ebitMargin: baseParams.ebitMargin * 0.7,
    ebitMarginTerminal: baseParams.ebitMarginTerminal * 0.75,
    erp: baseParams.erp + 2,
    terminalG: Math.max(1, baseParams.terminalG - 0.5),
  });

  const catalysts = data.catalysts;
  const rawTotalUpside = catalysts.reduce((sum, c) => sum + c.gb, 0);
  const catalystBaseInfo = selectCatalystBase(
    conservativeDCF.perShare,
    rawTotalUpside,
    data.currentPrice,
    data.analystPT.median,
  );
  const { totalUpside } = calculateCatalystUpside(catalysts, catalystBaseInfo.base);

  const m1 = worstCaseM1(data.currentPrice, data.beta5Y, data.sectorMaxDrawdown || 35);
  const m2Impact = data.risks?.length ? Math.max(...data.risks.map(r => Math.abs(r.impact))) : 35;
  const m2 = worstCaseM2(data.currentPrice, m2Impact);
  const m3 = worstCaseM3(data.currentPrice, data.sectorMaxDrawdown || 35, data.lynchClass);
  const worstCase = Math.min(m1, m2, m3);

  const sorted = [...data.historicalPrices].sort((a, b) => b.date.localeCompare(a.date));
  const prices26w = sorted.slice(0, 130).map((p) => p.close);
  const rsl = calculateRSL(data.currentPrice, prices26w);

  const reverseDCF = calculateReverseDCF({
    currentPrice: data.currentPrice,
    fcfBase: data.fcfTTM,
    wacc: conservativeDCF.wacc,
    sharesOutstanding: data.sharesOutstanding,
    netDebt,
    fcfHaircut: data.fcfHaircut ?? 0,
    sectorG1: sp.growthAssumptions?.g1 ?? 0,
    epsGrowthNext5Y: data.epsGrowth5Y ?? 0,
  });

  const crvConservative = calculateCRV(conservativeDCF.perShare, worstCase, data.currentPrice);
  const dcfBeiCRV3 = (conservativeDCF.perShare + 2 * worstCase) / 3;
  const conservativeUpside = ((conservativeDCF.perShare / data.currentPrice - 1) * 100);
  const stressDownside = ((stressDCF.perShare / data.currentPrice - 1) * 100);

  const totalExpDmg = (data.risks || []).reduce((s, r) => s + r.expectedDamage, 0);
  const raCrvCons = calculateRiskAdjustedCRV(
    conservativeDCF.perShare,
    worstCase,
    data.currentPrice,
    totalExpDmg,
  );

  let mcResult: GBMMonteCarloResult;
  if (sharedMonteCarlo) {
    mcResult = sharedMonteCarlo;
  } else {
    const prices = data.historicalPrices.map(p => p.close);
    const params = calculateGBMParams(prices);
    mcResult = gbmMonteCarlo({
      currentPrice: data.currentPrice,
      mu: params.mu,
      sigma: params.sigma,
      iterations: 10000,
      tradingDays: 252,
    }, data.analystPT.median);
  }

  return {
    conservativeDCF,
    totalUpside,
    crvConservative,
    dcfBeiCRV3,
    raCrvCons,
    rsl,
    reverseDCF,
    stressDownside,
    conservativeUpside,
    mcResult,
    totalExpDmg,
    worstCase,
  };
}

/** Build Ampel rating + factor lists — identical logic to S17 Fazit IIFE. */
export function buildFazitSignal(input: FazitSignalInput): FazitSignal {
  const {
    data,
    totalUpside,
    conservativeUpside,
    crvConservative,
    dcfBeiCRV3,
    raCrvCons,
    rsl,
    mcResult,
    reverseDCF,
    stressDownside,
    conservativeDCF,
    totalExpDmg,
  } = input;

  const catalysts = data.catalysts;
  const techStatus = data.technicalIndicators?.currentStatus;
  const risks = data.risks;
  const riskDiscountFactor = Math.max(0, 1 - totalExpDmg / 100);
  const pestel = data.pestelAnalysis;
  const moatAssess = data.moatAssessment;
  const macroCorr = data.macroCorrelations;

  const positive: string[] = [];
  const negative: string[] = [];
  const neutral: string[] = [];

  // S1: P/E vs sector
  if (data.peRatio > 0 && data.sectorAvgPE > 0) {
    const pePrem = ((data.peRatio / data.sectorAvgPE) - 1) * 100;
    if (pePrem < -20) positive.push(`P/E ${formatNumber(data.peRatio, 1)} vs. Sektor ${formatNumber(data.sectorAvgPE, 1)} \u2014 ${formatNumber(Math.abs(pePrem), 0)}% Discount`);
    else if (pePrem > 30) negative.push(`P/E ${formatNumber(data.peRatio, 1)} vs. Sektor ${formatNumber(data.sectorAvgPE, 1)} \u2014 ${formatNumber(pePrem, 0)}% Premium`);
  }

  // S2: Catalysts
  if (totalUpside > 10) positive.push(`Katalysatoren-Upside +${formatNumber(totalUpside, 1)}% (${catalysts.length} Treiber)`);
  else if (totalUpside < 3) neutral.push(`Begrenzte Katalysatoren (+${formatNumber(totalUpside, 1)}%)`);

  // S3: Cycle
  if (data.cycleClassification) {
    neutral.push(`Zyklusklassifikation: ${data.cycleClassification}, Politischer Zyklus: ${data.politicalCycle}`);
  }

  // S4: PEG
  if (data.pegRatio > 0 && data.pegRatio < 1) positive.push(`PEG ${formatNumber(data.pegRatio, 2)} < 1 \u2014 unterbewertet relativ zum Wachstum`);
  else if (data.pegRatio > 2) negative.push(`PEG ${formatNumber(data.pegRatio, 2)} > 2 \u2014 hohes Bewertungsniveau`);

  // S5: DCF
  if (conservativeUpside > 30) positive.push(`Kons. DCF deutet auf ${formatNumber(conservativeUpside, 0)}% Upside`);
  else if (conservativeUpside > 10) positive.push(`Kons. DCF mit ${formatNumber(conservativeUpside, 0)}% moderatem Upside`);
  else if (conservativeUpside < -10) negative.push(`Kons. DCF zeigt ${formatNumber(conservativeUpside, 0)}% Downside \u2014 \u00dcberbewertung`);
  else neutral.push(`DCF nahe am Kurs (${formatNumber(conservativeUpside, 0)}%)`);

  // S6: CRV
  if (crvConservative >= 2.5) positive.push(`CRV Base ${formatNumber(crvConservative, 1)}:1 \u2014 attraktiv`);
  else if (crvConservative >= 2.0) neutral.push(`CRV Base ${formatNumber(crvConservative, 1)}:1 \u2014 akzeptabel`);
  else negative.push(`CRV Base nur ${formatNumber(crvConservative, 1)}:1 \u2014 unzureichend`);

  if (raCrvCons < 1.5) negative.push(`CRV Risikoadj. nur ${formatNumber(raCrvCons, 1)}:1 \u2014 Risiken nicht eingepreist`);
  else if (raCrvCons >= 2.5) positive.push(`CRV Risikoadj. ${formatNumber(raCrvCons, 1)}:1 \u2014 auch nach Risikoabschlag attraktiv`);

  if (data.currentPrice <= dcfBeiCRV3) positive.push(`Kurs UNTER Max-Entry (${formatCurrency(dcfBeiCRV3)})`);
  else negative.push(`Kurs (${formatCurrency(data.currentPrice)}) \u00dcBER Max-Entry (${formatCurrency(dcfBeiCRV3)}) bei CRV 3:1`);

  // S8: Risk
  if (totalExpDmg > 15) negative.push(`Expected Damage ${formatNumber(totalExpDmg, 1)}% \u2014 erhebliche Risiko-Exposition`);
  else if (totalExpDmg < 8) positive.push(`Expected Damage nur ${formatNumber(totalExpDmg, 1)}% \u2014 moderates Risikoprofil`);

  // S9: RSL (null = keine ausreichende Kurshistorie \u2192 neutral, kein Score-Beitrag)
  if (rsl == null) neutral.push(`RSL n/a \u2014 keine ausreichende Kurshistorie`);
  else if (rsl > 110) positive.push(`RSL ${formatNumber(rsl, 0)} \u2014 starkes Momentum`);
  else if (rsl >= 105) neutral.push(`RSL ${formatNumber(rsl, 0)} \u2014 neutrales Momentum`);
  else negative.push(`RSL ${formatNumber(rsl, 0)} \u2014 schwaches Momentum, Growth-Adj. -5% bis -10%`);

  // S10: Technical
  if (techStatus) {
    const techBull: string[] = [];
    const techBear: string[] = [];
    if (techStatus.priceAboveMA200) techBull.push('Kurs > MA200');
    else techBear.push('Kurs < MA200');
    if (techStatus.ma50AboveMA200) techBull.push('MA50 > MA200 (Golden Cross)');
    else techBear.push('MA50 < MA200 (Death Cross)');
    if (techStatus.macdAboveZero && techStatus.macdRising) techBull.push('MACD > 0 & steigend');
    else if (!techStatus.macdAboveZero) techBear.push('MACD < 0');

    if (techStatus.buySignal) {
      positive.push(`Technisch: BUY-Signal (${techBull.join(', ')})`);
    } else if (techBear.length >= 2) {
      negative.push(`Technisch: KEIN Buy-Signal (${techBear.join(', ')})`);
    } else {
      neutral.push(`Technisch gemischt: ${[...techBull, ...techBear].join(', ')}`);
    }
  }

  // S11: Moat
  if (moatAssess) {
    if (moatAssess.overallRating === 'Wide') positive.push(`Breiter Moat \u2014 nachhaltiger Wettbewerbsvorteil`);
    else if (moatAssess.overallRating === 'None') negative.push(`Kein erkennbarer Moat \u2014 Wettbewerbsdruck`);
    else neutral.push(`Schmaler Moat \u2014 ${moatAssess.moatSources.slice(0, 2).join(', ')}`);
  }

  // S12: Monte Carlo
  if (mcResult.downsideProb > 0.55) negative.push(`MC-Simulation: ${formatNumber(mcResult.downsideProb * 100, 0)}% Verlustwahrscheinlichkeit (1Y)`);
  else if (mcResult.downsideProb < 0.35) positive.push(`MC-Simulation: nur ${formatNumber(mcResult.downsideProb * 100, 0)}% Verlustwahrscheinlichkeit`);

  // S14: Reverse DCF — relative Schwellen (identisch mit Section10)
  const rdRef = reverseDCF.referenceGrowth;
  if (reverseDCF.rating === "unrealistic") {
    negative.push(`Reverse-DCF g* ${formatPercentNoSign(reverseDCF.impliedGrowth)} \u2014 \u00fcber 1,5\u00d7 Referenz (${formatPercentNoSign(rdRef * 1.5)}), hohes Wachstum eingepreist`);
  } else if (reverseDCF.rating === "sportlich") {
    neutral.push(`Reverse-DCF g* ${formatPercentNoSign(reverseDCF.impliedGrowth)} \u2014 sportlich (Ref: ${formatPercentNoSign(rdRef)})`);
  } else if (reverseDCF.rating === "negativ") {
    negative.push(`Reverse-DCF g* negativ (${formatPercentNoSign(reverseDCF.impliedGrowth)}) \u2014 FCF-negativ oder EV-Anomalie`);
  } else {
    positive.push(`Reverse-DCF g* ${formatPercentNoSign(reverseDCF.impliedGrowth)} \u2014 realistisch eingepreist (Ref: ${formatPercentNoSign(rdRef)})`);
  }

  // Beta / Risk
  if (data.beta5Y > 1.5) negative.push(`Hohe Volatilit\u00e4t (Beta ${formatNumber(data.beta5Y, 2)}) \u2014 \u00fcberdurchschnittliches Risiko`);
  else if (data.beta5Y < 0.8) positive.push(`Niedrige Volatilit\u00e4t (Beta ${formatNumber(data.beta5Y, 2)}) \u2014 defensiv`);

  // FCF Margin
  if (data.fcfMargin > 20) positive.push(`Starke FCF-Marge von ${formatNumber(data.fcfMargin, 1)}%`);
  else if (data.fcfMargin < 5) negative.push(`Schwache FCF-Marge (${formatNumber(data.fcfMargin, 1)}%)`);

  // PESTEL
  if (pestel) {
    if (pestel.overallExposure === 'Hoch') negative.push(`PESTEL: Hohe Makro-Exposition (Geopolitical Score ${pestel.geopoliticalScore}/10)`);
    else if (pestel.overallExposure === 'Niedrig') positive.push(`PESTEL: Niedrige Makro-Exposition`);
  }

  // Macro Correlations
  if (macroCorr) {
    if (macroCorr.overallMacroSensitivity === 'Hoch') negative.push(`Hohe Makro-Sensitivit\u00e4t \u2014 ${macroCorr.keyInsight.substring(0, 80)}`);
    else if (macroCorr.overallMacroSensitivity === 'Niedrig') positive.push(`Niedrige Makro-Sensitivit\u00e4t \u2014 resilient gegen\u00fcber Konjunkturschwankungen`);
  }

  // Gov Exposure
  if (data.governmentExposure > 20) negative.push(`Staatsabh\u00e4ngigkeit ${formatNumber(data.governmentExposure, 0)}% \u2014 FCF-Haircut`);

  // Macro Stress
  if (stressDownside < -30) negative.push(`Macro-Stress: ${formatNumber(stressDownside, 0)}% Downside`);

  // Analyst PT
  const ptUps = ((data.analystPT.median - data.currentPrice) / data.currentPrice) * 100;
  if (ptUps > 20) positive.push(`Analysten sehen ${formatNumber(ptUps, 0)}% Upside zum Median-Kursziel`);
  else if (ptUps > 0) neutral.push(`Analysten-Kursziel +${formatNumber(ptUps, 0)}% \u00fcber Kurs`);
  else if (ptUps < -5) negative.push(`Analysten-Kursziel ${formatNumber(ptUps, 0)}% unter Kurs`);

  // === Overall rating ===
  const score = positive.length - negative.length;
  let rating: string;
  let ratingColor: string;
  let ratingBg: string;
  if (score >= 4) {
    rating = "ATTRAKTIV"; ratingColor = "text-emerald-400"; ratingBg = "bg-emerald-500/10 border-emerald-500/30";
  } else if (score >= 2) {
    rating = "LEICHT ATTRAKTIV"; ratingColor = "text-emerald-400"; ratingBg = "bg-emerald-500/10 border-emerald-500/20";
  } else if (score >= -1) {
    rating = "NEUTRAL"; ratingColor = "text-amber-400"; ratingBg = "bg-amber-500/10 border-amber-500/20";
  } else if (score >= -3) {
    rating = "UNATTRAKTIV"; ratingColor = "text-red-400"; ratingBg = "bg-red-500/10 border-red-500/20";
  } else {
    rating = "STARK UNATTRAKTIV"; ratingColor = "text-red-500"; ratingBg = "bg-red-500/10 border-red-500/30";
  }

  // CRV-Haerte-Guard (Auftrag 09.08.2026, "NVO-Muster"): ein ATTRAKTIV/
  // LEICHT ATTRAKTIV-Rating darf nicht allein auf einem unbereinigten
  // Base-DCF beruhen, wenn DCF-Upside > 80% aber Analyst-Upside < 15%
  // (Low-WACC/High-TV-Extrapolation, generisch, kein Ticker-Hardcode).
  // Downgrade um genau eine Stufe, niemals unter NEUTRAL erzwungen --
  // das ist ein Vorsicht-Signal, keine automatische Abwertung auf
  // UNATTRAKTIV, da andere Faktoren (Moat, Technik) weiterhin zaehlen.
  const dcfMarketDivergence = computeDcfVsMarketDivergence(conservativeDCF.perShare, data.analystPT.median, data.currentPrice);
  let dcfDivergenceDowngraded = false;
  if (dcfMarketDivergence.divergenceFlag) {
    if (rating === "ATTRAKTIV") { rating = "LEICHT ATTRAKTIV"; dcfDivergenceDowngraded = true; }
    else if (rating === "LEICHT ATTRAKTIV") { rating = "NEUTRAL"; dcfDivergenceDowngraded = true; }
    if (dcfDivergenceDowngraded) { ratingColor = "text-amber-400"; ratingBg = "bg-amber-500/10 border-amber-500/20"; }
  }

  const isBuy = score >= 2 && techStatus?.buySignal && data.currentPrice <= dcfBeiCRV3;
  const isOvervalued = conservativeUpside < -5 || (raCrvCons < 1.5 && rsl != null && rsl < 100);
  const isTechWeak = !techStatus?.priceAboveMA200 || !techStatus?.ma50AboveMA200;
  const isHighRisk = totalExpDmg > 15 || data.beta5Y > 1.5;
  const topRisks = [...risks].sort((a, b) => b.expectedDamage - a.expectedDamage).slice(0, 2).map(r => r.name).join(' und ');

  let fazitSatz = '';
  if (isBuy) {
    fazitSatz = `${data.companyName} (${data.ticker}) erscheint auf Basis der Gesamtanalyse attraktiv bewertet. Fundamental unterst\u00fctzt durch ${data.moatRating}-Moat, ein CRV von ${formatNumber(crvConservative, 1)}:1 und technisches Buy-Signal (Kurs > MA200, MA50 > MA200, MACD > 0). Der Einstieg ist bei aktuellem Kurs vertretbar.`;
  } else if (isOvervalued) {
    fazitSatz = `${data.companyName} (${data.ticker}) ist auf aktuellem Kursniveau ${rating === 'STARK UNATTRAKTIV' ? 'deutlich ' : ''}\u00fcberbewertet. Das risikoadjustierte CRV von nur ${formatNumber(raCrvCons, 1)}:1 zeigt, dass die Risiken (${topRisks}) nicht ausreichend eingepreist sind.${isTechWeak ? ' Technisch liegt der Kurs unter den gleitenden Durchschnitten \u2014 kein Kaufsignal.' : ''} Abwarten bis ${formatCurrency(dcfBeiCRV3)} oder tiefer.`;
  } else if (score <= -2) {
    fazitSatz = `${data.companyName} (${data.ticker}) bietet aktuell ein ung\u00fcnstiges Chance-Risiko-Verh\u00e4ltnis. Die Hauptrisiken (${topRisks}) dr\u00fccken den risikoadjustierten Fair Value auf ${formatCurrency(conservativeDCF.perShare * riskDiscountFactor)}. ${isTechWeak ? 'Technisch fehlt ein Buy-Signal.' : ''} Kurs liegt ${formatNumber(Math.abs(((data.currentPrice / dcfBeiCRV3) - 1) * 100), 0)}% \u00fcber dem Max-Einstiegskurs.`;
  } else if (score >= 2) {
    fazitSatz = `${data.companyName} (${data.ticker}) zeigt fundamental solide Kennzahlen mit ${formatNumber(conservativeUpside, 0)}% DCF-Upside und CRV ${formatNumber(crvConservative, 1)}:1. ${!techStatus?.buySignal ? 'Allerdings fehlt ein technisches Buy-Signal \u2014 Timing abwarten.' : 'Technisch ebenfalls positiv.'} ${isHighRisk ? `Erh\u00f6hte Risiken (${topRisks}) beachten.` : ''}`;
  } else {
    fazitSatz = `${data.companyName} (${data.ticker}) befindet sich in einer neutralen Zone. Das Base-CRV von ${formatNumber(crvConservative, 1)}:1 wirkt zwar ${crvConservative >= 2.0 ? 'akzeptabel' : 'schwach'}, wird aber durch ${formatNumber(totalExpDmg, 1)}% Expected Damage auf risikoadjustiert ${formatNumber(raCrvCons, 1)}:1 reduziert. ${isTechWeak ? 'Technisch kein Kaufsignal.' : 'Technisch gemischte Signale.'} ${topRisks ? `Hauptrisiken: ${topRisks}.` : ''} Empfehlung: Abwarten.`;
  }
  // CRV-Haerte-Guard: Divergenz-Hinweis additiv anhaengen, damit der
  // Rating-Downgrade auch textuell nachvollziehbar ist.
  if (dcfMarketDivergence.divergenceFlag) {
    fazitSatz += ` \u26a0 DCF-Upside (${formatNumber(dcfMarketDivergence.dcfUpsidePct, 0)}%) weicht stark vom Analysten-Konsens (${formatNumber(dcfMarketDivergence.analystUpsidePct, 0)}%) ab \u2014 der Base-DCF k\u00f6nnte durch niedrigen WACC/hohen Terminal-Value-Anteil optimistisch extrapoliert sein (siehe geh\u00e4rtetes CRV in Sektion 6).`;
  }
  // Datenaktualität additiv im Fazit referenzierbar; ohne bestätigten
  // Termin bleibt der Satz bewusst aus, statt einen Termin zu erfinden.
  if (data.nextEarningsDate) {
    const earningsLabel = new Date(`${data.nextEarningsDate}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
    fazitSatz += ` Nächster Earnings Call: ${earningsLabel}${data.nextEarningsTime ? ` (${data.nextEarningsTime.toUpperCase()})` : ''}.`;
  }

  return {
    positive,
    negative,
    neutral,
    score,
    rating,
    ratingColor,
    ratingBg,
    fazitSatz,
    dcfDivergenceDowngraded,
    totalExpDmg,
    raCrvCons,
  };
}
