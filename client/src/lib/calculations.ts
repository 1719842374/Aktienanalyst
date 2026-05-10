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
  // Optional: Growth-Player detection inputs (alle automatisch erkannt)
  revenueGrowthYoY?: number; // Aktuelles YoY Revenue Growth %
  fcfMargin?: number;        // FCF / Revenue %
  psRatio?: number;          // Price/Sales
  epsGrowth5Y?: number;      // Analyst expected EPS Growth 5Y %
  // Optional: Current Price for safety-floor anti-bias
  currentPrice?: number;
  // Optional: Sector EV/EBITDA + EV/Sales multiples for terminal fallback
  sectorEvEbitda?: number;   // Default 10
  sectorEvSales?: number;    // Default 2
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
  // Growth-Adjusted DCF metadata
  growthAdjusted?: {
    isGrowthPlayer: boolean;
    triggers: string[];        // Welche Kriterien getroffen haben
    highGrowthYears: number;
    transitionYears: number;
    capexEndPct: number;
    ebitMarginTerminalAdj: number;
    tvMethod: "gordon" | "ev-ebitda" | "ev-sales" | "capped";
    safetyFloorApplied: boolean;
    rawPerShareBeforeFloor: number;
  };
}

export function calculateFCFFDCF(params: FCFFDCFParams): FCFFDCFResult {
  const steps: string[] = [];

  // 1. Compute WACC via CAPM, or use manual override
  const rawRe = params.riskFreeRate + params.beta * params.erp;
  const Rd = params.costOfDebt;
  // Cap debt ratio at 60% — companies with massive financial services debt
  // (e.g. VW, GM, Toyota) have debt ratios of 80-90% which would pull WACC
  // down unrealistically. Financial services debt is asset-backed and shouldn't
  // be treated as traditional corporate leverage.
  const cappedDebtRatio = Math.min(params.debtRatio, 60);
  const dv = cappedDebtRatio / 100;
  const ev = 1 - dv;
  const rawWacc = ev * rawRe + dv * Rd * (1 - params.taxRate / 100);

  const useOverride = params.waccOverride != null && params.waccOverride > 0;
  let wacc: number;
  let waccWasCapped = false;

  if (useOverride) {
    // Direct WACC override — no capping, user has full control
    wacc = params.waccOverride!;
  } else {
    // Sanity bounds: WACC between 5% and 20%
    // Floor of 5% prevents unrealistic terminal values from Gordon Growth
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

  // === 2. GROWTH-PLAYER DETECTION (Spec: mind. 2 von 4 Kriterien) ===
  // K1: Revenue Growth YoY > 25%   (aus revenueGrowthYoY oder revenueGrowthP1)
  // K2: EPS TTM negativ ODER FCF Margin < 5%
  // K3: P/S Ratio > 8
  // K4: Analyst expected EPS Growth 5Y > 20%
  const triggers: string[] = [];
  const yoyGrowth = (params.revenueGrowthYoY != null && params.revenueGrowthYoY > 0)
    ? params.revenueGrowthYoY
    : params.revenueGrowthP1;
  if (yoyGrowth > 25) triggers.push(`K1: Revenue Growth ${yoyGrowth.toFixed(1)}% > 25%`);
  const epsNegative = (params.actualEPS != null && params.actualEPS <= 0);
  const fcfMarginThin = (params.fcfMargin != null && params.fcfMargin < 5);
  if (epsNegative || fcfMarginThin) {
    triggers.push(`K2: ${epsNegative ? `EPS TTM ${params.actualEPS}` : `FCF-Marge ${params.fcfMargin?.toFixed(1)}%`} — Pre-Profitability`);
  }
  if (params.psRatio != null && params.psRatio > 8) triggers.push(`K3: P/S ${params.psRatio.toFixed(1)} > 8×`);
  if (params.epsGrowth5Y != null && params.epsGrowth5Y > 20) triggers.push(`K4: EPS-Growth 5Y ${params.epsGrowth5Y.toFixed(1)}% > 20%`);

  const isGrowthPlayer = triggers.length >= 2;

  // === 3-PHASEN-MODELL bei Growth Player, sonst klassisches 5+5 ===
  // Phase-Länge dynamisch: base 8 Jahre + 1 Jahr pro 10% über 25% Growth, max 12
  const highGrowthYears = isGrowthPlayer
    ? Math.min(12, Math.max(8, Math.round(8 + Math.max(0, yoyGrowth - 25) / 10)))
    : 5;
  const transitionYears = isGrowthPlayer ? 5 : 5; // Phase 2
  const projectionYears = highGrowthYears + transitionYears; // 13–17 bei Growth, 10 sonst

  // Capex-Normalisierung (Spec: 30–50% Reduktion in High-Growth, dann auf 6–10%)
  const capexFloorPct = 6;
  const capexEndPctRaw = isGrowthPlayer
    ? Math.max(capexFloorPct, Math.min(10, params.capexPct * 0.5))
    : params.capexPct;

  // Aggressivere EBIT-Margin-Ramp bei Growth Playern: +800 bis +1500 bps
  // über die Phase. Das hebt das User-Terminal an, aber gedeckelt durch sektor-typische
  // Maxima: Industrials max 18%, Tech max 30%. Ohne Sektor-Info: max 22%.
  const marginRampBps = isGrowthPlayer ? Math.min(1500, 800 + (yoyGrowth - 25) * 20) : 0;
  const ebitMarginTerminalAdj = isGrowthPlayer
    ? Math.min(22, params.ebitMarginTerminal + marginRampBps / 100)
    : params.ebitMarginTerminal;

  // WACC-Anpassung: Bei Growth Playern mit hohem Beta (>1.5) sinkt WACC in späteren
  // Phasen leicht (-50bps zur Mid-Phase, -100bps Terminal) wegen reifer Cash-Flows
  const waccLatePhase = (isGrowthPlayer && params.beta > 1.5)
    ? Math.max(5, wacc - 1.0)
    : wacc;
  const waccTerminal = waccLatePhase;

  // === Logging Header ===
  steps.push(``);
  steps.push(`=== FCFF-Projektion ===`);
  steps.push(`Revenue Basis: ${fmt(params.revenueBase)}`);
  if (isGrowthPlayer) {
    steps.push(`⚡ GROWTH-ADJUSTED DCF — ${triggers.length}/4 Kriterien getroffen:`);
    triggers.forEach(t => steps.push(`   ✓ ${t}`));
    steps.push(`» 3-Phasen-Modell:`);
    steps.push(`   Phase 1 (High-Growth): ${highGrowthYears}J × ${params.revenueGrowthP1.toFixed(1)}% Growth, EBIT-M ${params.ebitMargin}% → ${ebitMarginTerminalAdj.toFixed(1)}%`);
    steps.push(`   Phase 2 (Transition): ${transitionYears}J Growth-Glide auf ${params.terminalG}%, Capex ${params.capexPct}% → ${capexEndPctRaw.toFixed(1)}%`);
    steps.push(`   Phase 3 (Terminal): EV/EBITDA-Multiple oder Gordon (Hybrid)`);
    if (params.beta > 1.5) {
      steps.push(`   WACC-Glide (Beta ${params.beta} > 1.5): ${wacc.toFixed(2)}% → ${waccLatePhase.toFixed(2)}% Late-Phase`);
    }
  } else {
    steps.push(`Klassisches 5+5 Modell (kein Growth-Player erkannt: ${triggers.length}/4 Kriterien).`);
  }

  // === FCFF-Projektion ===
  const yearlyProjections: FCFFDCFResult["yearlyProjections"] = [];
  let pvExplicit = 0;
  let prevRevenue = params.revenueBase;

  for (let y = 1; y <= projectionYears; y++) {
    // Growth-Rate: Phase 1 voll, Phase 2 linear glide auf terminalG
    let growthRate: number;
    let phaseLabel: string;
    if (y <= highGrowthYears) {
      growthRate = params.revenueGrowthP1;
      phaseLabel = "P1";
    } else {
      const transitionProgress = (y - highGrowthYears) / transitionYears;
      growthRate = params.revenueGrowthP1 + (params.terminalG - params.revenueGrowthP1) * transitionProgress;
      phaseLabel = "P2";
    }
    const revenue = prevRevenue * (1 + growthRate / 100);

    // EBIT-Margin: linearer Ramp über gesamte Projektion (so sieht Terminal-Margin)
    const marginProgress = y / projectionYears;
    const ebitMargin = params.ebitMargin + (ebitMarginTerminalAdj - params.ebitMargin) * marginProgress;

    // Capex-Normalisierung: linear von params.capexPct auf capexEndPctRaw
    const capexPctY = isGrowthPlayer
      ? params.capexPct + (capexEndPctRaw - params.capexPct) * marginProgress
      : params.capexPct;

    // WACC-Glide: linear von wacc auf waccLatePhase über Phase 2
    const waccY = (isGrowthPlayer && y > highGrowthYears)
      ? wacc + (waccLatePhase - wacc) * ((y - highGrowthYears) / transitionYears)
      : wacc;

    const ebit = revenue * (ebitMargin / 100);
    const nopat = ebit * (1 - params.taxRate / 100);
    const da = revenue * (params.daRatio / 100);
    const capex = revenue * (capexPctY / 100);
    const revenueGrowthAbs = revenue - prevRevenue;
    const deltaWC = revenueGrowthAbs * (params.deltaWCPct / 100);

    let fcff = nopat + da - capex - deltaWC;
    if (params.fcfHaircut > 0) fcff = fcff * (1 - params.fcfHaircut / 100);

    const pvFCFF = fcff / Math.pow(1 + waccY / 100, y);
    pvExplicit += pvFCFF;

    yearlyProjections.push({ year: y, revenue, ebit, nopat, da, capex, deltaWC, fcff, pvFCFF });

    if (y <= 3 || y === highGrowthYears || y === projectionYears) {
      steps.push(`  Y${y}/${phaseLabel}: Rev ${fmt(revenue)} (g=${growthRate.toFixed(1)}%), EBIT-M ${ebitMargin.toFixed(1)}%, Capex ${capexPctY.toFixed(1)}%, WACC ${waccY.toFixed(2)}%, FCFF ${fmt(fcff)}, PV ${fmt(pvFCFF)}`);
    } else if (y === 4) {
      steps.push(`  ... Y4–Y${highGrowthYears - 1} laufen mit Phase-1-Parametern ...`);
    } else if (y === highGrowthYears + 1) {
      steps.push(`  ... Y${y}–Y${projectionYears - 1} Transition-Phase ...`);
    }

    prevRevenue = revenue;
  }

  // === 3. TERMINAL VALUE — Hybrid (Gordon / EV-EBITDA / EV-Sales / Capped) ===
  const lastIdx = yearlyProjections.length - 1;
  const lastFCFF = yearlyProjections[lastIdx].fcff;
  const lastRevenue = yearlyProjections[lastIdx].revenue;
  const lastEBIT = yearlyProjections[lastIdx].ebit;
  const lastDA = yearlyProjections[lastIdx].da;
  const lastEBITDA = lastEBIT + lastDA;
  const terminalFCFF = lastFCFF * (1 + params.terminalG / 100);

  const waccTermDecimal = waccTerminal / 100;
  const gDecimal = params.terminalG / 100;
  let terminalValue = 0;
  let tvMethod: "gordon" | "ev-ebitda" | "ev-sales" | "capped" = "gordon";

  // Sektor-Multiples mit Defaults: 10× EBITDA, 2× Sales (industrials baseline)
  const sectorEvEbitda = params.sectorEvEbitda && params.sectorEvEbitda > 0 ? params.sectorEvEbitda : 10;
  const sectorEvSales = params.sectorEvSales && params.sectorEvSales > 0 ? params.sectorEvSales : 2;

  // Verzerrungs-Detektor: FCFF im Endjahr ist negativ ODER < 25% des EBITDA
  const fcffEbitdaRatio = lastEBITDA > 0 ? terminalFCFF / lastEBITDA : 0;
  const fcffIsDistorted = terminalFCFF <= 0 || (lastEBITDA > 0 && fcffEbitdaRatio < 0.25);

  if (fcffIsDistorted && lastEBITDA > 0) {
    // Bei Growth Player: leicht höheres Multiple (12× statt 10×) wegen reifer Story
    const evMult = isGrowthPlayer ? Math.max(sectorEvEbitda, 12) : sectorEvEbitda;
    terminalValue = lastEBITDA * evMult;
    tvMethod = "ev-ebitda";
    steps.push(``);
    steps.push(`=== Terminal Value (EV/EBITDA-Multiple Fallback) ===`);
    steps.push(`  FCFF im Endjahr verzerrt (${terminalFCFF <= 0 ? "negativ" : `${(fcffEbitdaRatio * 100).toFixed(0)}% von EBITDA`}) — Gordon Growth nicht anwendbar.`);
    steps.push(`  EBITDA Endjahr = ${fmt(lastEBITDA)} × ${evMult}× = ${fmt(terminalValue)}`);
  } else if (fcffIsDistorted && lastRevenue > 0) {
    // Letzte Rettung: EV/Sales (wenn EBITDA auch nicht hilft, z.B. Datenfehler)
    const evMult = isGrowthPlayer ? Math.max(sectorEvSales, 3) : sectorEvSales;
    terminalValue = lastRevenue * evMult;
    tvMethod = "ev-sales";
    steps.push(``);
    steps.push(`=== Terminal Value (EV/Sales-Multiple Fallback) ===`);
    steps.push(`  EBITDA Endjahr nicht verwertbar — fallback auf Revenue-Multiple.`);
    steps.push(`  Revenue Endjahr = ${fmt(lastRevenue)} × ${evMult}× = ${fmt(terminalValue)}`);
  } else if (waccTermDecimal > gDecimal && terminalFCFF > 0) {
    terminalValue = terminalFCFF / (waccTermDecimal - gDecimal);
    tvMethod = "gordon";
  } else if (terminalFCFF > 0) {
    terminalValue = terminalFCFF * 25;
    tvMethod = "capped";
    steps.push(`  ⚠ WACC ≤ Terminal g — TV capped at 25× FCFF`);
  }

  const pvTerminal = terminalValue / Math.pow(1 + waccTerminal / 100, projectionYears);

  if (tvMethod === "gordon") {
    steps.push(``);
    steps.push(`=== Terminal Value (Gordon Growth) ===`);
    steps.push(`FCFF₊₁ = ${fmt(lastFCFF)} × (1 + ${params.terminalG}%) = ${fmt(terminalFCFF)}`);
    steps.push(`TV = ${fmt(terminalFCFF)} / (${waccTerminal.toFixed(2)}% - ${params.terminalG}%) = ${fmt(terminalValue)}`);
  }
  steps.push(`PV(TV) bei ${waccTerminal.toFixed(2)}% / ${projectionYears}J = ${fmt(pvTerminal)}`);

  // 4. Enterprise Value & Equity Bridge
  const enterpriseValue = pvExplicit + pvTerminal;

  // Sanity: If net debt > 70% of EV, cap it at 70%.
  // Companies with massive financial services debt (VW, GM, Toyota, GE)
  // have total debt from lending/leasing that is asset-backed and shouldn't
  // be fully deducted from industrial DCF enterprise value.
  const rawNetDebt = params.netDebt;
  const netDebtCap = enterpriseValue * 0.7;
  const netDebtUsed = (rawNetDebt > 0 && rawNetDebt > netDebtCap) ? netDebtCap : rawNetDebt;
  const netDebtWasCapped = rawNetDebt > 0 && rawNetDebt > netDebtCap;

  const equityValue = enterpriseValue - netDebtUsed - params.minorityInterests;
  let perShare = params.sharesOutstanding > 0 ? equityValue / params.sharesOutstanding : 0;

  // Sanity check: If net debt > 3× market cap, the company likely has massive
  // financial services debt (auto OEMs, conglomerates, banks). The FCFF model
  // projects total revenue at industrial margins, but FS revenue has different
  // economics. Detect this and apply a P/E-based cap.
  let perShareCapped = false;
  const netDebtToEV = rawNetDebt / Math.max(enterpriseValue, 1);
  const impliedMarketCap = equityValue;
  const rawMarketCapRatio = params.sharesOutstanding > 0 && params.revenueBase > 0
    ? (equityValue / params.sharesOutstanding) / (params.revenueBase / params.sharesOutstanding)
    : 0; // P/S implied
  // Sanity cap: If per-share DCF vastly exceeds a reasonable earnings-based ceiling,
  // the FCFF model is likely distorted (Financial Services debt, conglomerate structure).
  // Cap at growth-adjusted P/E × Forward EPS. Bounded [12, 25].
  // This is CONSERVATIVE by design — better to cap too tight than show 400% upside
  // for a stock like VW where the market sees 0% upside.
  const ttmEPS = params.actualEPS && params.actualEPS > 0 ? params.actualEPS : 0;
  const fwdEPS = params.forwardEPS && params.forwardEPS > 0 ? params.forwardEPS : 0;
  const capEPS = Math.max(ttmEPS, fwdEPS);
  if (capEPS > 0) {
    // P/E cap: PEG=1.5 rule → PE = growth × 1.5, bounded [12, 25]
    // Only trigger if raw perShare > 5× the EPS-based cap (i.e. massively distorted)
    const growthRate = Math.max(params.revenueGrowthP1, 5);
    const peMultiple = Math.min(Math.max(growthRate * 1.5, 12), 25);
    const peCap = capEPS * peMultiple;
    if (perShare > peCap && perShare > peCap * 3) {
      // Only cap when raw DCF is >3× the PE-based ceiling (clearly distorted)
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

  // === SAFETY FLOOR (nur Growth Player + currentPrice gegeben) ===
  // Anti-Bias-Regel: Bei extremen Growth-Stocks darf der Fair Value nicht unter
  // 15% des aktuellen Kurses liegen. Schutz vor unrealistisch niedrigen DCFs durch
  // Pre-Profitability + Heavy-Capex + Volatile Earnings.
  // Der Floor ist transparent: rawPerShareBeforeFloor wird im Result mitgeführt,
  // sodass die UI beide Werte zeigen kann ("DCF $X, Floor-adjustiert $Y").
  const rawPerShareBeforeFloor = perShare;
  let safetyFloorApplied = false;
  if (isGrowthPlayer && params.currentPrice && params.currentPrice > 0 && perShare > 0) {
    const floor = params.currentPrice * 0.15;
    if (perShare < floor) {
      steps.push(``);
      steps.push(`=== Safety Floor (Anti-Bias bei Growth Player) ===`);
      steps.push(`  Roh-DCF $${perShare.toFixed(2)} liegt unter 15% des Kurses ($${floor.toFixed(2)}).`);
      steps.push(`  Aufgezogen auf 15%-Floor = $${floor.toFixed(2)}. Begründung: Pre-Profitability + Heavy-Capex verzerrt FCFF-Modell.`);
      perShare = floor;
      safetyFloorApplied = true;
    }
  }

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
    growthAdjusted: {
      isGrowthPlayer,
      triggers,
      highGrowthYears,
      transitionYears,
      capexEndPct: capexEndPctRaw,
      ebitMarginTerminalAdj,
      tvMethod,
      safetyFloorApplied,
      rawPerShareBeforeFloor,
    },
  };
}

// === Monte Carlo Simulation (Geometrische Brownsche Bewegung / GBM) ===
// S_{t+Δt} = S_t * exp((μ - σ²/2)*Δt + σ*√Δt*Z) where Z ~ N(0,1)
export interface GBMMonteCarloParams {
  currentPrice: number;
  mu: number;           // drift (annualized), from historical log-returns
  sigma: number;        // volatility (annualized)
  iterations: number;   // number of simulation paths
  tradingDays: number;  // time horizon in trading days (252 = 1 year)
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
  downsideProb: number;         // P(S_T < S_0)
  downsideProb10: number;       // P(S_T < 0.9 * S_0)  — 10%+ loss
  downsideProb20: number;       // P(S_T < 0.8 * S_0)  — 20%+ loss
  analystPTProb: number;        // P(S_T >= analystPT)
  maxDrawdownMean: number;      // average max-drawdown across paths
  expectedReturn: number;       // mean/currentPrice - 1
  paths: number[][];            // sample paths for visualization (5 paths)
}

// Box-Muller transform for N(0,1)
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
  const dt = 1 / 252; // 1 trading day in years
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

  // Build histogram
  const min = finalPrices[0];
  const max = finalPrices[finalPrices.length - 1];
  const binCount = 40;
  const binSize = (max - min) / binCount;
  const histogram: { bin: string; count: number }[] = [];

  for (let i = 0; i < binCount; i++) {
    const binStart = min + i * binSize;
    const binEnd = binStart + binSize;
    const count = finalPrices.filter((r) => r >= binStart && r < binEnd).length;
    histogram.push({
      bin: `$${binStart.toFixed(0)}`,
      count,
    });
  }

  return {
    mean, p5, p10, p25, p50, p75, p90, p95,
    histogram, downsideProb, downsideProb10, downsideProb20,
    analystPTProb, maxDrawdownMean, expectedReturn, paths: samplePaths,
  };
}

// Calculate historical mu and sigma from price data
export function calculateGBMParams(prices: number[]): { mu: number; sigma: number } {
  if (prices.length < 30) return { mu: 0.08, sigma: 0.25 };

  // Log returns
  const logReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > 0 && prices[i - 1] > 0) {
      logReturns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }

  if (logReturns.length === 0) return { mu: 0.08, sigma: 0.25 };

  const meanDaily = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const varDaily = logReturns.reduce((s, r) => s + (r - meanDaily) ** 2, 0) / logReturns.length;

  // Annualize: μ = meanDaily * 252, σ = sqrt(varDaily * 252)
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
}

