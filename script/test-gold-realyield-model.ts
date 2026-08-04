/**
 * Unit-Tests für das Gold/Realzins-Modell, 1-Faktor-MVP (WORK_TEIL7_SCORING.md
 * §7.8.8–§7.8.9). Läuft ohne Netzwerk (keine FRED-Fetches) — reine Funktionstests
 * mit synthetischen Daten für buildGoldMacroSeries/goldFairValueModel/
 * goldRealYieldInverseScore/goldRateScenarios/deriveGoldRegimeZones/
 * runRealYieldGoldModel und die beiden Gates.
 *
 * Ausführen: npx tsx script/test-gold-realyield-model.ts
 */
import {
  buildGoldMacroSeries, goldFairValueModel, goldRealYieldInverseScore, goldRateScenarios,
  deriveGoldRegimeZones, runRealYieldGoldModel, buildGoldRealYieldRegimeGate, buildGoldAiscStressGate,
  GOLD_MODEL_DEFAULTS,
  type GoldMacroPoint, type FredPoint,
} from "../server/gold-realyield-model";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ─── Synthetische Testdaten: exakte lineare Beziehung Gold = 5000 - 800*Real10Y ─
// So lässt sich die OLS-Regression exakt gegen Handrechnung prüfen (r² = 1, corr = -1).
function buildSyntheticSeries(n: number, startReal10Y: number, stepPerDay: number): GoldMacroPoint[] {
  const points: GoldMacroPoint[] = [];
  const base = new Date("2024-01-01T00:00:00.000Z").getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let i = 0; i < n; i++) {
    const real10Y = startReal10Y + i * stepPerDay;
    const gold = 5000 - 800 * real10Y; // exakte lineare Relation, beta=-800, alpha=5000
    const date = new Date(base + i * dayMs).toISOString().slice(0, 10);
    points.push({ date, goldClose: gold, real10Y, aisc: 1400 });
  }
  return points;
}

// ─── buildGoldMacroSeries — Inner-Join auf Datum ──────────────────────────────
console.log("\nbuildGoldMacroSeries — Inner-Join auf gemeinsame Daten");
{
  const goldPrices = [
    { date: "2026-01-01", close: 4000 },
    { date: "2026-01-02", close: 4010 },
    { date: "2026-01-03", close: 4020 }, // kein Real10Y-Wert für diesen Tag
  ];
  const real10Y: FredPoint[] = [
    { date: "2026-01-01", value: 1.5 },
    { date: "2026-01-02", value: 1.4 },
  ];
  const series = buildGoldMacroSeries(goldPrices, real10Y);
  check("Nur Tage mit beiden Quellen (Inner-Join) → 2 Punkte", series.length === 2, `got ${series.length}`);
  check("Chronologisch sortiert", series[0].date === "2026-01-01" && series[1].date === "2026-01-02");
  check("aisc null wenn keine Map übergeben", series[0].aisc === null);

  const aiscMap = new Map([["2026-01-01", 1350]]);
  const seriesWithAisc = buildGoldMacroSeries(goldPrices, real10Y, aiscMap);
  check("AISC aus Map übernommen wenn vorhanden", seriesWithAisc[0].aisc === 1350);
  check("AISC null wenn Tag fehlt in Map", seriesWithAisc[1].aisc === null);
}

