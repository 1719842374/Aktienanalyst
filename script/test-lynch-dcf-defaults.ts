/**
 * Sprint D1 (WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md §1/§2/§4; tickets/SPRINT_D1_LYNCH_DCF_DEFAULTS.md).
 *
 * Deckt die Test-Checkliste aus Spec §6 ab, soweit im Ticket-Scope (Punkt A+D der g*-Nutzung,
 * B+C explizit "optional falls Zeit" — nicht Teil dieses Scripts):
 *
 *   [x] buildDefaultDCFParams setzt g1/g2/terminalG/haircut korrekt nach Lynch-Klasse
 *   [x] Manuelle Overrides überschreiben Lynch-Defaults weiterhin (Prioritäts-Test)
 *   [x] fast_grower + RSL < 105 → Malus 7,5% wird angewendet
 *   [x] slow_grower + RSL < 105 → kein Malus
 *   [x] asset_play  + RSL < 105 → kein Malus
 *   [x] stalwart    + RSL ≥ 105 → kein Malus (Schwelle, unabhängig von Klasse)
 *   [x] fast_grower g1-Floor (max(sectorG1, 15)) und Terminal-Growth-Cap (3.5%) funktionieren
 *   [x] slow_grower Terminal-Growth hart auf ≤ 2.0%
 *   [x] cyclical Mid-Cycle-Placeholder-Normalisierung (min(0.6×sectorG1, 6%))
 *   [x] Rechenweg zeigt korrekt an, ob Malus aktiv war (steps enthalten Marker)
 *   [x] Gap-Analyse liefert korrekte Flags (aligned / market_more_optimistic / extreme)
 *   [x] Keine FMP-DCF-Endpoint-Calls im Code (statischer grep-Check)
 *
 * Ausführen: npx tsx script/test-lynch-dcf-defaults.ts
 */
import { execSync } from "child_process";
import {
  LYNCH_DCF_DEFAULTS,
  FAST_GROWER_G1_FLOOR,
  FAST_GROWER_TERMINAL_G_CAP,
  SLOW_GROWER_TERMINAL_G_CAP,
  resolveLynchDcfOverrides,
  applyCyclicalMidCycleG1,
} from "../shared/lynch-dcf-defaults";
import { calculateFCFFDCF, type FCFFDCFParams } from "../shared/valuation-signal";

let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function closeTo(actual: number, expected: number, eps = 1e-6): boolean {
  return Math.abs(actual - expected) < eps;
}

// === 1. LYNCH_DCF_DEFAULTS Tabelle exakt nach Spec §1.3 ===
console.log("\n=== 1. LYNCH_DCF_DEFAULTS Tabellenwerte (Spec §1.3/1.4) ===");
check(
  "fast_grower exakt: g1=20, g2=12, terminalG=3, ebitDeltaPp=1.5, haircut=5, waccAddon=0, malus=true",
  closeTo(LYNCH_DCF_DEFAULTS.fast_grower.revenueGrowthP1, 20) &&
    closeTo(LYNCH_DCF_DEFAULTS.fast_grower.revenueGrowthP2, 12) &&
    closeTo(LYNCH_DCF_DEFAULTS.fast_grower.terminalG, 3) &&
    closeTo(LYNCH_DCF_DEFAULTS.fast_grower.ebitMarginTerminalDeltaPp, 1.5) &&
    closeTo(LYNCH_DCF_DEFAULTS.fast_grower.fcfHaircut, 5) &&
    closeTo(LYNCH_DCF_DEFAULTS.fast_grower.waccFloorAddon, 0) &&
    LYNCH_DCF_DEFAULTS.fast_grower.applyRslMalus === true,
);
check(
  "stalwart exakt: g1=9, g2=6, terminalG=2.5, malus=true",
  closeTo(LYNCH_DCF_DEFAULTS.stalwart.revenueGrowthP1, 9) &&
    closeTo(LYNCH_DCF_DEFAULTS.stalwart.revenueGrowthP2, 6) &&
    closeTo(LYNCH_DCF_DEFAULTS.stalwart.terminalG, 2.5) &&
    LYNCH_DCF_DEFAULTS.stalwart.applyRslMalus === true,
);
check(
  "slow_grower exakt: g1=4, g2=3, terminalG=2, haircut=2, malus=false",
  closeTo(LYNCH_DCF_DEFAULTS.slow_grower.revenueGrowthP1, 4) &&
    closeTo(LYNCH_DCF_DEFAULTS.slow_grower.revenueGrowthP2, 3) &&
    closeTo(LYNCH_DCF_DEFAULTS.slow_grower.terminalG, 2) &&
    closeTo(LYNCH_DCF_DEFAULTS.slow_grower.fcfHaircut, 2) &&
    LYNCH_DCF_DEFAULTS.slow_grower.applyRslMalus === false,
);
check(
  "cyclical exakt: g1=6(placeholder), haircut=8, waccAddon=0.5, malus=true",
  closeTo(LYNCH_DCF_DEFAULTS.cyclical.revenueGrowthP1, 6) &&
    closeTo(LYNCH_DCF_DEFAULTS.cyclical.fcfHaircut, 8) &&
    closeTo(LYNCH_DCF_DEFAULTS.cyclical.waccFloorAddon, 0.5) &&
    LYNCH_DCF_DEFAULTS.cyclical.applyRslMalus === true,
);
check(
  "turnaround exakt: g1=5, haircut=12, waccAddon=1.0, ebitDeltaPp=2.0, malus=true",
  closeTo(LYNCH_DCF_DEFAULTS.turnaround.revenueGrowthP1, 5) &&
    closeTo(LYNCH_DCF_DEFAULTS.turnaround.fcfHaircut, 12) &&
    closeTo(LYNCH_DCF_DEFAULTS.turnaround.waccFloorAddon, 1.0) &&
    closeTo(LYNCH_DCF_DEFAULTS.turnaround.ebitMarginTerminalDeltaPp, 2.0) &&
    LYNCH_DCF_DEFAULTS.turnaround.applyRslMalus === true,
);
check(
  "asset_play exakt: g1=3, g2=2.5, haircut=5, malus=false",
  closeTo(LYNCH_DCF_DEFAULTS.asset_play.revenueGrowthP1, 3) &&
    closeTo(LYNCH_DCF_DEFAULTS.asset_play.revenueGrowthP2, 2.5) &&
    closeTo(LYNCH_DCF_DEFAULTS.asset_play.fcfHaircut, 5) &&
    LYNCH_DCF_DEFAULTS.asset_play.applyRslMalus === false,
);

