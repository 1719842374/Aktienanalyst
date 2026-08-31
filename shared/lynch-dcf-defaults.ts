/**
 * shared/lynch-dcf-defaults.ts — Sprint D1 (WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md §1.3/1.4;
 * Ticket: tickets/SPRINT_D1_LYNCH_DCF_DEFAULTS.md).
 *
 * Single Source of Truth für die Lynch-Klassen-DCF-Default-Tabelle. Liegt bewusst in
 * `shared/`, direkt neben `LYNCH_CLASS_BASE_DRAWDOWN` (shared/valuation-signal.ts) —
 * beide Tabellen sind vom selben `LynchClass`-Typ (server/catalyst-engine.ts) abhängig
 * und werden von Client UND Server konsumiert (buildDefaultDCFParams in
 * shared/valuation-signal.ts, UI-Transparenzhinweis in Section5/ReverseDCFSection).
 *
 * WICHTIG (stock-analyst-regression-guard):
 *  - Kein Ticker-Hardcode.
 *  - Werte sind exakt aus der Spec-Tabelle übernommen (§1.3), keine Interpretation.
 *  - Diese Datei definiert NUR Daten + reine Helper — keine Seiteneffekte.
 *  - `classifyLynch` (server/catalyst-engine.ts) und `RSL_MOMENTUM_MALUS_PCT`
 *    (shared/valuation-signal.ts) bleiben unverändert; hier wird nur konsumiert.
 */
import type { LynchClass } from "../server/catalyst-engine";

export interface LynchDcfOverrides {
  revenueGrowthP1: number;
  revenueGrowthP2: number;
  terminalG: number;
  ebitMarginTerminalDeltaPp: number; // relativ zur aktuellen (Phase-1) EBIT-Marge
  fcfHaircut: number;
  waccFloorAddon: number;            // wird auf bestehenden WACC-Floor addiert
  applyRslMalus: boolean;
}

// Spec §1.3/1.4 — exakte Startwerte, Single Source of Truth für die Automatisierung.
export const LYNCH_DCF_DEFAULTS: Record<LynchClass, LynchDcfOverrides> = {
  fast_grower: {
    revenueGrowthP1: 20.0,
    revenueGrowthP2: 12.0,
    terminalG: 3.0,
    ebitMarginTerminalDeltaPp: 1.5,
    fcfHaircut: 5,
    waccFloorAddon: 0.0,
    applyRslMalus: true,
  },
  stalwart: {
    revenueGrowthP1: 9.0,
    revenueGrowthP2: 6.0,
    terminalG: 2.5,
    ebitMarginTerminalDeltaPp: 0.0,
    fcfHaircut: 3,
    waccFloorAddon: 0.0,
    applyRslMalus: true,
  },
  slow_grower: {
    revenueGrowthP1: 4.0,
    revenueGrowthP2: 3.0,
    terminalG: 2.0,
    ebitMarginTerminalDeltaPp: -0.5,
    fcfHaircut: 2,
    waccFloorAddon: 0.0,
    applyRslMalus: false,
  },
  cyclical: {
    revenueGrowthP1: 6.0, // Placeholder – Mid-Cycle-Normalisierung siehe applyCyclicalMidCycleG1()
    revenueGrowthP2: 4.0,
    terminalG: 2.0,
    ebitMarginTerminalDeltaPp: 0.0,
    fcfHaircut: 8,
    waccFloorAddon: 0.5,
    applyRslMalus: true,
  },
  turnaround: {
    revenueGrowthP1: 5.0,
    revenueGrowthP2: 4.0,
    terminalG: 2.0,
    ebitMarginTerminalDeltaPp: 2.0,
    fcfHaircut: 12,
    waccFloorAddon: 1.0,
    applyRslMalus: true,
  },
  asset_play: {
    revenueGrowthP1: 3.0,
    revenueGrowthP2: 2.5,
    terminalG: 2.0,
    ebitMarginTerminalDeltaPp: 0.0,
    fcfHaircut: 5,
    waccFloorAddon: 0.0,
    applyRslMalus: false,
  },
};

// Spec §1.5 "fast_grower": g1 darf nicht unter max(sectorG1, 15) fallen.
export const FAST_GROWER_G1_FLOOR = 15;
// Spec §1.5 "fast_grower": Terminal Growth Hard Cap 3.5%.
export const FAST_GROWER_TERMINAL_G_CAP = 3.5;
// Spec §1.5 "slow_grower": Terminal Growth hart auf ≤ 2.0% begrenzt.
export const SLOW_GROWER_TERMINAL_G_CAP = 2.0;

/**
 * Spec §1.5 "cyclical": Mid-Cycle-Normalisierung, solange keine volle Peak-Trough-
 * Historie vorliegt (Placeholder-Logik, siehe Spec §7 — spätere Erweiterung mit
 * echten Peak/Trough-EPS-Daten ist explizit "später").
 * g1 = min(0.6 × sectorG1, 6%) — konservativer der beiden Werte.
 */
export function applyCyclicalMidCycleG1(sectorG1: number): number {
  return Math.min(0.6 * sectorG1, 6);
}

/**
 * Spec §1.4 Schritt 3: Lynch-Overrides mit Sonderregeln (§1.5) auf eine Basis
 * (Sektor-Defaults) anwenden. Reine Funktion — keine Seiteneffekte, kein State.
 * Rückgabe enthält NUR die Felder, die buildDefaultDCFParams() überschreiben soll.
 */
export function resolveLynchDcfOverrides(params: {
  lynchClass: LynchClass | null | undefined;
  sectorG1: number;
  ebitMarginPhase1: number;
}): {
  revenueGrowthP1: number;
  revenueGrowthP2: number;
  terminalG: number;
  ebitMarginTerminal: number;
  fcfHaircut: number;
  waccFloorAddon: number;
  applyRslMalus: boolean;
} | null {
  const { lynchClass, sectorG1, ebitMarginPhase1 } = params;
  if (!lynchClass || !(lynchClass in LYNCH_DCF_DEFAULTS)) return null;

  const base = LYNCH_DCF_DEFAULTS[lynchClass];

  let revenueGrowthP1 = base.revenueGrowthP1;
  let terminalG = base.terminalG;

  if (lynchClass === "cyclical") {
    // §1.5: konservative Mid-Cycle-Normalisierung als Placeholder (keine Peak/Trough-Historie verdrahtet).
    revenueGrowthP1 = applyCyclicalMidCycleG1(sectorG1 || base.revenueGrowthP1);
  }

  if (lynchClass === "fast_grower") {
    // §1.5: Floor gegen zu konservative Sektor-Defaults.
    revenueGrowthP1 = Math.max(sectorG1 || 0, FAST_GROWER_G1_FLOOR);
    terminalG = Math.min(terminalG, FAST_GROWER_TERMINAL_G_CAP);
  }

  if (lynchClass === "slow_grower") {
    // §1.5: Terminal Growth hart begrenzt.
    terminalG = Math.min(terminalG, SLOW_GROWER_TERMINAL_G_CAP);
  }

  return {
    revenueGrowthP1,
    revenueGrowthP2: base.revenueGrowthP2,
    terminalG,
    ebitMarginTerminal: +(ebitMarginPhase1 + base.ebitMarginTerminalDeltaPp).toFixed(1),
    fcfHaircut: base.fcfHaircut,
    waccFloorAddon: base.waccFloorAddon,
    applyRslMalus: base.applyRslMalus,
  };
}