// ─── goldFairValueModel — OLS exakt gegen Handrechnung ────────────────────────
console.log("\ngoldFairValueModel — OLS Gold ~ Real10Y (exakte lineare Testdaten)");
{
  // Real10Y fällt über die Zeit (typisches "Cuts"-Szenario), exakte lineare Relation
  const series = buildSyntheticSeries(300, 2.5, -0.005);
  const fv = goldFairValueModel(series);
  check("Fair-Value-Modell liefert Ergebnis (≥30 Punkte)", fv !== null);
  if (fv) {
    check("windowUsed = 252 (Default OLS-Window)", fv.windowUsed === GOLD_MODEL_DEFAULTS.OLS_WINDOW, `got ${fv.windowUsed}`);
    check("beta ≈ -800 (exakte synthetische Relation)", Math.abs(fv.beta - (-800)) < 0.01, `got ${fv.beta}`);
    check("alpha ≈ 5000", Math.abs(fv.alpha - 5000) < 0.5, `got ${fv.alpha}`);
    check("correlation ≈ -1 (perfekte inverse lineare Beziehung)", Math.abs(fv.correlation - (-1)) < 0.001, `got ${fv.correlation}`);
    check("fairValue == actualPrice bei exakter Relation (premiumPct ≈ 0)", Math.abs(fv.premiumPct) < 0.001, `got ${fv.premiumPct}`);
    check("withinFairBand=true bei premiumPct≈0", fv.withinFairBand === true);
    check("nicht decoupled (corr=-1 << -0.25)", fv.decoupled === false);
  }

  // Zu wenige Datenpunkte → null (kein Fake-Fit)
  const tooFew = buildSyntheticSeries(10, 2.0, -0.01);
  check("< 30 Punkte → null (kein Fake-Fit)", goldFairValueModel(tooFew) === null);

  // Decoupling-Fall: Real10Y konstant (keine Varianz) → OLS degeneriert → null
  const flatReal = buildSyntheticSeries(300, 2.0, 0).map(p => ({ ...p, real10Y: 2.0, goldClose: 4000 + Math.random() * 0.0001 }));
  const fvFlat = goldFairValueModel(flatReal);
  check("Real10Y ohne Varianz (sxx=0) → null statt Crash", fvFlat === null);
}

// ─── goldFairValueModel — Fair-Band ±10% Grenzfälle ───────────────────────────
console.log("\ngoldFairValueModel — Fair-Band ±10% (§7 Kalibrierung)");
{
  const series = buildSyntheticSeries(300, 2.5, -0.005);
  // Letzten Punkt manuell verzerren, um Premium zu erzeugen
  const distorted = [...series];
  distorted[distorted.length - 1] = { ...distorted[distorted.length - 1], goldClose: distorted[distorted.length - 1].goldClose * 1.15 };
  const fv = goldFairValueModel(distorted);
  check("15% Abweichung → außerhalb Fair-Band (±10%)", fv !== null && fv.withinFairBand === false, JSON.stringify(fv));

  const distortedSmall = [...series];
  distortedSmall[distortedSmall.length - 1] = { ...distortedSmall[distortedSmall.length - 1], goldClose: distortedSmall[distortedSmall.length - 1].goldClose * 1.05 };
  const fvSmall = goldFairValueModel(distortedSmall);
  check("5% Abweichung → innerhalb Fair-Band (±10%)", fvSmall !== null && fvSmall.withinFairBand === true, JSON.stringify(fvSmall));
}

// ─── goldRealYieldInverseScore — Tailwind/Stress/Neutral ──────────────────────
console.log("\ngoldRealYieldInverseScore — 1-Faktor-Score (Inverse Window 60)");
{
  // Real10Y fällt konsistent über das Fenster + starke inverse Korrelation → Tailwind (+1)
  const fallingReal = buildSyntheticSeries(100, 2.5, -0.01);
  const scoreTailwind = goldRealYieldInverseScore(fallingReal);
  check("Real10Y fällt + starke inverse Korrelation → Score +1 (Tailwind)", scoreTailwind.score === 1, JSON.stringify(scoreTailwind));

  // Real10Y steigt konsistent → Stress (-1)
  const risingReal = buildSyntheticSeries(100, 1.0, 0.01);
  const scoreStress = goldRealYieldInverseScore(risingReal);
  check("Real10Y steigt + starke inverse Korrelation → Score -1 (Stress)", scoreStress.score === -1, JSON.stringify(scoreStress));

  // Decoupling-Gate: schwache/positive Korrelation → neutral (0), unabhängig vom Trend
  const decoupled: GoldMacroPoint[] = Array.from({ length: 80 }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    goldClose: 4000 + (i % 5) * 3, // kein klarer Zusammenhang zu real10Y
    real10Y: 2.0 + i * 0.001,
    aisc: null,
  }));
  const scoreDecoupled = goldRealYieldInverseScore(decoupled);
  check("Decoupling-Gate (corr > -0.25) → Score 0 (neutral, nicht fälschlich extrem)", scoreDecoupled.score === 0, JSON.stringify(scoreDecoupled));

  // Zu wenige Punkte → neutral, kein Crash
  const empty = goldRealYieldInverseScore([]);
  check("Leere Serie → Score 0, kein Crash", empty.score === 0 && empty.correlation === null);
}

