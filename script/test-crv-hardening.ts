/**
 * Unit-Tests fuer die CRV-Haertung gegen DCF-Extrapolation (client/src/lib/calculations.ts).
 *
 * Auftrag 09.08.2026 ("CRV haerten: generisch gegen DCF-Extrapolation, NVO-Muster").
 * Root-Problem: CRV = (FV - WC) / (Preis - WC) ist mathematisch korrekt, wird
 * aber optisch sehr attraktiv, wenn FV durch niedrigen WACC + hohen Terminal-
 * Value-Anteil + fortgeschriebene hohe Margen extrapoliert wird, UND WC wegen
 * niedrigem Beta zu milde ausfaellt. Diese Tests decken Teil A-F ab:
 * WACC-Floor, Terminal-Value-Guard, Margin-Stress, Structural-WC, Divergenz-
 * Flag, kombinierte CRV-Kette -- alles generisch, keine Ticker-Hardcodes.
 *
 * Ausfuehren: npx tsx script/test-crv-hardening.ts
 */
import {
  computeSectorWaccFloor, applyWaccFloor, applyTerminalValueGuard,
  computeMarginStress, computeStructuralWorstCaseFloor, worstCaseStructural,
  computeDcfVsMarketDivergence, computeHardenedCRV,
} from "../client/src/lib/calculations";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// === Teil A: Sektor-adaptiver WACC-Floor ===

// 1. Pharma/Healthcare -> Floor 7.5%
const pharmaFloor = computeSectorWaccFloor("Healthcare", "Drug Manufacturers - General");
check("WACC-Floor: Pharma/Healthcare -> 7.5%", pharmaFloor.waccFloorPct === 7.5, JSON.stringify(pharmaFloor));

// 2. Software -> Floor 7.0%
const softwareFloor = computeSectorWaccFloor("Technology", "Software - Infrastructure");
check("WACC-Floor: Software -> 7.0%", softwareFloor.waccFloorPct === 7.0, JSON.stringify(softwareFloor));

// 3. Consumer Cyclical -> Floor 8.0%
const consumerFloor = computeSectorWaccFloor("Consumer Cyclical", "Apparel - Footwear & Accessories");
check("WACC-Floor: Consumer Cyclical -> 8.0%", consumerFloor.waccFloorPct === 8.0, JSON.stringify(consumerFloor));

// 4. Unbekannter Sektor -> Default 7.0%
const defaultFloor = computeSectorWaccFloor("Utilities", "Diversified Utilities");
check("WACC-Floor: unbekannter Sektor -> Default 7.0%", defaultFloor.waccFloorPct === 7.0, JSON.stringify(defaultFloor));

// 5. NVO-Fall: WACC-Modell 6.43% < Pharma-Floor 7.5% -> Floor greift
const nvoWacc = applyWaccFloor(6.43, "Healthcare", "Drug Manufacturers - General");
check("WACC-Floor: NVO (6.43% Pharma) -> Floor aktiv, WACC_used=7.5%", nvoWacc.waccFloorApplied && nvoWacc.waccUsed === 7.5, JSON.stringify(nvoWacc));

// 6. WACC-Modell bereits über Floor -> kein Eingriff
const highWacc = applyWaccFloor(12.0, "Healthcare", "Drug Manufacturers - General");
check("WACC-Floor: WACC bereits über Floor -> kein Eingriff, WACC_used=WACC_model", !highWacc.waccFloorApplied && highWacc.waccUsed === 12.0, JSON.stringify(highWacc));

// === Teil B: Terminal-Value-Guard ===

// 7. TV/EV > 70% -> Flag + Haircut
const highTv = applyTerminalValueGuard(117.49, 74000, 100000); // TV/EV = 0.74
check("TV-Guard: TV/EV=74% -> highTvFlag aktiv", highTv.highTvFlag, JSON.stringify(highTv));
check("TV-Guard: Haircut = min(0.25, (0.74-0.70)*0.5) = 0.02", Math.abs(highTv.haircutPct - 0.02) < 1e-9, JSON.stringify(highTv));
check("TV-Guard: FV nach Haircut = 117.49 * 0.98", Math.abs(highTv.fvAfterHaircut - 117.49 * 0.98) < 1e-6, JSON.stringify(highTv));

