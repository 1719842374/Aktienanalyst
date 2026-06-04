import type { Catalyst, Risk } from "../../../shared/schema";

// === DCF Model (FCF-Growth based — legacy, still used by sensitivity matrix) ===
export interface DCFParams {
  fcfBase: number;
  haircut: number;
  wacc: number;
  g1: number;
  g2: number;
  terminalG: number;
  sharesOutstanding: number;
  netDebt: number;
}

export interface DCFResult {
  intrinsicValue: number;
  perShare: number;
  steps: string[];
}

export function calculateDCF(params: DCFParams): DCFResult {
  const { fcfBase, haircut, wacc, g1, g2, terminalG, sharesOutstanding, netDebt } = params;
  const steps: string[] = [];

  const adjustedFCF = fcfBase * (1 - haircut / 100);
  steps.push(`Adjusted FCF = ${fmt(fcfBase)} × (1 - ${haircut}%) = ${fmt(adjustedFCF)}`);

  let pvSum = 0;
  let currentFCF = adjustedFCF;

  // Phase 1: years 1-5
  steps.push(`Phase 1 (Years 1-5): Growth rate = ${g1}%`);
  for (let i = 1; i <= 5; i++) {
    currentFCF = currentFCF * (1 + g1 / 100);
    const pv = currentFCF / Math.pow(1 + wacc / 100, i);
    pvSum += pv;
    steps.push(`  Year ${i}: FCF = ${fmt(currentFCF)}, PV = ${fmt(pv)}`);
  }

  // Phase 2: years 6-10
  steps.push(`Phase 2 (Years 6-10): Growth rate = ${g2}%`);
  for (let i = 6; i <= 10; i++) {
    currentFCF = currentFCF * (1 + g2 / 100);
    const pv = currentFCF / Math.pow(1 + wacc / 100, i);
    pvSum += pv;
    steps.push(`  Year ${i}: FCF = ${fmt(currentFCF)}, PV = ${fmt(pv)}`);
  }

  // Terminal value
  const terminalFCF = currentFCF * (1 + terminalG / 100);
  const terminalValue = terminalFCF / (wacc / 100 - terminalG / 100);
  const pvTerminal = terminalValue / Math.pow(1 + wacc / 100, 10);
  pvSum += pvTerminal;
  steps.push(`Terminal Value: FCF₁₁ = ${fmt(terminalFCF)}`);
  steps.push(`  TV = ${fmt(terminalFCF)} / (${wacc}% - ${terminalG}%) = ${fmt(terminalValue)}`);
  steps.push(`  PV(TV) = ${fmt(pvTerminal)}`);

  const equityValue = pvSum - netDebt;
  const perShare = sharesOutstanding > 0 ? equityValue / sharesOutstanding : 0;
  steps.push(`Enterprise Value (PV sum) = ${fmt(pvSum)}`);
  steps.push(`- Net Debt = ${fmt(netDebt)}`);
  steps.push(`Equity Value = ${fmt(equityValue)}`);
  if (sharesOutstanding > 0) {
    steps.push(`Per Share = ${fmt(equityValue)} / ${fmtShares(sharesOutstanding)} = $${perShare.toFixed(2)}`);
  } else {
    steps.push(`⚠ Shares Outstanding = 0 — Per Share kann nicht berechnet werden`);
  }

  return { intrinsicValue: equityValue, perShare, steps };
}

// === FCFF-based DCF Model (full fundamental) ===
// FCFF = EBIT × (1 - Tax) + D&A - Capex - ΔWC
// Simplified: FCFF = Revenue × EBIT-Margin × (1 - Tax) - Capex + Revenue × ΔWC-adj
export interface FCFFDCFParams {
  revenueBase: number;       // Last 12M revenue
  revenueGrowthP1: number;   // Revenue growth % phase 1 (Y1-5)
  revenueGrowthP2: number;   // Revenue growth % phase 2 (Y6-10)
  ebitMargin: number;        // EBIT margin %
  ebitMarginTerminal: number;// Terminal EBIT margin %
  capexPct: number;          // Capex as % of revenue
  deltaWCPct: number;        // ΔNet Working Capital as % of revenue growth
  taxRate: number;           // Effective tax rate %
  daRatio: number;           // D&A as % of revenue (added back)
  // WACC components
  riskFreeRate: number;      // Rf %
  beta: number;              // Beta
  erp: number;               // Equity Risk Premium %
  debtRatio: number;         // D/V %
  costOfDebt: number;        // Rd %
  // Terminal
  terminalG: number;         // Terminal growth rate %
  // Equity bridge
  sharesOutstanding: number;
  netDebt: number;
  minorityInterests: number;
  // Optional haircut
  fcfHaircut: number;        // FCF haircut % for gov exposure
  // Optional WACC override — bypasses CAPM when set
  waccOverride?: number | null;  // Direct WACC % (null/undefined = compute via CAPM)
  // Optional: actual EPS for sanity-cap (prevents FS-debt distortion)
  actualEPS?: number;        // EPS TTM for per-share ceiling check
  forwardEPS?: number;       // Forward EPS consensus for cap calculation
}

