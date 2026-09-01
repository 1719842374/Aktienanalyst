/**
 * script/test-sector-rotation.ts — Sprint C1 P0 fixture tests
 * Aufruf: npx tsx script/test-sector-rotation.ts
 * SYNTHETISCH = keine Live-FMP-Calls.
 */
import {
  ETF_PROXY_MAP,
  PHASE_PREFERRED,
  VALUATION_FALLBACK,
  zscore,
  percentileRank,
  clamp,
  valuationFromPe,
  valueScore,
  riskFromZ,
  attractivenessScore,
  mapPhaseFromRecession,
  computeSectorRotation,
  type RecessionLike,
  type SectorRotationSectorInput,
} from "../server/sector-rotation";

let failures = 0;
function assertClose(label: string, actual: number, expected: number, eps = 1e-9): void {
  if (Math.abs(actual - expected) > eps) {
    failures++;
    console.error(`❌ ${label}: erwartet ${expected}, erhalten ${actual}`);
  } else {
    console.log(`✅ ${label}: ${actual}`);
  }
}
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    failures++;
    console.error(`❌ ${label}: erwartet ${String(expected)}, erhalten ${String(actual)}`);
  } else {
    console.log(`✅ ${label}: ${String(actual)}`);
  }
}
function assertTrue(label: string, cond: boolean): void {
  if (!cond) {
    failures++;
    console.error(`❌ ${label}: Bedingung falsch`);
  } else {
    console.log(`✅ ${label}`);
  }
}

console.log("=== Test 1: ETF-Proxy-Map = exakt 9 Tickers (XLK..XLU) ===");
{
  const etfs = ETF_PROXY_MAP.map(s => s.etf);
  const ids = ETF_PROXY_MAP.map(s => s.id);
  assertEqual("9 Sektoren", ETF_PROXY_MAP.length, 9);
  assertEqual("XLK", etfs[0], "XLK");
  assertEqual("XLC", etfs[1], "XLC");
  assertEqual("XLY", etfs[2], "XLY");
  assertEqual("XLI", etfs[3], "XLI");
  assertEqual("XLF", etfs[4], "XLF");
  assertEqual("XLE", etfs[5], "XLE");
  assertEqual("XLV", etfs[6], "XLV");
  assertEqual("XLP", etfs[7], "XLP");
  assertEqual("XLU", etfs[8], "XLU");
  assertEqual("id technology", ids[0], "technology");
  assertEqual("id communication", ids[1], "communication");
  assertEqual("id discretionary", ids[2], "discretionary");
  assertEqual("id industrials", ids[3], "industrials");
  assertEqual("id financials", ids[4], "financials");
  assertEqual("id energy", ids[5], "energy");
  assertEqual("id healthcare", ids[6], "healthcare");
  assertEqual("id staples", ids[7], "staples");
  assertEqual("id utilities", ids[8], "utilities");
}

console.log("\n=== Test 2: zscore + percentile_rank ===");
{
  const zs = zscore([1, 2, 3, 4, 5]);
  const mean = 3;
  const sd = Math.sqrt(((4+1+0+1+4)/4));
  assertClose("zscore(1)", zs[0], (1 - mean) / sd, 1e-12);
  assertClose("zscore(3)=0", zs[2], 0, 1e-12);
  assertClose("zscore(5)", zs[4], (5 - mean) / sd, 1e-12);
  const zMissing = zscore([1, null, 3]);
  assertEqual("zscore skips null without throw, length=3", zMissing.length, 3);
  const pop = [0.01, 0.05, 0.10, 0.20];
  assertClose("percentileRank lowest", percentileRank(0.01, pop), (0 + 0.5 * 1) / 4, 1e-12);
  assertClose("percentileRank highest", percentileRank(0.20, pop), (3 + 0.5 * 1) / 4, 1e-12);
  assertClose("percentileRank mid", percentileRank(0.10, pop), (2 + 0.5 * 1) / 4, 1e-12);
  assertClose("percentileRank empty pop → 0.5", percentileRank(0.1, []), 0.5, 1e-12);
}

