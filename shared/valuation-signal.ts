/**
 * shared/valuation-signal.ts — Sprint B3 Phase 1b (WORK_SIGNAL_BACKTEST.md §3.3, §9;
 * Ticket: tickets/SPRINT_B3_PHASE1B_SHARED_CRV.md).
 *
 * EIN Modul, ZWEI Aufrufer (Client + Server) — KEINE zweite Formel-Implementierung.
 *
 * Hintergrund (bindende Nutzer-Entscheidung, siehe Ticket-Kontext): Phase 0+1
 * (Commits f37ce85, 949c3c4) haben erkannt, dass `invDcf`/`CRV` bislang NUR
 * clientseitig existieren (client/src/lib/calculations.ts, aufgerufen aus
 * SummarySection.tsx/Section6.tsx/Section8.tsx). deriveSignalV1() im Server
 * lieferte deshalb immer signal=null. Statt einer separaten Server-Mirror-Datei
 * (Copy-Paste-Risiko/Drift) werden die reinen Bewertungs-/CRV-Funktionen HIER,
 * in `shared/`, EINMAL definiert. `shared/` wird bereits von Client UND Server
 * importiert (Praezedenzfall: shared/schema.ts).
 *
 * Die Funktionen unten sind 1:1, UNVERAENDERT aus client/src/lib/calculations.ts
 * extrahiert (reine Funktionen — kein React-State, kein DOM, keine Client-
 * spezifischen Abhaengigkeiten). client/src/lib/calculations.ts re-exportiert
 * sie ab jetzt aus diesem Modul (siehe Kommentar dort), damit die UI-Aufrufer
 * (SummarySection.tsx, Section6.tsx, Section8.tsx, ReverseDCFSection.tsx, ...)
 * ihre Importpfade NICHT aendern muessen und sich funktional 100% identisch
 * verhalten (reiner Refactor, keine Verhaltensaenderung).
 *
 * Zusaetzlich (additiv, aus WORK_SIGNAL_BACKTEST.md §3.3/§9, siehe unten):
 *   - dcfApplicable() — Klassensperre §3.3 (FCF_T > 0 AND Sektor kein Bank-
 *     Proxy AND Profil erlaubt FCF-DCF).
 *   - signalV1() — die komplette Signalregel §9 als reine Funktion. Die
 *     bestehende server/backtest/signal.ts (deriveSignalV1) bleibt der
 *     alleinige serverseitige Aufrufer (dünner Re-Export-Wrapper, siehe
 *     dortiger Kommentar) — kein zweites Regel-Set.
 *
 * Randfall (Ticket Punkt 5, WORK_SIGNAL_BACKTEST.md-Praezisierung): Wenn
 * `P - WC <= 0` bei der CRV-Berechnung, liefert calculateCRV() `99` zurueck
 * (kein Avoid durch Division/negativen Nenner) — siehe calculateCRV() unten.
 * Client und Server rufen exakt dieselbe Funktion auf und reagieren daher
 * IMMER identisch auf diesen Randfall.
 */