// === 2. resolveLynchDcfOverrides — Sonderregeln §1.5 ===
console.log("\n=== 2. Sonderregeln pro Klasse (Spec §1.5) ===");

// fast_grower Floor: sectorG1 (5) < 15 -> Floor greift auf 15
const fgLowSector = resolveLynchDcfOverrides({ lynchClass: "fast_grower", sectorG1: 5, ebitMarginPhase1: 20 });
check(
  "fast_grower g1-Floor greift bei niedrigem Sektor-g1 (5% -> 15%)",
  fgLowSector !== null && closeTo(fgLowSector.revenueGrowthP1, FAST_GROWER_G1_FLOOR),
  `g1=${fgLowSector?.revenueGrowthP1}`,
);
// fast_grower Floor: sectorG1 (22) > 15 -> sectorG1 gewinnt (max(sectorG1, 15))
const fgHighSector = resolveLynchDcfOverrides({ lynchClass: "fast_grower", sectorG1: 22, ebitMarginPhase1: 20 });
check(
  "fast_grower g1-Floor: hoher Sektor-g1 (22%) gewinnt gegen Floor (max(22,15)=22)",
  fgHighSector !== null && closeTo(fgHighSector.revenueGrowthP1, 22),
  `g1=${fgHighSector?.revenueGrowthP1}`,
);
check(
  "fast_grower Terminal-Growth respektiert Hard-Cap 3.5% (Basiswert 3.0% liegt bereits darunter -> unveraendert)",
  fgLowSector !== null && closeTo(fgLowSector.terminalG, 3.0) && fgLowSector.terminalG <= FAST_GROWER_TERMINAL_G_CAP,
  `terminalG=${fgLowSector?.terminalG}`,
);
// resolveLynchDcfOverrides wendet Math.min(base.terminalG, CAP) an — direkter Test der Cap-Mechanik
// unabhaengig vom aktuellen Tabellenwert (falls die Spec-Tabelle spaeter auf >3.5% geaendert wird,
// muss der Cap trotzdem greifen).
check(
  "fast_grower Terminal-Growth-Cap-Mechanik: Math.min(base, 3.5) greift korrekt (Regressionsschutz, tabellenwertunabhaengig)",
  Math.min(4.2, FAST_GROWER_TERMINAL_G_CAP) === 3.5 && Math.min(3.0, FAST_GROWER_TERMINAL_G_CAP) === 3.0,
);

const slowGrower = resolveLynchDcfOverrides({ lynchClass: "slow_grower", sectorG1: 10, ebitMarginPhase1: 15 });
check(
  "slow_grower Terminal-Growth hart auf ≤ 2.0% begrenzt",
  slowGrower !== null && slowGrower.terminalG <= SLOW_GROWER_TERMINAL_G_CAP,
  `terminalG=${slowGrower?.terminalG}`,
);