// 8. TV/EV <= 70% -> kein Flag, kein Haircut
const lowTv = applyTerminalValueGuard(100, 50000, 100000); // TV/EV = 0.50
check("TV-Guard: TV/EV=50% -> kein Flag, FV unveraendert", !lowTv.highTvFlag && lowTv.fvAfterHaircut === 100, JSON.stringify(lowTv));

// 9. Extremer TV-Anteil (TV/EV=95%) -> Haircut = min(0.25, (0.95-0.70)*0.5) = 0.125
const extremeTv = applyTerminalValueGuard(100, 95000, 100000); // TV/EV = 0.95
check("TV-Guard: TV/EV=95% -> Haircut = min(0.25, 0.125) = 0.125 (noch nicht am 0.25-Cap)", Math.abs(extremeTv.haircutPct - 0.125) < 1e-9, JSON.stringify(extremeTv));

// 9b. Wirklich extremer TV-Anteil (TV/EV=100%, theoretisches Maximum) -> Haircut am 0.25-Cap
const maxTv = applyTerminalValueGuard(100, 100000, 100000); // TV/EV = 1.00 -> (1.00-0.70)*0.5=0.15, immer noch unter 0.25
const ultraTv = applyTerminalValueGuard(100, 120000, 100000); // TV/EV = 1.20 (EV kann durch Netto-Cash-Adjustierungen so entstehen) -> (1.20-0.70)*0.5=0.25 -> exakt am Cap
check("TV-Guard: TV/EV=120% -> Haircut exakt am 0.25-Cap", Math.abs(ultraTv.haircutPct - 0.25) < 1e-9, JSON.stringify(ultraTv));

// === Teil C: Margen-Stress ===

// 10. NVO-Fall: Marge -2.9pp YoY + govExposure 35% -> Stress dominiert von govExposure (3.0 > 0.5*2.9=1.45)
const nvoMarginStress = computeMarginStress(41.3, -2.9, 35);
check("Margin-Stress: NVO (govExposure 35% >= 20%) -> mind. 3.0pp Stress", nvoMarginStress.marginStressPp === 3.0, JSON.stringify(nvoMarginStress));

// 11. Starker YoY-Schock ohne govExposure -> Stress aus YoY-Komponente
const yoyShockOnly = computeMarginStress(30, -12, 5);
check("Margin-Stress: starker YoY-Schock (-12pp) ohne govExposure -> 0.5*12=6.0pp", yoyShockOnly.marginStressPp === 6.0, JSON.stringify(yoyShockOnly));

// 12. Kein Schock, kein govExposure -> Mindest-Stress 2.0pp (nie 0)
const noShock = computeMarginStress(30, 1.5, 5);
check("Margin-Stress: kein Schock -> Mindest-Stress 2.0pp", noShock.marginStressPp === 2.0, JSON.stringify(noShock));

// 13. marginDeltaYoYPp fehlt (null) -> nur govExposure/Mindest-Stress zaehlen
const missingDelta = computeMarginStress(30, null, 25);
check("Margin-Stress: fehlendes marginDeltaYoYPp -> kein Crash, govExposure-Pfad greift (3.0pp)", missingDelta.marginStressPp === 3.0, JSON.stringify(missingDelta));

// === Teil D: Struktureller Worst-Case-Floor ===

// 14. govExposure >= 25% -> struktureller Floor >= 35%
const govFloor = computeStructuralWorstCaseFloor({ govExposurePct: 35, fcfMarginYoYPp: null, moatRating: null, dcfUpsidePct: null });
check("Structural-WC: govExposure 35% >= 25% -> Floor >= 35%", govFloor.structuralFloorPct >= 35, JSON.stringify(govFloor));
check("Structural-WC: govExposure-Reason vorhanden", govFloor.reasons.some(r => r.includes("govExposure")), JSON.stringify(govFloor));