export interface FCFFDCFResult {
  enterpriseValue: number;
  equityValue: number;
  perShare: number;
  wacc: number;
  costOfEquity: number;
  yearlyProjections: {
    year: number;
    revenue: number;
    ebit: number;
    nopat: number;
    da: number;
    capex: number;
    deltaWC: number;
    fcff: number;
    pvFCFF: number;
  }[];
  pvExplicit: number;
  terminalValue: number;
  pvTerminal: number;
  steps: string[];
}

export function calculateFCFFDCF(params: FCFFDCFParams): FCFFDCFResult {
  const steps: string[] = [];

  // 1. Compute WACC via CAPM, or use manual override
  const rawRe = params.riskFreeRate + params.beta * params.erp;
  const Rd = params.costOfDebt;
  const cappedDebtRatio = Math.min(params.debtRatio, 60);
  const dv = cappedDebtRatio / 100;
  const ev = 1 - dv;
  const rawWacc = ev * rawRe + dv * Rd * (1 - params.taxRate / 100);

  const useOverride = params.waccOverride != null && params.waccOverride > 0;
  let wacc: number;
  let waccWasCapped = false;

  if (useOverride) {
    wacc = params.waccOverride!;
  } else {
    const WACC_FLOOR = 5.0;
    const WACC_CEIL = 20.0;
    wacc = Math.max(WACC_FLOOR, Math.min(WACC_CEIL, rawWacc));
    waccWasCapped = Math.abs(wacc - rawWacc) > 0.01;
  }

  steps.push(`=== WACC-Berechnung ===`);
  if (useOverride) {
    steps.push(`⚙ Manueller WACC-Override aktiv: ${wacc.toFixed(2)}%`);
    steps.push(`  (CAPM-Berechnung: Re = ${rawRe.toFixed(2)}%, WACC = ${rawWacc.toFixed(2)}% — ignoriert)`);
  } else {
    steps.push(`Re (CAPM) = Rf + β × ERP = ${params.riskFreeRate}% + ${params.beta} × ${params.erp}% = ${rawRe.toFixed(2)}%`);
    steps.push(`WACC (raw) = E/V × Re + D/V × Rd × (1-t) = ${(ev * 100).toFixed(0)}% × ${rawRe.toFixed(2)}% + ${(dv * 100).toFixed(0)}% × ${Rd}% × (1 - ${params.taxRate}%)`);
    steps.push(`WACC (raw) = ${rawWacc.toFixed(2)}%`);
    if (waccWasCapped) {
      steps.push(`⚠ WACC-Sanity-Cap: ${rawWacc.toFixed(2)}% → ${wacc.toFixed(2)}% (Bounds: 3%-20%)`);
      steps.push(`  Grund: CAPM liefert Wert außerhalb des plausiblen Bereichs.`);
    }
  }
  steps.push(`WACC (final) = ${wacc.toFixed(2)}%`);

  steps.push(``);
  steps.push(`=== FCFF-Projektion (10 Jahre) ===`);
  steps.push(`Revenue Basis: ${fmt(params.revenueBase)}`);

  const yearlyProjections: FCFFDCFResult["yearlyProjections"] = [];
  let pvExplicit = 0;
  let prevRevenue = params.revenueBase;

  for (let y = 1; y <= 10; y++) {
    const growthRate = y <= 5 ? params.revenueGrowthP1 : params.revenueGrowthP2;
    const revenue = prevRevenue * (1 + growthRate / 100);

    const marginProgress = y / 10;
    const ebitMargin = params.ebitMargin + (params.ebitMarginTerminal - params.ebitMargin) * marginProgress;

    const ebit = revenue * (ebitMargin / 100);
    const nopat = ebit * (1 - params.taxRate / 100);
    const da = revenue * (params.daRatio / 100);
    const capex = revenue * (params.capexPct / 100);
    const revenueGrowthAbs = revenue - prevRevenue;
    const deltaWC = revenueGrowthAbs * (params.deltaWCPct / 100);

    let fcff = nopat + da - capex - deltaWC;

    if (params.fcfHaircut > 0) {
      fcff = fcff * (1 - params.fcfHaircut / 100);
    }

    const pvFCFF = fcff / Math.pow(1 + wacc / 100, y);
    pvExplicit += pvFCFF;

    yearlyProjections.push({ year: y, revenue, ebit, nopat, da, capex, deltaWC, fcff, pvFCFF });

    if (y <= 5 || y === 10) {
      steps.push(`  Y${y}: Rev ${fmt(revenue)} (g=${growthRate}%), EBIT-M ${ebitMargin.toFixed(1)}%, FCFF ${fmt(fcff)}, PV ${fmt(pvFCFF)}`);
    } else if (y === 6) {
      steps.push(`  Y6-9: Phase 2 Growth = ${params.revenueGrowthP2}%`);
    }

    prevRevenue = revenue;
  }

  const lastFCFF = yearlyProjections[9].fcff;
  const terminalFCFF = lastFCFF * (1 + params.terminalG / 100);

  const waccDecimal = wacc / 100;
  const gDecimal = params.terminalG / 100;
  let terminalValue = 0;
  if (waccDecimal > gDecimal && terminalFCFF > 0) {
    terminalValue = terminalFCFF / (waccDecimal - gDecimal);
  } else if (terminalFCFF > 0) {
    terminalValue = terminalFCFF * 25;
    steps.push(`  ⚠ WACC ≤ Terminal g — TV capped at 25× FCFF₁₁`);
  }

  const pvTerminal = terminalValue / Math.pow(1 + wacc / 100, 10);

  steps.push(``);
  steps.push(`=== Terminal Value (Gordon Growth) ===`);
  steps.push(`FCFF₁₁ = ${fmt(lastFCFF)} × (1 + ${params.terminalG}%) = ${fmt(terminalFCFF)}`);
  steps.push(`TV = ${fmt(terminalFCFF)} / (${wacc.toFixed(2)}% - ${params.terminalG}%) = ${fmt(terminalValue)}`);
  steps.push(`PV(TV) = ${fmt(pvTerminal)}`);

  const enterpriseValue = pvExplicit + pvTerminal;

  const rawNetDebt = params.netDebt;
  const netDebtCap = enterpriseValue * 0.7;
  const netDebtUsed = (rawNetDebt > 0 && rawNetDebt > netDebtCap) ? netDebtCap : rawNetDebt;
  const netDebtWasCapped = rawNetDebt > 0 && rawNetDebt > netDebtCap;

  const equityValue = enterpriseValue - netDebtUsed - params.minorityInterests;
  let perShare = params.sharesOutstanding > 0 ? equityValue / params.sharesOutstanding : 0;

  let perShareCapped = false;
  const ttmEPS = params.actualEPS && params.actualEPS > 0 ? params.actualEPS : 0;
  const fwdEPS = params.forwardEPS && params.forwardEPS > 0 ? params.forwardEPS : 0;
  const capEPS = Math.max(ttmEPS, fwdEPS);
  if (capEPS > 0) {
    const growthRate = Math.max(params.revenueGrowthP1, 5);
    const peMultiple = Math.min(Math.max(growthRate * 1.5, 12), 25);
    const peCap = capEPS * peMultiple;
    if (perShare > peCap && perShare > peCap * 3) {
      const rawVal = perShare;
      perShare = peCap;
      perShareCapped = true;
      steps.push(``);
      steps.push(`⚠ DCF-Sanity: Per-Share auf ${peMultiple.toFixed(0)}× EPS ($${capEPS.toFixed(2)}) gecapped = $${peCap.toFixed(2)}.`);
      steps.push(`  Rohwert $${rawVal.toFixed(0)} — FCFF-Modell überschätzt (wahrscheinlich FS-Debt-Verzerrung).`);
    }
  }

  steps.push(``);
  steps.push(`=== Equity Bridge ===`);
  steps.push(`PV(explizite Phase) = ${fmt(pvExplicit)}`);
  steps.push(`PV(Terminal Value) = ${fmt(pvTerminal)}`);
  steps.push(`Enterprise Value = ${fmt(enterpriseValue)}`);
  if (netDebtWasCapped) {
    steps.push(`- Net Debt (raw) = ${fmt(rawNetDebt)}`);
    steps.push(`  ⚠ Net Debt gecapped auf 70% des EV = ${fmt(netDebtUsed)}`);
    steps.push(`  (Financial Services Schulden asset-backed → nicht voll abziehbar)`);
  } else {
    steps.push(`- Net Debt = ${fmt(netDebtUsed)}`);
  }
  steps.push(`- Minderheitsanteile = ${fmt(params.minorityInterests)}`);
  steps.push(`Equity Value = ${fmt(equityValue)}`);
  steps.push(`÷ Shares (fully diluted) = ${fmtShares(params.sharesOutstanding)}`);
  steps.push(`Fair Value / Aktie = $${perShare.toFixed(2)}`);

  return {
    enterpriseValue,
    equityValue,
    perShare,
    wacc,
    costOfEquity: rawRe,
    yearlyProjections,
    pvExplicit,
    terminalValue,
    pvTerminal,
    steps,
  };
}

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

  for (let i = 0; i < binCount; i++) {
    const binStart = min + i * binSize;
    const binEnd = binStart + binSize;
    const count = finalPrices.filter((r) => r >= binStart && r < binEnd).length;
    histogram.push({ bin: `$${binStart.toFixed(0)}`, count });
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

  const mu = meanDaily * 252;
  const sigma = Math.sqrt(varDaily * 252);

  return { mu: +mu.toFixed(4), sigma: +sigma.toFixed(4) };
}