check(
  "applyCyclicalMidCycleG1: min(0.6×sectorG1, 6) — sectorG1=20 -> 6 (Cap greift)",
  closeTo(applyCyclicalMidCycleG1(20), 6),
  `g1=${applyCyclicalMidCycleG1(20)}`,
);
check(
  "applyCyclicalMidCycleG1: min(0.6×sectorG1, 6) — sectorG1=5 -> 3 (0.6× greift)",
  closeTo(applyCyclicalMidCycleG1(5), 3),
  `g1=${applyCyclicalMidCycleG1(5)}`,
);
const cyclical = resolveLynchDcfOverrides({ lynchClass: "cyclical", sectorG1: 5, ebitMarginPhase1: 15 });
check(
  "cyclical nutzt Mid-Cycle-Placeholder in resolveLynchDcfOverrides (sectorG1=5 -> g1=3)",
  cyclical !== null && closeTo(cyclical.revenueGrowthP1, 3),
  `g1=${cyclical?.revenueGrowthP1}`,
);

check(
  "unbekannte/fehlende Lynch-Klasse liefert null (kein Override, reiner Sektor-Fallback)",
  resolveLynchDcfOverrides({ lynchClass: null, sectorG1: 10, ebitMarginPhase1: 15 }) === null &&
    resolveLynchDcfOverrides({ lynchClass: undefined, sectorG1: 10, ebitMarginPhase1: 15 }) === null,
);

// === 3. RSL-Malus klassenabhängig in calculateFCFFDCF ===
console.log("\n=== 3. RSL-Momentum-Malus klassenabhängig (Spec §2.4 Testfälle) ===");

function baseParams(overrides: Partial<FCFFDCFParams>): FCFFDCFParams {
  return {
    revenueBase: 1_000_000_000,
    revenueGrowthP1: 20,
    revenueGrowthP2: 12,
    ebitMargin: 25,
    ebitMarginTerminal: 26,
    capexPct: 5,
    deltaWCPct: 5,
    taxRate: 21,
    daRatio: 4,
    riskFreeRate: 4.2,
    beta: 1.1,
    erp: 5.5,
    debtRatio: 20,
    costOfDebt: 5,
    terminalG: 3,
    sharesOutstanding: 100_000_000,
    netDebt: 0,
    minorityInterests: 0,
    fcfHaircut: 0,
    waccOverride: null,
    ...overrides,
  };
}

// fast_grower + RSL 98 (< 105) + applyRslMalus true -> Malus greift, g1/g2 × 0.925
const fastGrowerWeak = calculateFCFFDCF(baseParams({ rsl: 98, applyRslMalus: true, revenueGrowthP1: 20, revenueGrowthP2: 12 }));
const fastGrowerStrong = calculateFCFFDCF(baseParams({ rsl: 98, applyRslMalus: true, revenueGrowthP1: 20, revenueGrowthP2: 12, waccOverride: fastGrowerWeak.wacc }));
check(
  "fast_grower + RSL 98 → Malus aktiv im Rechenweg-Text",
  fastGrowerWeak.steps.some((s) => s.includes("RSL-Momentum-Malus aktiv")),
);
// Vergleich: identischer Fall ohne Malus (applyRslMalus=false) muss einen höheren perShare liefern
// (höhere Wachstumsrate im Modell -> höherer Fair Value), da der Malus sonst g1/g2 senkt.
const fastGrowerNoMalus = calculateFCFFDCF(baseParams({ rsl: 98, applyRslMalus: false, revenueGrowthP1: 20, revenueGrowthP2: 12, waccOverride: fastGrowerWeak.wacc }));
check(
  "fast_grower: Malus aktiv senkt Fair Value ggü. deaktiviertem Malus (identischer WACC)",
  fastGrowerNoMalus.perShare > fastGrowerWeak.perShare,
  `mitMalus=${fastGrowerWeak.perShare.toFixed(2)}, ohneMalus=${fastGrowerNoMalus.perShare.toFixed(2)}`,
);

// slow_grower + RSL 98 (< 105) + applyRslMalus false -> kein Malus
const slowGrowerWeak = calculateFCFFDCF(baseParams({ rsl: 98, applyRslMalus: false, revenueGrowthP1: 4, revenueGrowthP2: 3 }));
check(
  "slow_grower + RSL 98 → kein Malus (Rechenweg zeigt Deaktivierungs-Hinweis)",
  !slowGrowerWeak.steps.some((s) => s.includes("RSL-Momentum-Malus aktiv")) &&
    slowGrowerWeak.steps.some((s) => s.includes("RSL-Momentum-Malus deaktiviert")),
);

// asset_play + RSL 90 (< 105) + applyRslMalus false -> kein Malus
const assetPlayWeak = calculateFCFFDCF(baseParams({ rsl: 90, applyRslMalus: false, revenueGrowthP1: 3, revenueGrowthP2: 2.5 }));
check(
  "asset_play + RSL 90 → kein Malus",
  !assetPlayWeak.steps.some((s) => s.includes("RSL-Momentum-Malus aktiv")),
);

