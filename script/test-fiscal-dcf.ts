/**
 * Unit-Tests für die Teil-1/Teil-3-Erweiterungen in client/src/lib/calculations.ts
 * (WORK_REVERSE_DCF_BRIDGE.md): calculateRealizedGrowth8Q, calculateGapRatio,
 * allocateProgramToFcf, capOverlays, forwardDcfWithFiscal.
 *
 * WICHTIGSTER TEST: g* (calculateReverseDCF) bleibt IDENTISCH, unabhängig davon,
 * ob und wie ein Fiscal-Overlay auf den separaten Forward-DCF-Pfad angewendet wird
 * (WORK_REVERSE_DCF_BRIDGE.md §3.1/§3.4 — Reverse-DCF bleibt "clean").
 *
 * Ausführen: npx tsx script/test-fiscal-dcf.ts
 */
import {
  calculateReverseDCF,
  calculateRealizedGrowth8Q,
  calculateGapRatio,
  allocateProgramToFcf,
  capOverlays,
  forwardDcfWithFiscal,
  type FiscalProgramForFcf,
  type FiscalFcfOverlay,
} from "../client/src/lib/calculations";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ─── Teil 1: calculateRealizedGrowth8Q ────────────────────────────────────────
console.log("\nTeil 1 — calculateRealizedGrowth8Q");
{
  const r0 = calculateRealizedGrowth8Q(undefined);
  check("undefined → null, insufficient_data", r0.realizedGrowth8Q === null && r0.method === "insufficient_data");

  const r1 = calculateRealizedGrowth8Q([100, 101, 102]);
  check("< 8 Quartale → null, insufficient_data", r1.realizedGrowth8Q === null && r1.method === "insufficient_data");

  // 16 Quartale: erste 8 summe 800, letzte 8 summe 880 → +10%
  const q16 = [...Array(8).fill(100), ...Array(8).fill(110)];
  const r2 = calculateRealizedGrowth8Q(q16);
  check("16 Quartale YoY exakt +10%", r2.method === "yoy_8q" && Math.abs((r2.realizedGrowth8Q ?? 0) - 10) < 1e-9, `got ${r2.realizedGrowth8Q}`);

  // genau 8 Quartale, konstant wachsend um 2% QoQ → Fallback qoq_annualized
  let v = 100;
  const q8: number[] = [v];
  for (let i = 0; i < 7; i++) { v *= 1.02; q8.push(v); }
  const r3 = calculateRealizedGrowth8Q(q8);
  const expectedAnnualized = (Math.pow(1.02, 4) - 1) * 100;
  check("8 Quartale → qoq_annualized Fallback", r3.method === "qoq_annualized");
  check("qoq_annualized Formel exakt ((1.02)^4-1)*100", Math.abs((r3.realizedGrowth8Q ?? 0) - expectedAnnualized) < 1e-6, `got ${r3.realizedGrowth8Q} vs ${expectedAnnualized}`);

  const r4 = calculateRealizedGrowth8Q([0, 0, 0, 0, 0, 0, 0, 0]);
  check("Nur Nullen → gefiltert, insufficient_data", r4.realizedGrowth8Q === null);
}

// ─── Teil 1: calculateGapRatio ─────────────────────────────────────────────────
console.log("\nTeil 1 — calculateGapRatio");
{
  check("gapRatio = g*/realized exakt", calculateGapRatio(10, 5) === 2);
  check("realized = null → null", calculateGapRatio(10, null) === null);
  check("realized = 0 → null (keine Division durch 0)", calculateGapRatio(10, 0) === null);
  check("negatives g* möglich", calculateGapRatio(-5, 5) === -1);
}