// === RSL Calculation ===
export function calculateRSL(currentPrice: number, prices26w: number[]): number {
  if (prices26w.length === 0) return 100;
  const avg = prices26w.reduce((s, v) => s + v, 0) / prices26w.length;
  return (currentPrice / avg) * 100;
}

// === Reverse DCF ===
export interface ReverseDCFResult {
  impliedGrowth: number;
  rating: string;
  referenceGrowth: number;
}

export function calculateReverseDCF(params: {
  currentPrice: number;
  fcfBase: number;
  wacc: number;
  sharesOutstanding: number;
  netDebt: number;
  fcfHaircut?: number;       // optional: FCF haircut % (consistent with FCFF-DCF)
  sectorG1?: number;         // optional: sector growth assumption g1 from sectorProfile
  epsGrowthNext5Y?: number;  // optional: analyst EPS growth consensus (5Y)
}): ReverseDCFResult {
  const { currentPrice, fcfBase, wacc, sharesOutstanding, netDebt } = params;
  const fcfHaircut = params.fcfHaircut ?? 0;
  const sectorG1 = params.sectorG1 ?? 0;
  const epsGrowthNext5Y = params.epsGrowthNext5Y ?? 0;

  const ev = currentPrice * sharesOutstanding + netDebt;
  if (!ev || ev <= 0 || !isFinite(ev)) {
    return { impliedGrowth: 0, rating: "n/a", referenceGrowth: 0 };
  }
  if (!currentPrice || !sharesOutstanding) {
    return { impliedGrowth: 0, rating: "n/a", referenceGrowth: 0 };
  }

  // Apply FCF haircut for consistency with FCFF-DCF Section 5
  const adjustedFCF = fcfBase * (1 - fcfHaircut / 100);

  // g* = WACC - FCF / EV  (Gordon Growth Model inverted)
  const impliedGrowth = (wacc / 100 - adjustedFCF / ev) * 100;
  if (!isFinite(impliedGrowth)) return { impliedGrowth: 0, rating: "n/a", referenceGrowth: 0 };

  // === Relative rating — sector & company specific ===
  // referenceGrowth = max(sectorG1, epsGrowthNext5Y, 3%) as floor
  // This replaces the old hard-coded 5%/8% thresholds.
  const referenceGrowth = Math.max(sectorG1, epsGrowthNext5Y, 3);

  let rating: string;
  if (impliedGrowth < 0) {
    rating = "negativ";
  } else if (impliedGrowth > referenceGrowth * 1.5) {
    rating = "unrealistic";
  } else if (impliedGrowth > referenceGrowth) {
    rating = "sportlich";
  } else {
    rating = "realistic";
  }

  return { impliedGrowth, rating, referenceGrowth };
}

// === CRV Calculation ===
export function calculateCRV(fairValue: number, worstCase: number, currentPrice: number): number {
  const numerator = fairValue - worstCase;
  const denominator = currentPrice - worstCase;
  if (denominator <= 0) return 99;
  return numerator / denominator;
}

// === Worst Case Methods ===
export function worstCaseM1(price: number, beta: number, maxDrawdown: number): number {
  const historicalMaxDrawdown = maxDrawdown > 0 ? maxDrawdown : 35;
  const betaAdjustedDrawdown = Math.min(beta * historicalMaxDrawdown, historicalMaxDrawdown * 1.5);
  const effectiveDrawdown = Math.min(betaAdjustedDrawdown, 65);
  return price * (1 - effectiveDrawdown / 100);
}

export function worstCaseM2(price: number, riskImpact: number): number {
  return price * (1 - riskImpact / 100);
}

export function worstCaseM3(price: number, sectorDrawdown: number): number {
  return price * (1 - sectorDrawdown / 100);
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