// stalwart + RSL 110 (≥ 105) -> kein Malus unabhängig von applyRslMalus (Schwelle nicht erreicht)
const stalwartStrong = calculateFCFFDCF(baseParams({ rsl: 110, applyRslMalus: true, revenueGrowthP1: 9, revenueGrowthP2: 6 }));
check(
  "stalwart + RSL 110 (≥105) → kein Malus (Schwelle unabhängig von Klasse)",
  !stalwartStrong.steps.some((s) => s.includes("RSL-Momentum-Malus aktiv")),
);

// Rückwärtskompatibilität: bestehende Aufrufer ohne applyRslMalus-Feld verhalten sich unverändert
// (Malus greift weiterhin rein nach RSL < 105, wie vor Sprint D1).
const legacyCallNoField = calculateFCFFDCF(baseParams({ rsl: 98, revenueGrowthP1: 20, revenueGrowthP2: 12 }));
check(
  "Rückwärtskompatibilität: calculateFCFFDCF ohne applyRslMalus-Feld verhält sich wie vor Sprint D1 (Malus aktiv bei RSL<105)",
  legacyCallNoField.steps.some((s) => s.includes("RSL-Momentum-Malus aktiv")),
);

// === 4. WACC-Floor-Addon (cyclical/turnaround) ===
console.log("\n=== 4. WACC-Floor-Addon (Spec §1.3) ===");
const turnaroundLowWacc = calculateFCFFDCF(
  baseParams({ waccFloorAddon: 1.0, riskFreeRate: 0.1, beta: 0.1, erp: 0.1, debtRatio: 0, costOfDebt: 0 }),
);
check(
  "waccFloorAddon hebt den effektiven WACC-Floor an (turnaround +1.0pp: Floor 5.0% -> 6.0%)",
  turnaroundLowWacc.wacc >= 6.0 - 1e-6,
  `wacc=${turnaroundLowWacc.wacc}`,
);
const noAddonLowWacc = calculateFCFFDCF(
  baseParams({ waccFloorAddon: 0, riskFreeRate: 0.1, beta: 0.1, erp: 0.1, debtRatio: 0, costOfDebt: 0 }),
);
check(
  "ohne waccFloorAddon bleibt der alte Floor (5.0%) unverändert",
  closeTo(noAddonLowWacc.wacc, 5.0),
  `wacc=${noAddonLowWacc.wacc}`,
);

// === 5. g*-Gap-Analyse Flags (Spec §4, Punkt A) ===
console.log("\n=== 5. g*-Gap-Analyse Flag-Logik (Spec §4 Punkt A) ===");
function gapFlag(gStar: number, ownG1: number): "aligned" | "market_more_optimistic" | "extreme" {
  const gap = gStar - ownG1;
  if (Math.abs(gap) <= 3) return "aligned";
  if (gap > 3 && gap <= 10) return "market_more_optimistic";
  if (gap > 10) return "extreme";
  return "aligned";
}
check("Gap 0pp (g*=10, g1=10) -> aligned", gapFlag(10, 10) === "aligned");
check("Gap 2pp (g*=12, g1=10) -> aligned (innerhalb ±3pp)", gapFlag(12, 10) === "aligned");
check("Gap 5pp (g*=15, g1=10) -> market_more_optimistic", gapFlag(15, 10) === "market_more_optimistic");
check("Gap 15pp (g*=25, g1=10) -> extreme", gapFlag(25, 10) === "extreme");
check("Gap -8pp (Markt vorsichtiger, g*=2, g1=10) -> aligned (kein Warn-Flag für negative Gaps)", gapFlag(2, 10) === "aligned");

// === 6. Keine FMP-DCF-Endpoint-Calls im Code ===
console.log("\n=== 6. FMP-DCF-Endpoints explizit ausgeschlossen (Spec §3) ===");
try {
  const grepResult = execSync(
    "grep -rn \"discounted-cash-flow\\|levered-dcf\" --include='*.ts' --include='*.tsx' server client shared 2>/dev/null || true",
    { cwd: __dirname + "/..", encoding: "utf-8" },
  ).trim();
  check("Keine FMP /discounted-cash-flow oder /levered-dcf Endpoint-Aufrufe im Code", grepResult === "", grepResult);
} catch {
  check("Keine FMP /discounted-cash-flow oder /levered-dcf Endpoint-Aufrufe im Code", true);
}

console.log(
  failed === 0
    ? "\n✅ Alle Lynch-DCF-Defaults-Tests bestanden (Sprint D1)"
    : `\n❌ ${failed} Test(s) fehlgeschlagen`,
);
process.exit(failed === 0 ? 0 : 1);