// ─── Teil 3: allocateProgramToFcf ──────────────────────────────────────────────
console.log("\nTeil 3 — allocateProgramToFcf");
{
  // Zahlenbeispiel aus WORK_REVERSE_DCF_BRIDGE.md §3.7:
  // volumeUsdBn=20, companyShare=0.08, fcfMargin=0.12 → totalCompanyFcf = 192e6, /4 Jahre = 48e6/Jahr
  const program: FiscalProgramForFcf = {
    id: "prog-nato", volumeUsdBn: 20, startYear: 2025, endYear: 2028,
    source: { url: "https://x", publishedAt: "2025-01-01", snippet: "" },
  };
  const overlays = allocateProgramToFcf({ program, companyShare: 0.08, fcfMargin: 0.12, probability: 0.75 });
  check("4 Jahre (2025-2028)", overlays.length === 4, `got ${overlays.length}`);
  check("perYear = 48e6 exakt (§3.7 Beispiel)", Math.abs(overlays[0].deltaFcfUsd - 48e6) < 1, `got ${overlays[0].deltaFcfUsd}`);
  check("probability durchgereicht", overlays.every(o => o.probability === 0.75));
  check("Jahre korrekt 2025..2028", overlays.map(o => o.year).join(",") === "2025,2026,2027,2028");

  // Overlay = 0 wenn volumeUsdBn null (kritischer Guardrail-Test §3.2/§3.6)
  const emptyOverlays = allocateProgramToFcf({
    program: { ...program, volumeUsdBn: null }, companyShare: 0.08, fcfMargin: 0.12, probability: 0.75,
  });
  check("volumeUsdBn=null → leeres Array (kein numerisches Overlay)", emptyOverlays.length === 0);

  // startYear/endYear fehlen
  const noYears = allocateProgramToFcf({
    program: { ...program, startYear: null }, companyShare: 0.08, fcfMargin: 0.12, probability: 0.75,
  });
  check("startYear=null → leeres Array", noYears.length === 0);

  // endYear < startYear → leeres Array
  const badRange = allocateProgramToFcf({
    program: { ...program, startYear: 2028, endYear: 2025 }, companyShare: 0.08, fcfMargin: 0.12, probability: 0.75,
  });
  check("endYear < startYear → leeres Array", badRange.length === 0);
}

// ─── Teil 3: capOverlays ────────────────────────────────────────────────────────
console.log("\nTeil 3 — capOverlays (Cap-Grenzfall)");
{
  const baseFcf0 = 400e6;
  // §3.7 Beispiel: Cap = 0.30 * 400e6 = 120e6, Overlay 36e6 (0.75*48e6) → unter Cap, keine Skalierung
  const overlaysUnderCap: FiscalFcfOverlay[] = [{ programId: "p1", year: 2025, deltaFcfUsd: 48e6, probability: 0.75, source: undefined }];
  const cappedUnder = capOverlays(baseFcf0, overlaysUnderCap, 0.30);
  check("Unter Cap → unverändert (Scale=1)", Math.abs(cappedUnder[0].deltaFcfUsd - 48e6) < 1e-6, `got ${cappedUnder[0].deltaFcfUsd}`);

  // Grenzfall: Overlay genau am Cap → keine Skalierung (scale=1, da raw > cap Bedingung strikt >)
  const exactCapOverlay: FiscalFcfOverlay[] = [{ programId: "p1", year: 2025, deltaFcfUsd: 120e6, probability: 1, source: undefined }];
  const cappedExact = capOverlays(baseFcf0, exactCapOverlay, 0.30);
  check("Exakt am Cap → keine Skalierung", Math.abs(cappedExact[0].deltaFcfUsd - 120e6) < 1e-6, `got ${cappedExact[0].deltaFcfUsd}`);

  // Über Cap: raw = 200e6 > cap 120e6 → skaliert auf 120e6
  const overCapOverlay: FiscalFcfOverlay[] = [{ programId: "p1", year: 2025, deltaFcfUsd: 200e6, probability: 1, source: undefined }];
  const cappedOver = capOverlays(baseFcf0, overCapOverlay, 0.30);
  check("Über Cap → auf Cap-Betrag herunterskaliert (120e6)", Math.abs(cappedOver[0].deltaFcfUsd - 120e6) < 1e-6, `got ${cappedOver[0].deltaFcfUsd}`);

  // Mehrere Programme im selben Jahr, gemeinsam über Cap → proportionale Skalierung
  const multiOverlays: FiscalFcfOverlay[] = [
    { programId: "p1", year: 2025, deltaFcfUsd: 100e6, probability: 1, source: undefined },
    { programId: "p2", year: 2025, deltaFcfUsd: 100e6, probability: 1, source: undefined },
  ];
  const cappedMulti = capOverlays(baseFcf0, multiOverlays, 0.30); // raw=200e6, cap=120e6, scale=0.6
  const sumAfter = cappedMulti.reduce((s, o) => s + o.deltaFcfUsd, 0);
  check("Mehrere Programme gemeinsam gecapped (Summe=Cap)", Math.abs(sumAfter - 120e6) < 1e-6, `got ${sumAfter}`);
  check("Proportionale Skalierung (beide gleich behandelt)", Math.abs(cappedMulti[0].deltaFcfUsd - cappedMulti[1].deltaFcfUsd) < 1e-6);
}

