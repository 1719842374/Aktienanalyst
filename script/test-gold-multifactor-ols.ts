/**
 * Unit-Tests für das Gold-Multi-Faktor-OLS-Modell (Sprint D5, WORK_TEIL7_SCORING.md §6.1-6.6).
 * Läuft ohne Netzwerk (keine FRED-Fetches) — reine Funktionstests mit synthetischen Daten für
 * buildWalclForwardFill (LOCF), buildGoldMultiFactorSeries (Inner-Join nur bei vollständigen
 * Daten), goldMultiFactorFairValueModel (OLS-Koeffizienten gegen bekannte β-Werte), den
 * Vorzeichen-Check-Gate (REGIME_UNSTABLE) und runMultiFactorGoldModel (Orchestrierung).
 *
 * Ausführen: npx tsx script/test-gold-multifactor-ols.ts
 */
import {
  buildWalclForwardFill,
  buildGoldMultiFactorSeries,
  goldMultiFactorFairValueModel,
  buildGoldMultiFactorRegimeGate,
  runMultiFactorGoldModel,
  GOLD_MODEL_DEFAULTS,
  type GoldMultiFactorPoint,
  type FredPoint,
} from "../server/gold-realyield-model";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ─── buildWalclForwardFill — LOCF-Forward-Fill, kein Lookahead, keine Interpolation ──────────
console.log("\nbuildWalclForwardFill — LOCF wöchentlich → tägliche Handelstage");
{
  const walclWeekly: FredPoint[] = [
    { date: "2026-01-02", value: 7000 },
    { date: "2026-01-09", value: 7050 },
  ];
  const tradingDates = ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-09", "2026-01-12"];
  const filled = buildWalclForwardFill(walclWeekly, tradingDates);

  check("Tag vor erstem WALCL-Punkt hat KEINEN Wert (kein Rückwärts-Interpolieren)", !filled.has("2026-01-01"));
  check("Am Veröffentlichungstag selbst bereits sichtbar (kein Lookahead nötig, as-of)", filled.get("2026-01-02") === 7000);
  check("LOCF trägt Wert fort bis zum nächsten Punkt (01-05)", filled.get("2026-01-05") === 7000);
  check("LOCF trägt Wert fort bis zum nächsten Punkt (01-06)", filled.get("2026-01-06") === 7000);
  check("Neuer Wert ab dessen Veröffentlichungsdatum (01-09)", filled.get("2026-01-09") === 7050);
  check("LOCF trägt neuesten Wert weiter fort (01-12)", filled.get("2026-01-12") === 7050);

  // Kein Lookahead-Test: ein WALCL-Punkt mit zukünftigem Datum darf NICHT vor seinem
  // Veröffentlichungsdatum sichtbar sein.
  const futurePoint: FredPoint[] = [{ date: "2030-01-01", value: 99999 }];
  const noLookahead = buildWalclForwardFill(futurePoint, ["2026-01-01", "2026-06-01"]);
  check("Zukünftiger WALCL-Punkt beeinflusst Vergangenheit NICHT (kein Lookahead)", !noLookahead.has("2026-01-01") && !noLookahead.has("2026-06-01"));
}

