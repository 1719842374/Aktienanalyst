import type { Catalyst, Risk, StockAnalysis } from "../../../shared/schema";

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
  const waccDecimalLeg = wacc / 100;
  const gDecimalLeg = terminalG / 100;
  const terminalValue = waccDecimalLeg > gDecimalLeg ? terminalFCF / (waccDecimalLeg - gDecimalLeg) : 0;
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

// === Anti-Bias Inverted DCF (WORK_ANTIBIAS_DCF.md §5) ===
// Root cause dieses Fixes: Section8.tsx rief zuvor calculateDCF() gleichzeitig
// mit erhöhtem WACC (waccAdj = base + damage/10) UND reduziertem Wachstum
// (growthAdj = base - damage/5) auf — beide aus demselben totalExpectedDamage
// abgeleitet. Das ist der in WORK_ANTIBIAS_DCF.md §5.4 explizit verbotene
// Mehrfach-Abschlag ("D− mappt EINMAL auf g ODER auf r, nie beides"): EV fällt
// in r und steigt in g, also multipliziert man dieselbe Downside-Information
// zweimal in dieselbe Richtung — systematisch FV_inv ≪ P und inflationäre
// Warnungen, unabhängig vom tatsächlichen Risiko.
//
// invertedDcf() kapselt genau EINE Mapping-Entscheidung (mode: 'growth' | 'wacc')
// und liefert daraus einen einzigen intern konsistenten DCF-Aufruf.

export interface InvertedDcfParams {
  fcfBase: number;
  gBase: number;         // Basis-Wachstum in % (wie g1 bisher), OHNE Downside-Adjustierung
  wacc: number;           // Basis-WACC in %, OHNE Downside-Adjustierung
  terminalG: number;
  sharesOutstanding: number;
  netDebt: number;
  sigmaGbDown: number;    // Summe der NEGATIVEN Risiko-/GB-Beiträge (<= 0), z.B. -totalExpectedDamage
  mode?: 'growth' | 'wacc'; // Default 'growth' (WORK_ANTIBIAS_DCF.md §5.3 Variante G = Default)
  lambda?: number;        // nur mode='wacc', Default 0.02 (Policy: max +70bp bei D-=0.35)
  haircut?: number;       // unabhängiger FCF-Basis-Parameter (Default 0) — NICHT aus sigmaGbDown ableiten,
                           // sonst wäre das der von §5.4 verbotene dritte Penalty-Kanal (FV × (1-Damage))
}

export interface InvertedDcfResult extends DCFResult {
  Dminus: number;   // gedeckelter Downside-Faktor, 0..0.35
  gAdj: number;      // effektiv verwendetes Wachstum (Jahre 1-5)
  waccAdj: number;   // effektiv verwendeter WACC
  mode: 'growth' | 'wacc';
}

/**
 * Anti-Bias Inverted DCF — mappt die aggregierte Downside-Masse D− GENAU EINMAL
 * auf entweder das Wachstum (mode='growth', Default) oder den WACC (mode='wacc').
 * Niemals beides gleichzeitig. Siehe WORK_ANTIBIAS_DCF.md §5 für die Herleitung.
 */
export function invertedDcf(params: InvertedDcfParams): InvertedDcfResult {
  const mode = params.mode ?? 'growth';
  const lambda = params.lambda ?? 0.02;
  const haircut = params.haircut ?? 0;

  // D- = min(0.35, -ΣGB-) — §5.2, gedeckelt auf 35%
  const Dminus = Math.min(0.35, Math.max(0, -params.sigmaGbDown));

  // Genau eine der beiden Größen wird adjustiert; die andere bleibt an der Basis.
  const gAdj = mode === 'growth' ? params.gBase * (1 - Dminus) : params.gBase;
  const waccAdj = mode === 'wacc' ? params.wacc + Dminus * lambda * 100 : params.wacc;
  // Hinweis: lambda ist in der Doku dimensionslos auf D- (0..1) bezogen und liefert
  // einen Spread in Prozentpunkten (z.B. 0.35 * 0.02 = 0.007 -> 0.7 Prozentpunkte).
  // Hier *100, weil wacc/waccAdj in diesem Codebase in Prozentpunkten (nicht Dezimal) gefuehrt werden.

  const dcf = calculateDCF({
    fcfBase: params.fcfBase,
    haircut,
    wacc: waccAdj,
    g1: gAdj,
    g2: gAdj / 2,
    terminalG: params.terminalG,
    sharesOutstanding: params.sharesOutstanding,
    netDebt: params.netDebt,
  });

  return { ...dcf, Dminus, gAdj, waccAdj, mode };
}