// ─── goldRateScenarios — Szenario-Schocks -100 bis +150bp ─────────────────────
console.log("\ngoldRateScenarios — Szenario-Schocks (§7 Default-Raster -100..+150bp)");
{
  const series = buildSyntheticSeries(300, 2.5, -0.005);
  const scenarios = goldRateScenarios(series);
  check("11 Szenarien im Default-Raster", scenarios.length === GOLD_MODEL_DEFAULTS.SCENARIO_SHOCKS_BP.length, `got ${scenarios.length}`);
  check("Enthält -100bp Schock", scenarios.some(s => s.shockBp === -100));
  check("Enthält +150bp Schock", scenarios.some(s => s.shockBp === 150));

  const zeroShock = scenarios.find(s => s.shockBp === 0)!;
  const lastPoint = series[series.length - 1];
  check("0bp-Schock: shockedReal10Y == aktueller Real10Y", Math.abs(zeroShock.shockedReal10Y - lastPoint.real10Y) < 1e-9, JSON.stringify(zeroShock));
  check("0bp-Schock: impliedChangePct ≈ 0 (exakte lineare Relation)", Math.abs(zeroShock.impliedChangePct) < 0.001, JSON.stringify(zeroShock));

  // -100bp (Realzins fällt) sollte bei negativem beta zu höherem impliziertem Goldpreis führen
  const shockMinus100 = scenarios.find(s => s.shockBp === -100)!;
  check("-100bp Realzins-Schock → impliedGoldPrice steigt (negatives beta)", shockMinus100.impliedGoldPrice > zeroShock.impliedGoldPrice, JSON.stringify(shockMinus100));

  const shockPlus150 = scenarios.find(s => s.shockBp === 150)!;
  check("+150bp Realzins-Schock → impliedGoldPrice fällt", shockPlus150.impliedGoldPrice < zeroShock.impliedGoldPrice, JSON.stringify(shockPlus150));

  // Kein Fair-Value-Modell möglich → leeres Array, kein Crash
  const tooFew = buildSyntheticSeries(5, 2.0, -0.01);
  check("Zu wenig Daten → [] statt Crash", goldRateScenarios(tooFew).length === 0);
}

// ─── deriveGoldRegimeZones — Regime-Klassifikation ────────────────────────────
console.log("\nderiveGoldRegimeZones — Regime-Klassifikation nach Real10Y-Trend");
{
  const fallingReal = buildSyntheticSeries(100, 2.5, -0.01);
  const regimeTailwind = deriveGoldRegimeZones(fallingReal);
  check("Real10Y fällt deutlich → Regime 'tailwind'", regimeTailwind?.regime === "tailwind", JSON.stringify(regimeTailwind));

  const risingReal = buildSyntheticSeries(100, 1.0, 0.01);
  const regimeStress = deriveGoldRegimeZones(risingReal);
  check("Real10Y steigt deutlich → Regime 'stress'", regimeStress?.regime === "stress", JSON.stringify(regimeStress));

  const flatReal = buildSyntheticSeries(100, 2.0, 0);
  const regimeNeutral = deriveGoldRegimeZones(flatReal);
  check("Real10Y flat → Regime 'neutral'", regimeNeutral?.regime === "neutral", JSON.stringify(regimeNeutral));

  check("Zu wenig Daten (< 2 Punkte) → null", deriveGoldRegimeZones([buildSyntheticSeries(1, 2, 0)[0]]) === null);
}