// ─── buildGoldMultiFactorSeries — Inner-Join NUR bei allen drei Faktoren vollständig ─────────
console.log("\nbuildGoldMultiFactorSeries — nur Tage mit Real10Y + DXY + WALCL non-null");
{
  const goldPrices = [
    { date: "2026-01-01", close: 4000 },
    { date: "2026-01-02", close: 4010 }, // fehlt DXY
    { date: "2026-01-03", close: 4020 }, // fehlt WALCL (nicht in Map)
    { date: "2026-01-04", close: 4030 }, // vollständig
  ];
  const real10Y: FredPoint[] = [
    { date: "2026-01-01", value: 1.5 },
    { date: "2026-01-02", value: 1.4 },
    { date: "2026-01-03", value: 1.3 },
    { date: "2026-01-04", value: 1.2 },
  ];
  const dxy: FredPoint[] = [
    { date: "2026-01-01", value: 100 },
    { date: "2026-01-03", value: 101 },
    { date: "2026-01-04", value: 102 },
  ];
  const walclForwardFilled = new Map<string, number>([
    ["2026-01-01", 7000],
    ["2026-01-02", 7000],
    ["2026-01-04", 7050],
  ]);

  const series = buildGoldMultiFactorSeries(goldPrices, real10Y, dxy, walclForwardFilled);
  check("Nur Tage mit ALLEN drei Faktoren → 2 Punkte (01-01, 01-04)", series.length === 2, `got ${series.length}`);
  check("01-01 enthalten (vollständig)", series.some(p => p.date === "2026-01-01"));
  check("01-02 ausgelassen (DXY fehlt)", !series.some(p => p.date === "2026-01-02"));
  check("01-03 ausgelassen (WALCL fehlt in Forward-Fill-Map)", !series.some(p => p.date === "2026-01-03"));
  check("01-04 enthalten (vollständig)", series.some(p => p.date === "2026-01-04"));
  const p0 = series.find(p => p.date === "2026-01-01")!;
  check("logWalcl korrekt berechnet (log(7000))", Math.abs(p0.logWalcl - Math.log(7000)) < 1e-9);
}

// ─── goldMultiFactorFairValueModel — OLS exakt gegen bekannte β-Werte (synthetische Daten) ───
console.log("\ngoldMultiFactorFairValueModel — 3-Faktor-OLS reproduziert bekannte β-Werte exakt");
{
  // Exakte lineare Relation: G = 100 - 50*R - 2*DXY + 300*log(WALCL), keine Störterme (ε=0).
  // Damit lässt sich die Normalengleichung exakt gegen Handrechnung prüfen (R² = 1).
  const ALPHA = 100, BETA1 = -50, BETA2 = -2, BETA3 = 300;
  function buildSynthetic(n: number): GoldMultiFactorPoint[] {
    const points: GoldMultiFactorPoint[] = [];
    const base = new Date("2024-01-01T00:00:00.000Z").getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    for (let i = 0; i < n; i++) {
      const real10Y = 2.0 - i * 0.003; // fällt über die Zeit
      const dxy = 100 + Math.sin(i / 7) * 3; // oszilliert, damit XᵗX nicht singulär wird
      const walcl = 7000 + i * 2; // steigt leicht (QE-artig)
      const logWalcl = Math.log(walcl);
      const goldClose = ALPHA + BETA1 * real10Y + BETA2 * dxy + BETA3 * logWalcl;
      const date = new Date(base + i * dayMs).toISOString().slice(0, 10);
      points.push({ date, goldClose, real10Y, dxy, logWalcl });
    }
    return points;
  }

  const series = buildSynthetic(300);
  const fv = goldMultiFactorFairValueModel(series);
  check("Modell liefert Ergebnis (≥30 Punkte, nicht singulär)", fv !== null);
  if (fv) {
    check("windowUsed = 252 (Default OLS-Window)", fv.windowUsed === GOLD_MODEL_DEFAULTS.OLS_WINDOW, `got ${fv.windowUsed}`);
    check(`α ≈ ${ALPHA} (exakte synthetische Relation)`, Math.abs(fv.alpha - ALPHA) < 0.05, `got ${fv.alpha}`);
    check(`β1 ≈ ${BETA1} (Real10Y)`, Math.abs(fv.beta1 - BETA1) < 0.05, `got ${fv.beta1}`);
    check(`β2 ≈ ${BETA2} (DXY)`, Math.abs(fv.beta2 - BETA2) < 0.05, `got ${fv.beta2}`);
    check(`β3 ≈ ${BETA3} (log WALCL)`, Math.abs(fv.beta3 - BETA3) < 0.05, `got ${fv.beta3}`);
    check("premiumPct ≈ 0 bei exakter Relation (kein ε)", Math.abs(fv.premiumPct) < 0.001, `got ${fv.premiumPct}`);
    check("signsValid=true (β1<0, β2<0, β3>0 erfüllt)", fv.signsValid === true);
  }

  // Zu wenige Datenpunkte → null (kein Fake-Fit), analog zum 1-Faktor-Modell.
  const tooFew = buildSynthetic(10);
  check("< 30 Punkte → null (kein Fake-Fit)", goldMultiFactorFairValueModel(tooFew) === null);
}