// 15. FCF-Marge YoY <= -10pp -> zusaetzlicher Floor
const fcfShockFloor = computeStructuralWorstCaseFloor({ govExposurePct: 5, fcfMarginYoYPp: -14.6, moatRating: null, dcfUpsidePct: null });
check("Structural-WC: FCF-Marge YoY -14.6pp <= -10pp -> Floor >= 30%", fcfShockFloor.structuralFloorPct >= 30, JSON.stringify(fcfShockFloor));

// 16. Schwacher Moat + hohe DCF-Upside -> tieferer Floor
const weakMoatFloor = computeStructuralWorstCaseFloor({ govExposurePct: 5, fcfMarginYoYPp: 1, moatRating: "Schwach", dcfUpsidePct: 149 });
check("Structural-WC: schwacher Moat + DCF-Upside 149% > 50% -> Floor >= 35%", weakMoatFloor.structuralFloorPct >= 35, JSON.stringify(weakMoatFloor));

// 17. Keine strukturellen Risiken -> Floor = 0 (kein kuenstlicher Eingriff)
const noRiskFloor = computeStructuralWorstCaseFloor({ govExposurePct: 5, fcfMarginYoYPp: 2, moatRating: "Stark", dcfUpsidePct: 20 });
check("Structural-WC: keine strukturellen Risiken -> Floor = 0", noRiskFloor.structuralFloorPct === 0, JSON.stringify(noRiskFloor));

// 18. worstCaseStructural: struktureller Floor tiefer als Beta/Sektor -> WC nutzt den tieferen (hoeheren Drawdown%)
const wcWithStructural = worstCaseStructural(100, 25, 25, 35); // Beta/Sektor 25%, Structural 35%
check("worstCaseStructural: struktureller Floor (35%) tiefer als Beta/Sektor (25%) -> WC=65 (nicht 75)", Math.abs(wcWithStructural - 65) < 1e-6, `wc=${wcWithStructural}`);

// 19. worstCaseStructural: kein struktureller Floor (0) -> WC nutzt max(betaAdj, sector) Drawdown%
// (bewusst MAX, nicht MIN: ein strukturell tieferer WC bedeutet einen HOEHEREN Drawdown-Prozentsatz;
// ohne strukturellen Floor gewinnt bereits der hoehere der beiden Basis-Drawdowns, analog zu
// worstCaseM1/M3 die immer den konservativsten -- d.h. tiefsten -- Kurs liefern sollen)
const wcWithoutStructural = worstCaseStructural(100, 25, 30, 0);
check("worstCaseStructural: struktureller Floor=0 -> WC nutzt max(25,30)=30% Drawdown -> WC=70", Math.abs(wcWithoutStructural - 70) < 1e-6, `wc=${wcWithoutStructural}`);

// === Teil E: Divergenz-Flag DCF vs. Markt ===

// 20. NVO-Fall: DCF-Upside 149% > 80%, Analyst-Upside -0.6% < 15% -> Flag aktiv
const nvoDivergence = computeDcfVsMarketDivergence(117.49, 47.00, 47.26);
check("Divergenz-Flag: NVO (DCF-Upside 149%, Analyst-Upside -0.6%) -> Flag aktiv", nvoDivergence.divergenceFlag, JSON.stringify(nvoDivergence));

// 21. Kein Flag wenn DCF-Upside moderat
const moderateDivergence = computeDcfVsMarketDivergence(55, 47, 47.26);
check("Divergenz-Flag: moderater DCF-Upside (<80%) -> kein Flag", !moderateDivergence.divergenceFlag, JSON.stringify(moderateDivergence));