// ─── Gates: GOLD_REAL_YIELD_REGIME, GOLD_AISC_STRESS ──────────────────────────
console.log("\nGates GOLD_REAL_YIELD_REGIME / GOLD_AISC_STRESS");
{
  const risingReal = buildSyntheticSeries(300, 1.0, 0.01);
  const regimeStress = deriveGoldRegimeZones(risingReal);
  const fvStress = goldFairValueModel(risingReal);
  const gateStress = buildGoldRealYieldRegimeGate(regimeStress, fvStress);
  check("Stress-Regime + nicht decoupled → Gate aktiv", gateStress.active === true, JSON.stringify(gateStress));
  check("Gate-ID korrekt", gateStress.id === "GOLD_REAL_YIELD_REGIME");

  const fallingReal = buildSyntheticSeries(300, 2.5, -0.005);
  const regimeTailwind = deriveGoldRegimeZones(fallingReal);
  const fvTailwind = goldFairValueModel(fallingReal);
  const gateTailwind = buildGoldRealYieldRegimeGate(regimeTailwind, fvTailwind);
  check("Tailwind-Regime → Gate inaktiv", gateTailwind.active === false, JSON.stringify(gateTailwind));

  check("Regime null → Gate inaktiv, kein Crash", buildGoldRealYieldRegimeGate(null, null).active === false);

  // AISC-Stress-Gate
  const gateAiscOk = buildGoldAiscStressGate(4000, 1400, 0.15); // 4000 ist weit über 1400*1.15
  check("Preis weit über AISC → Gate inaktiv", gateAiscOk.active === false, JSON.stringify(gateAiscOk));

  const gateAiscStress = buildGoldAiscStressGate(1500, 1400, 0.15); // nur 7% über AISC
  check("Preis nah an AISC (<15% Zuschlag) → Gate aktiv", gateAiscStress.active === true, JSON.stringify(gateAiscStress));
  check("Preis über AISC aber im Stress-Bereich → severity warn", gateAiscStress.severity === "warn");

  const gateAiscBelow = buildGoldAiscStressGate(1300, 1400, 0.15); // unter AISC
  check("Preis unter AISC → severity hard", gateAiscBelow.active === true && gateAiscBelow.severity === "hard", JSON.stringify(gateAiscBelow));

  const gateAiscNoData = buildGoldAiscStressGate(4000, null, 0.15);
  check("AISC nicht verfügbar → Gate inaktiv (kein Fake-Default)", gateAiscNoData.active === false);
}

// ─── runRealYieldGoldModel — Orchestrierung ───────────────────────────────────
console.log("\nrunRealYieldGoldModel — Gesamt-Orchestrierung");
{
  const goldPrices = buildSyntheticSeries(300, 2.5, -0.005).map(p => ({ date: p.date, close: p.goldClose }));
  const real10Y: FredPoint[] = buildSyntheticSeries(300, 2.5, -0.005).map(p => ({ date: p.date, value: p.real10Y }));

  const result = runRealYieldGoldModel(goldPrices, real10Y);
  check("series befüllt", result.series.length > 0, `got ${result.series.length}`);
  check("fairValue berechnet", result.fairValue !== null);
  check("inverseScore vorhanden", result.inverseScore !== undefined);
  check("scenarios vorhanden (11 Stück)", result.scenarios.length === 11, `got ${result.scenarios.length}`);
  check("regime bestimmt", result.regime !== null);
  check("2 Gates zurückgegeben (GOLD_REAL_YIELD_REGIME + GOLD_AISC_STRESS)", result.gates.length === 2, `got ${result.gates.length}`);
  check("Gate-IDs korrekt", result.gates.map(g => g.id).join(",") === "GOLD_REAL_YIELD_REGIME,GOLD_AISC_STRESS");
  check("generatedAt ist valides ISO-Datum", isFinite(new Date(result.generatedAt).getTime()));

  // Mit leeren Daten kein Crash
  const emptyResult = runRealYieldGoldModel([], []);
  check("Leere Eingabe → kein Crash, fairValue null", emptyResult.fairValue === null && emptyResult.series.length === 0);
}

console.log(failed === 0 ? "\n✅ Alle Gold-Realyield-Model-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