// === SINGLE SOURCE OF TRUTH: Default DCF Parameters ===
// Both Section5 and Section6 MUST derive their defaults from this function.
// Any change to beta or capex logic here propagates to all consumers automatically.
// This eliminates the Zwei-Pfad-Bug (#1, #6).
export function buildDefaultDCFParams(data: StockAnalysis): FCFFDCFParams {
  const netDebt = data.totalDebt - data.cashEquivalents;
  const sp = data.sectorProfile;
  const rf = 4.2;
  const erp = 5.5;
  const taxR = 21;
  const rd = 5.0;

  // EBIT margin — prefer actual operating income, fall back to EBITDA proxy
  const ebitMarginDefault =
    data.operatingIncome > 0 && data.revenue > 0
      ? +((data.operatingIncome / data.revenue) * 100).toFixed(1)
      : data.ebitda > 0 && data.revenue > 0
      ? +((data.ebitda / data.revenue) * 100 * 0.6).toFixed(1)
      : 15;

  // Capex — prefer real CapEx from cash flow statement (Section5 logic, authoritative)
  const fsCapex = data.financialStatements?.cashFlow?.capex;
  const capexDefault =
    fsCapex && fsCapex > 0 && data.revenue > 0
      ? +Math.max(2, Math.min(25, (fsCapex / data.revenue) * 100)).toFixed(1)
      : data.revenue > 0 && data.ebitda > 0 && data.operatingIncome > 0
      ? +Math.max(2, Math.min(20, ((data.ebitda - data.operatingIncome) / data.revenue) * 100)).toFixed(1)
      : 5;

  const revenueGrowthDefault = sp.growthAssumptions.g1 || 10;

  const debtRatioVal =
    data.totalDebt > 0
      ? +((data.totalDebt / (data.marketCap + data.totalDebt)) * 100).toFixed(0)
      : 10;
  const evFrac = (100 - debtRatioVal) / 100;
  const dvFrac = debtRatioVal / 100;

  // Implied beta anchored to sector WACC (same logic as Section5)
  const targetWACC = sp.waccScenarios.avg;
  const debtCostPart = dvFrac * rd * (1 - taxR / 100);
  const impliedBeta = Math.max(
    0.5,
    Math.min(1.8, (targetWACC - debtCostPart - evFrac * rf) / (evFrac * erp))
  );
  // Cap at observed market beta + 0.1 to avoid over-anchoring
  const dcfBeta = +Math.min(impliedBeta, data.beta5Y + 0.1).toFixed(2);

  // RSL-Momentum (single source of truth — same prices26w slice as Section9/Section13)
  const prices26w = [...data.historicalPrices]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 130)
    .map((p) => p.close);
  const rsl = calculateRSL(data.currentPrice, prices26w);

  return {
    revenueBase: data.revenue,
    revenueGrowthP1: revenueGrowthDefault,
    revenueGrowthP2: Math.max(3, +(revenueGrowthDefault * 0.6).toFixed(1)),
    ebitMargin: ebitMarginDefault,
    ebitMarginTerminal: +Math.max(8, ebitMarginDefault * 0.9).toFixed(1),
    capexPct: capexDefault,
    deltaWCPct: 5,
    taxRate: taxR,
    daRatio: +Math.max(2, capexDefault * 0.8).toFixed(1),
    riskFreeRate: rf,
    beta: dcfBeta,
    erp,
    debtRatio: debtRatioVal,
    costOfDebt: rd,
    terminalG: sp.growthAssumptions.terminal || 2.5,
    sharesOutstanding: data.sharesOutstanding,
    netDebt,
    minorityInterests: 0,
    fcfHaircut: data.fcfHaircut,
    actualEPS: data.epsTTM,
    forwardEPS: data.epsConsensusNextFY,
    waccOverride: null,
    rsl,
  };
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
  // Optional: RSL momentum value (Levy RSL = Price/26W-Avg × 100).
  // RSL < 105 triggers an automatic growth-rate malus (see RSL_MOMENTUM_MALUS_PCT),
  // matching the "Automatische Anpassung" claim shown in Section 9.
  rsl?: number | null;
}

// RSL < 105 → reduce DCF growth rates by this relative percentage (UI: "-5% to -10%").
// We apply the midpoint of that stated range so the DCF Rechenweg matches Section 9's claim.
export const RSL_MOMENTUM_MALUS_PCT = 7.5;