console.log("\n=== Test 3: Bewertung §2.4 + fehlendes PE-10J crasht nicht ===");
{
  const teuer = valuationFromPe(32.4, 24.1);
  assertEqual("32.4/24.1 > 1.15 → Teuer", teuer.label, "Teuer");
  assertClose("pe_ratio Teuer", teuer.peRatio!, 32.4 / 24.1, 1e-12);
  const attr = valuationFromPe(18, 22);
  assertEqual("18/22 < 0.90 → Attraktiv", attr.label, "Attraktiv");
  const ok = valuationFromPe(20, 20);
  assertEqual("20/20 → Angemessen", ok.label, "Angemessen");
  let threw = false;
  try {
    const miss = valuationFromPe(20, null);
    assertEqual("fehlendes PE-10J → Fallback-Label", miss.label, VALUATION_FALLBACK);
    assertEqual("fehlendes PE-10J → peRatio null", miss.peRatio, null);
    assertEqual("hasPe10y false", miss.hasPe10y, false);
  } catch {
    threw = true;
  }
  assertTrue("fehlendes PE-10J wirft nicht", !threw);
  assertClose("val_score pe_ratio=1 → 3.5", valueScore(1), 3.5, 1e-12);
  assertClose("val_score pe_ratio=0.7 → 5", valueScore(0.7), 5, 1e-12);
  assertClose("val_score pe_ratio=1.5 → 1", valueScore(1.5), 1, 1e-12);
  assertClose("val_score null (neutral 1.0) → 3.5", valueScore(null), 3.5, 1e-12);
}

console.log("\n=== Test 4: Risiko + Attraktivität §2.4 auf bekannten Zahlen ===");
{
  const vols = [0.010, 0.012, 0.014, 0.016, 0.018, 0.020, 0.022, 0.024, 0.030];
  const betas = [0.60, 0.70, 0.80, 0.90, 1.00, 1.10, 1.20, 1.30, 1.50];
  const dds = [0.05, 0.08, 0.10, 0.12, 0.15, 0.18, 0.22, 0.28, 0.40];
  const vz = zscore(vols);
  const bz = zscore(betas);
  const dz = zscore(dds);
  const last = riskFromZ(vz[8], bz[8], dz[8]);
  const first = riskFromZ(vz[0], bz[0], dz[0]);
  const mid = riskFromZ(vz[4], bz[4], dz[4]);
  assertTrue("höchstes Risiko-Trio → risk >= 4", last >= 4);
  assertTrue("niedrigstes Risiko-Trio → risk <= 2", first <= 2);
  assertEqual("Mittelwerte → risk 3", mid, 3);
  const rawLast = 0.40 * vz[8] + 0.35 * bz[8] + 0.25 * dz[8];
  assertEqual("risk_1_5 = clamp(round(3+raw),1,5)", last, clamp(Math.round(3 + rawLast), 1, 5));

  const momHigh = 1 + 4 * percentileRank(0.20, [0.01, 0.05, 0.10, 0.20]);
  const attr = attractivenessScore(1.78, momHigh, 1);
  const expected = Math.round((0.40 * 1.78 + 0.30 * momHigh + 0.30 * 1) * 10) / 10;
  assertClose("attraktivität round(..., 1)", attr, expected, 1e-12);
}

function rec(partial: {
  p3?: number; p6?: number; p12?: number; pSent?: number;
  sahm?: string; yieldZ?: string; credit?: string; pmi?: string;
}): RecessionLike {
  const subgroups = [];
  if (partial.p3 != null) subgroups.push({ name: "recession_coincident", probability: partial.p3 });
  if (partial.p6 != null) subgroups.push({ name: "recession_leading", probability: partial.p6 });
  if (partial.p12 != null) subgroups.push({ name: "recession_full", probability: partial.p12 });
  if (partial.pSent != null) subgroups.push({ name: "correction_sentiment", probability: partial.pSent });
  const indicators = [];
  if (partial.sahm) indicators.push({ name: "Sahm-Regel", zone: partial.sahm });
  if (partial.yieldZ) indicators.push({ name: "Inv. Zinskurve (10Y-2Y)", zone: partial.yieldZ });
  if (partial.credit) indicators.push({ name: "Kreditspreads (BAA-Trs)", zone: partial.credit });
  if (partial.pmi) indicators.push({ name: "PMI (Mfg+Serv Ø)", zone: partial.pmi });
  return { subgroups, indicators, nyFedValue: null, interpretation: "" };
}