// ─── Teil 3: forwardDcfWithFiscal ───────────────────────────────────────────────
console.log("\nTeil 3 — forwardDcfWithFiscal");
{
  const base = forwardDcfWithFiscal({
    fcf0: 400e6, baseGrowth: 0.05, wacc: 0.09, overlays: [], netDebt: 0, shares: 100e6,
  });
  const currentYear = new Date().getUTCFullYear();
  const withOverlay = forwardDcfWithFiscal({
    fcf0: 400e6, baseGrowth: 0.05, wacc: 0.09,
    overlays: [{ programId: "p1", year: currentYear, deltaFcfUsd: 36e6, probability: 1, source: undefined }],
    netDebt: 0, shares: 100e6,
  });
  check("Overlay erhöht FV gegenüber Base", withOverlay.fairValuePerShare > base.fairValuePerShare, `${withOverlay.fairValuePerShare} vs ${base.fairValuePerShare}`);
  check("FCF-Pfad Jahr 1 enthält Overlay additiv", Math.abs(withOverlay.fcfPath[0] - (base.fcfPath[0] + 36e6)) < 1e-6, `${withOverlay.fcfPath[0]} vs ${base.fcfPath[0] + 36e6}`);
  check("Overlay außerhalb Zeitraum = kein Effekt", (() => {
    const outOfRange = forwardDcfWithFiscal({
      fcf0: 400e6, baseGrowth: 0.05, wacc: 0.09,
      overlays: [{ programId: "p1", year: currentYear + 50, deltaFcfUsd: 36e6, probability: 1, source: undefined }],
      netDebt: 0, shares: 100e6,
    });
    return Math.abs(outOfRange.fairValuePerShare - base.fairValuePerShare) < 1e-6;
  })());
}

// ─── KRITISCHSTER TEST: g* bleibt clean, unabhängig vom Fiscal-Overlay ─────────
console.log("\nKRITISCH — g* (Reverse-DCF) unverändert bei angewendetem Fiscal-Overlay");
{
  const reverseParams = {
    currentPrice: 150,
    fcfBase: 400e6,
    wacc: 9,
    sharesOutstanding: 100e6,
    netDebt: 0,
  };
  const gStarBefore = calculateReverseDCF(reverseParams);

  // Fiscal-Overlay wird konstruiert und auf einen komplett separaten Forward-DCF
  // angewendet — calculateReverseDCF() wird mit denselben Parametern erneut aufgerufen,
  // um zu beweisen, dass keine gemeinsame mutable Struktur oder versteckte Kopplung existiert.
  const program: FiscalProgramForFcf = {
    id: "prog-x", volumeUsdBn: 50, startYear: 2025, endYear: 2030,
    source: { url: "https://x", publishedAt: "2025-01-01", snippet: "" },
  };
  const overlays = capOverlays(
    reverseParams.fcfBase,
    allocateProgramToFcf({ program, companyShare: 0.5, fcfMargin: 0.5, probability: 1 }),
    0.30
  );
  forwardDcfWithFiscal({
    fcf0: reverseParams.fcfBase, baseGrowth: 0.05, wacc: reverseParams.wacc / 100,
    overlays, netDebt: reverseParams.netDebt, shares: reverseParams.sharesOutstanding,
  });

  const gStarAfter = calculateReverseDCF(reverseParams);
  check(
    "g* (impliedGrowth) exakt identisch vor/nach Fiscal-Overlay-Anwendung",
    gStarBefore.impliedGrowth === gStarAfter.impliedGrowth,
    `before=${gStarBefore.impliedGrowth}, after=${gStarAfter.impliedGrowth}`
  );
  check(
    "rating identisch",
    gStarBefore.rating === gStarAfter.rating
  );
  check(
    "referenceGrowth identisch",
    gStarBefore.referenceGrowth === gStarAfter.referenceGrowth
  );
}

console.log(failed === 0 ? "\n✅ Alle Fiscal-DCF-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