export function calculateReverseDCF(params: {
  currentPrice: number;
  fcfBase: number;
  wacc: number;
  sharesOutstanding: number;
  netDebt: number;
}): ReverseDCFResult {
  const { currentPrice, fcfBase, wacc, sharesOutstanding, netDebt } = params;
  const ev = currentPrice * sharesOutstanding + netDebt;
  // Simplified: EV = FCF / (WACC - g) => g = WACC - FCF/EV
  const impliedGrowth = (wacc / 100 - fcfBase / ev) * 100;
  let rating = "realistic";
  if (impliedGrowth > 8) rating = "unrealistic";
  else if (impliedGrowth > 5) rating = "sportlich";
  return { impliedGrowth, rating };
}

// === CRV Calculation ===
// CORRECT formula per user spec: CRV = (Fair Value - Worst Case) / (Kurs - Worst Case)
export function calculateCRV(fairValue: number, worstCase: number, currentPrice: number): number {
  const numerator = fairValue - worstCase;
  const denominator = currentPrice - worstCase;
  if (denominator <= 0) return 99;
  return numerator / denominator;
}

// === Worst Case Methods ===
// M1 fix: When beta × maxDrawdown > 100%, result would go negative.
// Cap the effective drawdown at 90% (floor = 10% of current price).
export function worstCaseM1(price: number, beta: number, maxDrawdown: number): number {
  const effectiveDrawdown = Math.min(90, beta * maxDrawdown); // cap at 90%
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
// Kat.-adj. Zielwert = Kons. DCF × (1 + Σ GB / 100)
// The base is the conservative DCF perShare, NOT currentPrice.
// Catalysts are additive adjustments on the fundamental fair value.
export function calculateCatalystUpside(
  catalysts: Catalyst[],
  conservativeDCFPerShare: number
): { totalUpside: number; adjustedTarget: number } {
  const totalUpside = catalysts.reduce((sum, c) => sum + c.gb, 0);
  const adjustedTarget = conservativeDCFPerShare * (1 + totalUpside / 100);
  return { totalUpside, adjustedTarget };
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