console.log("\n=== Test 5: Phase ist Funktion des Recession-Inputs, keine String-Konstante ===");
{
  const a = mapPhaseFromRecession(rec({ p3: 70, p6: 65, p12: 60, sahm: "Ausgelöst (≥0.5pp)" }));
  assertEqual("hohe Coincident + Sahm → Abschwung", a.phase, "Abschwung");
  const b = mapPhaseFromRecession(rec({ p3: 25, p6: 30, p12: 55, pSent: 52 }));
  assertEqual("Coincident niedrig, 12M noch hoch → Frühzyklus", b.phase, "Frühzyklus");
  const c = mapPhaseFromRecession(rec({ p3: 30, p6: 50, p12: 40, yieldZ: "Invertiert (<0)" }));
  assertEqual("Leading zieht an / Zinskurve invertiert → Spätkonjunktur", c.phase, "Spätkonjunktur");
  const d = mapPhaseFromRecession(rec({ p3: 20, p6: 22, p12: 25, pSent: 30 }));
  assertEqual("niedriges Rezessionsrisiko, kein Stress → Hochkonjunktur", d.phase, "Hochkonjunktur");
  const e = mapPhaseFromRecession(rec({ p3: 20, p6: 22, p12: 25, pSent: 30, yieldZ: "Invertiert (<0)" }));
  assertEqual("Expansion ABER Zinsen/Stress steigend → Spätkonjunktur nicht Hoch", e.phase, "Spätkonjunktur");
  assertTrue("verschiedene Inputs → mindestens 3 verschiedene Phasen",
    new Set([a.phase, b.phase, c.phase, d.phase, e.phase]).size >= 3);
  const src = mapPhaseFromRecession.toString();
  assertTrue("mapPhaseFromRecession ist keine Konstante (enthält Subgroup-Lookups)",
    src.includes("recession_coincident") && src.includes("recession_leading"));
}

console.log("\n=== Test 6: computeSectorRotation Fixture — 9 Zeilen, Coverage, kein Throw ===");
{
  const vols = [0.010, 0.012, 0.014, 0.016, 0.018, 0.020, 0.022, 0.024, 0.030];
  const betas = [0.60, 0.70, 0.80, 0.90, 1.00, 1.10, 1.20, 1.30, 1.50];
  const dds = [0.05, 0.08, 0.10, 0.12, 0.15, 0.18, 0.22, 0.28, 0.40];
  const rets = [-0.05, 0.00, 0.04, 0.08, 0.10, 0.12, 0.15, 0.18, 0.22];
  const pes = [32.4, 20, 22, 24, 26, 28, 30, 18, 14];
  const pe10ys: Array<number | null> = [24.1, 20, 22, 20, 20, 22, 24.1, 22, null];

  const sectors: SectorRotationSectorInput[] = ETF_PROXY_MAP.map((p, i) => ({
    id: p.id,
    vol60d: vols[i],
    betaSpx: betas[i],
    maxDd12m: dds[i],
    pe: pes[i],
    pe10y: pe10ys[i],
    return6M: rets[i],
  }));

  const out = computeSectorRotation({
    asOf: "2026-08-17",
    recession: rec({ p3: 20, p6: 22, p12: 25, pSent: 30 }),
    sectors,
  });

  assertEqual("asOf durchgereicht", out.asOf, "2026-08-17");
  assertEqual("9 Rows", out.sectors.length, 9);
  assertEqual("etfCoverage 9", out.dataQuality.etfCoverage, 9);
  assertEqual("pe10yCoverage 8 (letzte Zeile null)", out.dataQuality.pe10yCoverage, 8);
  assertEqual("source fmp+etf", out.dataQuality.source, "fmp+etf");
  assertEqual("utilities valuation fallback", out.sectors[8].valuation, VALUATION_FALLBACK);
  assertEqual("utilities pe10y null", out.sectors[8].pe10y, null);
  assertTrue("utilities attractiveness endlich", Number.isFinite(out.sectors[8].attractiveness));
  assertEqual("phase Hochkonjunktur (low risk fixture)", out.phase, "Hochkonjunktur");
  const tech = out.sectors.find(s => s.id === "technology")!;
  assertEqual("Tech phaseFit 5 (bevorzugt in Hochkonjunktur)", tech.phaseFit, 5);
  const staples = out.sectors.find(s => s.id === "staples")!;
  assertEqual("Staples phaseFit 1 (nicht bevorzugt in Hochkonjunktur)", staples.phaseFit, 1);
  assertEqual("recommendations Frühzyklus[0] Industrie", out.recommendations.Frühzyklus[0], "Industrie");
  assertEqual("recommendations keys = 4 Phasen", Object.keys(out.recommendations).length, 4);
  assertTrue("risk in 1..5", out.sectors.every(s => s.risk >= 1 && s.risk <= 5));
  assertTrue("attractiveness in 1..5", out.sectors.every(s => s.attractiveness >= 1 && s.attractiveness <= 5));

  const teuerRow = out.sectors.find(s => s.id === "technology")!;
  const expectedTeuer = valuationFromPe(32.4, 24.1).label;
  assertEqual("Tech Bewertung aus 32.4/24.1", teuerRow.valuation, expectedTeuer);

  const vz = zscore(vols);
  const bz = zscore(betas);
  const dz = zscore(dds);
  assertEqual("Tech risk matches §2.4 z-combo", teuerRow.risk, riskFromZ(vz[0], bz[0], dz[0]));
}