// 22. Kein Flag wenn Analyst-Upside auch hoch (Konsens bestaetigt DCF)
const confirmedUpside = computeDcfVsMarketDivergence(100, 40, 47.26); // DCF-Upside ~112%, Analyst-Upside ~ -15% -- knapp am Rand, testen mit klar hohem Analyst-Upside
const confirmedUpside2 = computeDcfVsMarketDivergence(100, 90, 47.26); // Analyst-Upside auch stark positiv
check("Divergenz-Flag: hoher DCF-Upside ABER auch hoher Analyst-Upside (>=15%) -> kein Flag", !confirmedUpside2.divergenceFlag, JSON.stringify(confirmedUpside2));

// === Teil F: kombinierte gehaertete CRV-Kette (NVO-Live-Fixture) ===

const nvoFixture = {
  price: 47.26,
  conservativeDCF: { perShare: 117.49, wacc: 6.43, enterpriseValue: 100000, pvTerminal: 74000 },
  sector: "Healthcare",
  industry: "Drug Manufacturers - General",
  ebitMarginPct: 41.3,
  marginDeltaYoYPp: -2.9,
  fcfMarginYoYPp: -14.6,
  govExposurePct: 35,
  moatRating: "Stark",
  betaAdjDrawdownPct: 25, // ~ beta 0.35-0.45-getrieben, mild
  sectorDrawdownPct: 35,
  analystPTMedian: 47.00,
};
const nvoResult = computeHardenedCRV(nvoFixture);

check("Kombiniert: NVO WACC-Floor aktiv (6.43% -> 7.5%)", nvoResult.waccFloorApplied && nvoResult.waccUsed === 7.5, JSON.stringify({ waccUsed: nvoResult.waccUsed, waccFloorApplied: nvoResult.waccFloorApplied }));
check("Kombiniert: NVO High-TV-Flag aktiv (TV/EV=74%)", nvoResult.highTvFlag, `tvOverEv=${nvoResult.tvOverEv}`);
check("Kombiniert: NVO Margin-Stress >= 3.0pp (govExposure-getrieben)", nvoResult.marginStressPp >= 3.0, `marginStressPp=${nvoResult.marginStressPp}`);
check("Kombiniert: NVO Structural-Floor >= 30% (govExposure + FCF-Schock)", nvoResult.structuralFloorPct >= 30, `structuralFloorPct=${nvoResult.structuralFloorPct}`);
check("Kombiniert: NVO Divergenz-Flag aktiv", nvoResult.divergenceFlag, `dcfUpside=${nvoResult.dcfUpsidePct}, analystUpside=${nvoResult.analystUpsidePct}`);
check("Kombiniert: NVO CRV_hardened < CRV_raw (Härtung senkt CRV spürbar)", nvoResult.crvHardened < nvoResult.crvRaw, `crvRaw=${nvoResult.crvRaw}, crvHardened=${nvoResult.crvHardened}`);
check("Kombiniert: NVO CRV_stress <= CRV_hardened (zusätzlicher Margin-Stress dämpft weiter)", nvoResult.crvStress <= nvoResult.crvHardened + 1e-6, `crvHardened=${nvoResult.crvHardened}, crvStress=${nvoResult.crvStress}`);
check("Kombiniert: NVO FV_hardened < FV_raw (WACC-Floor + TV-Haircut senken FV)", nvoResult.fvHardened < nvoResult.fvRaw, `fvRaw=${nvoResult.fvRaw}, fvHardened=${nvoResult.fvHardened}`);
check("Kombiniert: NVO WC_used <= Beta/Sektor-WC (struktureller Floor greift, tieferer WC)", nvoResult.wcUsed <= nvoFixture.price * (1 - 25 / 100), `wcUsed=${nvoResult.wcUsed}`);
check("Kombiniert: NVO liefert mind. 4 Flags (WACC-Floor, High-TV, Margin-Stress, Structural, Divergenz)", nvoResult.flags.length >= 4, JSON.stringify(nvoResult.flags));