// WACC sanity bounds — single source for calculation AND Rechenweg text.
const WACC_FLOOR = 5.0;
const WACC_CEIL = 20.0;

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
      steps.push(`⚠ WACC-Sanity-Cap: ${rawWacc.toFixed(2)}% → ${wacc.toFixed(2)}% (Bounds: ${WACC_FLOOR}%-${WACC_CEIL}%)`);
      steps.push(`  Grund: CAPM liefert Wert außerhalb des plausiblen Bereichs.`);
    }
  }
  steps.push(`WACC (final) = ${wacc.toFixed(2)}%`);

  // RSL-Momentum-Malus (Section 9): RSL < 105 → Wachstumsraten automatisch reduzieren.
  // Macht die in Section 9 behauptete "Automatische Anpassung" tatsächlich wirksam,
  // statt sie nur als Text anzuzeigen.
  const rslActive = params.rsl != null && params.rsl > 0 && params.rsl < 105;
  const rslFactor = rslActive ? 1 - RSL_MOMENTUM_MALUS_PCT / 100 : 1;
  const adjGrowthP1 = params.revenueGrowthP1 * rslFactor;
  const adjGrowthP2 = params.revenueGrowthP2 * rslFactor;

  if (rslActive) {
    steps.push(``);
    steps.push(`⚠ RSL-Momentum-Malus aktiv: RSL = ${params.rsl!.toFixed(1)} < 105 (schwaches Momentum)`);
    steps.push(`  Wachstumsraten × (1 - ${RSL_MOMENTUM_MALUS_PCT}%) = × ${rslFactor.toFixed(3)}`);
    steps.push(`  g1: ${params.revenueGrowthP1.toFixed(1)}% → ${adjGrowthP1.toFixed(2)}% | g2: ${params.revenueGrowthP2.toFixed(1)}% → ${adjGrowthP2.toFixed(2)}%`);
  }

  steps.push(``);
  steps.push(`=== FCFF-Projektion (10 Jahre) ===`);
  steps.push(`Revenue Basis: ${fmt(params.revenueBase)}`);

  const yearlyProjections: FCFFDCFResult["yearlyProjections"] = [];
  let pvExplicit = 0;
  let prevRevenue = params.revenueBase;

  for (let y = 1; y <= 10; y++) {
    const growthRate = y <= 5 ? adjGrowthP1 : adjGrowthP2;
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
      steps.push(`  Y6-9: Phase 2 Growth = ${adjGrowthP2.toFixed(2)}%${rslActive ? " (RSL-adjustiert)" : ""}`);
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

// === RSL Calculation ===
// Gibt null zurück, wenn keine ausreichende Kurshistorie vorliegt (< 60 Datenpunkte) —
// sonst würde ein Default von 100 fälschlich den RSL-Malus (< 105) im DCF aktivieren.
export function calculateRSL(currentPrice: number, prices26w: number[]): number | null {
  if (prices26w.length < 60) return null;
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

/**
 * Risk-Adjusted CRV — einheitliche Formel für Section 6 und Section 13 (Fazit).
 * Diskontiert den Fair Value um totalExpectedDamage (%) bevor CRV berechnet wird.
 * Beide Sections importieren diese Funktion — keine Ad-hoc-Multiplikation mehr.
 */
export function calculateRiskAdjustedCRV(
  fairValue: number,
  worstCase: number,
  currentPrice: number,
  totalExpectedDamage: number,   // 0–100
): number {
  const riskDiscountFactor = Math.max(0, 1 - totalExpectedDamage / 100);
  return calculateCRV(fairValue * riskDiscountFactor, worstCase, currentPrice);
}

// === Worst Case Methods ===
// M1 Formula: effectiveDrawdown = min(beta × sectorDD, sectorDD × 1.5), capped at 65%
// UI label must match: "min(β × SectorDD, SectorDD×1.5), cap 65%"
export function worstCaseM1(price: number, beta: number, maxDrawdown: number): number {
  const historicalMaxDrawdown = maxDrawdown > 0 ? maxDrawdown : 35;
  const betaAdjustedDrawdown = Math.min(beta * historicalMaxDrawdown, historicalMaxDrawdown * 1.5);
  const effectiveDrawdown = Math.min(betaAdjustedDrawdown, 65);
  return price * (1 - effectiveDrawdown / 100);
}

// Exported label for UI — keeps formula display in sync with implementation (Bug #2 fix)
export function worstCaseM1Label(beta: number, sectorDD: number): string {
  const raw = +(beta * sectorDD).toFixed(1);
  const capped = Math.min(raw, sectorDD * 1.5);
  const effective = Math.min(capped, 65);
  const isCapped = effective < raw;
  return isCapped
    ? `β(${beta.toFixed(2)}) × ${sectorDD}% = ${raw}% → gecapped auf ${effective.toFixed(1)}%`
    : `β(${beta.toFixed(2)}) × ${sectorDD}% = ${effective.toFixed(1)}%`;
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
