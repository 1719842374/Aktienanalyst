/**
 * script/test-sector-attr-band.ts — Ampel nach Perzentil + Trendpfeile.
 * Aufruf: npx tsx script/test-sector-attr-band.ts
 * Synthetisch. attractivenessScore / computeSectorRotation bleiben unangetastet.
 */
import {
  ATTR_PARAMS,
  sectorAttrBands,
  type AttrBand,
  type SectorAttrInput,
} from "../shared/sector-attr-band";
import {
  ETF_PROXY_MAP,
  attachSectorAttrBands,
  attractivenessFromSnapshot,
  computeSectorRotation,
  type SectorRotationSectorInput,
} from "../server/sector-rotation";

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) {
    failures++;
    console.error(`❌ ${label}: erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`);
  } else {
    console.log(`✅ ${label}`);
  }
}
function assertTrue(label: string, cond: boolean, detail = ""): void {
  if (!cond) {
    failures++;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ""}`);
  } else {
    console.log(`✅ ${label}`);
  }
}
function assertClose(label: string, actual: number, expected: number, eps = 1e-12): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > eps) {
    failures++;
    console.error(`❌ ${label}: erwartet ${expected}, erhalten ${actual}`);
  } else {
    console.log(`✅ ${label}`);
  }
}

function bandOf(rows: ReturnType<typeof sectorAttrBands>, id: string): AttrBand {
  return rows.find(r => r.id === id)!.attrBand;
}

console.log("=== Parameter aus der Spec (Philip 01.11. 12:36) ===");
assertClose("greenPct = 2/3", ATTR_PARAMS.greenPct, 2 / 3);
assertClose("redPct = 1/3", ATTR_PARAMS.redPct, 1 / 3);
assertTrue("minSectors > 2 (n=2 bleibt grau)", ATTR_PARAMS.minSectors > 2);
assertTrue("Live-Karte (9 ETF) liegt über minSectors", ETF_PROXY_MAP.length >= ATTR_PARAMS.minSectors);
assertTrue("zArrow > 0", ATTR_PARAMS.zArrow > 0);

console.log("\n=== 11 Sektoren, streng steigend ===");
{
  const current: SectorAttrInput[] = Array.from({ length: 11 }, (_, i) => ({
    id: `s${i + 1}`,
    attractiveness: i + 1,
  }));
  const snapshot = current.map(s => ({ ...s }));
  const previous: SectorAttrInput[] = current.map((s, i) => ({
    id: s.id,
    // s1 −2, s11 +2, Rest unverändert. s6 ohne Vorwert.
    attractiveness: s.id === "s6" ? null : (s.attractiveness as number) + (i === 0 ? 2 : i === 10 ? -2 : 0),
  }));
  const rows = sectorAttrBands(current, previous);
  assertEqual("Eingabe nicht mutiert", snapshot.map(s => s.attractiveness).join(","), current.map(s => s.attractiveness).join(","));
  assertEqual("11 Zeilen", rows.length, 11);

  // Mid-Rank eindeutiger Werte: (k − 0.5) / 11. k=1..4 rot, 5..7 gelb, 8..11 grün.
  const expectBand: AttrBand[] = [
    "red", "red", "red", "red",
    "yellow", "yellow", "yellow",
    "green", "green", "green", "green",
  ];
  current.forEach((s, i) => {
    const row = rows[i];
    const pct = (i + 0.5) / 11;
    assertClose(`${s.id} Perzentil`, row.attrPercentile as number, pct, 1e-12);
    assertEqual(`${s.id} Band`, row.attrBand, expectBand[i]);
  });

  assertEqual("s1 Δ = -2 → runter", rows[0].attrDelta, -2);
  assertEqual("s1 Pfeil", rows[0].attrTrend, "down");
  assertEqual("s11 Δ = +2 → hoch", rows[10].attrDelta, 2);
  assertEqual("s11 Pfeil", rows[10].attrTrend, "up");
  assertEqual("s2 Δ = 0 → flach", rows[1].attrTrend, "flat");
  assertEqual("s6 kein Vorwert", rows[5].attrTrend, "none");
  assertEqual("s6 Δ null", rows[5].attrDelta, null);
  assertTrue("Mitte bleibt gelb und hat ein Perzentil", rows[5].attrBand === "yellow" && rows[5].attrPercentile != null);
}

console.log("\n=== Gleichstand ===");
{
  const tied: SectorAttrInput[] = Array.from({ length: 11 }, (_, i) => ({ id: `t${i}`, attractiveness: 3 }));
  const noPrev = sectorAttrBands(tied, null);
  assertTrue("alle Perzentile 0.5", noPrev.every(r => r.attrPercentile === 0.5));
  assertTrue("alle gelb", noPrev.every(r => r.attrBand === "yellow"));
  assertTrue("ohne Vorwert kein Pfeil", noPrev.every(r => r.attrTrend === "none" && r.attrDelta == null));

  const flat = sectorAttrBands(tied, tied.map(s => ({ ...s })));
  assertTrue("identischer Vorwert → alle flach, Δ 0", flat.every(r => r.attrTrend === "flat" && r.attrDelta === 0));
  assertTrue("Gleichstand bleibt gelb", flat.every(r => r.attrBand === "yellow"));
}

console.log("\n=== n=2 unter minSectors ===");
{
  const tiny: SectorAttrInput[] = [
    { id: "a", attractiveness: 1 },
    { id: "b", attractiveness: 5 },
  ];
  const rows = sectorAttrBands(tiny, [{ id: "a", attractiveness: 1 }, { id: "b", attractiveness: 9 }]);
  assertTrue("beide neutral", rows.every(r => r.attrBand === "neutral"));
  assertTrue("kein Perzentil unter der Stichprobe", rows.every(r => r.attrPercentile == null));
  assertEqual("Vorwert bleibt auswertbar (a flach oder Pfeil, nicht none)", rows[0].attrTrend === "none", false);
  assertTrue("b hat ein Δ", rows[1].attrDelta === -4);
}

console.log("\n=== Fehlende Werte ===");
{
  const rowsIn: SectorAttrInput[] = Array.from({ length: 11 }, (_, i) => ({
    id: `m${i}`,
    attractiveness: i === 2 || i === 7 ? null : i + 1,
  }));
  const previous: SectorAttrInput[] = rowsIn.map((s, i) => ({
    id: s.id,
    attractiveness: i === 4 ? null : (typeof s.attractiveness === "number" ? s.attractiveness - 0.2 : 1),
  }));
  const rows = sectorAttrBands(rowsIn, previous);
  assertEqual("m2 fehlend → neutral", bandOf(rows, "m2"), "neutral");
  assertEqual("m2 Perzentil null", rows[2].attrPercentile, null);
  assertEqual("m2 kein Pfeil", rows[2].attrTrend, "none");
  assertEqual("m7 fehlend → neutral", bandOf(rows, "m7"), "neutral");
  assertEqual("m4 ohne Vorwert", rows[4].attrTrend, "none");
  assertEqual("m4 Δ null", rows[4].attrDelta, null);
  const finite = rows.filter(r => r.id !== "m2" && r.id !== "m7");
  assertEqual("9 bewertete Zeilen", finite.length, 9);
  assertTrue("fehlende zählen nicht mit: jedes finite hat ein Perzentil", finite.every(r => r.attrPercentile != null));
  assertTrue("Bänder nur aus der 9er-Stichprobe", finite.every(r => r.attrBand === "green" || r.attrBand === "yellow" || r.attrBand === "red"));
  const pcts = finite.map(r => r.attrPercentile as number);
  assertTrue("Perzentile der vorhandenen Werte steigen", pcts.every((p, i) => i === 0 || p > pcts[i - 1]));
  assertTrue("m0 hat Vorwert und damit einen Pfeil", rows[0].attrTrend !== "none" && rows[0].attrDelta != null);
}

console.log("\n=== attractiveness selbst unverändert ===");
{
  const vols = [0.010, 0.012, 0.014, 0.016, 0.018, 0.020, 0.022, 0.024, 0.030];
  const sectors: SectorRotationSectorInput[] = ETF_PROXY_MAP.map((p, i) => ({
    id: p.id,
    vol60d: vols[i],
    betaSpx: 0.8 + i * 0.05,
    maxDd12m: 0.05 + i * 0.02,
    pe: 18 + i,
    pe10y: 20,
    return6M: -0.04 + i * 0.02,
  }));
  const out = computeSectorRotation({
    asOf: "2026-08-17",
    recession: { indicators: [], subgroups: [], nyFedValue: null, interpretation: "" },
    sectors,
  });
  const before = out.sectors.map(s => s.attractiveness);
  const previous = attractivenessFromSnapshot({
    sectors: out.sectors.map((s, i) => ({ id: s.id, attractiveness: i === 0 ? null : s.attractiveness - 0.4 })),
  });
  const enriched = attachSectorAttrBands(out, previous);
  const after = enriched.sectors.map(s => s.attractiveness);
  assertEqual("9 attractiveness unverändert", after.join(","), before.join(","));
  assertTrue("jedes Band gesetzt", enriched.sectors.every(s => typeof (s as { attrBand?: string }).attrBand === "string"));
  assertEqual("erster Sektor kein Vorwert", (enriched.sectors[0] as { attrTrend: string }).attrTrend, "none");
  assertTrue("zweiter Sektor hat Vorwert", (enriched.sectors[1] as { attrTrend: string }).attrTrend !== "none");
  assertEqual("Snapshot ohne Sektoren → null", attractivenessFromSnapshot({ sectors: [] }), null);
  assertEqual("Snapshot fehlt → null", attractivenessFromSnapshot(null), null);
}

console.log(`\n=== Ergebnis: ${failures === 0 ? "ALLE TESTS BESTANDEN" : `${failures} FEHLER`} ===`);
if (failures > 0) process.exit(1);