// ─── Vorzeichen-Check-Gate — REGIME_UNSTABLE bei Verletzung ──────────────────────────────────
console.log("\nVorzeichen-Check-Gate (buildGoldMultiFactorRegimeGate) — REGIME_UNSTABLE bei Verletzung");
{
  const validResult = {
    windowUsed: 252, alpha: 100, beta1: -50, beta2: -2, beta3: 300,
    fairValue: 4000, actualPrice: 4000, premiumPct: 0, signsValid: true,
  };
  const gateValid = buildGoldMultiFactorRegimeGate(validResult);
  check("Gültige Vorzeichen → Gate INAKTIV", gateValid.active === false);
  check("Gate-ID korrekt", gateValid.id === "GOLD_MULTIFACTOR_REGIME_UNSTABLE");

  const invalidBeta1 = { ...validResult, beta1: 50, signsValid: false }; // β1 positiv (falsch)
  const gateInvalid1 = buildGoldMultiFactorRegimeGate(invalidBeta1);
  check("β1 positiv (falsch) → Gate AKTIV (REGIME_UNSTABLE)", gateInvalid1.active === true);

  const invalidBeta3 = { ...validResult, beta3: -300, signsValid: false }; // β3 negativ (falsch)
  const gateInvalid3 = buildGoldMultiFactorRegimeGate(invalidBeta3);
  check("β3 negativ (falsch) → Gate AKTIV (REGIME_UNSTABLE)", gateInvalid3.active === true);

  const gateNoModel = buildGoldMultiFactorRegimeGate(null);
  check("Kein Modell-Ergebnis → Gate INAKTIV (kein Regime-Problem, sondern Datenmangel)", gateNoModel.active === false);
}

// ─── runMultiFactorGoldModel — End-to-End-Orchestrierung ──────────────────────────────────────
console.log("\nrunMultiFactorGoldModel — Orchestrierung (LOCF + Join + OLS + Gate)");
{
  const n = 300;
  const base = new Date("2024-01-01T00:00:00.000Z").getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const goldPrices: { date: string; close: number }[] = [];
  const real10Y: FredPoint[] = [];
  const dxy: FredPoint[] = [];
  const walclWeekly: FredPoint[] = [];

  for (let i = 0; i < n; i++) {
    const date = new Date(base + i * dayMs).toISOString().slice(0, 10);
    const r = 2.0 - i * 0.003;
    const d = 100 + Math.sin(i / 7) * 3;
    real10Y.push({ date, value: r });
    dxy.push({ date, value: d });
    if (i % 7 === 0) walclWeekly.push({ date, value: 7000 + i * 2 }); // wöchentlich
    const walclLatest = 7000 + Math.floor(i / 7) * 7 * 2;
    goldPrices.push({ date, close: 100 - 50 * r - 2 * d + 300 * Math.log(walclLatest) });
  }

  const result = runMultiFactorGoldModel(goldPrices, real10Y, dxy, walclWeekly);
  check("Serie enthält gejointe Punkte", result.series.length > 0, `got ${result.series.length}`);
  check("Fair-Value-Ergebnis vorhanden (≥30 Punkte)", result.fairValue !== null);
  check("Gate vorhanden", result.gate != null && typeof result.gate.active === "boolean");
  check("generatedAt ist ISO-String", typeof result.generatedAt === "string" && result.generatedAt.includes("T"));

  // Fehlende WALCL-Serie komplett → kein Ergebnis (kein Interpolieren über LOCF hinaus).
  const resultNoWalcl = runMultiFactorGoldModel(goldPrices, real10Y, dxy, []);
  check("Keine WALCL-Daten → series leer (kein Fake-Fill)", resultNoWalcl.series.length === 0);
  check("Keine WALCL-Daten → fairValue null", resultNoWalcl.fairValue === null);
}

console.log(`\n${failed === 0 ? "✅ Alle Tests bestanden" : `❌ ${failed} Test(s) fehlgeschlagen`}`);
process.exit(failed === 0 ? 0 : 1);