import type { StockAnalysis } from "./schema";
import { LYNCH_DCF_DEFAULTS, resolveLynchDcfOverrides, type LynchDcfOverrides } from "./lynch-dcf-defaults";
import type { LynchClass } from "../server/catalyst-engine";

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

  // === Sprint D1 — Lynch-Klassen-DCF-Defaults (WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md §1) ===
  // Priorität: Sektor-Defaults (Base, oben) < Lynch-Klasse (hier) < manuelle User-Overrides
  // (Slider in Section5 — diese Funktion liefert NUR die Defaults, die UI überschreibt sie
  // im lokalen State, siehe Section5.tsx `params`/`updateParam`; buildDefaultDCFParams() wird
  // NIE erneut aufgerufen, nachdem der Nutzer manuell etwas geändert hat).
  const lynchClass = (data.lynchClass ?? null) as LynchClass | null;
  const ebitMarginPhase1ForLynch =
    data.operatingIncome > 0 && data.revenue > 0
      ? +((data.operatingIncome / data.revenue) * 100).toFixed(1)
      : data.ebitda > 0 && data.revenue > 0
      ? +((data.ebitda / data.revenue) * 100 * 0.6).toFixed(1)
      : 15;
  const lynchOverrides = resolveLynchDcfOverrides({
    lynchClass,
    sectorG1: sp.growthAssumptions.g1 || 0,
    ebitMarginPhase1: ebitMarginPhase1ForLynch,
  });

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

  // Sektor-Basis (bisheriges Verhalten, unveraendert als Fallback wenn keine Lynch-Klasse vorliegt):
  const sectorRevenueGrowthP1 = revenueGrowthDefault;
  const sectorRevenueGrowthP2 = Math.max(3, +(revenueGrowthDefault * 0.6).toFixed(1));
  const sectorEbitMarginTerminal = +Math.max(8, ebitMarginDefault * 0.9).toFixed(1);
  const sectorFcfHaircut = data.fcfHaircut;
  const sectorTerminalG = sp.growthAssumptions.terminal || 2.5;

  return {
    revenueBase: data.revenue,
    revenueGrowthP1: lynchOverrides ? lynchOverrides.revenueGrowthP1 : sectorRevenueGrowthP1,
    revenueGrowthP2: lynchOverrides ? lynchOverrides.revenueGrowthP2 : sectorRevenueGrowthP2,
    ebitMargin: ebitMarginDefault,
    ebitMarginTerminal: lynchOverrides ? lynchOverrides.ebitMarginTerminal : sectorEbitMarginTerminal,
    capexPct: capexDefault,
    deltaWCPct: 5,
    taxRate: taxR,
    daRatio: +Math.max(2, capexDefault * 0.8).toFixed(1),
    riskFreeRate: rf,
    beta: dcfBeta,
    erp,
    debtRatio: debtRatioVal,
    costOfDebt: rd,
    terminalG: lynchOverrides ? lynchOverrides.terminalG : sectorTerminalG,
    sharesOutstanding: data.sharesOutstanding,
    netDebt,
    minorityInterests: 0,
    // fcfHaircut bleibt primaer data.fcfHaircut (Governance-/Policy-Haircut, separat vom Lynch-
    // Modell-Haircut) — nur wenn KEIN expliziter Haircut auf der Analyse gesetzt ist (0/undefined),
    // greift der Lynch-Klassen-Default als sinnvoller Startwert.
    fcfHaircut: sectorFcfHaircut || (lynchOverrides ? lynchOverrides.fcfHaircut : sectorFcfHaircut),
    actualEPS: data.epsTTM,
    forwardEPS: data.epsConsensusNextFY,
    waccOverride: null,
    rsl,
    // Sprint D1 — additive Felder (siehe FCFFDCFParams-Kommentar):
    lynchClass: lynchClass ?? undefined,
    waccFloorAddon: lynchOverrides ? lynchOverrides.waccFloorAddon : 0,
    applyRslMalus: lynchOverrides ? lynchOverrides.applyRslMalus : true,
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
  // === Sprint D1 additions (WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md §1/§2) — additiv, optional. ===
  // Welche Lynch-Klasse diesen Default-Satz erzeugt hat (nur Transparenz/UI-Hinweis,
  // fliesst NICHT in die Zahlen-Berechnung von calculateFCFFDCF ein).
  lynchClass?: string;
  // Ob der RSL-Momentum-Malus fuer diese Lynch-Klasse ueberhaupt greifen darf.
  // undefined/true = bisheriges Verhalten (Malus greift bei RSL < 105) — bestehende
  // Aufrufer ohne dieses Feld sind dadurch 100% unveraendert (Rueckwaertskompatibel).
  applyRslMalus?: boolean;
  // Lynch-Klassen-WACC-Floor-Addon (%-Punkte), wird auf den bestehenden WACC_FLOOR
  // addiert (siehe calculateFCFFDCF). 0/undefined = bisheriges Verhalten.
  waccFloorAddon?: number;
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

  // Sprint D1 §1.3: Lynch-Klassen-WACC-Floor-Addon (cyclical +0.5, turnaround +1.0) wird auf
  // den bestehenden Sanity-Floor addiert — wirkt NUR wenn kein manueller waccOverride aktiv ist
  // (User-Override hat weiterhin absolute Prioritaet, siehe Ticket-Regel).
  const effectiveWaccFloor = WACC_FLOOR + Math.max(0, params.waccFloorAddon ?? 0);

  if (useOverride) {
    wacc = params.waccOverride!;
  } else {
    wacc = Math.max(effectiveWaccFloor, Math.min(WACC_CEIL, rawWacc));
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
      steps.push(`⚠ WACC-Sanity-Cap: ${rawWacc.toFixed(2)}% → ${wacc.toFixed(2)}% (Bounds: ${effectiveWaccFloor.toFixed(2)}%-${WACC_CEIL}%)`);
      if (params.waccFloorAddon && params.waccFloorAddon > 0) {
        steps.push(`  Floor inkl. Lynch-Klassen-Addon: ${WACC_FLOOR}% + ${params.waccFloorAddon.toFixed(1)}pp = ${effectiveWaccFloor.toFixed(2)}%`);
      }
      steps.push(`  Grund: CAPM liefert Wert außerhalb des plausiblen Bereichs.`);
    }
  }
  steps.push(`WACC (final) = ${wacc.toFixed(2)}%`);

  // RSL-Momentum-Malus (Section 9): RSL < 105 → Wachstumsraten automatisch reduzieren.
  // Macht die in Section 9 behauptete "Automatische Anpassung" tatsächlich wirksam,
  // statt sie nur als Text anzuzeigen.
  // Sprint D1 §2: applyRslMalus steuert klassenabhängig, OB der Malus überhaupt greifen darf
  // (undefined/true = altes Verhalten, false = slow_grower/asset_play — kein Malus).
  const rslMalusAllowed = params.applyRslMalus !== false;
  const rslActive = rslMalusAllowed && params.rsl != null && params.rsl > 0 && params.rsl < 105;
  const rslFactor = rslActive ? 1 - RSL_MOMENTUM_MALUS_PCT / 100 : 1;
  const adjGrowthP1 = params.revenueGrowthP1 * rslFactor;
  const adjGrowthP2 = params.revenueGrowthP2 * rslFactor;

  if (rslActive) {
    steps.push(``);
    steps.push(`⚠ RSL-Momentum-Malus aktiv: RSL = ${params.rsl!.toFixed(1)} < 105 (schwaches Momentum)`);
    steps.push(`  Wachstumsraten × (1 - ${RSL_MOMENTUM_MALUS_PCT}%) = × ${rslFactor.toFixed(3)}`);
    steps.push(`  g1: ${params.revenueGrowthP1.toFixed(1)}% → ${adjGrowthP1.toFixed(2)}% | g2: ${params.revenueGrowthP2.toFixed(1)}% → ${adjGrowthP2.toFixed(2)}%`);
  } else if (!rslMalusAllowed && params.rsl != null && params.rsl > 0 && params.rsl < 105) {
    // Sprint D1 §2: Malus waere nach altem (klassen-agnostischem) Regelwerk aktiv gewesen,
    // wird aber fuer diese Lynch-Klasse (slow_grower/asset_play) bewusst deaktiviert.
    steps.push(``);
    steps.push(`ℹ RSL-Momentum-Malus deaktiviert: RSL = ${params.rsl!.toFixed(1)} < 105, aber Lynch-Klasse${params.lynchClass ? ` "${params.lynchClass}"` : ""} schliesst den Malus aus (siehe Section 9).`);
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
// M1 Formula: effectiveDrawdown = min(max(0.70, beta) × sectorDD, sectorDD × 1.5), capped at 65%
// UI label must match: "min(max(0.70, β) × SectorDD, SectorDD×1.5), cap 65%"
export function worstCaseM1(price: number, beta: number, maxDrawdown: number): number {
  const historicalMaxDrawdown = maxDrawdown > 0 ? maxDrawdown : 35;
  // Beta-Floor 0.70: verhindert, dass sehr niedriges Beta den Drawdown unbegrenzt nach unten glättet.
  // Der bestehende Cap nach oben (DD × 1.5, dann 65%) bleibt unverändert.
  const effectiveBeta = Math.max(0.70, beta);
  const betaAdjustedDrawdown = Math.min(effectiveBeta * historicalMaxDrawdown, historicalMaxDrawdown * 1.5);
  const effectiveDrawdown = Math.min(betaAdjustedDrawdown, 65);
  return price * (1 - effectiveDrawdown / 100);
}

// Exported label for UI — keeps formula display in sync with implementation (Bug #2 fix)
export function worstCaseM1Label(beta: number, sectorDD: number): string {
  const effectiveBeta = Math.max(0.70, beta);
  const raw = +(effectiveBeta * sectorDD).toFixed(1);
  const capped = Math.min(raw, sectorDD * 1.5);
  const effective = Math.min(capped, 65);
  const isCapped = effective < raw;
  const betaFloorNote = effectiveBeta > beta ? ` (β-Floor 0.70 statt ${beta.toFixed(2)})` : "";
  return isCapped
    ? `β(${effectiveBeta.toFixed(2)})${betaFloorNote} × ${sectorDD}% = ${raw}% → gecapped auf ${effective.toFixed(1)}%`
    : `β(${effectiveBeta.toFixed(2)})${betaFloorNote} × ${sectorDD}% = ${effective.toFixed(1)}%`;
}

export function worstCaseM2(price: number, riskImpact: number): number {
  return price * (1 - riskImpact / 100);
}

// Klassifikations-Basis-Drawdowns: additive Erweiterung von M3; sectorMaxDrawdown
// selbst bleibt unverändert sektorspezifisch. slow_grower liegt konservativ zwischen
// Stalwart und Asset Play, da hierfür kein separater Nutzerwert vorgegeben wurde.
export const LYNCH_CLASS_BASE_DRAWDOWN: Record<string, number> = {
  fast_grower: 45,
  stalwart: 32,
  slow_grower: 28,
  cyclical: 55,
  turnaround: 60,
  asset_play: 30,
};

// Der optionale dritte Parameter erhält das bisherige Verhalten für bestehende Aufrufer:
// Ohne bekannte Lynch-Klassifikation gilt unverändert ausschließlich der Sektor-Drawdown.
export function worstCaseM3(price: number, sectorDrawdown: number, lynchClass?: string | null): number {
  const classBase = lynchClass ? LYNCH_CLASS_BASE_DRAWDOWN[lynchClass] : undefined;
  const basisDrawdown = classBase != null
    ? 0.55 * classBase + 0.45 * sectorDrawdown
    : sectorDrawdown;
  return price * (1 - basisDrawdown / 100);
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
// ============================================================================
// === CRV-Härtung gegen DCF-Extrapolation (Auftrag 09.08.2026, "NVO-Muster") ===
// ============================================================================
// Root-Problem (live an NVO beobachtet): CRV = (FV - WC) / (Preis - WC) ist
// mathematisch korrekt, wird aber optisch sehr attraktiv, wenn FV durch
// niedrigen WACC + hohen Terminal-Value-Anteil + fortgeschriebene hohe Margen
// extrapoliert wird, UND der Worst Case wegen niedrigem Beta zu milde ausfällt.
// Diese Sektion haertet die Kette generisch (Teil A-F), OHNE Ticker-Hardcodes:
// jeder Low-Beta/High-TV/High-Margin-Titel wird gleich behandelt.

// --- Teil A: Sektor-adaptiver WACC-Floor ---
// Startwerte konfigurierbar, keine Ticker-Liste — nur Sektor-Substring-Mapping,
// analog zum bestehenden mapGrowthProfile()-Muster im Thesis-Score.
export interface WaccFloorResult {
  waccFloorPct: number;
  sectorMatched: string;
}
export function computeSectorWaccFloor(sector?: string | null, industry?: string | null): WaccFloorResult {
  const text = `${(sector || "").toLowerCase()} ${(industry || "").toLowerCase()}`;
  if (/pharma|drug manufacturer|biotechnology|healthcare/.test(text)) {
    return { waccFloorPct: 7.5, sectorMatched: "Healthcare/Pharma" };
  }
  if (/software|semiconductor|internet|information technology|technology/.test(text)) {
    return { waccFloorPct: 7.0, sectorMatched: "Software/Quality Growth" };
  }
  if (/consumer cyclical|apparel|footwear|retail/.test(text)) {
    return { waccFloorPct: 8.0, sectorMatched: "Consumer Cyclical" };
  }
  return { waccFloorPct: 7.0, sectorMatched: "Default" };
}

/**
 * WACC_used = max(WACC_model, WACC_sektor_ref, WACC_sektor_floor).
 * WACC_sektor_ref ist hier bewusst gleich dem Floor (keine separate Referenz-
 * Datenquelle verdrahtet) — der Floor selbst wirkt als Sektor-Referenz.
 */
export function applyWaccFloor(waccModelPct: number, sector?: string | null, industry?: string | null): {
  waccUsed: number; waccFloorPct: number; waccFloorApplied: boolean; sectorMatched: string;
} {
  const { waccFloorPct, sectorMatched } = computeSectorWaccFloor(sector, industry);
  const waccUsed = Math.max(waccModelPct, waccFloorPct);
  return { waccUsed, waccFloorPct, waccFloorApplied: waccUsed > waccModelPct + 1e-9, sectorMatched };
}

// --- Teil B: Terminal-Value-Guard ---
// TV/EV > 70% -> Flag + optionaler Haircut auf den FV, der in die CRV einfliesst.
// haircut = min(0.25, (TV/EV - 0.70) * 0.5) -- Ticket-Formel woertlich.
export interface TvGuardResult {
  tvOverEv: number;
  highTvFlag: boolean;
  haircutPct: number;
  fvAfterHaircut: number;
}
export function applyTerminalValueGuard(fairValue: number, pvTerminal: number, enterpriseValue: number): TvGuardResult {
  const tvOverEv = enterpriseValue > 0 ? pvTerminal / enterpriseValue : 0;
  const highTvFlag = tvOverEv > 0.70;
  const haircutPct = highTvFlag ? Math.min(0.25, (tvOverEv - 0.70) * 0.5) : 0;
  const fvAfterHaircut = fairValue * (1 - haircutPct);
  return { tvOverEv, highTvFlag, haircutPct, fvAfterHaircut };
}

// --- Teil C: datengetriebener Margen-Stress ---
// margin_stress_pp = max(2.0, 0.5*|min(0,marginDeltaYoYPp)|, govExposure>=20% ? 3.0 : 0)
export interface MarginStressResult {
  marginStressPp: number;
  ebitMarginStressed: number;
}
export function computeMarginStress(
  ebitMarginPct: number,
  marginDeltaYoYPp: number | null,
  govExposurePct: number | null,
): MarginStressResult {
  const fromYoyShock = marginDeltaYoYPp != null ? 0.5 * Math.abs(Math.min(0, marginDeltaYoYPp)) : 0;
  const fromGovExposure = (govExposurePct != null && govExposurePct >= 20) ? 3.0 : 0;
  const marginStressPp = Math.max(2.0, fromYoyShock, fromGovExposure);
  return { marginStressPp, ebitMarginStressed: ebitMarginPct - marginStressPp };
}

// --- Teil D: struktureller Worst-Case-Floor (nicht nur Beta) ---
// Verhindert, dass WC bei Low-Beta-Titeln trotz struktureller Risiken (Policy,
// Patent-Cliff-Exposure via govExposure, FCF-Margen-Schock, schwacher Moat +
// hohe DCF-Upside) zu milde "kleben" bleibt.
export interface StructuralFloorResult {
  structuralFloorPct: number;
  reasons: string[];
}
export function computeStructuralWorstCaseFloor(opts: {
  govExposurePct: number | null;
  fcfMarginYoYPp: number | null;
  moatRating?: string | null;
  dcfUpsidePct?: number | null;
}): StructuralFloorResult {
  const reasons: string[] = [];
  let floor = 0; // 0 = kein zusaetzlicher struktureller Floor (Ticket-Skala: Prozent-Drawdown)
  if (opts.govExposurePct != null && opts.govExposurePct >= 25) {
    floor = Math.max(floor, 35);
    reasons.push(`govExposure ${opts.govExposurePct.toFixed(0)}% >= 25% -> mind. 35% Drawdown-Floor`);
  }
  if (opts.fcfMarginYoYPp != null && opts.fcfMarginYoYPp <= -10) {
    floor = Math.max(floor, 30);
    reasons.push(`FCF-Marge YoY ${opts.fcfMarginYoYPp.toFixed(1)}pp <= -10pp -> zusaetzlicher Abschlag (mind. 30%)`);
  }
  const moatWeakOrNone = opts.moatRating != null && /schwach|none|kein/i.test(opts.moatRating);
  if (moatWeakOrNone && opts.dcfUpsidePct != null && opts.dcfUpsidePct > 50) {
    floor = Math.max(floor, 35);
    reasons.push(`Moat schwach/none + DCF-Upside ${opts.dcfUpsidePct.toFixed(0)}% > 50% -> tieferer Floor (mind. 35%)`);
  }
  return { structuralFloorPct: floor, reasons };
}

/** WC = min(beta-adjusted drawdown, sector drawdown, structural_floor). structuralFloorPct=0 bedeutet "kein Effekt" (min() ignoriert es dann nicht -- 0% Drawdown wuerde WC=Preis erzwingen, daher wird 0 explizit ausgeschlossen). */
export function worstCaseStructural(price: number, betaAdjDrawdownPct: number, sectorDrawdownPct: number, structuralFloorPct: number): number {
  const candidates = [betaAdjDrawdownPct, sectorDrawdownPct];
  if (structuralFloorPct > 0) candidates.push(structuralFloorPct);
  const effectiveDrawdown = Math.max(...candidates); // strukturell tieferer WC = HÖHERER Drawdown-Prozentsatz
  return price * (1 - effectiveDrawdown / 100);
}

// --- Teil E: Divergenz-Flag DCF vs. Markt ---
export interface DivergenceFlagResult {
  divergenceFlag: boolean;
  dcfUpsidePct: number;
  analystUpsidePct: number;
}
export function computeDcfVsMarketDivergence(conservativeDCFPerShare: number, analystPTMedian: number, currentPrice: number): DivergenceFlagResult {
  const dcfUpsidePct = currentPrice > 0 ? ((conservativeDCFPerShare - currentPrice) / currentPrice) * 100 : 0;
  const analystUpsidePct = currentPrice > 0 ? ((analystPTMedian - currentPrice) / currentPrice) * 100 : 0;
  const divergenceFlag = dcfUpsidePct > 80 && analystUpsidePct < 15;
  return { divergenceFlag, dcfUpsidePct, analystUpsidePct };
}

// --- Teil F: gehärtete CRV-Kette (ein Aufruf, alle Bausteine kombiniert) ---
export interface HardenedCRVInput {
  price: number;
  conservativeDCF: { perShare: number; wacc: number; enterpriseValue: number; pvTerminal: number };
  sector?: string | null;
  industry?: string | null;
  ebitMarginPct: number;
  marginDeltaYoYPp: number | null;
  fcfMarginYoYPp: number | null;
  govExposurePct: number | null;
  moatRating?: string | null;
  betaAdjDrawdownPct: number;
  sectorDrawdownPct: number;
  analystPTMedian: number;
}
export interface HardenedCRVResult {
  crvRaw: number;
  crvHardened: number;
  crvStress: number;
  fvRaw: number;
  fvHardened: number;
  fvStress: number;
  wcUsed: number;
  waccModel: number;
  waccFloor: number;
  waccUsed: number;
  waccFloorApplied: boolean;
  tvOverEv: number;
  highTvFlag: boolean;
  tvHaircutPct: number;
  marginStressPp: number;
  structuralFloorPct: number;
  structuralReasons: string[];
  divergenceFlag: boolean;
  dcfUpsidePct: number;
  analystUpsidePct: number;
  flags: string[];
}
/**
 * Kombiniert A-E zu einer gehärteten CRV-Kette. Nimmt bereits berechnete
 * conservativeDCF-Werte entgegen (kein Re-Run der vollen FCFF-Projektion
 * hier) -- der WACC-Floor-Effekt wird approximativ über eine WACC-Delta-
 * Diskontierung auf den bereits berechneten Fair Value angewendet, um keinen
 * zweiten vollen DCF-Durchlauf mit anderem WACC in der UI-Schicht zu
 * erzwingen. Für eine exakte Neu-Discountierung kann der Aufrufer optional
 * calculateFCFFDCF() erneut mit waccOverride=waccUsed aufrufen (siehe Section6-
 * Integration) -- diese Funktion bleibt die reine, testbare Kernlogik.
 */
export function computeHardenedCRV(input: HardenedCRVInput): HardenedCRVResult {
  const flags: string[] = [];

  // A) WACC-Floor
  const { waccUsed, waccFloorPct, waccFloorApplied, sectorMatched } = applyWaccFloor(input.conservativeDCF.wacc, input.sector, input.industry);
  if (waccFloorApplied) flags.push(`WACC-Floor aktiv (${sectorMatched}): ${input.conservativeDCF.wacc.toFixed(2)}% -> ${waccUsed.toFixed(2)}%`);

  // Approximation: WACC-Delta wirkt auf den Fair Value über eine vereinfachte
  // Duration-Näherung (10J expliziter Horizont + Perpetuity) -- der Aufrufer
  // sollte für die exakte Zahl calculateFCFFDCF() mit waccOverride erneut
  // aufrufen; hier wird ein konservativer Korrekturfaktor angewendet, der bei
  // gleichem WACC (kein Floor-Effekt) exakt 1.0 ergibt (keine Verzerrung).
  const waccDeltaBp = (waccUsed - input.conservativeDCF.wacc) * 100;
  const waccCorrectionFactor = waccDeltaBp > 0 ? Math.pow(1 + input.conservativeDCF.wacc / 100, 10) / Math.pow(1 + waccUsed / 100, 10) : 1;
  const fvAfterWaccFloor = input.conservativeDCF.perShare * waccCorrectionFactor;

  // B) Terminal-Value-Guard
  const tvGuard = applyTerminalValueGuard(fvAfterWaccFloor, input.conservativeDCF.pvTerminal, input.conservativeDCF.enterpriseValue);
  if (tvGuard.highTvFlag) flags.push(`High-TV-Extrapolation: TV/EV=${(tvGuard.tvOverEv * 100).toFixed(0)}% -> Haircut ${(tvGuard.haircutPct * 100).toFixed(1)}%`);

  // C) Margin-Stress -> CRV_stress (separater Pfad, beeinflusst NICHT fvHardened)
  const marginStress = computeMarginStress(input.ebitMarginPct, input.marginDeltaYoYPp, input.govExposurePct);
  // Stress wirkt proportional auf den Fair Value (Marge ist der dominante FCFF-Treiber
  // in der vereinfachten Näherung: ΔFV/FV ≈ ΔMarge/Marge, da FCFF ≈ Revenue × Marge × (1-t)).
  const marginStressFactor = input.ebitMarginPct > 0 ? Math.max(0, (input.ebitMarginPct - marginStress.marginStressPp) / input.ebitMarginPct) : 1;
  const fvStress = tvGuard.fvAfterHaircut * marginStressFactor;
  if (marginStress.marginStressPp > 2.0) flags.push(`Margin-Stress: -${marginStress.marginStressPp.toFixed(1)}pp (YoY-Schock/govExposure-getrieben)`);

  // D) Struktureller Worst Case
  const structural = computeStructuralWorstCaseFloor({
    govExposurePct: input.govExposurePct,
    fcfMarginYoYPp: input.fcfMarginYoYPp,
    moatRating: input.moatRating,
    dcfUpsidePct: input.price > 0 ? ((input.conservativeDCF.perShare - input.price) / input.price) * 100 : null,
  });
  const wcUsed = worstCaseStructural(input.price, input.betaAdjDrawdownPct, input.sectorDrawdownPct, structural.structuralFloorPct);
  if (structural.structuralFloorPct > 0) flags.push(...structural.reasons.map((r: string) => `Structural-WC: ${r}`));

  // E) Divergenz-Flag (misst gegen den urspruenglichen, ungehärteten DCF -- so
  // wie im Ticket beschrieben: "Base-CRV weiter zeigen", Divergenz bezieht sich
  // auf den rohen DCF-Upside vs. Analyst-Upside)
  const divergence = computeDcfVsMarketDivergence(input.conservativeDCF.perShare, input.analystPTMedian, input.price);
  if (divergence.divergenceFlag) flags.push(`DCF_vs_Markt_Divergenz: DCF-Upside ${divergence.dcfUpsidePct.toFixed(0)}% vs. Analyst-Upside ${divergence.analystUpsidePct.toFixed(0)}%`);

  // F) finale CRV-Kette
  const crvRaw = calculateCRV(input.conservativeDCF.perShare, input.betaAdjDrawdownPct > 0 ? input.price * (1 - Math.min(input.betaAdjDrawdownPct, input.sectorDrawdownPct) / 100) : input.price, input.price);
  const crvHardened = calculateCRV(tvGuard.fvAfterHaircut, wcUsed, input.price);
  const crvStress = calculateCRV(fvStress, wcUsed, input.price);

  return {
    crvRaw, crvHardened, crvStress,
    fvRaw: input.conservativeDCF.perShare,
    fvHardened: tvGuard.fvAfterHaircut,
    fvStress,
    wcUsed,
    waccModel: input.conservativeDCF.wacc,
    waccFloor: waccFloorPct,
    waccUsed,
    waccFloorApplied,
    tvOverEv: tvGuard.tvOverEv,
    highTvFlag: tvGuard.highTvFlag,
    tvHaircutPct: tvGuard.haircutPct,
    marginStressPp: marginStress.marginStressPp,
    structuralFloorPct: structural.structuralFloorPct,
    structuralReasons: structural.reasons,
    divergenceFlag: divergence.divergenceFlag,
    dcfUpsidePct: divergence.dcfUpsidePct,
    analystUpsidePct: divergence.analystUpsidePct,
    flags,
  };
}

// ============================================================================
// === §3.3 Klassensperre: dcfApplicable() (additiv, WORK_SIGNAL_BACKTEST.md) ===
// ============================================================================
// "Invertierter DCF ist KEINE Universalgleichung":
//   dcfApplicable = FCF_T > 0 AND sector NOT IN {Banks, Insurance,
//                    Capital Markets als Bank-Proxy} AND profile erlaubt FCF-DCF
// Reiner String-Match auf Sektor/Industry — keine Ticker-Namen, adaptiv fuer
// jeden Ticker mit passendem Sektor/Industry-String. Identische Logik wie die
// bisherige server/backtest/replay.ts:computeDcfApplicable() (Phase 0/1) — hier
// als Shared-Funktion konsolidiert, damit Client und Server dieselbe Klassen-
// sperre auswerten koennen, falls der Client sie je selbst benoetigt.
export interface DcfApplicableParams {
  fcfTTM: number | null | undefined;
  sector: string | undefined | null;
  industry: string | undefined | null;
}

function isBankProxySector(sector: string | undefined | null, industry: string | undefined | null): boolean {
  const hay = `${sector ?? ""} ${industry ?? ""}`.toLowerCase();
  return (
    hay.includes("bank") ||
    hay.includes("insurance") ||
    hay.includes("capital markets")
  );
}

/**
 * §3.3 dcfApplicable = FCF_T > 0 AND sector NOT IN {Banks, Insurance,
 * Capital Markets-als-Bank-Proxy} AND profile erlaubt FCF-DCF.
 * "profile erlaubt FCF-DCF" ist in diesem Repo nicht als eigenes Flag
 * spezifiziert (kein Profil verbietet FCF-DCF explizit in thesis-strength.ts)
 * — daher wird dieser dritte Faktor konservativ als "true, solange kein
 * Bank/Insurance-Sektor" behandelt (keine Erfindung einer neuen Profilregel).
 * Identisch zu server/backtest/replay.ts:computeDcfApplicable() — diese
 * Funktion hier ist die kanonische, geteilte Implementierung.
 */
export function dcfApplicable(params: DcfApplicableParams): boolean {
  const fcfPositive = typeof params.fcfTTM === "number" && isFinite(params.fcfTTM) && params.fcfTTM > 0;
  const bankProxy = isBankProxySector(params.sector, params.industry);
  return fcfPositive && !bankProxy;
}

// ============================================================================
// === §9 Signalregel: signalV1() (additiv, WORK_SIGNAL_BACKTEST.md §9) ===
// ============================================================================
// Identische Regel wie server/backtest/signal.ts:deriveSignalV1() (Phase 0).
// Diese Funktion hier ist die kanonische, geteilte Implementierung — signal.ts
// ist ab jetzt ein duenner Re-Export-Wrapper darum (kein zweites Regel-Set,
// siehe dortiger Datei-Kommentar zur Abgrenzung von der Live-Fazit-Logik in
// SummarySection.tsx, die weiterhin unveraendert bestehen bleibt).
export type SignalV1Result = "Buy" | "Accumulate" | "Hold" | "Reduce" | "Avoid" | null;

export interface SignalV1Input {
  dataComplete: { overall: boolean };
  dcfApplicable: boolean;
  /** Reverse-DCF-Fair-Value als Preis (nicht g*). null, wenn nicht berechenbar. */
  invDcf: number | null;
  price: number;
  /** true, wenn die Fiscal-Megatrend-Ausnahme qualifiziert UND materiell ist. */
  fiscalQualifies: boolean;
  /** cappedBy-Gate-ID (z.B. "PRICING_POWER"), falls der Score gedeckelt wurde. */
  cappedBy: string | null;
  /** severity des cappedBy-Gates ("warn" | "hard"), falls cappedBy gesetzt ist. */
  cappedBySeverity: "warn" | "hard" | null;
  /** Chance-Risiko-Verhaeltnis (calculateCRV()-Ergebnis). null, wenn nicht
   *  berechenbar. */
  crv: number | null;
}

/** Gate-IDs, die laut §9 Zeile 4 ein Buy verhindern, wenn severity=hard. */
export const NO_BUY_HARD_GATES: ReadonlySet<string> = new Set([
  "PRICING_POWER",
  "RELATIVE_GROWTH",
]);

/** CRV-Schwellen aus §9 (>=2.5 attraktiv, 2.0-2.5 neutral, <2 Warnung, <1.5 Avoid). */
export const SIGNAL_V1_CRV_THRESHOLDS = {
  AVOID_BELOW: 1.5,
  HOLD_BELOW: 2.0,
  ACCUMULATE_BELOW: 2.5,
} as const;

/**
 * signalV1() — reine Funktion, keine Seiteneffekte, kein I/O. Implementiert
 * §9 Zeile fuer Zeile, in genau der dort vorgegebenen Reihenfolge (fruehe
 * Returns = strengere Regel gewinnt):
 *
 *   if !dataComplete:           kein Signal
 *   if !dcfApplicable:          max Hold
 *   if invDcf != null && invDcf < price && kein Fiscal-Qualify:
 *                               Avoid  (oder Reduce, aber nicht Buy)
 *   if cappedBy in {PRICING_POWER, RELATIVE_GROWTH} und severity=hard:
 *                               kein Buy
 *   if CRV < 1.5:               Avoid
 *   if CRV < 2.0:               Hold
 *   if CRV < 2.5:               Accumulate
 *   else:                       Buy
 */
export function signalV1(input: SignalV1Input): SignalV1Result {
  if (!input.dataComplete.overall) return null;

  const dcfCapsToHold = !input.dcfApplicable;

  if (
    input.invDcf != null &&
    input.invDcf < input.price &&
    !input.fiscalQualifies
  ) {
    return "Avoid";
  }

  const noBuyHardGate =
    input.cappedBy != null &&
    NO_BUY_HARD_GATES.has(input.cappedBy) &&
    input.cappedBySeverity === "hard";

  if (input.crv == null) return null;

  let signal: SignalV1Result;
  if (input.crv < SIGNAL_V1_CRV_THRESHOLDS.AVOID_BELOW) {
    signal = "Avoid";
  } else if (input.crv < SIGNAL_V1_CRV_THRESHOLDS.HOLD_BELOW) {
    signal = "Hold";
  } else if (input.crv < SIGNAL_V1_CRV_THRESHOLDS.ACCUMULATE_BELOW) {
    signal = "Accumulate";
  } else {
    signal = "Buy";
  }

  if (signal === "Buy" && noBuyHardGate) {
    signal = "Accumulate";
  }

  if (dcfCapsToHold && (signal === "Buy" || signal === "Accumulate")) {
    signal = "Hold";
  }

  return signal;
}