// === Regression: MSFT (Software, hoher WACC bereits, keine strukturellen Risiken) ===

const msftFixture = {
  price: 480,
  conservativeDCF: { perShare: 520, wacc: 9.5, enterpriseValue: 3200000, pvTerminal: 1800000 }, // TV/EV = 0.5625, unter 70%
  sector: "Technology",
  industry: "Software - Infrastructure",
  ebitMarginPct: 44,
  marginDeltaYoYPp: 1.2,
  fcfMarginYoYPp: 0.8,
  govExposurePct: 2,
  moatRating: "Stark",
  betaAdjDrawdownPct: 20,
  sectorDrawdownPct: 25,
  analystPTMedian: 510,
};
const msftResult = computeHardenedCRV(msftFixture);

check("Regression MSFT: WACC bereits über Software-Floor (9.5% > 7.0%) -> kein Floor-Eingriff", !msftResult.waccFloorApplied, JSON.stringify({ waccUsed: msftResult.waccUsed, waccModel: msftResult.waccModel }));
check("Regression MSFT: TV/EV=56% <= 70% -> kein High-TV-Flag", !msftResult.highTvFlag, `tvOverEv=${msftResult.tvOverEv}`);
check("Regression MSFT: kein struktureller Floor (keine gov/FCF/Moat-Risiken)", msftResult.structuralFloorPct === 0, `structuralFloorPct=${msftResult.structuralFloorPct}`);
check("Regression MSFT: kein Divergenz-Flag (DCF-Upside moderat, Analyst bestätigt)", !msftResult.divergenceFlag, `dcfUpside=${msftResult.dcfUpsidePct}, analystUpside=${msftResult.analystUpsidePct}`);
check("Regression MSFT: CRV_hardened ≈ CRV_raw (keine künstliche Explosion, aber auch keine künstliche Dämpfung ohne Grund)", Math.abs(msftResult.crvHardened - msftResult.crvRaw) < 0.5, `crvRaw=${msftResult.crvRaw}, crvHardened=${msftResult.crvHardened}`);
check("Regression MSFT: nur wenige/keine Flags (kein Alarm ohne echten Grund)", msftResult.flags.length <= 1, JSON.stringify(msftResult.flags));

// === Regression: NKE (bereits durch Thesis-Score-Guards als unattraktiv geflaggt — CRV-Härtung darf das nicht aufweichen) ===

const nkeFixture = {
  price: 71,
  conservativeDCF: { perShare: 65, wacc: 8.5, enterpriseValue: 90000, pvTerminal: 50000 }, // TV/EV = 0.556, moderat, kein High-TV
  sector: "Consumer Cyclical",
  industry: "Apparel - Footwear & Accessories",
  ebitMarginPct: 10,
  marginDeltaYoYPp: -1.4,
  fcfMarginYoYPp: -2.4,
  govExposurePct: 5,
  moatRating: "Mittel",
  betaAdjDrawdownPct: 30,
  sectorDrawdownPct: 35,
  analystPTMedian: 68,
};
const nkeResult = computeHardenedCRV(nkeFixture);

check("Regression NKE: WACC bereits über Consumer-Cyclical-Floor (8.5% > 8.0%) -> kein Floor-Eingriff", !nkeResult.waccFloorApplied, JSON.stringify({ waccUsed: nkeResult.waccUsed }));
check("Regression NKE: DCF-Upside moderat (<80%) -> kein Divergenz-Flag, keine künstliche Aufweichung", !nkeResult.divergenceFlag, `dcfUpside=${nkeResult.dcfUpsidePct}`);
check("Regression NKE: CRV bleibt moderat (kein künstlicher Boost durch Härtung)", nkeResult.crvHardened < 3, `crvHardened=${nkeResult.crvHardened}`);

console.log(failed === 0 ? `\n✅ Alle CRV-Härtungs-Tests bestanden (${22 + 11 + 5 + 3}+ Checks)` : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