console.log("\n=== Test 7: PHASE_PREFERRED Listen aus Spec ===");
{
  assertEqual("Frühzyklus 3", PHASE_PREFERRED.Frühzyklus.join(","), "Industrie,Technologie,Konsumzyklik");
  assertEqual("Hochkonjunktur 3", PHASE_PREFERRED.Hochkonjunktur.join(","), "Technologie,Kommunikationsdienste,Finanzen");
  assertEqual("Spätkonjunktur 3", PHASE_PREFERRED.Spätkonjunktur.join(","), "Gesundheitswesen,Konsumdefensiv,Energie");
  assertEqual("Abschwung 3", PHASE_PREFERRED.Abschwung.join(","), "Gesundheitswesen,Versorger,Konsumdefensiv");
}

console.log("\n=== Test 8 (P2/P3 Client-Konsistenz): Sektorradar/Zyklus-Karten decken alle 9 IDs + 4 Phasen ab ===");
{
  // Spiegelt die im Client (SectorRotationPanel.tsx) hartkodierte SECTOR_COLORS-Map
  // und PHASE_ORDER — reiner Konsistenz-Check, kein Client-Import (Client bündelt
  // via Vite, kein direkter tsx-Import möglich). Bricht absichtlich, falls
  // ETF_PROXY_MAP jemals ergänzt/umbenannt wird, ohne die Client-Palette nachzuziehen.
  const CLIENT_SECTOR_COLOR_KEYS = [
    "technology", "communication", "discretionary", "industrials",
    "financials", "energy", "healthcare", "staples", "utilities",
  ];
  assertEqual("Client-Farbpalette deckt 9 IDs ab", CLIENT_SECTOR_COLOR_KEYS.length, ETF_PROXY_MAP.length);
  assertTrue(
    "jede ETF_PROXY_MAP-ID hat einen Client-Farbeintrag",
    ETF_PROXY_MAP.every(p => CLIENT_SECTOR_COLOR_KEYS.includes(p.id))
  );

  const CLIENT_PHASE_ORDER = ["Frühzyklus", "Hochkonjunktur", "Spätkonjunktur", "Abschwung"];
  assertEqual("Client PHASE_ORDER deckt alle 4 Phasen ab", CLIENT_PHASE_ORDER.length, Object.keys(PHASE_PREFERRED).length);
  assertTrue(
    "jede PHASE_PREFERRED-Phase ist in Client PHASE_ORDER",
    Object.keys(PHASE_PREFERRED).every(p => CLIENT_PHASE_ORDER.includes(p))
  );

  // recommendations liefert für jede Phase genau 3 Einträge (Empfehlungskarten
  // im Client rendern eine feste 3er-Liste ohne Overflow-Handling).
  const fixtureOut = computeSectorRotation({
    asOf: "2026-08-17",
    recession: { indicators: [], subgroups: [], nyFedValue: null, interpretation: "" },
    sectors: ETF_PROXY_MAP.map(p => ({ id: p.id })),
  });
  for (const phase of CLIENT_PHASE_ORDER as Array<keyof typeof fixtureOut.recommendations>) {
    assertEqual(`recommendations.${phase} hat genau 3 Einträge`, fixtureOut.recommendations[phase].length, 3);
  }
}

console.log(`\n=== Ergebnis: ${failures === 0 ? "ALLE TESTS BESTANDEN" : `${failures} FEHLER`} ===`);
if (failures > 0) process.exit(1);
